'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sec = require('./security');
const v = require('./validate');
const { HttpError } = require('./errors');
const { openDb } = require('./db');
const { loadConfig } = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SCOPES = ['active', 'done', 'cancelled', 'all'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createApp(config) {
  const db = openDb(config.dbFile);
  const L = config.limits;
  const orderLimiter = sec.createLimiter({ max: L.orderPerIp, windowMs: L.orderWindowMs });
  const orderGlobal = sec.createLimiter({ max: L.orderGlobal, windowMs: L.orderWindowMs });
  const loginLimiter = sec.createLimiter({ max: L.loginFailsPerIp, windowMs: L.loginWindowMs });
  const apiLimiter = sec.createLimiter({ max: 300, windowMs: 60 * 1000 });

  const purgeTimer = setInterval(() => {
    const now = Date.now();
    db.purgeSessions(now - L.sessionMaxMs, now - L.sessionIdleMs);
  }, 10 * 60 * 1000);
  purgeTimer.unref();

  /* ---------- Javob yordamchilari ---------- */

  function send(res, status, body, headers = {}) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(data);
  }

  function sendError(res, err) {
    if (err instanceof HttpError) {
      const headers = {};
      const { retryAfter, ...extra } = err.extra || {};
      if (retryAfter) headers['Retry-After'] = String(retryAfter);
      if (err.status === 413) headers.Connection = 'close';
      return send(res, err.status, { error: err.message, ...extra }, headers);
    }
    console.error('[xato]', err && err.stack ? err.stack : err);
    return send(res, 500, { error: 'Serverda xatolik yuz berdi. Birozdan soʻng qayta urinib koʻring.' });
  }

  function readJson(req, limit = 32 * 1024) {
    return new Promise((resolve, reject) => {
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (!ct.startsWith('application/json')) {
        return reject(new HttpError(415, 'Soʻrov JSON koʻrinishida boʻlishi kerak.'));
      }
      let size = 0;
      let failed = false;
      const chunks = [];
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > limit) {
          failed = true;
          reject(new HttpError(413, 'Soʻrov juda katta.'));
          return;
        }
        chunks.push(c);
      });
      req.on('error', () => { if (!failed) { failed = true; reject(new HttpError(400, 'Soʻrov uzilib qoldi.')); } });
      req.on('end', () => {
        if (failed) return;
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shakl');
          resolve(parsed);
        } catch {
          reject(new HttpError(400, 'Soʻrov notoʻgʻri formatda.'));
        }
      });
    });
  }

  /* ---------- Sessiya ---------- */

  const sessionCookie = (secure) => (secure ? '__Host-ish_sid' : 'ish_sid');

  function setSessionCookie(res, secure, token, maxAgeSec) {
    const parts = [`${sessionCookie(secure)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function currentSession(req, secure) {
    const cookies = sec.parseCookies(req.headers.cookie);
    const token = cookies[sessionCookie(secure)];
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const hash = sec.sha256(token);
    const s = db.getSession(hash);
    if (!s) return null;
    const now = Date.now();
    if (now - s.created_at > L.sessionMaxMs || now - s.last_seen > L.sessionIdleMs) {
      db.deleteSession(hash);
      return null;
    }
    db.touchSession(hash);
    return { hash, csrf: s.csrf };
  }

  function requireCourier(ctx) {
    const cookies = sec.parseCookies(ctx.req.headers.cookie);
    const token = cookies['__Host-ish_courier'] || cookies.ish_courier;
    if (!token || !/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, 'Kuryer sifatida tizimga kiring.');
    const hash = sec.sha256(token); const session = db.getCourierSession(hash);
    if (!session) throw new HttpError(401, 'Kuryer sessiyasi tugagan.');
    const now = Date.now();
    if (now-session.created_at>L.sessionMaxMs || now-session.last_seen>L.sessionIdleMs) { db.deleteCourierSession(hash); throw new HttpError(401,'Kuryer sessiyasi tugagan.'); }
    const courier=db.getCourier(session.courier_id);
    if(!courier || !courier.active) { db.deleteCourierSession(hash); throw new HttpError(403,'Kuryer hisobi faol emas.'); }
    db.touchCourierSession(hash);
    if(ctx.mutating){const sent=String(ctx.req.headers['x-csrf-token']||'');if(!sent||!sec.safeEqual(sent,session.csrf))throw new HttpError(403,'Xavfsizlik kaliti mos kelmadi.');}
    ctx.courierSession={hash,csrf:session.csrf,courier};
  }
  function requireKitchen(ctx) {
    const cookies=sec.parseCookies(ctx.req.headers.cookie);
    const token=cookies['__Host-ish_kitchen']||cookies.ish_kitchen;
    if(!token||!/^[0-9a-f]{64}$/.test(token))throw new HttpError(401,'Oshxona xodimi sifatida tizimga kiring.');
    const hash=sec.sha256(token),session=db.getKitchenSession(hash);
    if(!session)throw new HttpError(401,'Oshxona sessiyasi tugagan.');
    const now=Date.now();
    if(now-session.created_at>L.sessionMaxMs||now-session.last_seen>L.sessionIdleMs){db.deleteKitchenSession(hash);throw new HttpError(401,'Oshxona sessiyasi tugagan.');}
    const staff=db.getKitchenStaff(session.staff_id);
    if(!staff||!staff.active){db.deleteKitchenSession(hash);throw new HttpError(403,'Oshxona hisobi faol emas.');}
    db.touchKitchenSession(hash);
    if(ctx.mutating){const sent=String(ctx.req.headers['x-csrf-token']||'');if(!sent||!sec.safeEqual(sent,session.csrf))throw new HttpError(403,'Xavfsizlik kaliti mos kelmadi.');}
    ctx.kitchenSession={hash,csrf:session.csrf,staff};
  }
  function requireAdmin(ctx) {
    const s = currentSession(ctx.req, ctx.secure);
    if (!s) throw new HttpError(401, 'Tizimga kiring.', { code: 'auth' });
    if (ctx.mutating) {
      const sent = String(ctx.req.headers['x-csrf-token'] || '');
      if (!sent || !sec.safeEqual(sent, s.csrf)) {
        throw new HttpError(403, 'Xavfsizlik kaliti mos kelmadi. Sahifani yangilab qayta urining.', { code: 'csrf' });
      }
    }
    ctx.session = s;
  }

  /* ---------- Marshrutlar ---------- */

  const routes = [];
  const route = (method, pattern, opts, handler) => routes.push({ method, pattern, opts, handler });

  const publicSettings = () => db.getSettings();

  route('GET', /^\/healthz$/, {}, (ctx) => {
    db.ping();
    send(ctx.res, 200, { ok: true });
  });

  route('GET', /^\/api\/menu$/, {}, (ctx) => {
    send(ctx.res, 200, { items: db.listItems({ onlyActive: true }), settings: publicSettings() });
  });

  route('POST', /^\/api\/orders$/, { body: true }, (ctx) => {
    const lim = orderLimiter.consume(ctx.ip);
    if (!lim.ok) {
      throw new HttpError(429, 'Juda koʻp buyurtma yuborildi. Birozdan soʻng qayta urinib koʻring.', { retryAfter: lim.retryAfter });
    }
    const glob = orderGlobal.consume('all');
    if (!glob.ok) {
      throw new HttpError(503, 'Hozir buyurtmalar koʻp. Birozdan soʻng qayta urinib koʻring.', { retryAfter: glob.retryAfter });
    }
    const parsed = v.orderInput(ctx.body);
    if (parsed.errors) throw new HttpError(422, 'Maʼlumotlarni tekshiring.', { errors: parsed.errors });
    const r = db.placeOrder(parsed.value);
    send(ctx.res, r.duplicate ? 200 : 201, { order: r.order });
  });

  route('GET', /^\/api\/orders\/([0-9a-f]{32})$/, {}, (ctx) => {
    const order = db.orderByToken(ctx.params[0]);
    if (!order) throw new HttpError(404, 'Buyurtma topilmadi.');
    send(ctx.res, 200, { order });
  });

  /* --- Admin --- */

  route('POST', /^\/api\/admin\/login$/, { body: true }, async (ctx) => {
    const chk = loginLimiter.check(ctx.ip);
    if (!chk.ok) {
      throw new HttpError(429, `Juda koʻp xato urinish. ${Math.ceil(chk.retryAfter / 60)} daqiqadan soʻng qayta urinib koʻring.`, { retryAfter: chk.retryAfter });
    }
    const username = typeof ctx.body.username === 'string' ? ctx.body.username.slice(0, 128) : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 128) : '';
    const admin = db.getAdmin();
    if (!admin) throw new HttpError(503, 'Admin hisobi hali yaratilmagan.');

    const userOk = sec.safeEqual(username, admin.username);
    const passOk = await sec.verifyPassword(password, admin.pass_hash);
    if (!(userOk && passOk)) {
      loginLimiter.hit(ctx.ip);
      await sleep(500);
      throw new HttpError(401, 'Login yoki parol notoʻgʻri.');
    }
    loginLimiter.reset(ctx.ip);

    // Faqat bitta faol sessiya: yangi kirish eskisini tugatadi
    db.deleteAllSessions();
    const token = sec.randomToken(32);
    const csrf = sec.randomToken(24);
    db.createSession(sec.sha256(token), csrf);
    setSessionCookie(ctx.res, ctx.secure, token, Math.floor(L.sessionMaxMs / 1000));
    send(ctx.res, 200, { ok: true, csrf });
  });

  route('POST', /^\/api\/admin\/logout$/, { admin: true }, (ctx) => {
    db.deleteSession(ctx.session.hash);
    setSessionCookie(ctx.res, ctx.secure, '', 0);
    send(ctx.res, 200, { ok: true });
  });

  route('GET', /^\/api\/admin\/session$/, { admin: true }, (ctx) => {
    send(ctx.res, 200, { ok: true, csrf: ctx.session.csrf });
  });

  route('GET', /^\/api\/admin\/couriers$/, { admin: true }, (ctx) => send(ctx.res,200,{couriers:db.listCouriers()}));
  route('POST', /^\/api\/admin\/couriers$/, { admin: true, body: true }, async (ctx) => {
    const name=typeof ctx.body.name==='string'?ctx.body.name.trim().slice(0,60):'';
    const phone=typeof ctx.body.phone==='string'?ctx.body.phone.trim().slice(0,30):'';
    const username=typeof ctx.body.username==='string'?ctx.body.username.trim().toLowerCase():'';
    const password=typeof ctx.body.password==='string'?ctx.body.password:'';
    if(name.length<2||phone.replace(/\D/g,'').length<9)throw new HttpError(422,'Kuryer ismi va telefonini toʻgʻri kiriting.');
    if(!/^[a-z0-9_-]{3,30}$/.test(username))throw new HttpError(422,'Login 3–30 belgidan iborat boʻlsin (lotin harfi, raqam, - yoki _).');
    const problem=sec.passwordProblem(password);if(problem)throw new HttpError(422,problem);
    if(db.getCourierByUsername(username))throw new HttpError(409,'Bu kuryer loginidan foydalanilgan.');
    const courier=db.createCourier({name,phone,username,passHash:await sec.hashPassword(password)});send(ctx.res,201,{courier});
  });
  route('GET', /^\/api\/admin\/kitchen-staff$/, { admin: true }, (ctx) => send(ctx.res,200,{staff:db.listKitchenStaff()}));
  route('POST', /^\/api\/admin\/kitchen-staff$/, { admin: true, body: true }, async (ctx) => {
    const name=typeof ctx.body.name==='string'?ctx.body.name.trim().slice(0,60):'';
    const username=typeof ctx.body.username==='string'?ctx.body.username.trim().toLowerCase():'';
    const password=typeof ctx.body.password==='string'?ctx.body.password:'';
    if(name.length<2)throw new HttpError(422,'Oshpaz ismini toʻgʻri kiriting.');
    if(!/^[a-z0-9_-]{3,30}$/.test(username))throw new HttpError(422,'Login 3–30 belgidan iborat boʻlsin (lotin harfi, raqam, - yoki _).');
    const problem=sec.passwordProblem(password);if(problem)throw new HttpError(422,problem);
    if(db.getKitchenByUsername(username))throw new HttpError(409,'Bu login band.');
    send(ctx.res,201,{staff:db.createKitchenStaff({name,username,passHash:await sec.hashPassword(password)})});
  });
  route('PUT', /^\/api\/admin\/kitchen-staff\/(\d{1,9})$/, { admin: true, body: true }, (ctx) => {
    const name=typeof ctx.body.name==='string'?ctx.body.name.trim().slice(0,60):'';
    if(name.length<2)throw new HttpError(422,'Oshpaz ismini toʻgʻri kiriting.');
    const staff=db.updateKitchenStaff(Number(ctx.params[0]),{name,active:ctx.body.active===true});
    if(!staff)throw new HttpError(404,'Oshpaz topilmadi.');
    if(!staff.active)db.deleteKitchenSessions(staff.id);
    send(ctx.res,200,{staff});
  });
  route('DELETE', /^\/api\/admin\/kitchen-staff\/(\d{1,9})$/, { admin: true }, (ctx) => {
    if(!db.deleteKitchenStaff(Number(ctx.params[0])))throw new HttpError(404,'Oshpaz topilmadi.');send(ctx.res,200,{ok:true});
  });
  route('PUT', /^\/api\/admin\/couriers\/(\d{1,9})$/, { admin: true, body: true }, (ctx) => {
    const name=typeof ctx.body.name==='string'?ctx.body.name.trim().slice(0,60):'';const phone=typeof ctx.body.phone==='string'?ctx.body.phone.trim().slice(0,30):'';
    if(name.length<2||phone.replace(/\D/g,'').length<9)throw new HttpError(422,'Ism va telefonni toʻgʻri kiriting.');
    const courier=db.updateCourier(Number(ctx.params[0]),{name,phone,active:ctx.body.active===true});if(!courier)throw new HttpError(404,'Kuryer topilmadi.');
    if(!courier.active)db.deleteCourierSessions(courier.id);send(ctx.res,200,{courier});
  });
  route('DELETE', /^\/api\/admin\/couriers\/(\d{1,9})$/, { admin: true }, (ctx) => {if(!db.deleteCourier(Number(ctx.params[0])))throw new HttpError(404,'Kuryer topilmadi.');send(ctx.res,200,{ok:true});});
  route('POST', /^\/api\/admin\/orders\/(\d{1,9})\/courier$/, { admin: true, body: true }, (ctx) => {
    const raw=ctx.body.courierId;const courierId=raw===null||raw===''?null:Number(raw);
    if(courierId!==null&&(!Number.isSafeInteger(courierId)||courierId<1))throw new HttpError(422,'Kuryer tanlovi notoʻgʻri.');
    const ok=db.assignCourier(Number(ctx.params[0]),courierId);if(ok===null)throw new HttpError(422,'Faol kuryerni tanlang.');if(!ok)throw new HttpError(404,'Buyurtma topilmadi.');send(ctx.res,200,{ok:true});
  });
  route('POST', /^\/api\/courier\/login$/, { body: true }, async (ctx) => {
    const chk=loginLimiter.check(ctx.ip);
    if(!chk.ok)throw new HttpError(429,'Juda koʻp xato urinish. Keyinroq qayta urinib koʻring.',{retryAfter:chk.retryAfter});
    const username=typeof ctx.body.username==='string'?ctx.body.username.trim().toLowerCase().slice(0,30):'';const password=typeof ctx.body.password==='string'?ctx.body.password.slice(0,128):'';
    const courier=db.getCourierByUsername(username);const passOk=await sec.verifyPassword(password,courier?courier.pass_hash:'');
    if(!courier||!courier.active||!passOk){loginLimiter.hit(ctx.ip);await sleep(500);throw new HttpError(401,'Login yoki parol notoʻgʻri.');}
    loginLimiter.reset(ctx.ip);
    db.deleteCourierSessions(courier.id);const token=sec.randomToken(32),csrf=sec.randomToken(24);db.createCourierSession(sec.sha256(token),courier.id,csrf);
    const cookieName=ctx.secure?'__Host-ish_courier':'ish_courier';const parts=[cookieName+'='+token,'Path=/','HttpOnly','SameSite=Strict','Max-Age='+Math.floor(L.sessionMaxMs/1000)];if(ctx.secure)parts.push('Secure');ctx.res.setHeader('Set-Cookie',parts.join('; '));send(ctx.res,200,{ok:true,csrf});
  });
  route('GET', /^\/api\/courier\/session$/, { courier: true }, (ctx) => send(ctx.res,200,{ok:true,csrf:ctx.courierSession.csrf,courier:{name:ctx.courierSession.courier.name}}));
  route('GET', /^\/api\/courier\/orders$/, { courier: true }, (ctx) => send(ctx.res,200,{orders:db.courierOrders(ctx.courierSession.courier.id)}));
  route('POST', /^\/api\/courier\/orders\/(\d{1,9})\/status$/, { courier: true, body: true }, (ctx) => {
    const id=Number(ctx.params[0]),status=ctx.body.status;const owns=db.courierOrders(ctx.courierSession.courier.id).some(o=>o.id===id);if(!owns)throw new HttpError(403,'Bu buyurtma sizga biriktirilmagan.');
    const from=status==='delivering'?'ready':status==='done'?'delivering':null;
    if(!from)throw new HttpError(422,'Holat notoʻgʻri.');if(!db.transitionOrder(id,from,status))throw new HttpError(409,'Buyurtma holati yangilangan. Roʻyxatni yangilang.');send(ctx.res,200,{ok:true});
  });
  route('POST', /^\/api\/courier\/logout$/, { courier: true }, (ctx) => {const name=ctx.secure?'__Host-ish_courier':'ish_courier';db.deleteCourierSession(ctx.courierSession.hash);ctx.res.setHeader('Set-Cookie',name+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(ctx.secure?'; Secure':''));send(ctx.res,200,{ok:true});});
  route('GET', /^\/api\/admin\/orders$/, { admin: true }, (ctx) => {
    const scope = SCOPES.includes(ctx.url.searchParams.get('scope')) ? ctx.url.searchParams.get('scope') : 'active';
    send(ctx.res, 200, { orders: db.listOrders({ scope, limit: 150 }) });
  });

  route('POST', /^\/api\/kitchen\/login$/, { body: true }, async (ctx) => {
    const chk=loginLimiter.check(ctx.ip);if(!chk.ok)throw new HttpError(429,'Juda koʻp xato urinish. Keyinroq qayta urinib koʻring.',{retryAfter:chk.retryAfter});
    const username=typeof ctx.body.username==='string'?ctx.body.username.trim().toLowerCase().slice(0,30):'';
    const password=typeof ctx.body.password==='string'?ctx.body.password.slice(0,128):'';
    const staff=db.getKitchenByUsername(username);const passOk=await sec.verifyPassword(password,staff?staff.pass_hash:'');
    if(!staff||!staff.active||!passOk){loginLimiter.hit(ctx.ip);await sleep(500);throw new HttpError(401,'Login yoki parol notoʻgʻri.');}
    loginLimiter.reset(ctx.ip);db.deleteKitchenSessions(staff.id);
    const token=sec.randomToken(32),csrf=sec.randomToken(24);db.createKitchenSession(sec.sha256(token),staff.id,csrf);
    const cookieName=ctx.secure?'__Host-ish_kitchen':'ish_kitchen';const parts=[cookieName+'='+token,'Path=/','HttpOnly','SameSite=Strict','Max-Age='+Math.floor(L.sessionMaxMs/1000)];if(ctx.secure)parts.push('Secure');ctx.res.setHeader('Set-Cookie',parts.join('; '));send(ctx.res,200,{ok:true,csrf});
  });
  route('GET', /^\/api\/kitchen\/session$/, { kitchen: true }, (ctx) => send(ctx.res,200,{ok:true,csrf:ctx.kitchenSession.csrf,staff:{name:ctx.kitchenSession.staff.name}}));
  route('GET', /^\/api\/kitchen\/orders$/, { kitchen: true }, (ctx) => send(ctx.res,200,{orders:db.kitchenOrders()}));
  route('POST', /^\/api\/kitchen\/orders\/(\d{1,9})\/status$/, { kitchen: true, body: true }, (ctx) => {
    const status=ctx.body.status,id=Number(ctx.params[0]);const from=status==='preparing'?'new':status==='ready'?'preparing':null;
    if(status==='done'){if(!db.serveDineIn(id))throw new HttpError(409,'Zal buyurtmasi xizmatga tayyor emas yoki allaqachon yakunlangan.');send(ctx.res,200,{ok:true});return;}
    if(!from)throw new HttpError(422,'Holat notoʻgʻri.');if(!db.transitionOrder(id,from,status))throw new HttpError(409,'Buyurtma holati yangilangan. Roʻyxatni yangilang.');send(ctx.res,200,{ok:true});
  });
  route('POST', /^\/api\/kitchen\/logout$/, { kitchen: true }, (ctx) => {const name=ctx.secure?'__Host-ish_kitchen':'ish_kitchen';db.deleteKitchenSession(ctx.kitchenSession.hash);ctx.res.setHeader('Set-Cookie',name+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(ctx.secure?'; Secure':''));send(ctx.res,200,{ok:true});});

  route('GET', /^\/api\/admin\/stats$/, { admin: true }, (ctx) => {
    const offset = 5 * 3600 * 1000; // Toshkent vaqti (UTC+5)
    const since = Math.floor((Date.now() + offset) / 86400000) * 86400000 - offset;
    send(ctx.res, 200, { today: db.stats(since) });
  });

  route('GET', /^\/api\/admin\/items$/, { admin: true }, (ctx) => {
    send(ctx.res, 200, { items: db.listItems({ onlyActive: false }) });
  });

  route('POST', /^\/api\/admin\/items$/, { admin: true, body: true }, (ctx) => {
    const parsed = v.itemInput(ctx.body);
    if (parsed.errors) throw new HttpError(422, 'Maʼlumotlarni tekshiring.', { errors: parsed.errors });
    send(ctx.res, 201, { item: db.createItem(parsed.value) });
  });

  route('PUT', /^\/api\/admin\/items\/(\d{1,9})$/, { admin: true, body: true }, (ctx) => {
    const parsed = v.itemInput(ctx.body);
    if (parsed.errors) throw new HttpError(422, 'Maʼlumotlarni tekshiring.', { errors: parsed.errors });
    const item = db.updateItem(Number(ctx.params[0]), parsed.value);
    if (!item) throw new HttpError(404, 'Taom topilmadi.');
    send(ctx.res, 200, { item });
  });

  route('DELETE', /^\/api\/admin\/items\/(\d{1,9})$/, { admin: true }, (ctx) => {
    if (!db.deleteItem(Number(ctx.params[0]))) throw new HttpError(404, 'Taom topilmadi.');
    send(ctx.res, 200, { ok: true });
  });

  route('GET', /^\/api\/admin\/settings$/, { admin: true }, (ctx) => {
    send(ctx.res, 200, { settings: db.getSettings() });
  });

  route('PUT', /^\/api\/admin\/settings$/, { admin: true, body: true }, (ctx) => {
    const parsed = v.settingsInput(ctx.body);
    if (parsed.errors) throw new HttpError(422, 'Maʼlumotlarni tekshiring.', { errors: parsed.errors });
    send(ctx.res, 200, { settings: db.setSettings(parsed.value) });
  });

  route('POST', /^\/api\/admin\/password$/, { admin: true, body: true }, async (ctx) => {
    const chk = loginLimiter.check(ctx.ip);
    if (!chk.ok) throw new HttpError(429, 'Juda koʻp urinish. Keyinroq qayta urinib koʻring.', { retryAfter: chk.retryAfter });
    const current = typeof ctx.body.current === 'string' ? ctx.body.current.slice(0, 128) : '';
    const next = ctx.body.next;
    const admin = db.getAdmin();
    if (!(await sec.verifyPassword(current, admin.pass_hash))) {
      loginLimiter.hit(ctx.ip);
      await sleep(500);
      throw new HttpError(403, 'Joriy parol notoʻgʻri.');
    }
    const problem = sec.passwordProblem(next);
    if (problem) throw new HttpError(422, problem);
    if (next === current) throw new HttpError(422, 'Yangi parol joriy paroldan farq qilsin.');
    db.setAdmin(admin.username, await sec.hashPassword(next));
    db.deleteAllSessions();
    setSessionCookie(ctx.res, ctx.secure, '', 0);
    send(ctx.res, 200, { ok: true });
  });

  /* ---------- Statik fayllar ---------- */

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Topilmadi');
  }

  function serveFile(req, res, file, { noStore = false, extra = {} } = {}) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': noStore ? 'no-store' : 'public, max-age=300',
        ...extra,
      });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  }

  function staticPath(pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    const segs = decoded.split('/').filter(Boolean);
    if (segs.some((s) => s.startsWith('.') || s === '..')) return null;
    if (segs[0] === 'admin') return null; // admin fayllari faqat yashirin yoʻldan beriladi
    const rel = segs.length ? segs.join('/') : 'index.html';
    const full = path.join(config.publicDir, rel);
    if (full !== config.publicDir && !full.startsWith(config.publicDir + path.sep)) return null;
    return full;
  }

  /* ---------- Asosiy ishlovchi ---------- */

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (origin) {
      try { return new URL(origin).host === req.headers.host; } catch { return false; }
    }
    const site = req.headers['sec-fetch-site'];
    return !site || site === 'same-origin' || site === 'none';
  }

  async function handle(req, res) {
    const secure = sec.isSecureRequest(req, config);
    sec.applySecurityHeaders(res, { secure, production: config.production });

    const rawUrl = req.url || '/';
    if (rawUrl.length > 2048) return send(res, 414, { error: 'Manzil juda uzun.' });
    if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) return send(res, 400, { error: 'Soʻrov notoʻgʻri.' });
    let url;
    try { url = new URL(rawUrl, 'http://localhost'); } catch { return send(res, 400, { error: 'Soʻrov notoʻgʻri.' }); }
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const method = req.method;
    const ip = sec.clientIp(req, config);

    if (pathname === '/robots.txt') {
      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'Usul ruxsat etilmagan.' }, { Allow: 'GET, HEAD' });
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /courier',
        'Disallow: /kitchen',
        'Sitemap: https://ishtaxa.onrender.com/sitemap.xml',
        '',
      ] .join(String.fromCharCode(10));
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(robots),
      });
      return method === 'HEAD' ? res.end() : res.end(robots);
    }

    if (pathname === '/courier' || pathname === '/courier.html') {
      if (method !== 'GET' && method !== 'HEAD') return send(res,405,{error:'Usul ruxsat etilmagan.'});
      return serveFile(req,res,path.join(config.publicDir,'courier.html'),{noStore:true,extra:{'X-Robots-Tag':'noindex, nofollow'}});
    }
    if (pathname === '/kitchen' || pathname === '/kitchen.html') {
      if (method !== 'GET' && method !== 'HEAD') return send(res,405,{error:'Usul ruxsat etilmagan.'});
      return serveFile(req,res,path.join(config.publicDir,'kitchen.html'),{noStore:true,extra:{'X-Robots-Tag':'noindex, nofollow'}});
    }

    // Yashirin admin sahifasi
    if (pathname === config.adminPath || pathname.startsWith(config.adminPath + '/')) {
      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'Usul ruxsat etilmagan.' }, { Allow: 'GET, HEAD' });
      const sub = pathname.slice(config.adminPath.length);
      const files = { '': 'index.html', '/admin.js': 'admin.js' };
      if (!Object.hasOwn(files, sub)) return notFound(res);
      return serveFile(req, res, path.join(config.publicDir, 'admin', files[sub]), {
        noStore: true,
        extra: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
      });
    }

    if (pathname.startsWith('/api/') || pathname === '/healthz') {
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      let matchedPath = false;
      for (const r of routes) {
        const m = r.pattern.exec(pathname);
        if (!m) continue;
        matchedPath = true;
        if (r.method !== method) continue;

        const lim = apiLimiter.consume(ip);
        if (!lim.ok) throw new HttpError(429, 'Juda koʻp soʻrov. Birozdan soʻng qayta urinib koʻring.', { retryAfter: lim.retryAfter });
        if (mutating && !sameOrigin(req)) throw new HttpError(403, 'Soʻrov manbasi ruxsat etilmagan.');

        const ctx = { req, res, url, ip, secure, mutating, params: m.slice(1), body: null, session: null };
        if (r.opts.admin) requireAdmin(ctx);
        if (r.opts.courier) requireCourier(ctx);
        if (r.opts.kitchen) requireKitchen(ctx);
        if (r.opts.body) ctx.body = await readJson(req, pathname.startsWith('/api/admin/items') ? 400 * 1024 : 32 * 1024);
        return r.handler(ctx);
      }
      if (matchedPath) {
        return send(res, 405, { error: 'Usul ruxsat etilmagan.' });
      }
      return send(res, 404, { error: 'Topilmadi.' });
    }

    if (method !== 'GET' && method !== 'HEAD') {
      return send(res, 405, { error: 'Usul ruxsat etilmagan.' }, { Allow: 'GET, HEAD' });
    }
    if (pathname === '/sitemap.xml') {
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://ishtaxa.onrender.com/</loc></url></urlset>\n';
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': Buffer.byteLength(xml),
      });
      return method === 'HEAD' ? res.end() : res.end(xml);
    }
    const file = staticPath(pathname);
    if (!file) return notFound(res);
    return serveFile(req, res, file);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy();
      sendError(res, err);
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  /* Admin hisobini birinchi ishga tushirishda yaratadi */
  async function init() {
    if (db.getAdmin()) return { created: false };
    let password = config.adminPassword;
    let generated = false;
    if (password) {
      const problem = sec.passwordProblem(password);
      if (problem) throw new Error(`ADMIN_PASSWORD yaroqsiz: ${problem}`);
    } else {
      password = sec.generatePassword(20);
      generated = true;
    }
    db.setAdmin(config.adminUser, await sec.hashPassword(password));
    return { created: true, username: config.adminUser, password: generated ? password : null };
  }

  function close() {
    return new Promise((resolve) => {
      server.close(() => {
        try { db.close(); } catch { /* yopilgan */ }
        resolve();
      });
      server.closeIdleConnections?.();
      setTimeout(() => server.closeAllConnections?.(), 3000).unref();
    });
  }

  return { server, db, config, init, close };
}

async function main() {
  const config = loadConfig();
  const app = createApp(config);
  const info = await app.init();
  if (info.created) {
    console.log('\n==================== ADMIN HISOBI YARATILDI ====================');
    console.log(`  Login : ${info.username}`);
    if (info.password) {
      console.log(`  Parol : ${info.password}`);
      console.log('  Bu parol faqat BIR MARTA koʻrsatiladi. Hozir saqlab oling,');
      console.log('  keyin admin paneldan oʻzgartiring.');
    } else {
      console.log('  Parol : ADMIN_PASSWORD orqali berilgan');
    }
    console.log('================================================================\n');
  }
  if (config.production) {
    if (config.adminPath === '/admin') {
      console.warn('OGOHLANTIRISH: ADMIN_PATH oʻzgartirilmagan. Admin sahifasi oson topiladi — yashirin manzil tanlang.');
    }
    if (!config.trustProxy) {
      console.warn('ESLATMA: sayt HTTPS proksi ortida boʻlsa TRUST_PROXY=1 qoʻying, aks holda cookie "Secure" boʻlmaydi.');
    }
  }
  app.server.listen(config.port, config.host, () => {
    const { port } = app.server.address();
    console.log(`Ishtaxa ishga tushdi: http://${config.host}:${port}`);
    console.log('Admin paneli belgilangan maxfiy yoʻlda ishlaydi.');
  });
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { createApp };
