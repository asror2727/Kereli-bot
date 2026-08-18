const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const ADMIN_ID = process.env.ADMIN_ID || '123456789'; // O'zingizning Telegram ID'ingiz
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-render-app.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Telegram Bot /start komandasi
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const startParam = msg.text.split(' ')[1]; // Referal uchun

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔥 Do'kon (Mini App)", web_app: { url: `${WEBAPP_URL}?ref=${startParam || ''}` } }],
        [{ text: "📢 News (Kanal)", url: "https://t.me/arkootzif" }],
        [{ text: "💬 Support (Admin)", url: "https://t.me/x7fan" }]
      ]
    }
  };

  bot.sendMessage(chatId, `Assalomu alaykum! **OlovPay** botiga xush kelibsiz.\nQuyidagi tugmalardan birini tanlang:`, { parse_mode: "Markdown", ...keyboard });
});

// Front-end uchun To'lov so'rovi API endpointi
app.post('/api/deposit', (req, res) => {
  const { userId, username, amount, method } = req.body;

  const adminMsg = `💳 **Yangi to'lov so'rovi!**\n\n👤 **Foydalanuvchi:** @${username || 'Noma'lum'} (ID: ${userId})\n💵 **Summa:** ${amount} so'm\n📌 **Usul:** ${method}`;

  const adminKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: `approve_${userId}_${amount}` },
          { text: "❌ Bekor qilish", callback_data: `reject_${userId}` }
        ]
      ]
    }
  };

  bot.sendMessage(ADMIN_ID, adminMsg, { parse_mode: "Markdown", ...adminKeyboard });
  res.json({ success: true, message: "So'rov adminga yuborildi" });
});

// Admin Tasdiqlash/Bekor qilish knopkalari ishlovi
bot.on('callback_query', (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (data.startsWith('approve_')) {
    const [, targetUser, amount] = data.split('_');
    bot.sendMessage(targetUser, `✅ **To'lovingiz tasdiqlandi!**\nBalans xaridingiz uchun to'ldirildi.`, { parse_mode: "Markdown" });
    bot.editMessageText(`✅ **To'lov tasdiqlandi!** (User: ${targetUser}, Summa: ${amount})`, { chat_id: chatId, message_id: query.message.message_id });
  } else if (data.startsWith('reject_')) {
    const [, targetUser] = data.split('_');
    bot.sendMessage(targetUser, `❌ **To'lov bekor qilindi.**\nAgarda pul tushgan bo'lsa, iltimos admin bilan bog'laning: @x7fan`, { parse_mode: "Markdown" });
    bot.editMessageText(`❌ **To'lov bekor qilindi.**`, { chat_id: chatId, message_id: query.message.message_id });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
