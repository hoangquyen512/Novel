const fs = require('fs');
const yauzl = require('yauzl');
const { xmlToRawText, textToParagraphs } = require('./docx-xml');

function readStreamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/**
 * Stream-only extract of word/document.xml (never decompress images/media).
 * Prefer filePath (disk) over buffer to keep peak RAM lower on Render.
 */
async function extractRawTextFromDocx({ filePath, buffer } = {}) {
  let zipfile;
  if (filePath) {
    zipfile = await yauzl.openPromise(filePath, { lazyEntries: true, autoClose: false });
  } else if (buffer) {
    zipfile = await yauzl.fromBufferPromise(buffer, { lazyEntries: true });
  } else {
    throw new Error('Thiếu dữ liệu file .docx.');
  }

  try {
    for await (const entry of zipfile.eachEntry()) {
      const name = String(entry.fileName || '').replace(/\\/g, '/');
      if (name !== 'word/document.xml') continue;
      const readStream = await zipfile.openReadStreamPromise(entry);
      const xml = await readStreamToString(readStream);
      return xmlToRawText(xml);
    }
  } finally {
    try {
      zipfile.close();
    } catch (_) {
      /* ignore */
    }
  }

  throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  extractRawTextFromDocx,
  textToParagraphs,
  xmlToRawText,
  safeUnlink,
};
