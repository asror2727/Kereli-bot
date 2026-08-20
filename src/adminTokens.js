// Bot orqali "/admin" bosilganda bir martalik login link yaratish uchun.
// Xotirada saqlanadi (server qayta ishga tushsa tozalanadi — bu normal,
// chunki tokenlar baribir 5 daqiqada eskiradi).

const tokens = new Map(); // token -> { expiresAt, used }

function generateToken() {
  const token = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
  tokens.set(token, { expiresAt: Date.now() + 5 * 60 * 1000, used: false });
  return token;
}

function verifyAndConsume(token) {
  const entry = tokens.get(token);
  if (!entry) return false;
  if (entry.used || Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return false;
  }
  entry.used = true;
  tokens.delete(token); // bir martalik — ishlatilgach darhol o'chadi
  return true;
}

module.exports = { generateToken, verifyAndConsume };
