const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios'); // API so'rovlar uchun (npm i axios)

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ==================== DATABASE (IN-MEMORY) ==================== */
let DB = {
  users: {},
  deposits: {},
  orders: [],
  reviews: [],
  config: {
    splashLogo: '/uploads/logo.png',
    musicUrl: '',
    banners: [],
    games: [],
    topUsers: []
  }
};

/* ==================== AUTO P2P CHECKER ==================== */
// Bank/SMS Gateway API orqali tranzaksiyani tekshirish funksiyasi
async function checkRealBankTransaction(cardHolder, amount, checkCode) {
  try {
    /* 
      BU YERGA REAL BANK / MERCHANT API INTEGRATSIYASI ULATILADI:
      Masalan, Click/Payme Merchant API yoki SMS Gateway serveringiz.
      Ushbu so'rov bank billingingizga boradi va oxirgi tushgan to'lovlarni tekshiradi.
    */
    
    // Natijani simulyatsiya qilish (Haqiqiy API berilgan javobni qabul qiladi):
    // const response = await axios.post('YOUR_BANK_OR_GATEWAY_ENDPOINT', { amount, checkCode });
    // return response.data.isPaid; // true yoki false

    return false; // Standart holatda to'lov topilmasa false qaytaradi
  } catch (error) {
    return false;
  }
}

/* ==================== API ENDPOINTS ==================== */

// 1. Konfiguratsiyani olish
app.get('/api/config', (req, res) => {
  res.json(DB.config);
});

// 2. Foydalanuvchi ma'lumotlarini olish
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  if (!DB.users[userId]) {
    DB.users[userId] = { id: userId, balance: 0, refCount: 0, refEarned: 0 };
  }
  res.json({ user: DB.users[userId] });
});

// 3. Avto-P2P To'lov Yaratish
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) return res.status(400).json({ ok: false, error: 'Xato ma\'lumot' });

  const depositId = 'dep_' + Date.now();
  // Unikal to'lov kodi (Masalan foydalanuvchi izohga yozishi uchun)
  const checkCode = Math.floor(1000 + Math.random() * 9000); 

  const newDeposit = {
    id: depositId,
    userId,
    amount: Number(amount),
    checkCode,
    method: method || 'auto_p2p',
    status: 'pending',
    createdAt: new Date()
  };

  DB.deposits[depositId] = newDeposit;

  // SIZGA HECH QANDAY TELEGRAM HABAR BORMAYDI!
  res.json({ ok: true, deposit: newDeposit });
});

// 4. Auto-Deposit Polling (HTML frontend har 3-5 soniyada avto tekshiradi)
app.get('/api/deposits/:depositId', async (req, res) => {
  const depositId = req.params.depositId;
  const deposit = DB.deposits[depositId];

  if (!deposit) return res.status(404).json({ ok: false, error: 'Topilmadi' });

  // Agar to'lov hali kutish holatida bo'lsa, bankizdan avto-tekshiramiz
  if (deposit.status === 'pending') {
    const isPaid = await checkRealBankTransaction(deposit.userId, deposit.amount, deposit.checkCode);

    if (isPaid) {
      deposit.status = 'confirmed';

      // Balansni avtomatik to'ldirish
      if (!DB.users[deposit.userId]) {
        DB.users[deposit.userId] = { id: deposit.userId, balance: 0 };
      }
      DB.users[deposit.userId].balance += deposit.amount;
    }
  }

  res.json({ ok: true, deposit });
});

// 5. Izoh bildirish API
app.post('/api/reviews', (req, res) => {
  const { name, stars, text } = req.body;
  const newReview = { id: 'rev_' + Date.now(), name, stars: Number(stars), text, reactions: {} };
  DB.reviews.unshift(newReview);
  res.json({ ok: true, review: newReview });
});

app.post('/api/reviews/react', (req, res) => {
  const { reviewId, emoji, userId } = req.body;
  const review = DB.reviews.find(r => r.id === reviewId);
  if (review) {
    if (!review.reactions) review.reactions = {};
    if (!review.reactions[emoji]) review.reactions[emoji] = [];
    const idx = review.reactions[emoji].indexOf(userId);
    if (idx > -1) review.reactions[emoji].splice(idx, 1);
    else review.reactions[emoji].push(userId);
  }
  res.json({ ok: true });
});

// 6. Player ID va Buyurtma berish
app.post('/api/check-id', (req, res) => {
  const { playerId } = req.body;
  res.json({ ok: true, found: Boolean(playerId && playerId.length >= 5), nickname: 'Player_' + playerId?.slice(-4) });
});

app.post('/api/orders', (req, res) => {
  const { userId, gameId, type, packageIndex, playerId } = req.body;
  const user = DB.users[userId];
  const game = DB.config.games.find(g => g.id === gameId);
  const pkg = game?.types?.[type]?.[packageIndex];

  if (!user || !pkg || user.balance < pkg.price) {
    return res.status(400).json({ ok: false, error: 'Balans yetarli emas yoki xatolik' });
  }

  user.balance -= pkg.price;
  const order = {
    number: Math.floor(100000 + Math.random() * 900000),
    gameName: game.name,
    packageLabel: pkg.amt,
    price: pkg.price,
    playerId,
    status: 'pending',
    createdAt: new Date()
  };

  DB.orders.unshift({ userId, ...order });
  res.json({ ok: true, balance: user.balance, order });
});

app.get('/api/orders/:userId', (req, res) => {
  res.json({ orders: DB.orders.filter(o => o.userId === req.params.userId) });
});

app.get('/api/referral/:userId', (req, res) => {
  const user = DB.users[req.params.userId] || {};
  res.json({
    refLink: `https://t.me/SizningBotingiz?start=${req.params.userId}`,
    refCount: user.refCount || 0,
    refEarned: user.refEarned || 0
  });
});

/* ==================== SERVER LAUNCH ==================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Avto-P2P Server ishlamoqda: port ${PORT}`));
