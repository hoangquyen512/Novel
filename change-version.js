/* eslint-disable no-unused-vars */
(function (global) {
  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function countOcc(text, str, ci) {
    if (!str || !str.trim()) return 0;
    try {
      return (text.match(new RegExp(esc(str.trim()), ci ? 'gi' : 'g')) || []).length;
    } catch {
      return 0;
    }
  }

  function getSurname(n) {
    return (n || '').trim().split(/\s+/)[0] || '';
  }

  /** Phần tên sau họ: "Hàn Trọng" → "Trọng", "Vương Nhất Bác" → "Nhất Bác" */
  function getGivenName(n) {
    const parts = (n || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return '';
    return parts.slice(1).join(' ');
  }

  const VI = 'a-zA-ZÀ-ỹĐđ';

  function wordBoundaryReplace(text, oldS, newS, ci) {
    if (!oldS || !newS || oldS === newS) return { text, count: 0 };
    let count = 0;
    try {
      const flags = ci ? 'gmi' : 'gm';
      const result = text.replace(
        new RegExp(`(^|[^${VI}])${esc(oldS)}(?=[^${VI}]|$)`, flags),
        (m, pre) => {
          count += 1;
          return pre + newS;
        }
      );
      return { text: result, count };
    } catch {
      return { text, count: 0 };
    }
  }

  /** Chỉ thay khi đúng chữ hoa/thường — không đụng từ thường như "vô dụng". */
  function properNameReplace(text, oldS, newS) {
    return wordBoundaryReplace(text, oldS, newS, false);
  }

  function replaceExactPhrase(text, oldPhrase, newPhrase) {
    if (!oldPhrase || !newPhrase || oldPhrase === newPhrase) return { text, count: 0 };
    let count = 0;
    const result = text.replace(
      new RegExp(`(^|[^${VI}])${esc(oldPhrase)}(?=[^${VI}]|$)`, 'gm'),
      (m, pre) => {
        count += 1;
        return pre + newPhrase;
      }
    );
    return { text: result, count };
  }

  /** Biến thể họ tên đầy đủ (chỉ dạng tên riêng, không lowercase). */
  function fullNameVariants(fullName) {
    const base = (fullName || '').trim();
    if (!base) return [];
    const out = new Set([base]);
    const upper = base.toUpperCase();
    if (upper !== base) out.add(upper);
    return [...out];
  }

  function mapFullNameVariant(oldVariant, oldFull, newFull) {
    if (oldVariant === oldFull.trim().toUpperCase()) {
      return newFull.trim().toUpperCase();
    }
    return newFull.trim();
  }

  function applyFullNameReplacements(text, oldFull, newFull, type, stats, totalByType) {
    for (const variant of fullNameVariants(oldFull)) {
      const mapped = mapFullNameVariant(variant, oldFull, newFull);
      const r = replaceExactPhrase(text, variant, mapped);
      if (r.count > 0) {
        text = r.text;
        stats.push({ old: variant, new: mapped, n: r.count, type });
        totalByType[type] = (totalByType[type] || 0) + r.count;
      }
    }
    return text;
  }

  function smartSurnameReplace(text, oldS, newS) {
    return properNameReplace(text, oldS, newS);
  }

  function applyPairList(text, pairs, stats, totalByType) {
    for (const p of pairs) {
      const flag = p.ci ? 'gi' : 'g';
      try {
        const n = countOcc(text, p.old, !!p.ci);
        if (n > 0) {
          text = text.replace(new RegExp(esc(p.old), flag), p.new);
          stats.push({ old: p.old, new: p.new, n, type: p.type });
          totalByType[p.type] = (totalByType[p.type] || 0) + n;
        }
      } catch {
        /* skip invalid regex */
      }
    }
    return text;
  }

  const VI_LETTER_CLS = 'A-Za-zÀ-ỹĐđ';
  const DOT_SEP = '[.·．•‧*＊\\-]';

  /**
   * Từ hay bị viết tách dấu để né kiểm duyệt trên web.
   * VD: c. h. ế. t → chết, c. h. ử. i → chửi
   */
  const DOTTED_RESTORE_WORDS = [
    'chết', 'chửi', 'địt', 'đụ', 'đái', 'lồn', 'cặc', 'đéo', 'đĩ', 'điếm',
    'hiếp', 'chịch', 'liếm', 'bú', 'mút', 'dâm', 'đít', 'vú', 'cu', 'kẹc',
    'fuck', 'shit', 'sex', 'dick', 'pussy', 'damn',
  ];

  /**
   * Bỏ watermark / quảng cáo site (dammy, Team Bé Bi, Shopee).
   * Chỉ xóa đoạn rõ là promo — không đụng nội dung truyện.
   */
  function isPromoParagraph(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return true;

    if (/truyện được đăng tải duy nhất tại\s*dammy/i.test(t)) return true;
    if (/^\[.*dammy\s*\.\s*me.*\]\.?$/i.test(t)) return true;

    if (/team\s*bé\s*bi/i.test(t)) return true;
    if (/chuyên xài\s*ai\s*để lấp hố/i.test(t)) return true;
    if (/nếu bồ cần lấp hố/i.test(t)) return true;
    if (/hãy nhớ đến tui nhóa/i.test(t)) return true;

    if (/mời quý độc giả\s*click/i.test(t)) return true;
    if (/mở ứng dụng\s*shopee/i.test(t)) return true;
    if (/đam mỹ và đội ngũ tác giả/i.test(t)) return true;
    if (/quay trở lại để tiếp tục đọc/i.test(t) && /shopee|ứng dụng/i.test(t)) return true;

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

  function stripPromoNoise(htmlOrText) {
    const raw = String(htmlOrText || '');
    if (!raw.trim()) return raw;

    if (/<p[\s>]/i.test(raw)) {
      return raw
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => {
          const plain = String(inner)
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
          const cleaned = cleanPromoParagraph(plain);
          if (!cleaned) return '';
          return `<p>${cleaned
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')}</p>`;
        })
        .replace(/(?:\n\s*){2,}/g, '\n')
        .trim();
    }

    return raw
      .split(/\n+/)
      .map((line) => cleanPromoParagraph(line))
      .filter(Boolean)
      .join('\n');
  }

  function restoreObfuscatedWords(text) {
    if (!text) return text;
    let s = String(text);

    // Nối mảnh bị xuống dòng: "c.\nh.\nế." → "c. h. ế."
    s = s.replace(
      new RegExp(`([${VI_LETTER_CLS}])\\s*${DOT_SEP}\\s*\\n+\\s*`, 'gi'),
      '$1. '
    );

    // Thay đúng các từ quen thuộc (dài trước)
    const words = DOTTED_RESTORE_WORDS.slice().sort((a, b) => b.length - a.length);
    for (const word of words) {
      const chars = Array.from(word);
      if (chars.length < 2) continue;
      const pat = chars.map((c) => esc(c)).join(`\\s*${DOT_SEP}\\s*`);
      s = s.replace(new RegExp(pat, 'gi'), word);
    }

    // Mọi chuỗi chữ đơn tách bởi . * - · (≥2 lần) → ghép thành từ bình thường
    s = s.replace(
      new RegExp(
        `(^|[^${VI_LETTER_CLS}])((?:[${VI_LETTER_CLS}]\\s*${DOT_SEP}\\s*){2,}[${VI_LETTER_CLS}])(?![${VI_LETTER_CLS}])`,
        'gi'
      ),
      (full, pre, seq) => {
        const letters = seq.match(new RegExp(`[${VI_LETTER_CLS}]`, 'gi')) || [];
        if (letters.length < 2) return full;
        return pre + letters.join('');
      }
    );

    return s;
  }

  const DEFAULT_CENSORED = [
    ['c. h. ế. t', 'chết'], ['c.h.ế.t', 'chết'], ['c. h. ế.t', 'chết'],
    ['c. h. ử. i', 'chửi'], ['c.h.ử.i', 'chửi'], ['c. h. ử.i', 'chửi'],
    ['đ. ị. t', 'địt'], ['đ.ị.t', 'địt'],
    ['k** r*n', 'kêu rên'], ['l**m', 'liếm'], ['đ*t', 'địt'], ['k*ch th*ch', 'kích thích'],
    ['c** nh*', 'cậu nhỏ'], ['c** tr*n', 'cởi trần'], ['q**n l*t', 'quần lót'],
    ['r*n r*', 'rên rỉ'], ['b*n r*', 'bắn ra'], ['b* q**', 'ba que'],
    ['b**n th**', 'biến thái'], ['b*p ch*t', 'bóp chết'], ['b*n n**c', 'bán nước'],
    ['n*n b*p', 'nắn bóp'], ['c** q**n', 'cởi quần'], ['ch** n**c', 'chảy nước'],
    ['s* s**ng', 'sờ soạng'], ['g**t ch*t', 'giết chết'], ['đ*i', 'đái'],
    ['th* d*c', 'thở dốc'], ['th*n d***', 'thân dưới'], ['l*n đ*nh', 'lên đỉnh'],
    ['l*m t*nh', 'làm tình'], ['th* t*c', 'thô tục'], ['v**t v*', 'vuốt ve'],
    ['d*c v*ng', 'dục vọng'], ['n*ng m*ng', 'nâng mông'], ['g*** h** ch*n', 'giữa hai chân'],
    ['x** n*n', 'xoa nắn'], ['c*m v**', 'cắm vào'], ['tr*n tr**', 'trần trụi'],
    ['h**p', 'hiếp'], ['c*n m** d***', 'cắn môi dưới'], ['c** s*ch', 'cởi sạch'],
    ['th**c l*c', 'thuốc lắc'], ['ph*ng đ*ng', 'phóng đãng'], ['g*m c*n', 'gặm cắn'],
    ['th*n th*', 'thân thể'], ['ch*ch', 'chịch'], ['l* m*ng', 'lỗ mãng'],
    ['m*t', 'mút'], ['r3n rỉ', 'rên rỉ'], ['sh*t', 'shit'], ['h* th*n', 'hạ thân'],
    ['t*nh d*c', 'tình dục'], ['ph*t t*nh', 'phát tình'], ['c*n mút', 'cắn mút'],
    ['c*m', 'cắm'], ['đ*ng q**n', 'đũng quần'], ['s*x*', 'sexy'],
    ['d*m d*c', 'dâm dục'], ['m* t**', 'ma túy'], ['h*m m**n', 'ham muốn'],
    ['d**', 'dái'], ['c** **', 'cao su'], ['đ**m', 'điếm'],
  ];

  const SURNAME_TEMPLATES = [
    'họ {S}', '{S} gia', '{S} thị', 'gia đình {S}', 'nhà {S}',
    'Tiểu {S}', 'tiểu {S}', 'Lão {S}', 'lão {S}', '{S} lão',
    'Chú {S}', 'chú {S}', 'Bác {S}', 'bác {S}',
    'Ông {S}', 'ông {S}', 'Bà {S}', 'bà {S}',
    'Cụ {S}', 'cụ {S}', 'Cậu {S}', 'cậu {S}',
    'Ba {S}', 'ba {S}', 'Mẹ {S}', 'mẹ {S}', 'Bố {S}', 'bố {S}', 'Cha {S}', 'cha {S}',
    'Dì {S}', 'dì {S}', 'Anh {S}', 'anh {S}', 'Chàng {S}', 'chàng {S}',
    'Ngài {S}', 'ngài {S}', 'Sếp {S}', 'sếp {S}', 'Thầy {S}', 'thầy {S}',
    'Ông chủ {S}', 'ông chủ {S}', 'Bà nội {S}', 'bà nội {S}',
    'Ông nội {S}', 'ông nội {S}', 'Ông bà {S}', 'ông bà {S}',
    'Cụ cố {S}', 'cụ cố {S}', 'Cậu em {S}', 'cậu em {S}',
    'Cậu chủ {S}', 'cậu chủ {S}', 'Cậu chủ nhỏ {S}', 'cậu chủ nhỏ {S}',
    'Anh trai {S}', 'anh trai {S}', 'Em trai {S}', 'em trai {S}',
    'Sư phụ {S}', 'sư phụ {S}', 'Thầy giáo {S}', 'thầy giáo {S}',
    'Bạn học {S}', 'bạn học {S}', 'Bạn {S}', 'bạn {S}',
    'học trưởng {S}', 'Học trưởng {S}',
    'bác sĩ {S}', 'Bác sĩ {S}', 'tiến sĩ {S}', 'Tiến sĩ {S}',
    'giám đốc {S}', 'Giám đốc {S}', 'chủ tịch {S}', 'Chủ tịch {S}',
    'cảnh sát {S}', 'Cảnh sát {S}', 'thượng tướng {S}', 'Thượng tướng {S}',
    'đại ca {S}', 'Đại ca {S}', 'đội trưởng {S}', 'Đội trưởng {S}',
    'đội phó {S}', 'Đội phó {S}', 'phó đội {S}', 'Phó đội {S}',
    'nhiếp ảnh gia {S}', 'Nhiếp ảnh gia {S}',
    'đại thiếu gia {S}', 'Đại thiếu gia {S}',
    'ảnh đế {S}', 'Ảnh đế {S}', 'đại sư {S}', 'Đại sư {S}',
    '{S} tổng', '{S} tiên sinh', '{S} thiếu',
    '{S} lão thái thái', '{S} lão thái gia', '{S} vương gia',
    '{S} thí chủ', '{S} đại nhân', '{S} Đại Nhân',
    '{S} đại sư', '{S} Đại sư', '{S} Đại Sư',
    '{S} thúc thúc', '{S} mỗ', '{S} biểu ca',
    '{S} tiểu thế tử', '{S} thế tử', '{S} cục cưng',
    '{S} lão sư', '{S} sư huynh', '{S} sư đệ', '{S} đạo hữu',
    '{S} huynh', '{S} đệ', '{S} sư phụ',
    '{S} ảnh đế', '{S} đại ảnh đế', '{S} phu nhân',
    '{S} ca', '{S} ca ca', '{S} lão gia', '{S} lão tiên sinh',
    '{S} thừa tướng', '{S} Thừa tướng',
    '{S} phủ', '{S} trạch', '{S} lang', '{S} nhi',
    '{S} tiểu thịt tươi', '{S} điện hạ', '{S} hoàng tử',
    '{S} khanh', '{S} tướng quân', '{S} hầu gia', '{S} đại soái',
    '{S} đại thiếu gia', '{S} mẫu', '{S} tiểu tri kỉ', '{S} phụ',
    '{S} nhị thiếu', '{S} nhị thiếu gia', '{S} lão nhị',
    '{S} thiên tài', '{S} đại thiên tài', '{S} phó phòng',
    '{S} thần', '{S} đổng', '{S} tam thiếu', '{S} đại thiếu',
    '{S} tiểu công tử', '{S} đạo', '{S} học thần',
    '{S} đội', '{S} cảnh sát', '{S} phó', '{S} đại ca',
    '{S} thiếu gia', '{S} tướng', '{S} phó trưởng',
  ];

  function generateSurnamePairs(oldS, newS) {
    if (!oldS || !newS || oldS === newS) return [];
    const pairs = [];
    const seen = {};
    for (const tpl of SURNAME_TEMPLATES) {
      const o = tpl.replace(/\{S\}/g, oldS);
      const n = tpl.replace(/\{S\}/g, newS);
      if (!seen[o]) {
        seen[o] = 1;
        pairs.push({ old: o, new: n, type: 'st', ci: false });
      }
    }
    pairs.sort((a, b) => b.old.length - a.old.length);
    return pairs;
  }

  function createDefaultCenList() {
    return DEFAULT_CENSORED.map((p, i) => ({
      id: i,
      find: p[0],
      replace: p[1],
      on: true,
    }));
  }

  /**
   * Thứ tự đổi tên (chỉ tên riêng — viết hoa chữ cái đầu):
   * 1) Họ tên đầy đủ — Khương Vô → Tiêu Chiến (không đụng "vô dụng")
   * 2) Tên + danh xưng — Vô → Chiến, Tiểu Vô → Tiểu Chiến
   * 3) Họ trong danh xưng / họ đơn còn sót — Khương gia → Tiêu gia
   */
  function buildReplacementPhases(options) {
    const { cong, thu, useCen, cenList } = options;
    const prefixes = ['Tiểu', 'Lão', 'Đại', 'A'];

    const cenPairs = [];
    if (useCen) {
      cenList
        .filter((c) => c.on && c.find.trim() && c.replace.trim())
        .map((c) => ({
          old: c.find.trim(),
          new: c.replace.trim(),
          type: 'cen',
          ci: false,
        }))
        .sort((a, b) => b.old.length - a.old.length)
        .forEach((p) => cenPairs.push(p));
    }

    const fullNameRoles = [
      { old: cong.old.trim(), new: cong.new.trim(), type: 'cong' },
      { old: thu.old.trim(), new: thu.new.trim(), type: 'thu' },
    ]
      .filter((p) => p.old && p.new)
      .sort((a, b) => b.old.length - a.old.length);

    const givenPairs = [];
    const givenSeen = {};

    function addGiven(p) {
      if (!p.old || !p.new || p.old === p.new || givenSeen[p.old]) return;
      givenSeen[p.old] = 1;
      givenPairs.push(p);
    }

    function addGivenForRole(oldFull, newFull, type) {
      const oldGiven = getGivenName(oldFull);
      const newGiven = getGivenName(newFull);
      if (!oldGiven || !newGiven) return;

      // "Trọng Trọng" → "Nhất Bác Nhất Bác"
      addGiven({
        old: `${oldGiven} ${oldGiven}`,
        new: `${newGiven} ${newGiven}`,
        type,
        ci: false,
      });

      for (const pre of prefixes) {
        addGiven({
          old: `${pre} ${oldGiven}`,
          new: `${pre} ${newGiven}`,
          type,
          ci: false,
        });
      }

      // Tên đơn — chỉ khớp đúng hoa/thường (Vô, không phải vô)
      addGiven({
        old: oldGiven,
        new: newGiven,
        type,
        ci: false,
        wordBound: true,
      });
    }

    addGivenForRole(cong.old, cong.new, 'cong');
    addGivenForRole(thu.old, thu.new, 'thu');
    givenPairs.sort((a, b) => b.old.length - a.old.length);

    // Phase 3: danh xưng họ + họ đơn
    const surnameTemplatePairs = generateSurnamePairs(
      getSurname(cong.old),
      getSurname(cong.new)
    ).concat(
      generateSurnamePairs(getSurname(thu.old), getSurname(thu.new))
    ).sort((a, b) => b.old.length - a.old.length);

    const surnameSingles = [
      { oldS: getSurname(cong.old), newS: getSurname(cong.new), type: 'ss' },
      { oldS: getSurname(thu.old), newS: getSurname(thu.new), type: 'ss' },
    ].filter((s) => s.oldS && s.newS && s.oldS !== s.newS);

    return {
      cenPairs,
      fullNameRoles,
      givenPairs,
      surnameTemplatePairs,
      surnameSingles,
    };
  }

  function applyReplacementsToText(text, options) {
    const phases = buildReplacementPhases(options);
    const stats = [];
    const totalByType = { cen: 0, st: 0, cong: 0, thu: 0, ss: 0, restore: 0 };

    text = stripPromoNoise(text);

    const beforeRestore = text;
    text = restoreObfuscatedWords(text);
    if (text !== beforeRestore) {
      totalByType.restore = 1;
    }

    // 1) Từ kiểm duyệt *** 
    text = applyPairList(text, phases.cenPairs, stats, totalByType);

    for (const role of phases.fullNameRoles) {
      text = applyFullNameReplacements(text, role.old, role.new, role.type, stats, totalByType);
    }

    for (const p of phases.givenPairs) {
      if (p.wordBound) {
        const r = properNameReplace(text, p.old, p.new);
        if (r.count > 0) {
          text = r.text;
          stats.push({ old: p.old, new: p.new, n: r.count, type: p.type });
          totalByType[p.type] = (totalByType[p.type] || 0) + r.count;
        }
      } else {
        text = applyPairList(text, [p], stats, totalByType);
      }
    }

    // 3) Danh xưng họ rồi họ đơn còn sót
    text = applyPairList(text, phases.surnameTemplatePairs, stats, totalByType);

    for (const sp of phases.surnameSingles) {
      const r = smartSurnameReplace(text, sp.oldS, sp.newS);
      text = r.text;
      if (r.count > 0) {
        stats.push({ old: sp.oldS, new: sp.newS, n: r.count, type: 'ss' });
        totalByType.ss += r.count;
      }
    }

    const remaining = [];
    const congS = getSurname(options.cong.old);
    const thuS = getSurname(options.thu.old);
    if (congS) {
      const c1 = countOcc(text, congS, false);
      if (c1 > 0) remaining.push({ s: congS, cnt: c1, label: 'Công' });
    }
    if (thuS) {
      const c2 = countOcc(text, thuS, false);
      if (c2 > 0) remaining.push({ s: thuS, cnt: c2, label: 'Thụ' });
    }

    return { text, stats, totalByType, remaining };
  }

  global.ChangeVersion = {
    DEFAULT_CENSORED,
    DOTTED_RESTORE_WORDS,
    SURNAME_TEMPLATES,
    createDefaultCenList,
    applyReplacementsToText,
    restoreObfuscatedWords,
    stripPromoNoise,
    cleanPromoParagraph,
    isPromoParagraph,
    countOcc,
    getSurname,
    getGivenName,
  };
})(window);
