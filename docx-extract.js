const JSZip = require('jszip');

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Low-memory .docx text extract: only decompress word/document.xml (skip images).
 */
async function extractRawTextFromDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
  }

  const xml = await docFile.async('string');
  // Drop other zip entries ASAP to help GC
  Object.keys(zip.files).forEach((name) => {
    if (name !== 'word/document.xml') delete zip.files[name];
  });

  const text = decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
  );

  return text;
}

function textToParagraphs(text) {
  return String(text || '')
    .split(/\n+/)
    .map((s) => s.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

module.exports = {
  extractRawTextFromDocx,
  textToParagraphs,
};
