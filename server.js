const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ==================== DATABASE ==================== */
let DB = {
  users: {},
  deposits: {} // dep_id: { id, userId, amount, status }
};

/* ==================== SMS RECEIVER ==================== */

app.post('/api/sms-receiver', (req, res) => {
  try {
    // Har qanday kelgan ma'lumotni textga aylantiramiz
    const rawData = JSON.stringify(req.body) + JSON.stringify(req.query);
    console.log(`[SMS KELDI]: ${rawData}`);

    // Agar matn bo'sh bo'lmasa yoki SMS hodisasi bo'lsa
    // Kutilayotgan (pending) statusdagi depositlarni topamiz
    const pendingIds = Object.keys(DB.deposits).filter(id => DB.deposits[id].status === 'pending');

    if (pendingIds.length > 0) {
      // Eng oxirgi kutilayotgan to'lovni olamiz
      const lastDepId = pendingIds[pendingIds.length - 1];
      const deposit = DB.deposits[lastDepId];

      deposit.status = 'confirmed';

      // User balansini oshirish
      if (!DB.users[deposit.userId]) {
        DB.users[deposit.userId] = { id: deposit.userId, balance: 0 };
      }
      DB.users[deposit.userId].balance += deposit.amount;

      console.log(`✅ [AUTO-CONFIRMED] DepID: ${lastDepId} | User: ${deposit.userId} | Summa: ${deposit.amount}`);
    } else {
      console.log('⚠️ [SMS IGNORED] Kutilayotgan (pending) to\'lov topilmadi.');
    }

    // Telefon ilovasiga HAR DOIM 200 OK qaytaramiz
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('SMS Error:', err.message);
    return res.status(200).json({ ok: false });
  }
});

/* ==================== WEBAPP API ENDPOINTS ==================== */

// User balansi
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  if (!DB.users[userId]) {
    DB.users[userId] = { id: userId, balance: 0 };
  }
  res.json({ user: DB.users[userId] });
});

// Depozit yaratish
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

// Polling (HTML ushbu API orqali statusni avto-tekshiradi)
app.get('/api/deposits/:depositId', (req, res) => {
  const deposit = DB.deposits[req.params.depositId];
  if (!deposit) return res.status(404).json({ ok: false });
  res.json({ ok: true, deposit });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`FlayPay Server ${PORT}-portda ishlamoqda`));
