/**
 * Browser-side .docx text extract via @zip.js/zip.js.
 * Only decompresses word/document.xml — images/media are never inflated.
 */
(function (root) {
  let zipJsPromise = null;

  function getXmlHelpers() {
    if (!root.DocxXml) {
      throw new Error('Thiếu DocxXml. Tải lại trang.');
    }
    return root.DocxXml;
  }

  function loadZipJs() {
    if (!zipJsPromise) {
      // no-worker build: tránh lỗi worker path khi serve từ /node_modules
      zipJsPromise = import('/node_modules/@zip.js/zip.js/lib/zip-no-worker.js').catch((err) => {
        zipJsPromise = null;
        throw new Error(
          'Không tải được thư viện đọc ZIP. ' + (err && err.message ? err.message : err)
        );
      });
    }
    return zipJsPromise;
  }

  async function extractRawTextFromFile(file) {
    const { xmlToRawText } = getXmlHelpers();
    const zip = await loadZipJs();
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    try {
      const entries = await reader.getEntries();
      const entry = entries.find((e) => {
        const name = String(e.filename || '').replace(/\\/g, '/');
        return name === 'word/document.xml';
      });
      if (!entry || entry.directory) {
        throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
      }
      const xml = await entry.getData(new zip.TextWriter('utf-8'));
      const text = xmlToRawText(xml);
      if (!String(text || '').trim()) {
        throw new Error('File Word không có nội dung chữ (có thể chỉ có ảnh hoặc file hỏng).');
      }
      return text;
    } finally {
      try {
        await reader.close();
      } catch (_) {
        /* ignore */
      }
    }
  }

  async function storyFromDocxFile(file, options) {
    const fallbackTitle =
      (options && options.fallbackTitle) ||
      (root.DocxStory && DocxStory.storyTitleFromFilename
        ? DocxStory.storyTitleFromFilename(file.name)
        : 'truyen');
    const text = await extractRawTextFromFile(file);
    const paragraphs = getXmlHelpers().textToParagraphs(text);
    if (!root.DocxStory || typeof DocxStory.splitChaptersFromParagraphs !== 'function') {
      throw new Error('Thiếu module tách chương. Tải lại trang.');
    }
    return DocxStory.splitChaptersFromParagraphs(paragraphs, { fallbackTitle });
  }

  root.DocxClient = {
    extractRawTextFromFile,
    storyFromDocxFile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
