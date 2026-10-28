'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------- Tasodifiy qiymatlar va xeshlar ---------- */

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Vaqtga bogʻliq boʻlmagan solishtirish (uzunlik farqi ham sirqib chiqmaydi)
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a)).digest();
  const db = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

/* ---------- Parol ---------- */

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomToken(16));
  return dummyHashPromise;
}

async function verifyPassword(password, stored) {
  let usable = stored;
  let valid = true;
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    usable = await dummyHash();
    valid = false;
  }
  const [, N, r, p, saltB64, hashB64] = usable.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password), salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  const same = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  return same && valid;
}

function passwordProblem(password) {
  if (typeof password !== 'string') return 'Parol matn boʻlishi kerak.';
  if (password.length < 10) return 'Parol kamida 10 ta belgidan iborat boʻlishi kerak.';
  if (password.length > 128) return 'Parol 128 ta belgidan oshmasligi kerak.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Parolda kamida bitta harf va bitta raqam boʻlsin.';
  }
  return null;
}

function generatePassword(length = 20) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  while (out.length < length) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
  }
  // kamida bitta raqam va harf boʻlishini kafolatlaymiz
  return /\d/.test(out) && /[A-Za-z]/.test(out) ? out : generatePassword(length);
}

/* ---------- Soʻrov yordamchilari ---------- */

function isSecureRequest(req, config) {
  if (req.socket && req.socket.encrypted) return true;
  if (config.trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
  }
  return false;
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      // Ishonchli proksi qoʻshgan oxirgi yozuv — haqiqiy mijoz manzili
      if (parts.length) return parts[parts.length - 1].slice(0, 64);
    }
  }
  return String((req.socket && req.socket.remoteAddress) || 'unknown').slice(0, 64);
}

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

/* ---------- Tezlik cheklovi ---------- */

function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, 60 * 1000);
  timer.unref();

  function entry(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset <= now) {
      if (hits.size > 50000) hits.clear(); // xotirani toʻldirib yuborishdan himoya
      e = { count: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    return e;
  }

  return {
    // Hisobga olmasdan tekshiradi
    check(key) {
      const e = entry(key);
      return { ok: e.count < max, retryAfter: Math.max(1, Math.ceil((e.reset - Date.now()) / 1000)) };
    },
    // Bitta urinishni hisobga oladi; ruxsat boʻlsa ok:true
    consume(key) {
      const e = entry(key);
      const ok = e.count < max;
      if (ok) e.count += 1;
      return { ok, retryAfter: Math.max(1, Math.ceil((e.reset - Date.now()) / 1000)) };
    },
    hit(key) {
      entry(key).count += 1;
    },
    count(key) {
      return entry(key).count;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/* ---------- Xavfsizlik sarlavhalari ---------- */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function applySecurityHeaders(res, { secure, production }) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (secure || production) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

module.exports = {
  randomToken,
  sha256,
  safeEqual,
  hashPassword,
  verifyPassword,
  passwordProblem,
  generatePassword,
  isSecureRequest,
  clientIp,
  parseCookies,
  createLimiter,
  applySecurityHeaders,
};
