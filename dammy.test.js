const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const fs = require('fs');
const {
  extractDammyChapterContent,
  unlockDammyChapterContent,
} = require('./dammy');

function buildCssContentMap($) {
  const map = {};
  const chunks = [];
  $('style').each((_, el) => chunks.push($(el).html() || ''));
  const css = chunks.join('\n');
  const re =
    /\.([a-zA-Z0-9_-]+)\s*::?(?:before|after)\s*\{\s*content\s*:\s*["']([^"']*)["']/gi;
  let match;
  while ((match = re.exec(css))) map[match[1]] = match[2];
  return map;
}

function restoreCssPseudoContent($, root, contentMap) {
  root.find('span').each((_, el) => {
    const $el = $(el);
    if ($el.children().length) return;
    const ownText = ($el.text() || '').trim();
    const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean);
    const words = classes
      .filter((cls) => Object.prototype.hasOwnProperty.call(contentMap, cls))
      .map((cls) => contentMap[cls]);
    if (!words.length) return;
    if (!ownText || words.includes(ownText)) {
      $el.replaceWith(` ${words.join(' ')} `);
    }
  });
}

function stripHiddenElements($, contentEl) {
  contentEl.find('[style]').each((_, el) => {
    if ($(el).hasClass('actac') || $(el).closest('.actac').length) return;
    const style = String($(el).attr('style') || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (style.includes('display:none')) $(el).remove();
  });
}

function stripNonTextNoise($, contentEl) {
  contentEl.find('.actcl, script, style, iframe, img').remove();
}

function extractParagraphsFromContent($, contentEl) {
  const out = [];
  contentEl.find('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) out.push(`<p>${text}</p>`);
  });
  return out;
}

const deps = {
  buildCssContentMap,
  restoreCssPseudoContent,
  stripHiddenElements,
  stripNonTextNoise,
  extractParagraphsFromContent,
  cleanPromoParagraph: (t) => t,
  normalizeStoryText: (t) => String(t || '').replace(/\s+/g, ' ').trim(),
  escapeHtml: (t) =>
    String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
};

describe('unlockDammyChapterContent', () => {
  it('promotes .actac body and drops Shopee .actcl gate', () => {
    const $ = cheerio.load(`
      <div id="chapter-content-render">
        <div class="actcl" style="display:block">
          <p>Mời Quý độc giả CLICK mở ứng dụng Shopee</p>
          <a href="https://s.shopee.vn/x">unlock</a>
        </div>
        <div class="actac" style="display:none">
          <p>Từ khi tận mắt chứng kiến bản lĩnh phi phàm.</p>
          <p>Ngày hôm đó gã nghĩ quẩn đến mức thách thức uy quyền.</p>
        </div>
      </div>
    `);
    const root = $('#chapter-content-render');
    unlockDammyChapterContent($, root);
    assert.equal(root.find('.actcl').length, 0);
    assert.equal(root.find('.actac').length, 1);
    const style = (root.find('.actac').attr('style') || '').toLowerCase().replace(/\s+/g, '');
    assert.ok(!style.includes('display:none'));
    assert.match(root.text(), /bản lĩnh phi phàm/);
    assert.doesNotMatch(root.text(), /Shopee/);
  });
});

describe('extractDammyChapterContent', () => {
  it('returns full chapter text even when locked behind actac display:none', () => {
    const html = `
      <html><head>
        <style>
          .w-aaa::before { content: "ấy"; }
        </style>
      </head><body>
        <div class="chapter-content">
          <div id="chapter-content-render">
            <div class="actcl" style="display:block">
              <p>Mời Quý độc giả CLICK vào liên kết Shopee</p>
            </div>
            <div class="actac" style="display:none">
              <p>Ngày hôm <span class="w-aaa"></span>, trời quang mây tạnh.</p>
              <p>Tề Việt bước tiếp cuộc sống nghỉ hưu.</p>
            </div>
          </div>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const content = extractDammyChapterContent($, deps);
    assert.match(content, /Ngày hôm ấy/);
    assert.match(content, /Tề Việt bước tiếp/);
    assert.doesNotMatch(content, /Shopee/i);
    assert.doesNotMatch(content, /CLICK/i);
  });

  it('extracts real locked chapter 279 fixture from dammy.cc', (t) => {
    if (!fs.existsSync('_dammy_chap279.html')) {
      t.skip('missing _dammy_chap279.html fixture');
      return;
    }
    const $ = cheerio.load(fs.readFileSync('_dammy_chap279.html', 'utf8'));
    const content = extractDammyChapterContent($, deps);
    const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(plain.length > 5000, `expected long body, got ${plain.length}`);
    assert.match(plain, /Tiểu Đoàn Tử|Lăng Diên Thừa|Tề Việt/);
    assert.doesNotMatch(plain, /mở ứng dụng Shopee/i);
  });
});
