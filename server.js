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

function normalizeStoryUrl(rawUrl) {
  const parsed = new URL(rawUrl.trim());
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname) {
    throw new Error('URL không hợp lệ');
  }
  return `${parsed.origin}${pathname}/`;
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

function extractChapterContent($) {
  const contentEl = $('#chapter-c, .chapter-c').first().clone();
  if (!contentEl.length) {
    throw new Error('Không tìm thấy nội dung chương (#chapter-c)');
  }

  contentEl.find(
    'script, style, iframe, [id^="ads-"], .ads-content, .adsbygoogle, .ads-chapter-box, .incontent-ad, .ads-responsive'
  ).remove();

  const paragraphs = [];
  contentEl.find('p').each((_, el) => {
    const inner = $(el).html()?.replace(/\s+/g, ' ').trim();
    if (inner) {
      paragraphs.push(`<p>${inner}</p>`);
    }
  });

  if (paragraphs.length) {
    return paragraphs.join('\n');
  }

  const rawText = contentEl.text().replace(/\s+/g, ' ').trim();
  return rawText ? `<p>${escapeHtml(rawText)}</p>` : '';
}

app.get('/api/story-info', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Thiếu tham số url' });
    }

    const storyUrl = normalizeStoryUrl(url);
    const html = await fetchHtml(storyUrl);
    const $ = cheerio.load(html);

    const title =
      $('h3.title, h1.title').first().text().trim() ||
      $('title').text().split('-')[0].trim();

    let chapters = await fetchChaptersViaAjax(storyUrl, $, title);
    if (!chapters || chapters.length === 0) {
      chapters = await fetchChaptersViaPagination(storyUrl, $);
    }

    if (!chapters.length) {
      return res.status(404).json({ error: 'Không tìm thấy danh sách chương' });
    }

    const maxPage = Math.max(
      parseInt($('#total-page').attr('value') || '1', 10),
      getMaxPageFromPagination($)
    );

    res.json({
      title,
      totalChapters: chapters.length,
      totalPages: maxPage,
      chapters,
    });
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

    const chapterUrl = url.trim();
    const html = await fetchHtml(chapterUrl);
    const $ = cheerio.load(html);

    const title =
      $('.chapter-title, .chapter-c-title, h2').first().text().trim() ||
      $('title').text().split(':').slice(-1)[0].trim();

    const content = extractChapterContent($);

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
