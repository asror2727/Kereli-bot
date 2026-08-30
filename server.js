const express = require('express');
const cors = require('cors');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.BOT_TOKEN || 'BOT_TOKENINGIZNI_YOZING';
const ADMIN_ID = process.env.ADMIN_ID || 'ADMIN_TELEGRAM_ID';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Ma'lumotlar bazasi xotirasi
let db = {
  banners: [
    { type: 'image', url: 'https://via.placeholder.com/600x200/ff4500/ffffff?text=DONAT+SHOP' }
  ],
  games: [{ id: 'pubg', name: 'PUBG Mobile', rating: '5.0', ucCount: 0, primeCount: 0 }],
  packages: [
    { id: 'p1', name: '60 UC', price: 11700, icon: 'https://cdn-icons-png.flaticon.com/512/3081/3081840.png' },
    { id: 'p2', name: '325 UC', price: 59000, icon: 'https://cdn-icons-png.flaticon.com/512/3081/3081840.png' }
  ],
  reviews: [
    { id: 'r1', userName: 'Aziz', text: 'Zo\'r, tez tushdi!', reactions: { '⚡': 5, '💸': 2 } }
  ],
  topUsers: []
};

/* ================= API ENDPOINTS ================= */

app.get('/api/config', (req, res) => {
  res.json(db);
});

// Reaksiya bosilganda hisoblash
app.post('/api/reviews/react', (req, res) => {
  const { reviewId, emoji } = req.body;
  const rev = db.reviews.find(r => r.id === reviewId);
  if (rev) {
    if (!rev.reactions[emoji]) rev.reactions[emoji] = 0;
    rev.reactions[emoji]++;
  }
  res.json({ ok: true });
});

/* ================= TELEGRAM BOT MANIGEMENT ================= */

// /start komandasi — 3 ta asosiy inline tugma (Do'kon, Yangilik, Yordam)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const text = `🔥 <b>Donat Botiga Xush Kelibsiz!</b>\n\nPastdagi tugmalar orqali Web-App ga kiring va paketlarni xarid qiling.`;
  
  const opts = {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛍️ Do'kon", web_app: { url: "https://YOUR-RENDER-APP.onrender.com" } }],
        [
          { text: "📰 Yangilik", url: "https://t.me/YOUR_CHANNEL" },
          { text: "🎧 Yordam", url: "https://t.me/YOUR_ADMIN" }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, text, opts);
});

// Admin panel — Paket qo'shish va Top-10 ni avto shakllantirish
bot.onText(/\/admin/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;
  bot.sendMessage(msg.chat.id, "⚙️ <b>Admin Panel</b>\n\n- Banner almashtirish (Video/Rasm)\n- Yangi Paketlar qo'shish", {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Paket Qo'shish", callback_data: "add_package" }],
        [{ text: "🖼️ Banner O'zgartirish", callback_data: "change_banner" }]
      ]
    }
  });
});

// Chek rasmi kelganda adminga yuborish (Bankomat to'lovi uchun)
bot.on('photo', (msg) => {
  const chatId = msg.chat.id;
  if (msg.photo) {
    bot.sendMessage(chatId, "✅ Chek qabul qilindi! Operator tez orada ko'rib chiqadi.");
    bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda yuritildi`);
});
