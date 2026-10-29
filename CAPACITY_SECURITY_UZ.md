# Yuklama va xavfsizlik hisoboti

## Joriy Render holati

- Web service: bitta instans, Free reja, 256 MB RAM, auto-deploy yoqilgan, autoscaling yoʻq.
- Render metrikasida 2026-10-29 dagi xotira nuqtasi taxminan 53 MB edi. CPU, HTTP soʻrovlar soni va kechikish qatorlari bo‘sh qaytdi; Render loglarida esa dastur ishga tushgan yozuvlar bor, soʻrov loglari ko‘rinmadi.
- Shu sabab, hozircha yuklama sinovi bilan oʻlchangan bir vaqtdagi foydalanuvchi soni yoʻq. 33 ta avvalgi test va yangi 36 ta funksional/xavfsizlik testi yuklama sinovi hisoblanmaydi.
- Reja va kodga qarab ehtiyotkor amaliy taxmin: eng yuqori vaqtda 10–20 nafar faol buyurtmachi/xodim. Bu kafolatlangan limit yoki oʻlchov emas; yengil sahifalarni ochib turgan ulanishlar soni boshqa oʻlchovdir. Aniq limit uchun real HTTP yuklama sinovi va CPU/xotira/kechikish metrikalari kerak.

## Saqlash xavfi

Ilova buyurtmalarni SQLite faylida saqlaydi. Tekshiruvdagi Render xizmati Free rejada. Render hujjatlarida Free web serviceʼlarda doimiy disk mavjud emasligi va deploy paytida fayl tizimi oʻzgarishlari yoʻqolishi qayd etilgan. Shu sabab, amaldagi maʼlumotlar bazasi uchun mustaqil zaxira nusxasi va doimiy saqlash tayyorlanmaguncha yangi kodni live xizmatga deploy qilish xavfli.

## Ish jarayonidagi xavfsizlik oʻzgarishlari

- Oshpaz va kuryer uchun alohida akkauntlar, parol xeshi, `HttpOnly`/`SameSite=Strict` sessiya cookie va CSRF kaliti ishlatiladi.
- Oshpaz buyurtmani `Yangi → Tayyorlanmoqda → Tayyor` bosqichlaridan oʻtkazadi. Zal buyurtmasini tayyor deb belgilagan oshpaz stolga berilganini yakunlaydi.
- Yetkazish buyurtmasi oshxona `Tayyor` qilgandan keyin kuryerga koʻrinadi. Kuryer faqat oʻziga biriktirilgan buyurtmani `Yoʻlda → Yetkazildi` oʻtkazishi mumkin. Maʼlumotlar bazasidagi oʻzgarish har bir oldingi holatga shart qoʻyadi.
- Oshxona javobida mijoz manzili va telefoni berilmaydi. Kuryer faqat oʻz ishiga kerakli buyurtma maʼlumotlarini oladi.
- Mijoz buyurtmani kuzatish tokeni orqali holatni faqat oʻqiydi. Ommaviy API holatni oʻzgartirmaydi; adminning holat oʻzgartirish yoʻli olib tashlangan.
- Zal/stol turi va stol raqami serverda tekshiriladi; zal buyurtmasiga yetkazish haqi qoʻshilmaydi.
- Sessiya tozalash oshpaz va kuryer sessiyalarini ham qamrab oladi. Adminning maxfiy yoʻli server logiga yozilmaydi.

## Qolgan cheklovlar

Tezlik cheklovlari va SQLite bitta instans xotirasida ishlaydi; ular ko‘p instansga oson masshtablanmaydi. Xizmatni kengaytirishdan oldin doimiy maʼlumotlar bazasi, zaxira, shared rate-limit va oʻlchangan yuk sinovi kerak. Ushbu branch live saytga deploy qilinmagan.
