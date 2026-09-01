require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { readDb, updateDb, getUser, nextOrderNumber } = require('./src/db');
const { initBot, getBotUsername } = require('./src/bot');

const MIN_DEPOSIT = 1000;
const MAX_DEPOSIT = 3000000;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${nanoid(6)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

const bot = initBot();

// ADMIN AUTH
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Ruxsat yo\'q' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    return res.json({ ok: true, token: password });
  }
  res.status(401).json({ ok: false, error: "Parol noto'g'ri" });
});

// PUBLIC CONFIG
app.get('/api/config', (req, res) => {
  const db = readDb();
  res.json({
    splashLogo: db.splashLogo,
    musicUrl: db.musicUrl,
    banners: db.banners,
    games: db.games,
    topUsers: db.topUsers,
    reviews: db.reviews
  });
});

// USER / BALANCE
app.get('/api/user/:id', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  res.json({ ok: true, user });
});

// ID TEKSHIRISH
app.post('/api/check-id', async (req, res) => {
  const { playerId } = req.body;
  if (!playerId) return res.status(400).json({ ok: false, error: 'ID kiritilmagan' });
  const found = /^\d{6,}$/.test(playerId.trim());
  res.json({ ok: true, found, nickname: null, fallback: true });
});

// =========================================================
// SMS WEBHOOK — AVTO-TASDIQLASH (PHONE + AMOUNT REPAIR)
// =========================================================
const SMS_SECRET_KEY = process.env.SMS_SECRET || 'zohirbek0022';

app.post('/api/sms-receiver', async (req, res) => {
  try {
    const rawMessage = req.body.message || req.body.body || req.body.text || JSON.stringify(req.body);
    const phone = req.body.phone || req.body.from || '';
    const secret = req.body.secret || req.headers['x-secret'];

    console.log('📩 [SMS KELDI]:', rawMessage, 'Phone:', phone);

    if (secret && secret !== SMS_SECRET_KEY) {
      console.warn('⚠️ [SMS] Noto\'g\'ri secret key');
      return res.status(403).json({ success: false, error: 'Invalid secret' });
    }

    const lowerMsg = rawMessage.toLowerCase();
    if (lowerMsg.includes('kod') || lowerMsg.includes('code') || lowerMsg.includes('%sms_body%')) {
      return res.status(200).json({ success: true, message: 'OTP/Test kodi e\'tiborga olinmadi' });
    }

    let amount = 0;
    const amountMatch = rawMessage.match(/(\d[\d\s\.]{2,}\d)\s*(?:UZS|so'm|sum|сум)?/i) || rawMessage.match(/(\d{4,})/);

    if (amountMatch) {
      const cleanNum = amountMatch[1].replace(/[^\d]/g, '');
      amount = parseInt(cleanNum, 10);
    }

    if (!amount || amount < 100) {
      console.log('⚠️ [SMS] Summa aniqlanmadi.');
      return res.status(200).json({ success: true, message: 'Summa topilmadi' });
    }

    console.log(`💰 [SMS PARSED] Summa: ${amount} so'm, Phone: ${phone}`);

    let confirmedDeposit = null;

    updateDb((db) => {
      // 1. Agar Telefon raqam yuborilgan bo'lsa, mos user va summani qidiradi
      if (phone) {
        const cleanPhone = String(phone).replace(/\D/g, '').slice(-9);
        confirmedDeposit = db.deposits.find(d => {
          const userMatch = String(d.userId).includes(cleanPhone);
          return d.status === 'pending' && Number(d.amount) === amount && userMatch;
        });
      }

      // 2. Telefon raqam bo'lmasa yoki topilmasa, summa bo'yicha pending depozitni oladi
      if (!confirmedDeposit) {
        confirmedDeposit = db.deposits.find(d => d.status === 'pending' && Number(d.amount) === amount);
      }

      if (confirmedDeposit) {
        confirmedDeposit.status = 'confirmed';
        confirmedDeposit.confirmedAt = new Date().toISOString();
        const user = getUser(db, confirmedDeposit.userId);
        user.balance = Number(user.balance || 0) + amount;
      }
    });

    if (confirmedDeposit) {
      console.log(`✅ [SMS AUTO] To'lov avto-tasdiqlandi: User ${confirmedDeposit.userId} -> ${amount} so'm`);

      if (bot) {
        bot.sendMessage(
          confirmedDeposit.userId,
          `✅ **To'lov AVTOMATIK tasdiqlandi!**\n\n💰 **${amount.toLocaleString('uz-UZ')} so'm** balansingizga qo'shildi.\n🕐 Vaqt: ${new Date().toLocaleString('uz-UZ')}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return res.status(200).json({ success: true, message: 'To\'lov avto-tasdiqlandi' });
    } else {
      console.log('⚠️ [SMS] Kutilayotgan mos depozit topilmadi.');
      if (bot && process.env.OWNER_CHAT_ID) {
        bot.sendMessage(
          process.env.OWNER_CHAT_ID,
          `📱 **SMS tushdi, lekin mos depozit topilmadi:**\n\n💰 Summa: **${amount.toLocaleString('uz-UZ')} so'm**\n📱 Phone: \`${phone}\`\n📝 Matn: \`${rawMessage.slice(0, 150)}\``,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return res.status(200).json({ success: true, message: 'Kutilayotgan deposit topilmadi' });
    }

  } catch (err) {
    console.error('❌ [SMS ERROR]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// P2P TO'LOV TEKSHIRISH
app.post('/api/p2p-check', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ ok: false, error: 'Telefon kiritilmagan' });

  const db = readDb();
  const normalizedPhone = String(phone).replace(/\D/g, '').slice(-12);

  let foundUser = null;
  for (const [userId, user] of Object.entries(db.users)) {
    if (String(userId).includes(normalizedPhone) || normalizedPhone.includes(String(userId).slice(-10))) {
      foundUser = { userId, user };
      break;
    }
  }

  if (foundUser) {
    res.json({ ok: true, found: true, userId: foundUser.userId, balance: foundUser.user.balance });
  } else {
    res.json({ ok: true, found: false });
  }
});

// BUYURTMA YARATISH
app.post('/api/orders', async (req, res) => {
  const { userId, userName, gameId, type, packageIndex, playerId } = req.body;
  const db = readDb();
  const game = db.games.find((g) => g.id === gameId);
  if (!game) return res.status(404).json({ ok: false, error: "O'yin topilmadi" });
  const pkg = (game.types[type] || [])[packageIndex];
  if (!pkg) return res.status(404).json({ ok: false, error: 'Paket topilmadi' });

  const user = getUser(db, userId);
  if (user.balance < pkg.price) {
    return res.status(400).json({ ok: false, error: 'Balans yetarli emas' });
  }

  const orderId = nanoid(10);
  user.balance -= pkg.price;

  let order;
  updateDb((d) => {
    const number = nextOrderNumber(d);
    order = {
      id: orderId,
      number,
      userId,
      userName: userName || null,
      gameName: game.name,
      packageLabel: pkg.amt,
      price: pkg.price,
      playerId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    d.orders.unshift(order);
    getUser(d, userId).balance = user.balance;
  });

  if (bot && bot._sendOrderNotification) bot._sendOrderNotification(order);

  res.json({ ok: true, order, balance: user.balance });
});

app.get('/api/orders/:userId', (req, res) => {
  const db = readDb();
  const orders = db.orders.filter((o) => o.userId === req.params.userId);
  res.json({ ok: true, orders });
});

// TO'LDIRISH (DEPOSIT)
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) return res.status(400).json({ ok: false, error: "Ma'lumot yetarli emas" });
  const amt = Number(amount);
  if (amt < MIN_DEPOSIT) return res.status(400).json({ ok: false, error: `Minimal to'ldirish miqdori: ${MIN_DEPOSIT.toLocaleString('uz-UZ')} so'm` });
  if (amt > MAX_DEPOSIT) return res.status(400).json({ ok: false, error: `Maksimal to'ldirish miqdori: ${MAX_DEPOSIT.toLocaleString('uz-UZ')} so'm` });

  const deposit = {
    id: nanoid(10),
    userId: String(userId),
    amount: amt,
    method: method || 'uzcard',
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  updateDb((db) => {
    db.deposits.unshift(deposit);
    getUser(db, userId);
  });

  res.json({ ok: true, deposit });
});

app.get('/api/deposits/:id', (req, res) => {
  const db = readDb();
  const deposit = db.deposits.find((d) => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ ok: false });
  res.json({ ok: true, deposit });
});

// REVIEWS
app.post('/api/reviews', (req, res) => {
  const { name, stars, text } = req.body;
  const review = { name: name || 'Mehmon', stars: Math.min(5, Math.max(1, Number(stars) || 5)), text: text || '' };
  updateDb((db) => { db.reviews.unshift(review); db.reviews = db.reviews.slice(0, 30); });
  res.json({ ok: true, review });
});

// REFERRAL
app.get('/api/referral/:userId', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.userId);
  const botUsername = getBotUsername();
  const refLink = botUsername ? `https://t.me/${botUsername}?start=${user.refCode}` : null;
  res.json({ ok: true, refCode: user.refCode, refLink, refCount: user.refCount, refEarned: user.refEarned });
});

// ADMIN PANEL ROUTES
app.post('/api/admin/splash', requireAdmin, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Fayl yo\'q' });
  const url = `/uploads/${req.file.filename}`;
  updateDb((db) => { db.splashLogo = url; });
  res.json({ ok: true, url });
});

app.post('/api/admin/banners/:slot', requireAdmin, upload.single('image'), (req, res) => {
  const slot = Number(req.params.slot);
  if (![0, 1, 2].includes(slot)) return res.status(400).json({ ok: false, error: "Slot 0-2 oralig'ida bo'lishi kerak" });
  const { title, sub } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image;
  updateDb((db) => {
    db.banners[slot] = { image, title: title || '', sub: sub || '' };
  });
  res.json({ ok: true });
});

app.delete('/api/admin/banners/:slot', requireAdmin, (req, res) => {
  const slot = Number(req.params.slot);
  updateDb((db) => { db.banners[slot] = null; });
  res.json({ ok: true });
});

app.post('/api/admin/games', requireAdmin, upload.single('image'), (req, res) => {
  const { name, rating } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image;
  const game = { id: nanoid(8), name, rating: rating || '5 · 0', image, types: { uc: [], prime: [] } };
  updateDb((db) => { db.games.push(game); });
  res.json({ ok: true, game });
});

app.put('/api/admin/games/:id', requireAdmin, upload.single('image'), (req, res) => {
  const { name, rating } = req.body;
  updateDb((db) => {
    const game = db.games.find((g) => g.id === req.params.id);
    if (!game) return;
    if (name) game.name = name;
    if (rating) game.rating = rating;
    if (req.file) game.image = `/uploads/${req.file.filename}`;
  });
  res.json({ ok: true });
});

app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  updateDb((db) => { db.games = db.games.filter((g) => g.id !== req.params.id); });
  res.json({ ok: true });
});

app.post('/api/admin/games/:id/packages', requireAdmin, (req, res) => {
  const { type, icon, amt, price } = req.body;
  updateDb((db) => {
    const game = db.games.find((g) => g.id === req.params.id);
    if (!game) return;
    if (!game.types[type]) game.types[type] = [];
    game.types[type].push({ icon: icon || '🪙', amt, price: Number(price) });
  });
  res.json({ ok: true });
});

app.delete('/api/admin/games/:id/packages/:type/:index', requireAdmin, (req, res) => {
  updateDb((db) => {
    const game = db.games.find((g) => g.id === req.params.id);
    if (!game || !game.types[req.params.type]) return;
    game.types[req.params.type].splice(Number(req.params.index), 1);
  });
  res.json({ ok: true });
});

app.post('/api/admin/top', requireAdmin, (req, res) => {
  const { topUsers } = req.body;
  updateDb((db) => { db.topUsers = topUsers; });
  res.json({ ok: true });
});

app.get('/api/admin/deposits', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, deposits: db.deposits });
});

app.post('/api/admin/deposits/:id/confirm', requireAdmin, (req, res) => {
  updateDb((db) => {
    const dep = db.deposits.find((d) => d.id === req.params.id);
    if (!dep || dep.status !== 'pending') return;
    dep.status = 'confirmed';
    getUser(db, dep.userId).balance += dep.amount;
  });
  res.json({ ok: true });
});

app.post('/api/admin/deposits/:id/reject', requireAdmin, (req, res) => {
  updateDb((db) => {
    const dep = db.deposits.find((d) => d.id === req.params.id);
    if (!dep) return;
    dep.status = 'rejected';
  });
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, orders: db.orders });
});

app.post('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  updateDb((db) => {
    const order = db.orders.find((o) => o.id === req.params.id);
    if (order) order.status = status;
  });
  res.json({ ok: true });
});

app.delete('/api/admin/reviews/:index', requireAdmin, (req, res) => {
  updateDb((db) => { db.reviews.splice(Number(req.params.index), 1); });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ FlayPay server ${PORT}-portda ishga tushdi`);
});
