// =====================================================================
// HYPERPIN API ADAPTER
// =====================================================================
// MUHIM: HyperPin (hyperpin.top) ochiq/umumiy hujjatlari internetda
// topilmadi — ular reseller kabinetingiz ichida (login qilingandan
// keyin) bo'lishi kerak. Shuning uchun quyidagi endpoint yo'llari
// ("/check-id", "/order", "/products", "/balance") ODDIY REST
// KONVENSIYASIGA asoslangan NAMUNA — ular ishlashi uchun haqiqiy
// hujjatdagi yo'llar va javob formatiga moslab bittagina joyni
// (pastdagi funksiyalar ichini) to'g'irlash kerak bo'ladi.
//
// Reseller kabinetingizdan quyidagilarni topib menga yuboring:
//  1) Balansni tekshirish endpointi
//  2) Mahsulotlar/paketlar ro'yxati endpointi (yoki ular sizda qo'lda
//     kiritilyaptimi — hozir shunday qilib qo'ydim, chunki xavfsizroq)
//  3) O'yinchi ID/nik tekshirish endpointi
//  4) Buyurtma (xarid) yaratish endpointi va uning javobi
// Shundan keyin bu faylni bitta so'rov bilan aniq moslab beraman.
// =====================================================================

const axios = require('axios');

const BASE_URL = process.env.HYPERPIN_API_URL || 'https://api.hyperpin.top/api/v1';
const API_KEY = process.env.HYPERPIN_API_KEY || '';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
});

/**
 * O'yinchi ID/nikini tekshirish (masalan PUBG ID mavjudligini).
 * TODO: haqiqiy endpoint yo'li va so'rov shaklini hujjatga moslang.
 */
async function checkPlayerId({ gameCode, playerId }) {
  try {
    const { data } = await client.get('/check-id', {
      params: { game: gameCode, id: playerId }
    });
    // Kutilayotgan javob shakli taxminiy: { found: true, nickname: "..." }
    return { ok: true, found: !!data.found, nickname: data.nickname || null };
  } catch (err) {
    console.error('HyperPin checkPlayerId xato:', err.response?.data || err.message);
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Buyurtma (UC/Gold/Almaz xaridi) yaratish.
 * TODO: haqiqiy endpoint yo'li va parametr nomlarini hujjatga moslang.
 */
async function createOrder({ gameCode, playerId, packageCode, refId }) {
  try {
    const { data } = await client.post('/order', {
      game: gameCode,
      player_id: playerId,
      package: packageCode,
      ref_id: refId // o'zimizdagi buyurtma ID, keyin status so'rash uchun
    });
    return { ok: true, orderId: data.order_id || data.id, status: data.status || 'processing' };
  } catch (err) {
    console.error('HyperPin createOrder xato:', err.response?.data || err.message);
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Buyurtma holatini tekshirish.
 * TODO: haqiqiy endpoint yo'lini hujjatga moslang.
 */
async function getOrderStatus(orderId) {
  try {
    const { data } = await client.get(`/order/${orderId}`);
    return { ok: true, status: data.status };
  } catch (err) {
    console.error('HyperPin getOrderStatus xato:', err.response?.data || err.message);
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * HyperPin balansingizni tekshirish (ixtiyoriy, admin panel uchun foydali).
 * TODO: haqiqiy endpoint yo'lini hujjatga moslang.
 */
async function getMyBalance() {
  try {
    const { data } = await client.get('/balance');
    return { ok: true, balance: data.balance };
  } catch (err) {
    console.error('HyperPin getMyBalance xato:', err.response?.data || err.message);
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

module.exports = { checkPlayerId, createOrder, getOrderStatus, getMyBalance };
