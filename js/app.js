(function () {
  'use strict';

  var MAX_IMAGES = 20;
  var MAX_PDFS = 20;
  var MAX_PNG_PAGES = 40;

  var MODES = {
    images: {
      file: 'images.pdf',
      go: 'Make PDF',
      hint: 'The dashed line is the margin. It is not printed. A border is drawn only when thickness is above 0.'
    },
    merge: {
      file: 'merged.pdf',
      go: 'Merge PDFs',
      hint: 'Pages are copied in the order shown. They are not resized.'
    },
    resize: {
      file: 'resized.pdf',
      go: 'Apply size and border',
      hint: 'Keep original size to add a margin without shrinking the pages. Other sizes fit each page onto that paper.'
    },
    png: {
      file: 'pages',
      go: 'Export PNG',
      hint: 'One page downloads as a PNG. Several pages download as a zip. Change paper size under Size and border first if you need to.'
    }
  };

  var state = {
    mode: 'images',
    busy: false,
    images: [],
    merge: [],
    resize: null,
    png: null
  };

  var filenames = {
    images: 'images.pdf',
    merge: 'merged.pdf',
    resize: 'resized.pdf',
    png: 'pages'
  };

  var saveUrl = '';
  var toastTimer = 0;
  var paintQueued = false;

  var $ = function (id) { return document.getElementById(id); };

  function uid() {
    return window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function clamp(n, min, max, fallback) {
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function radioValue(name, fallback) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  }

  function isImage(file) {
    return /^image\/(png|jpeg|webp|gif)$/.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  }

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4600);
  }

  function setResult(message, kind) {
    var el = $('result');
    el.textContent = message || '';
    el.className = 'result' + (kind ? ' is-' + kind : '');
  }

  function readSettings() {
    var mode = state.mode;
    var pageSize = mode === 'resize' ? $('resizePageSize').value : $('imagePageSize').value;
    var allowed = mode === 'resize'
      ? ['original', 'a4', 'a3', 'a5', 'letter', 'legal', 'custom']
      : ['a4', 'a3', 'a5', 'letter', 'legal', 'image', 'custom'];
    if (allowed.indexOf(pageSize) === -1) pageSize = mode === 'resize' ? 'original' : 'a4';
    var fit = radioValue('fit', 'contain');
    if (['contain', 'fill', 'stretch'].indexOf(fit) === -1) fit = 'contain';
    if (mode === 'resize' && (fit === 'fill' || pageSize === 'original')) fit = 'contain';
    var quality = radioValue('quality', 'high');
    if (['high', 'medium', 'small', 'original'].indexOf(quality) === -1) quality = 'high';
    var orientation = radioValue('orientation', 'auto');
    if (['auto', 'portrait', 'landscape'].indexOf(orientation) === -1) orientation = 'auto';
    var dpi = parseInt(radioValue('dpi', '150'), 10);
    if ([72, 150, 300].indexOf(dpi) === -1) dpi = 150;
    return {
      pageSize: pageSize,
      orientation: orientation,
      customWidthMm: clamp(parseFloat($('customWidth').value), 40, 800, 210),
      customHeightMm: clamp(parseFloat($('customHeight').value), 40, 800, 297),
      marginTopMm: clamp(parseFloat($('marginTop').value), 0, 80, 12),
      marginRightMm: clamp(parseFloat($('marginRight').value), 0, 80, 12),
      marginBottomMm: clamp(parseFloat($('marginBottom').value), 0, 80, 12),
      marginLeftMm: clamp(parseFloat($('marginLeft').value), 0, 80, 12),
      framePt: clamp(parseFloat($('framePt').value), 0, 20, 0),
      frameColor: $('frameColor').value || '#241c16',
      fit: fit,
      background: $('background').value || '#ffffff',
      quality: quality,
      dpi: dpi,
      filename: $('filename').value,
      title: baseName($('filename').value)
    };
  }

  function baseName(name) {
    var clean = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'download';
    return clean.replace(/\.(pdf|png|zip)$/i, '');
  }

  function syncVisibility() {
    var mode = state.mode;
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== mode;
    });
    document.querySelectorAll('[data-modes]').forEach(function (el) {
      el.hidden = el.dataset.modes.split(' ').indexOf(mode) === -1;
    });
    document.querySelectorAll('[data-mode-btn]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.modeBtn === mode));
    });
    if (mode === 'images' || mode === 'resize') {
      var size = mode === 'resize' ? $('resizePageSize').value : $('imagePageSize').value;
      if (size === 'custom' || size === 'image' || size === 'original') $('orientationField').hidden = true;
      $('customSizeField').hidden = size !== 'custom';
      if (mode === 'resize' && size === 'original') $('fitField').hidden = true;
    }
    $('modeHint').textContent = MODES[mode].hint;
  }

  function updateGo() {
    var btn = $('go');
    var ok = false;
    if (state.mode === 'images') ok = state.images.length > 0;
    if (state.mode === 'merge') ok = state.merge.length >= 2;
    if (state.mode === 'resize') ok = !!state.resize;
    if (state.mode === 'png') ok = !!state.png;
    btn.disabled = state.busy || !ok;
    btn.textContent = state.busy ? 'Working…' : MODES[state.mode].go;
    $('clearImages').disabled = state.busy || state.images.length === 0;
    $('clearMerge').disabled = state.busy || state.merge.length === 0;
    $('clearResize').disabled = state.busy || !state.resize;
    $('clearPng').disabled = state.busy || !state.png;
  }

  function setBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle('is-busy', busy);
    if (!busy) {
      $('progress').hidden = true;
      $('progressBar').style.width = '0%';
    }
    updateGo();
  }

  function report(current, total, label) {
    setResult(label, '');
    $('progress').hidden = false;
    $('progressBar').style.width = Math.round((current / total) * 100) + '%';
  }

  function setMode(mode) {
    if (!MODES[mode] || state.busy) return;
    filenames[state.mode] = $('filename').value;
    state.mode = mode;
    $('filename').value = filenames[mode];
    setResult('', '');
    hideSaveLink();
    syncVisibility();
    updateGo();
    queuePaint();
  }

  function hideSaveLink() {
    if (saveUrl) URL.revokeObjectURL(saveUrl);
    saveUrl = '';
    $('saveLink').hidden = true;
    $('saveLink').removeAttribute('href');
  }

  function rememberDownload(blob, filename) {
    hideSaveLink();
    saveUrl = URL.createObjectURL(blob);
    var link = $('saveLink');
    link.href = saveUrl;
    link.download = filename;
    link.textContent = 'Download again';
    link.hidden = false;
    var a = document.createElement('a');
    a.href = saveUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        resolve({
          id: uid(),
          name: file.name,
          file: file,
          url: url,
          image: image,
          width: image.naturalWidth,
          height: image.naturalHeight
        });
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('unreadable'));
      };
      image.src = url;
    });
  }

  async function addImageFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var images = files.filter(isImage);
    var ignored = files.length - images.length;
    if (!images.length) {
      if (ignored) toast('Those files are not pictures. Use PNG, JPG, or WebP.');
      return { added: 0, limited: false };
    }
    var added = 0;
    var failed = [];
    var limited = false;
    var i;
    for (i = 0; i < images.length; i++) {
      if (state.images.length >= MAX_IMAGES) {
        limited = true;
        break;
      }
      try {
        state.images.push(await loadImage(images[i]));
        added += 1;
      } catch (err) {
        failed.push(images[i].name);
      }
    }
    renderImages();
    if (limited) toast('Twenty pictures is the limit for one PDF. Make a second PDF and merge them.');
    else if (failed.length) toast('Skipped ' + failed[0] + '. This browser could not read it.');
    else if (ignored) toast('Skipped a file that was not a picture.');
    return { added: added, limited: limited };
  }

  function renderImages() {
    var list = $('imageList');
    var count = state.images.length;
    $('imageCount').textContent = count + ' of ' + MAX_IMAGES + ' pictures';
    $('imageDrop').classList.toggle('compact', count > 0);
    list.innerHTML = state.images.map(function (item, index) {
      return (
        '<article class="thumb" draggable="true" data-id="' + item.id + '">' +
          '<img draggable="false" alt="Picture ' + (index + 1) + '" src="' + item.url + '">' +
          '<span class="badge">' + (index + 1) + '</span>' +
          '<p title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</p>' +
          '<div class="thumb-actions">' +
            '<button type="button" data-move="-1" aria-label="Move picture ' + (index + 1) + ' earlier"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" data-move="1" aria-label="Move picture ' + (index + 1) + ' later"' + (index === count - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" data-remove aria-label="Remove picture ' + (index + 1) + '">×</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');
    bindReorder(list, function (fromId, toId) {
      state.images = reorder(state.images, fromId, toId);
      renderImages();
    });
    updateGo();
    queuePaint();
  }

  async function addMergeFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(isPdf);
    if (!files.length) {
      if (fileList && fileList.length) toast('Drop PDF files to merge them.');
      return;
    }
    var limited = false;
    var i;
    for (i = 0; i < files.length; i++) {
      if (state.merge.length >= MAX_PDFS) {
        limited = true;
        break;
      }
      try {
        var bytes = new Uint8Array(await files[i].arrayBuffer());
        var info = await FolioEngine.inspectPdf(bytes, false);
        var previewUrl = '';
        var preview = null;
        try {
          var rendered = await FolioEngine.renderPdfPreview(bytes, 700);
          previewUrl = URL.createObjectURL(rendered.blob);
          preview = await loadUrl(previewUrl);
        } catch (previewErr) {
          previewUrl = '';
          preview = null;
        }
        state.merge.push({
          id: uid(),
          name: files[i].name,
          file: files[i],
          pageCount: info.pageCount,
          size: files[i].size,
          previewUrl: previewUrl,
          preview: preview
        });
        renderMerge();
      } catch (err) {
        toast(files[i].name + ' — ' + err.message);
      }
    }
    if (limited) toast('Twenty PDFs is the limit for one merge.');
  }

  function renderMerge() {
    var pages = state.merge.reduce(function (sum, item) { return sum + item.pageCount; }, 0);
    var count = state.merge.length;
    $('mergeCount').textContent = count
      ? count + ' files · ' + pages + (pages === 1 ? ' page' : ' pages')
      : '0 files';
    if (count === 1) $('mergeCount').textContent += ' · add one more PDF';
    $('mergeDrop').classList.toggle('compact', count > 0);
    $('mergeList').innerHTML = state.merge.map(function (item, index) {
      var picture = item.previewUrl
        ? '<img draggable="false" alt="First page of ' + escapeHtml(item.name) + '" src="' + item.previewUrl + '">'
        : '<div class="sheet-fallback" aria-hidden="true"></div>';
      return (
        '<article class="thumb" draggable="true" data-id="' + item.id + '">' +
          picture +
          '<span class="badge">' + (index + 1) + '</span>' +
          '<p title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</p>' +
          '<p class="meta">' + item.pageCount + (item.pageCount === 1 ? ' page' : ' pages') + ' · ' + formatBytes(item.size) + '</p>' +
          '<div class="thumb-actions">' +
            '<button type="button" data-move="-1" aria-label="Move file ' + (index + 1) + ' earlier"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" data-move="1" aria-label="Move file ' + (index + 1) + ' later"' + (index === count - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" data-remove aria-label="Remove ' + escapeHtml(item.name) + '">×</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');
    bindReorder($('mergeList'), function (fromId, toId) {
      state.merge = reorder(state.merge, fromId, toId);
      renderMerge();
    });
    updateGo();
    queuePaint();
  }

  async function setSinglePdf(slot, file) {
    if (!file) return;
    if (!isPdf(file)) {
      toast('Drop a PDF file.');
      return;
    }
    var bytes = new Uint8Array(await file.arrayBuffer());
    var info = await FolioEngine.inspectPdf(bytes, true);
    var preview = null;
    try {
      var rendered = await FolioEngine.renderPdfPreview(bytes, 900);
      var url = URL.createObjectURL(rendered.blob);
      preview = await loadUrl(url);
      preview.url = url;
    } catch (err) {
      preview = null;
    }
    var previous = state[slot];
    if (previous && previous.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    state[slot] = {
      name: file.name,
      file: file,
      bytes: bytes,
      pageCount: info.pageCount,
      size: file.size,
      width: info.width,
      height: info.height,
      preview: preview,
      previewUrl: preview ? preview.url : ''
    };
    if (slot === 'png') {
      var end = Math.min(info.pageCount, MAX_PNG_PAGES);
      $('pageFrom').value = '1';
      $('pageTo').value = String(end);
      $('pageFrom').max = String(info.pageCount);
      $('pageTo').max = String(info.pageCount);
      if (info.pageCount > MAX_PNG_PAGES) {
        toast('This PDF has ' + info.pageCount + ' pages. The range is the first ' + MAX_PNG_PAGES + '.');
      }
    }
    renderSingle(slot);
  }

  function loadUrl(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('preview')); };
      image.src = url;
    });
  }

  function renderSingle(slot) {
    var doc = state[slot];
    var countId = slot === 'resize' ? 'resizeCount' : 'pngCount';
    var cardId = slot === 'resize' ? 'resizeCard' : 'pngCard';
    var dropId = slot === 'resize' ? 'resizeDrop' : 'pngDrop';
    if (!doc) {
      $(countId).textContent = 'No PDF yet';
      $(cardId).innerHTML = '';
      $(dropId).classList.remove('compact');
    } else {
      $(countId).textContent = doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages') + ' · ' + formatBytes(doc.size);
      $(dropId).classList.add('compact');
      $(cardId).innerHTML =
        '<article class="row"><span class="badge">' + doc.pageCount + '</span><div><p class="name">' +
        escapeHtml(doc.name) + '</p><p class="meta">' +
        doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages') + ' · ' + formatBytes(doc.size) +
        '</p></div></article>';
    }
    updateGo();
    queuePaint();
  }

  function reorder(list, fromId, toId) {
    var copy = list.slice();
    var from = copy.findIndex(function (item) { return item.id === fromId; });
    if (from < 0 || fromId === toId) return list;
    var item = copy.splice(from, 1)[0];
    var to = copy.findIndex(function (entry) { return entry.id === toId; });
    if (to < 0) return list;
    copy.splice(to, 0, item);
    return copy;
  }

  function moveBy(list, id, delta) {
    var index = list.findIndex(function (item) { return item.id === id; });
    var next = index + delta;
    if (index < 0 || next < 0 || next >= list.length) return list;
    var copy = list.slice();
    var item = copy.splice(index, 1)[0];
    copy.splice(next, 0, item);
    return copy;
  }

  function bindReorder(container, onDrop) {
    container.querySelectorAll('[data-id]').forEach(function (card) {
      card.addEventListener('dragstart', function (event) {
        if (event.target.closest('button')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/plain', card.dataset.id);
        event.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', function () { card.classList.remove('is-dragging'); });
      card.addEventListener('dragover', function (event) {
        if (hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        card.classList.add('is-drop-target');
      });
      card.addEventListener('dragleave', function () { card.classList.remove('is-drop-target'); });
      card.addEventListener('drop', function (event) {
        card.classList.remove('is-drop-target');
        if (hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onDrop(event.dataTransfer.getData('text/plain'), card.dataset.id);
      });
    });
  }

  function hasFiles(event) {
    return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
  }

  function wireListClicks(container, getList, setList) {
    container.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button || state.busy) return;
      var card = button.closest('[data-id]');
      if (!card) return;
      var id = card.dataset.id;
      if (button.hasAttribute('data-remove')) {
        var removed = getList().filter(function (item) { return item.id === id; });
        removed.forEach(function (item) {
          if (item.url) URL.revokeObjectURL(item.url);
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        setList(getList().filter(function (item) { return item.id !== id; }));
      } else if (button.dataset.move) {
        setList(moveBy(getList(), id, Number(button.dataset.move)));
      }
    });
  }

  function clearImages() {
    state.images.forEach(function (item) { URL.revokeObjectURL(item.url); });
    state.images = [];
    renderImages();
  }

  function clearMerge() {
    state.merge.forEach(function (item) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.merge = [];
    renderMerge();
  }

  function clearSlot(slot) {
    var doc = state[slot];
    if (doc && doc.previewUrl) URL.revokeObjectURL(doc.previewUrl);
    state[slot] = null;
    renderSingle(slot);
  }

  function queuePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(function () {
      paintQueued = false;
      paintPreview();
    });
  }

  function paintPreview() {
    var canvas = $('preview');
    var meta = $('previewMeta');
    var cssW = canvas.clientWidth || 280;
    if (!cssW) return;
    var settings = readSettings();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var ctx = canvas.getContext('2d');

    if (state.mode === 'merge') {
      var totalPages = state.merge.reduce(function (sum, item) { return sum + item.pageCount; }, 0);
      var first = state.merge[0];
      if (first && first.preview) {
        drawPicturePage(canvas, ctx, cssW, dpr, first.preview, '#ffffff');
        meta.textContent = 'First page of ' + first.name + '. ' + totalPages + (totalPages === 1 ? ' page stays' : ' pages stay') + ' the same size.';
      } else {
        drawStack(canvas, ctx, cssW, dpr, totalPages);
        meta.textContent = state.merge.length
          ? 'Pages stay the size they already are.'
          : 'Add two PDFs. Merged pages keep their original size.';
      }
      return;
    }

    if (state.mode === 'png') {
      var pngDoc = state.png;
      if (!pngDoc || !pngDoc.preview) {
        drawBlank(canvas, ctx, cssW, dpr, 210 * FolioEngine.MM, 297 * FolioEngine.MM, '#ffffff');
        meta.textContent = 'Add a PDF to see the first page.';
        return;
      }
      var scale = settings.dpi / 72;
      var pxW = Math.round(pngDoc.width * scale);
      var pxH = Math.round(pngDoc.height * scale);
      drawPicturePage(canvas, ctx, cssW, dpr, pngDoc.preview, '#ffffff');
      meta.textContent = settings.dpi + ' dpi · about ' + pxW + ' × ' + pxH + ' px · pages ' +
        ($('pageFrom').value || '1') + '–' + ($('pageTo').value || '1');
      return;
    }

    var subject = currentSubject();
    if (!subject) {
      var emptyPage = FolioEngine.resolvePageSize(settings, { width: 800, height: 1100 });
      if (settings.pageSize === 'image' || settings.pageSize === 'original') {
        emptyPage = { width: 210 * FolioEngine.MM, height: 297 * FolioEngine.MM };
      }
      drawBlank(canvas, ctx, cssW, dpr, emptyPage.width, emptyPage.height, settings.background);
      meta.textContent = state.mode === 'images'
        ? 'Add a picture to preview the page.'
        : 'Add a PDF to preview the new page.';
      return;
    }

    var page;
    var placement = null;
    var error = '';
    try {
      var laid = FolioEngine.layout(settings, { width: subject.layoutWidth, height: subject.layoutHeight }, settings.fit);
      page = laid.page;
      placement = laid.placement;
    } catch (err) {
      error = err.message;
      page = FolioEngine.resolvePageSize(settings, { width: subject.layoutWidth, height: subject.layoutHeight });
    }

    var cssH = cssW * (page.height / page.width);
    prepareCanvas(canvas, cssW, cssH, dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, cssW, cssH);
    var view = cssW / page.width;
    if (placement && subject.image) {
      var dx = placement.x * view;
      var dy = (page.height - placement.y - placement.height) * view;
      var dw = placement.width * view;
      var dh = placement.height * view;
      if (subject.useCrop) {
        var crop = placement.crop;
        ctx.drawImage(subject.image, crop.x, crop.y, crop.width, crop.height, dx, dy, dw, dh);
      } else {
        ctx.drawImage(subject.image, dx, dy, dw, dh);
      }
      if (settings.framePt > 0) {
        ctx.strokeStyle = settings.frameColor;
        ctx.lineWidth = Math.max(1, settings.framePt * view);
        ctx.strokeRect(dx, dy, dw, dh);
      }
    }
    var m = FolioEngine.margins(settings);
    ctx.save();
    ctx.strokeStyle = '#c4491d';
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(m.left * view + 1, m.top * view + 1, Math.max(0, (page.width - m.left - m.right) * view - 2), Math.max(0, (page.height - m.top - m.bottom) * view - 2));
    ctx.restore();

    var mmW = page.width / FolioEngine.MM;
    var mmH = page.height / FolioEngine.MM;
    var label = (Math.round(mmW * 10) / 10) + ' × ' + (Math.round(mmH * 10) / 10) + ' mm';
    if (state.mode === 'images') label = 'Page 1 of ' + state.images.length + ' · ' + label;
    if (Math.max(mmW, mmH) > 500) label += '. That is a large sheet. A4 is the usual paper size.';
    meta.textContent = error || label;
  }

  function currentSubject() {
    if (state.mode === 'images' && state.images.length) {
      var item = state.images[0];
      return {
        image: item.image,
        layoutWidth: item.width,
        layoutHeight: item.height,
        useCrop: true
      };
    }
    if (state.mode === 'resize' && state.resize) {
      return {
        image: state.resize.preview,
        layoutWidth: state.resize.width,
        layoutHeight: state.resize.height,
        useCrop: false
      };
    }
    return null;
  }

  function prepareCanvas(canvas, cssW, cssH, dpr) {
    canvas.style.height = cssH + 'px';
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
  }

  function drawBlank(canvas, ctx, cssW, dpr, pageW, pageH, color) {
    var cssH = cssW * (pageH / pageW);
    prepareCanvas(canvas, cssW, cssH, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function drawPicturePage(canvas, ctx, cssW, dpr, image, color) {
    var cssH = cssW * (image.naturalHeight / image.naturalWidth);
    prepareCanvas(canvas, cssW, cssH, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.drawImage(image, 0, 0, cssW, cssH);
  }

  function drawStack(canvas, ctx, cssW, dpr, pages) {
    var cssH = cssW * 0.72;
    prepareCanvas(canvas, cssW, cssH, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var sheets = Math.max(1, Math.min(3, pages || 1));
    var i;
    for (i = sheets - 1; i >= 0; i--) {
      var x = 18 + i * 10;
      var y = 16 + (sheets - 1 - i) * 8;
      var w = cssW - 56;
      var h = cssH - 42;
      ctx.fillStyle = i === 0 ? '#fffaf3' : '#f0e4d4';
      ctx.strokeStyle = 'rgba(36,28,22,0.18)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.fillStyle = '#241c16';
    ctx.font = '16px Palatino, Georgia, serif';
    ctx.fillText(pages ? pages + (pages === 1 ? ' page' : ' pages') : 'No pages yet', 34, cssH * 0.48);
  }

  function addIncoming(files) {
    if (state.busy || !files.length) return;
    if (state.mode === 'images') return addImageFiles(files);
    if (state.mode === 'merge') return addMergeFiles(files);
    if (state.mode === 'resize') return setSinglePdf('resize', files[0]).catch(showError);
    return setSinglePdf('png', files[0]).catch(showError);
  }

  function showError(err) {
    setBusy(false);
    setResult(err && err.message ? err.message : 'Something went wrong.', 'error');
  }

  async function go(event) {
    if (event) event.preventDefault();
    if (state.busy || $('go').disabled) return;
    hideSaveLink();
    setBusy(true);
    try {
      var settings = readSettings();
      if (state.mode === 'images') await makeImages(settings);
      else if (state.mode === 'merge') await makeMerge(settings);
      else if (state.mode === 'resize') await makeResize(settings);
      else await makePng(settings);
    } catch (err) {
      setResult(err && err.message ? err.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function makeImages(settings) {
    var result = await FolioEngine.buildImagesPdf(state.images, settings, report);
    var name = baseName(settings.filename) + '.pdf';
    var blob = new Blob([result.bytes], { type: 'application/pdf' });
    rememberDownload(blob, name);
    setResult('PDF ready. ' + result.pageCount + ' ' + (result.pageCount === 1 ? 'page' : 'pages') + ', ' + formatBytes(result.bytes.byteLength) + '.', 'ok');
  }

  async function makeMerge(settings) {
    var result = await FolioEngine.mergePdfs(state.merge.map(function (item) { return item.file; }), report);
    var name = baseName(settings.filename) + '.pdf';
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), name);
    setResult('Merged PDF ready. ' + result.pageCount + ' ' + (result.pageCount === 1 ? 'page' : 'pages') + ', ' + formatBytes(result.bytes.byteLength) + '.', 'ok');
  }

  async function makeResize(settings) {
    var result = await FolioEngine.resizePdf(state.resize.bytes, settings, report);
    var name = baseName(settings.filename) + '.pdf';
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), name);
    setResult('Resized PDF ready. ' + result.pageCount + ' ' + (result.pageCount === 1 ? 'page' : 'pages') + ', ' + formatBytes(result.bytes.byteLength) + '.', 'ok');
  }

  async function makePng(settings) {
    var pageCount = state.png.pageCount;
    var from = clamp(parseInt($('pageFrom').value, 10), 1, pageCount, 1);
    var to = clamp(parseInt($('pageTo').value, 10), 1, pageCount, pageCount);
    if (to < from) {
      var swap = from;
      from = to;
      to = swap;
    }
    var clipped = false;
    if (to - from + 1 > MAX_PNG_PAGES) {
      to = from + MAX_PNG_PAGES - 1;
      clipped = true;
    }
    $('pageFrom').value = String(from);
    $('pageTo').value = String(to);
    var parts = await FolioEngine.pdfToPngs(state.png.bytes, {
      dpi: settings.dpi,
      from: from,
      to: to,
      background: settings.background,
      baseName: baseName(settings.filename)
    }, report);
    if (parts.length === 1) {
      rememberDownload(parts[0].blob, parts[0].name);
      setResult('PNG ready. ' + parts[0].width + ' × ' + parts[0].height + ' px, ' + formatBytes(parts[0].blob.size) + '.', 'ok');
      return;
    }
    if (!window.JSZip) throw new Error('The zip tool did not load.');
    var zip = new JSZip();
    parts.forEach(function (part) { zip.file(part.name, part.blob); });
    var blob = await zip.generateAsync({ type: 'blob' });
    rememberDownload(blob, baseName(settings.filename) + '.zip');
    var message = 'PNG zip ready. ' + parts.length + ' pictures, ' + formatBytes(blob.size) + '.';
    if (clipped) message += ' Forty pages is the limit for one export.';
    setResult(message, 'ok');
  }

  function wireDrop(drop, input) {
    drop.addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      input.click();
    });
    drop.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      addIncoming(files);
    });
  }

  function wireMargins() {
    var inputs = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].map($);
    inputs.forEach(function (input) {
      input.addEventListener('input', function () {
        if ($('lockMargins').checked) {
          inputs.forEach(function (other) {
            if (other !== input) other.value = input.value;
          });
        }
        queuePaint();
      });
    });
  }

  async function blobFromCanvas(canvas, type) {
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, type); });
    if (!blob) throw new Error('Could not make a sample file.');
    return blob;
  }

  async function sampleImages() {
    var specs = [
      ['sample-portrait.png', 900, 1200, '#c4491d', '#fffaf3', '01', 'Portrait'],
      ['sample-landscape.png', 1400, 900, '#3d4a38', '#f4ecdf', '02', 'Landscape'],
      ['sample-square.png', 1000, 1000, '#f4ecdf', '#241c16', '03', 'Square'],
      ['sample-ink.png', 1000, 1400, '#241c16', '#f4ecdf', '04', 'Ink']
    ];
    var files = [];
    var i;
    for (i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var canvas = document.createElement('canvas');
      canvas.width = spec[1];
      canvas.height = spec[2];
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = spec[3];
      ctx.fillRect(0, 0, spec[1], spec[2]);
      ctx.fillStyle = spec[4];
      ctx.fillRect(56, 64, spec[1] - 112, 16);
      ctx.font = '72px Palatino, Georgia, serif';
      ctx.fillText(spec[5], 64, spec[2] * 0.56);
      ctx.font = '32px Avenir Next, Segoe UI, sans-serif';
      ctx.fillText(spec[6], 64, spec[2] * 0.56 + 52);
      files.push(new File([await blobFromCanvas(canvas, 'image/png')], spec[0], { type: 'image/png' }));
    }
    await addImageFiles(files);
  }

  async function samplePdf(name, pages) {
    var doc = await PDFLib.PDFDocument.create();
    var font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var i;
    for (i = 0; i < pages.length; i++) {
      var page = doc.addPage([420, 595]);
      var color = pages[i];
      page.drawRectangle({ x: 0, y: 0, width: 420, height: 595, color: PDFLib.rgb(color[0], color[1], color[2]) });
      page.drawText(name + ' ' + (i + 1), {
        x: 48,
        y: 290,
        size: 32,
        font: font,
        color: PDFLib.rgb(1, 1, 1)
      });
    }
    var bytes = await doc.save();
    return new File([bytes], name.toLowerCase().replace(/\s+/g, '-') + '.pdf', { type: 'application/pdf' });
  }

  async function sampleMerge() {
    var a = await samplePdf('Sample A', [[0.77, 0.29, 0.11]]);
    var b = await samplePdf('Sample B', [[0.24, 0.29, 0.22], [0.14, 0.11, 0.09]]);
    await addMergeFiles([a, b]);
  }

  function init() {
    if (!window.PDFLib) {
      setResult('The PDF library did not load. Open this folder with Start.command.', 'error');
      return;
    }
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    document.querySelectorAll('[data-mode-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.modeBtn); });
    });
    $('settingsForm').addEventListener('submit', go);
    $('settingsForm').addEventListener('input', queuePaint);
    $('settingsForm').addEventListener('change', queuePaint);
    wireMargins();
    wireDrop($('imageDrop'), $('imageInput'));
    wireDrop($('mergeDrop'), $('mergeInput'));
    wireDrop($('resizeDrop'), $('resizeInput'));
    wireDrop($('pngDrop'), $('pngInput'));
    $('browseImages').addEventListener('click', function () { $('imageInput').click(); });
    $('browseMerge').addEventListener('click', function () { $('mergeInput').click(); });
    $('browseResize').addEventListener('click', function () { $('resizeInput').click(); });
    $('browsePng').addEventListener('click', function () { $('pngInput').click(); });
    $('sampleImages').addEventListener('click', function () { sampleImages().catch(showError); });
    $('sampleMerge').addEventListener('click', function () { sampleMerge().catch(showError); });
    $('sampleResize').addEventListener('click', function () {
      samplePdf('Border sample', [[0.77, 0.29, 0.11]]).then(function (file) {
        return setSinglePdf('resize', file);
      }).catch(showError);
    });
    $('samplePng').addEventListener('click', function () {
      samplePdf('Pages', [[0.24, 0.29, 0.22], [0.77, 0.29, 0.11]]).then(function (file) {
        return setSinglePdf('png', file);
      }).catch(showError);
    });
    $('clearImages').addEventListener('click', clearImages);
    $('clearMerge').addEventListener('click', clearMerge);
    $('clearResize').addEventListener('click', function () { clearSlot('resize'); });
    $('clearPng').addEventListener('click', function () { clearSlot('png'); });
    wireListClicks($('imageList'), function () { return state.images; }, function (list) {
      state.images = list;
      renderImages();
    });
    wireListClicks($('mergeList'), function () { return state.merge; }, function (list) {
      state.merge = list;
      renderMerge();
    });
    window.addEventListener('dragover', function (event) {
      event.preventDefault();
      var zone = document.querySelector('[data-panel="' + state.mode + '"] .drop');
      if (zone) zone.classList.toggle('is-dragover', hasFiles(event));
    });
    window.addEventListener('drop', function (event) {
      event.preventDefault();
      document.querySelectorAll('.drop').forEach(function (zone) { zone.classList.remove('is-dragover'); });
      var files = event.dataTransfer ? Array.prototype.slice.call(event.dataTransfer.files || []) : [];
      if (!files.length) return;
      if ((state.mode === 'resize' || state.mode === 'png') && files.length > 1) {
        toast('Using the first PDF.');
      }
      addIncoming(files);
    });
    window.addEventListener('resize', queuePaint);
    if (window.ResizeObserver) new ResizeObserver(queuePaint).observe(document.querySelector('.preview-wrap'));
    syncVisibility();
    updateGo();
    queuePaint();
    if (location.protocol === 'file:') {
      $('fileHint').textContent = 'Pictures, merge, and page size work from this file. For PDF to PNG, double-click Start.command in this folder.';
    }
  }

  window.FolioApp = {
    get images() { return state.images; },
    get merge() { return state.merge; },
    get resize() { return state.resize; },
    get png() { return state.png; },
    readSettings: readSettings,
    addImageFiles: addImageFiles,
    addMergeFiles: addMergeFiles,
    setMode: setMode,
    clearImages: clearImages
  };

  init();
})();
