'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, orderBody, ADMIN_PASSWORD, ADMIN_PATH } = require('./helpers');

let t;
before(async () => { t = await start(); });
after(async () => { await t.close(); });

const ADMIN_ENDPOINTS = [
  ['GET', '/api/admin/session'],
  ['GET', '/api/admin/orders'],
  ['GET', '/api/admin/stats'],
  ['GET', '/api/admin/items'],
  ['GET', '/api/admin/settings'],
  ['POST', '/api/admin/orders/1/status', { status: 'done' }],
  ['POST', '/api/admin/items', { name: 'x' }],
  ['PUT', '/api/admin/items/1', { name: 'x' }],
  ['DELETE', '/api/admin/items/1'],
  ['PUT', '/api/admin/settings', {}],
  ['POST', '/api/admin/password', { current: 'a', next: 'b' }],
  ['POST', '/api/admin/logout', {}],
];

test('kirmagan foydalanuvchi uchun barcha admin API 401 qaytaradi', async () => {
  for (const [method, path, body] of ADMIN_ENDPOINTS) {
    const r = await t.json(path, { method, body });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('notoʻgʻri yoki soxta sessiya kaliti bilan kirib boʻlmaydi', async () => {
  for (const c of ['ish_sid=abc', `ish_sid=${'0'.repeat(64)}`, 'ish_sid=; admin=1', `ish_sid=${'a'.repeat(64)}`]) {
    const r = await t.json('/api/admin/orders', { cookie: c });
    assert.equal(r.status, 401, c);
  }
});

test('notoʻgʻri parol/login rad etiladi, xabar qaysi biri xato ekanini bildirmaydi', async () => {
  const a = await t.login('notogri-parol-123');
  const b = await t.login(ADMIN_PASSWORD, 'boshqa');
  assert.equal(a.res.status, 401);
  assert.equal(b.res.status, 401);
  assert.equal(a.res.data.error, b.res.data.error);
});

test('SQL in’yeksiyasi va notoʻgʻri tipdagi login maʼlumotlari kirishga yoʻl qoʻymaydi', async () => {
  for (const body of [
    { username: "admin' OR '1'='1", password: "x' OR '1'='1" },
    { username: { $ne: null }, password: { $ne: null } },
    { username: ['admin'], password: [ADMIN_PASSWORD] },
    { username: 'admin', password: '' },
    {},
  ]) {
    const r = await t.json('/api/admin/login', { method: 'POST', body });
    assert.equal(r.status, 401, JSON.stringify(body));
  }
});

test('toʻgʻri kirishda cookie HttpOnly va SameSite=Strict boʻladi', async () => {
  const l = await t.login();
  assert.equal(l.res.status, 200);
  assert.match(l.setCookie, /HttpOnly/i);
  assert.match(l.setCookie, /SameSite=Strict/i);
  assert.match(l.setCookie, /Path=\//);
  assert.ok(/^ish_sid=[0-9a-f]{64}$/.test(l.cookie));
  // Sessiya kaliti bazada xesh koʻrinishida saqlanadi (oʻzi emas)
  const token = l.cookie.split('=')[1];
  const rows = t.app.db.raw.prepare('SELECT token_hash FROM sessions').all();
  assert.ok(rows.length === 1 && rows[0].token_hash !== token);
});

test('HTTPS orqali (proksi) kirilganda cookie Secure va __Host- bilan beriladi', async () => {
  const s = await start({ TRUST_PROXY: '1' });
  try {
    const res = await s.json('/api/admin/login', {
      method: 'POST', headers: { 'X-Forwarded-Proto': 'https' },
      body: { username: 'admin', password: ADMIN_PASSWORD },
    });
    const sc = res.headers.get('set-cookie');
    assert.match(sc, /^__Host-ish_sid=/);
    assert.match(sc, /Secure/);
    assert.ok(res.headers.get('strict-transport-security'));
  } finally { await s.close(); }
});

test('CSRF: kalitsiz yoki notoʻgʻri kalit bilan oʻzgartirish rad etiladi', async () => {
  const l = await t.login();
  const noCsrf = await t.json('/api/admin/items', { method: 'POST', cookie: l.cookie, body: { name: 'Test' } });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.code, 'csrf');
  const wrong = await t.json('/api/admin/items', { method: 'POST', cookie: l.cookie, csrf: 'x'.repeat(48), body: { name: 'Test' } });
  assert.equal(wrong.status, 403);
});

test('boshqa saytdan (Origin) kelgan admin soʻrovi cookie bilan ham rad etiladi', async () => {
  const l = await t.login();
  const r = await t.json('/api/admin/settings', {
    method: 'PUT', cookie: l.cookie, csrf: l.csrf, origin: 'https://yomon-sayt.example', body: {},
  });
  assert.equal(r.status, 403);
});

test('faqat bitta faol sessiya: yangi kirish eskisini tugatadi', async () => {
  const first = await t.login();
  assert.equal((await t.json('/api/admin/session', { cookie: first.cookie })).status, 200);
  const second = await t.login();
  assert.equal((await t.json('/api/admin/session', { cookie: first.cookie })).status, 401);
  assert.equal((await t.json('/api/admin/session', { cookie: second.cookie })).status, 200);
});

test('chiqishdan soʻng sessiya yaroqsiz boʻladi', async () => {
  const l = await t.login();
  const out = await t.json('/api/admin/logout', { method: 'POST', cookie: l.cookie, csrf: l.csrf, body: {} });
  assert.equal(out.status, 200);
  assert.equal((await t.json('/api/admin/orders', { cookie: l.cookie })).status, 401);
});

test('harakatsizlik va umumiy muddat tugasa sessiya yaroqsiz boʻladi', async () => {
  let l = await t.login();
  t.app.db.raw.exec('UPDATE sessions SET last_seen = last_seen - 3 * 3600 * 1000');
  assert.equal((await t.json('/api/admin/orders', { cookie: l.cookie })).status, 401);
  l = await t.login();
  t.app.db.raw.exec('UPDATE sessions SET created_at = created_at - 13 * 3600 * 1000');
  assert.equal((await t.json('/api/admin/orders', { cookie: l.cookie })).status, 401);
});

test('parol tanlab topishdan himoya: 5 ta xatodan soʻng bloklanadi (toʻgʻri parol ham)', async () => {
  const s = await start({ LOGIN_FAILS_PER_IP: '5' });
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal((await s.login(`xato-parol-${i}`)).res.status, 401);
    }
    const blocked = await s.login(ADMIN_PASSWORD);
    assert.equal(blocked.res.status, 429);
    assert.ok(blocked.res.headers.get('retry-after'));
  } finally { await s.close(); }
});

test('parol oʻzgartirish: joriy parol shart, kuchsiz parol rad etiladi, eski sessiyalar tugaydi', async () => {
  const s = await start();
  try {
    let l = await s.login();
    const call = (body) => s.json('/api/admin/password', { method: 'POST', cookie: l.cookie, csrf: l.csrf, body });
    assert.equal((await call({ current: 'notogri', next: 'YangiParol12345' })).status, 403);
    assert.equal((await call({ current: ADMIN_PASSWORD, next: 'qisqa1' })).status, 422);
    assert.equal((await call({ current: ADMIN_PASSWORD, next: 'faqatharflarbor' })).status, 422);
    assert.equal((await call({ current: ADMIN_PASSWORD, next: ADMIN_PASSWORD })).status, 422);
    assert.equal((await call({ current: ADMIN_PASSWORD, next: 'YangiParol12345' })).status, 200);
    assert.equal((await s.json('/api/admin/orders', { cookie: l.cookie })).status, 401);
    assert.equal((await s.login(ADMIN_PASSWORD)).res.status, 401);
    assert.equal((await s.login('YangiParol12345')).res.status, 200);
  } finally { await s.close(); }
});

test('parol bazada ochiq koʻrinishda saqlanmaydi (scrypt + tuz)', async () => {
  const row = t.app.db.getAdmin();
  assert.ok(row.pass_hash.startsWith('scrypt$'));
  assert.ok(!row.pass_hash.includes(ADMIN_PASSWORD));
});

test('yashirin admin sahifasi faqat oʻz yoʻlida ochiladi, qidiruvdan yashiriladi', async () => {
  const ok = await t.raw(ADMIN_PATH);
  assert.equal(ok.status, 200);
  assert.match(ok.headers['x-robots-tag'], /noindex/);
  assert.equal(ok.headers['cache-control'], 'no-store');
  for (const p of ['/admin', '/admin/', '/admin/index.html', '/boshqaruv', '/login', '/wp-admin']) {
    assert.equal((await t.raw(p)).status, 404, p);
  }
  assert.ok(!(await t.raw('/robots.txt')).text.includes(ADMIN_PATH));
});

test('yoʻl chiqib ketish (path traversal) va maxfiy fayllar ochilmaydi', async () => {
  const attempts = [
    '/../src/config.js', '/..%2fsrc%2fconfig.js', '/%2e%2e/src/config.js', '/%2e%2e%2fsrc%2fconfig.js',
    '/css/../../src/db.js', '/css/%2e%2e/%2e%2e/package.json', '/..\\src\\config.js', '/%5c..%5csrc%5cconfig.js',
    '/data/ishtaxa.db', '/ishtaxa.db', '/.env', '/.git/config', '/package.json', '/src/server.js',
    '/%00.html', '/index.html%00.png', '//etc/passwd', '/../../../../etc/passwd',
  ];
  for (const p of attempts) {
    const r = await t.raw(p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!/require\(|scrypt|SELECT /.test(r.text), `${p} manba kodini sizdirdi`);
  }
});

test('xavfsizlik sarlavhalari barcha javoblarda bor', async () => {
  for (const p of ['/', '/api/menu', '/yoq-sahifa', ADMIN_PATH]) {
    const r = await t.raw(p);
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(r.headers['content-security-policy'], /script-src 'self'(;|$)/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.ok(r.headers['referrer-policy']);
    assert.ok(!r.headers['x-powered-by']);
  }
});

test('boshqa HTTP usullar rad etiladi; xato javoblar ichki maʼlumot bermaydi', async () => {
  assert.equal((await t.raw('/', { method: 'POST' })).status, 405);
  assert.equal((await t.raw('/api/menu', { method: 'DELETE' })).status, 405);
  assert.equal((await t.raw('/api/orders', { method: 'GET' })).status, 405);
  assert.equal((await t.raw('/', { method: 'TRACE' })).status, 405);
  const nf = await t.raw('/api/yoq');
  assert.equal(nf.status, 404);
  assert.ok(!/at .*\.js:\d+/.test(nf.text));
});

test('admin API menyu va sozlamalar orqali mijoz narxlariga taʼsir qiladi (toʻliq aylanish)', async () => {
  const l = await t.login();
  const as = (method, path, body) => t.json(path, { method, cookie: l.cookie, csrf: l.csrf, body });

  // yangi taom
  const made = await as('POST', '/api/admin/items', { name: 'Sinov taomi', category: 'Burgerlar', description: '<b>x</b>', price: 20000, emoji: '🍔', sort: 5, active: true });
  assert.equal(made.status, 201);
  const id = made.data.item.id;
  assert.ok((await t.json('/api/menu')).data.items.some((i) => i.id === id));

  // yaroqsiz narx
  assert.equal((await as('PUT', `/api/admin/items/${id}`, { ...made.data.item, price: -5 })).status, 422);
  assert.equal((await as('PUT', `/api/admin/items/${id}`, { ...made.data.item, price: 'bepul' })).status, 422);

  // aksiyani 3+1 ga oʻzgartirish
  const st = (await as('GET', '/api/admin/settings')).data.settings;
  const upd = await as('PUT', '/api/admin/settings', { ...st, promo_buy: 3, promo_free: 1 });
  assert.equal(upd.status, 200);
  const o = await t.json('/api/orders', { method: 'POST', body: orderBody([{ id, qty: 3 }]) });
  assert.equal(o.data.order.lines[0].free, 1);

  // aksiyani oʻchirish
  await as('PUT', '/api/admin/settings', { ...st, promo_buy: 3, promo_free: 1, promo_on: false });
  const o2 = await t.json('/api/orders', { method: 'POST', body: orderBody([{ id, qty: 3 }]) });
  assert.equal(o2.data.order.lines[0].free, 0);

  // yashirilgan taomga buyurtma berib boʻlmaydi
  await as('PUT', `/api/admin/items/${id}`, { ...made.data.item, active: false });
  assert.ok(!(await t.json('/api/menu')).data.items.some((i) => i.id === id));
  assert.equal((await t.json('/api/orders', { method: 'POST', body: orderBody([{ id, qty: 3 }]) })).status, 409);

  // buyurtma holati admin tomonidan oʻzgaradi va mijoz koʻradi
  const list = await as('GET', '/api/admin/orders?scope=all');
  const mine = list.data.orders.find((x) => x.code === o.data.order.code);
  assert.equal(mine.name, 'Ali Valiyev');
  assert.equal((await as('POST', `/api/admin/orders/${mine.id}/status`, { status: 'delivering' })).status, 200);
  assert.equal((await as('POST', `/api/admin/orders/${mine.id}/status`, { status: 'hack' })).status, 422);
  assert.equal((await t.json(`/api/orders/${o.data.order.token}`)).data.order.status, 'delivering');

  // buyurtma tarixi: taom oʻchirilsa ham eski buyurtma qoladi
  assert.equal((await as('DELETE', `/api/admin/items/${id}`)).status, 200);
  const after = await as('GET', '/api/admin/orders?scope=all');
  assert.ok(after.data.orders.some((x) => x.code === o.data.order.code));

  // doʻkon yopilsa buyurtma qabul qilinmaydi
  await as('PUT', '/api/admin/settings', { ...st, shop_open: false });
  const items = (await t.json('/api/menu')).data.items;
  assert.equal((await t.json('/api/orders', { method: 'POST', body: orderBody([{ id: items[0].id, qty: 2 }]) })).status, 409);
  await as('PUT', '/api/admin/settings', { ...st });
});
