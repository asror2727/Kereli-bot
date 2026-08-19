# OlovPay (FlayPay) — o'rnatish

## 1. Kerakli dasturlar
Node.js (v18+) o'rnatilgan bo'lishi kerak.

## 2. O'rnatish
```
npm install
cp .env.example .env
```
`.env` faylni oching va to'ldiring:
- `ADMIN_PASSWORD` — admin panelga kirish paroli
- `BOT_TOKEN` — @BotFather dan olingan bot tokeni
- `WEBAPP_URL` — mini app joylashgan URL (Render'da deploy qilgach shu yerga qo'yiladi)
- `OWNER_CHAT_ID` — sizning Telegram ID'ingiz (to'lov xabarlari shu yerga keladi; ID'ingizni bilish uchun @userinfobot ga yozing)
- `HYPERPIN_API_KEY` / `HYPERPIN_API_URL` — allaqachon to'ldirilgan

## 3. Lokal ishga tushirish
```
npm start
```
- Sayt: http://localhost:3000
- Admin panel: http://localhost:3000/admin.html

## 4. GitHub + Render'ga joylash
1. Bu papkani GitHub repo'ga yuklang (`.env` faylni **hech qachon** yuklamang — u `.gitignore`da).
2. Render.com'da "New Web Service" → repo'ni ulang.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment Variables bo'limida `.env`dagi hammasini qo'lda kiriting.
6. Deploy tugagach chiqqan URL'ni `WEBAPP_URL` ga qo'yib qayta deploy qiling.
7. @BotFather → bot → Bot Settings → Menu Button → shu URL'ni qo'ying (yoki /start tugmasidagi "Do'kon" ishlatiladi).

## 5. Birinchi marta admin paneldan to'ldirish tartibi
1. `/admin.html` ga kirib parolni kiriting.
2. **Umumiy** — logo yuklang (splash ekran + bot rasmi uchun).
3. **Bannerlar** — 3 ta bannerga rasm + sarlavha qo'ying.
4. **O'yinlar** — PUBG va boshqa o'yinlarni qo'shing, har biriga UC/Prime paketlarini kiriting (nom + narx).
5. **Top** — xohlasangiz reyting ro'yzatini qo'lda kiriting.
6. Botga `/start` bosing — 3 tugma (Do'kon / News / Support) va yuklagan logongiz chiqadi.

## 6. HyperPin API haqida MUHIM eslatma
`src/hyperpinClient.js` faylida endpoint yo'llari (`/check-id`, `/order`, `/balance`) HALI TASDIQLANMAGAN — chunki HyperPin'ning ochiq hujjatlari topilmadi. Reseller kabinetingizdagi API hujjatini (yoki Postman to'plamini) yuborsangiz, shu faylni 5 daqiqada moslab beraman. Hozircha ID tekshirish so'rovi ishlamasa, tizim avtomatik oddiy tekshiruvga (fallback) o'tadi — sayt buzilib qolmaydi, lekin bu FAQAT VAQTINCHALIK YECHIM.

## 7. Balans va to'lov jarayoni qanday ishlaydi
1. Foydalanuvchi summani kiritadi → karta ko'rsatiladi → 3 daqiqa taymer.
2. "To'lovni amalga oshirdim" bosilsa — sizga (OWNER_CHAT_ID) botdan xabar keladi, ✅/❌ tugmalar bilan.
3. Tasdiqlasangiz — foydalanuvchi balansi avtomatik to'ldiriladi va unga xabar boradi.
4. Xuddi shu amalni admin panel → **To'lovlar** bo'limidan ham qilish mumkin.
