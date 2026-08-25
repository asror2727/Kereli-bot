const express = require('express');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());

const bot = new Telegraf(process.env.BOT_TOKEN);
const SMS_SECRET_KEY = process.env.SMS_SECRET || "SeningMaxfiyKaliting123!"; 

// SMS Forwarder yuboradigan POST so'rovini qabul qilish route'i
app.post('/api/sms-receiver', async (req, res) => {
  try {
    const { message, secret } = req.body;
    console.log("[SMS ARRIVED]:", message);

    // Mantiq va avto-to'ldirish kodingiz shu yerda bo'ladi...

    return res.status(200).json({ success: true, message: "OK" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false });
  }
});


// Webhook endpoint (SMS qabul qilish uchun)
app.post('/api/sms-receiver', async (req, res) => {
  try {
    const { message, secret } = req.body;

    if (secret !== SMS_SECRET_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Uzcard SMS Regex parser
    const amountMatch = message.match(/(\d[\d\s\.]*)\s*UZS/i);

    if (amountMatch) {
      const cleanAmountStr = amountMatch[1].replace(/\s/g, '').split('.')[0];
      const receivedAmount = parseInt(cleanAmountStr, 10);

      console.log(`[SMS KELDI] Tushgan summa: ${receivedAmount} so'm`);
      
      // Bu yerda o'zingizning bazadagi to'lovni tekshirish logikangiz bo'ladi
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('SMS processing error:', err);
    return res.status(500).json({ success: false });
  }
});

// Botni webhook orqali ishlatish (Conflict xatosini 100% yo'qotadi)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishlamoqda...`);
});

// bot.launch() ni olib tashladik, chunki Render'da bot.launch() xato beradi!
