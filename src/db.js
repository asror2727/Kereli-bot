// Oddiy fayl-baza. Hech qanday DB o'rnatish shart emas — hammasi
// data/db.json ichida saqlanadi, server qayta ishga tushsa ham
// (Render qayta deploy qilsa ham) ma'lumotlar yo'qolmaydi.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DB = {
  splashLogo: null, // admin panelda yuklanadigan logo (data URL yoki /uploads/... yo'li)
  musicUrl: null, // admin yuklagan musiqa fayli — bo'sh bo'lsa standart musiqa ishlatiladi
  banners: [null, null, null], // qat'iy 3 ta slot
  games: [],
  topUsers: [],
  reviews: [
    { name: 'Sardor_Gamer', stars: 5, text: "UC juda tez tushdi, raxmat!" }
  ],
  orders: [],
  deposits: [], // to'lov so'rovlari (tasdiq kutayotgan/tasdiqlangan/bekor)
  users: {}, // telegramId -> { balance, referredBy, refCode, refCount, refEarned }
  botStarted: false
};

function ensureDb() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return { ...DEFAULT_DB, ...JSON.parse(raw) };
  } catch (e) {
    console.error('db.json buzilgan, standart qiymatlar bilan tiklandi:', e);
    return { ...DEFAULT_DB };
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Bitta obyekt ustida xavfsiz o'zgartirish kiritish uchun helper
function updateDb(mutatorFn) {
  const db = readDb();
  const result = mutatorFn(db);
  writeDb(db);
  return result !== undefined ? result : db;
}

function getUser(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      balance: 0,
      refCode: 'OLOV-' + String(userId).slice(-6),
      referredBy: null,
      refCount: 0,
      refEarned: 0
    };
  }
  return db.users[userId];
}

module.exports = { readDb, writeDb, updateDb, getUser, DB_PATH };
