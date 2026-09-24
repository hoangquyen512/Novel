const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { paragraphsFromDocxFile, storyFromDocxFile } = require('./docx-fast');

function asFile(buf, name) {
  return {
    name: name || 't.docx',
    size: buf.length,
    slice(start, end) {
      const sub = buf.subarray(start, end);
      return {
        arrayBuffer: async () =>
          sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength),
      };
    },
  };
}

async function makeDocx(paragraphs, extraMediaBytes) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip
    .folder('_rels')
    .file(
      '.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    );
  if (extraMediaBytes) {
    zip.folder('word').folder('media').file('big.bin', Buffer.alloc(extraMediaBytes, 7));
  }
  const body = paragraphs
    .map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`)
    .join('');
  zip
    .folder('word')
    .file(
      'document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
    );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('docx-fast native inflate', () => {
  it('reads chapters and ignores media bytes', async () => {
    const buf = await makeDocx(
      ['Truyen Test', 'Chương 1: Mo dau', 'Noi dung 1.', 'Chuong 2', 'Noi dung 2.'],
      250000
    );
    const story = await storyFromDocxFile(asFile(buf, 'demo.docx'), {
      fallbackTitle: 'demo',
    });
    assert.equal(story.chapters.length, 2);
    assert.match(story.chapters[0].title, /Chương 1/);
    assert.match(story.chapters[1].title, /Chuong 2/);
  });

  it('extracts thousands of paragraphs quickly', async () => {
    const paras = [];
    for (let i = 1; i <= 40; i++) {
      paras.push(`Chương ${i}`);
      for (let j = 0; j < 80; j++) paras.push(`Doan ${i}-${j} noi dung truyen rat dai de kiem tra toc do.`);
    }
    const buf = await makeDocx(paras, 0);
    const t0 = Date.now();
    const got = await paragraphsFromDocxFile(asFile(buf));
    const ms = Date.now() - t0;
    assert.ok(got.length > 3000, `paragraphs ${got.length}`);
    assert.ok(ms < 8000, `too slow ${ms}ms`);
  });
});
