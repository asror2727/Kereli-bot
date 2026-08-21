const axios = require('axios');

const API_KEY = process.env.HYPERPIN_API_KEY || 'hp_0bd4dfa6e45e4131db94f2492b2807cd';
const BASE_URL = 'https://api.hyperpin.top/api/v1';

async function createOrder(playerId, productId) {
  try {
    const response = await axios.post(`${BASE_URL}/orders`, {
      player_id: String(playerId),
      product_id: productId
    }, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 7000 // 7 soniyada javob kelmasa majburiy to'xtatadi
    });

    return { success: true, data: response.data };
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return { success: false, message: "HyperPin API juda sekin javob berdi (Timeout)" };
    }
    const errorMsg = error.response?.data?.message || error.message;
    return { success: false, message: `HyperPin xatosi: ${errorMsg}` };
  }
}

module.exports = { createOrder };
