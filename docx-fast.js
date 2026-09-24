/**
 * Fast .docx reader: locate word/document.xml in the ZIP central directory,
 * inflate ONLY that entry with native deflate (DecompressionStream / zlib),
 * then scan <w:t> text once. Images are never read.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.DocxFast = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const EOCD_SIG = 0x06054b50;
  const CFH_SIG = 0x02014b50;

  function u16(b, o) {
    return b[o] | (b[o + 1] << 8);
  }
  function u32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  async function readBytes(file, start, end) {
    const size = file.size != null ? file.size : file.byteLength;
    const s = Math.max(0, start);
    const e = Math.min(size, end);
    if (e <= s) return new Uint8Array(0);
    if (typeof file.slice === 'function') {
      const blob = file.slice(s, e);
      const buf = await blob.arrayBuffer();
      return new Uint8Array(buf);
    }
    // Buffer / Uint8Array
    return new Uint8Array(file.buffer || file, (file.byteOffset || 0) + s, e - s);
  }

  function findEocd(tail) {
    const min = Math.max(0, tail.length - 22);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === EOCD_SIG) return i;
      if (i < min && tail.length > 22 + 65535) break;
    }
    // full scan of the provided tail
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === EOCD_SIG) return i;
    }
    return -1;
  }

  async function locateDocumentXml(file) {
    const size = file.size != null ? file.size : file.byteLength;
    const tailLen = Math.min(size, 65557);
    const tail = await readBytes(file, size - tailLen, size);
    const eocdRel = findEocd(tail);
    if (eocdRel < 0) {
      throw new Error('File .docx không phải ZIP hợp lệ.');
    }
    const eocd = eocdRel;
    const cdSize = u32(tail, eocd + 12);
    const cdOffset = u32(tail, eocd + 16);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      throw new Error('File Word dùng ZIP64 — hãy xuất lại .docx thường (Word: Save As).');
    }
    const cd = await readBytes(file, cdOffset, cdOffset + cdSize);
    let p = 0;
    while (p + 46 <= cd.length) {
      if (u32(cd, p) !== CFH_SIG) break;
      const method = u16(cd, p + 10);
      const compSize = u32(cd, p + 20);
      const localOff = u32(cd, p + 42);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      const name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nameLen));
      const norm = name.replace(/\\/g, '/');
      if (norm.toLowerCase() === 'word/document.xml') {
        return { method, compSize, localOff };
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
  }

  async function readCompressedEntry(file, meta) {
    const local = await readBytes(file, meta.localOff, meta.localOff + 30);
    if (u32(local, 0) !== 0x04034b50) {
      throw new Error('Header ZIP của document.xml bị hỏng.');
    }
    const nameLen = u16(local, 26);
    const extraLen = u16(local, 28);
    const dataStart = meta.localOff + 30 + nameLen + extraLen;
    return readBytes(file, dataStart, dataStart + meta.compSize);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    }
    const zlib = require('zlib');
    return zlib.inflateRawSync(Buffer.from(bytes)).toString('utf8');
  }

  function decodeXmlEntities(text) {
    if (!text || text.indexOf('&') < 0) return text;
    return text
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return Number.isFinite(code) ? String.fromCharCode(code) : _;
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
        const code = parseInt(h, 16);
        return Number.isFinite(code) ? String.fromCharCode(code) : _;
      })
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /** One pass over XML: collect paragraph text from <w:t>, split on </w:p>. */
  function paragraphsFromDocumentXml(xml) {
    const paras = [];
    let buf = '';
    let i = 0;
    const n = xml.length;
    while (i < n) {
      const lt = xml.indexOf('<', i);
      if (lt < 0) break;
      if (xml.startsWith('</w:p>', lt) || xml.startsWith('</w:p ', lt)) {
        const line = decodeXmlEntities(buf).replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
        if (line) paras.push(line);
        buf = '';
        const gt = xml.indexOf('>', lt);
        i = gt < 0 ? n : gt + 1;
        continue;
      }
      if (xml.startsWith('<w:t', lt) && (xml[lt + 4] === '>' || xml[lt + 4] === ' ' || xml[lt + 4] === '/')) {
        if (xml[lt + 4] === '/' ) {
          i = lt + 5;
          continue;
        }
        const gt = xml.indexOf('>', lt);
        if (gt < 0) break;
        const end = xml.indexOf('</w:t>', gt + 1);
        if (end < 0) break;
        buf += xml.slice(gt + 1, end);
        i = end + 6;
        continue;
      }
      if (xml.startsWith('<w:tab', lt)) buf += '\t';
      else if (xml.startsWith('<w:br', lt) || xml.startsWith('<w:cr', lt)) buf += '\n';
      const gt = xml.indexOf('>', lt);
      i = gt < 0 ? n : gt + 1;
    }
    const tail = decodeXmlEntities(buf).replace(/[ \t]+/g, ' ').trim();
    if (tail) paras.push(tail);
    return paras;
  }

  async function paragraphsFromDocxFile(file, onProgress) {
    const report = typeof onProgress === 'function' ? onProgress : function () {};
    report(15, 'Đang tìm nội dung chữ trong file Word…');
    const meta = await locateDocumentXml(file);
    report(35, 'Đang giải nén phần chữ (bỏ ảnh)…');
    const compressed = await readCompressedEntry(file, meta);
    let xml;
    if (meta.method === 0) {
      xml = new TextDecoder('utf-8').decode(compressed);
    } else if (meta.method === 8) {
      xml = await inflateRaw(compressed);
    } else {
      throw new Error('File Word dùng kiểu nén không hỗ trợ (method ' + meta.method + ').');
    }
    report(70, 'Đang tách đoạn văn…');
    const paragraphs = paragraphsFromDocumentXml(xml);
    if (!paragraphs.length) {
      throw new Error('File Word không có nội dung chữ (có thể chỉ có ảnh hoặc file hỏng).');
    }
    return paragraphs;
  }

  async function storyFromDocxFile(file, options) {
    const opts = options || {};
    const paragraphs = await paragraphsFromDocxFile(file, opts.onProgress);
    const DocxStory = root.DocxStory || (typeof module === 'object' ? require('./docx-story') : null);
    if (!DocxStory || typeof DocxStory.splitChaptersFromParagraphs !== 'function') {
      throw new Error('Thiếu module tách chương. Tải lại trang.');
    }
    const fallbackTitle =
      opts.fallbackTitle ||
      (DocxStory.storyTitleFromFilename && file && file.name
        ? DocxStory.storyTitleFromFilename(file.name)
        : 'truyen');
    if (opts.onProgress) opts.onProgress(88, 'Đang tách chương…');
    return DocxStory.splitChaptersFromParagraphs(paragraphs, { fallbackTitle });
  }

  return {
    locateDocumentXml,
    paragraphsFromDocumentXml,
    paragraphsFromDocxFile,
    storyFromDocxFile,
  };
});
