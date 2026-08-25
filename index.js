const express = require('express');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());

const bot = new Telegraf(process.env.BOT_TOKEN);
const SMS_SECRET_KEY = process.env.SMS_SECRET || "SeningMaxfiyKaliting123!"; 

// Telefondagi SMS Forwarder ilovasi uchun yagona POST route
app.post('/api/sms-receiver', async (req, res) => {
  try {
    const { message, secret } = req.body;

    console.log("[SMS ARRIVED]:", message);

    // 1. Secret key tekshiruvi (Begonalar soxta so'rov yubormasligi uchun)
    if (secret !== SMS_SECRET_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // 2. Uzcard/Humo SMS xabaridan summani ajratib olish (Regex)
    // Masalan: "8600****1234 kartangizga 15600.00 UZS tushdi"
    const amountMatch = message ? message.match(/(\d[\d\s\.]*)\s*UZS/i) : null;

    if (amountMatch) {
      // Probel va nuqtalarni tozalash (15 600.00 -> 15600)
      const cleanAmountStr = amountMatch[1].replace(/\s/g, '').split('.')[0];
      const receivedAmount = parseInt(cleanAmountStr, 10);

      console.log(`[SMS KELDI] Tushgan summa: ${receivedAmount} so'm`);
      
      // SHU YERGA MongoDB / Bazangizdan to'lovni tekshirib balans to'ldirish kodi tushadi
    }

    // Telefonga muvaffaqiyatli javob qaytarish
    return res.status(200).json({ success: true, message: "OK" });

  } catch (err) {
    console.error('SMS processing error:', err);
    return res.status(500).json({ success: false });
  }
});

// Render uchun Port eshituvchi
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishlamoqda...`);
});
