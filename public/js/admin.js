(() => {
  'use strict';

  /* ---------- Yordamchilar ---------- */

  const app = document.getElementById('app');

  // Barcha maʼlumot textContent orqali qoʻyiladi (HTML sifatida hech qachon talqin qilinmaydi).
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} soʻm`;
  const fmtTime = (ts) =>
    new Date(ts).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const STATUS = { new: 'Yangi', preparing: 'Tayyorlanmoqda', delivering: 'Yoʻlda', done: 'Yetkazildi', cancelled: 'Bekor qilindi' };
  const NEXT = {
    new: { to: 'preparing', label: 'Tayyorlashni boshlash' },
    preparing: { to: 'delivering', label: 'Yoʻlga chiqdi' },
    delivering: { to: 'done', label: 'Yetkazildi' },
  };

  const S = { csrf: null, tab: 'orders', scope: 'active', timer: null, items: [], couriers: [], timerBusy: false };

  class ApiError extends Error {
    constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && S.csrf) headers['X-CSRF-Token'] = S.csrf;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    } catch {
      throw new ApiError(0, 'Internet bilan aloqa yoʻq.');
    }
    let data = {};
    try { data = await res.json(); } catch { /* boʻsh */ }
    if (res.status === 401 && path !== '/api/admin/login') {
      S.csrf = null;
      showLogin('Sessiya tugadi. Qayta kiring.');
      throw new ApiError(401, data.error || 'Tizimga kiring.');
    }
    if (!res.ok) throw new ApiError(res.status, data.error || 'Xatolik yuz berdi.', data.errors);
    return data;
  }

  function stopTimer() { clearInterval(S.timer); S.timer = null; }

  /* ---------- Kirish ---------- */

  function showLogin(message) {
    stopTimer();
    const err = h('div', { class: 'alert', role: 'alert', hidden: !message }, message || '');
    const user = h('input', { id: 'l-user', type: 'text', autocomplete: 'username', required: true, maxlength: 128 });
    const pass = h('input', { id: 'l-pass', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    const btn = h('button', { class: 'btn btn-sun', type: 'submit' }, 'Kirish');
    const form = h('form', { class: 'login-box', novalidate: true },
      h('h1', null, 'Ishtaxa'),
      h('p', { class: 'muted' }, 'Boshqaruv paneli. Faqat egasi uchun.'),
      h('div', { class: 'field' }, h('label', { for: 'l-user' }, 'Login'), user),
      h('div', { class: 'field' }, h('label', { for: 'l-pass' }, 'Parol'), pass),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Tekshirilmoqda…';
      try {
        const r = await api('/api/admin/login', { method: 'POST', body: { username: user.value, password: pass.value } });
        S.csrf = r.csrf;
        pass.value = '';
        showApp();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Kirish';
        pass.value = '';
        pass.focus();
      }
    });
    app.replaceChildren(h('main', { class: 'login' }, form));
    user.focus();
  }

  /* ---------- Asosiy ramka ---------- */

  const TABS = [['orders', 'Buyurtmalar'], ['menu', 'Menyu'], ['couriers', 'Kuryerlar'], ['settings', 'Aksiya va sozlamalar'], ['password', 'Parol']];

  function showApp() {
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Boʻlimlar' });
    for (const [id, label] of TABS) {
      tabs.append(h('button', {
        type: 'button', role: 'tab', 'aria-selected': S.tab === id ? 'true' : 'false',
        onclick: () => { S.tab = id; showApp(); },
      }, label));
    }
    const content = h('div', { id: 'content' });
    app.replaceChildren(
      h('header', { class: 'top' },
        h('span', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Ishtaxa'),
        h('button', { class: 'btn-line', type: 'button', onclick: logout }, 'Chiqish')),
      h('div', { class: 'admin-wrap' }, tabs, content)
    );
    stopTimer();
    ({ orders: viewOrders, menu: viewMenu, couriers: viewCouriers, settings: viewSettings, password: viewPassword })[S.tab](content);
  }

  async function logout() {
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch { /* baribir chiqiladi */ }
    S.csrf = null;
    showLogin();
  }

  /* ---------- Buyurtmalar ---------- */

  async function viewOrders(root) {
    const stats = h('div', { class: 'stats' });
    const chips = h('div', { class: 'chips' });
    const list = h('div', { 'aria-live': 'polite' });
    root.replaceChildren(stats, chips, list);

    for (const [id, label] of [['active', 'Faol'], ['done', 'Yetkazilgan'], ['cancelled', 'Bekor qilingan'], ['all', 'Hammasi']]) {
      chips.append(h('button', { type: 'button', 'aria-pressed': S.scope === id ? 'true' : 'false', onclick: () => { S.scope = id; viewOrders(root); } }, label));
    }

    async function refresh() {
      if (S.timerBusy) return;
      S.timerBusy = true;
      try {
        const [o, st, cr] = await Promise.all([api(`/api/admin/orders?scope=${S.scope}`), api('/api/admin/stats'), api('/api/admin/couriers')]); S.couriers = cr.couriers;
        stats.replaceChildren(
          h('div', { class: 'stat' }, h('b', null, String(st.today.orders)), h('span', null, 'Bugungi buyurtmalar')),
          h('div', { class: 'stat' }, h('b', null, money(st.today.revenue)), h('span', null, 'Bugungi tushum')),
          h('div', { class: 'stat' }, h('b', null, String(st.today.active)), h('span', null, 'Faol buyurtmalar')));
        document.title = st.today.active ? `(${st.today.active}) Ishtaxa — boshqaruv` : 'Ishtaxa — boshqaruv';
        list.replaceChildren(...(o.orders.length ? o.orders.map((x) => orderCard(x, refresh)) : [h('p', { class: 'empty' }, 'Bu boʻlimda buyurtma yoʻq.')]));
      } catch (e) {
        if (e.status !== 401) list.replaceChildren(h('p', { class: 'alert' }, e.message));
      } finally {
        S.timerBusy = false;
      }
    }
    await refresh();
    S.timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  }

  function orderCard(o, refresh) {
    const lines = h('div', { class: 'items' });
    for (const l of o.lines) {
      lines.append(h('div', null, h('span', null, `${l.name} × ${l.qty}`), h('span', null, money(l.unitPrice * l.qty))));
      if (l.free) lines.append(h('div', { class: 'gift' }, h('span', null, `🎁 ${l.name} × ${l.free} (sovgʻa)`), h('span', null, 'bepul')));
    }
    lines.append(h('div', null, h('span', null, 'Yetkazish'), h('span', null, o.deliveryFee ? money(o.deliveryFee) : 'Bepul')));
    lines.append(h('div', null, h('b', null, 'Jami'), h('b', null, money(o.total))));

    const act = h('div', { class: 'actions' });
    const move = async (status) => {
      try { await api(`/api/admin/orders/${o.id}/status`, { method: 'POST', body: { status } }); await refresh(); }
      catch (e) { if (e.status !== 401) alert(e.message); }
    };
    if (NEXT[o.status]) act.append(h('button', { class: 'btn btn-sun btn-auto', type: 'button', onclick: () => move(NEXT[o.status].to) }, NEXT[o.status].label));
    if (o.status === 'new' || o.status === 'preparing' || o.status === 'delivering') {
      act.append(h('button', { class: 'btn-line btn-danger', type: 'button', onclick: () => { if (confirm(`${o.code} buyurtmani bekor qilasizmi?`)) move('cancelled'); } }, 'Bekor qilish'));
    }
    if (o.status === 'done' || o.status === 'cancelled') {
      act.append(h('button', { class: 'btn-line', type: 'button', onclick: () => { if (confirm('Buyurtmani qayta faollashtirasizmi?')) move('new'); } }, 'Qayta ochish'));
    }

    const phoneLink = /^\+998\d{9}$/.test(o.phone) ? h('a', { href: `tel:${o.phone}` }, o.phone) : o.phone;
    return h('article', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', null, o.code),
        h('span', { class: `status is-${o.status}` }, STATUS[o.status] || o.status),
        h('span', { class: 'muted' }, fmtTime(o.createdAt))),
      h('dl', null,
        h('dt', null, 'Mijoz'), h('dd', null, o.name),
        h('dt', null, 'Telefon'), h('dd', null, phoneLink),
        h('dt', null, 'Manzil'), h('dd', null, o.address),
        o.note ? h('dt', null, 'Izoh') : null, o.note ? h('dd', null, o.note) : null,
        h('dt', null, 'Toʻlov'), h('dd', null, o.payment === 'card' ? 'Karta (kuryerga)' : 'Naqd (kuryerga)')),
      lines, act);
  }

  async function viewCouriers(root) {
    const list=h('div'); const add=h('button',{class:'btn btn-sun btn-auto',type:'button',onclick:()=>courierDialog(null,load)},'＋ Yangi kuryer qoʻshish');
    root.replaceChildren(h('div',{class:'section-title'},'Kuryerlar nazorati'),h('p',{class:'muted'},'Har bir kuryerga alohida login va parol yarating. Buyurtmani unga buyurtmalar boʻlimidan biriktiring.'),h('div',{class:'actions'},add),list);
    async function load(){try{const r=await api('/api/admin/couriers');list.replaceChildren(...(r.couriers.length?r.couriers.map(c=>h('article',{class:'card'},h('div',{class:'card-head'},h('h3',null,c.name),h('span',{class:'status '+(c.active?'is-done':'is-cancelled')},c.active?'Faol':'Oʻchirilgan')),h('p',null,c.phone+' · login: '+c.username),h('p',{class:'muted'},'Faol buyurtmalar: '+c.activeOrders),h('div',{class:'actions'},h('button',{class:'btn-line',type:'button',onclick:()=>courierDialog(c,load)},'Tahrirlash'),h('button',{class:'btn-line btn-danger',type:'button',onclick:async()=>{if(!confirm(c.name+' kuryerini oʻchirasizmi?'))return;try{await api('/api/admin/couriers/'+c.id,{method:'DELETE'});await load();}catch(e){alert(e.message);}}},'Oʻchirish')))): [h('p',{class:'empty'},'Hali kuryer qoʻshilmagan.')]))}catch(e){list.replaceChildren(h('p',{class:'alert'},e.message));}}
    await load();
  }
  function courierDialog(c,done){
    const dlg=h('dialog',{class:'modal','aria-labelledby':'courier-title'});
    const f={name:h('input',{id:'c-name',required:true,maxlength:60,value:c?c.name:''}),phone:h('input',{id:'c-phone',required:true,maxlength:30,value:c?c.phone:'+998'}),username:h('input',{id:'c-user',required:true,maxlength:30,value:c?c.username:'',disabled:!!c}),password:h('input',{id:'c-pass',type:'password',required:!c,autocomplete:'new-password',maxlength:128})};
    const msg=h('div',{class:'alert',hidden:true}); const field=(id,label,input)=>h('div',{class:'field'},h('label',{for:id},label),input);
    const form=h('form',{class:'form'},h('h2',{id:'courier-title'},c?'Kuryerni tahrirlash':'Yangi kuryer'),field('c-name','Ism',f.name),field('c-phone','Telefon',f.phone),field('c-user','Login',f.username),c?null:field('c-pass','Parol (harf va raqam, 10+ belgi)',f.password),msg,h('div',{class:'actions'},h('button',{class:'btn btn-sun btn-auto',type:'submit'},'Saqlash'),h('button',{class:'btn-line',type:'button',onclick:()=>dlg.close()},'Bekor qilish')));
    form.addEventListener('submit',async e=>{e.preventDefault();msg.hidden=true;try{if(c){await api('/api/admin/couriers/'+c.id,{method:'PUT',body:{name:f.name.value,phone:f.phone.value,active:c.active}});}else{await api('/api/admin/couriers',{method:'POST',body:{name:f.name.value,phone:f.phone.value,username:f.username.value,password:f.password.value}});}dlg.close();await done();}catch(ex){msg.textContent=ex.message;msg.hidden=false;}});
    dlg.append(form);dlg.addEventListener('close',()=>dlg.remove());document.body.append(dlg);dlg.showModal();
  }
  /* ---------- Menyu ---------- */

  async function viewMenu(root) {
    const list = h('div');
    const add = h('button', { class: 'btn btn-sun btn-auto', type: 'button', onclick: () => itemDialog(null, load) }, 'Yangi taom qoʻshish');
    root.replaceChildren(h('div', { class: 'actions' }, add), list);

    async function load() {
      try {
        const { items } = await api('/api/admin/items');
        S.items = items;
        list.replaceChildren(...(items.length ? items.map(menuRow) : [h('p', { class: 'empty' }, 'Menyu boʻsh. Birinchi taomni qoʻshing.')]));
      } catch (e) { if (e.status !== 401) list.replaceChildren(h('p', { class: 'alert' }, e.message)); }
    }

    function menuRow(it) {
      const toggle = async () => {
        try { await api(`/api/admin/items/${it.id}`, { method: 'PUT', body: { ...it, active: !it.active } }); await load(); }
        catch (e) { if (e.status !== 401) alert(e.message); }
      };
      const del = async () => {
        if (!confirm(`"${it.name}" taomini oʻchirasizmi? Oldingi buyurtmalar saqlanib qoladi.`)) return;
        try { await api(`/api/admin/items/${it.id}`, { method: 'DELETE' }); await load(); }
        catch (e) { if (e.status !== 401) alert(e.message); }
      };
      return h('div', { class: `menu-row${it.active ? '' : ' off'}` },
        h('div', { class: 'emoji', 'aria-hidden': 'true' }, it.emoji || '🍽️'),
        h('div', null, h('b', null, it.name), h('div', { class: 'meta' }, `${it.category} · ${money(it.price)}${it.active ? '' : ' · yashirin'}`)),
        h('div', { class: 'acts' },
          h('button', { class: 'btn-line', type: 'button', onclick: () => itemDialog(it, load) }, 'Tahrirlash'),
          h('button', { class: 'btn-line', type: 'button', onclick: toggle }, it.active ? 'Yashirish' : 'Koʻrsatish'),
          h('button', { class: 'btn-line btn-danger', type: 'button', onclick: del }, 'Oʻchirish')));
    }
    await load();
  }

  function itemDialog(item, done) {
    const cats = [...new Set(S.items.map((i) => i.category))];
    const f = {
      name: h('input', { id: 'i-name', maxlength: 60, required: true, value: item ? item.name : '' }),
      category: h('input', { id: 'i-cat', maxlength: 30, required: true, list: 'i-cats', value: item ? item.category : (cats[0] || '') }),
      description: h('input', { id: 'i-desc', maxlength: 140, value: item ? item.description : '' }),
      price: h('input', { id: 'i-price', type: 'number', min: 1000, max: 2000000, step: 500, inputmode: 'numeric', required: true, value: item ? item.price : '' }),
      emoji: h('input', { id: 'i-emoji', maxlength: 8, value: item ? item.emoji : '' }),
      sort: h('input', { id: 'i-sort', type: 'number', min: 0, max: 9999, value: item ? item.sort : (S.items.length + 1) * 10 }),
      active: h('input', { id: 'i-active', type: 'checkbox', checked: item ? item.active : true }),
    };
    const err = h('div', { class: 'alert', role: 'alert', hidden: true });
    const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'i-title' });
    const field = (id, label, el) => h('div', { class: 'field' }, h('label', { for: id }, label), el);
    const form = h('form', { class: 'form', novalidate: true },
      h('h2', { id: 'i-title' }, item ? 'Taomni tahrirlash' : 'Yangi taom'),
      field('i-name', 'Nomi', f.name),
      h('div', { class: 'grid2' }, field('i-cat', 'Boʻlim', f.category), field('i-price', 'Narxi (soʻm)', f.price)),
      h('datalist', { id: 'i-cats' }, cats.map((c) => h('option', { value: c }))),
      field('i-desc', 'Qisqa tavsif', f.description),
      h('div', { class: 'grid2' }, field('i-emoji', 'Belgi (emoji)', f.emoji), field('i-sort', 'Tartib raqami', f.sort)),
      h('label', { class: 'check' }, f.active, 'Menyuda koʻrsatilsin'),
      err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-sun btn-auto', type: 'submit' }, 'Saqlash'),
        h('button', { class: 'btn-line', type: 'button', onclick: () => dlg.close() }, 'Bekor qilish')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const body = {
        name: f.name.value, category: f.category.value, description: f.description.value,
        price: Number(f.price.value), emoji: f.emoji.value, sort: Number(f.sort.value || 0), active: f.active.checked,
      };
      try {
        await api(item ? `/api/admin/items/${item.id}` : '/api/admin/items', { method: item ? 'PUT' : 'POST', body });
        dlg.close();
        await done();
      } catch (ex) {
        err.textContent = ex.errors ? Object.values(ex.errors).join(' ') : ex.message;
        err.hidden = false;
      }
    });
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    f.name.focus();
  }

  /* ---------- Sozlamalar ---------- */

  async function viewSettings(root) {
    let s;
    try { s = (await api('/api/admin/settings')).settings; }
    catch (e) { if (e.status !== 401) root.replaceChildren(h('p', { class: 'alert' }, e.message)); return; }

    const num = (id, v, min, max) => h('input', { id, type: 'number', inputmode: 'numeric', min, max, step: 1, required: true, value: v });
    const txt = (id, v, max) => h('input', { id, type: 'text', maxlength: max, value: v });
    const f = {
      promo_on: h('input', { id: 's-promo', type: 'checkbox', checked: s.promo_on }),
      promo_buy: num('s-buy', s.promo_buy, 2, 20),
      promo_free: num('s-free', s.promo_free, 1, 5),
      shop_open: h('input', { id: 's-open', type: 'checkbox', checked: s.shop_open }),
      delivery_fee: num('s-fee', s.delivery_fee, 0, 200000),
      free_from: num('s-from', s.free_from, 0, 5000000),
      min_order: num('s-min', s.min_order, 0, 1000000),
      phone: txt('s-phone', s.phone, 30),
      address: txt('s-addr', s.address, 120),
      hours: txt('s-hours', s.hours, 60),
    };
    const field = (id, label, el) => h('div', { class: 'field' }, h('label', { for: id }, label), el);
    const msg = h('div', { role: 'status' });
    const form = h('form', { class: 'form', novalidate: true },
      h('div', { class: 'section-title' }, 'Aksiya'),
      h('label', { class: 'check' }, f.promo_on, 'Aksiya yoqilgan'),
      h('div', { class: 'grid2' }, field('s-buy', 'Nechta sotib olinsa', f.promo_buy), field('s-free', 'Nechta sovgʻa beriladi', f.promo_free)),
      h('p', { class: 'muted' }, 'Masalan 4 va 1: mijoz 4 ta olsa, 1 tasi bepul qoʻshiladi. Har bir taom alohida hisoblanadi.'),
      h('div', { class: 'section-title' }, 'Buyurtma qabul qilish'),
      h('label', { class: 'check' }, f.shop_open, 'Buyurtmalar qabul qilinmoqda'),
      h('div', { class: 'grid2' }, field('s-fee', 'Yetkazish narxi (soʻm)', f.delivery_fee), field('s-from', 'Shu summadan bepul (0 — hech qachon)', f.free_from)),
      field('s-min', 'Minimal buyurtma (soʻm)', f.min_order),
      h('div', { class: 'section-title' }, 'Aloqa maʼlumotlari'),
      field('s-phone', 'Telefon', f.phone), field('s-addr', 'Manzil', f.address), field('s-hours', 'Ish vaqti', f.hours),
      msg,
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-sun btn-auto', type: 'submit' }, 'Saqlash')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.className = '';
      const body = {
        promo_on: f.promo_on.checked, shop_open: f.shop_open.checked,
        promo_buy: Number(f.promo_buy.value), promo_free: Number(f.promo_free.value),
        delivery_fee: Number(f.delivery_fee.value), free_from: Number(f.free_from.value), min_order: Number(f.min_order.value),
        phone: f.phone.value, address: f.address.value, hours: f.hours.value,
      };
      try {
        await api('/api/admin/settings', { method: 'PUT', body });
        msg.className = 'ok-msg';
        msg.textContent = 'Saqlandi.';
      } catch (ex) {
        msg.className = 'alert';
        msg.textContent = ex.errors ? Object.values(ex.errors).join(' ') : ex.message;
      }
    });
    root.replaceChildren(form);
  }

  /* ---------- Parol ---------- */

  function viewPassword(root) {
    const cur = h('input', { id: 'p-cur', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    const nw = h('input', { id: 'p-new', type: 'password', autocomplete: 'new-password', required: true, maxlength: 128 });
    const rep = h('input', { id: 'p-rep', type: 'password', autocomplete: 'new-password', required: true, maxlength: 128 });
    const msg = h('div', { role: 'alert', hidden: true });
    const field = (id, label, el) => h('div', { class: 'field' }, h('label', { for: id }, label), el);
    const form = h('form', { class: 'form', novalidate: true },
      h('div', { class: 'section-title' }, 'Parolni oʻzgartirish'),
      h('p', { class: 'muted' }, 'Kamida 10 ta belgi, harf va raqam bilan. Oʻzgartirgandan soʻng qayta kirishingiz kerak boʻladi.'),
      field('p-cur', 'Joriy parol', cur), field('p-new', 'Yangi parol', nw), field('p-rep', 'Yangi parolni takrorlang', rep),
      msg,
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-sun btn-auto', type: 'submit' }, 'Parolni oʻzgartirish')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.hidden = true;
      if (nw.value !== rep.value) {
        msg.className = 'alert'; msg.textContent = 'Yangi parollar bir xil emas.'; msg.hidden = false; return;
      }
      try {
        await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: nw.value } });
        S.csrf = null;
        showLogin('Parol oʻzgartirildi. Yangi parol bilan kiring.');
      } catch (ex) {
        msg.className = 'alert'; msg.textContent = ex.message; msg.hidden = false;
      }
    });
    root.replaceChildren(form);
  }

  /* ---------- Boshlash ---------- */

  (async () => {
    try {
      const r = await fetch('/api/admin/session', { credentials: 'same-origin' });
      if (r.ok) { S.csrf = (await r.json()).csrf; showApp(); return; }
    } catch { /* tarmoq xatosi — kirish oynasi koʻrsatiladi */ }
    showLogin();
  })();
})();
