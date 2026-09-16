const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { storyFromPdfTextItems } = require('./docx-story');

const SAMPLE = path.join(__dirname, '_sample_alpha.pdf');

describe('sample Alpha PDF integration', () => {
  it('builds proper HTML paragraphs for chapter 1 from real PDF', async (t) => {
    if (!fs.existsSync(SAMPLE)) {
      t.skip('missing _sample_alpha.pdf (local fixture)');
      return;
    }

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(SAMPLE));
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

    const items = [];
    // TOC + early chapters are enough to validate paragraph merge
    const maxPage = Math.min(20, pdf.numPages);
    for (let pageNo = 1; pageNo <= maxPage; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      for (const item of content.items || []) {
        if (!item || item.str == null) continue;
        items.push({
          str: item.str,
          transform: item.transform,
          page: pageNo,
        });
      }
    }

    const story = storyFromPdfTextItems(items, {
      fallbackTitle: 'Theo Duoi Dinh Cap Alpha',
    });

    assert.ok(story.chapters.length >= 1, 'expected at least chapter 1');
    const ch1 = story.chapters.find((c) => /chương\s*1\b/i.test(c.title));
    assert.ok(ch1, 'chapter 1 missing');

    // Must not keep every visual line as its own <p>
    const pCount = (ch1.content.match(/<p>/g) || []).length;
    const plainLen = ch1.content.replace(/<[^>]+>/g, '').length;
    assert.ok(pCount >= 5, `too few paragraphs: ${pCount}`);
    assert.ok(plainLen / pCount > 60, `avg paragraph too short (${plainLen}/${pCount}) — still over-split`);

    assert.match(ch1.content, /Ánh sáng ban mai dịu dàng/i);
    assert.doesNotMatch(ch1.content, /<p>giường có làn da/);
    assert.doesNotMatch(ch1.content, /D T V/i);
  });
});
