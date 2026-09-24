const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { extractRawTextFromDocx, textToParagraphs } = require('./docx-extract');
const DocxStory = require('./docx-story');

async function makeDocxBuffer(paragraphs) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const body = paragraphs
    .map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`)
    .join('');
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('docx-extract', () => {
  it('extracts text and splits chapters without mammoth', async () => {
    const buf = await makeDocxBuffer([
      'Truyen Test',
      'Chương 1: Mo dau',
      'Noi dung 1.',
      'Chương 2',
      'Noi dung 2.',
    ]);
    const text = await extractRawTextFromDocx(buf);
    const paragraphs = textToParagraphs(text);
    const story = DocxStory.splitChaptersFromParagraphs(paragraphs, {
      fallbackTitle: 'x',
    });
    assert.match(text, /Chương 1/);
    assert.equal(story.chapters.length, 2);
    assert.equal(story.chapters[0].title, 'Chương 1: Mo dau');
  });
});
