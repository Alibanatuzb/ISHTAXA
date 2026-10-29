'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, orderBody } = require('./helpers');

let t;
before(async () => { t = await start(); });
after(async () => { await t.close(); });

const menu = async () => (await t.json('/api/menu')).data;
const place = (body) => t.json('/api/orders', { method: 'POST', body });

test('menyu ochiq va aksiya sozlamalari bor', async () => {
  const m = await menu();
  assert.ok(m.items.length >= 10);
  assert.equal(m.settings.promo_buy, 4);
  assert.equal(m.settings.promo_free, 1);
});

test('4 ta olganga 1 ta bonus: 3 ta — bonus yoʻq, 4 ta — 1, 8 ta — 2', async () => {
  const { items } = await menu();
  const it = items[0];
  for (const [qty, free] of [[3, 0], [4, 1], [7, 1], [8, 2]]) {
    const r = await place(orderBody([{ id: it.id, qty }]));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.order.lines[0].free, free, `qty=${qty}`);
    assert.equal(r.data.order.subtotal, it.price * qty, 'bonus narxga qoʻshilmaydi');
  }
});

test('narx va jami faqat serverda hisoblanadi (mijoz yuborgan narx eʼtiborga olinmaydi)', async () => {
  const { items, settings } = await menu();
  const it = items[0];
  const r = await place(orderBody([{ id: it.id, qty: 1, price: 1, unitPrice: 1 }], { total: 1, subtotal: 1, deliveryFee: 0 }));
  assert.equal(r.status, 201);
  const expectedFee = it.price >= settings.free_from && settings.free_from > 0 ? 0 : settings.delivery_fee;
  assert.equal(r.data.order.subtotal, it.price);
  assert.equal(r.data.order.total, it.price + expectedFee);
});

test('yetkazish bepul chegarasidan oshsa yetkazish narxi 0', async () => {
  const { items, settings } = await menu();
  const it = items.find((i) => i.price * 10 >= settings.free_from);
  const r = await place(orderBody([{ id: it.id, qty: 10 }]));
  assert.equal(r.status, 201);
  assert.equal(r.data.order.deliveryFee, 0);
});

test('bir xil buyurtma kaliti ikki marta yuborilsa, bitta buyurtma yaratiladi', async () => {
  const { items } = await menu();
  const body = orderBody([{ id: items[0].id, qty: 2 }]);
  const a = await place(body);
  const b = await place(body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(a.data.order.code, b.data.order.code);
  const count = t.app.db.raw.prepare('SELECT COUNT(*) AS c FROM orders WHERE idem = ?').get(body.key).c;
  assert.equal(count, 1);
});

test('notoʻgʻri kiritishlar rad etiladi', async () => {
  const { items } = await menu();
  const id = items[0].id;
  const bad = [
    orderBody([]),
    orderBody([{ id, qty: 0 }]),
    orderBody([{ id, qty: 51 }]),
    orderBody([{ id, qty: 1.5 }]),
    orderBody([{ id, qty: -3 }]),
    orderBody([{ id, qty: '1; DROP TABLE orders' }]),
    orderBody([{ id: 'abc', qty: 1 }]),
    orderBody([{ id, qty: 1 }], { phone: '12345' }),
    orderBody([{ id, qty: 1 }], { phone: 'salom' }),
    orderBody([{ id, qty: 1 }], { name: '' }),
    orderBody([{ id, qty: 1 }], { address: 'a' }),
    orderBody([{ id, qty: 1 }], { payment: 'bitcoin' }),
    orderBody([{ id, qty: 1 }], { key: 'x' }),
    orderBody([{ id, qty: 1 }], { name: 'x'.repeat(500) }),
    orderBody([{ id, qty: 1 }], { note: 'y'.repeat(500) }),
  ];
  for (const b of bad) {
    const r = await place(b);
    assert.ok(r.status === 422 || r.status === 400, `kutilgan 4xx: ${JSON.stringify(b).slice(0, 80)} -> ${r.status}`);
  }
  const r = await t.json('/api/orders', { method: 'POST', body: orderBody([{ id, qty: 1 }]) });
  assert.equal(r.status, 201);
});

test('mavjud boʻlmagan yoki oʻchirilgan taom bilan buyurtma berib boʻlmaydi', async () => {
  const r = await place(orderBody([{ id: 999999, qty: 1 }]));
  assert.equal(r.status, 409);
});

test('minimal buyurtma summasidan kam boʻlsa rad etiladi', async () => {
  const { items, settings } = await menu();
  const cheap = items.find((i) => i.price < settings.min_order);
  assert.ok(cheap, 'sinov uchun arzon taom kerak');
  const r = await place(orderBody([{ id: cheap.id, qty: 1 }]));
  assert.equal(r.status, 422);
  assert.equal(r.data.code, 'min_order');
});

test('HTML/skript matni oddiy matn sifatida saqlanadi va JSON sifatida qaytadi', async () => {
  const { items } = await menu();
  const xss = '<img src=x onerror=alert(1)>';
  const r = await place(orderBody([{ id: items[0].id, qty: 1 }], { name: xss }));
  assert.equal(r.status, 201);
  const row = t.app.db.raw.prepare('SELECT name FROM orders ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.name, xss);
});

test('boshqaruv belgilari va koʻrinmas yoʻnalish belgilari tozalanadi', async () => {
  const { items } = await menu();
  const r = await place(orderBody([{ id: items[0].id, qty: 1 }], { name: 'Ali\u0000‮Vali' }));
  assert.equal(r.status, 201);
  const row = t.app.db.raw.prepare('SELECT name FROM orders ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.name, 'AliVali');
});

test('buyurtma holatini faqat uzun tasodifiy kalit bilan koʻrish mumkin', async () => {
  const { items } = await menu();
  const r = await place(orderBody([{ id: items[0].id, qty: 1 }]));
  const ok = await t.json(`/api/orders/${r.data.order.token}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.order.status, 'new');
  assert.equal((await t.json('/api/orders/1')).status, 404);
  assert.equal((await t.json(`/api/orders/${'0'.repeat(32)}`)).status, 404);
  // Ommaviy javobda mijozning telefon raqami va manzili boʻlmaydi
  assert.ok(!('phone' in ok.data.order) && !('address' in ok.data.order));
});

test('juda katta soʻrov 413, JSON boʻlmagan soʻrov 415 bilan rad etiladi', async () => {
  const big = await t.raw('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'x'.repeat(100000) }) });
  assert.equal(big.status, 413);
  const form = await t.raw('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
  assert.equal(form.status, 415);
  const broken = await t.raw('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(broken.status, 400);
  const arr = await t.raw('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' });
  assert.equal(arr.status, 400);
});

test('boshqa saytdan kelgan (Origin) buyurtma soʻrovi rad etiladi', async () => {
  const { items } = await menu();
  const r = await t.json('/api/orders', { method: 'POST', origin: 'https://yomon-sayt.example', body: orderBody([{ id: items[0].id, qty: 1 }]) });
  assert.equal(r.status, 403);
});

test('buyurtma tezligi cheklanadi (bitta IP dan)', async () => {
  const lim = await start({ ORDER_LIMIT_PER_IP: '3' });
  try {
    const { items } = (await lim.json('/api/menu')).data ? { items: (await lim.json('/api/menu')).data.items } : {};
    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await lim.json('/api/orders', { method: 'POST', body: orderBody([{ id: items[0].id, qty: 2 }]) })).status);
    }
    assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  } finally { await lim.close(); }
});

test('zal buyurtmasi stol bilan saqlanadi va yetkazish haqi olinmaydi', async () => {
  const {items}=await menu();
  const r=await place(orderBody([{id:items[0].id,qty:1}],{orderType:'dinein',tableNumber:'12',phone:'',address:''}));
  assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.order.orderType,'dinein');
  assert.equal(r.data.order.tableNumber,'12');
  assert.equal(r.data.order.deliveryFee,0);
});

test('zal buyurtmasida stol raqami majburiy', async () => {
  const {items}=await menu();
  const r=await place(orderBody([{id:items[0].id,qty:1}],{orderType:'dinein',phone:'',address:''}));
  assert.equal(r.status,422);
  assert.ok(r.data.errors.tableNumber);
});
