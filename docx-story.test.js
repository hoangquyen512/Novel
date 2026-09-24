const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isChapterHeading,
  parseChapterHeading,
  splitChaptersFromParagraphs,
  paragraphsToChapterHtml,
  storyTitleFromFilename,
  FIXED_CONG_NEW,
  FIXED_THU_NEW,
} = require('./docx-story');

describe('docx-story fixed names', () => {
  it('locks Công/Thụ new names to BJYX defaults', () => {
    assert.equal(FIXED_CONG_NEW, 'Vương Nhất Bác');
    assert.equal(FIXED_THU_NEW, 'Tiêu Chiến');
  });
});

describe('isChapterHeading / parseChapterHeading', () => {
  it('matches Chương N, Chuong N, and Chapter N', () => {
    assert.equal(isChapterHeading('Chương 1'), true);
    assert.equal(isChapterHeading('Chương 12: Gặp lại'), true);
    assert.equal(isChapterHeading('  chương 3 — khởi đầu  '), true);
    assert.equal(isChapterHeading('Chuong 1'), true);
    assert.equal(isChapterHeading('Chapter 2: Hello'), true);
    assert.equal(isChapterHeading('Ch. 3'), true);
    assert.equal(isChapterHeading('Đây không phải chương'), false);
  });

  it('parses number and optional title', () => {
    assert.deepEqual(parseChapterHeading('Chương 1'), {
      number: 1,
      title: 'Chương 1',
    });
    assert.deepEqual(parseChapterHeading('Chương 2: Gặp lại'), {
      number: 2,
      title: 'Chương 2: Gặp lại',
    });
  });
});

describe('splitChaptersFromParagraphs', () => {
  it('splits one docx body into chapters by Chương headings', () => {
    const paragraphs = [
      'Truyện Demo',
      'Chương 1',
      'Đoạn mở đầu.',
      'Tiếp theo.',
      'Chương 2: Gặp lại',
      'Nội dung chương hai.',
    ];
    const result = splitChaptersFromParagraphs(paragraphs, {
      fallbackTitle: 'file-name',
    });
    assert.equal(result.title, 'Truyện Demo');
    assert.equal(result.chapters.length, 2);
    assert.equal(result.chapters[0].title, 'Chương 1');
    assert.match(result.chapters[0].content, /Đoạn mở đầu/);
    assert.match(result.chapters[0].content, /<p>/);
    assert.equal(result.chapters[1].title, 'Chương 2: Gặp lại');
    assert.match(result.chapters[1].content, /Nội dung chương hai/);
  });

  it('uses fallback title when preamble is empty', () => {
    const result = splitChaptersFromParagraphs(
      ['Chương 1', 'Nội dung.'],
      { fallbackTitle: 'Ten File' }
    );
    assert.equal(result.title, 'Ten File');
    assert.equal(result.chapters.length, 1);
  });

  it('throws when no chapter heading found', () => {
    assert.throws(
      () => splitChaptersFromParagraphs(['Chỉ có văn bản thường.'], { fallbackTitle: 'x' }),
      /Chương/
    );
  });
});

describe('storyTitleFromFilename', () => {
  it('strips .docx and path noise', () => {
    assert.equal(storyTitleFromFilename('Truyện ABC.docx'), 'Truyện ABC');
    assert.equal(storyTitleFromFilename('C:\\temp\\foo.DOCX'), 'foo');
  });

  it('strips .pdf extension', () => {
    assert.equal(storyTitleFromFilename('Truyện XYZ.pdf'), 'Truyện XYZ');
    assert.equal(storyTitleFromFilename('C:\\temp\\bar.PDF'), 'bar');
  });
});

describe('pdfTextItemsToParagraphs', () => {
  it('groups PDF text items into lines by Y then paragraphs', () => {
    const { pdfTextItemsToParagraphs } = require('./docx-story');
    const items = [
      { str: 'Chương', transform: [1, 0, 0, 1, 10, 100], page: 1 },
      { str: ' 1', transform: [1, 0, 0, 1, 50, 100], page: 1 },
      { str: 'Đoạn một.', transform: [1, 0, 0, 1, 10, 80], page: 1 },
      { str: 'Đoạn hai.', transform: [1, 0, 0, 1, 10, 50], page: 1 },
    ];
    assert.deepEqual(pdfTextItemsToParagraphs(items), [
      'Chương 1',
      'Đoạn một.',
      'Đoạn hai.',
    ]);
  });

  it('merges wrapped lines within a paragraph and keeps paragraph breaks', () => {
    const { pdfTextItemsToParagraphs } = require('./docx-story');
    // dy~15 = wrap, dy~21 = new paragraph (sample Alpha PDF)
    const items = [
      { str: 'CHƯƠNG 1', transform: [1, 0, 0, 1, 84, 678], page: 5 },
      { str: 'Á', transform: [1, 0, 0, 1, 84, 541], page: 5 },
      { str: ' ', transform: [1, 0, 0, 1, 87, 541], page: 5 },
      {
        str: 'nh sáng ban mai dịu dàng.',
        transform: [1, 0, 0, 1, 90, 541],
        page: 5,
      },
      {
        str: 'Trong căn phòng bệnh đơn sạch sẽ, người nằm trên',
        transform: [1, 0, 0, 1, 84, 520],
        page: 5,
      },
      {
        str: 'giường có làn da trắng như tuyết.',
        transform: [1, 0, 0, 1, 84, 505],
        page: 5,
      },
      {
        str: 'Ánh sáng chiếu vào sàn nhà.',
        transform: [1, 0, 0, 1, 84, 484],
        page: 5,
      },
    ];
    assert.deepEqual(pdfTextItemsToParagraphs(items), [
      'CHƯƠNG 1',
      'Ánh sáng ban mai dịu dàng.',
      'Trong căn phòng bệnh đơn sạch sẽ, người nằm trên giường có làn da trắng như tuyết.',
      'Ánh sáng chiếu vào sàn nhà.',
    ]);
  });

  it('continues a paragraph across page breaks when sentence is unfinished', () => {
    const { pdfTextItemsToParagraphs } = require('./docx-story');
    const items = [
      {
        str: 'Bùi Nhẫn bất lực nói: "Vừa mới phẫu thuật xong thì nằm xuống nghỉ ngơi đi, đừng',
        transform: [1, 0, 0, 1, 84, 100],
        page: 13,
      },
      {
        str: 'phát triển rất nhiều, trong đó việc sóng dẫn quang chỉ là một trong những thành',
        transform: [1, 0, 0, 1, 84, 700],
        page: 14,
      },
      {
        str: 'tựu đặc biệt nhất.',
        transform: [1, 0, 0, 1, 84, 685],
        page: 14,
      },
    ];
    assert.deepEqual(pdfTextItemsToParagraphs(items), [
      'Bùi Nhẫn bất lực nói: "Vừa mới phẫu thuật xong thì nằm xuống nghỉ ngơi đi, đừng phát triển rất nhiều, trong đó việc sóng dẫn quang chỉ là một trong những thành tựu đặc biệt nhất.',
    ]);
  });
});

describe('pdfItemsToHtml + storyFromPdfHtml', () => {
  it('converts PDF items to HTML paragraphs then splits chapters', () => {
    const { pdfItemsToHtml, storyFromPdfHtml } = require('./docx-story');
    const items = [
      { str: 'CHƯƠNG 1', transform: [1, 0, 0, 1, 84, 600], page: 1 },
      { str: 'Câu mở đầu đủ nghĩa.', transform: [1, 0, 0, 1, 84, 560], page: 1 },
      { str: 'CHƯƠNG 2', transform: [1, 0, 0, 1, 84, 500], page: 1 },
      { str: 'Nội dung chương hai.', transform: [1, 0, 0, 1, 84, 460], page: 1 },
    ];
    const html = pdfItemsToHtml(items);
    assert.match(html, /<p>CHƯƠNG 1<\/p>/);
    assert.match(html, /<p>Câu mở đầu đủ nghĩa\.<\/p>/);
    const story = storyFromPdfHtml(html, { fallbackTitle: 'demo' });
    assert.equal(story.chapters.length, 2);
    assert.match(story.chapters[0].content, /Câu mở đầu/);
    assert.doesNotMatch(story.chapters[0].content, /<p>Trong/);
  });
});

describe('splitChaptersFromParagraphs skips empty TOC headings', () => {
  it('ignores consecutive Chương headings with no body (mục lục)', () => {
    const result = splitChaptersFromParagraphs(
      [
        'Mục lục',
        'Chương 1',
        'Chương 2',
        'Chương 3',
        'CHƯƠNG 1',
        'Nội dung thật của chương một.',
        'CHƯƠNG 2',
        'Nội dung thật của chương hai.',
      ],
      { fallbackTitle: 'Alpha' }
    );
    assert.equal(result.chapters.length, 2);
    assert.match(result.chapters[0].title, /Chương 1/i);
    assert.match(result.chapters[0].content, /Nội dung thật của chương một/);
    assert.match(result.chapters[1].content, /Nội dung thật của chương hai/);
  });
});

describe('paragraphsToChapterHtml', () => {
  it('escapes HTML and wraps paragraphs', () => {
    assert.equal(
      paragraphsToChapterHtml(['A < B', 'C']),
      '<p>A &lt; B</p>\n<p>C</p>'
    );
  });
});
