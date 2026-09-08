const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'db.json');

const defaultDb = {
  splashLogo: '/uploads/default-logo.jpg',
  musicUrl: null,
  banners: [null, null, null],
  games: [],
  topUsers: [],
  reviews: [],
  users: {},
  orders: [],
  deposits: [],
  admins: [],
  orderCounter: 1000
};

// TOP 10 Xaridorlarni har safar bazadan hisoblash funksiyasi
function calculateTopUsers(db) {
  const userTotals = {};

  if (Array.isArray(db.orders)) {
    db.orders.forEach((o) => {
      if (o && o.status !== 'rejected' && o.status !== 'cancelled') {
        const uId = String(o.userId || '0');
        const uName = o.userName || (db.users && db.users[uId] && db.users[uId].name) || `User ${uId}`;
        
        if (!userTotals[uId]) {
          userTotals[uId] = { name: uName, totalSpent: 0, ordersCount: 0 };
        }
        userTotals[uId].totalSpent += Number(o.price || 0);
        userTotals[uId].ordersCount += 1;
      }
    });
  }

  const sorted = Object.values(userTotals)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // Agarda buyurtmalar hali yo'q bo me'yoriy bo'sh xabar bermaslik uchun
  return sorted.map((u, index) => {
    const formattedPrice = `${u.totalSpent.toLocaleString('uz-UZ')} so'm`;
    return {
      rank: index + 1,
      rankNo: index + 1,
      id: index + 1,
      name: u.name || 'Foydalanuvchi',
      userName: u.name || 'Foydalanuvchi',
      spent: formattedPrice,
      totalSpent: u.totalSpent,
      amount: formattedPrice,
      sum: formattedPrice,
      price: formattedPrice,
      ordersCount: u.ordersCount,
      count: u.ordersCount
    };
  });
}

function readDb() {
  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      return { ...defaultDb, topUsers: [] };
    }
    const raw = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    
    // Har o'qilganda TOP foydalanuvchilarni xatolarsiz qayta hisoblaydi
    parsed.topUsers = calculateTopUsers(parsed);
    return parsed;
  } catch (err) {
    console.error('❌ DB o\'qishda xatolik:', err);
    return { ...defaultDb, topUsers: [] };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ DB saqlashda xatolik:', err);
  }
}

function updateDb(fn) {
  const db = readDb();
  fn(db);
  db.topUsers = calculateTopUsers(db);
  writeDb(db);
  return db;
}

function getUser(db, userId) {
  const idStr = String(userId);
  if (!db.users[idStr]) {
    db.users[idStr] = {
      balance: 0,
      refCode: nanoid(6),
      referredBy: null,
      refCount: 0,
      refEarned: 0,
      name: `User ${idStr}`
    };
  }
  return db.users[idStr];
}

function nextOrderNumber(db) {
  if (!db.orderCounter) db.orderCounter = 1000;
  db.orderCounter += 1;
  return db.orderCounter;
}

module.exports = {
  readDb,
  writeDb,
  updateDb,
  getUser,
  nextOrderNumber,
  calculateTopUsers
};
