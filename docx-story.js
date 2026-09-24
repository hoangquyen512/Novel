(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DocxStory = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FIXED_CONG_NEW = 'Vương Nhất Bác';
  const FIXED_THU_NEW = 'Tiêu Chiến';

  const CHAPTER_HEADING_RE =
    /^\s*(?:Chương|Chuong|Chapter|Ch\.?)\s+(\d+)\s*(?:[:：.\-–—]\s*(.*?))?\s*$/i;

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function storyTitleFromFilename(filename) {
    const base = String(filename || '')
      .replace(/^.*[\\/]/, '')
      .replace(/\.(docx|pdf)$/i, '')
      .trim();
    return base || 'truyen';
  }

  function isPdfNoiseLine(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return true;
    if (/^D\s*T\s*V\b/i.test(t)) return true;
    if (/^E\s*B\s*O\s*O\s*K\b/i.test(t)) return true;
    if (/^D\s*T\s*V\s*-\s*E\s*B\s*O\s*O\s*K$/i.test(t)) return true;
    return false;
  }

  function endsSentenceLike(text) {
    return /[.!?…]"?$|[.’”"»)]$/.test(String(text || '').trim());
  }

  function startsLikeContinuation(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (isChapterHeading(t)) return false;
    const ch = Array.from(t)[0];
    return ch && ch === ch.toLowerCase() && /[\p{L}\p{N}]/u.test(ch);
  }

  function mergeDropcapLine(raw) {
    // "Á nh sáng..." (dropcap + space) → "Ánh sáng..."
    return String(raw || '').replace(
      /^([\p{L}])\s+(?=[\p{Ll}])/u,
      '$1'
    );
  }

  function pdfTextItemsToLines(items) {
    const list = Array.isArray(items) ? items : [];
    const buckets = new Map();

    for (const item of list) {
      if (!item || item.str == null) continue;
      const str = String(item.str);
      if (str === '') continue;
      const x = item.transform && Number.isFinite(item.transform[4]) ? item.transform[4] : 0;
      const y = item.transform && Number.isFinite(item.transform[5]) ? item.transform[5] : 0;
      const page = Number.isFinite(item.page) ? item.page : 1;
      const yKey = Math.round(y * 2) / 2;
      const key = `${page}|${yKey}`;
      if (!buckets.has(key)) buckets.set(key, { page, y: yKey, parts: [] });
      buckets.get(key).parts.push({ x, str });
    }

    const lines = Array.from(buckets.values()).map((b) => {
      b.parts.sort((a, c) => a.x - c.x);
      let raw = '';
      for (const p of b.parts) raw += p.str;
      const text = mergeDropcapLine(raw.replace(/[ \t]+/g, ' ').trim());
      return { page: b.page, y: b.y, text };
    });

    lines.sort((a, b) => a.page - b.page || b.y - a.y);
    return lines.filter((l) => l.text && !isPdfNoiseLine(l.text));
  }

  function pdfTextItemsToParagraphs(items) {
    const lines = pdfTextItemsToLines(items);
    const paragraphs = [];
    let buf = [];
    let last = null;

    const flush = () => {
      if (!buf.length) return;
      paragraphs.push(buf.join(' ').replace(/\s+/g, ' ').trim());
      buf = [];
    };

    for (const line of lines) {
      if (isChapterHeading(line.text)) {
        flush();
        paragraphs.push(line.text.replace(/\s+/g, ' ').trim());
        last = line;
        continue;
      }

      if (!buf.length) {
        buf.push(line.text);
        last = line;
        continue;
      }

      const samePage = last && last.page === line.page;
      const dy = last ? Math.abs(last.y - line.y) : 0;
      const wrapped = samePage && dy > 0 && dy <= 18;
      const pageBreak = last && last.page !== line.page;
      const paraGap = samePage && dy > 18;
      const prev = buf[buf.length - 1];
      const cont =
        (!endsSentenceLike(prev) || startsLikeContinuation(line.text)) &&
        (pageBreak || (paraGap && startsLikeContinuation(line.text)));

      if (wrapped || cont) {
        buf.push(line.text);
      } else {
        flush();
        buf.push(line.text);
      }
      last = line;
    }
    flush();
    return paragraphs.filter(Boolean);
  }

  function pdfItemsToHtml(items) {
    return paragraphsToChapterHtml(pdfTextItemsToParagraphs(items));
  }

  function storyFromPdfHtml(html, options) {
    return splitChaptersFromParagraphs(htmlToParagraphs(html), options);
  }

  function storyFromPdfTextItems(items, options) {
    return storyFromPdfHtml(pdfItemsToHtml(items), options);
  }

  function parseChapterHeading(text) {
    const m = String(text || '').match(CHAPTER_HEADING_RE);
    if (!m) return null;
    const number = parseInt(m[1], 10);
    const rest = (m[2] || '').trim();
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    return {
      number,
      title: raw || (rest ? `Chương ${number}: ${rest}` : `Chương ${number}`),
    };
  }

  function isChapterHeading(text) {
    return !!parseChapterHeading(text);
  }

  function paragraphsToChapterHtml(paragraphs) {
    return (paragraphs || [])
      .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('\n');
  }

  function splitChaptersFromParagraphs(paragraphs, options) {
    const fallbackTitle =
      (options && options.fallbackTitle && String(options.fallbackTitle).trim()) ||
      'truyen';
    const lines = (paragraphs || [])
      .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const chapters = [];
    let preamble = [];
    let current = null;

    for (const line of lines) {
      const heading = parseChapterHeading(line);
      if (heading) {
        if (current && current.paras.length) {
          chapters.push({
            title: current.title,
            content: paragraphsToChapterHtml(current.paras),
          });
        }
        current = { title: heading.title, paras: [] };
        continue;
      }
      if (!current) {
        preamble.push(line);
        continue;
      }
      current.paras.push(line);
    }

    if (current && current.paras.length) {
      chapters.push({
        title: current.title,
        content: paragraphsToChapterHtml(current.paras),
      });
    }

    if (!chapters.length) {
      const preview = paragraphs
        .slice(0, 6)
        .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((p) => (p.length > 60 ? `${p.slice(0, 57)}...` : p))
        .join(' | ');
      throw new Error(
        'Không tìm thấy tiêu đề chương dạng "Chương 1", "Chuong 1" hoặc "Chapter 1" trong file.' +
          (preview ? ` Các dòng đầu: ${preview}` : '')
      );
    }

    let title = fallbackTitle;
    if (preamble.length) {
      const first = preamble[0];
      if (first.length <= 120) title = first;
    }

    return { title, chapters };
  }

  function htmlToParagraphs(html) {
    const raw = String(html || '');
    if (!raw.trim()) return [];

    if (typeof document !== 'undefined') {
      const wrap = document.createElement('div');
      wrap.innerHTML = raw;
      const nodes = wrap.querySelectorAll('p, h1, h2, h3, h4, li');
      if (nodes.length) {
        return Array.from(nodes)
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
      }
      return (wrap.textContent || '')
        .split(/\n+/)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }

    return raw
      .replace(/<\/(p|h1|h2|h3|h4|li|div|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .split(/\n+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function storyFromDocxHtml(html, options) {
    return splitChaptersFromParagraphs(htmlToParagraphs(html), options);
  }

  return {
    FIXED_CONG_NEW,
    FIXED_THU_NEW,
    isChapterHeading,
    parseChapterHeading,
    splitChaptersFromParagraphs,
    paragraphsToChapterHtml,
    storyTitleFromFilename,
    htmlToParagraphs,
    storyFromDocxHtml,
    pdfTextItemsToParagraphs,
    pdfTextItemsToLines,
    pdfItemsToHtml,
    storyFromPdfHtml,
    storyFromPdfTextItems,
    escapeHtml,
  };
});
