'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomToken } = require('./security');
const { HttpError } = require('./errors');
const { ORDER_STATUSES } = require('./validate');

const DEFAULT_SETTINGS = {
  shop_open: '1',
  delivery_fee: '10000',
  free_from: '150000',
  min_order: '30000',
  promo_on: '1',
  promo_buy: '4',
  promo_free: '1',
  phone: '',
  address: '',
  hours: '10:00 – 23:00',
};

// Boshlangʻich menyu. Narxlarni admin panelda oʻzgartirasiz.
const SEED_ITEMS = [
  ['Burgerlar', 'Klassik burger', 'Mol goʻshti kotleti, pishloq, salat, sous', 32000, '🍔', 'https://images.pexels.com/photos/13163534/pexels-photo-13163534.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Burgerlar', 'Dabl chizburger', 'Ikkita kotlet, ikki qavat pishloq', 45000, '🍔', 'https://images.pexels.com/photos/10922925/pexels-photo-10922925.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Burgerlar', 'Achchiq tovuq burger', 'Qarsildoq tovuq, halapenyo, achchiq sous', 38000, '🌶️', 'https://images.pexels.com/photos/18136129/pexels-photo-18136129.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Lavash va donar', 'Mol goʻshtli lavash', 'Goʻsht, yangi sabzavot, uy sousi', 35000, '🌯', 'https://images.pexels.com/photos/39994554/pexels-photo-39994554.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Lavash va donar', 'Tovuqli lavash', 'Tovuq filesi, karam, pomidor, sous', 32000, '🌯', 'https://images.pexels.com/photos/10837796/pexels-photo-10837796.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Lavash va donar', 'Pishloqli lavash', 'Erigan pishloq va tovuq', 38000, '🧀', 'https://images.pexels.com/photos/34216153/pexels-photo-34216153.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Kartoshka va gazaklar', 'Fri kartoshka', 'Qarsildoq, yangi qovurilgan', 15000, '🍟', 'https://images.pexels.com/photos/4109234/pexels-photo-4109234.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Kartoshka va gazaklar', 'Nagetslar (6 ta)', 'Tovuq nagetslari, sous bilan', 25000, '🍗', 'https://images.pexels.com/photos/11710530/pexels-photo-11710530.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Kartoshka va gazaklar', 'Xot-dog', 'Sosiska, piyoz, gorchitsa, ketchup', 18000, '🌭', 'https://images.pexels.com/photos/29476588/pexels-photo-29476588.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Ichimliklar', 'Kola 0,5 l', 'Sovuq', 9000, '🥤', 'https://images.pexels.com/photos/33469209/pexels-photo-33469209.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Ichimliklar', 'Limonad', 'Uyda tayyorlangan, yalpizli', 14000, '🍋', 'https://images.pexels.com/photos/5946758/pexels-photo-5946758.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
  ['Ichimliklar', 'Qora choy', 'Issiq, limon bilan', 6000, '☕', 'https://images.pexels.com/photos/14769756/pexels-photo-14769756.jpeg?auto=compress&cs=tinysrgb&w=900&h=680&fit=crop'],
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price > 0),
  emoji TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  idem TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payment TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  order_type TEXT NOT NULL DEFAULT 'delivery',
  table_number TEXT NOT NULL DEFAULT '',
  assigned_courier_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, id);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  free_qty INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines(order_id);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS couriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courier_sessions (
  token_hash TEXT PRIMARY KEY,
  courier_id INTEGER NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kitchen_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kitchen_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES kitchen_staff(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
`;

const SCOPE_WHERE = {
  active: "status IN ('new','preparing','ready','delivering')",
  done: "status = 'done'",
  cancelled: "status = 'cancelled'",
  all: '1 = 1',
};

function orderCode(id) {
  return `IS-${String(id).padStart(4, '0')}`;
}

function parseSettings(rows) {
  const m = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (Object.hasOwn(DEFAULT_SETTINGS, r.key)) m[r.key] = r.value;
  return {
    shop_open: m.shop_open === '1',
    delivery_fee: Number(m.delivery_fee),
    free_from: Number(m.free_from),
    min_order: Number(m.min_order),
    promo_on: m.promo_on === '1',
    promo_buy: Number(m.promo_buy),
    promo_free: Number(m.promo_free),
    phone: m.phone,
    address: m.address,
    hours: m.hours,
  };
}

/* Narxni faqat serverda hisoblaymiz. Mijoz yuborgan narx yoki jami hisobga olinmaydi. */
function priceOrder(request, itemsById, s) {
  const requested = request.items || request;
  const lines = [];
  let subtotal = 0;
  for (const { id, qty } of requested) {
    const item = itemsById.get(id);
    if (!item || !item.active) {
      throw new HttpError(409, 'Savatdagi taomlardan biri hozir mavjud emas. Menyuni yangilang.', { code: 'item_unavailable' });
    }
    const free = s.promo_on ? Math.floor(qty / s.promo_buy) * s.promo_free : 0;
    subtotal += item.price * qty;
    lines.push({ item, qty, free });
  }
  const deliveryFee = request.orderType === 'dinein' ? 0 : (s.free_from > 0 && subtotal >= s.free_from ? 0 : s.delivery_fee);
  return { lines, subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function openDb(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  // Mavjud SQLite maʼlumotlar bazalarini xavfsiz kengaytirish.
  const itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!itemCols.includes('image_url')) db.exec("ALTER TABLE items ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!orderCols.includes('assigned_courier_id')) db.exec('ALTER TABLE orders ADD COLUMN assigned_courier_id INTEGER');
  if (!orderCols.includes('order_type')) db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'delivery'");
  if (!orderCols.includes('table_number')) db.exec("ALTER TABLE orders ADD COLUMN table_number TEXT NOT NULL DEFAULT ''");
  if (file !== ':memory:') {
    try { fs.chmodSync(file, 0o600); } catch { /* ba'zi fayl tizimlarida ishlamaydi */ }
  }

  const insertSetting = db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  db.exec('BEGIN');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)').run(k, v);
  }
  if (db.prepare('SELECT COUNT(*) AS c FROM items').get().c === 0) {
    const ins = db.prepare(
      'INSERT INTO items(category, name, description, price, emoji, active, sort, image_url) VALUES(?,?,?,?,?,1,?,?)'
    );
    SEED_ITEMS.forEach(([cat, name, desc, price, emoji, imageUrl], i) => ins.run(cat, name, desc, price, emoji, (i + 1) * 10, imageUrl));
  }
  const seedImage = db.prepare('UPDATE items SET image_url = ? WHERE name = ? AND image_url = ?');
  for (const [, name, , , , imageUrl] of SEED_ITEMS) seedImage.run(imageUrl, name, '');
  db.exec('COMMIT');

  const q = {
    settings: db.prepare('SELECT key, value FROM settings'),
    itemsActive: db.prepare('SELECT * FROM items WHERE active = 1 ORDER BY sort, id'),
    itemsAll: db.prepare('SELECT * FROM items ORDER BY sort, id'),
    itemById: db.prepare('SELECT * FROM items WHERE id = ?'),
    itemInsert: db.prepare(
      'INSERT INTO items(category, name, description, price, emoji, active, sort, image_url) VALUES(?,?,?,?,?,?,?,?)'
    ),
    itemUpdate: db.prepare(
      'UPDATE items SET category=?, name=?, description=?, price=?, emoji=?, active=?, sort=?, image_url=? WHERE id=?'
    ),
    itemDelete: db.prepare('DELETE FROM items WHERE id = ?'),
    orderByIdem: db.prepare('SELECT * FROM orders WHERE idem = ?'),
    orderByToken: db.prepare('SELECT * FROM orders WHERE token = ?'),
    orderInsert: db.prepare(
      `INSERT INTO orders(token, idem, name, phone, address, note, payment, subtotal, delivery_fee, total, status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,'new',?,?)`
    ),
    lineInsert: db.prepare(
      'INSERT INTO order_lines(order_id, item_id, name, unit_price, qty, free_qty) VALUES(?,?,?,?,?,?)'
    ),
    linesFor: db.prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id'),
    orderStatus: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?'),
    orderTransition: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?'),
    adminGet: db.prepare('SELECT * FROM admin WHERE id = 1'),
    adminSet: db.prepare(
      `INSERT INTO admin(id, username, pass_hash, updated_at) VALUES(1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET username = excluded.username, pass_hash = excluded.pass_hash, updated_at = excluded.updated_at`
    ),
    sessionInsert: db.prepare('INSERT INTO sessions(token_hash, csrf, created_at, last_seen) VALUES(?,?,?,?)'),
    sessionGet: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    sessionTouch: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    sessionDelete: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessionsClear: db.prepare('DELETE FROM sessions'),
    sessionsPurge: db.prepare('DELETE FROM sessions WHERE created_at < ? OR last_seen < ?'),
  };

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* allaqachon bekor qilingan */ }
      throw err;
    }
  }

  const plain = (row) => (row ? { ...row } : row);

  function getSettings() {
    return parseSettings(q.settings.all());
  }

  function serializeItem(r) {
    return {
      id: r.id,
      category: r.category,
      name: r.name,
      description: r.description,
      price: r.price,
      emoji: r.emoji,
      imageUrl: r.image_url || '',
      active: r.active === 1,
      sort: r.sort,
    };
  }

  function publicOrder(row) {
    const lines = q.linesFor.all(row.id).map((l) => ({ name: l.name, qty: l.qty, free: l.free_qty }));
    return {
      code: orderCode(row.id),
      token: row.token,
      status: row.status,
      orderType: row.order_type || 'delivery',
      tableNumber: row.table_number || '',
      subtotal: row.subtotal,
      deliveryFee: row.delivery_fee,
      total: row.total,
      createdAt: row.created_at,
      lines,
    };
  }

  function adminOrder(row, lines) {
    return {
      id: row.id,
      code: orderCode(row.id),
      assignedCourierId: row.assigned_courier_id || null,
      name: row.name,
      phone: row.phone,
      address: row.address,
      note: row.note,
      payment: row.payment,
      subtotal: row.subtotal,
      deliveryFee: row.delivery_fee,
      total: row.total,
      status: row.status,
      orderType: row.order_type || 'delivery',
      tableNumber: row.table_number || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines: lines.map((l) => ({ name: l.name, unitPrice: l.unit_price, qty: l.qty, free: l.free_qty })),
    };
  }

  return {
    raw: db,
    close: () => db.close(),
    ping: () => db.prepare('SELECT 1 AS ok').get().ok === 1,

    /* ----- Sozlamalar ----- */
    getSettings,
    setSettings(patch) {
      tx(() => {
        for (const [k, v] of Object.entries(patch)) {
          if (Object.hasOwn(DEFAULT_SETTINGS, k)) insertSetting.run(k, String(v));
        }
      });
      return getSettings();
    },

    /* ----- Menyu ----- */
    listItems({ onlyActive }) {
      return (onlyActive ? q.itemsActive.all() : q.itemsAll.all()).map(serializeItem);
    },
    createItem(v) {
      const r = q.itemInsert.run(v.category, v.name, v.description, v.price, v.emoji, v.active ? 1 : 0, v.sort, v.imageUrl || '');
      return serializeItem(q.itemById.get(Number(r.lastInsertRowid)));
    },
    updateItem(id, v) {
      const r = q.itemUpdate.run(v.category, v.name, v.description, v.price, v.emoji, v.active ? 1 : 0, v.sort, v.imageUrl || '', id);
      if (!r.changes) return null;
      return serializeItem(q.itemById.get(id));
    },
    deleteItem(id) {
      return q.itemDelete.run(id).changes > 0;
    },

    /* ----- Buyurtmalar ----- */
    placeOrder(input) {
      const existing = q.orderByIdem.get(input.key);
      if (existing) return { order: publicOrder(existing), duplicate: true };

      return tx(() => {
        const s = getSettings();
        if (!s.shop_open) {
          throw new HttpError(409, 'Hozir buyurtma qabul qilinmaydi. Ish vaqtida qayta urinib koʻring.', { code: 'closed' });
        }
        const itemsById = new Map(q.itemsAll.all().map((r) => [r.id, { ...r, active: r.active === 1 }]));
        const priced = priceOrder(input, itemsById, s);
        if (priced.subtotal < s.min_order) {
          throw new HttpError(422, `Minimal buyurtma summasi ${s.min_order} soʻm.`, { code: 'min_order', min: s.min_order });
        }
        const now = Date.now();
        const token = randomToken(16);
        const r = db.prepare(`INSERT INTO orders(token, idem, name, phone, address, note, payment, subtotal, delivery_fee, total, status, order_type, table_number, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?)`).run(
          token, input.key, input.name, input.phone, input.address, input.note, input.payment,
          priced.subtotal, priced.deliveryFee, priced.total, input.orderType || 'delivery', input.tableNumber || '', now, now
        );
        const id = Number(r.lastInsertRowid);
        for (const l of priced.lines) {
          q.lineInsert.run(id, l.item.id, l.item.name, l.item.price, l.qty, l.free);
        }
        return { order: publicOrder(q.orderByToken.get(token)), duplicate: false };
      });
    },
    orderByToken(token) {
      const row = q.orderByToken.get(token);
      return row ? publicOrder(row) : null;
    },
    listOrders({ scope = 'active', limit = 100 }) {
      const where = SCOPE_WHERE[scope] || SCOPE_WHERE.active;
      const rows = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT ?`).all(limit);
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const lines = db
        .prepare(`SELECT * FROM order_lines WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
        .all(...ids);
      const byOrder = new Map();
      for (const l of lines) {
        if (!byOrder.has(l.order_id)) byOrder.set(l.order_id, []);
        byOrder.get(l.order_id).push(l);
      }
      return rows.map((r) => adminOrder(r, byOrder.get(r.id) || []));
    },
    setOrderStatus(id, status) {
      if (!ORDER_STATUSES.includes(status)) return false;
      return q.orderStatus.run(status, Date.now(), id).changes > 0;
    },
    transitionOrder(id, from, to) {
      return q.orderTransition.run(to, Date.now(), id, from).changes > 0;
    },
    serveDineIn(id) {
      return db.prepare("UPDATE orders SET status='done',updated_at=? WHERE id=? AND order_type='dinein' AND status='ready'").run(Date.now(),id).changes>0;
    },
    assignCourier(orderId, courierId) {
      const c = courierId === null ? null : db.prepare('SELECT id FROM couriers WHERE id=? AND active=1').get(courierId);
      if (courierId !== null && !c) return null;
      const r = db.prepare("UPDATE orders SET assigned_courier_id=?, updated_at=? WHERE id=? AND order_type='delivery'").run(courierId, Date.now(), orderId);
      return r.changes > 0;
    },
    listCouriers() {
      return db.prepare("SELECT c.id,c.name,c.phone,c.username,c.active,c.created_at AS createdAt,COUNT(o.id) AS activeOrders FROM couriers c LEFT JOIN orders o ON o.assigned_courier_id=c.id AND o.status IN ('new','preparing','delivering') GROUP BY c.id ORDER BY c.id DESC").all().map(r=>({...r,active:r.active===1}));
    },
    createCourier(v) {
      const r=db.prepare('INSERT INTO couriers(name,phone,username,pass_hash,active,created_at) VALUES(?,?,?,?,1,?)').run(v.name,v.phone,v.username,v.passHash,Date.now());
      return {id:Number(r.lastInsertRowid),name:v.name,phone:v.phone,username:v.username,active:true,activeOrders:0};
    },
    updateCourier(id,v) {
      const r=db.prepare('UPDATE couriers SET name=?,phone=?,active=? WHERE id=?').run(v.name,v.phone,v.active?1:0,id);
      if(!r.changes)return null;
      return db.prepare("SELECT c.id,c.name,c.phone,c.username,c.active,c.created_at AS createdAt,COUNT(o.id) AS activeOrders FROM couriers c LEFT JOIN orders o ON o.assigned_courier_id=c.id AND o.status IN ('new','preparing','delivering') WHERE c.id=? GROUP BY c.id").get(id);
    },
    deleteCourier(id) {
      return tx(()=>{db.prepare('UPDATE orders SET assigned_courier_id=NULL WHERE assigned_courier_id=?').run(id);db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').run(id);return db.prepare('DELETE FROM couriers WHERE id=?').run(id).changes>0;});
    },
    getCourierByUsername(username) { return plain(db.prepare('SELECT * FROM couriers WHERE username=?').get(username)); },
    getCourier(id) { return plain(db.prepare('SELECT * FROM couriers WHERE id=?').get(id)); },
    setCourierPassword(id,hash) { db.prepare('UPDATE couriers SET pass_hash=? WHERE id=?').run(hash,id);db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').run(id); },
    createCourierSession(hash,courierId,csrf) {const now=Date.now();db.prepare('INSERT INTO courier_sessions(token_hash,courier_id,csrf,created_at,last_seen) VALUES(?,?,?,?,?)').run(hash,courierId,csrf,now,now);},
    getCourierSession(hash) {return plain(db.prepare('SELECT * FROM courier_sessions WHERE token_hash=?').get(hash));},
    touchCourierSession(hash) {db.prepare('UPDATE courier_sessions SET last_seen=? WHERE token_hash=?').run(Date.now(),hash);},
    deleteCourierSession(hash) {db.prepare('DELETE FROM courier_sessions WHERE token_hash=?').run(hash);},
    deleteCourierSessions(id) {db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').run(id);},
    courierOrders(courierId) {
      const rows=db.prepare("SELECT * FROM orders WHERE assigned_courier_id=? AND status IN ('ready','delivering') ORDER BY id DESC LIMIT 100").all(courierId);
      if(!rows.length)return [];
      const ids=rows.map(r=>r.id);const lines=db.prepare(`SELECT * FROM order_lines WHERE order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).all(...ids);
      const byOrder=new Map();for(const line of lines){if(!byOrder.has(line.order_id))byOrder.set(line.order_id,[]);byOrder.get(line.order_id).push(line);}
      return rows.map(r=>adminOrder(r,byOrder.get(r.id)||[]));
    },
    listKitchenStaff() {
      return db.prepare("SELECT id,name,username,active,created_at AS createdAt FROM kitchen_staff ORDER BY id DESC").all().map(r=>({...r,active:r.active===1}));
    },
    createKitchenStaff(v) {
      const r=db.prepare('INSERT INTO kitchen_staff(name,username,pass_hash,active,created_at) VALUES(?,?,?,1,?)').run(v.name,v.username,v.passHash,Date.now());
      return {id:Number(r.lastInsertRowid),name:v.name,username:v.username,active:true};
    },
    updateKitchenStaff(id,v) {
      const r=db.prepare('UPDATE kitchen_staff SET name=?,active=? WHERE id=?').run(v.name,v.active?1:0,id);
      if(!r.changes)return null;
      return db.prepare('SELECT id,name,username,active,created_at AS createdAt FROM kitchen_staff WHERE id=?').get(id);
    },
    deleteKitchenStaff(id) {
      db.prepare('DELETE FROM kitchen_sessions WHERE staff_id=?').run(id);
      return db.prepare('DELETE FROM kitchen_staff WHERE id=?').run(id).changes>0;
    },
    getKitchenByUsername(username) { return plain(db.prepare('SELECT * FROM kitchen_staff WHERE username=?').get(username)); },
    getKitchenStaff(id) { return plain(db.prepare('SELECT * FROM kitchen_staff WHERE id=?').get(id)); },
    createKitchenSession(hash,staffId,csrf) { const now=Date.now();db.prepare('INSERT INTO kitchen_sessions(token_hash,staff_id,csrf,created_at,last_seen) VALUES(?,?,?,?,?)').run(hash,staffId,csrf,now,now); },
    getKitchenSession(hash) { return plain(db.prepare('SELECT * FROM kitchen_sessions WHERE token_hash=?').get(hash)); },
    touchKitchenSession(hash) { db.prepare('UPDATE kitchen_sessions SET last_seen=? WHERE token_hash=?').run(Date.now(),hash); },
    deleteKitchenSession(hash) { db.prepare('DELETE FROM kitchen_sessions WHERE token_hash=?').run(hash); },
    deleteKitchenSessions(id) { db.prepare('DELETE FROM kitchen_sessions WHERE staff_id=?').run(id); },
    kitchenOrders() {
      const rows=db.prepare("SELECT * FROM orders WHERE status IN ('new','preparing') OR (status='ready' AND order_type='dinein') ORDER BY id ASC LIMIT 150").all();
      if(!rows.length)return [];
      const ids=rows.map(r=>r.id);const lines=db.prepare(`SELECT order_id,name,qty,free_qty AS free FROM order_lines WHERE order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).all(...ids);
      const byOrder=new Map();for(const line of lines){if(!byOrder.has(line.order_id))byOrder.set(line.order_id,[]);byOrder.get(line.order_id).push({name:line.name,qty:line.qty,free:line.free});}
      return rows.map(r=>({id:r.id,code:orderCode(r.id),orderType:r.order_type||'delivery',tableNumber:r.table_number||'',note:r.note,status:r.status,createdAt:r.created_at,lines:byOrder.get(r.id)||[]}));
    },
    stats(since) {
      const t = db
        .prepare(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END), 0) AS revenue
           FROM orders WHERE created_at >= ?`
        )
        .get(since);
      const active = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE ${SCOPE_WHERE.active}`).get().c;
      return { orders: t.orders, revenue: t.revenue, active };
    },

    /* ----- Admin va sessiyalar ----- */
    getAdmin: () => plain(q.adminGet.get()),
    setAdmin(username, passHash) {
      q.adminSet.run(username, passHash, Date.now());
    },
    createSession(hash, csrf) {
      const now = Date.now();
      q.sessionInsert.run(hash, csrf, now, now);
    },
    getSession: (hash) => plain(q.sessionGet.get(hash)),
    touchSession: (hash) => q.sessionTouch.run(Date.now(), hash),
    deleteSession: (hash) => q.sessionDelete.run(hash),
    deleteAllSessions: () => q.sessionsClear.run(),
    purgeSessions(createdBefore, idleBefore) {
      q.sessionsPurge.run(createdBefore, idleBefore);
      db.prepare('DELETE FROM courier_sessions WHERE created_at < ? OR last_seen < ?').run(createdBefore,idleBefore);
      db.prepare('DELETE FROM kitchen_sessions WHERE created_at < ? OR last_seen < ?').run(createdBefore,idleBefore);
    },
  };
}

module.exports = { openDb, priceOrder, orderCode, DEFAULT_SETTINGS };
