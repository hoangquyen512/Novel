# WordPress.com Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép UI tải truyện từ blog `*.wordpress.com` qua Public REST API (tránh 403 challenge HTML), bắt đầu với mục lục kiểu Hồng Bạch Song Hỉ.

**Architecture:** Thêm module `wordpress.js` (URL API + parse mục lục/nội dung) dùng `public-api.wordpress.com/rest/v1.1`. `server.js` detect `wordpress` và gọi module giống nhánh `truyen66`/`giatoc` — không `fetchHtml`. UI chỉ cập nhật placeholder.

**Tech Stack:** Node.js >=18, Express, axios, cheerio, Node built-in test runner (`node --test`)

## Global Constraints

- Không scrape HTML trang WordPress.com (bị 403 JS challenge).
- Chỉ hỗ trợ host `*.wordpress.com` trong phạm vi này.
- Giữ nguyên hành vi `truyenfull` / `dammy` / `truyen66` / `giatoc`.
- API post shape: `title` và `content` là **string** (không phải `{ rendered }`).
- Lấy URL chương từ mục lục — không tự sinh slug (slug không đều: `-03` vs `-4`).
- Bao gồm phiên ngoại nếu nằm trong mục lục.
- Không commit trừ khi user yêu cầu (user rule); bỏ qua bước commit trong plan nếu user chưa bảo commit.

---

## File map

| File | Responsibility |
|------|----------------|
| `wordpress.js` | Pure helpers + fetch story/chapter qua Public API |
| `wordpress.test.js` | Unit tests cho detect host, API URL, collect links, content parse |
| `server.js` | `detectSite` + wire `/api/story-info` và `/api/chapter` |
| `index.html` | Placeholder liệt kê WordPress.com |
| `package.json` | Script `test` → `node --test` |

---

### Task 1: Module URL + collect chapter links (unit tested)

**Files:**
- Create: `wordpress.js`
- Create: `wordpress.test.js`
- Modify: `package.json` (add `"test": "node --test wordpress.test.js"`)

**Interfaces:**
- Consumes: `cheerio` (dev/runtime already in deps)
- Produces:
  - `isWordpressHost(hostname: string): boolean`
  - `buildWordpressPublicPostUrl(hostname: string, slug: string): string`
  - `getWordpressSlug(rawUrl: string): string`
  - `collectWordpressChapterLinks($: CheerioAPI, storyUrl: string): Array<{ title: string, url: string }>`

- [ ] **Step 1: Write the failing test file**

Create `wordpress.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const {
  isWordpressHost,
  buildWordpressPublicPostUrl,
  getWordpressSlug,
  collectWordpressChapterLinks,
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
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `node --test wordpress.test.js`  
Expected: FAIL — `Cannot find module './wordpress'`

- [ ] **Step 3: Implement `wordpress.js` (URL + collect only)**

Create `wordpress.js`:

```js
const cheerio = require('cheerio');
const axios = require('axios');
const { URL } = require('url');

function isWordpressHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return /(^|\.)wordpress\.com$/i.test(host);
}

function buildWordpressPublicPostUrl(hostname, slug) {
  const host = String(hostname || '').toLowerCase();
  const safeSlug = encodeURIComponent(String(slug || '').trim());
  return `https://public-api.wordpress.com/rest/v1.1/sites/${host}/posts/slug:${safeSlug}`;
}

function getWordpressSlug(rawUrl) {
  const pathname = new URL(rawUrl).pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) throw new Error('URL WordPress không hợp lệ');
  return decodeURIComponent(parts[parts.length - 1]);
}

function normalizeUrlKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return '';
  }
}

function collectWordpressChapterLinks($, storyUrl) {
  const storyHost = new URL(storyUrl).hostname.toLowerCase();
  const selfKey = normalizeUrlKey(storyUrl);
  const chapters = [];
  const seen = new Set();

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, storyUrl).href;
    } catch {
      return;
    }

    let parsed;
    try {
      parsed = new URL(abs);
    } catch {
      return;
    }

    if (parsed.hostname.toLowerCase() !== storyHost) return;
    if (/\/feed\/?/i.test(parsed.pathname)) return;
    if (/\/comment-page-/i.test(parsed.pathname)) return;
    if (parsed.hash && /comment/i.test(parsed.hash)) return;

    const key = normalizeUrlKey(abs);
    if (!key || key === selfKey || seen.has(key)) return;

    const title = $(el).text().replace(/\s+/g, ' ').trim() || getWordpressSlug(abs);
    if (!title) return;

    seen.add(key);
    const url = abs.endsWith('/') ? abs : `${abs}/`;
    chapters.push({ title, url });
  });

  return chapters;
}

module.exports = {
  isWordpressHost,
  buildWordpressPublicPostUrl,
  getWordpressSlug,
  collectWordpressChapterLinks,
  // fetch helpers added in Task 2
};
```

- [ ] **Step 4: Add npm test script**

In `package.json` scripts:

```json
"test": "node --test wordpress.test.js"
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`  
Expected: all tests PASS

- [ ] **Step 6: Commit (only if user asked to commit)**

```bash
git add wordpress.js wordpress.test.js package.json
git commit -m "feat: add wordpress.com TOC link helpers"
```

---

### Task 2: Fetch story-info + chapter via Public API

**Files:**
- Modify: `wordpress.js`
- Modify: `wordpress.test.js`

**Interfaces:**
- Consumes: Task 1 exports; `axios`; shared cleaners passed in OR duplicated minimal strip in module
- Produces:
  - `fetchWordpressPost(hostname: string, slug: string): Promise<object>`
  - `fetchWordpressStoryInfo(storyUrl: string, helpers: ContentHelpers): Promise<{ title, totalChapters, totalPages, chapters }>`
  - `fetchWordpressChapter(chapterUrl: string, helpers: ContentHelpers): Promise<{ title, content }>`

`ContentHelpers` (passed from `server.js` to reuse existing cleaners without circular requires):

```js
// shape expected by wordpress.js
{
  stripHiddenElements($, contentEl),
  stripNonTextNoise($, contentEl),
  extractParagraphsFromContent($, contentEl),
  cleanPromoParagraph(text),
  normalizeStoryText(text),
  escapeHtml(text),
}
```

- [ ] **Step 1: Extend tests for API error + HTML→paragraphs with mocked axios**

Append to `wordpress.test.js`:

```js
const { fetchWordpressPost, htmlToChapterContent } = require('./wordpress');

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
```

(Keep `fetchWordpressPost` covered by a small mock later in Step 3, or live smoke in Task 4.)

- [ ] **Step 2: Run new test — expect FAIL**

Run: `node --test wordpress.test.js`  
Expected: FAIL — `htmlToChapterContent` / export missing

- [ ] **Step 3: Implement fetch + content helpers in `wordpress.js`**

Append/replace exports in `wordpress.js`:

```js
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
};

async function fetchWordpressPost(hostname, slug) {
  const url = buildWordpressPublicPostUrl(hostname, slug);
  try {
    const response = await axios.get(url, {
      headers: BROWSER_HEADERS,
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    if (response.status === 404 || response.data?.error) {
      throw new Error(response.data?.message || 'Không tìm thấy bài WordPress');
    }
    if (response.status >= 400) {
      throw new Error(`WordPress API HTTP ${response.status}`);
    }
    return response.data;
  } catch (err) {
    if (err.response?.data?.message) {
      throw new Error(err.response.data.message);
    }
    throw err;
  }
}

function decodeBasicEntities(text) {
  return cheerio.load(`<span>${text || ''}</span>`)('span').text().replace(/\s+/g, ' ').trim();
}

function htmlToChapterContent(html, helpers) {
  const $ = cheerio.load(`<div id="wp-chapter">${html || ''}</div>`);
  const contentEl = $('#wp-chapter').clone();

  contentEl
    .find(
      [
        '.sharedaddy',
        '.jp-relatedposts',
        '.wp-block-jetpack-wordads',
        '.wordads-ad-wrapper',
        '.code-block',
        'nav',
        'aside',
        'header',
        'footer',
        '.entry-meta',
      ].join(', ')
    )
    .remove();

  helpers.stripHiddenElements($, contentEl);
  helpers.stripNonTextNoise($, contentEl);

  const paragraphs = helpers.extractParagraphsFromContent($, contentEl);
  let content = paragraphs.length ? paragraphs.join('\n') : '';
  if (!content) {
    const rawText = helpers.cleanPromoParagraph(helpers.normalizeStoryText(contentEl.text()));
    content = rawText ? `<p>${helpers.escapeHtml(rawText)}</p>` : '';
  }
  return content;
}

async function fetchWordpressStoryInfo(storyUrl) {
  const hostname = new URL(storyUrl).hostname;
  const slug = getWordpressSlug(storyUrl);
  const post = await fetchWordpressPost(hostname, slug);

  const title = decodeBasicEntities(post.title || '') || slug;
  const $ = cheerio.load(post.content || '');
  const chapters = collectWordpressChapterLinks($, storyUrl);

  if (!chapters.length) {
    throw new Error('Không tìm thấy danh sách chương trên WordPress.com');
  }

  return {
    title,
    totalChapters: chapters.length,
    totalPages: 1,
    chapters,
  };
}

async function fetchWordpressChapter(chapterUrl, helpers) {
  const hostname = new URL(chapterUrl).hostname;
  const slug = getWordpressSlug(chapterUrl);
  const post = await fetchWordpressPost(hostname, slug);
  const title = decodeBasicEntities(post.title || '') || slug;
  const content = htmlToChapterContent(post.content || '', helpers);

  if (!content) {
    throw new Error('Không tìm thấy nội dung chương trên WordPress.com');
  }

  return { title, content };
}

module.exports = {
  isWordpressHost,
  buildWordpressPublicPostUrl,
  getWordpressSlug,
  collectWordpressChapterLinks,
  fetchWordpressPost,
  htmlToChapterContent,
  fetchWordpressStoryInfo,
  fetchWordpressChapter,
};
```

- [ ] **Step 4: Run unit tests — expect PASS**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add wordpress.js wordpress.test.js
git commit -m "feat: fetch wordpress.com story and chapter via public API"
```

---

### Task 3: Wire `server.js` + UI placeholder

**Files:**
- Modify: `server.js` (`detectSite`, `/api/story-info`, `/api/chapter`)
- Modify: `index.html` (placeholder)

**Interfaces:**
- Consumes: `fetchWordpressStoryInfo`, `fetchWordpressChapter`, `isWordpressHost` from `./wordpress`
- Produces: API JSON shape unchanged for frontend

- [ ] **Step 1: Require module and extend `detectSite`**

Near top of `server.js` (after other requires):

```js
const {
  isWordpressHost,
  fetchWordpressStoryInfo,
  fetchWordpressChapter,
} = require('./wordpress');
```

In `detectSite`, after host parse, before/after other checks:

```js
if (isWordpressHost(host)) return 'wordpress';
```

- [ ] **Step 2: Wire story-info + chapter routes**

In `/api/story-info`, before HTML fetch:

```js
if (site === 'wordpress') {
  return res.json(await fetchWordpressStoryInfo(storyUrl));
}
```

In `/api/chapter`:

```js
if (site === 'wordpress') {
  return res.json(
    await fetchWordpressChapter(chapterUrl, {
      stripHiddenElements,
      stripNonTextNoise,
      extractParagraphsFromContent,
      cleanPromoParagraph,
      normalizeStoryText,
      escapeHtml,
    })
  );
}
```

- [ ] **Step 3: Update placeholder in `index.html`**

Change the `storyUrl` input `placeholder` to include WordPress.com, e.g.:

```html
placeholder="https://truyenfull.live/... · https://dammy.cc/... · https://truyen66.com/... · https://….wordpress.com/..."
```

(Keep existing sources; append WordPress.com.)

- [ ] **Step 4: Smoke-check syntax**

Run: `node --check server.js`  
Expected: no output, exit 0

Run: `node --check wordpress.js`  
Expected: exit 0

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add server.js index.html
git commit -m "feat: enable wordpress.com downloads in API and UI"
```

---

### Task 4: Live verification against Hồng Bạch Song Hỉ

**Files:**
- None (manual / curl against running server)
- Optional cleanup: delete probe artifacts `_wp_*.html`, `_wp_*.json`, `_wp_cookies.txt`, `_wp_chapters.txt` if still present

**Interfaces:**
- Consumes: running `npm start` on PORT 3456 (or current `PORT`)

- [ ] **Step 1: Start server**

Run: `npm start`  
Expected: `Server đang chạy tại http://0.0.0.0:3456` (or configured HOST/PORT)

- [ ] **Step 2: story-info smoke**

Run:

```bash
curl.exe -s "http://127.0.0.1:3456/api/story-info?url=https%3A%2F%2Fotruyennhamoctoly.wordpress.com%2F2025%2F11%2F05%2Fhong-bach-song-hi%2F" -o story-info-out.json
```

Check with PowerShell:

```powershell
$j = Get-Content story-info-out.json -Raw -Encoding UTF8 | ConvertFrom-Json
$j.title
$j.totalChapters
$j.chapters[0].url
$j.chapters[-1].url
```

Expected:
- `title` chứa “Hồng Bạch”
- `totalChapters` ≈ 90 (84 + phiên ngoại)
- first URL chứa `hong-bach-song-hi-1`
- last URL chứa `phien-ngoai`

- [ ] **Step 3: chapter smoke**

```bash
curl.exe -s "http://127.0.0.1:3456/api/chapter?url=https%3A%2F%2Fotruyennhamoctoly.wordpress.com%2F2025%2F11%2F05%2Fhong-bach-song-hi-1%2F" -o chapter-out.json
```

Expected JSON: `title` + `content` với nhiều `<p>`, có chữ “An Bình” (nhân vật chương 1), không còn chuỗi `Checking your browser`.

- [ ] **Step 4: UI check**

Mở `http://127.0.0.1:3456/`, dán link mục lục, bấm **Bắt Đầu Tải Về** — không còn `Request failed with status code 403`; progress chạy và hiện draft ready.

- [ ] **Step 5: Regression quick check**

Gọi health:

```bash
curl.exe -s http://127.0.0.1:3456/api/health
```

Expected: `{"ok":true,...}`

(Không bắt buộc tải full truyenfull trong task này nếu mạng chậm; chỉ cần wordpress path xanh.)

- [ ] **Step 6: Cleanup probe files**

Delete if present: `_wp_probe.html`, `_wp_chap1.html`, `_wp_try1.html`, `_wp_try2.html`, `_wp_api.json`, `_wp_api_chap1.json`, `_wp_fields.json`, `_wp_miss.json`, `_wp_json_v2.json`, `_wp_json_pages.json`, `_wp_cookies.txt`, `_wp_chapters.txt`, `story-info-out.json`, `chapter-out.json`

- [ ] **Step 7: Commit (only if user asked)**

```bash
git add -A
git status
# commit only implementation files, not probe leftovers
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| detect `*.wordpress.com` | Task 3 |
| Public API story-info | Task 2–3 |
| Collect TOC links in order + phiên ngoại | Task 1–2 |
| Chapter via API + paragraph HTML | Task 2–3 |
| No HTML scrape / fix 403 | Task 2–4 |
| UI placeholder | Task 3 |
| Error when missing post / empty TOC | Task 2 |
| Uneven slugs from TOC only | Task 1 |
| Leave other sites alone | Task 3 (branch only) |
| Live verify HBSH | Task 4 |

## Placeholder / consistency self-review

- No TBD left in steps.
- API field names use `title` / `content` strings (v1.1), not `rendered`.
- Export names consistent across tasks: `fetchWordpressStoryInfo`, `fetchWordpressChapter`, `htmlToChapterContent`.
- `ContentHelpers` injected from `server.js` to reuse existing cleaners without moving them.
