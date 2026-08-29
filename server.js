const express = require('express');
const cors = require('cors');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// BOT TOKEN WA ADMIN ID
const BOT_TOKEN = process.env.BOT_TOKEN || 'BOT_TOKENINGIZNI_BUYERGA_YOZING';
const ADMIN_ID = process.env.ADMIN_ID || 'ADMIN_TELEGRAM_ID';

// Bot instansiyasi (Conflict xatosini kamaytirish uchun polling sozlamalari)
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: true,
    params: { timeout: 10 }
  }
});

// Telegram 409 Conflict xatosini ushlab qolish va serverni to'xtatib qo'ymaslik
bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.response && error.response.body.error_code === 409) {
    console.log("Polling conflict: Boshqa bot instansiyasi ishlayapti...");
  } else {
    console.error("Bot polling error:", error.message);
  }
});

// Vaqtinchalik xotira (Baza o'rnida)
const db = {
  users: {},      // userId -> { balance: 0 }
  deposits: [],   // { id, userId, amount, method, status, createdAt }
  orders: [],
  reviews: [],
  config: {
    splashLogo: null,
    musicUrl: null,
    banners: [null, null, null],
    games: [],
    topUsers: []
  }
};

/* =========================================================
   SMS PARSER (XATOSIZ MATN NORMALIATSASI VA SUMMANI AJRATISH)
   ========================================================= */
function parseSmsAmount(text) {
  if (!text) return 0;

  // 1. Sanani (masalan 2026-08-29 yoki 2026.08.29) matndan tozalaymiz
  let cleanedText = text.replace(/\b20\d{2}[-./]\d{2}[-./]\d{2}\b/g, '');
  
  // 2. Soat ko'rsatkichlarini (11:23:41 kabi) tozalaymiz
  cleanedText = cleanedText.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '');

  // 3. SMS matnida summa odatda 'so'm', 'sum', 'UZS' so'zlaridan oldin keladi
  // Masalan: "Karta hisobingiz 2 000 so'mga to'ldirildi" yoki "Popolnenie: 50000 UZS"
  const keywordRegex = /(\d[\d\s\.,]*)\s*(so'?m|sum|uzs)/i;
  const match = cleanedText.match(keywordRegex);

  if (match && match[1]) {
    const rawNum = match[1].replace(/[\s\.,]/g, '');
    const parsed = parseInt(rawNum, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 4. Agar kalit so'z topilmasa, matndagi eng oxirgi mos keladigan katta raqamni olinadi
  const numbers = cleanedText.match(/\b\d[\d\s\.,]*\b/g);
  if (numbers) {
    for (let i = numbers.length - 1; i >= 0; i--) {
      const num = parseInt(numbers[i].replace(/[\s\.,]/g, ''), 10);
      // Masalan, 1000 so'mdan yuqori va yildan (2026) farq qiladigan summa
      if (!isNaN(num) && num >= 500 && num !== 2026) {
        return num;
      }
    }
  }

  return 0;
}

/* =========================================================
   API ENDPOINTS
   ========================================================= */

// Config
app.get('/api/config', (req, res) => {
  res.json(db.config);
});

// User Ma'lumotlari
app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  if (!db.users[userId]) {
    db.users[userId] = { balance: 0 };
  }
  res.json({ ok: true, user: db.users[userId] });
});

// Depozit so'rovini yaratish
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  const depId = 'dep_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  const newDeposit = {
    id: depId,
    userId: String(userId),
    amount: Number(amount),
    method: method || 'uzcard',
    status: 'pending',
    createdAt: new Date()
  };

  db.deposits.push(newDeposit);

  // Admin Telegramiga xabar yuborish (Tasdiqlash/Bekor qilish tugmalari bilan)
  if (ADMIN_ID && ADMIN_ID !== 'ADMIN_TELEGRAM_ID') {
    const msg = `💰 <b>Yangi to'lov so'rovi!</b>\n\n` +
                `👤 User ID: <code>${userId}</code>\n` +
                `💵 Summa: <b>${Number(amount).toLocaleString('uz-UZ')} so'm</b>\n` +
                `💳 Tizim: ${method.toUpperCase()}\n` +
                `🆔 Depozit ID: <code>${depId}</code>`;
                
    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: `confirm_${depId}` },
          { text: "❌ Bekor qilish", callback_data: `reject_${depId}` }
        ]
      ]
    };

    bot.sendMessage(ADMIN_ID, msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch(e => console.error("Admin msg error:", e.message));
  }

  res.json({ ok: true, deposit: newDeposit });
});

// Depozit holatini tekshirish (Frontend Polling uchun)
app.get('/api/deposits/:id', (req, res) => {
  const dep = db.deposits.find(d => d.id === req.params.id);
  if (!dep) return res.json({ ok: false, error: 'Topilmadi' });
  res.json({ ok: true, deposit: dep });
});

// SMS QABUL QILISH ENDPOINTI (Android SMS Forwarder yoki Avto-Notification bot uchun)
app.post('/api/sms-listener', (req, res) => {
  const { smsText, secretKey } = req.body;
  console.log(`[SMS KELDI]: ${smsText}`);

  const parsedAmount = parseSmsAmount(smsText);
  console.log(`[SMS PARSED] Tushgan summa: ${parsedAmount} so'm`);

  if (parsedAmount > 0) {
    // Kutilayotgan eng yaqin to'lovni topish
    const pendingDep = db.deposits.find(d => d.status === 'pending' && d.amount === parsedAmount);

    if (pendingDep) {
      pendingDep.status = 'confirmed';
      if (!db.users[pendingDep.userId]) db.users[pendingDep.userId] = { balance: 0 };
      db.users[pendingDep.userId].balance += pendingDep.amount;

      console.log(`✅ Depozit avto-tasdiqlandi: ${pendingDep.id} | Summa: ${pendingDep.amount}`);

      // Telegram orqali userga bildirishnoma yuborish
      bot.sendMessage(pendingDep.userId, `✅ <b>To'lovingiz tasdiqlandi!</b>\n\nHisobingizga <b>${pendingDep.amount.toLocaleString('uz-UZ')} so'm</b> qo'shildi.`, { parse_mode: 'HTML' }).catch(() => {});
    }
  }

  res.json({ ok: true, parsedAmount });
});

/* =========================================================
   TELEGRAM BOT CALLBACK (ADMIN TUGMALARI)
   ========================================================= */
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (data.startsWith('confirm_')) {
    const depId = data.replace('confirm_', '');
    const dep = db.deposits.find(d => d.id === depId);

    if (dep && dep.status === 'pending') {
      dep.status = 'confirmed';
      if (!db.users[dep.userId]) db.users[dep.userId] = { balance: 0 };
      db.users[dep.userId].balance += dep.amount;

      bot.editMessageText(query.message.text + `\n\n✅ <b>ADMIN TAROFIDAN TASDIQLANDI</b>`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
      });

      bot.sendMessage(dep.userId, `✅ <b>To'lovingiz tasdiqlandi!</b>\n\nHisobingizga <b>${dep.amount.toLocaleString('uz-UZ')} so'm</b> qo'shildi.`, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      bot.answerCallbackQuery(query.id, { text: "Bu to'lov allaqachon ko'rib chiqilgan!" });
    }
  } else if (data.startsWith('reject_')) {
    const depId = data.replace('reject_', '');
    const dep = db.deposits.find(d => d.id === depId);

    if (dep && dep.status === 'pending') {
      dep.status = 'rejected';

      bot.editMessageText(query.message.text + `\n\n❌ <b>BEKOR QILINDI</b>`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
      });

      bot.sendMessage(dep.userId, `❌ <b>To'lovingiz bekor qilindi.</b>`, { parse_mode: 'HTML' }).catch(() => {});
    }
  }
});

// Barcha boshqa yo'nalishlarni index.html ga yo'naltirish
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(` FlayPay server ${PORT}-portda ishga tushdi`);
});
