require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { readDb, updateDb, getUser } = require('./src/db');
const hyperpin = require('./src/hyperpinClient');
const { initBot, notifyOwnerNewDeposit } = require('./src/bot');

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
// ID TEKSHIRISH (HyperPin orqali, xato bo'lsa oddiy fallback)
// =========================================================
app.post('/api/check-id', async (req, res) => {
  const { gameCode, playerId } = req.body;
  if (!playerId) return res.status(400).json({ ok: false, error: 'ID kiritilmagan' });

  const result = await hyperpin.checkPlayerId({ gameCode, playerId });
  if (result.ok) return res.json(result);

  // HyperPin javob bermasa (masalan endpoint hali sozlanmagan) — demo fallback
  const found = /^\d{6,}$/.test(playerId.trim());
  res.json({ ok: true, found, nickname: found ? `Player_${playerId.slice(-4)}` : null, fallback: true });
});

// =========================================================
// BUYURTMA (XARID)
// =========================================================
app.post('/api/orders', async (req, res) => {
  const { userId, gameId, type, packageIndex, playerId } = req.body;
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

  const order = {
    id: orderId,
    userId,
    gameName: game.name,
    packageLabel: pkg.amt,
    price: pkg.price,
    playerId,
    status: 'processing',
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(order);
  updateDb((d) => { d.orders = db.orders; d.users = db.users; });

  // HyperPin'ga real buyurtma yuborish (adapter hozircha placeholder)
  const hpResult = await hyperpin.createOrder({
    gameCode: game.id,
    playerId,
    packageCode: pkg.amt,
    refId: orderId
  });
  if (!hpResult.ok) {
    console.warn(`HyperPin orderni qabul qilmadi (${orderId}):`, hpResult.error, '— buyurtma "processing" holatida qoladi, admin panelda qo\'lda tekshiring.');
  }

  res.json({ ok: true, order, balance: user.balance });
});

app.get('/api/orders/:userId', (req, res) => {
  const db = readDb();
  const orders = db.orders.filter((o) => o.userId === req.params.userId);
  res.json({ ok: true, orders });
});

// =========================================================
// TO'LDIRISH (DEPOSIT) — karta orqali, admin/bot tasdiqlaydi
// =========================================================
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) return res.status(400).json({ ok: false, error: "Ma'lumot yetarli emas" });

  const deposit = {
    id: nanoid(10),
    userId,
    amount: Number(amount),
    method: method || 'uzcard',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  updateDb((db) => { db.deposits.unshift(deposit); getUser(db, userId); });

  notifyOwnerNewDeposit(bot, deposit);
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
  res.json({ ok: true, refCode: user.refCode, refCount: user.refCount, refEarned: user.refEarned });
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
