'use strict';

const http = require('node:http');
const { createApp } = require('../src/server');
const { loadConfig } = require('../src/config');

const ADMIN_PASSWORD = 'Sinov12345pass';
const ADMIN_PATH = '/panel-sinov';

async function start(overrides = {}) {
  const config = loadConfig({
    PORT: '0',
    DB_FILE: ':memory:',
    ADMIN_PASSWORD,
    ADMIN_PATH,
    ORDER_LIMIT_PER_IP: '1000',
    ORDER_LIMIT_GLOBAL: '1000',
    LOGIN_FAILS_PER_IP: '1000',
    ...overrides,
  });
  const app = createApp(config);
  await app.init();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // fetch: yoʻl avtomatik normallashtiriladi. raw: yoʻl aynan yuborilganidek ketadi.
  const raw = (path, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  async function json(path, { method = 'GET', body, cookie, csrf, origin, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (csrf) h['X-CSRF-Token'] = csrf;
    if (origin) h.Origin = origin;
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch { /* json emas */ }
    return { status: res.status, headers: res.headers, data };
  }

  async function login(password = ADMIN_PASSWORD, username = 'admin') {
    const res = await json('/api/admin/login', { method: 'POST', body: { username, password } });
    const setCookie = res.headers.get('set-cookie') || '';
    return { res, cookie: setCookie.split(';')[0], csrf: res.data && res.data.csrf, setCookie };
  }

  return { app, base, port, raw, json, login, close: () => app.close() };
}

let n = 0;
const orderBody = (items, extra = {}) => ({
  name: 'Ali Valiyev',
  phone: '90 123 45 67',
  address: 'Chilonzor 5-kvartal, 12-uy',
  payment: 'cash',
  key: `test-key-${Date.now()}-${n++}`,
  items,
  ...extra,
});

module.exports = { start, orderBody, ADMIN_PASSWORD, ADMIN_PATH };
