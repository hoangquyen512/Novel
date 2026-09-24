(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DocxXml = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function decodeXmlEntities(text) {
    return String(text || '')
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

  function xmlToRawText(xml) {
    return decodeXmlEntities(
      String(xml || '')
        .replace(/<w:tab\b[^>]*\/>/gi, '\t')
        .replace(/<w:br\b[^>]*\/>/gi, '\n')
        .replace(/<\/w:p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
    );
  }

  function textToParagraphs(text) {
    return String(text || '')
      .split(/\n+/)
      .map((s) => s.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
  }

  return {
    decodeXmlEntities,
    xmlToRawText,
    textToParagraphs,
  };
});
