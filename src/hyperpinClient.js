const HYPERPIN_API_KEY = process.env.HYPERPIN_API_KEY || 'hp_0bd4dfa6e45e4131db94f2492b2807cd';
const BASE_URL = 'https://api.hyperpin.top/api/v1';

// 1. HyperPin mahsulotlar ro'yxatini olish (Product ID larni ko'rish uchun)
async function getProducts() {
  try {
    const response = await fetch(`${BASE_URL}/products`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${HYPERPIN_API_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP xato: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("HyperPin Products API Error:", error.message);
    return null;
  }
}

// 2. Buyurtma berish (Order Endpoint)
async function createOrder(playerId, productId) {
  try {
    const response = await fetch(`${BASE_URL}/orders`, { // Agar /orders o'xshamasa /order deb sinab ko'ring
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HYPERPIN_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        player_id: String(playerId),
        product_id: productId
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("HyperPin Response Error:", data);
      return { success: false, message: data.message || `Xatolik kodi: ${response.status}` };
    }

    return { success: true, data };
  } catch (error) {
    console.error("HyperPin Connection Error:", error.message);
    return { success: false, message: "HyperPin serveriga bog'lanishda xatolik!" };
  }
}

module.exports = { getProducts, createOrder };
