/* Folio — local PDF helpers. Nothing here sends a file anywhere. */
(function () {
  'use strict';

  var MM = 72 / 25.4;

  var PORTRAIT = {
    a4: [210 * MM, 297 * MM],
    a3: [297 * MM, 420 * MM],
    a5: [148 * MM, 210 * MM],
    letter: [215.9 * MM, 279.4 * MM],
    legal: [215.9 * MM, 355.6 * MM]
  };

  var QUALITY_DPI = { original: 200, high: 200, medium: 150, small: 110 };
  var QUALITY_EDGE = { original: 4096, high: 2400, medium: 1700, small: 1200 };
  var QUALITY_JPEG = { original: 0.92, high: 0.9, medium: 0.82, small: 0.68 };

  function margins(settings) {
    return {
      top: settings.marginTopMm * MM,
      right: settings.marginRightMm * MM,
      bottom: settings.marginBottomMm * MM,
      left: settings.marginLeftMm * MM
    };
  }

  function resolvePageSize(settings, subject) {
    var m = margins(settings);
    if (settings.pageSize === 'image') {
      var dpi = QUALITY_DPI[settings.quality] || 200;
      return {
        width: subject.width * 72 / dpi + m.left + m.right,
        height: subject.height * 72 / dpi + m.top + m.bottom
      };
    }
    if (settings.pageSize === 'original') {
      return {
        width: subject.width + m.left + m.right,
        height: subject.height + m.top + m.bottom
      };
    }
    if (settings.pageSize === 'custom') {
      return {
        width: settings.customWidthMm * MM,
        height: settings.customHeightMm * MM
      };
    }
    var pair = PORTRAIT[settings.pageSize] || PORTRAIT.a4;
    var landscape = false;
    if (settings.orientation === 'landscape') landscape = true;
    else if (settings.orientation === 'portrait') landscape = false;
    else landscape = subject.width > subject.height;
    return landscape
      ? { width: pair[1], height: pair[0] }
      : { width: pair[0], height: pair[1] };
  }

  function place(imgW, imgH, pageW, pageH, margin, fit) {
    if (!(imgW > 0) || !(imgH > 0)) throw new Error('This picture has no size.');
    var boxW = pageW - margin.left - margin.right;
    var boxH = pageH - margin.top - margin.bottom;
    var imgAspect = imgW / imgH;
    var boxAspect = boxW / boxH;
    var drawW = boxW;
    var drawH = boxH;
    var sx = 0;
    var sy = 0;
    var sw = imgW;
    var sh = imgH;

    if (fit === 'stretch') {
      drawW = boxW;
      drawH = boxH;
    } else if (fit === 'fill') {
      drawW = boxW;
      drawH = boxH;
      if (imgAspect > boxAspect) {
        sh = imgH;
        sw = imgH * boxAspect;
        sx = (imgW - sw) / 2;
        sy = 0;
      } else {
        sw = imgW;
        sh = imgW / boxAspect;
        sx = 0;
        sy = (imgH - sh) / 2;
      }
    } else if (imgAspect > boxAspect) {
      drawW = boxW;
      drawH = boxW / imgAspect;
    } else {
      drawH = boxH;
      drawW = boxH * imgAspect;
    }

    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sw = Math.max(1, Math.min(sw, imgW - sx));
    sh = Math.max(1, Math.min(sh, imgH - sy));

    return {
      x: margin.left + (boxW - drawW) / 2,
      y: margin.bottom + (boxH - drawH) / 2,
      width: Math.max(1, drawW),
      height: Math.max(1, drawH),
      crop: { x: sx, y: sy, width: sw, height: sh }
    };
  }

  function layout(settings, subject, fit) {
    if (!subject || !(subject.width > 0) || !(subject.height > 0)) {
      throw new Error('This picture has no size.');
    }
    var m = margins(settings);
    var page = resolvePageSize(settings, subject);
    if (!(page.width >= 36) || !(page.height >= 36)) throw new Error('Page size is too small.');
    var boxW = page.width - m.left - m.right;
    var boxH = page.height - m.top - m.bottom;
    if (boxW < 4 || boxH < 4) {
      throw new Error(boxW <= 0 || boxH <= 0
        ? 'Those margins are larger than the page. Use a smaller margin or a larger page.'
        : 'That page is too small to place the picture.');
    }
    return {
      page: page,
      margins: m,
      placement: place(subject.width, subject.height, page.width, page.height, m, fit || 'contain')
    };
  }

  function hexToRgb(hex) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    if (!Number.isFinite(n)) n = 0xffffff;
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function paintBackground(page, pageSize, color) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageSize.width,
      height: pageSize.height,
      color: hexToRgb(color)
    });
  }

  function paintFrame(page, placement, settings) {
    if (!(settings.framePt > 0)) return;
    page.drawRectangle({
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      borderColor: hexToRgb(settings.frameColor),
      borderWidth: settings.framePt
    });
  }

  function stamp(pdf, title) {
    pdf.setTitle(title || 'Folio');
    pdf.setCreator('Folio');
    pdf.setProducer('Folio');
  }

  function yieldToUi() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function friendlyPdfError(err) {
    var msg = String((err && err.message) || err || '');
    if (/password|encrypt/i.test(msg)) {
      return 'This PDF is password-protected. Remove the password and try again.';
    }
    return 'This PDF could not be read. It may be damaged.';
  }

  function loadPdf(bytes) {
    return PDFLib.PDFDocument.load(bytes.slice(0)).then(function (src) {
      if (src.isEncrypted) {
        throw new Error('This PDF is password-protected. Remove the password and try again.');
      }
      return src;
    }).catch(function (err) {
      if (err && /password-protected/.test(err.message)) throw err;
      throw new Error(friendlyPdfError(err));
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('Could not prepare a picture.'));
        else resolve(blob);
      }, type, quality);
    });
  }

  function hasAlpha(ctx, w, h) {
    var step = Math.max(1, Math.floor(Math.max(w, h) / 80));
    var data = ctx.getImageData(0, 0, w, h).data;
    var y, x, i;
    for (y = 0; y < h; y += step) {
      for (x = 0; x < w; x += step) {
        i = (y * w + x) * 4 + 3;
        if (data[i] < 250) return true;
      }
    }
    return false;
  }

  async function rasterize(image, crop, quality, forcePng) {
    var edgeCap = QUALITY_EDGE[quality] || 2400;
    var sw = crop.width;
    var sh = crop.height;
    var scale = Math.min(1, edgeCap / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale));
    var h = Math.max(1, Math.round(sh * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
    var png = forcePng || hasAlpha(ctx, w, h);
    var type = png ? 'image/png' : 'image/jpeg';
    var blob = await canvasToBlob(canvas, type, QUALITY_JPEG[quality] || 0.9);
    canvas.width = 0;
    canvas.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: type };
  }

  function fullCrop(crop, item) {
    return crop.x === 0 && crop.y === 0 && crop.width === item.width && crop.height === item.height;
  }

  async function imageBytesForEmbed(item, placement, quality) {
    var type = item.file.type;
    if (quality === 'original' && fullCrop(placement.crop, item) && (type === 'image/png' || type === 'image/jpeg')) {
      return {
        bytes: new Uint8Array(await item.file.arrayBuffer()),
        type: type === 'image/png' ? 'image/png' : 'image/jpeg'
      };
    }
    return rasterize(item.image, placement.crop, quality === 'original' ? 'high' : quality, false);
  }

  async function embedByType(pdf, bytes, type) {
    if (type === 'image/png') return pdf.embedPng(bytes);
    return pdf.embedJpg(bytes);
  }

  async function buildImagesPdf(items, settings, onProgress) {
    if (!items.length) throw new Error('Add at least one picture.');
    var pdf = await PDFLib.PDFDocument.create();
    stamp(pdf, settings.title || 'Images');
    var fit = settings.fit || 'contain';
    var i;
    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (onProgress) onProgress(i + 1, items.length, 'Building picture ' + (i + 1) + ' of ' + items.length + '…');
      try {
        var laid = layout(settings, { width: item.width, height: item.height }, fit);
        var page = pdf.addPage([laid.page.width, laid.page.height]);
        paintBackground(page, laid.page, settings.background);
        var prepared = await imageBytesForEmbed(item, laid.placement, settings.quality);
        var embedded;
        try {
          embedded = await embedByType(pdf, prepared.bytes, prepared.type);
        } catch (err) {
          var fallback = await rasterize(item.image, laid.placement.crop, settings.quality === 'original' ? 'high' : settings.quality, false);
          embedded = await embedByType(pdf, fallback.bytes, fallback.type);
        }
        page.drawImage(embedded, {
          x: laid.placement.x,
          y: laid.placement.y,
          width: laid.placement.width,
          height: laid.placement.height
        });
        paintFrame(page, laid.placement, settings);
      } catch (err) {
        if (err && err.message && /margin|page size|no size/i.test(err.message)) throw err;
        throw new Error('Could not add ' + item.name + '. Use a PNG or JPG and try again.');
      }
      await yieldToUi();
    }
    return { bytes: await pdf.save(), pageCount: items.length };
  }

  async function inspectPdf(bytes, measure) {
    var src = await loadPdf(bytes);
    var pageCount = src.getPageCount();
    if (!pageCount) throw new Error('This PDF has no pages.');
    var info = { pageCount: pageCount, width: 0, height: 0 };
    if (measure) {
      var page = src.getPages()[0];
      try {
        var probe = await PDFLib.PDFDocument.create();
        var embedded = await probe.embedPage(page);
        info.width = embedded.width;
        info.height = embedded.height;
      } catch (err) {
        var size = page.getSize();
        var angle = ((page.getRotation().angle % 360) + 360) % 360;
        info.width = size.width;
        info.height = size.height;
        if (angle === 90 || angle === 270) {
          info.width = size.height;
          info.height = size.width;
        }
      }
    }
    return info;
  }

  async function mergePdfs(files, onProgress) {
    if (!files.length) throw new Error('Add at least two PDFs.');
    var out = await PDFLib.PDFDocument.create();
    stamp(out, 'Merged');
    var total = 0;
    var i;
    for (i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i + 1, files.length, 'Adding file ' + (i + 1) + ' of ' + files.length + '…');
      var bytes = new Uint8Array(await files[i].arrayBuffer());
      var src = await loadPdf(bytes);
      var copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach(function (page) { out.addPage(page); });
      total += copied.length;
      await yieldToUi();
    }
    if (!total) throw new Error('Those PDFs have no pages.');
    return { bytes: await out.save(), pageCount: total };
  }

  async function resizePdf(bytes, settings, onProgress) {
    var src = await loadPdf(bytes);
    var pages = src.getPages();
    if (!pages.length) throw new Error('This PDF has no pages.');
    var out = await PDFLib.PDFDocument.create();
    stamp(out, settings.title || 'Resized');
    var fit = settings.fit === 'stretch' ? 'stretch' : 'contain';
    var i;
    for (i = 0; i < pages.length; i++) {
      if (onProgress) onProgress(i + 1, pages.length, 'Resizing page ' + (i + 1) + ' of ' + pages.length + '…');
      var embedded;
      try {
        embedded = await out.embedPage(pages[i]);
      } catch (err) {
        throw new Error('Page ' + (i + 1) + ' could not be resized. Merge keeps the original pages.');
      }
      var laid = layout(settings, { width: embedded.width, height: embedded.height }, fit);
      var page = out.addPage([laid.page.width, laid.page.height]);
      paintBackground(page, laid.page, settings.background);
      page.drawPage(embedded, {
        x: laid.placement.x,
        y: laid.placement.y,
        width: laid.placement.width,
        height: laid.placement.height
      });
      paintFrame(page, laid.placement, settings);
      await yieldToUi();
    }
    return { bytes: await out.save(), pageCount: pages.length };
  }

  function initPdfJs() {
    if (!window.pdfjsLib) throw new Error('The PNG exporter did not load. Open Folio with Start.command.');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
  }

  async function renderPdfPreview(bytes, maxEdge) {
    initPdfJs();
    var task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    var doc = await task.promise;
    try {
      var page = await doc.getPage(1);
      var unscaled = page.getViewport({ scale: 1 });
      var scale = maxEdge / Math.max(unscaled.width, unscaled.height);
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var blob = await canvasToBlob(canvas, 'image/jpeg', 0.86);
      page.cleanup();
      return {
        blob: blob,
        pageCount: doc.numPages,
        width: unscaled.width,
        height: unscaled.height
      };
    } finally {
      await doc.destroy();
    }
  }

  async function pdfToPngs(bytes, settings, onProgress) {
    initPdfJs();
    var task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    var doc = await task.promise;
    try {
      var from = Math.max(1, settings.from | 0);
      var to = Math.min(doc.numPages, settings.to | 0);
      if (to < from) throw new Error('Choose a page range inside this PDF.');
      var results = [];
      var n;
      for (n = from; n <= to; n++) {
        if (onProgress) onProgress(n - from + 1, to - from + 1, 'Rendering page ' + n + '…');
        var page = await doc.getPage(n);
        var viewport = page.getViewport({ scale: settings.dpi / 72 });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = settings.background || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var blob = await canvasToBlob(canvas, 'image/png');
        var head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        var sig = [137, 80, 78, 71, 13, 10, 26, 10];
        var ok = sig.every(function (b, index) { return head[index] === b; });
        if (!ok) throw new Error('PNG export failed on page ' + n + '.');
        results.push({
          name: settings.baseName + '-' + String(n).padStart(2, '0') + '.png',
          blob: blob,
          width: canvas.width,
          height: canvas.height
        });
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
        await yieldToUi();
      }
      return results;
    } finally {
      await doc.destroy();
    }
  }

  window.FolioEngine = {
    MM: MM,
    margins: margins,
    resolvePageSize: resolvePageSize,
    place: place,
    layout: layout,
    buildImagesPdf: buildImagesPdf,
    inspectPdf: inspectPdf,
    mergePdfs: mergePdfs,
    resizePdf: resizePdf,
    renderPdfPreview: renderPdfPreview,
    pdfToPngs: pdfToPngs,
    friendlyPdfError: friendlyPdfError
  };
})();
