# Ishtaxa — fast food onlayn buyurtma sayti

Qora va apelsin rangli sayt: menyu, savat, yetkazib berish yoki zal/stol buyurtmasi, **4 ta olganga 1 ta bonus** aksiyasi va alohida oshxona, kuryer hamda admin panellari.

npm paketlari kerak emas (faqat Node.js 22.13+). Buyurtmalar SQLite faylida saqlanadi.

## Kompyuterda sinab koʻrish

```bash
npm start
```

Birinchi ishga tushishda terminalda admin paroli **bir marta** koʻrsatiladi. Saqlab oling.
Sayt: http://127.0.0.1:3000 · Admin: http://127.0.0.1:3000/admin

Sinovlar: `npm test` (33 ta).

## Internetga chiqarish (hamma koʻrishi uchun)

Sayt oddiy fayllar emas, server dasturi. Shuning uchun Node yoki Docker ishlaydigan hosting kerak
(Render, Railway, Fly.io yoki oddiy VPS). Muhim shartlar:

1. **Doimiy disk (volume)** ulang va `DB_FILE=/data/ishtaxa.db` qoʻying. Aks holda har yangilanishda buyurtmalar oʻchib ketadi.
2. Muhit oʻzgaruvchilari `.env.example` faylida: `ADMIN_PATH` (yashirin manzil), `TRUST_PROXY=1`, `NODE_ENV=production`.
3. Faqat **HTTPS** orqali ochiladi (hostinglar buni oʻzi beradi).
4. Docker ishlatsangiz: `docker build -t ishtaxa .` va `/data` ga volume ulang.

## Admin panel

- Manzil: `ADMIN_PATH` da yozgan yashirin yoʻl (masalan `/boshqaruv-q7x2m9`). Boshqa yoʻllarda admin sahifasi mavjud emas.
- Hisobotlar, buyurtmalar holatini kuzatish, kuryer va oshpaz akkauntlari, menyu, aksiya va yetkazish sozlamalari, parolni oʻzgartirish.
- Buyurtma holati mijozga faqat koʻrinadi. Admin holatni oʻzgartirmaydi.

## Buyurtma ish jarayoni

- Oshpaz yangi buyurtmani qabul qiladi, tayyorlashni boshlaydi va tayyor deb belgilaydi.
- Yetkazish buyurtmasi faqat oshxona tayyor qilgandan keyin biriktirilgan kuryer panelida koʻrinadi. Kuryer «Yoʻlga chiqdim» va «Yetkazildi» bosqichlarini yuritadi.
- Zal buyurtmasida stol raqami kiritiladi, yetkazish haqi olinmaydi, oshpaz «Stolga berildi» bilan yakunlaydi.
- Mijoz buyurtma raqami bilan jarayonni kuzatadi; holatni oʻzgartiradigan API yoʻq.
- Oshxona paneli: `/kitchen.html`; kuryer paneli: `/courier.html`.
- Parol esdan chiqsa: serverda `npm run reset-admin`.

## Aksiyani oʻzgartirish

Admin panel → «Aksiya va sozlamalar». Standart: 4 ta olsangiz, 1 tasi bepul. Har bir taom uchun alohida hisoblanadi
(4 ta burger → 1 burger bepul; 8 ta → 2). Bonus narxga qoʻshilmaydi va savatda avtomatik koʻrinadi.

## Xavfsizlik

- **Narx faqat serverda hisoblanadi.** Mijoz yuborgan narx, jami yoki aksiya eʼtiborga olinmaydi.
- **Faqat bitta admin** hisobi va bitta faol sessiya: yangi kirish eskisini tugatadi. Sessiya 2 soat harakatsizlikdan, 12 soatdan keyin tugaydi.
- Parol `scrypt` bilan xeshlanadi. Login xatosi qaysi maydon notoʻgʻriligini bildirmaydi. 15 daqiqada 5 ta xatodan soʻng IP bloklanadi.
- Cookie: `HttpOnly`, `SameSite=Strict`, HTTPSʼda `Secure` va `__Host-`. Oʻzgartiruvchi soʻrovlarda CSRF kaliti va `Origin` tekshiriladi.
- Barcha kiritishlar server tomonda tekshiriladi, SQL faqat parametrlar bilan. Sahifalarga maʼlumot `textContent` orqali chiqariladi (XSS yoʻq), qatʼiy `Content-Security-Policy`.
- Buyurtma yuborish tezligi cheklangan (bitta IP dan 10 daqiqada 6 ta). Takroriy yuborishdan himoya (bir xil buyurtma ikki marta yaratilmaydi).
- Mijoz buyurtma holatini faqat uzun tasodifiy havola orqali koʻradi; ommaviy javobda telefon va manzil yoʻq.
- Fayllarga yoʻl chiqib ketish (`../`), maxfiy fayllar va baza fayliga kirish yopiq.

Cheklov: bitta server va SQLite kichik va oʻrta yuk uchun yetarli. Juda katta yuk boʻlsa PostgreSQL ga oʻtish kerak. Render Free xizmatida disk doimiy emas; buyurtmalarni saqlash uchun doimiy diskli pullik xizmat yoki tashqi maʼlumotlar bazasi talab qilinadi.
