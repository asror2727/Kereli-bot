const HYPERPIN_API_KEY = process.env.HYPERPIN_API_KEY || 'hp_0bd4dfa6e45e4131db94f2492b2807cd';
const BASE_URL = 'https://api.hyperpin.top/api/v1';

async function createOrder(playerId, productId) {
  // 10 soniyada javob kelmasa so'rovni majburan to'xtatish (qotib qolmaslik uchun)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HYPERPIN_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        player_id: String(playerId),
        product_id: productId
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, message: data.message || `Xatolik kodi: ${response.status}` };
    }

    return { success: true, data };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: "HyperPin serveri juda sekin javob berdi (Timeout)!" };
    }
    return { success: false, message: "HyperPin bilan ulanib bo'lmadi: " + error.message };
  }
}

module.exports = { createOrder };
