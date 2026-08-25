const express = require('express');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');

// Modellaringizni import qiling (yo'lini o'zingiznikiga moslang)
const Payment = require('./models/Payment');
const User = require('./models/User');

const app = express();
app.use(express.json());

// Telegram bot obyektini sozlash
const bot = new Telegraf(process.env.BOT_TOKEN);
const SMS_SECRET_KEY = process.env.SMS_SECRET || "SeningMaxfiyKaliting123!"; 

// Webhook endpoint (Android SMS ilovasi uchun)
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

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const pendingPayment = await Payment.findOne({
        amount: receivedAmount,
        status: 'PENDING',
        createdAt: { $gte: fiveMinutesAgo }
      });

      if (pendingPayment) {
        pendingPayment.status = 'PAID';
        await pendingPayment.save();

        await User.updateOne(
          { telegramId: pendingPayment.userId },
          { $inc: { balance: pendingPayment.amount } }
        );

        await bot.telegram.sendMessage(
          pendingPayment.userId,
          `✅ **To'lov muvaffaqiyatli qabul qilindi!**\n\n💰 Balansingizga: ${pendingPayment.amount} so'm qo'shildi.`
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('SMS processing error:', err);
    return res.status(500).json({ success: false });
  }
});

// Render uchun zaruriy Port eshituvchi
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishlamoqda...`);
});

// Botni ishga tushirish
bot.launch();
