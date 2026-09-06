require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { readDb, updateDb, getUser, nextOrderNumber } = require('./src/db');
const { initBot } = require('./src/bot');

const MIN_DEPOSIT = 1000;
const MAX_DEPOSIT = 3000000;
const SMS_SECRET = process.env.SMS_SECRET || 'SeningMaxfiyKaliting123!';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let bot = null;
try {
  bot = initBot();
} catch (err) {
  console.warn('⚠️ Bot init error:', err.message);
}

// ===== CONFIG =====
app.get('/api/config', (req, res) => {
  const db = readDb();
  res.json({
    games: db.games || [],
    topUsers: db.topUsers || [],
    reviews: db.reviews || [],
    banners: db.banners || []
  });
});

// ===== USER =====
app.get('/api/user/:id', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.id);
  res.json({ balance: user.balance || 0 });
});

// ===== ORDERS =====
app.post('/api/orders', (req, res) => {
  const { userId, userName, gameId, type, packageIndex, playerId } = req.body;
  if (!userId || !gameId || !type) return res.status(400).json({ ok: false, error: "Ma'lumot yetarli emas" });

  const db = readDb();
  const game = db.games.find(g => g.id === gameId);
  if (!game) return res.status(400).json({ ok: false, error: 'O\'yin topilmadi' });

  const pkg = game.types[type]?.[packageIndex];
  if (!pkg) return res.status(400).json({ ok: false, error: 'Paket topilmadi' });

  const user = getUser(db, userId);
  if (user.balance < pkg.price) return res.status(400).json({ ok: false, error: 'Balans yetarli emas' });

  let order = null;
  updateDb((d) => {
    const number = nextOrderNumber(d);
    order = {
      id: nanoid(10),
      number,
      userId: String(userId),
      userName: userName || 'User',
      gameName: game.name,
      packageLabel: pkg.amt,
      price: pkg.price,
      playerId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    d.orders.unshift(order);
    const u = getUser(d, userId);
    u.balance -= pkg.price;

    // TOP'ga avtomatik qo'shish
    const existing = d.topUsers.find(t => t.name === (userName || 'User'));
    if (existing) {
      existing.amt = pkg.price.toLocaleString('uz-UZ');
    } else {
      d.topUsers.unshift({
        medal: d.topUsers.length === 0 ? '🥇' : d.topUsers.length === 1 ? '🥈' : d.topUsers.length === 2 ? '🥉' : '⭐',
        name: userName || 'User',
        sub: '1 buyurtma',
        amt: pkg.price.toLocaleString('uz-UZ'),
        initial: (userName || 'U')[0]
      });
      d.topUsers = d.topUsers.slice(0, 10);
    }

    if (bot && process.env.OWNER_CHAT_ID) {
      try {
        bot.sendMessage(process.env.OWNER_CHAT_ID,
          `💎 **Yangi buyurtma #${number}**\n\n👤 ${userName}\n🎮 ${game.name} — ${pkg.amt}\n💰 ${pkg.price.toLocaleString('uz-UZ')} so'm\n🆔 Player: ${playerId}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      } catch (err) {
        console.error('Bot message error:', err.message);
      }
    }
  });

  res.json({ ok: true, order: { number: order.number }, balance: getUser(db, userId).balance });
});

app.get('/api/orders/:userId', (req, res) => {
  const db = readDb();
  const orders = db.orders.filter(o => String(o.userId) === String(req.params.userId));
  res.json({ orders });
});

// ===== DEPOSITS =====
app.post('/api/deposits', (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) return res.status(400).json({ ok: false, error: "Ma'lumot yetarli emas" });
  const amt = Number(amount);
  if (amt < MIN_DEPOSIT || amt > MAX_DEPOSIT) return res.status(400).json({ ok: false, error: `Miqdor: ${MIN_DEPOSIT}-${MAX_DEPOSIT}` });

  const deposit = {
    id: nanoid(10),
    userId: String(userId),
    amount: amt,
    method: method || 'uzcard',
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  updateDb((db) => {
    db.deposits.unshift(deposit);
    getUser(db, userId);
  });

  if (bot && process.env.OWNER_CHAT_ID) {
    try {
      bot.sendMessage(process.env.OWNER_CHAT_ID,
        `💰 **Yangi to'lov so'rovi**\n\n👤 ${userId}\n💵 ${amt.toLocaleString('uz-UZ')} so'm\n🔧 ${(method || 'uzcard').toUpperCase()}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } catch (err) {
      console.error('Bot message error:', err.message);
    }
  }

  res.json({ ok: true, deposit });
});

app.get('/api/deposits/:id', (req, res) => {
  const db = readDb();
  const dep = db.deposits.find(d => d.id === req.params.id);
  res.json(dep || { ok: false });
});

// ===== SMS WEBHOOK — P2P AVTOMATIK TASDIQLASH =====
app.post('/api/sms-receiver', (req, res) => {
  try {
    console.log('📱 [SMS WEBHOOK] Request keldi:', JSON.stringify(req.body));

    // 1. Ma'lumotlarni o'qish
    const rawMessage = req.body.message || req.body.body || req.body.text || '';
    const phone = req.body.phone || req.body.from || '';
    const secret = req.body.secret || '';

    console.log(`📱 [SMS DATA] Message: "${rawMessage}", Phone: "${phone}", Secret: "${secret}"`);

    // 2. Secret key tekshirish
    if (secret && secret !== SMS_SECRET) {
      console.warn('⚠️ [SMS] Secret noto\'g\'ri:', secret);
      return res.status(403).json({ success: false, error: 'Invalid secret' });
    }

    // 3. OTP/kod/test SMS'ni ignore qilish
    const lowerMsg = rawMessage.toLowerCase();
    if (lowerMsg.includes('kod') || lowerMsg.includes('code') || lowerMsg.includes('otp') || 
        lowerMsg.includes('%sms') || lowerMsg.includes('test') || lowerMsg.includes('test 2026')) {
      console.log('⏭️ [SMS] OTP/Test SMS — skip');
      return res.json({ success: true, message: 'OTP SMS ignored' });
    }

    // 4. Summani SMS'dan chiqarish
    let amount = 0;
    const patterns = [
      /(\d{3,})\s*(?:UZS|so'm|sum|сум)/i,  // "1000 so'm", "100000 UZS"
      /summa[:\s]*(\d+)/i,                  // "summa: 50000"
      /o'tkazildi[:\s]*(\d+)/i,             // "o'tkazildi: 100000"
      /tushdi[:\s]*(\d+)/i,                 // "tushdi: 75000"
      /(\d{4,})/                            // 4+ digit raqam
    ];

    for (const pattern of patterns) {
      const match = rawMessage.match(pattern);
      if (match) {
        const cleanNum = match[1].replace(/\D/g, '');
        amount = parseInt(cleanNum, 10);
        if (amount > 50 && amount < 500000000) break; // valid range
      }
    }

    console.log(`💰 [SMS PARSED] Summa: ${amount} so'm`);

    // 5. Summa tekshirish
    if (!amount || amount < 100) {
      console.warn('⚠️ [SMS] Summa topilmadi yoki kichik');
      if (bot && process.env.OWNER_CHAT_ID) {
        try {
          bot.sendMessage(process.env.OWNER_CHAT_ID,
            `📱 **SMS keldi, lekin summa aniqlanmadi:**\n\n📝 Matn: \`${rawMessage}\`\n📞 Phone: \`${phone}\``,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        } catch (err) {
          console.error('Bot error:', err.message);
        }
      }
      return res.json({ success: true, message: 'Summa topilmadi' });
    }

    // 6. Pending deposit'ni topish va avtomatik tasdiqlash
    let confirmed = false;
    let confirmedDeposit = null;
    const normalizedPhone = String(phone).replace(/\D/g, '').slice(-9);

    updateDb((db) => {
      // A) Summa bo'yicha topish (eng asosiy)
      let dep = db.deposits.find(d => 
        d.status === 'pending' && Number(d.amount) === amount
      );

      // B) Agar telefon bor va summa mos kelmasa, telefon + summa bilan topish
      if (!dep && normalizedPhone) {
        dep = db.deposits.find(d => {
          const userPhone = String(d.userId).replace(/\D/g, '').slice(-9);
          return d.status === 'pending' && 
                 Number(d.amount) === amount && 
                 userPhone === normalizedPhone;
        });
      }

      // C) Agar hali topilmasa, faqat telefon bilan topish
      if (!dep && normalizedPhone) {
        dep = db.deposits.find(d => {
          const userPhone = String(d.userId).replace(/\D/g, '').slice(-9);
          return d.status === 'pending' && userPhone === normalizedPhone;
        });
      }

      // D) Tasdiqlash
      if (dep) {
        dep.status = 'confirmed';
        dep.confirmedAt = new Date().toISOString();
        const user = getUser(db, dep.userId);
        user.balance = Number(user.balance || 0) + amount;
        confirmed = true;
        confirmedDeposit = dep;

        console.log(`✅ [SMS AUTO] To'lov tasdiqlandi: User ${dep.userId} -> ${amount} so'm`);
      }
    });

    // 7. Foydalanuvchiga xabar
    if (confirmed && confirmedDeposit && bot) {
      try {
        bot.sendMessage(
          confirmedDeposit.userId,
          `✅ **To'lov AVTOMATIK tasdiqlandi!**\n\n💰 **${amount.toLocaleString('uz-UZ')} so'm** balansingizga qo'shildi.\n\n🕐 Vaqt: ${new Date().toLocaleString('uz-UZ')}\n📱 SMS: \`${rawMessage}\``,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      } catch (err) {
        console.error('Bot message error:', err.message);
      }
    }

    // 8. Admin'ga xabar (agar mos deposit topilmasa)
    if (!confirmed && bot && process.env.OWNER_CHAT_ID) {
      try {
        bot.sendMessage(
          process.env.OWNER_CHAT_ID,
          `📱 **SMS keldi, lekin mos deposit topilmadi:**\n\n💰 Summa: **${amount.toLocaleString('uz-UZ')} so'm**\n📞 Phone: \`${normalizedPhone}\`\n📝 Matn: \`${rawMessage}\`\n\nQo'lda tekshiring!`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      } catch (err) {
        console.error('Bot error:', err.message);
      }
    }

    return res.json({ 
      success: true, 
      message: confirmed ? 'To\'lov avtomatik tasdiqlandi' : 'Mos deposit topilmadi',
      amount,
      confirmed
    });

  } catch (err) {
    console.error('❌ [SMS ERROR]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ===== REFERRAL =====
app.get('/api/referral/:userId', (req, res) => {
  const db = readDb();
  const user = getUser(db, req.params.userId);
  if (!user.refCode) {
    user.refCode = `LUNA-${nanoid(6).toUpperCase()}`;
    updateDb(db => {});
  }
  res.json({
    refCode: user.refCode,
    refLink: `https://t.me/${process.env.BOT_USERNAME || 'lunapin_bot'}?start=${user.refCode}`,
    refCount: user.refCount || 0,
    refEarned: user.refEarned || 0
  });
});

// ===== REVIEWS =====
app.post('/api/reviews', (req, res) => {
  const { name, stars, text } = req.body;
  if (!name || !stars) return res.status(400).json({ ok: false });

  updateDb((db) => {
    db.reviews.unshift({ name, stars: parseInt(stars), text: text || '' });
    db.reviews = db.reviews.slice(0, 50);
  });

  res.json({ ok: true });
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===== 404 =====
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint topilmadi' });
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`✨ LunaPin server ${PORT}'da ishga tushdi`);
  console.log(`📱 SMS webhook: POST /api/sms-receiver`);
});
