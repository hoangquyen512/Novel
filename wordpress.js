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
