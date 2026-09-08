const fs = require('fs');
const path = path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DB = {
  splashLogo: null,
  musicUrl: null,
  banners: [null, null, null],
  games: [],
  topUsers: [],
  reviews: [
    { name: 'Sardor_Gamer', stars: 5, text: "UC juda tez tushdi, raxmat!" }
  ],
  orders: [],
  orderCounter: 67000,
  deposits: [],
  users: {},
  admins: [],
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
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
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

function updateDb(mutatorFn) {
  const db = readDb();
  const result = mutatorFn(db);
  writeDb(db);
  return result !== undefined ? result : db;
}

function getUser(db, userId) {
  const idStr = String(userId);
  if (!db.users[idStr]) {
    db.users[idStr] = {
      balance: 0,
      refCode: 'FLAY-' + idStr.slice(-6),
      referredBy: null,
      refCount: 0,
      refEarned: 0
    };
  }
  return db.users[idStr];
}

function nextOrderNumber(db) {
  db.orderCounter = (db.orderCounter || 67000) + 1;
  return db.orderCounter;
}

module.exports = { readDb, writeDb, updateDb, getUser, nextOrderNumber, DB_PATH };
