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

  function smartSurnameReplace(text, oldS, newS) {
    if (!oldS || !newS || oldS === newS) return { text, count: 0 };
    const VI = 'a-zA-ZÀ-ỹĐđ';
    let count = 0;
    try {
      const result = text.replace(
        new RegExp(`(^|[^${VI}])${esc(oldS)}(?=[^${VI}]|$)`, 'gm'),
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

  const DEFAULT_CENSORED = [
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
        pairs.push({ old: o, new: n, type: 'st', ci: true });
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

  function buildAllPairs(options) {
    const { cong, thu, useCen, cenList } = options;
    const pairs = [];
    const seen = {};

    function addPair(p) {
      if (!seen[p.old]) {
        seen[p.old] = 1;
        pairs.push(p);
      }
    }

    if (useCen) {
      const cen = cenList
        .filter((c) => c.on && c.find.trim() && c.replace.trim())
        .map((c) => ({
          old: c.find.trim(),
          new: c.replace.trim(),
          type: 'cen',
          ci: false,
        }))
        .sort((a, b) => b.old.length - a.old.length);
      cen.forEach(addPair);
    }

    const congST = generateSurnamePairs(getSurname(cong.old), getSurname(cong.new));
    const thuST = generateSurnamePairs(getSurname(thu.old), getSurname(thu.new));
    const allST = congST.concat(thuST).sort((a, b) => b.old.length - a.old.length);
    allST.forEach(addPair);

    if (cong.old.trim() && cong.new.trim()) {
      addPair({ old: cong.old.trim(), new: cong.new.trim(), type: 'cong', ci: true });
    }
    if (thu.old.trim() && thu.new.trim()) {
      addPair({ old: thu.old.trim(), new: thu.new.trim(), type: 'thu', ci: true });
    }

    const congOldLast = cong.old.trim().split(/\s+/).slice(-1)[0];
    const congNewLast = cong.new.trim().split(/\s+/).slice(-1)[0];
    const thuOldLast = thu.old.trim().split(/\s+/).slice(-1)[0];
    const thuNewLast = thu.new.trim().split(/\s+/).slice(-1)[0];
    const prefixes = ['Tiểu', 'tiểu', 'A', 'a', 'Lão', 'lão', 'Đại', 'đại', 'Bé', 'Nhỏ'];

    if (congOldLast && congNewLast && congOldLast !== congNewLast) {
      addPair({
        old: `${congOldLast} ${congOldLast}`,
        new: `${congNewLast} ${congNewLast}`,
        type: 'cong',
        ci: true,
      });
      for (const pre of prefixes) {
        addPair({
          old: `${pre} ${congOldLast}`,
          new: `${pre} ${congNewLast}`,
          type: 'cong',
          ci: false,
        });
      }
    }

    if (thuOldLast && thuNewLast && thuOldLast !== thuNewLast) {
      addPair({
        old: `${thuOldLast} ${thuOldLast}`,
        new: `${thuNewLast} ${thuNewLast}`,
        type: 'thu',
        ci: true,
      });
      for (const pre of prefixes) {
        addPair({
          old: `${pre} ${thuOldLast}`,
          new: `${pre} ${thuNewLast}`,
          type: 'thu',
          ci: false,
        });
      }
    }

    pairs.sort((a, b) => b.old.length - a.old.length);
    return pairs;
  }

  function applyReplacementsToText(text, options) {
    const pairs = buildAllPairs(options);
    const stats = [];
    const totalByType = { cen: 0, st: 0, cong: 0, thu: 0, ss: 0 };

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

    const smartPairs = [
      { oldS: getSurname(options.cong.old), newS: getSurname(options.cong.new) },
      { oldS: getSurname(options.thu.old), newS: getSurname(options.thu.new) },
    ];

    for (const sp of smartPairs) {
      if (!sp.oldS || !sp.newS || sp.oldS === sp.newS) continue;
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
      const c1 = countOcc(text, congS, true);
      if (c1 > 0) remaining.push({ s: congS, cnt: c1, label: 'Công' });
    }
    if (thuS) {
      const c2 = countOcc(text, thuS, true);
      if (c2 > 0) remaining.push({ s: thuS, cnt: c2, label: 'Thụ' });
    }

    return { text, stats, totalByType, remaining };
  }

  global.ChangeVersion = {
    DEFAULT_CENSORED,
    SURNAME_TEMPLATES,
    createDefaultCenList,
    applyReplacementsToText,
    countOcc,
    getSurname,
  };
})(window);
