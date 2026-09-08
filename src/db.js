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

function readDb() {
  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      return { ...defaultDb };
    }
    const raw = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('❌ DB o\'qishda xatolik:', err);
    return { ...defaultDb };
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
  nextOrderNumber
};
