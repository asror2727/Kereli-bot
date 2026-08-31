const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Statik fayllar va upload papkasi
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Multer sozlamasi (fayl/rasm yuklash uchun)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const DB_FILE = path.join(__dirname, 'db.json');

// O'zgaruvchilar
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = process.env.ADMIN_ID || '123456789';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Bazani o'qish va yozish
function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initData = {
      config: { splashLogo: '', banners: [null, null, null], games: [], topUsers: [], reviews: [] },
      users: {},
      deposits: [],
      orders: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initData, null, 2));
    return initData;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ------------------- API ENDPOINTS -------------------

// Config va User ma'lumotlari
app.get('/api/config', (req, res) => {
  const db = readDb();
  res.json(db.config);
});

app.get('/api/user/:id', (req, res) => {
  const db = readDb();
  const userId = req.params.id;
  if (!db.users[userId]) {
    db.users[userId] = { id: userId, balance: 0, refCount: 0, refEarned: 0 };
    writeDb(db);
  }
  res.json({ user: db.users[userId] });
});

// Depozit yaratish va holatini tekshirish
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  const db = readDb();

  const deposit = {
    id: 'dep_' + Date.now(),
    userId: String(userId),
    amount: Number(amount),
    method: method || 'uzcard',
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  db.deposits.push(deposit);
  writeDb(db);

  console.log(`[DEPOSIT CREATED] User: ${userId}, Amount: ${amount}`);
  res.json({ ok: true, deposit });
});

app.get('/api/deposits/:id', (req, res) => {
  const db = readDb();
  const dep = db.deposits.find(d => d.id === req.params.id);
  if (!dep) return res.json({ ok: false, message: 'Deposit topilmadi' });
  res.json({ ok: true, deposit: dep });
});

// SMS RECEIVER - AVTO-TO'LOV
app.post('/api/sms-receiver', (req, res) => {
  try {
    const bodyText = req.body.message || JSON.stringify(req.body);
    console.log('[SMS RAW KELDI]:', bodyText);

    const lowerText = bodyText.toLowerCase();
    if (lowerText.includes('kod') || lowerText.includes('code') || lowerText.includes('o\'tkazilmoqda') || lowerText.includes('otkazilmoqda')) {
      console.log('⚠️ [SMS IGNORED] Bu OTP tasdiqlash kodi.');
      return res.status(200).json({ success: false, message: 'OTP Ignored' });
    }

    const amountMatches = bodyText.match(/(\d[\d\s\.]{2,}\d)\s*(sum|so'm|uzs)?/i);
    let amount = 0;

    if (amountMatches) {
      const cleanNum = amountMatches[1].replace(/[^\d]/g, '');
      amount = parseInt(cleanNum, 10);
    }

    if (!amount || amount <= 0) {
      return res.status(200).json({ success: false, message: 'Summa topilmadi' });
    }

    const db = readDb();
    let depIndex = db.deposits.findIndex(d => d.status === 'pending' && Number(d.amount) === amount);

    if (depIndex === -1) {
      console.log('⚠️ [SMS] Kutilayotgan deposit topilmadi.');
      return res.status(200).json({ success: false, message: 'Deposit matching failed' });
    }

    const dep = db.deposits[depIndex];
    dep.status = 'confirmed';
    dep.confirmedAt = new Date().toISOString();

    if (!db.users[dep.userId]) {
      db.users[dep.userId] = { id: dep.userId, balance: 0, refCount: 0, refEarned: 0 };
    }

    db.users[dep.userId].balance += amount;
    writeDb(db);

    console.log(`✅ [SMS AUTO] Depozit tasdiqlandi: User ${dep.userId} -> ${amount} so'm`);

    // Userga xabar
    bot.sendMessage(
      dep.userId,
      `✅ *To'lovingiz tasdiqlandi!*\n\n💰 Summa: ${amount.toLocaleString('uz-UZ')} so'm\nBalansingizga qo'shildi.`,
      { parse_mode: 'Markdown' }
    ).catch(err => console.error("User xabar xatosi:", err));

    // Adminga xabar
    bot.sendMessage(
      ADMIN_ID,
      `⚡ *AVTO-TO'LOV TASDIQLANDI*\n\n👤 *User ID:* \`${dep.userId}\`\n💵 *Summa:* ${amount.toLocaleString('uz-UZ')} so'm\n🆔 *Depozit ID:* \`${dep.id}\`\n Status: Bazaga qo'shildi`,
      { parse_mode: 'Markdown' }
    ).catch(err => console.error("Admin xabar xatosi:", err));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[SMS RECEIVER ERROR]:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
});

// Buyurtmalar va Sharhlar
app.post('/api/orders', (req, res) => {
  const { userId, gameId, type, packageIndex, playerId } = req.body;
  const db = readDb();

  const user = db.users[userId];
  if (!user) return res.json({ ok: false, error: 'Foydalanuvchi topilmadi' });

  const game = db.config.games.find(g => g.id === gameId);
  if (!game) return res.json({ ok: false, error: 'O\'yin topilmadi' });

  const pkg = (game.types[type] || [])[packageIndex];
  if (!pkg) return res.json({ ok: false, error: 'Paket topilmadi' });

  if (user.balance < pkg.price) {
    return res.json({ ok: false, error: 'Balans yetarli emas' });
  }

  user.balance -= pkg.price;

  const order = {
    id: 'ord_' + Date.now(),
    number: Math.floor(100000 + Math.random() * 900000),
    userId,
    gameName: game.name,
    packageLabel: pkg.amt,
    price: pkg.price,
    playerId,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  db.orders.unshift(order);
  writeDb(db);

  bot.sendMessage(
    ADMIN_ID,
    `📥 *Yangi buyurtma!*\n\nO'yin: ${game.name}\nPaket: ${pkg.amt}\nNarxi: ${pkg.price} so'm\nPlayer ID: \`${playerId}\`\nUser: ${userId}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  res.json({ ok: true, balance: user.balance, order });
});

app.get('/api/orders/:userId', (req, res) => {
  const db = readDb();
  const userOrders = db.orders.filter(o => String(o.userId) === String(req.params.userId));
  res.json({ orders: userOrders });
});

app.get('/api/referral/:userId', (req, res) => {
  const db = readDb();
  const user = db.users[req.params.userId] || { refCount: 0, refEarned: 0 };
  res.json({
    refCode: `https://t.me/FlayPayBot?start=${req.params.userId}`,
    refLink: `https://t.me/FlayPayBot?start=${req.params.userId}`,
    refCount: user.refCount || 0,
    refEarned: user.refEarned || 0
  });
});

app.post('/api/reviews', (req, res) => {
  const { name, stars, text } = req.body;
  const db = readDb();
  const newReview = { name: name || 'Mijoz', stars: stars || 5, text: text || 'A\'lo xizmat!' };
  db.config.reviews.unshift(newReview);
  writeDb(db);
  res.json({ review: newReview });
});

// ------------------- ADMIN PANEL API ENDPOINTS -------------------

app.post('/api/admin/config', upload.single('splashLogo'), (req, res) => {
  const db = readDb();
  if (req.file) {
    db.config.splashLogo = '/uploads/' + req.file.filename;
  }
  if (req.body.config) {
    try {
      const parsed = JSON.parse(req.body.config);
      db.config = { ...db.config, ...parsed };
    } catch (e) {}
  }
  writeDb(db);
  res.json({ ok: true, config: db.config });
});

app.post('/api/admin/banner', upload.single('banner'), (req, res) => {
  const index = parseInt(req.body.index, 10);
  const db = readDb();
  if (req.file && index >= 0 && index < 3) {
    db.config.banners[index] = '/uploads/' + req.file.filename;
    writeDb(db);
  }
  res.json({ ok: true, banners: db.config.banners });
});

// ------------------- TELEGRAM BOT HANDLERS -------------------

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Xush kelibsiz! O'yinlarga valyuta va paketlarni xarid qilish uchun quyidagi tugmani bosing:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Mini App-ni ochish", web_app: { url: "https://flaypay.uz" } }]
        ]
      }
    }
  );
});

// SERVERNI ISHGA TUSHIRISH
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server ${PORT}-portda ishga tushdi`);
});
