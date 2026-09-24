const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { extractRawTextFromDocx, textToParagraphs } = require('./docx-extract');
const DocxStory = require('./docx-story');

async function makeDocxFile(paragraphs) {
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
  // Add a fake media entry to ensure we skip it
  zip.folder('word').folder('media').file('image1.bin', Buffer.alloc(1024, 7));
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
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const filePath = path.join(os.tmpdir(), `dac-test-${Date.now()}.docx`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

describe('docx-extract (yauzl disk stream)', () => {
  it('extracts text from disk and ignores media', async () => {
    const filePath = await makeDocxFile([
      'Truyen Test',
      'Chương 1: Mo dau',
      'Noi dung 1.',
      'Chương 2',
      'Noi dung 2.',
    ]);
    try {
      const text = await extractRawTextFromDocx({ filePath });
      const paragraphs = textToParagraphs(text);
      const story = DocxStory.splitChaptersFromParagraphs(paragraphs, {
        fallbackTitle: 'x',
      });
      assert.match(text, /Chương 1/);
      assert.equal(story.chapters.length, 2);
    } finally {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {
        /* ignore */
      }
    }
  });
});
