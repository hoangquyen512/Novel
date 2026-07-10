const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '0.0.0.0';

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

async function fetchHtml(url, referer) {
  const response = await axios.get(url, {
    headers: {
      ...BROWSER_HEADERS,
      ...(referer ? { Referer: referer } : {}),
    },
    timeout: 30000,
    maxRedirects: 5,
    responseType: 'text',
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return response.data;
}

function detectSite(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('dammy.me')) return 'dammy';
  if (host.includes('truyenfull')) return 'truyenfull';
  return 'generic';
}

function normalizeStoryUrl(rawUrl) {
  const parsed = new URL(rawUrl.trim());
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname) {
    throw new Error('URL không hợp lệ');
  }
  if (pathname.endsWith('.html')) {
    return `${parsed.origin}${pathname}`;
  }
  return `${parsed.origin}${pathname}/`;
}

function normalizeChapterUrl(rawUrl) {
  return rawUrl.trim();
}

function toAbsoluteUrl(baseUrl, href) {
  if (!href) return '';
  return new URL(href, baseUrl).href;
}

function getMaxPageFromPagination($) {
  let maxPage = 1;

  $('.pagination li a, .pagination a').each((_, el) => {
    const text = $(el).text().trim();
    const pageNum = parseInt(text, 10);
    if (!Number.isNaN(pageNum)) {
      maxPage = Math.max(maxPage, pageNum);
    }

    const href = $(el).attr('href') || '';
    const patterns = [
      /[?&]trang=(\d+)/i,
      /\/trang-(\d+)\/?/i,
      /[?&]page=(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = href.match(pattern);
      if (match) {
        maxPage = Math.max(maxPage, parseInt(match[1], 10));
      }
    }
  });

  return maxPage;
}

function collectChapterLinks($, baseUrl, chapters, seen) {
  $('.list-chapter a, .list-chapters a').each((_, el) => {
    const title = $(el).attr('title') || $(el).text().trim();
    const href = toAbsoluteUrl(baseUrl, $(el).attr('href'));
    if (!href || seen.has(href)) return;
    seen.add(href);
    chapters.push({ title, url: href });
  });
}

function collectDammyChapterLinks($, baseUrl) {
  const chapters = [];
  const seen = new Set();

  $('.list-chapters a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/chuong-\d+/i.test(href)) return;

    const title = $(el).text().replace(/\s+/g, ' ').trim();
    const abs = toAbsoluteUrl(baseUrl, href);
    if (!title || seen.has(abs)) return;

    seen.add(abs);
    chapters.push({ title, url: abs });
  });

  chapters.reverse();
  return chapters;
}

function getStoryTitle($, site) {
  if (site === 'dammy') {
    return (
      $('h2.card-title[itemprop="name"]').first().text().trim() ||
      $('h1 span[itemprop="name"]').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('title').text().split('-')[0].trim()
    );
  }

  return (
    $('h3.title, h1.title').first().text().trim() ||
    $('title').text().split('-')[0].trim()
  );
}

function cleanDammyContentHtml($, contentEl) {
  contentEl.find('script, style, iframe, input, button, form').remove();
  contentEl.find('span').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.children().length === 0) {
      $el.remove();
    }
  });
}

function extractParagraphsFromContent($, contentEl) {
  const paragraphs = [];
  contentEl.find('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) {
      paragraphs.push(`<p>${escapeHtml(text)}</p>`);
    }
  });
  return paragraphs;
}

function extractTruyenfullChapterContent($) {
  const contentEl = $('#chapter-c, .chapter-c').first().clone();
  if (!contentEl.length) {
    throw new Error('Không tìm thấy nội dung chương (#chapter-c)');
  }

  contentEl.find(
    'script, style, iframe, [id^="ads-"], .ads-content, .adsbygoogle, .ads-chapter-box, .incontent-ad, .ads-responsive'
  ).remove();

  const paragraphs = extractParagraphsFromContent($, contentEl);
  if (paragraphs.length) {
    return paragraphs.join('\n');
  }

  const rawText = contentEl.text().replace(/\s+/g, ' ').trim();
  return rawText ? `<p>${escapeHtml(rawText)}</p>` : '';
}

function extractDammyChapterContent($) {
  const contentEl = $('#chapter-content-render, .chapter-content').first().clone();
  if (!contentEl.length) {
    throw new Error('Không tìm thấy nội dung chương (.chapter-content)');
  }

  cleanDammyContentHtml($, contentEl);

  const paragraphs = extractParagraphsFromContent($, contentEl);
  if (paragraphs.length) {
    return paragraphs.join('\n');
  }

  const rawText = contentEl.text().replace(/\s+/g, ' ').trim();
  return rawText ? `<p>${escapeHtml(rawText)}</p>` : '';
}

function extractChapterContent($, site) {
  if (site === 'dammy') {
    return extractDammyChapterContent($);
  }
  return extractTruyenfullChapterContent($);
}

function getChapterTitle($, site) {
  if (site === 'dammy') {
    return (
      $('#chapter_title').attr('value')?.trim() ||
      $('h1.card-title').text().split(' - ').slice(-1)[0]?.trim() ||
      $('.breadcrumb-item.active').text().trim() ||
      $('title').text().split('-')[1]?.trim()
    );
  }

  return (
    $('.chapter-title, .chapter-c-title, h2').first().text().trim() ||
    $('title').text().split(':').slice(-1)[0].trim()
  );
}

async function fetchDammyStoryInfo(storyUrl, $) {
  const title = getStoryTitle($, 'dammy');
  const chapters = collectDammyChapterLinks($, storyUrl);

  if (!chapters.length) {
    throw new Error('Không tìm thấy danh sách chương trên dammy.me');
  }

  return {
    title,
    totalChapters: chapters.length,
    totalPages: 1,
    chapters,
  };
}

async function fetchTruyenfullStoryInfo(storyUrl, $) {
  const title = getStoryTitle($, 'truyenfull');

  let chapters = await fetchChaptersViaAjax(storyUrl, $, title);
  if (!chapters || chapters.length === 0) {
    chapters = await fetchChaptersViaPagination(storyUrl, $);
  }

  if (!chapters.length) {
    throw new Error('Không tìm thấy danh sách chương');
  }

  const maxPage = Math.max(
    parseInt($('#total-page').attr('value') || '1', 10),
    getMaxPageFromPagination($)
  );

  return {
    title,
    totalChapters: chapters.length,
    totalPages: maxPage,
    chapters,
  };
}

function getAjaxBase(origin) {
  if (origin.includes('truyenfull.vn')) return 'https://truyenfull.vn/ajax.php';
  return 'https://truyenfull.today/ajax.php';
}

async function fetchChaptersViaAjax(storyUrl, $, title) {
  const truyenId = $('#truyen-id').attr('value');
  const truyenAscii = $('#truyen-ascii').attr('value') || '';
  const totalPageInput = parseInt($('#total-page').attr('value') || '1', 10);
  const maxFromPagination = getMaxPageFromPagination($);
  const totalPage = Math.max(totalPageInput || 1, maxFromPagination || 1);

  if (!truyenId) {
    return null;
  }

  const origin = new URL(storyUrl).origin;
  const ajaxBase = getAjaxBase(origin);
  const chapters = [];
  const seen = new Set();

  for (let page = 1; page <= totalPage; page++) {
    const params = new URLSearchParams({
      type: 'list_chapter',
      tid: truyenId,
      tascii: truyenAscii,
      tname: title,
      page: String(page),
      totalp: String(totalPage),
    });

    const response = await axios.get(`${ajaxBase}?${params.toString()}`, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: storyUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 30000,
    });

    const chapList = response.data?.chap_list;
    if (!chapList) continue;

    const $page = cheerio.load(chapList);
    collectChapterLinks($page, storyUrl, chapters, seen);

    if (page < totalPage) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return chapters;
}

async function fetchChaptersViaPagination(storyUrl, $) {
  const chapters = [];
  const seen = new Set();
  collectChapterLinks($, storyUrl, chapters, seen);

  const maxPage = getMaxPageFromPagination($);
  if (maxPage <= 1) {
    return chapters;
  }

  for (let page = 2; page <= maxPage; page++) {
    const pageUrl = `${storyUrl}?trang=${page}`;
    const html = await fetchHtml(pageUrl, storyUrl);
    const $page = cheerio.load(html);
    collectChapterLinks($page, storyUrl, chapters, seen);
  }

  return chapters;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/api/story-info', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Thiếu tham số url' });
    }

    const storyUrl = normalizeStoryUrl(url);
    const site = detectSite(storyUrl);
    const html = await fetchHtml(storyUrl);
    const $ = cheerio.load(html);

    const result =
      site === 'dammy'
        ? await fetchDammyStoryInfo(storyUrl, $)
        : await fetchTruyenfullStoryInfo(storyUrl, $);

    res.json(result);
  } catch (error) {
    console.error('story-info error:', error.message);
    res.status(500).json({
      error: error.message || 'Không thể lấy thông tin truyện',
    });
  }
});

app.get('/api/chapter', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Thiếu tham số url' });
    }

    const chapterUrl = normalizeChapterUrl(url);
    const site = detectSite(chapterUrl);
    const html = await fetchHtml(chapterUrl);
    const $ = cheerio.load(html);

    const title = getChapterTitle($, site);
    const content = extractChapterContent($, site);

    res.json({ title, content });
  } catch (error) {
    console.error('chapter error:', error.message);
    res.status(500).json({
      error: error.message || 'Không thể lấy nội dung chương',
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'novel-downloader', env: process.env.NODE_ENV || 'development' });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server đang chạy tại http://${HOST}:${PORT}`);
});
