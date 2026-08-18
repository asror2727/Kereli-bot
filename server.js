const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const ADMIN_ID = process.env.ADMIN_ID || '123456789'; // Telegram ID
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Xotirada saqlanuvchi dinamik ma'lumotlar
let appSettings = {
  startImage: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800",
  musicUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  banners: [],
  games: [],
  orders: [],
  reviews: [],
  usersCount: 0
};

// State handling for Admin inputs
const adminState = {};

// /start komandasi
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const startParam = msg.text.split(' ')[1];

  appSettings.usersCount++;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔥 Do'kon (FlayPay Mini App)", web_app: { url: `${WEBAPP_URL}?ref=${startParam || ''}` } }],
        [{ text: "📢 News", url: "https://t.me/arkootzif" }],
        [{ text: "💬 Support", url: "https://t.me/x7fan" }]
      ]
    }
  };

  const caption = "Assalomu alaykum! **FlayPay** botiga xush kelibsiz.\nQuyidagi tugmalardan birini tanlang:";
  
  if (appSettings.startImage) {
    bot.sendPhoto(chatId, appSettings.startImage, { caption: caption, parse_mode: "Markdown", ...keyboard });
  } else {
    bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...keyboard });
  }
});

// /admin Panel
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(ADMIN_ID)) return bot.sendMessage(chatId, "❌ Siz admin emassiz!");

  sendAdminMenu(chatId);
});

function sendAdminMenu(chatId) {
  const adminKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Statistika", callback_data: "adm_stats" }],
        [{ text: "🎮 O'yin & UC Qo'shish", callback_data: "adm_add_game" }],
        [{ text: "🖼 3 ta Reklama Banner Qo'shish", callback_data: "adm_set_banners" }],
        [{ text: "🖼 Start Rasmini O'zgartirish", callback_data: "adm_set_start_img" }],
        [{ text: "🎵 Fon Musiqa URL Qoyish", callback_data: "adm_set_music" }],
        [{ text: "🗑 Fikrlarni Tozalash", callback_data: "adm_clear_reviews" }, { text: "🗑 Buyurtmalarni Tozalash", callback_data: "adm_clear_orders" }]
      ]
    }
  };
  bot.sendMessage(chatId, "⚡ **FlayPay Full Admin Panel**\nBoshqarish uchun bo'limni tanlang:", { parse_mode: "Markdown", ...adminKeyboard });
}

// Admin Callbacks
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (String(chatId) !== String(ADMIN_ID)) return;

  if (data === 'adm_stats') {
    bot.sendMessage(chatId, `📊 **FlayPay Statistikasi:**\n\n👤 Jami foydalanuvchilar: ${appSettings.usersCount}\n📦 Jami buyurtmalar: ${appSettings.orders.length}\n💬 Jami fikrlar: ${appSettings.reviews.length}`);
  } else if (data === 'adm_set_banners') {
    adminState[chatId] = 'await_banners';
    bot.sendMessage(chatId, "🖼 Bannerlar uchun 3 ta rasm URL havolasini **vergul (,)** bilan ajratib yuboring:\n\n*Masalan: url1, url2, url3*");
  } else if (data === 'adm_set_start_img') {
    adminState[chatId] = 'await_start_img';
    bot.sendMessage(chatId, "🖼 Bot /start uchun rasm URL havolasini yuboring:");
  } else if (data === 'adm_set_music') {
    adminState[chatId] = 'await_music';
    bot.sendMessage(chatId, "🎵 Mini App uchun `.mp3` musiqa URL havolasini yuboring:");
  } else if (data === 'adm_add_game') {
    adminState[chatId] = 'await_game_data';
    bot.sendMessage(chatId, "🎮 Yangi o'yin qo'shish uchun formatda yuboring:\n\n`O'yin Nomi | Rasm URL`\n*Masalan: PUBG Mobile | https://image_link.com*");
  } else if (data === 'adm_clear_reviews') {
    appSettings.reviews = [];
    bot.sendMessage(chatId, "✅ Barcha fikrlar tozalandi!");
  } else if (data === 'adm_clear_orders') {
    appSettings.orders = [];
    bot.sendMessage(chatId, "✅ Barcha buyurtmalar tarixi tozalandi!");
  } else if (data.startsWith('approve_')) {
    const [, targetUser, amount] = data.split('_');
    bot.sendMessage(targetUser, `✅ **To'lovingiz tasdiqlandi!**\n${amount} so'm hisobingizga tushirildi. Xarid qilishingiz mumkin.`);
    bot.editMessageText(`✅ **To'lov tasdiqlandi!** User ID: ${targetUser}`, { chat_id: chatId, message_id: query.message.message_id });
  } else if (data.startsWith('reject_')) {
    const [, targetUser] = data.split('_');
    bot.sendMessage(targetUser, `❌ **To'lovingiz bekor qilindi.**\nQayta urinib ko'ring yoki muammo bo'lsa @x7fan adminga yozing.`);
    bot.editMessageText(`❌ **To'lov bekor qilindi.** User ID: ${targetUser}`, { chat_id: chatId, message_id: query.message.message_id });
  }
});

// Admin Message Listener for Dynamic Inputs
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = adminState[chatId];

  if (!state || text.startsWith('/')) return;

  if (state === 'await_banners') {
    appSettings.banners = text.split(',').map(s => s.trim());
    bot.sendMessage(chatId, "✅ 3 ta Banner rasmi muvaffaqiyatli o'rnatildi!");
    delete adminState[chatId];
  } else if (state === 'await_start_img') {
    appSettings.startImage = text.trim();
    bot.sendMessage(chatId, "✅ Bot /start rasmi yangilandi!");
    delete adminState[chatId];
  } else if (state === 'await_music') {
    appSettings.musicUrl = text.trim();
    bot.sendMessage(chatId, "✅ Mini App musiqasi yangilandi!");
    delete adminState[chatId];
  } else if (state === 'await_game_data') {
    const parts = text.split('|');
    if (parts.length >= 2) {
      appSettings.games.push({ id: Date.now(), title: parts[0].trim(), img: parts[1].trim() });
      bot.sendMessage(chatId, `✅ "${parts[0].trim()}" o'yini qo'shildi!`);
    } else {
      bot.sendMessage(chatId, "❌ Formatingiz xato! Masalan: `PUBG Mobile | URL` shaklida yozing.");
    }
    delete adminState[chatId];
  }
});

// API Endpointlar Mini App uchun
app.get('/api/settings', (req, res) => res.json(appSettings));

app.post('/api/deposit', (req, res) => {
  const { userId, username, amount } = req.body;
  const adminMsg = `💳 **Yangi to'lov so'rovi (FlayPay)!**\n\n👤 **Foydalanuvchi:** @${username || 'Noma'lum'} (ID: ${userId})\n💵 **Summa:** ${amount} so'm`;
  const adminKeyboard = {
    reply_markup: { inline_keyboard: [[{ text: "✅ Tasdiqlash", callback_data: `approve_${userId}_${amount}` }, { text: "❌ Bekor qilish", callback_data: `reject_${userId}` }]] }
  };
  bot.sendMessage(ADMIN_ID, adminMsg, { parse_mode: "Markdown", ...adminKeyboard });
  res.json({ success: true });
});

app.post('/api/review', (req, res) => {
  const { username, text, rating } = req.body;
  appSettings.reviews.push({ username, text, rating });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("FlayPay Backend server ready on port " + PORT));
