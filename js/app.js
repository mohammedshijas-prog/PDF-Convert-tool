(function () {
  'use strict';

  var MAX_IMAGES = 20;
  var MAX_PDFS = 20;
  var MAX_PNG_PAGES = 40;

  var MODES = {
    home: { file: 'images.pdf', go: 'Make PDF', hint: '' },
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
    split: {
      file: 'split.pdf',
      go: 'Split PDF',
      hint: 'Every page downloads as its own PDF inside a zip. A page range downloads as one PDF.'
    },
    compress: {
      file: 'compressed.pdf',
      go: 'Compress PDF',
      hint: 'Keep text repacks the file. Balanced and Smallest turn pages into pictures, which shrinks scans.'
    },
    toword: {
      file: 'document.docx',
      go: 'Convert to Word',
      hint: 'Selectable text is copied into a Word document. A scan without text cannot be edited.'
    },
    toppt: {
      file: 'slides.pptx',
      go: 'Convert to PowerPoint',
      hint: 'Each page becomes one slide.'
    },
    toexcel: {
      file: 'sheet.xlsx',
      go: 'Convert to Excel',
      hint: 'Each line of text becomes a row. Wide gaps become new columns.'
    },
    fromword: {
      file: 'document.pdf',
      go: 'Convert to PDF',
      hint: 'DOCX text is placed on A4 pages. Older DOC files need to be saved as DOCX first.'
    },
    fromppt: {
      file: 'slides.pdf',
      go: 'Convert to PDF',
      hint: 'Each slide becomes a PDF page. Pictures on the slide are kept.'
    },
    fromexcel: {
      file: 'sheet.pdf',
      go: 'Convert to PDF',
      hint: 'The first sheet is drawn as a table. Older XLS files need to be saved as XLSX first.'
    },
    edit: {
      file: 'edited.pdf',
      go: 'Save PDF',
      hint: 'Click the page for text or a picture. Drag for a shape or a freehand line.'
    },
    png: {
      file: 'pages.jpg',
      go: 'Export JPG',
      hint: 'One page downloads as a picture. Several pages download as a zip.'
    },
    resize: {
      file: 'resized.pdf',
      go: 'Apply size and border',
      hint: 'Keep original size to add a margin without shrinking the pages. Other sizes fit each page onto that paper.'
    }
  };

  var SLOTS = {
    resize: { count: 'resizeCount', card: 'resizeCard', drop: 'resizeDrop', empty: 'No PDF yet' },
    png: { count: 'pngCount', card: 'pngCard', drop: 'pngDrop', empty: 'No PDF yet', range: ['pageFrom', 'pageTo'] },
    split: { count: 'splitCount', card: 'splitCard', drop: 'splitDrop', empty: 'No PDF yet', range: ['splitFrom', 'splitTo'] },
    compress: { count: 'compressCount', card: 'compressCard', drop: 'compressDrop', empty: 'No PDF yet' },
    toword: { count: 'towordCount', card: 'towordCard', drop: 'towordDrop', empty: 'No PDF yet' },
    toppt: { count: 'topptCount', card: 'topptCard', drop: 'topptDrop', empty: 'No PDF yet' },
    toexcel: { count: 'toexcelCount', card: 'toexcelCard', drop: 'toexcelDrop', empty: 'No PDF yet' },
    edit: { count: 'editCount', card: 'editCard', drop: 'editDrop', empty: 'No PDF yet' },
    fromword: { count: 'fromwordCount', card: 'fromwordCard', drop: 'fromwordDrop', empty: 'No document yet', office: true },
    fromppt: { count: 'frompptCount', card: 'frompptCard', drop: 'frompptDrop', empty: 'No presentation yet', office: true },
    fromexcel: { count: 'fromexcelCount', card: 'fromexcelCard', drop: 'fromexcelDrop', empty: 'No spreadsheet yet', office: true }
  };

  var state = {
    mode: 'home',
    busy: false,
    images: [],
    merge: [],
    resize: null,
    png: null,
    split: null,
    compress: null,
    toword: null,
    toppt: null,
    toexcel: null,
    fromword: null,
    fromppt: null,
    fromexcel: null,
    edit: null
  };

  var filenames = {
    home: 'images.pdf',
    images: 'images.pdf',
    merge: 'merged.pdf',
    split: 'split.pdf',
    compress: 'compressed.pdf',
    toword: 'document.docx',
    toppt: 'slides.pptx',
    toexcel: 'sheet.xlsx',
    fromword: 'document.pdf',
    fromppt: 'slides.pdf',
    fromexcel: 'sheet.pdf',
    edit: 'edited.pdf',
    png: 'pages.jpg',
    resize: 'resized.pdf'
  };

  var editor = {
    tool: 'text',
    page: 1,
    marks: [],
    drag: null,
    image: null
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
      marginTopMm: marginMm(),
      marginRightMm: marginMm(),
      marginBottomMm: marginMm(),
      marginLeftMm: marginMm(),
      framePt: marginChoice() === 'none' ? 0 : clamp(parseFloat($('framePt').value), 0, 20, 0),
      frameColor: $('frameColor').value || '#5b21b6',
      fit: fit,
      background: $('background').value || '#ffffff',
      quality: quality,
      dpi: dpi,
      filename: $('filename').value,
      title: baseName($('filename').value),
      imageFormat: radioValue('imageFormat', 'jpeg') === 'png' ? 'png' : 'jpeg',
      splitMode: radioValue('splitMode', 'each') === 'range' ? 'range' : 'each',
      compressLevel: radioValue('compressLevel', 'balanced')
    };
  }

  function marginChoice() {
    var choice = radioValue('marginSize', 'small');
    if (choice !== 'none' && choice !== 'big') return 'small';
    return choice;
  }

  function marginMm() {
    var choice = marginChoice();
    if (choice === 'none') return 0;
    if (choice === 'big') return 20;
    return 8;
  }

  function baseName(name) {
    var clean = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'download';
    return clean.replace(/\.(pdf|png|jpe?g|zip|docx|pptx|xlsx)$/i, '');
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
      $('borderField').hidden = marginChoice() === 'none';
    }
    if (mode === 'split' && $('splitRange')) {
      $('splitRange').hidden = radioValue('splitMode', 'each') !== 'range';
    }
    document.body.classList.toggle('is-home', mode === 'home');
    $('backHome').hidden = mode === 'home';
    $('modeHint').textContent = MODES[mode].hint;
  }

  function updateGo() {
    var btn = $('go');
    var mode = state.mode;
    var ok = false;
    if (mode === 'images') ok = state.images.length > 0;
    else if (mode === 'merge') ok = state.merge.length >= 2;
    else if (mode === 'edit') ok = !!(state.edit && editor.marks.length);
    else if (SLOTS[mode]) ok = !!state[mode];
    var label = MODES[mode].go;
    if (mode === 'png') label = readSettings().imageFormat === 'png' ? 'Export PNG' : 'Export JPG';
    btn.disabled = state.busy || !ok;
    btn.textContent = state.busy ? 'Working…' : label;
    document.querySelectorAll('[data-clear]').forEach(function (button) {
      var key = button.dataset.clear;
      var empty = key === 'images' ? state.images.length === 0 : key === 'merge' ? state.merge.length === 0 : !state[key];
      button.disabled = state.busy || empty;
    });
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
    if (limited) toast('Only 20 pictures can go in one PDF.');
    else if (failed.length) toast('Skipped ' + failed[0] + '. This browser could not read it.');
    else if (ignored) toast('Skipped a file that was not a picture.');
    return { added: added, limited: limited };
  }

  function renderImages() {
    var list = $('imageList');
    var count = state.images.length;
    $('imageCount').textContent = count + (count === 1 ? ' picture' : ' pictures');
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
    if (previous && previous.handle) previous.handle.destroy();
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
    var range = SLOTS[slot] && SLOTS[slot].range;
    if (range) {
      var end = Math.min(info.pageCount, MAX_PNG_PAGES);
      $(range[0]).value = '1';
      $(range[1]).value = String(end);
      $(range[0]).max = String(info.pageCount);
      $(range[1]).max = String(info.pageCount);
      if (info.pageCount > MAX_PNG_PAGES && slot === 'png') {
        toast('This PDF has ' + info.pageCount + ' pages. The range is the first ' + MAX_PNG_PAGES + '.');
      }
    }
    if (slot === 'edit') prepareEditor();
    renderSlot(slot);
  }

  function setOfficeFile(slot, file) {
    if (!file) return;
    var ok = slot === 'fromword' ? /\.docx?$/i.test(file.name)
      : slot === 'fromppt' ? /\.pptx?$/i.test(file.name)
        : /\.xlsx?$/i.test(file.name);
    if (!ok) {
      toast('That file is not the right type for this tool.');
      return;
    }
    state[slot] = { name: file.name, file: file, size: file.size };
    renderSlot(slot);
  }

  function loadUrl(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('preview')); };
      image.src = url;
    });
  }

  function renderSlot(slot) {
    var ui = SLOTS[slot];
    var doc = state[slot];
    if (!doc) {
      $(ui.count).textContent = ui.empty;
      $(ui.card).innerHTML = '';
      $(ui.drop).classList.remove('compact');
    } else if (ui.office) {
      $(ui.count).textContent = formatBytes(doc.size);
      $(ui.drop).classList.add('compact');
      $(ui.card).innerHTML =
        '<article class="row"><span class="badge">1</span><div><p class="name">' +
        escapeHtml(doc.name) + '</p><p class="meta">' + formatBytes(doc.size) + '</p></div></article>';
    } else {
      var picture = doc.previewUrl
        ? '<img alt="" src="' + doc.previewUrl + '">'
        : '';
      $(ui.count).textContent = doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages') + ' · ' + formatBytes(doc.size);
      $(ui.drop).classList.add('compact');
      $(ui.card).innerHTML =
        '<article class="row' + (picture ? ' has-preview' : '') + '">' + picture +
        '<div><p class="name">' + escapeHtml(doc.name) + '</p><p class="meta">' +
        doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages') + ' · ' + formatBytes(doc.size) +
        '</p></div></article>';
    }
    if (slot === 'edit' && $('editStage')) $('editStage').hidden = !doc;
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
    if (doc && doc.handle) doc.handle.destroy();
    state[slot] = null;
    if (slot === 'edit') {
      editor.marks = [];
      editor.page = 1;
      editor.drag = null;
    }
    renderSlot(slot);
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

    if (state.mode === 'png' || state.mode === 'split' || state.mode === 'compress' || state.mode === 'toword' || state.mode === 'toppt' || state.mode === 'toexcel') {
      var pngDoc = state[state.mode];
      if (!pngDoc || !pngDoc.preview) {
        drawBlank(canvas, ctx, cssW, dpr, 210 * FolioEngine.MM, 297 * FolioEngine.MM, '#ffffff');
        meta.textContent = 'Add a PDF to see the first page.';
        return;
      }
      drawPicturePage(canvas, ctx, cssW, dpr, pngDoc.preview, '#ffffff');
      if (state.mode === 'png') {
        var scale = settings.dpi / 72;
        meta.textContent = (settings.imageFormat === 'png' ? 'PNG' : 'JPG') + ' · ' + settings.dpi + ' dpi · about ' +
          Math.round(pngDoc.width * scale) + ' × ' + Math.round(pngDoc.height * scale) + ' px · pages ' +
          ($('pageFrom').value || '1') + '–' + ($('pageTo').value || '1');
      } else {
        meta.textContent = pngDoc.name + ' · ' + pngDoc.pageCount + (pngDoc.pageCount === 1 ? ' page' : ' pages');
      }
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
    if (m.top + m.right + m.bottom + m.left > 0) {
      ctx.save();
      ctx.strokeStyle = '#6d28d9';
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(m.left * view + 1, m.top * view + 1, Math.max(0, (page.width - m.left - m.right) * view - 2), Math.max(0, (page.height - m.top - m.bottom) * view - 2));
      ctx.restore();
    }

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
      ctx.fillStyle = i === 0 ? '#ffffff' : '#f3eefb';
      ctx.strokeStyle = 'rgba(76,29,149,0.18)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.fillStyle = '#241433';
    ctx.font = '16px Palatino, Georgia, serif';
    ctx.fillText(pages ? pages + (pages === 1 ? ' page' : ' pages') : 'No pages yet', 34, cssH * 0.48);
  }

  function addIncoming(files) {
    if (state.busy || !files.length || state.mode === 'home') return;
    if (state.mode === 'images') return addImageFiles(files);
    if (state.mode === 'merge') return addMergeFiles(files);
    var slot = SLOTS[state.mode];
    if (!slot) return;
    if (slot.office) return setOfficeFile(state.mode, files[0]);
    if ((state.mode !== 'merge' && state.mode !== 'images') && files.length > 1) toast('Using the first file.');
    return setSinglePdf(state.mode, files[0]).catch(showError);
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
      else if (state.mode === 'split') await makeSplit(settings);
      else if (state.mode === 'compress') await makeCompress(settings);
      else if (state.mode === 'toword') await makeToWord(settings);
      else if (state.mode === 'toppt') await makeToPpt(settings);
      else if (state.mode === 'toexcel') await makeToExcel(settings);
      else if (state.mode === 'fromword') await makeFromWord(settings);
      else if (state.mode === 'fromppt') await makeFromPpt(settings);
      else if (state.mode === 'fromexcel') await makeFromExcel(settings);
      else if (state.mode === 'edit') await makeEdit(settings);
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
    var picture = settings.imageFormat === 'png' ? 'PNG' : 'JPG';
    var parts = await FolioEngine.pdfToImages(state.png.bytes, {
      dpi: settings.dpi,
      from: from,
      to: to,
      background: settings.background,
      baseName: baseName(settings.filename),
      mime: settings.imageFormat === 'png' ? 'image/png' : 'image/jpeg',
      jpegQuality: settings.dpi >= 300 ? 0.9 : 0.86
    }, report);
    if (parts.length === 1) {
      rememberDownload(parts[0].blob, parts[0].name);
      setResult(picture + ' ready. ' + parts[0].width + ' × ' + parts[0].height + ' px, ' + formatBytes(parts[0].blob.size) + '.', 'ok');
      return;
    }
    if (!window.JSZip) throw new Error('The zip tool did not load.');
    var zip = new JSZip();
    parts.forEach(function (part) { zip.file(part.name, part.blob); });
    var blob = await zip.generateAsync({ type: 'blob' });
    rememberDownload(blob, baseName(settings.filename) + '.zip');
    var message = picture + ' zip ready. ' + parts.length + ' pictures, ' + formatBytes(blob.size) + '.';
    if (clipped) message += ' Forty pages is the limit for one export.';
    setResult(message, 'ok');
  }

  async function zipParts(parts, filename) {
    if (!window.JSZip) throw new Error('The zip tool did not load.');
    var zip = new JSZip();
    parts.forEach(function (part) { zip.file(part.name, part.bytes); });
    return zip.generateAsync({ type: 'blob' });
  }

  async function makeSplit(settings) {
    var pageCount = state.split.pageCount;
    var from = clamp(parseInt($('splitFrom').value, 10), 1, pageCount, 1);
    var to = clamp(parseInt($('splitTo').value, 10), 1, pageCount, pageCount);
    if (to < from) {
      var swap = from;
      from = to;
      to = swap;
    }
    var result = await FolioEngine.splitPdf(state.split.bytes, {
      mode: settings.splitMode,
      from: from,
      to: to,
      baseName: baseName(settings.filename)
    }, report);
    if (result.parts.length === 1) {
      rememberDownload(new Blob([result.parts[0].bytes], { type: 'application/pdf' }), result.parts[0].name);
      setResult('PDF ready. ' + formatBytes(result.parts[0].bytes.byteLength) + '.', 'ok');
      return;
    }
    var blob = await zipParts(result.parts, settings.filename);
    rememberDownload(blob, baseName(settings.filename) + '.zip');
    var message = 'Split ready. ' + result.parts.length + ' PDFs, ' + formatBytes(blob.size) + '.';
    if (result.limited) message += ' The first 40 pages were saved.';
    setResult(message, 'ok');
  }

  async function makeCompress(settings) {
    var result = await FolioEngine.compressPdf(state.compress.bytes, {
      level: settings.compressLevel,
      title: baseName(settings.filename)
    }, report);
    var name = baseName(settings.filename) + '.pdf';
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), name);
    var before = state.compress.size;
    var after = result.bytes.byteLength;
    var message = result.smaller
      ? 'Compressed PDF ready. ' + formatBytes(before) + ' down to ' + formatBytes(after) + '.'
      : 'PDF ready. It was already about as small as this method can make it (' + formatBytes(after) + ').';
    if (result.limited) message += ' The first 40 pages were included.';
    setResult(message, 'ok');
  }

  async function makeToWord(settings) {
    var result = await FolioOffice.pdfTextToDocx(state.toword.bytes, report);
    rememberDownload(result.blob, baseName(settings.filename) + '.docx');
    var message = 'Word file ready. ' + result.pages + (result.pages === 1 ? ' page, ' : ' pages, ') + formatBytes(result.blob.size) + '.';
    if (result.limited) message += ' The first 40 pages were included.';
    setResult(message, 'ok');
  }

  async function makeToPpt(settings) {
    var result = await FolioOffice.pdfToPptx(state.toppt.bytes, report);
    rememberDownload(result.blob, baseName(settings.filename) + '.pptx');
    var message = 'PowerPoint ready. ' + result.pages + (result.pages === 1 ? ' slide, ' : ' slides, ') + formatBytes(result.blob.size) + '.';
    if (result.limited) message += ' The first 40 pages were included.';
    setResult(message, 'ok');
  }

  async function makeToExcel(settings) {
    var result = await FolioOffice.pdfTextToXlsx(state.toexcel.bytes, report);
    rememberDownload(result.blob, baseName(settings.filename) + '.xlsx');
    var message = 'Excel file ready. ' + result.pages + (result.pages === 1 ? ' page, ' : ' pages, ') + formatBytes(result.blob.size) + '.';
    if (result.limited) message += ' The first 40 pages were included.';
    setResult(message, 'ok');
  }

  async function makeFromWord(settings) {
    var result = await FolioOffice.docxToPdf(state.fromword.file, report);
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), baseName(settings.filename) + '.pdf');
    setResult('PDF ready. ' + result.pageCount + (result.pageCount === 1 ? ' page, ' : ' pages, ') + formatBytes(result.bytes.byteLength) + '.', 'ok');
  }

  async function makeFromPpt(settings) {
    var result = await FolioOffice.pptxToPdf(state.fromppt.file, report);
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), baseName(settings.filename) + '.pdf');
    setResult('PDF ready. ' + result.pageCount + (result.pageCount === 1 ? ' page, ' : ' pages, ') + formatBytes(result.bytes.byteLength) + '.', 'ok');
  }

  async function makeFromExcel(settings) {
    var result = await FolioOffice.xlsxToPdf(state.fromexcel.file, report);
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), baseName(settings.filename) + '.pdf');
    setResult('PDF ready. ' + result.pageCount + (result.pageCount === 1 ? ' page, ' : ' pages, ') + formatBytes(result.bytes.byteLength) + '.', 'ok');
  }

  async function makeEdit(settings) {
    if (!editor.marks.length) throw new Error('Add text, a shape, a drawing, or a picture first.');
    var result = await FolioEngine.applyAnnotations(state.edit.bytes, editor.marks, report);
    rememberDownload(new Blob([result.bytes], { type: 'application/pdf' }), baseName(settings.filename) + '.pdf');
    setResult('PDF ready. ' + editor.marks.length + (editor.marks.length === 1 ? ' addition, ' : ' additions, ') + formatBytes(result.bytes.byteLength) + '.', 'ok');
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

  function prepareEditor() {
    editor.page = 1;
    editor.marks = [];
    editor.drag = null;
    if (state.edit && state.edit.handle) {
      state.edit.handle.destroy();
      state.edit.handle = null;
    }
    $('editStage').hidden = !state.edit;
    if (state.edit) drawEditorPage().catch(showError);
  }

  async function drawEditorPage() {
    if (!state.edit || !window.pdfjsLib) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    if (!state.edit.handle) {
      state.edit.handle = await pdfjsLib.getDocument({ data: state.edit.bytes.slice(0) }).promise;
    }
    var pdf = state.edit.handle;
    var page = await pdf.getPage(editor.page);
    var base = page.getViewport({ scale: 1 });
    var wrap = $('editCanvas').parentElement.clientWidth || 640;
    var scale = Math.min(2, Math.max(0.4, (wrap - 4) / base.width));
    var viewport = page.getViewport({ scale: scale });
    var canvas = $('editCanvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    var overlay = $('editOverlay');
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    state.edit.view = { scale: scale, width: base.width, height: base.height };
    $('editPageLabel').textContent = editor.page + ' / ' + pdf.numPages;
    $('editPrev').disabled = editor.page <= 1;
    $('editNext').disabled = editor.page >= pdf.numPages;
    page.cleanup();
    drawMarks();
    updateGo();
  }

  function pointerToPdf(event) {
    var overlay = $('editOverlay');
    var rect = overlay.getBoundingClientRect();
    var view = state.edit && state.edit.view;
    if (!view || !rect.width) return null;
    var x = (event.clientX - rect.left) * (overlay.width / rect.width);
    var y = (event.clientY - rect.top) * (overlay.height / rect.height);
    return { x: x / view.scale, y: view.height - y / view.scale, cx: x, cy: y };
  }

  function drawMarks() {
    var overlay = $('editOverlay');
    var view = state.edit && state.edit.view;
    if (!overlay || !view) return;
    var ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    editor.marks.forEach(function (mark) {
      if (mark.page !== editor.page) return;
      ctx.strokeStyle = mark.color || '#5b21b6';
      ctx.fillStyle = mark.color || '#5b21b6';
      ctx.lineWidth = Math.max(1.5, (mark.thickness || 2) * view.scale);
      if (mark.type === 'text') {
        ctx.font = Math.max(10, (mark.size || 18) * view.scale) + 'px ' + (mark.font === 'times' ? 'Times, serif' : mark.font === 'courier' ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif');
        ctx.fillText(mark.text, mark.x * view.scale, (view.height - mark.y) * view.scale);
      } else if (mark.type === 'rect') {
        ctx.globalAlpha = 0.18;
        ctx.fillRect(mark.x * view.scale, (view.height - mark.y - mark.height) * view.scale, mark.width * view.scale, mark.height * view.scale);
        ctx.globalAlpha = 1;
        ctx.strokeRect(mark.x * view.scale, (view.height - mark.y - mark.height) * view.scale, mark.width * view.scale, mark.height * view.scale);
      } else if (mark.type === 'ink' && mark.points.length) {
        ctx.beginPath();
        mark.points.forEach(function (point, index) {
          var px = point.x * view.scale;
          var py = (view.height - point.y) * view.scale;
          if (index) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.stroke();
      } else if (mark.type === 'image' && mark.image) {
        ctx.drawImage(mark.image, mark.x * view.scale, (view.height - mark.y - mark.height) * view.scale, mark.width * view.scale, mark.height * view.scale);
      }
    });
    var drag = editor.drag;
    if (drag && drag.page === editor.page && drag.points) {
      ctx.strokeStyle = $('editColor').value;
      ctx.lineWidth = 2 * view.scale;
      ctx.beginPath();
      drag.points.forEach(function (point, index) {
        var px = point.x * view.scale;
        var py = (view.height - point.y) * view.scale;
        if (index) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
  }

  function editorPoint(event) {
    var point = pointerToPdf(event);
    if (!point) return null;
    return { x: point.x, y: point.y };
  }

  function onEditDown(event) {
    if (!state.edit || state.busy) return;
    var point = editorPoint(event);
    if (!point) return;
    if (editor.tool === 'text') {
      var text = $('editText').value.trim();
      if (!text) {
        toast('Type the text to place, then click the page.');
        return;
      }
      editor.marks.push({
        id: uid(),
        type: 'text',
        page: editor.page,
        x: point.x,
        y: point.y,
        text: text,
        size: clamp(parseFloat($('editSize').value), 8, 72, 18),
        font: $('editFont').value,
        color: $('editColor').value
      });
      drawMarks();
      updateGo();
      return;
    }
    if (editor.tool === 'image') {
      if (!editor.image) {
        $('editImageInput').click();
        return;
      }
      var width = 140;
      var height = width * (editor.image.height / editor.image.width);
      editor.marks.push({
        id: uid(),
        type: 'image',
        page: editor.page,
        x: point.x,
        y: point.y - height,
        width: width,
        height: height,
        bytes: editor.image.bytes,
        mime: editor.image.mime,
        image: editor.image.element
      });
      drawMarks();
      updateGo();
      return;
    }
    editor.drag = {
      page: editor.page,
      start: point,
      points: [point],
      tool: editor.tool
    };
    overlayCapture(event);
  }

  function overlayCapture(event) {
    if (event.target.setPointerCapture && event.pointerId != null) {
      try { event.target.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
  }

  function onEditMove(event) {
    if (!editor.drag) return;
    var point = editorPoint(event);
    if (!point) return;
    if (editor.drag.tool === 'draw') editor.drag.points.push(point);
    else editor.drag.points = [editor.drag.start, point];
    drawMarks();
    var view = state.edit.view;
    if (editor.drag.tool === 'shape' && editor.drag.points.length === 2) {
      var overlay = $('editOverlay');
      var ctx = overlay.getContext('2d');
      var a = editor.drag.points[0];
      var b = editor.drag.points[1];
      var x = Math.min(a.x, b.x);
      var y = Math.min(a.y, b.y);
      ctx.strokeStyle = $('editColor').value;
      ctx.strokeRect(x * view.scale, (view.height - Math.max(a.y, b.y)) * view.scale, Math.abs(b.x - a.x) * view.scale, Math.abs(b.y - a.y) * view.scale);
    }
  }

  function onEditUp() {
    var drag = editor.drag;
    editor.drag = null;
    if (!drag) return;
    if (drag.tool === 'shape' && drag.points.length >= 2) {
      var a = drag.points[0];
      var b = drag.points[drag.points.length - 1];
      var width = Math.abs(b.x - a.x);
      var height = Math.abs(b.y - a.y);
      if (width > 4 && height > 4) {
        editor.marks.push({
          id: uid(),
          type: 'rect',
          page: drag.page,
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: width,
          height: height,
          color: $('editColor').value
        });
      }
    } else if (drag.tool === 'draw' && drag.points.length > 1) {
      editor.marks.push({
        id: uid(),
        type: 'ink',
        page: drag.page,
        points: drag.points,
        color: $('editColor').value,
        thickness: 2
      });
    }
    drawMarks();
    updateGo();
  }

  function wireEditor() {
    var overlay = $('editOverlay');
    overlay.addEventListener('pointerdown', onEditDown);
    overlay.addEventListener('pointermove', onEditMove);
    overlay.addEventListener('pointerup', onEditUp);
    overlay.addEventListener('pointercancel', onEditUp);
    document.querySelectorAll('[data-edit-tool]').forEach(function (button) {
      button.addEventListener('click', function () {
        editor.tool = button.dataset.editTool;
        document.querySelectorAll('[data-edit-tool]').forEach(function (other) {
          other.classList.toggle('is-on', other === button);
        });
      });
    });
    $('editUndo').addEventListener('click', function () {
      editor.marks.pop();
      drawMarks();
      updateGo();
    });
    $('editPrev').addEventListener('click', function () {
      if (editor.page > 1) {
        editor.page -= 1;
        drawEditorPage().catch(showError);
      }
    });
    $('editNext').addEventListener('click', function () {
      var total = state.edit && state.edit.handle ? state.edit.handle.numPages : 1;
      if (editor.page < total) {
        editor.page += 1;
        drawEditorPage().catch(showError);
      }
    });
    $('editImageInput').addEventListener('change', function () {
      var file = $('editImageInput').files && $('editImageInput').files[0];
      $('editImageInput').value = '';
      if (!file) return;
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        file.arrayBuffer().then(function (buffer) {
          editor.image = {
            element: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            bytes: new Uint8Array(buffer),
            mime: /png$/i.test(file.type) || /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg'
          };
          URL.revokeObjectURL(url);
          toast('Click the page to place the picture.');
        });
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        toast('That picture could not be read.');
      };
      image.src = url;
    });
  }

  function init() {
    if (!window.PDFLib) {
      setResult('The PDF library did not load. Refresh the page and try again.', 'error');
      return;
    }
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    document.body.addEventListener('click', function (event) {
      var card = event.target.closest('[data-mode-btn]');
      if (card && !state.busy) setMode(card.dataset.modeBtn);
      var clearer = event.target.closest('[data-clear]');
      if (clearer && !state.busy) {
        var key = clearer.dataset.clear;
        if (key === 'images') clearImages();
        else if (key === 'merge') clearMerge();
        else clearSlot(key);
      }
      var sample = event.target.closest('[data-sample]');
      if (sample && !state.busy) {
        samplePdf('Sample', [[0.42, 0.16, 0.72], [0.23, 0.12, 0.4]]).then(function (file) {
          return setSinglePdf(sample.dataset.sample, file);
        }).catch(showError);
      }
    });
    $('backHome').addEventListener('click', function () { setMode('home'); });
    $('settingsForm').addEventListener('submit', go);
    function onSettings() {
      syncVisibility();
      updateGo();
      queuePaint();
    }
    $('settingsForm').addEventListener('input', onSettings);
    $('settingsForm').addEventListener('change', onSettings);
    wireEditor();
    [
      ['imageDrop', 'imageInput'],
      ['mergeDrop', 'mergeInput'],
      ['resizeDrop', 'resizeInput'],
      ['pngDrop', 'pngInput'],
      ['splitDrop', 'splitInput'],
      ['compressDrop', 'compressInput'],
      ['towordDrop', 'towordInput'],
      ['topptDrop', 'topptInput'],
      ['toexcelDrop', 'toexcelInput'],
      ['fromwordDrop', 'fromwordInput'],
      ['frompptDrop', 'frompptInput'],
      ['fromexcelDrop', 'fromexcelInput'],
      ['editDrop', 'editInput']
    ].forEach(function (pair) { wireDrop($(pair[0]), $(pair[1])); });
    [
      ['browseImages', 'imageInput'],
      ['browseMerge', 'mergeInput'],
      ['browseResize', 'resizeInput'],
      ['browsePng', 'pngInput'],
      ['browseSplit', 'splitInput'],
      ['browseCompress', 'compressInput'],
      ['browseToword', 'towordInput'],
      ['browseToppt', 'topptInput'],
      ['browseToexcel', 'toexcelInput'],
      ['browseFromword', 'fromwordInput'],
      ['browseFromppt', 'frompptInput'],
      ['browseFromexcel', 'fromexcelInput'],
      ['browseEdit', 'editInput']
    ].forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () { $(pair[1]).click(); });
    });
    $('sampleImages').addEventListener('click', function () { sampleImages().catch(showError); });
    $('sampleMerge').addEventListener('click', function () { sampleMerge().catch(showError); });
    $('sampleResize').addEventListener('click', function () {
      samplePdf('Border sample', [[0.42, 0.16, 0.72]]).then(function (file) {
        return setSinglePdf('resize', file);
      }).catch(showError);
    });
    $('samplePng').addEventListener('click', function () {
      samplePdf('Pages', [[0.23, 0.12, 0.4], [0.42, 0.16, 0.72]]).then(function (file) {
        return setSinglePdf('png', file);
      }).catch(showError);
    });
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
      addIncoming(files);
    });
    window.addEventListener('resize', queuePaint);
    if (window.ResizeObserver) new ResizeObserver(queuePaint).observe(document.querySelector('.preview-wrap'));
    syncVisibility();
    updateGo();
    queuePaint();
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
