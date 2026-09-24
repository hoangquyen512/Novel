const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'feedback.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, '[]\n', 'utf8');
  }
}

function readAll() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8').trim() || '[]';
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('feedback-store read failed:', err.message || err);
    return [];
  }
}

function writeAll(items) {
  ensureStore();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

function createFeedback(entry) {
  const items = readAll();
  const row = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type: entry.type,
    message: entry.message,
    contact: entry.contact || '',
    version: entry.version || '',
    pageUrl: entry.pageUrl || '',
    userAgent: entry.userAgent || '',
    ip: entry.ip || '',
    status: 'open',
    resolvedAt: null,
  };
  items.unshift(row);
  writeAll(items);
  return row;
}

function listFeedback(filters = {}) {
  let items = readAll();
  const { status, type, from, to, q } = filters;

  if (status === 'open' || status === 'done') {
    items = items.filter((x) => x.status === status);
  }
  if (type === 'bug' || type === 'idea') {
    items = items.filter((x) => x.type === type);
  }
  if (from) {
    const fromMs = Date.parse(from);
    if (Number.isFinite(fromMs)) {
      items = items.filter((x) => Date.parse(x.createdAt) >= fromMs);
    }
  }
  if (to) {
    let toMs = Date.parse(to);
    if (Number.isFinite(toMs)) {
      // If date-only (YYYY-MM-DD), include the whole day
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) {
        toMs += 24 * 60 * 60 * 1000 - 1;
      }
      items = items.filter((x) => Date.parse(x.createdAt) <= toMs);
    }
  }
  if (q) {
    const needle = String(q).trim().toLowerCase();
    if (needle) {
      items = items.filter((x) => {
        const hay = [x.message, x.contact, x.pageUrl, x.version, x.ip]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        return hay.includes(needle);
      });
    }
  }

  return items;
}

function setStatus(id, status) {
  if (status !== 'open' && status !== 'done') {
    return { ok: false, error: 'Trạng thái không hợp lệ.' };
  }
  const items = readAll();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) {
    return { ok: false, error: 'Không tìm thấy log.' };
  }
  items[idx].status = status;
  items[idx].resolvedAt = status === 'done' ? new Date().toISOString() : null;
  writeAll(items);
  return { ok: true, item: items[idx] };
}

module.exports = {
  createFeedback,
  listFeedback,
  setStatus,
  STORE_PATH,
};
