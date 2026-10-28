# Ishtaxa saytini Render'ga joylash

## Muhim: ma'lumotlar saqlanishi va narx

Sayt buyurtmalarni SQLite faylida saqlaydi. Buyurtmalar yo'qolmasligi uchun bu konfiguratsiyada `/data` doimiy diski bor. Render doimiy diskni bepul web xizmatiga qo'shmaydi; shu sabab `render.yaml` pullik eng kichik web reja va 1 GB disk bilan sozlangan. Amaldagi Render narxini Blueprint'dagi **Apply** bosqichida tekshiring va faqat rozi bo'lsangiz davom eting.

## Joylash bosqichlari

1. GitHub'da `ishtaxa-shop` nomli **Private** repository yarating.
2. ZIP ichidagi `ishtaxa` papkasining **ichidagi fayl va papkalarni** repository root'iga yuklang. `render.yaml` aynan root'da turishi kerak. `.env` faylini yoki bazadagi ma'lumotlarni yuklamang.
3. Render Dashboard'da **New → Blueprint** ni tanlab, GitHub repository'ni ulang.
4. Blueprint ko'rsatgan sozlamalar va narxni tekshiring. `ADMIN_PATH` uchun masalan `/boshqaruv-` bilan boshlanuvchi o'zingiz tanlagan uzun manzilni va `ADMIN_PASSWORD` uchun kuchli, boshqa joyda ishlatilmaydigan parolni kiriting. Ularni GitHub'ga yozmang.
5. **Apply** ni faqat narx va o'zgaruvchilar to'g'ri bo'lsa bosing. Deploy tugagach, Render bergan `onrender.com` URL manzilini oching. Admin panel siz kiritgan `ADMIN_PATH` orqali ochiladi.

## Tekshiruv

Loyihadagi testlar `npm test` bilan ishga tushadi. Render'dagi servis uchun health-check `/healthz` manzili bilan sozlangan.
