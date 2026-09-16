const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const axios = require('axios');
const {
  isWordpressHost,
  buildWordpressPublicPostUrl,
  getWordpressSlug,
  collectWordpressChapterLinks,
  fetchWordpressPost,
  htmlToChapterContent,
  fetchWordpressStoryInfo,
  fetchWordpressChapter,
} = require('./wordpress');

describe('isWordpressHost', () => {
  it('matches wordpress.com subdomains', () => {
    assert.equal(isWordpressHost('otruyennhamoctoly.wordpress.com'), true);
    assert.equal(isWordpressHost('foo.wordpress.com'), true);
  });

  it('rejects other hosts', () => {
    assert.equal(isWordpressHost('truyen66.com'), false);
    assert.equal(isWordpressHost('wordpress.org'), false);
  });
});

describe('buildWordpressPublicPostUrl', () => {
  it('builds public API slug URL', () => {
    assert.equal(
      buildWordpressPublicPostUrl('otruyennhamoctoly.wordpress.com', 'hong-bach-song-hi'),
      'https://public-api.wordpress.com/rest/v1.1/sites/otruyennhamoctoly.wordpress.com/posts/slug:hong-bach-song-hi'
    );
  });
});

describe('getWordpressSlug', () => {
  it('takes last path segment', () => {
    assert.equal(
      getWordpressSlug('https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi/'),
      'hong-bach-song-hi'
    );
    assert.equal(
      getWordpressSlug('https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi-1/'),
      'hong-bach-song-hi-1'
    );
  });
});

describe('collectWordpressChapterLinks', () => {
  it('keeps TOC order, skips feed/self, keeps uneven slugs', () => {
    const storyUrl = 'https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi/';
    const html = `
      <a href="${storyUrl}">self</a>
      <a href="${storyUrl}feed/">feed</a>
      <a href="https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi-1/">01</a>
      <a href="https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi-03/">03</a>
      <a href="https://otruyennhamoctoly.wordpress.com/2026/01/14/hong-bach-song-hi-phien-ngoai-1/">pn1</a>
      <a href="https://other.example/x">other</a>
    `;
    const $ = cheerio.load(html);
    const chapters = collectWordpressChapterLinks($, storyUrl);
    assert.equal(chapters.length, 3);
    assert.deepEqual(chapters.map((c) => c.title), ['01', '03', 'pn1']);
    assert.match(chapters[1].url, /hong-bach-song-hi-03\/?$/);
  });
});

describe('htmlToChapterContent', () => {
  it('extracts paragraphs and drops share blocks', () => {
    const helpers = {
      stripHiddenElements() {},
      stripNonTextNoise() {},
      extractParagraphsFromContent($, contentEl) {
        const out = [];
        contentEl.find('p').each((_, el) => {
          const t = $(el).text().trim();
          if (t) out.push(`<p>${t}</p>`);
        });
        return out;
      },
      cleanPromoParagraph: (t) => t,
      normalizeStoryText: (t) => t,
      escapeHtml: (t) => t,
    };
    const html = `
      <div class="sharedaddy">share</div>
      <p><strong>Chương 1</strong></p>
      <p>Câu chuyện bắt đầu.</p>
    `;
    const content = htmlToChapterContent(html, helpers);
    assert.match(content, /Câu chuyện bắt đầu/);
    assert.doesNotMatch(content, /share/);
  });
});

describe('fetchWordpressPost', () => {
  it('throws on 404 with API message', async () => {
    const originalGet = axios.get;
    axios.get = async () => ({
      status: 404,
      data: { error: 'not_found', message: 'Không tìm thấy bài WordPress' },
    });
    try {
      await assert.rejects(
        () => fetchWordpressPost('example.wordpress.com', 'missing-slug'),
        { message: 'Không tìm thấy bài WordPress' }
      );
    } finally {
      axios.get = originalGet;
    }
  });

  it('throws on HTTP 500', async () => {
    const originalGet = axios.get;
    axios.get = async () => ({ status: 500, data: {} });
    try {
      await assert.rejects(
        () => fetchWordpressPost('example.wordpress.com', 'slug'),
        /WordPress API HTTP 500/
      );
    } finally {
      axios.get = originalGet;
    }
  });
});

describe('fetchWordpressStoryInfo', () => {
  it('returns title and chapters from mocked API', async () => {
    const storyUrl = 'https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi/';
    const originalGet = axios.get;
    axios.get = async (url) => {
      assert.match(url, /hong-bach-song-hi/);
      return {
        status: 200,
        data: {
          title: 'Hồng Bạch Song Hi',
          content: `
            <a href="https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi-1/">Chương 1</a>
            <a href="https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi-2/">Chương 2</a>
          `,
        },
      };
    };
    try {
      const info = await fetchWordpressStoryInfo(storyUrl);
      assert.equal(info.title, 'Hồng Bạch Song Hi');
      assert.equal(info.totalChapters, 2);
      assert.equal(info.totalPages, 1);
      assert.equal(info.chapters.length, 2);
    } finally {
      axios.get = originalGet;
    }
  });

  it('throws when no chapter links in content', async () => {
    const storyUrl = 'https://example.wordpress.com/story/';
    const originalGet = axios.get;
    axios.get = async () => ({
      status: 200,
      data: { title: 'Empty', content: '<p>No links</p>' },
    });
    try {
      await assert.rejects(
        () => fetchWordpressStoryInfo(storyUrl),
        /Không tìm thấy danh sách chương/
      );
    } finally {
      axios.get = originalGet;
    }
  });
});

describe('fetchWordpressChapter', () => {
  it('returns title and cleaned content', async () => {
    const chapterUrl = 'https://example.wordpress.com/chapter-1/';
    const helpers = {
      stripHiddenElements() {},
      stripNonTextNoise() {},
      extractParagraphsFromContent($, contentEl) {
        const out = [];
        contentEl.find('p').each((_, el) => {
          const t = $(el).text().trim();
          if (t) out.push(`<p>${t}</p>`);
        });
        return out;
      },
      cleanPromoParagraph: (t) => t,
      normalizeStoryText: (t) => t,
      escapeHtml: (t) => t,
    };
    const originalGet = axios.get;
    axios.get = async () => ({
      status: 200,
      data: {
        title: 'Chương 1',
        content: '<div class="sharedaddy">share</div><p>Nội dung chương.</p>',
      },
    });
    try {
      const result = await fetchWordpressChapter(chapterUrl, helpers);
      assert.equal(result.title, 'Chương 1');
      assert.match(result.content, /Nội dung chương/);
      assert.doesNotMatch(result.content, /share/);
    } finally {
      axios.get = originalGet;
    }
  });
});
