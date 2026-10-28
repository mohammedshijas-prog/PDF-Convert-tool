/* Folio — Word, PowerPoint, and Excel conversion. Files stay in the browser. */
(function () {
  'use strict';

  var PAGE_CAP = 40;
  var EMU = 914400;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&amp;/g, '&');
  }

  function colName(index) {
    var n = index;
    var name = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function requireZip() {
    if (!window.JSZip) throw new Error('The office tools did not load. Refresh the page and try again.');
    return JSZip;
  }

  function initPdfJs() {
    if (!window.pdfjsLib) throw new Error('This PDF could not be read. Refresh the page and try again.');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
  }

  function yieldToUi() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  async function readPdfPages(bytes, onProgress) {
    initPdfJs();
    var task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    var pdf = await task.promise;
    try {
      var limit = Math.min(pdf.numPages, PAGE_CAP);
      var pages = [];
      var n;
      for (n = 1; n <= limit; n++) {
        if (onProgress) onProgress(n, limit, 'Reading page ' + n + '…');
        var page = await pdf.getPage(n);
        var content = await page.getTextContent();
        var items = [];
        content.items.forEach(function (item) {
          if (!item.str) return;
          items.push({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width || 0
          });
        });
        var view = page.view;
        pages.push({
          items: items,
          width: view[2] - view[0],
          height: view[3] - view[1]
        });
        page.cleanup();
        await yieldToUi();
      }
      return { pages: pages, total: pdf.numPages, limited: pdf.numPages > PAGE_CAP };
    } finally {
      await pdf.destroy();
    }
  }

  function groupRows(items) {
    var rows = [];
    items.slice().sort(function (a, b) {
      return b.y - a.y || a.x - b.x;
    }).forEach(function (item) {
      var row = rows.length ? rows[rows.length - 1] : null;
      if (!row || Math.abs(row.y - item.y) > 3.5) {
        row = { y: item.y, cells: [item] };
        rows.push(row);
      } else {
        row.cells.push(item);
      }
    });
    rows.forEach(function (row) {
      row.cells.sort(function (a, b) { return a.x - b.x; });
    });
    return rows;
  }

  function rowCells(row) {
    var cells = [];
    var current = '';
    var end = null;
    row.cells.forEach(function (item) {
      var gap = end == null ? 0 : item.x - end;
      if (current && gap > 10) {
        cells.push(current.trim());
        current = item.str;
      } else if (!current) {
        current = item.str;
      } else if (gap > 1.5) {
        current += ' ' + item.str;
      } else {
        current += item.str;
      }
      end = item.x + (item.width || item.str.length * 4.2);
    });
    if (current.trim()) cells.push(current.trim());
    return cells;
  }

  function pageLines(page) {
    if (!page.items.length) return ['[No selectable text on this page]'];
    return groupRows(page.items).map(function (row) {
      return rowCells(row).join(' ');
    });
  }

  async function pdfTextToDocx(bytes, onProgress) {
    var read = await readPdfPages(bytes, onProgress);
    var Zip = requireZip();
    var zip = new Zip();
    var body = [];
    read.pages.forEach(function (page, index) {
      if (index) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      pageLines(page).forEach(function (line) {
        body.push('<w:p><w:r><w:t xml:space="preserve">' + esc(line) + '</w:t></w:r></w:p>');
      });
    });
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>');
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>');
    var word = zip.folder('word');
    word.file('document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
      '</w:body></w:document>');
    word.file('styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style></w:styles>');
    word.folder('_rels').file('document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    var blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    return { blob: blob, pages: read.pages.length, limited: read.limited };
  }

  async function pdfTextToXlsx(bytes, onProgress) {
    var read = await readPdfPages(bytes, onProgress);
    var strings = [];
    var lookup = {};
    function sid(text) {
      var key = String(text);
      if (Object.prototype.hasOwnProperty.call(lookup, key)) return lookup[key];
      lookup[key] = strings.length;
      strings.push(key);
      return lookup[key];
    }
    var rowsXml = [];
    var rowNumber = 1;
    read.pages.forEach(function (page, index) {
      var header = sid('Page ' + (index + 1));
      rowsXml.push('<row r="' + rowNumber + '"><c r="A' + rowNumber + '" t="s"><v>' + header + '</v></c></row>');
      rowNumber += 1;
      var rows = page.items.length ? groupRows(page.items) : [];
      if (!rows.length) {
        var empty = sid('[No selectable text on this page]');
        rowsXml.push('<row r="' + rowNumber + '"><c r="A' + rowNumber + '" t="s"><v>' + empty + '</v></c></row>');
        rowNumber += 1;
      }
      rows.forEach(function (row) {
        var cells = rowCells(row);
        var xml = '<row r="' + rowNumber + '">';
        cells.forEach(function (cell, cellIndex) {
          var ref = colName(cellIndex + 1) + rowNumber;
          xml += '<c r="' + ref + '" t="s"><v>' + sid(cell) + '</v></c>';
        });
        xml += '</row>';
        rowsXml.push(xml);
        rowNumber += 1;
      });
      rowNumber += 1;
    });
    var shared = strings.map(function (text) {
      return '<si><t xml:space="preserve">' + esc(text) + '</t></si>';
    }).join('');
    var Zip = requireZip();
    var zip = new Zip();
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>');
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');
    var xl = zip.folder('xl');
    xl.file('workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="PDF" sheetId="1" r:id="rId1"/></sheets></workbook>');
    xl.folder('_rels').file('workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');
    xl.folder('worksheets').file('sheet1.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rowsXml.join('') + '</sheetData></worksheet>');
    xl.file('sharedStrings.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">' +
      shared + '</sst>');
    xl.file('styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="1"><xf/></cellXfs></styleSheet>');
    var blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    return { blob: blob, pages: read.pages.length, limited: read.limited };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('Could not prepare a picture.'));
        else resolve(blob);
      }, type, quality);
    });
  }

  async function pdfToPptx(bytes, onProgress) {
    initPdfJs();
    var Zip = requireZip();
    var task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    var pdf = await task.promise;
    var zip = new Zip();
    try {
      var limit = Math.min(pdf.numPages, PAGE_CAP);
      var first = await pdf.getPage(1);
      var firstView = first.getViewport({ scale: 1 });
      var cx = Math.round(firstView.width * 12700);
      var cy = Math.round(firstView.height * 12700);
      first.cleanup();
      var slideOverrides = '';
      var slideIds = '';
      var presRels = '';
      var n;
      for (n = 1; n <= limit; n++) {
        if (onProgress) onProgress(n, limit, 'Building slide ' + n + '…');
        var page = await pdf.getPage(n);
        var unscaled = page.getViewport({ scale: 1 });
        var scale = Math.min(2.2, 1400 / Math.max(unscaled.width, unscaled.height));
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
        zip.file('ppt/media/image' + n + '.jpeg', blob);
        var slideCx = Math.round(unscaled.width * 12700);
        var slideCy = Math.round(unscaled.height * 12700);
        zip.file('ppt/slides/slide' + n + '.xml', slideXml(slideCx, slideCy));
        zip.file('ppt/slides/_rels/slide' + n + '.xml.rels',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + n + '.jpeg"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
          '</Relationships>');
        slideOverrides += '<Override PartName="/ppt/slides/slide' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
        slideIds += '<p:sldId id="' + (255 + n) + '" r:id="rId' + (n + 1) + '"/>';
        presRels += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + n + '.xml"/>';
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
        await yieldToUi();
      }
      zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        slideOverrides + '</Types>');
      zip.folder('_rels').file('.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
        '</Relationships>');
      zip.file('ppt/presentation.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        '<p:sldIdLst>' + slideIds + '</p:sldIdLst>' +
        '<p:sldSz cx="' + cx + '" cy="' + cy + '"/>' +
        '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
      zip.file('ppt/_rels/presentation.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
        presRels +
        '<Relationship Id="rId' + (limit + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
        '</Relationships>');
      zip.file('ppt/slideMasters/slideMaster1.xml', masterXml());
      zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
        '</Relationships>');
      zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml());
      zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
        '</Relationships>');
      zip.file('ppt/theme/theme1.xml', themeXml());
      var out = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      });
      return { blob: out, pages: limit, limited: pdf.numPages > PAGE_CAP };
    } finally {
      await pdf.destroy();
    }
  }

  function slideXml(cx, cy) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
      '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  function layoutXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
      '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  }

  function masterXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
  }

  function themeXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Folio">' +
      '<a:themeElements>' +
      '<a:clrScheme name="Folio"><a:dk1><a:srgbClr val="1E1233"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="3B2763"/></a:dk2><a:lt2><a:srgbClr val="F4F0FB"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="6D28D9"/></a:accent1><a:accent2><a:srgbClr val="7C3AED"/></a:accent2>' +
      '<a:accent3><a:srgbClr val="A78BFA"/></a:accent3><a:accent4><a:srgbClr val="C4B5FD"/></a:accent4>' +
      '<a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="5B21B6"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="6D28D9"/></a:hlink><a:folHlink><a:srgbClr val="4C1D95"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="Folio"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Folio"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
      '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
      '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
      '</a:fmtScheme></a:themeElements></a:theme>';
  }

  async function loadOffice(file) {
    var name = file.name || '';
    var bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length >= 4 && bytes[0] === 0xD0 && bytes[1] === 0xCF) {
      throw new Error('Save ' + name + ' as the newer Office format (DOCX, PPTX, or XLSX) and try again.');
    }
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4B)) {
      throw new Error(name + ' is not a Word, PowerPoint, or Excel file this tool can open.');
    }
    var zip = await requireZip().loadAsync(bytes);
    return zip;
  }

  function paragraphsFromDocx(xml) {
    var parts = xml.split(/<\/w:p>/);
    var lines = [];
    parts.forEach(function (part, index) {
      if (index === parts.length - 1 && !/<w:t[\s>]/.test(part)) return;
      var texts = [];
      var re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      var match;
      while ((match = re.exec(part))) texts.push(decodeXml(match[1]));
      lines.push(texts.join(''));
    });
    return lines.filter(function (line, index, all) {
      return line.trim() || (index > 0 && index < all.length - 1);
    });
  }

  async function docxToPdf(file, onProgress) {
    if (onProgress) onProgress(1, 3, 'Reading the document…');
    var zip = await loadOffice(file);
    var entry = zip.file('word/document.xml');
    if (!entry) throw new Error('This file has no Word document inside it.');
    var xml = await entry.async('string');
    var lines = paragraphsFromDocx(xml);
    if (!lines.length) throw new Error('This document has no text to place on a page.');
    if (onProgress) onProgress(2, 3, 'Building the PDF…');
    var pdf = await drawWrappedPdf(lines, 'Document');
    if (onProgress) onProgress(3, 3, 'Finishing…');
    return pdf;
  }

  function slideText(xml) {
    var lines = [];
    var re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    var match;
    var current = [];
    while ((match = re.exec(xml))) current.push(decodeXml(match[1]));
    if (current.length) lines.push(current.join(' '));
    return lines;
  }

  async function pptxToPdf(file, onProgress) {
    var zip = await loadOffice(file);
    var pres = zip.file('ppt/presentation.xml');
    if (!pres) throw new Error('This file has no PowerPoint presentation inside it.');
    var presXml = await pres.async('string');
    var sizeTag = (presXml.match(/<p:sldSz\b[^>]*>/) || [''])[0];
    var cx = sizeTag.match(/cx="(\d+)"/);
    var cy = sizeTag.match(/cy="(\d+)"/);
    var width = cx ? Math.max(200, Number(cx[1]) * 72 / EMU) : 720;
    var height = cy ? Math.max(200, Number(cy[1]) * 72 / EMU) : 405;
    var names = Object.keys(zip.files).filter(function (path) {
      return /^ppt\/slides\/slide\d+\.xml$/.test(path);
    }).sort(function (a, b) {
      return parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10);
    });
    if (!names.length) throw new Error('This presentation has no slides.');
    var pdf = await PDFLib.PDFDocument.create();
    pdf.setTitle('Slides');
    var font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    var bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var i;
    for (i = 0; i < names.length; i++) {
      if (onProgress) onProgress(i + 1, names.length, 'Reading slide ' + (i + 1) + '…');
      var xml = await zip.file(names[i]).async('string');
      var relPath = names[i].replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
      var rels = zip.file(relPath) ? await zip.file(relPath).async('string') : '';
      var page = pdf.addPage([width, height]);
      page.drawRectangle({ x: 0, y: 0, width: width, height: height, color: PDFLib.rgb(1, 1, 1) });
      await drawSlideImages(page, pdf, zip, xml, rels, width, height);
      var lines = slideText(xml);
      if (lines.length && !/a:blip/.test(xml)) {
        drawLinesOnPage(page, font, bold, lines, width, height, 'Slide ' + (i + 1));
      } else if (!/a:blip/.test(xml)) {
        page.drawText('Slide ' + (i + 1), { x: 36, y: height - 48, size: 18, font: bold, color: PDFLib.rgb(0.18, 0.1, 0.28) });
      }
      await yieldToUi();
    }
    return { bytes: await pdf.save(), pageCount: names.length };
  }

  async function drawSlideImages(page, pdf, zip, xml, rels, width, height) {
    var pics = xml.split(/<p:pic[\s>]/).slice(1);
    var p;
    for (p = 0; p < pics.length; p++) {
      var block = pics[p];
      var embed = block.match(/r:embed="([^"]+)"/);
      if (!embed) continue;
      var target = rels.match(new RegExp('Id="' + embed[1] + '"[^>]*Target="([^"]+)"')) ||
        rels.match(new RegExp('Target="([^"]+)"[^>]*Id="' + embed[1] + '"'));
      if (!target) continue;
      var mediaPath = target[1].replace(/^\.\.\//, 'ppt/');
      if (mediaPath.indexOf('ppt/') !== 0) mediaPath = 'ppt/' + mediaPath.replace(/^\/+/, '');
      var media = zip.file(mediaPath);
      if (!media) continue;
      var raw = new Uint8Array(await media.async('uint8array'));
      var image;
      try {
        image = /\.png$/i.test(mediaPath) ? await pdf.embedPng(raw) : await pdf.embedJpg(raw);
      } catch (err) {
        continue;
      }
      var off = block.match(/<a:off[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/);
      var ext = block.match(/<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
      var x = 0;
      var y = 0;
      var w = width;
      var h = height;
      if (off && ext) {
        x = Number(off[1]) * 72 / EMU;
        var top = Number(off[2]) * 72 / EMU;
        w = Number(ext[1]) * 72 / EMU;
        h = Number(ext[2]) * 72 / EMU;
        y = height - top - h;
      }
      page.drawImage(image, { x: x, y: y, width: Math.max(1, w), height: Math.max(1, h) });
    }
  }

  function parseSharedStrings(xml) {
    var strings = [];
    var parts = xml.split(/<si[\s>]/).slice(1);
    parts.forEach(function (part) {
      var body = part.split('</si>')[0];
      var texts = [];
      var re = /<t[^>]*>([^<]*)<\/t>/g;
      var match;
      while ((match = re.exec(body))) texts.push(decodeXml(match[1]));
      strings.push(texts.join(''));
    });
    return strings;
  }

  function parseSheet(xml, strings) {
    var rows = [];
    var rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    var rowMatch;
    while ((rowMatch = rowRe.exec(xml))) {
      var cells = [];
      var cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[2]))) {
        var attrs = cellMatch[1];
        var ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1] || '';
        var col = 0;
        var k;
        for (k = 0; k < ref.length; k++) col = col * 26 + (ref.charCodeAt(k) - 64);
        var type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
        var value = '';
        var inner = cellMatch[2] || '';
        var raw = (inner.match(/<v[^>]*>([^<]*)<\/v>/) || [])[1];
        if (type === 's' && raw != null) value = strings[Number(raw)] || '';
        else if (type === 'inlineStr') {
          var bits = [];
          var tre = /<t[^>]*>([^<]*)<\/t>/g;
          var tm;
          while ((tm = tre.exec(inner))) bits.push(decodeXml(tm[1]));
          value = bits.join('');
        } else if (raw != null) value = decodeXml(raw);
        if (value !== '') cells.push({ col: col || cells.length + 1, value: value });
      }
      if (cells.length) rows.push(cells);
      if (rows.length >= 400) break;
    }
    return rows;
  }

  async function xlsxToPdf(file, onProgress) {
    if (onProgress) onProgress(1, 2, 'Reading the spreadsheet…');
    var zip = await loadOffice(file);
    var sheet = zip.file('xl/worksheets/sheet1.xml');
    if (!sheet) throw new Error('This workbook has no sheet to read.');
    var shared = zip.file('xl/sharedStrings.xml');
    var strings = shared ? parseSharedStrings(await shared.async('string')) : [];
    var rows = parseSheet(await sheet.async('string'), strings);
    if (!rows.length) throw new Error('This sheet has no cells to place on a page.');
    if (onProgress) onProgress(2, 2, 'Building the PDF…');
    var pdf = await PDFLib.PDFDocument.create();
    pdf.setTitle('Spreadsheet');
    var font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    var pageW = 842;
    var pageH = 595;
    var page = pdf.addPage([pageW, pageH]);
    var y = pageH - 36;
    var rowH = 16;
    var colW = 78;
    rows.forEach(function (cells) {
      if (y < 36) {
        page = pdf.addPage([pageW, pageH]);
        y = pageH - 36;
      }
      cells.forEach(function (cell) {
        if (cell.col > 10) return;
        var text = pdfSafe(cell.value).slice(0, 18);
        page.drawText(text, {
          x: 28 + (cell.col - 1) * colW,
          y: y,
          size: 9,
          font: font,
          color: PDFLib.rgb(0.12, 0.08, 0.2)
        });
      });
      y -= rowH;
    });
    return { bytes: await pdf.save(), pageCount: pdf.getPageCount() };
  }

  function pdfSafe(text) {
    return String(text || '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
  }

  function wrapLine(text, font, size, maxWidth) {
    var words = pdfSafe(text).split(/\s+/);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      if (!word) return;
      var next = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    if (!lines.length) lines.push('');
    return lines;
  }

  async function drawWrappedPdf(lines, title) {
    var pdf = await PDFLib.PDFDocument.create();
    pdf.setTitle(title || 'Document');
    var font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    var bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var pageW = 595.28;
    var pageH = 841.89;
    var page = pdf.addPage([pageW, pageH]);
    var y = pageH - 64;
    page.drawText(pdfSafe(title), { x: 54, y: pageH - 46, size: 16, font: bold, color: PDFLib.rgb(0.18, 0.1, 0.28) });
    lines.forEach(function (line) {
      var wrapped = wrapLine(line, font, 11, pageW - 108);
      wrapped.forEach(function (bit) {
        if (y < 54) {
          page = pdf.addPage([pageW, pageH]);
          y = pageH - 54;
        }
        if (bit) page.drawText(bit, { x: 54, y: y, size: 11, font: font, color: PDFLib.rgb(0.12, 0.08, 0.2) });
        y -= 16;
      });
    });
    return { bytes: await pdf.save(), pageCount: pdf.getPageCount() };
  }

  function drawLinesOnPage(page, font, bold, lines, width, height, title) {
    page.drawText(pdfSafe(title), { x: 36, y: height - 40, size: 16, font: bold, color: PDFLib.rgb(0.18, 0.1, 0.28) });
    var y = height - 68;
    lines.forEach(function (line) {
      wrapLine(line, font, 14, width - 72).forEach(function (bit) {
        if (y < 28 || !bit) return;
        page.drawText(bit, { x: 36, y: y, size: 14, font: font, color: PDFLib.rgb(0.12, 0.08, 0.2) });
        y -= 20;
      });
    });
  }

  window.FolioOffice = {
    pdfTextToDocx: pdfTextToDocx,
    pdfTextToXlsx: pdfTextToXlsx,
    pdfToPptx: pdfToPptx,
    docxToPdf: docxToPdf,
    pptxToPdf: pptxToPdf,
    xlsxToPdf: xlsxToPdf
  };
})();
