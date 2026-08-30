const express = require('express');
const cors = require('cors');
const path = require('path');
const { Telegraf } = require('telegraf');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // SMS Forwarder ba'zan Form Data yuboradi
app.use(express.static(path.join(__dirname, 'public')));

/* ==================== CONFIGURATION ==================== */
const SECRET_KEY = 'zohirbek0022'; // Telefondagi secret kalitingiz
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE'; 

const bot = new Telegraf(BOT_TOKEN);

/* ==================== DATABASE ==================== */
let DB = {
  users: {},
  deposits: {}, // { dep_id: { userId, amount, status } }
  pendingDeposits: [] // Ishlov berilmagan to'lovlar ro'yxati
};

/* ==================== SMS RECEIVER ENDPOINT ==================== */

// SMS Forwarder aynan ushbu API ga POST yuboradi
app.post('/api/sms-receiver', (req, res) => {
  try {
    // SMS Forwarder body yoki query orqali yuborgan ma'lumotni olamiz
    const secret = req.body.secret || req.query.secret;
    const smsContent = req.body.message || req.body.text || req.body.sms || '';

    console.log(`[SMS KELDI]: ${smsContent}`);

    // 1. Secret kalitni tekshirish
    if (secret !== SECRET_KEY) {
      console.log('[SMS XATO]: Secret key mos kelmadi!');
      return res.status(403).json({ ok: false, error: 'Unauthorized secret key' });
    }

    // 2. SMS matnidan summani ajratib olish (Masalan: "Tushgan summa: 2820 so'm" yoki "Popolnenie: 50000 UZS")
    const amountMatch = smsContent.match(/(?:tushgan summa|popolnenie|summa|vosxod|karta):\s*([\d\s]+)/i) || 
                        smsContent.match(/([\d\s]{4,})\s*(?:so'm|uzs|sum)/i);

    if (amountMatch) {
      // Bo'shliqlarni olib tashlab raqamga o'giramiz
      const parsedAmount = parseInt(amountMatch[1].replace(/\s/g, ''), 10);
      console.log(`[SMS PARSED] Tushgan summa: ${parsedAmount} so'm`);

      // 3. Kutilayotgan depositlar orasidan mos keladiganini topish (Kutilayotgan summa bo'yicha)
      const matchingDepId = Object.keys(DB.deposits).find(id => {
        return DB.deposits[id].status === 'pending' && DB.deposits[id].amount === parsedAmount;
      });

      if (matchingDepId) {
        const deposit = DB.deposits[matchingDepId];
        deposit.status = 'confirmed';

        // Foydalanuvchi balansini oshirish
        if (!DB.users[deposit.userId]) {
          DB.users[deposit.userId] = { id: deposit.userId, balance: 0 };
        }
        DB.users[deposit.userId].balance += parsedAmount;

        console.log(`[AVTO-TASDIQLANDI]: User ${deposit.userId} balansiga ${parsedAmount} so'm qo'shildi!`);
        
        // Telegram orqali foydalanuvchiga xabar
        try {
          bot.telegram.sendMessage(deposit.userId, `✅ **To'lovingiz qabul qilindi!**\nBalansga **${parsedAmount.toLocaleString()} so'm** qo'shildi.`, { parse_mode: 'Markdown' });
        } catch (e) {}
      } else {
        console.log('[SMS ON-HOLD]: Summa bo\'yicha kutilayotgan deposit topilmadi.');
      }
    }

    // TELEFON ILOVASIGA HAR DOIM HTTP 200 OK QAYTARISH SHART (Xatolik bermasligi uchun)
    return res.status(200).json({ ok: true, message: 'SMS processed successfully' });

  } catch (error) {
    console.error('[SMS ERROR]:', error.message);
    // Xatolik bo'lsa ham 200 qaytaramiz, aks holda telefon qayta-qayta yuboraveradi
    return res.status(200).json({ ok: false, error: error.message });
  }
});

/* ==================== WEBAPP API ENDPOINTS ==================== */

// Foydalanuvchi balansini olish
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  if (!DB.users[userId]) {
    DB.users[userId] = { id: userId, balance: 0 };
  }
  res.json({ user: DB.users[userId] });
});

// To'lov yaratish
app.post('/api/deposits', (req, res) => {
  const { userId, amount } = req.body;
  const depositId = 'dep_' + Date.now();

  DB.deposits[depositId] = {
    id: depositId,
    userId,
    amount: Number(amount),
    status: 'pending',
    createdAt: new Date()
  };

  res.json({ ok: true, deposit: DB.deposits[depositId] });
});

// To'lov holatini tekshirish (Polling)
app.get('/api/deposits/:depositId', (req, res) => {
  const deposit = DB.deposits[req.params.depositId];
  if (!deposit) return res.status(404).json({ ok: false });
  res.json({ ok: true, deposit });
});

/* ==================== SERVER LAUNCH ==================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`FlayPay server ${PORT}-portda ishga tushdi`);
  bot.launch().catch(err => console.error('Bot launch err:', err));
});
