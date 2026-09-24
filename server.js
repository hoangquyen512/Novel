const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');
const {
  isWordpressHost,
  fetchWordpressStoryInfo,
  fetchWordpressChapter,
} = require('./wordpress');
const { extractDammyChapterContent: extractDammyChapterContentCore } = require('./dammy');
const feedbackStore = require('./feedback-store');

// Load .env (local) without extra dependency
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] != null) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (_) {
    /* ignore */
  }
})();

const app = express();
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '0.0.0.0';

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32kb' }));
express.static.mime.define({ 'application/javascript': ['mjs'] });
app.use(express.static(path.join(__dirname)));

const FEEDBACK_MAX_MESSAGE = 5000;
const feedbackRateMap = new Map();
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const ADMIN_SESSION_SECRET = (
  process.env.ADMIN_SESSION_SECRET ||
  crypto.randomBytes(24).toString('hex')
).trim();
const ADMIN_COOKIE = 'dac_admin';
const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function checkFeedbackRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxHits = 8;
  const entry = feedbackRateMap.get(ip) || { hits: [] };
  entry.hits = entry.hits.filter((t) => now - t < windowMs);
  if (entry.hits.length >= maxHits) {
    feedbackRateMap.set(ip, entry);
    return false;
  }
  entry.hits.push(now);
  feedbackRateMap.set(ip, entry);
  return true;
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function signAdminToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(body).digest('base64url');
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.exp < Date.now()) return null;
    if (payload.u !== ADMIN_USER) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearAdminCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASS) {
    return res.status(503).json({
      ok: false,
      error: 'Chưa cấu hình ADMIN_PASS trên server.',
    });
  }
  const cookies = parseCookies(req);
  const payload = verifyAdminToken(cookies[ADMIN_COOKIE]);
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Chưa đăng nhập admin.' });
  }
  req.admin = payload;
  return next();
}

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

/** truyen66.com (nginx) chặn UA desktop Chrome/Firefox → 403; dùng UA kiểu bot/mobile. */
const TRUYEN66_HEADERS = {
  'User-Agent': 'WordPress/6.4; https://truyen66.com',
  Accept: 'application/json',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryWaitMs(headers, attempt) {
  const raw = headers?.['retry-after'] || headers?.['Retry-After'];
  const retryAfter = parseInt(raw, 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return Math.min(30000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 300);
}

function isRateLimitedStatus(status) {
  return status === 429 || status === 503;
}

async function fetchHtml(url, referer) {
  const maxRetries = 5;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          ...BROWSER_HEADERS,
          ...(referer ? { Referer: referer } : {}),
        },
        timeout: 30000,
        maxRedirects: 5,
        responseType: 'text',
        validateStatus: (status) =>
          (status >= 200 && status < 400) || isRateLimitedStatus(status),
      });

      if (isRateLimitedStatus(response.status)) {
        if (attempt === maxRetries) {
          throw new Error(
            `Site tạm chặn tải quá nhanh (HTTP ${response.status}). Đợi 1–2 phút rồi thử lại.`
          );
        }
        await sleep(getRetryWaitMs(response.headers, attempt));
        continue;
      }

      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (isRateLimitedStatus(status) && attempt < maxRetries) {
        await sleep(getRetryWaitMs(error.response?.headers, attempt));
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Không thể tải trang');
}

async function fetchJson(url, referer, extraHeaders = {}) {
  const maxRetries = 5;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'application/json',
          ...(referer ? { Referer: referer } : {}),
          ...extraHeaders,
        },
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (status) =>
          (status >= 200 && status < 400) || isRateLimitedStatus(status),
      });

      if (isRateLimitedStatus(response.status)) {
        if (attempt === maxRetries) {
          throw new Error(
            `Site tạm chặn tải quá nhanh (HTTP ${response.status}). Đợi 1–2 phút rồi thử lại.`
          );
        }
        await sleep(getRetryWaitMs(response.headers, attempt));
        continue;
      }

      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (isRateLimitedStatus(status) && attempt < maxRetries) {
        await sleep(getRetryWaitMs(error.response?.headers, attempt));
        lastError = error;
        continue;
      }
      if (isRateLimitedStatus(status)) {
        throw new Error(
          `Site tạm chặn tải quá nhanh (HTTP ${status}). Đợi 1–2 phút rồi thử lại.`
        );
      }
      throw error;
    }
  }

  throw lastError || new Error('Không thể tải JSON');
}

function decodeWpRendered(html) {
  return cheerio
    .load(`<span>${html || ''}</span>`)('span')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

function getPathSlug(rawUrl) {
  const pathname = new URL(rawUrl).pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) {
    throw new Error('URL không hợp lệ');
  }
  return decodeURIComponent(parts[parts.length - 1]);
}

function detectSite(url) {
  const host = new URL(url).hostname.toLowerCase();
  // dammy.me đã chuyển sang dammy.cc (cùng markup / scraper)
  if (/(^|\.)dammy\.(me|cc)$/i.test(host) || host.includes('dammy.me') || host.includes('dammy.cc')) {
    return 'dammy';
  }
  if (isWordpressHost(host)) {
    return 'wordpress';
  }
  if (/(^|\.)truyen66\.com$/i.test(host) || host.includes('truyen66.com')) {
    return 'truyen66';
  }
  if (/(^|\.)giatocvuongtai\.com$/i.test(host) || host.includes('giatocvuongtai.com')) {
    return 'giatoc';
  }
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

const VI_LETTER = 'A-ZÀ-ỹĐa-zà-ỹđ';

/**
 * Gộp/thay chữ bị tách dấu (né kiểm duyệt) thành từ bình thường:
 * "c. h. ế. t" / "c*h*ế*t" / "c.\nh.\nế." → "chết"
 */
function collapseDottedLetterObfuscation(text) {
  if (!text) return text;
  const DOT_SEP = '[.·．•‧*＊\\-]';
  let s = String(text);

  s = s.replace(
    new RegExp(`([${VI_LETTER}])\\s*${DOT_SEP}\\s*\\n+\\s*`, 'gi'),
    '$1. '
  );

  const known = [
    'chết', 'chửi', 'địt', 'đụ', 'đái', 'lồn', 'cặc', 'đéo', 'đĩ', 'điếm',
    'hiếp', 'chịch', 'liếm', 'bú', 'mút', 'dâm', 'đít', 'vú',
    'fuck', 'shit', 'sex',
  ].sort((a, b) => b.length - a.length);

  for (const word of known) {
    const chars = Array.from(word);
    if (chars.length < 2) continue;
    const pat = chars
      .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(`\\s*${DOT_SEP}\\s*`);
    s = s.replace(new RegExp(pat, 'gi'), word);
  }

  s = s.replace(
    new RegExp(
      `(^|[^${VI_LETTER}])((?:[${VI_LETTER}]\\s*${DOT_SEP}\\s*){2,}[${VI_LETTER}])(?![${VI_LETTER}])`,
      'gi'
    ),
    (full, pre, seq) => {
      const letters = seq.match(new RegExp(`[${VI_LETTER}]`, 'gi')) || [];
      if (letters.length < 2) return full;
      return pre + letters.join('');
    }
  );

  return s;
}

function isDottedLetterFragment(s) {
  return new RegExp(`^[${VI_LETTER}]\\.?$`).test(String(s || '').trim());
}

/** Gộp các dòng chỉ còn 1 chữ (c. / h. / ế.) vào dòng trước */
function mergeDottedLetterLines(lines) {
  const out = [];
  for (const line of lines) {
    const t = String(line || '').trim();
    if (!t) continue;
    if (!out.length) {
      out.push(t);
      continue;
    }

    const prev = out[out.length - 1];
    const prevEndsWithDottedLetter = new RegExp(`[${VI_LETTER}]\\.$`).test(prev);
    const curIsFrag = isDottedLetterFragment(t);
    const curStartsLikeContinuation =
      curIsFrag || new RegExp(`^[${VI_LETTER}](?:\\.|\\s|$)`).test(t);

    if ((isDottedLetterFragment(prev) || prevEndsWithDottedLetter) && curStartsLikeContinuation) {
      out[out.length - 1] = `${prev} ${t}`.replace(/\s+/g, ' ');
    } else {
      out.push(t);
    }
  }

  return out.map((block) => collapseDottedLetterObfuscation(block));
}

function normalizeStoryText(text) {
  return collapseDottedLetterObfuscation(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`([.!?…])([${VI_LETTER}])`, 'g'), '$1 $2')
    .replace(new RegExp(`([?])([${VI_LETTER}])`, 'g'), '$1 $2')
    .replace(new RegExp(`(")([${VI_LETTER}])`, 'g'), '$1 $2')
    .trim();
}

/** Watermark / quảng cáo dammy, Team Bé Bi, Shopee — không đụng nội dung truyện. */
function isPromoParagraph(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;

  if (/truyện được đăng tải duy nhất tại\s*dammy/i.test(t)) return true;
  if (/^\[.*dammy\s*\.\s*(me|cc).*\]\.?$/i.test(t)) return true;

  if (/team\s*bé\s*bi/i.test(t)) return true;
  if (/chuyên xài\s*ai\s*để lấp hố/i.test(t)) return true;
  if (/nếu bồ cần lấp hố/i.test(t)) return true;
  if (/hãy nhớ đến tui nhóa/i.test(t)) return true;

  if (/mời quý độc giả\s*click/i.test(t)) return true;
  if (/mở ứng dụng\s*shopee/i.test(t)) return true;
  if (/đam mỹ và đội ngũ tác giả/i.test(t)) return true;
  if (/quay trở lại để tiếp tục đọc/i.test(t) && /shopee|ứng dụng/i.test(t)) return true;

  // SEO keyword stuffing kiểu "truyen full, truyenfull, truyenfullvn, …"
  if (
    /truyen\s*full|truyenfull/i.test(t) &&
    t.length < 160 &&
    (t.match(/truyen/gi) || []).length >= 2 &&
    !/[.!?:…]/.test(t)
  ) {
    return true;
  }

  const withoutUrl = t
    .replace(/https?:\/\/\s*[^\s]*shopee[^\s]*/gi, '')
    .replace(/https?:\/\/\s*s\s*\.\s*shopee\s*\.\s*vn\/[^\s]*/gi, '')
    .replace(/[.\-–—•·\s]+/g, '')
    .trim();
  if (/shopee/i.test(t) && withoutUrl.length < 8) return true;

  return false;
}

function stripShopeeLinks(text) {
  return String(text || '')
    .replace(/https?:\/\/\s*s\s*\.\s*shopee\s*\.\s*vn\/[^\s\]\)>"']*/gi, '')
    .replace(/https?:\/\/\s*[^\s\]\)>"']*shopee[^\s\]\)>"']*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripInlineDammyWatermark(text) {
  return String(text || '')
    .replace(/\[[^\]]*Truyện được đăng tải duy nhất tại[^\]]*\]\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanPromoParagraph(text) {
  let t = stripInlineDammyWatermark(String(text || ''));
  t = stripShopeeLinks(t);
  if (isPromoParagraph(t)) return '';
  return t.replace(/\s{2,}/g, ' ').trim();
}

/**
 * dammy.me (và một số site) giấu từ thật trong CSS:
 *   .x-abc:before { content: "có"; }
 * kèm <span class="x-abc"></span> rỗng. Cheerio .text() bỏ mất các từ này.
 */
function buildCssContentMap($) {
  const map = {};
  const chunks = [];
  $('style').each((_, el) => {
    chunks.push($(el).html() || '');
  });
  const css = chunks.join('\n');
  const re =
    /\.([a-zA-Z0-9_-]+)\s*::?(?:before|after)\s*\{\s*content\s*:\s*["']([^"']*)["']/gi;
  let match;
  while ((match = re.exec(css))) {
    map[match[1]] = match[2];
  }
  return map;
}

function restoreCssPseudoContent($, root, contentMap) {
  if (!contentMap || !Object.keys(contentMap).length) return;

  root.find('span').each((_, el) => {
    const $el = $(el);
    if ($el.children().length) return;

    const ownText = ($el.text() || '').trim();
    const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean);
    const words = [];

    for (const cls of classes) {
      if (Object.prototype.hasOwnProperty.call(contentMap, cls)) {
        words.push(contentMap[cls]);
      }
    }

    if (!words.length) return;

    // Span rỗng chỉ mang CSS content, hoặc text trùng với content (hiếm)
    if (!ownText || words.includes(ownText)) {
      $el.replaceWith(` ${words.join(' ')} `);
    }
  });
}

function unwrapInlineNodes($, root) {
  root.find('br').each((_, node) => {
    $(node).replaceWith('\n');
  });

  root.find('span, a, em, strong, b, i, u, font').each((_, node) => {
    const $node = $(node);
    if (!$node.text().trim() && !$node.children().length) {
      $node.replaceWith(' ');
      return;
    }
    // Chỉ lấy text, không giữ HTML/format lồng nhau từ web
    const plain = ($node.text() || '').replace(/\s+/g, ' ').trim();
    $node.replaceWith(plain ? ` ${plain} ` : ' ');
  });
}

function textBlocksFromElement($, el) {
  const clone = $(el).clone();
  unwrapInlineNodes($, clone);

  // Chỉ lấy text thuần — bỏ hết tag (kể cả img còn sót)
  const raw = clone.text() || '';

  return mergeDottedLetterLines(
    raw
      .split(/\n+/)
      .map((block) => block.replace(/\u00a0/g, ' ').replace(/[^\S\n]+/g, ' ').trim())
      .filter(Boolean)
  ).map((block) => normalizeStoryText(block)).filter(Boolean);
}

function stripHiddenElements($, contentEl) {
  contentEl.find('[hidden], [aria-hidden="true"]').each((_, el) => {
    // Keep dammy unlocked body even if site left aria-hidden
    if ($(el).hasClass('actac') || $(el).closest('.actac').length) return;
    $(el).remove();
  });
  contentEl.find('[style]').each((_, el) => {
    if ($(el).hasClass('actac') || $(el).closest('.actac').length) return;
    const style = String($(el).attr('style') || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (
      style.includes('display:none') ||
      style.includes('visibility:hidden') ||
      /font-size:0(px|em|rem)?(;|$)/.test(style)
    ) {
      $(el).remove();
    }
  });
}

function stripNonTextNoise($, contentEl) {
  contentEl.find(
    [
      'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'canvas',
      'img', 'picture', 'source', 'svg', 'video', 'audio', 'figure', 'figcaption',
      'input', 'button', 'form', 'select', 'textarea', 'label',
      'nav', 'aside', 'header', 'footer',
      '[id^="ads-"]', '.ads-content', '.adsbygoogle', '.ads-chapter-box',
      '.incontent-ad', '.ads-responsive', '.advertisement', '.quang-cao',
      '.actcl',
    ].join(', ')
  ).remove();

  // Bỏ attribute style/class/onclick… — chỉ giữ khung để lấy text
  contentEl.find('*').each((_, el) => {
    const attribs = el.attribs || {};
    Object.keys(attribs).forEach((name) => {
      $(el).removeAttr(name);
    });
  });

  contentEl.find('span').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.children().length === 0) {
      $el.replaceWith(' ');
    }
  });
}

function extractParagraphsFromContent($, contentEl) {
  const paragraphs = [];

  contentEl.children('p, div').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id') || '';
    if (id.startsWith('ads-') || $el.hasClass('ads-content') || $el.hasClass('adsbygoogle')) {
      return;
    }

    for (const text of textBlocksFromElement($, el)) {
      const cleaned = cleanPromoParagraph(text);
      if (cleaned) {
        paragraphs.push(`<p>${escapeHtml(cleaned)}</p>`);
      }
    }
  });

  const childrenTextLen = paragraphs
    .join('')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
  const rawLen = String(contentEl.text() || '')
    .replace(/\s+/g, ' ')
    .trim().length;

  // Nhiều chương truyenfull chỉ có text + <br>, kèm vài <p> SEO ẩn —
  // nếu đoạn lấy từ p/div quá ngắn so với toàn bộ #chapter-c thì fallback.
  const shouldFallback =
    !paragraphs.length ||
    (rawLen > 400 && childrenTextLen < Math.min(200, Math.floor(rawLen * 0.15)));

  if (shouldFallback) {
    const fallback = [];
    for (const text of textBlocksFromElement($, contentEl)) {
      const cleaned = cleanPromoParagraph(text);
      if (cleaned) {
        fallback.push(`<p>${escapeHtml(cleaned)}</p>`);
      }
    }
    if (fallback.length) {
      return fallback;
    }
  }

  return paragraphs;
}

function extractTruyenfullChapterContent($) {
  const contentMap = buildCssContentMap($);
  const contentEl = $('#chapter-c, .chapter-c').first().clone();
  if (!contentEl.length) {
    throw new Error('Không tìm thấy nội dung chương (#chapter-c)');
  }

  restoreCssPseudoContent($, contentEl, contentMap);
  stripHiddenElements($, contentEl);
  stripNonTextNoise($, contentEl);

  const paragraphs = extractParagraphsFromContent($, contentEl);
  if (paragraphs.length) {
    return paragraphs.join('\n');
  }

  const rawText = cleanPromoParagraph(normalizeStoryText(contentEl.text()));
  return rawText ? `<p>${escapeHtml(rawText)}</p>` : '';
}

function extractDammyChapterContent($) {
  return extractDammyChapterContentCore($, {
    buildCssContentMap,
    restoreCssPseudoContent,
    stripHiddenElements,
    stripNonTextNoise,
    extractParagraphsFromContent,
    cleanPromoParagraph,
    normalizeStoryText,
    escapeHtml,
  });
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
    throw new Error('Không tìm thấy danh sách chương trên dammy');
  }

  return {
    title,
    totalChapters: chapters.length,
    totalPages: 1,
    chapters,
  };
}

function collectTruyen66ChapterLinks($, baseUrl) {
  const chapters = [];
  const seen = new Set();

  $('a[href*="/chuong-"]').each((_, el) => {
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (!/^Chương\s+\d+/i.test(title)) return;

    const abs = toAbsoluteUrl(baseUrl, $(el).attr('href'));
    if (!abs || seen.has(abs)) return;

    seen.add(abs);
    chapters.push({ title, url: abs });
  });

  return chapters;
}

async function fetchTruyen66StoryInfo(storyUrl) {
  const origin = new URL(storyUrl).origin;
  const slug = getPathSlug(storyUrl);
  const pages = await fetchJson(
    `${origin}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`,
    storyUrl,
    TRUYEN66_HEADERS
  );

  if (!Array.isArray(pages) || !pages.length) {
    throw new Error('Không tìm thấy trang mục lục trên truyen66.com');
  }

  const page = pages[0];
  let title = decodeWpRendered(page.title?.rendered || '');
  title = title.replace(/\s*[–—-]\s*Hoàn\s*$/i, '').trim() || slug;

  const $ = cheerio.load(page.content?.rendered || '');
  const chapters = collectTruyen66ChapterLinks($, `${origin}/`);

  if (!chapters.length) {
    throw new Error('Không tìm thấy danh sách chương trên truyen66.com');
  }

  return {
    title,
    totalChapters: chapters.length,
    totalPages: 1,
    chapters,
  };
}

async function fetchTruyen66Chapter(chapterUrl) {
  const origin = new URL(chapterUrl).origin;
  const slug = getPathSlug(chapterUrl);
  const posts = await fetchJson(
    `${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}`,
    chapterUrl,
    TRUYEN66_HEADERS
  );

  if (!Array.isArray(posts) || !posts.length) {
    throw new Error('Không tìm thấy nội dung chương trên truyen66.com');
  }

  const post = posts[0];
  const title = decodeWpRendered(post.title?.rendered || '') || slug;
  const $ = cheerio.load(`<div id="truyen66-chapter">${post.content?.rendered || ''}</div>`);
  const contentEl = $('#truyen66-chapter').clone();

  contentEl
    .find(
      [
        '.wordads-ad-wrapper',
        '.wp-block-jetpack-wordads',
        '.code-block',
        '.sharedaddy',
        '.jp-relatedposts',
      ].join(', ')
    )
    .remove();

  stripHiddenElements($, contentEl);
  stripNonTextNoise($, contentEl);

  const paragraphs = extractParagraphsFromContent($, contentEl);
  let content = paragraphs.length ? paragraphs.join('\n') : '';
  if (!content) {
    const rawText = cleanPromoParagraph(normalizeStoryText(contentEl.text()));
    content = rawText ? `<p>${escapeHtml(rawText)}</p>` : '';
  }

  if (!content) {
    throw new Error('Không tìm thấy nội dung chương trên truyen66.com');
  }

  return { title, content };
}

function getGiatocSlug(storyUrl) {
  const pathname = new URL(storyUrl).pathname.replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);
  const storiesIdx = parts.findIndex((p) => p === 'stories');
  if (storiesIdx >= 0 && parts[storiesIdx + 1]) {
    return decodeURIComponent(parts[storiesIdx + 1]);
  }
  return getPathSlug(storyUrl);
}

function getGiatocChapterId(chapterUrl) {
  const parsed = new URL(chapterUrl);
  const match = parsed.pathname.match(/\/chapter\/([^/]+?)(?:\.json)?\/?$/i);
  if (match) return decodeURIComponent(match[1]);
  const id = parsed.searchParams.get('id') || parsed.searchParams.get('chapter');
  if (id) return id;
  throw new Error('URL chương giatocvuongtai.com không hợp lệ');
}

function giatocBlocksToHtml(content) {
  const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
  const paragraphs = [];

  for (const block of blocks) {
    if (!block || block.type !== 'paragraph') continue;
    const inline = Array.isArray(block.inline) ? block.inline : [];
    const raw = inline
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('');
    const cleaned = cleanPromoParagraph(normalizeStoryText(raw));
    if (cleaned) {
      paragraphs.push(`<p>${escapeHtml(cleaned)}</p>`);
    }
  }

  return paragraphs.join('\n');
}

async function fetchGiatocStoryInfo(storyUrl) {
  const origin = new URL(storyUrl).origin;
  const slug = getGiatocSlug(storyUrl);
  const payload = await fetchJson(
    `${origin}/api/public/story/${encodeURIComponent(slug)}.json`,
    storyUrl
  );

  if (payload?.error) {
    throw new Error(payload.error.message || 'Không thể lấy thông tin truyện trên giatocvuongtai.com');
  }

  const data = payload?.data;
  if (!data) {
    throw new Error('Không tìm thấy truyện trên giatocvuongtai.com');
  }

  if (data.requiresPassword || data.is_password_protected) {
    throw new Error('Truyện này bị khóa mật khẩu trên giatocvuongtai.com');
  }

  const title = String(data.title || '').trim() || slug;
  const chapters = (Array.isArray(data.chapters) ? data.chapters : [])
    .filter((ch) => ch && ch.id && ch.is_published !== false && !ch.is_password_protected)
    .sort((a, b) => (a.order_number || 0) - (b.order_number || 0))
    .map((ch) => {
      const order = ch.order_number || 0;
      const chapTitle = String(ch.title || '').trim() || `Chương ${order}`;
      return {
        title: order ? `Chương ${order}: ${chapTitle}` : chapTitle,
        url: `${origin}/api/public/chapter/${encodeURIComponent(ch.id)}.json`,
      };
    });

  if (!chapters.length) {
    throw new Error('Không tìm thấy danh sách chương trên giatocvuongtai.com');
  }

  return {
    title,
    totalChapters: chapters.length,
    totalPages: 1,
    chapters,
  };
}

async function fetchGiatocChapter(chapterUrl) {
  const origin = new URL(chapterUrl).origin;
  const chapterId = getGiatocChapterId(chapterUrl);
  const apiUrl = chapterUrl.includes('/api/public/chapter/')
    ? chapterUrl
    : `${origin}/api/public/chapter/${encodeURIComponent(chapterId)}.json`;

  const payload = await fetchJson(apiUrl, origin);
  if (payload?.error) {
    throw new Error(payload.error.message || 'Không thể lấy nội dung chương trên giatocvuongtai.com');
  }

  const data = payload?.data;
  if (!data) {
    throw new Error('Không tìm thấy nội dung chương trên giatocvuongtai.com');
  }

  if (data.is_password_protected) {
    throw new Error(`Chương bị khóa mật khẩu: ${data.title || chapterId}`);
  }

  const order = data.order_number || 0;
  const rawTitle = String(data.title || '').trim() || chapterId;
  const title = order ? `Chương ${order}: ${rawTitle}` : rawTitle;
  const content = giatocBlocksToHtml(data.content);

  if (!content) {
    throw new Error('Không tìm thấy nội dung chương trên giatocvuongtai.com');
  }

  return { title, content };
}

async function fetchTruyenfullStoryInfo(storyUrl, $) {
  const title = getStoryTitle($, 'truyenfull');

  let chapters = null;
  try {
    chapters = await fetchChaptersViaAjax(storyUrl, $, title);
  } catch (err) {
    console.warn('truyenfull ajax list_chapter failed, fallback pagination:', err.message);
  }
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
  // Mỗi mirror (.live / .today / .vn / …) tự host ajax.php — gọi đúng origin của link
  return `${String(origin).replace(/\/$/, '')}/ajax.php`;
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

function buildTruyenfullPageUrl(storyUrl, page) {
  const base = storyUrl.endsWith('/') ? storyUrl : `${storyUrl}/`;
  // .live dùng /trang-N/; một số mirror cũ dùng ?trang=N
  if (/truyenfull\.live/i.test(storyUrl)) {
    return `${base}trang-${page}/`;
  }
  return `${storyUrl}?trang=${page}`;
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
    const pageUrl = buildTruyenfullPageUrl(storyUrl, page);
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

    if (site === 'truyen66') {
      return res.json(await fetchTruyen66StoryInfo(storyUrl));
    }

    if (site === 'giatoc') {
      return res.json(await fetchGiatocStoryInfo(storyUrl));
    }

    if (site === 'wordpress') {
      return res.json(await fetchWordpressStoryInfo(storyUrl));
    }

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

    if (site === 'truyen66') {
      return res.json(await fetchTruyen66Chapter(chapterUrl));
    }

    if (site === 'giatoc') {
      return res.json(await fetchGiatocChapter(chapterUrl));
    }

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

app.post('/api/feedback', (req, res) => {
  try {
    const ip = getClientIp(req);
    if (!checkFeedbackRateLimit(ip)) {
      return res.status(429).json({
        ok: false,
        error: 'Bạn đã gửi quá nhiều phản hồi. Thử lại sau khoảng 1 giờ.',
      });
    }

    const typeValue = String(req.body?.type || 'bug').trim();
    const message = String(req.body?.message || '').trim();
    const contact = String(req.body?.contact || '').trim().slice(0, 200);
    const version = String(req.body?.version || '').trim().slice(0, 40);
    const pageUrl = String(req.body?.pageUrl || '').trim().slice(0, 500);
    const userAgent = String(req.body?.userAgent || req.headers['user-agent'] || '')
      .trim()
      .slice(0, 200);

    if (!message) {
      return res.status(400).json({ ok: false, error: 'Vui lòng nhập nội dung.' });
    }
    if (message.length > FEEDBACK_MAX_MESSAGE) {
      return res.status(400).json({
        ok: false,
        error: `Nội dung tối đa ${FEEDBACK_MAX_MESSAGE} ký tự.`,
      });
    }
    if (typeValue !== 'bug' && typeValue !== 'idea') {
      return res.status(400).json({ ok: false, error: 'Loại phản hồi không hợp lệ.' });
    }

    const item = feedbackStore.createFeedback({
      type: typeValue,
      message,
      contact,
      version,
      pageUrl,
      userAgent,
      ip,
    });

    return res.json({ ok: true, id: item.id });
  } catch (error) {
    console.error('Feedback save failed:', error.message || error);
    return res.status(500).json({
      ok: false,
      error: 'Không lưu được phản hồi. Thử lại sau.',
    });
  }
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASS) {
    return res.status(503).json({
      ok: false,
      error: 'Chưa cấu hình ADMIN_PASS trên server.',
    });
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!timingSafeEqualStr(username, ADMIN_USER) || !timingSafeEqualStr(password, ADMIN_PASS)) {
    return res.status(401).json({ ok: false, error: 'Sai tài khoản hoặc mật khẩu.' });
  }
  const token = signAdminToken({
    u: ADMIN_USER,
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  });
  setAdminCookie(res, token);
  return res.json({ ok: true, user: ADMIN_USER });
});

app.post('/api/admin/logout', (_req, res) => {
  clearAdminCookie(res);
  return res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  return res.json({ ok: true, user: req.admin.u });
});

app.get('/api/admin/feedback', requireAdmin, (req, res) => {
  try {
    const items = feedbackStore.listFeedback({
      status: String(req.query.status || '').trim(),
      type: String(req.query.type || '').trim(),
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
      q: String(req.query.q || '').trim(),
    });
    return res.json({ ok: true, items, total: items.length });
  } catch (error) {
    console.error('Admin list feedback failed:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Không đọc được log.' });
  }
});

app.patch('/api/admin/feedback/:id', requireAdmin, (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    const result = feedbackStore.setStatus(req.params.id, status);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('Admin update feedback failed:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Không cập nhật được trạng thái.' });
  }
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server đang chạy tại http://${HOST}:${PORT}`);
});
