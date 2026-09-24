/**
 * dammy.cc / dammy.me chapter unlock helpers.
 * Some chapters gate full text behind a Shopee CTA:
 *   .actcl { display:block }  — ad / unlock prompt
 *   .actac { display:none }   — real chapter body
 */

function clearDisplayNone(style) {
  return String(style || '')
    .replace(/display\s*:\s*none\s*;?/gi, '')
    .trim();
}

function unlockDammyChapterContent($, root) {
  if (!root || !root.length) return root;

  root.find('.actcl').remove();

  root.find('.actac').each((_, el) => {
    const $el = $(el);
    const nextStyle = clearDisplayNone($el.attr('style'));
    if (nextStyle) $el.attr('style', nextStyle);
    else $el.removeAttr('style');
    $el.removeAttr('hidden');
    $el.removeAttr('aria-hidden');
  });

  return root;
}

function extractDammyChapterContent($, deps) {
  const {
    buildCssContentMap,
    restoreCssPseudoContent,
    stripHiddenElements,
    stripNonTextNoise,
    extractParagraphsFromContent,
    cleanPromoParagraph,
    normalizeStoryText,
    escapeHtml,
  } = deps;

  const contentMap = buildCssContentMap($);
  let contentEl = $('#chapter-content-render, .chapter-content').first().clone();
  if (!contentEl.length) {
    throw new Error('Không tìm thấy nội dung chương (.chapter-content)');
  }

  unlockDammyChapterContent($, contentEl);

  // Prefer unlocked body when present (after unlock it is visible)
  const actac = contentEl.find('.actac').first();
  if (actac.length && actac.text().replace(/\s+/g, ' ').trim().length > 80) {
    contentEl = actac;
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

module.exports = {
  unlockDammyChapterContent,
  extractDammyChapterContent,
  clearDisplayNone,
};
