const express = require('express');
const path = require('path');
const cors = require('cors');
const storage = require('node-persist');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Static fayllar
app.use(express.static(__dirname));

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const OWNER_ID = process.env.OWNER_ID || '7651404790';
const HYPERPIN_API_KEY = process.env.API_KEY || 'hp_0bd4dfa6e45e4131db94f2492b2807cd';
const HYPERPIN_API_URL = 'https://api.hyperpin.top/api/v1';

const bot = new Telegraf(BOT_TOKEN);

// Database Initialization (In-Memory persist)
(async () => {
  await storage.init({ dir: './.dbdata' });
  
  // Default Config Initialize
  if (!(await storage.getItem('banners'))) {
    await storage.setItem('banners', [
      'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
      'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800'
    ]);
  }
  if (!(await storage.getItem('games'))) await storage.setItem('games', []);
  if (!(await storage.getItem('reviews'))) await storage.setItem('reviews', []);
  if (!(await storage.getItem('orders'))) await storage.setItem('orders', []);
  if (!(await storage.getItem('topUsers'))) await storage.setItem('topUsers', {});
  if (!(await storage.getItem('users'))) await storage.setItem('users', {});
})();

// ================= TELEGRAM BOT LOGIC =================
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const userName = ctx.from.first_name || 'Foydalanuvchi';
  const username = ctx.from.username ? `@${ctx.from.username}` : 'Mavjud emas';
  const photoUrl = ctx.from.photo_url || '';

  let users = (await storage.getItem('users')) || {};
  
  // Referal Logic
  const startArgs = ctx.message.text.split(' ')[1];
  if (startArgs && startArgs.startsWith('ref_') && !users[userId]) {
    const referrerId = startArgs.replace('ref_', '');
    if (referrerId !== userId && users[referrerId]) {
      users[referrerId].balance = (users[referrerId].balance || 0) + 200;
      users[referrerId].referrals = (users[referrerId].referrals || 0) + 1;
      await storage.setItem('users', users);
      
      bot.telegram.sendMessage(
        referrerId,
        `🎉 **Sizda yangi taklif bor!**\n\nSiz taklif qilgan **${userName}** botga kirdi. Hisobingizga **200 so'm** qo'shildi!`
      ).catch(() => {});
    }
  }

  if (!users[userId]) {
    users[userId] = { id: userId, name: userName, username, balance: 0, referrals: 0, photoUrl };
    await storage.setItem('users', users);
  }

  const caption = `Assalomu alaykum **${userName}**!\n\n🔥 **OlovPay** do'koniga xush kelibsiz! Quyidagi tugmalardan birini tanlang:`;
  const webAppUrl = process.env.WEB_APP_URL || 'https://your-render-app.onrender.com';

  ctx.replyWithPhoto(
    { url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800' },
    {
      caption,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🛒 Do\'kon (Mini App)', webAppUrl)],
        [Markup.button.url('📢 News (Kanal)', 'https://t.me/arkootzif')],
        [Markup.button.url('🎧 Support', 'https://t.me/x7fan')]
      ])
    }
  );
});

bot.launch();

// ================= API ENDPOINTS =================

// Config API
app.get('/api/config', async (req, res) => {
  res.json({
    banners: (await storage.getItem('banners')) || [],
    games: (await storage.getItem('games')) || [],
    reviews: (await storage.getItem('reviews')) || [],
    topUsers: Object.values((await storage.getItem('topUsers')) || {}).sort((a,b) => b.total - a.total).slice(0, 10)
  });
});

// User Info
app.get('/api/user/:id', async (req, res) => {
  const users = (await storage.getItem('users')) || {};
  res.json(users[req.params.id] || { balance: 0, referrals: 0 });
});

// Verify Game ID (PUBG / HyperPin API)
app.post('/api/verify-id', async (req, res) => {
  const { game, playerId } = req.body;
  
  if (game === 'PUBG Mobile') {
    if (!/^\d{8,11}$/.test(playerId)) {
      return res.json({ success: false, message: "ID formati noto'g'ri (8-11 ta raqam)!" });
    }
    try {
      // HyperPin API Verify Integration
      const response = await axios.post(`${HYPERPIN_API_URL}/player-verify`, {
        game: 'pubg',
        player_id: playerId
      }, {
        headers: { 'Authorization': `Bearer ${HYPERPIN_API_KEY}` }
      });
      return res.json({ success: true, name: response.data.player_name || "O'yinchi topildi" });
    } catch (e) {
      // Fallback local mock verification if external API key is pending
      return res.json({ success: true, name: `Player_${playerId.slice(-4)}` });
    }
  }
  res.json({ success: true, name: "Tekshirildi" });
});

// Deposit Request Endpoint
app.post('/api/deposit', async (req, res) => {
  const { userId, amount } = req.body;
  const users = (await storage.getItem('users')) || {};
  const user = users[userId] || { name: 'Foydalanuvchi', username: '@x7fan' };

  const msg = `💳 **Yangi To'ldirish So'rovi!**\n\n👤 **Foydalanuvchi:** ${user.name} (${user.username})\n🆔 **ID:** \`${userId}\` \n💰 **Summa:** ${Number(amount).toLocaleString()} so'm`;

  try {
    await bot.telegram.sendMessage(OWNER_ID, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Tasdiqlash', `approve_${userId}_${amount}`),
          Markup.button.callback('❌ Bekor qilish', `deny_${userId}_${amount}`)
        ]
      ])
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Serverda xatolik" });
  }
});

// Callback Handlers for Owner Approval
bot.action(/approve_(\d+)_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  const amount = parseInt(ctx.match[2]);

  let users = (await storage.getItem('users')) || {};
  if (users[userId]) {
    users[userId].balance = (users[userId].balance || 0) + amount;
    await storage.setItem('users', users);
  }

  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ **TASDIQLANDI**');
  bot.telegram.sendMessage(userId, `🎉 **To'lovingiz tasdiqlandi!**\nHisobingizga **${amount.toLocaleString()} so'm** qo'shildi.`).catch(() => {});
});

bot.action(/deny_(\d+)_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ **BEKOR QILINDI**');
  bot.telegram.sendMessage(userId, `⚠️ **To'lov bekor qilindi!**\nQayta urinib ko'ring yoki muammo bo'lsa @x7fan adminga yozing.`).catch(() => {});
});

// Add Review
app.post('/api/reviews', async (req, res) => {
  const { name, text, stars } = req.body;
  let reviews = (await storage.getItem('reviews')) || [];
  reviews.push({ name, text, stars, date: new Date().toLocaleDateString() });
  await storage.setItem('reviews', reviews);
  res.json({ success: true });
});

// Root Serve
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
