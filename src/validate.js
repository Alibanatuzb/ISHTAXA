'use strict';

/* Kiruvchi ma'lumotlarni tekshirish. Har bir funksiya { value } yoki { error } qaytaradi. */

// Boshqaruv va koʻrinmas yoʻnalish belgilari (U+0000–0008, 000B, 000C, 000E–001F, 007F, 200B–200F, 2028–202E, 2066–2069)
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028-\\u202E\\u2066-\\u2069]',
  'g'
);

function clean(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(CONTROL_CHARS, '');
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
  else s = s.replace(/\r\n?/g, '\n');
  return s.trim();
}

function length(s) {
  return [...s].length;
}

function text(value, { min = 0, max = 100, multiline = false, label }) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    return { error: `${label} matn boʻlishi kerak.` };
  }
  const s = clean(value ?? '', { multiline });
  if (length(s) < min) {
    return { error: min === 1 ? `${label} kiritilishi kerak.` : `${label} kamida ${min} ta belgidan iborat boʻlsin.` };
  }
  if (length(s) > max) return { error: `${label} ${max} ta belgidan oshmasligi kerak.` };
  return { value: s };
}

function integer(value, { min, max, label }) {
  const n = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || !Number.isSafeInteger(n)) {
    return { error: `${label} butun son boʻlishi kerak.` };
  }
  if (n < min || n > max) return { error: `${label} ${min} dan ${max} gacha boʻlishi kerak.` };
  return { value: n };
}

function bool(value, label) {
  if (value === true || value === 1 || value === '1' || value === 'true') return { value: true };
  if (value === false || value === 0 || value === '0' || value === 'false') return { value: false };
  return { error: `${label} notoʻgʻri.` };
}

/* +998 telefon raqami: +998901234567 koʻrinishiga keltiriladi */
function phone(value) {
  if (typeof value !== 'string') return { error: 'Telefon raqamini kiriting.' };
  let digits = value.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return { error: 'Telefon raqami faqat raqamlardan iborat boʻlsin.' };
  digits = digits.replace(/^\+/, '');
  if (digits.length === 12 && digits.startsWith('998')) digits = digits.slice(3);
  if (!/^\d{9}$/.test(digits)) return { error: 'Telefon raqamini toʻliq kiriting. Masalan: 90 123 45 67.' };
  return { value: `+998${digits}` };
}

const ORDER_STATUSES = ['new', 'preparing', 'delivering', 'done', 'cancelled'];
const PAYMENTS = ['cash', 'card'];

function idemKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value)) {
    return { error: 'Soʻrov kaliti notoʻgʻri. Sahifani yangilab qayta urining.' };
  }
  return { value };
}

function orderInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Soʻrov notoʻgʻri.' };

  const fields = {};
  const errors = {};

  const name = text(body.name, { min: 2, max: 60, label: 'Ism' });
  if (name.error) errors.name = name.error;
  else fields.name = name.value;

  const ph = phone(body.phone);
  if (ph.error) errors.phone = ph.error;
  else fields.phone = ph.value;

  const address = text(body.address, { min: 5, max: 200, multiline: true, label: 'Manzil' });
  if (address.error) errors.address = address.error;
  else fields.address = address.value;

  const note = text(body.note, { max: 200, multiline: true, label: 'Izoh' });
  if (note.error) errors.note = note.error;
  else fields.note = note.value;

  if (!PAYMENTS.includes(body.payment)) errors.payment = 'Toʻlov usulini tanlang.';
  else fields.payment = body.payment;

  const key = idemKey(body.key);
  if (key.error) errors.key = key.error;
  else fields.key = key.value;

  // Savat qatorlari: bir xil taom qatorlari birlashtiriladi
  const lines = new Map();
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.items = 'Savat boʻsh.';
  } else if (body.items.length > 40) {
    errors.items = 'Savatda juda koʻp qator bor.';
  } else {
    for (const raw of body.items) {
      if (!raw || typeof raw !== 'object') {
        errors.items = 'Savat notoʻgʻri.';
        break;
      }
      const id = integer(raw.id, { min: 1, max: 1e9, label: 'Taom' });
      const qty = integer(raw.qty, { min: 1, max: 50, label: 'Miqdor' });
      if (id.error || qty.error) {
        errors.items = 'Savatdagi taom yoki miqdor notoʻgʻri (1–50 ta).';
        break;
      }
      lines.set(id.value, (lines.get(id.value) || 0) + qty.value);
    }
    for (const q of lines.values()) {
      if (q > 50) {
        errors.items = 'Bitta taomdan 50 tadan koʻp buyurtma qilib boʻlmaydi.';
        break;
      }
    }
  }
  fields.items = [...lines.entries()].map(([id, qty]) => ({ id, qty }));

  if (Object.keys(errors).length) return { errors };
  return { value: fields };
}

function itemInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: { _: 'Soʻrov notoʻgʻri.' } };
  const out = {};
  const errors = {};

  const name = text(body.name, { min: 2, max: 60, label: 'Nomi' });
  if (name.error) errors.name = name.error; else out.name = name.value;

  const category = text(body.category, { min: 2, max: 30, label: 'Boʻlim' });
  if (category.error) errors.category = category.error; else out.category = category.value;

  const description = text(body.description, { max: 140, label: 'Tavsif' });
  if (description.error) errors.description = description.error; else out.description = description.value;

  const price = integer(body.price, { min: 1000, max: 2000000, label: 'Narx' });
  if (price.error) errors.price = price.error; else out.price = price.value;

  const emoji = text(body.emoji, { max: 8, label: 'Belgi' });
  if (emoji.error) errors.emoji = emoji.error; else out.emoji = emoji.value;

  const sort = integer(body.sort ?? 0, { min: 0, max: 9999, label: 'Tartib raqami' });
  if (sort.error) errors.sort = sort.error; else out.sort = sort.value;

  const active = bool(body.active ?? true, 'Holat');
  if (active.error) errors.active = active.error; else out.active = active.value;

  if (Object.keys(errors).length) return { errors };
  return { value: out };
}

function settingsInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: { _: 'Soʻrov notoʻgʻri.' } };
  const out = {};
  const errors = {};

  for (const key of ['shop_open', 'promo_on']) {
    const b = bool(body[key], 'Qiymat');
    if (b.error) errors[key] = b.error; else out[key] = b.value ? '1' : '0';
  }

  const ints = {
    delivery_fee: { min: 0, max: 200000, label: 'Yetkazish narxi' },
    free_from: { min: 0, max: 5000000, label: 'Bepul yetkazish chegarasi' },
    min_order: { min: 0, max: 1000000, label: 'Minimal buyurtma' },
    promo_buy: { min: 2, max: 20, label: 'Aksiya: sotib olinadigan soni' },
    promo_free: { min: 1, max: 5, label: 'Aksiya: bonus soni' },
  };
  for (const [key, rule] of Object.entries(ints)) {
    const n = integer(body[key], rule);
    if (n.error) errors[key] = n.error; else out[key] = String(n.value);
  }

  const strs = {
    phone: { max: 30, label: 'Telefon' },
    address: { max: 120, label: 'Manzil' },
    hours: { max: 60, label: 'Ish vaqti' },
  };
  for (const [key, rule] of Object.entries(strs)) {
    const s = text(body[key], rule);
    if (s.error) errors[key] = s.error; else out[key] = s.value;
  }

  if (Object.keys(errors).length) return { errors };
  return { value: out };
}

module.exports = {
  ORDER_STATUSES,
  PAYMENTS,
  clean,
  text,
  integer,
  bool,
  phone,
  orderInput,
  itemInput,
  settingsInput,
};
