(() => {
  'use strict';

  /* ---------- Yordamchilar ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);

  // Barcha matn textContent orqali qoʻyiladi: serverdan kelgan maʼlumot hech qachon HTML sifatida talqin qilinmaydi.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} soʻm`;

  const STATUS = {
    new: 'Qabul qilindi',
    preparing: 'Tayyorlanmoqda',
    ready: 'Tayyor — kuryer kutilyapti',
    delivering: 'Yoʻlda',
    done: 'Yetkazildi',
    cancelled: 'Bekor qilindi',
  };

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* ruxsat yoʻq */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ruxsat yoʻq */ } },
  };

  function randomKey() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  async function api(path, options = {}) {
    // Bepul host uygʻonayotganida vaqtinchalik javob kelishi mumkin.
    // GET soʻrovlarini keshdan olmasdan, qisqa qayta urinish bilan bajariladi.
    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetch(path, { ...options, cache: 'no-store' });
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        throw { message: 'Serverga ulanib boʻlmadi. Sahifani yangilang va qayta urinib koʻring.' };
      }

      lastStatus = res.status;
      const contentType = res.headers.get('content-type') || '';
      let data = {};
      if (contentType.includes('json')) {
        try { data = await res.json(); } catch { /* notoʻgʻri JSON */ }
      } else {
        try { await res.text(); } catch { /* javob tanasi ixtiyoriy */ }
      }

      if (res.ok && contentType.includes('json')) return data;
      if (attempt === 0 && (res.status >= 500 || res.status === 429 || !contentType.includes('json'))) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      throw {
        status: res.status,
        message: data.error || (contentType.includes('json')
          ? `Server xatosi (${res.status}). Keyinroq qayta urinib koʻring.`
          : `Serverdan notoʻgʻri javob keldi (${res.status}). Sahifani yangilang.`),
        errors: data.errors
      };
    }
    throw { status: lastStatus, message: 'Serverga ulanib boʻlmadi. Sahifani yangilang.' };
  }

  /* ---------- Holat ---------- */

  const state = { items: [], settings: null, cart: new Map(), view: 'cart', last: null, pollTimer: null, orderType: 'delivery' };

  function loadCart() {
    try {
      const raw = JSON.parse(store.get('ishtaxa.cart.v1') || '{}');
      for (const [id, qty] of Object.entries(raw)) {
        const n = Number(qty);
        if (/^\d+$/.test(id) && Number.isInteger(n) && n >= 1 && n <= 50) state.cart.set(Number(id), n);
      }
    } catch { /* buzilgan saqlangan maʼlumot eʼtiborga olinmaydi */ }
  }
  function saveCart() {
    store.set('ishtaxa.cart.v1', JSON.stringify(Object.fromEntries(state.cart)));
  }

  const itemById = (id) => state.items.find((i) => i.id === id);
  const freeFor = (qty) => {
    const s = state.settings;
    return s.promo_on ? Math.floor(qty / s.promo_buy) * s.promo_free : 0;
  };

  function totals() {
    let subtotal = 0;
    let count = 0;
    for (const [id, qty] of state.cart) {
      const it = itemById(id);
      if (!it) continue;
      subtotal += it.price * qty;
      count += qty + freeFor(qty);
    }
    const s = state.settings;
    const fee = state.orderType === 'dinein' ? 0 : (subtotal > 0 && !(s.free_from > 0 && subtotal >= s.free_from) ? s.delivery_fee : 0);
    return { subtotal, fee, total: subtotal + fee, count };
  }

  /* ---------- Menyu ---------- */

  const rowRefs = new Map();

  function renderPromo() {
    const s = state.settings;
    const box = $('#promo');
    if (!s.promo_on) { box.hidden = true; return; }
    box.hidden = false;
    const free = s.promo_free;
    $('#promo-title').textContent = `${s.promo_buy} ta oling — ${free} tasi bizdan sovgʻa`;
    const dots = $('#promo-dots');
    dots.replaceChildren();
    for (let i = 1; i <= s.promo_buy; i++) dots.append(h('li', { class: 'dot dot-paid' }, String(i)));
    for (let i = 0; i < free; i++) dots.append(h('li', { class: 'dot dot-free' }, '🎁'));
    $('#promo-note').textContent = 'Har bir taom uchun alohida hisoblanadi. Sovgʻa savatda avtomatik qoʻshiladi.';
  }

  function renderMenu() {
    const list = $('#menu-list');
    const cats = $('#cats');
    list.replaceChildren();
    cats.replaceChildren();
    rowRefs.clear();

    if (!state.items.length) {
      list.append(h('p', { class: 'muted pad' }, 'Menyu hozircha boʻsh. Keyinroq qayta tekshiring.'));
      return;
    }
    const groups = new Map();
    for (const it of state.items) {
      if (!groups.has(it.category)) groups.set(it.category, []);
      groups.get(it.category).push(it);
    }
    let n = 0;
    for (const [name, items] of groups) {
      const id = `cat-${n++}`;
      cats.append(h('a', { href: `#${id}` }, name));
      const grid = h('div', { class: 'menu-grid' });
      const section = h('section', { class: 'cat', id }, h('h3', null, name), grid);
      for (const it of items) grid.append(buildRow(it));
      list.append(section);
    }
  }

  function buildRow(it) {
    const s = state.settings;
    const tag = s.promo_on ? h('span', { class: 'tag', title: 'Aksiya' }, `${s.promo_buy}+${s.promo_free}`) : null;
    const side = h('div', { class: 'row-side' });
    const image = h('div', { class: 'row-emoji', 'aria-hidden': 'true' }, it.imageUrl ? h('img', { src: it.imageUrl, alt: '', loading: 'lazy', decoding: 'async' }) : (it.emoji || '🍽️'));
    const row = h('article', { class: 'row' }, image,
      h('div', { class: 'row-info' }, h('h4', { class: 'row-name' }, it.name, tag), it.description ? h('p', { class: 'row-desc' }, it.description) : null,
        h('div', { class: 'row-bottom' }, h('span', { class: 'row-price' }, money(it.price)), side)));
    rowRefs.set(it.id, { side, it });
    updateRow(it.id);
    return row;
  }

  function updateRow(id) {
    const ref = rowRefs.get(id);
    if (!ref) return;
    const { side, it } = ref;
    const qty = state.cart.get(id) || 0;
    side.replaceChildren(h('span', { class: 'row-price' }, money(it.price)));
    if (!qty) {
      side.append(
        h('button', {
          class: 'add', type: 'button', disabled: !state.settings.shop_open,
          'aria-label': `${it.name} — savatga qoʻshish`, onclick: () => change(id, 1),
        }, 'Qoʻshish')
      );
    } else {
      side.append(
        h('div', { class: 'step', role: 'group', 'aria-label': it.name },
          h('button', { type: 'button', 'aria-label': `${it.name}: bittaga kamaytirish`, onclick: () => change(id, -1) }, '−'),
          h('output', { 'aria-live': 'polite' }, String(qty)),
          h('button', { type: 'button', 'aria-label': `${it.name}: bittaga koʻpaytirish`, onclick: () => change(id, 1) }, '+'))
      );
    }
  }

  function change(id, delta) {
    if (!itemById(id)) return;
    const next = Math.max(0, Math.min(50, (state.cart.get(id) || 0) + delta));
    if (next === 0) state.cart.delete(id); else state.cart.set(id, next);
    saveCart();
    const card = rowRefs.get(id)?.side.closest('.row');
    if (card && delta > 0) { card.classList.remove('is-added'); void card.offsetWidth; card.classList.add('is-added'); setTimeout(() => card.classList.remove('is-added'), 520); }
    updateRow(id);
    updateHeader(delta > 0);
    if (state.view === 'cart' && $('#drawer').open) renderDrawer();
  }

  function updateHeader(bump) {
    const { count } = totals();
    $('#cart-count').textContent = String(count);
    const btn = $('#cart-open');
    if (bump) { btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump'); }
  }

  /* ---------- Savat va buyurtma ---------- */

  const drawer = () => $('#drawer');

  function renderDrawer() {
    const body = $('#drawer-body');
    body.replaceChildren();
    const lines = [...state.cart].filter(([id]) => itemById(id));

    if (!lines.length) {
      body.append(h('div', { class: 'empty' }, h('p', null, 'Savat hozircha boʻsh.'), h('p', null, 'Menyudan taom tanlang.')));
      return;
    }
    const s = state.settings;
    for (const [id, qty] of lines) {
      const it = itemById(id);
      const free = freeFor(qty);
      const toNext = s.promo_buy - (qty % s.promo_buy);
      const line = h(
        'div', { class: 'line' },
        h('div', { class: 'line-name' }, it.name),
        h('div', { class: 'line-sum' }, money(it.price * qty)),
        h('div', { class: 'step', role: 'group', 'aria-label': it.name },
          h('button', { type: 'button', 'aria-label': `${it.name}: kamaytirish`, onclick: () => change(id, -1) }, '−'),
          h('output', null, String(qty)),
          h('button', { type: 'button', 'aria-label': `${it.name}: koʻpaytirish`, onclick: () => change(id, 1) }, '+')),
        free ? h('div', { class: 'line-gift' }, `🎁 +${free} ta sovgʻa (bepul)`) : null,
        s.promo_on ? h('div', { class: 'line-hint' }, `Yana ${toNext} ta qoʻshsangiz, ${s.promo_free} ta sovgʻa qoʻshiladi.`) : null
      );
      body.append(line);
    }

    const t = totals();
    const sum = h('div', { class: 'sum' },
      h('div', null, h('span', null, 'Taomlar'), h('span', null, money(t.subtotal))),
      h('div', null, h('span', null, 'Yetkazish'), h('span', null, t.fee === 0 ? 'Bepul' : money(t.fee)))
    );
    if (state.orderType === 'delivery' && s.free_from > 0 && t.subtotal < s.free_from) {
      sum.append(h('div', { class: 'nudge' }, h('span', null, `Yana ${money(s.free_from - t.subtotal)} — yetkazish bepul.`)));
    }
    sum.append(h('div', { class: 'total' }, h('span', null, 'Jami'), h('span', null, money(t.total))));
    body.append(sum);

    const orderType = h('select', { id: 'order-type' },
      h('option', { value: 'delivery' }, 'Yetkazib berish'),
      h('option', { value: 'dinein' }, 'Zalda — stolga buyurtma'));
    orderType.value = state.orderType;
    orderType.addEventListener('change', () => { state.orderType = orderType.value; renderDrawer(); });
    body.append(h('div', { class: 'field' }, h('label', { for: 'order-type' }, 'Buyurtma turi'), orderType));

    if (!s.shop_open) {
      body.append(h('p', { class: 'alert' }, 'Hozir buyurtma qabul qilinmayapti.'));
      return;
    }
    body.append(buildForm(t));
  }

  let checkoutKey = null;

  function buildForm(t) {
    const s = state.settings;
    const saved = (() => { try { return JSON.parse(store.get('ishtaxa.contact') || '{}'); } catch { return {}; } })();
    const field = (id, label, control, extra) => h('div', { class: 'field' }, h('label', { for: id }, label), control, h('div', { class: 'err', id: `${id}-err`, role: 'alert' }), extra);

    const name = h('input', { id: 'f-name', name: 'name', type: 'text', autocomplete: 'name', maxlength: 60, required: true, value: saved.name || '' });
    const phone = h('input', { id: 'f-phone', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', placeholder: '90 123 45 67', maxlength: 20, required: true, value: saved.phone || '' });
    const address = h('textarea', { id: 'f-address', name: 'address', autocomplete: 'street-address', maxlength: 200, required: state.orderType === 'delivery', placeholder: 'Koʻcha, uy, kvartira, moʻljal' }, saved.address || '');
    const table = h('input', { id: 'f-table', name: 'tableNumber', type: 'text', maxlength: 20, required: state.orderType === 'dinein', placeholder: 'Masalan, 4' });
    const note = h('textarea', { id: 'f-note', name: 'note', maxlength: 200, placeholder: 'Masalan: achchiq sousni kamroq qoʻshing' });

    const pay = h('fieldset', { class: 'pay' },
      h('legend', { class: 'legend' }, 'Toʻlov usuli'),
      h('label', null, h('input', { type: 'radio', name: 'payment', value: 'cash', checked: true }), state.orderType === 'dinein' ? 'Naqd pul' : 'Naqd pul — kuryerga'),
      h('label', null, h('input', { type: 'radio', name: 'payment', value: 'card' }), state.orderType === 'dinein' ? 'Karta' : 'Karta — kuryerga')
    );

    const alert = h('div', { class: 'alert', id: 'form-alert', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn btn-sun', type: 'submit' }, `Buyurtma berish · ${money(t.total)}`);

    const form = h('form', { class: 'form', novalidate: true },
      h('h3', null, state.orderType === 'dinein' ? 'Zalda buyurtma' : 'Yetkazish maʼlumotlari'),
      field('f-name', 'Ismingiz', name),
      state.orderType === 'delivery' ? field('f-phone', 'Telefon raqami', h('div', { class: 'phone' }, h('span', null, '+998'), phone)) : null,
      state.orderType === 'delivery' ? field('f-address', 'Manzil', address) : field('f-table', 'Stol raqami', table),
      field('f-note', 'Izoh (ixtiyoriy)', note),
      pay,
      alert,
      submit
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      for (const el of form.querySelectorAll('.err')) el.textContent = '';
      for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
      alert.hidden = true;
      if (!checkoutKey) checkoutKey = randomKey();
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = 'Yuborilmoqda…';
      try {
        const payload = {
          name: name.value, phone: state.orderType === 'delivery' ? phone.value : '', address: state.orderType === 'delivery' ? address.value : '',
          orderType: state.orderType, tableNumber: state.orderType === 'dinein' ? table.value : '', note: note.value,
          payment: form.elements.payment.value,
          key: checkoutKey,
          items: [...state.cart].map(([id, qty]) => ({ id, qty })),
        };
        const { order } = await api('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        store.set('ishtaxa.contact', JSON.stringify({ name: name.value, phone: phone.value, address: address.value }));
        store.set('ishtaxa.last', order.token);
        checkoutKey = null;
        state.cart.clear();
        saveCart();
        for (const id of rowRefs.keys()) updateRow(id);
        updateHeader(false);
        state.last = order;
        showOrder(order, true);
      } catch (err) {
        submit.disabled = false;
        submit.textContent = original;
        if (err.errors) {
          const map = { name: 'f-name', phone: 'f-phone', address: 'f-address', tableNumber: 'f-table', note: 'f-note' };
          let focused = false;
          for (const [k, msg] of Object.entries(err.errors)) {
            const id = map[k];
            if (!id) { alert.textContent = msg; alert.hidden = false; continue; }
            $(`#${id}-err`, form).textContent = msg;
            const input = $(`#${id}`, form);
            input.setAttribute('aria-invalid', 'true');
            if (!focused) { input.focus(); focused = true; }
          }
        } else {
          alert.textContent = err.message;
          alert.hidden = false;
          if (err.status === 409 || err.status === 422) loadMenu(false);
        }
      }
    });
    return form;
  }

  /* ---------- Buyurtma holati ---------- */

  function customerOrderCode(code) {
    const match = /^IS-(\d+)$/i.exec(String(code || ''));
    return match ? `#${Number(match[1])}` : (code || '—');
  }

  function showOrder(order, fresh) {
            state.view = 'order';
    const body = $('#drawer-body');
    body.replaceChildren();
    $('#drawer-h').textContent = 'Buyurtma';
    const lines = h('div', null);
    for (const l of order.lines) {
      lines.append(h('div', { class: 'line' },
        h('div', { class: 'line-name' }, `${l.name} × ${l.qty}`),
        h('div', null),
        l.free ? h('div', { class: 'line-gift' }, `🎁 +${l.free} ta sovgʻa`) : null));
    }
    body.append(
      h('div', { class: 'done' },
        h('h3', null, fresh ? 'Buyurtma qabul qilindi' : `Buyurtma ${customerOrderCode(order.code)}`),
        h('p', null, fresh
          ? `Buyurtma raqamingiz: ${customerOrderCode(order.code)}. Holatini shu oynada kuzatib boring.`
          : 'Buyurtma holati avtomatik yangilanadi.'),
        order.orderType === 'dinein' ? h('p', { class: 'muted' }, `Zal · ${order.tableNumber}-stol`) : null,
        h('span', { class: `status is-${order.status}`, id: 'order-status' }, STATUS[order.status] || order.status),
        lines,
        h('div', { class: 'sum' },
          h('div', null, h('span', null, 'Yetkazish'), h('span', null, order.deliveryFee === 0 ? 'Bepul' : money(order.deliveryFee))),
          h('div', { class: 'total' }, h('span', null, 'Jami'), h('span', null, money(order.total)))),
        h('p', { class: 'muted' }, order.orderType === 'dinein' ? 'Toʻlov zalda amalga oshiriladi.' : 'Toʻlov kuryerga topshirilganda amalga oshiriladi.')
      )
    );
    if (!drawer().open) drawer().showModal();
    poll(order.token);
  }

  function stopPoll() { clearTimeout(state.pollTimer); state.pollTimer = null; }

  function poll(token) {
    stopPoll();
    state.pollTimer = setTimeout(async () => {
      if (!drawer().open || state.view !== 'order') return;
      try {
        const { order } = await api(`/api/orders/${token}`);
        const el = $('#order-status');
        if (el) { el.textContent = STATUS[order.status] || order.status; el.className = `status is-${order.status}`; }
        if (order.status !== 'done' && order.status !== 'cancelled') poll(token);
      } catch { poll(token); }
    }, 15000);
  }

  async function restoreTracker() {
    const token = store.get('ishtaxa.last');
    if (!token || !/^[0-9a-f]{32}$/.test(token)) return;
    try {
      const { order } = await api(`/api/orders/${token}`);
      if (order.status === 'done' || order.status === 'cancelled' || Date.now() - order.createdAt > 6 * 3600 * 1000) {
        store.del('ishtaxa.last');
        return;
      }
      const btn = $('#track');
      btn.hidden = false;
      btn.replaceChildren('Buyurtma ', h('b', null, customerOrderCode(order.code)), ` · ${STATUS[order.status]}. Holatini koʻrish`);
      btn.onclick = () => showOrder(order, false);
    } catch { /* tarmoq xatosi: banner koʻrsatilmaydi */ }
  }

  /* ---------- Yuklash ---------- */

  function renderFooter() {
    const s = state.settings;
    const parts = [s.address, s.hours && `Ish vaqti: ${s.hours}`, s.phone && `Tel: ${s.phone}`].filter(Boolean);
    $('#foot-info').textContent = parts.join('  ·  ');
    $('#closed').hidden = s.shop_open;
    $('#closed-hours').textContent = s.hours || '';
  }

  async function loadMenu(firstLoad = true) {
    try {
      const data = await api('/api/menu');
      state.items = data.items;
      state.settings = data.settings;
    } catch (err) {
      if (firstLoad) $('#menu-list').replaceChildren(h('p', { class: 'muted pad' }, err.message));
      return;
    }
    for (const id of [...state.cart.keys()]) if (!itemById(id)) state.cart.delete(id);
    saveCart();
    renderPromo();
    renderMenu();
    renderFooter();
    updateHeader(false);
    if (drawer().open && state.view === 'cart') renderDrawer();
  }

  function openCart() {
    if (!state.settings) return; // menyu hali yuklanmagan
    stopPoll();
    state.view = 'cart';
    $('#drawer-h').textContent = 'Savat';
    renderDrawer();
    if (!drawer().open) drawer().showModal();
  }

  $('#cart-open').addEventListener('click', openCart);
  $('#drawer-close').addEventListener('click', () => drawer().close());
  drawer().addEventListener('click', (e) => { if (e.target === drawer()) drawer().close(); });
  drawer().addEventListener('close', stopPoll);

  loadCart();
  loadMenu().then(restoreTracker);
})();
