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

// =========================================================
// ADMIN AUTH — oddiy parol tekshiruvi (kichik biznes uchun yetarli)
// =========================================================
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

// =========================================================
// PUBLIC CONFIG — mini app ochilganda shu yerdan hammasini oladi
// =========================================================
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

// =========================================================
// USER / BALANCE
// =========================================================
app.get('/api/user/:id', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  res.json({ ok: true, user });
});

// =========================================================
// ID TEKSHIRISH — HyperPin bu funksiyani qo'llab-quvvatlamaydi,
// shuning uchun faqat format tekshiruvi (fallback). Xaridor o'zi
// diqqat bilan tekshirishi kerak (frontendda ogohlantirish bor).
// =========================================================
app.post('/api/check-id', async (req, res) => {
  const { playerId } = req.body;
  if (!playerId) return res.status(400).json({ ok: false, error: 'ID kiritilmagan' });
  const found = /^\d{6,}$/.test(playerId.trim());
  res.json({ ok: true, found, nickname: null, fallback: true });
});

// =========================================================
// SMS WEBHOOK — P2P to'lovlar uchun (SMS orqali notifikatsiya)
// =========================================================
app.post('/api/sms-receiver', (req, res) => {
  // SMS Forwarder ilovasi turli fieldlar yuborishi mumkin
  const body = req.body;
  const text = body.text || body.message || body.sms || body.body || body.content || '';
  const phone = body.phone || body.from || body.sender || body.number || '';
  const transactionId = body.transactionId || body.id || Date.now().toString();

  console.log('📱 SMS webhook keldi:', JSON.stringify(body));

  if (!text) return res.status(400).json({ ok: false, error: 'SMS matni bo\'sh' });

  // Summani SMS matnidan avtomatik chiqarish
  // Misol: "100 000 UZS o'tkazildi" yoki "summa: 50000"
  let amount = Number(body.amount) || 0;
  if (!amount) {
    const matches = text.match(/[\d\s]+(?:\.\d+)?(?:\s*(?:so'm|sum|uzs|сум))/i);
    if (matches) {
      amount = parseInt(matches[0].replace(/\s/g, ''), 10);
    } else {
      // Oddiy raqam qidirish (4+ ta raqam)
      const nums = text.match(/\b(\d[\d\s]{3,})\b/g);
      if (nums) amount = parseInt(nums[nums.length - 1].replace(/\s/g, ''), 10);
    }
  }

  console.log(`📱 SMS: phone=${phone}, amount=${amount}, text=${text}`);

  if (!amount || amount < 100) {
    // Summa topilmadi — adminga xabar beramiz, qo'lda ko'radi
    const db = readDb();
    if (bot && process.env.OWNER_CHAT_ID) {
      bot.sendMessage(process.env.OWNER_CHAT_ID, `📱 SMS keldi, summa aniqlanmadi:\n\n📞 ${phone}\n📝 ${text}\n\nQo'lda tekshiring!`).catch(() => {});
    }
    return res.json({ ok: true, message: 'SMS qabul qilindi, summa aniqlanmadi — adminga xabar yuborildi' });
  }

  // Foydalanuvchini telefon orqali topish
  updateDb((db) => {
    const normalizedPhone = String(phone).replace(/\D/g, '').slice(-9);
    let found = false;

    for (const [userId, user] of Object.entries(db.users)) {
      const userPhone = String(userId).replace(/\D/g, '').slice(-9);
      if (userPhone === normalizedPhone || String(userId).slice(-9) === normalizedPhone) {
        user.balance += amount;
        found = true;
        db.deposits.unshift({
          id: transactionId,
          userId,
          amount,
          method: 'p2p_sms',
          status: 'confirmed',
          createdAt: new Date().toISOString()
        });
        if (bot) {
          bot.sendMessage(userId, `✅ To'lov tasdiqlandi!\n💰 ${amount.toLocaleString('uz-UZ')} so'm balansingizga tushdi.`).catch(() => {});
        }
        break;
      }
    }

    if (!found && bot && process.env.OWNER_CHAT_ID) {
      bot.sendMessage(process.env.OWNER_CHAT_ID,
        `📱 SMS to'lov keldi, foydalanuvchi topilmadi:\n\n📞 ${phone}\n💰 ${amount.toLocaleString('uz-UZ')} so'm\n📝 ${text}`
      ).catch(() => {});
    }
  });

  res.json({ ok: true, message: 'SMS qabul qilindi', amount });
});

// =========================================================
// P2P TO'LOV (CARD 2 CARD) — avtomatik hisob aniqlash
// =========================================================
app.post('/api/p2p-check', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ ok: false, error: 'Telefon raqami kiritilmagan' });

  const db = readDb();
  const normalizedPhone = String(phone).replace(/\D/g, '').slice(-12);

  // Telefon raqamiga mos hisob topish
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
    res.json({ ok: true, found: false, message: 'Foydalanuvchi topilmadi — SMS orqali yangi hisob yaratiladi' });
  }
});

// =========================================================
// BUYURTMA (XARID) — "pending" holatda yaratiladi, adminga
// botdan to'liq ma'lumot bilan xabar boradi, admin tasdiqlaydi/
// bekor qiladi (bekor qilinsa mablag' avtomatik qaytariladi).
// =========================================================
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

// =========================================================
// TO'LDIRISH (DEPOSIT) — karta orqali, admin(lar) tasdiqlaydi
// =========================================================
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) return res.status(400).json({ ok: false, error: "Ma'lumot yetarli emas" });
  const amt = Number(amount);
  if (amt < MIN_DEPOSIT) return res.status(400).json({ ok: false, error: `Minimal to'ldirish miqdori: ${MIN_DEPOSIT.toLocaleString('uz-UZ')} so'm` });
  if (amt > MAX_DEPOSIT) return res.status(400).json({ ok: false, error: `Maksimal to'ldirish miqdori: ${MAX_DEPOSIT.toLocaleString('uz-UZ')} so'm` });

  const deposit = {
    id: nanoid(10),
    userId,
    amount: Number(amount),
    method: method || 'uzcard',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  updateDb((db) => { db.deposits.unshift(deposit); getUser(db, userId); });

  if (bot && bot._sendDepositNotification) bot._sendDepositNotification(deposit);
  res.json({ ok: true, deposit });
});

app.get('/api/deposits/:id', (req, res) => {
  const db = readDb();
  const deposit = db.deposits.find((d) => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ ok: false });
  res.json({ ok: true, deposit });
});

// =========================================================
// FIKR (REVIEW)
// =========================================================
app.post('/api/reviews', (req, res) => {
  const { name, stars, text } = req.body;
  const review = { name: name || 'Mehmon', stars: Math.min(5, Math.max(1, Number(stars) || 5)), text: text || '' };
  updateDb((db) => { db.reviews.unshift(review); db.reviews = db.reviews.slice(0, 30); });
  res.json({ ok: true, review });
});

// =========================================================
// REFERAL
// =========================================================
app.get('/api/referral/:userId', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.userId);
  const botUsername = getBotUsername();
  const refLink = botUsername ? `https://t.me/${botUsername}?start=${user.refCode}` : null;
  res.json({ ok: true, refCode: user.refCode, refLink, refCount: user.refCount, refEarned: user.refEarned });
});

// =========================================================
// ===================  A D M I N   P A N E L  ===============
// =========================================================

// ---- Splash logo ----
app.post('/api/admin/splash', requireAdmin, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Fayl yo\'q' });
  const url = `/uploads/${req.file.filename}`;
  updateDb((db) => { db.splashLogo = url; });
  res.json({ ok: true, url });
});

// ---- Banners (qat'iy 3 slot: 0,1,2) ----
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

// ---- Games ----
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

// ---- Game packages (UC / Prime paketlari) ----
app.post('/api/admin/games/:id/packages', requireAdmin, (req, res) => {
  const { type, icon, amt, price } = req.body; // type: 'uc' | 'prime'
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

// ---- Top xaridorlar (admin qo'lda kiritadi yoki avto hisoblanadi) ----
app.post('/api/admin/top', requireAdmin, (req, res) => {
  const { topUsers } = req.body; // to'liq massiv almashtiriladi
  updateDb((db) => { db.topUsers = topUsers; });
  res.json({ ok: true });
});

// ---- Deposits: ro'yxat + qo'lda tasdiqlash (bot orqali ham bo'ladi) ----
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

// ---- Orders (admin ko'rish uchun) ----
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

// ---- Reviews (admin o'chira oladi) ----
app.delete('/api/admin/reviews/:index', requireAdmin, (req, res) => {
  updateDb((db) => { db.reviews.splice(Number(req.params.index), 1); });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ FlayPay server ${PORT}-portda ishga tushdi`);
  console.log(`   Sayt:  http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin.html`);
});
