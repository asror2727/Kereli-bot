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
    banners: db.banners || [],
    games: db.games || [],
    topUsers: db.topUsers || [],
    reviews: db.reviews || [],
    cardNumber: db.cardNumber || '6262 9102 2412 0022',
    cardHolder: db.cardHolder || 'Q. Z'
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
  const found = /^\d{6,}$/.test(String(playerId).trim());
  res.json({ ok: true, found, nickname: found ? 'Player_' + playerId.slice(-4) : null });
});

// SMS WEBHOOK
const SMS_SECRET_KEY = process.env.SMS_SECRET || 'zohirbek0022';

app.post('/api/sms-receiver', async (req, res) => {
  try {
    const { message, secret } = req.body;
    if (secret !== SMS_SECRET_KEY) {
      return res.status(403).json({ success: false, error: 'Invalid secret' });
    }

    if (!message || message.includes('%SMS_BODY%') || message.includes('%body%')) {
      return res.status(200).json({ success: true, message: 'Test xabari qabul qilindi' });
    }

    const amountMatch = message.match(/(?:karta|to'lov|tushdi|baza|summa|balans)[\s\S]*?([\d\s\.]+)\s*(?:UZS|so'm|sum|сум)/i) || 
                        message.match(/([\d\s\.]+)\s*(?:UZS|so'm|sum|сум)/i) ||
                        message.match(/(\d{3,})/);

    if (!amountMatch) {
      return res.status(200).json({ success: true, message: 'Summa aniqlanmadi' });
    }

    const rawAmount = amountMatch[1].replace(/\s+/g, '').split('.')[0];
    const amount = parseInt(rawAmount, 10);

    if (isNaN(amount) || amount < 100) {
      return res.status(200).json({ success: true, message: 'Noto\'g\'ri summa' });
    }

    let confirmedDeposit = null;

    updateDb((db) => {
      const dep = db.deposits.find(d => d.status === 'pending' && Number(d.amount) === amount);
      if (dep) {
        dep.status = 'confirmed';
        dep.confirmedAt = new Date().toISOString();
        const user = getUser(db, dep.userId);
        user.balance = Number(user.balance || 0) + amount;
        confirmedDeposit = dep;
      }
    });

    if (confirmedDeposit) {
      if (bot) {
        bot.sendMessage(
          confirmedDeposit.userId,
          `✅ **To'lov AVTOMATIK tasdiqlandi!**\n\n💰 **${amount.toLocaleString('uz-UZ')} so'm** balansingizga qo'shildi.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return res.status(200).json({ success: true, message: 'To\'lov avto-tasdiqlandi' });
    } else {
      if (bot && process.env.OWNER_CHAT_ID) {
        bot.sendMessage(
          process.env.OWNER_CHAT_ID,
          `📱 **Kutilmagan SMS tushdi:**\n💰 Summa: **${amount.toLocaleString('uz-UZ')} so'm**\n📝 Matn: \`${message.slice(0, 150)}\``,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return res.status(200).json({ success: true, message: 'Kutilayotgan deposit topilmadi' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// BUYURTMA YARATISH
app.post('/api/orders', async (req, res) => {
  const { userId, userName, gameId, type, packageIndex, playerId } = req.body;
  const db = readDb();
  const game = db.games.find((g) => g.id === gameId);
  if (!game) return res.status(404).json({ ok: false, error: "O'yin topilmadi" });
  
  const pkgList = game.types ? game.types[type] : null;
  const pkg = pkgList ? pkgList[packageIndex] : null;
  if (!pkg) return res.status(404).json({ ok: false, error: 'Paket topilmadi' });

  const user = getUser(db, userId);
  if (Number(user.balance) < Number(pkg.price)) {
    return res.status(400).json({ ok: false, error: 'Balans yetarli emas' });
  }

  const orderId = nanoid(10);
  user.balance -= Number(pkg.price);

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
  const orders = db.orders.filter((o) => String(o.userId) === String(req.params.userId));
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
  const refLink = botUsername ? `https://t.me/${botUsername}?start=${user.refCode}` : user.refCode;
  res.json({ ok: true, refCode: user.refCode, refLink, refCount: user.refCount || 0, refEarned: user.refEarned || 0 });
});

app.listen(PORT, () => {
  console.log(`✅ FlayPay server ${PORT}-portda ishga tushdi`);
});
