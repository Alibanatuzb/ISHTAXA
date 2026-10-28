'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function flag(v) {
  return v === '1' || v === 'true';
}

function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const production = env.NODE_ENV === 'production';

  const adminPath = env.ADMIN_PATH || '/admin';
  if (!/^\/[A-Za-z0-9_-]{3,40}$/.test(adminPath)) {
    throw new Error('ADMIN_PATH notoʻgʻri. Masalan: /boshqaruv-7k2x (faqat harf, raqam, - va _).');
  }
  if (['/api', '/css', '/js', '/fonts'].includes(adminPath)) {
    throw new Error('ADMIN_PATH band yoʻl nomi. Boshqa nom tanlang.');
  }

  return {
    root: ROOT,
    publicDir: path.join(ROOT, 'public'),
    viewsDir: path.join(ROOT, 'views'),
    port: env.PORT !== undefined && env.PORT !== '' ? Number(env.PORT) : 3000,
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    dbFile: env.DB_FILE || path.join(ROOT, 'data', 'ishtaxa.db'),
    production,
    trustProxy: flag(env.TRUST_PROXY),
    adminPath,
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    // Sinov uchun sozlanadigan chegaralar
    limits: {
      orderPerIp: Number(env.ORDER_LIMIT_PER_IP) || 6,
      orderWindowMs: 10 * 60 * 1000,
      orderGlobal: Number(env.ORDER_LIMIT_GLOBAL) || 400,
      loginFailsPerIp: Number(env.LOGIN_FAILS_PER_IP) || 5,
      loginWindowMs: 15 * 60 * 1000,
      sessionIdleMs: 2 * 60 * 60 * 1000,
      sessionMaxMs: 12 * 60 * 60 * 1000,
    },
  };
}

module.exports = { loadConfig };
