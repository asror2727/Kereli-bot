const express = require('express');
const path = require('path');
const cors = require('cors');
const storage = require('node-persist');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

// Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const OWNER_ID = process.env.OWNER_ID || '7651404790';
const HYPERPIN_API_KEY = process.env.API_KEY || 'hp_0bd4dfa6e45e4131db94f2492b2807cd';
const HYPERPIN_API_URL = 'https://api.hyperpin.top/api/v1';

const bot = new Telegraf(BOT_TOKEN);

// Vaqtinchalik Admin holatlari (Session)
const adminState = {};

// Database Initialization (Doimiy Saqlash)
(async () => {
  await storage.init({ dir: './.dbdata' });

  if (!(await storage.getItem('startPhoto'))) {
    await storage.setItem('startPhoto', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800');
  }
  if (!(await storage.getItem('banners'))) {
    await storage.setItem('banners', [
      'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
      'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800'
    ]);
  }
  if (!(await storage.getItem('bgMusic'))) {
    await storage.setItem('bgMusic', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
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

  let users = (await storage.getItem('users')) || {};

  // Referal tizimi
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

  // Foydalanuvchini bazada saqlash (qayta kirganda hisob nolga aylanmaydi)
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      name: userName,
      username: username,
      balance: 0,
      referrals: 0,
      createdAt: new Date().toLocaleDateString()
    };
    await storage.setItem('users', users);
  }

  const startPhoto = await storage.getItem('startPhoto');
  const webAppUrl = process.env.WEB_APP_URL || 'https://your-render-app.onrender.com';
  const caption = `Assalomu alaykum **${userName}**!\n\n🔥 **OlovPay** do'koniga xush kelibsiz! Quyidagi tugmalardan birini tanlang:`;

  ctx.replyWithPhoto(
    { url: startPhoto },
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

// ================= ADMIN PANEL MENU =================

bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;

  await ctx.reply('👑 **Admin Panelga Xush Kelibsiz!**\n\nBoshqaruv menyusi:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📊 Statistika', 'admin_stats'), Markup.button.callback('🛒 Buyurtmalar', 'admin_orders')],
      [Markup.button.callback('🖼 Start Rasmi', 'set_start_photo'), Markup.button.callback('📢 Reklama Banners', 'set_banners')],
      [Markup.button.callback('🎮 O\'yin Qoshish', 'add_game'), Markup.button.callback('🎵 Muzika O\'zgartirish', 'set_music')],
      [Markup.button.callback('💬 Fikrlarni Tozalash', 'clear_reviews'), Markup.button.callback('🗑 Buyurtmalarni Tozalash', 'clear_orders_list')]
    ])
  });
});

// Admin Panel Action Handlers
bot.action('admin_stats', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  const users = (await storage.getItem('users')) || {};
  const orders = (await storage.getItem('orders')) || [];
  const totalUsers = Object.keys(users).length;
  const totalOrders = orders.length;

  await ctx.answerCbQuery();
  await ctx.reply(`📊 **Bot Statistikasi:**\n\n👤 Jami Foydalanuvchilar: **${totalUsers}** ta\n🛍 Jami Buyurtmalar: **${totalOrders}** ta`, { parse_mode: 'Markdown' });
});

bot.action('admin_orders', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  const orders = (await storage.getItem('orders')) || [];
  await ctx.answerCbQuery();

  if (orders.length === 0) {
    return ctx.reply("🛒 Hozircha hech qanday buyurtma yo'q.");
  }

  let text = "🛒 **Oxirgi Buyurtmalar:**\n\n";
  orders.slice(-10).forEach((o, i) => {
    text += `${i + 1}. **${o.userName}** | ${o.item} | ${o.amount} so'm | ${o.date}\n`;
  });
  ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.action('set_start_photo', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = 'AWAIT_START_PHOTO';
  await ctx.answerCbQuery();
  await ctx.reply("🖼 **Galereyadan yangi Start rasmini yuboring:**");
});

bot.action('set_banners', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = 'AWAIT_BANNER_PHOTO';
  await ctx.answerCbQuery();
  await ctx.reply("📢 **Galereyadan yangi Reklama Banner rasmini yuboring (Bir nechta yuborishingiz mumkin):**");
});

bot.action('add_game', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = 'AWAIT_GAME_DETAILS';
  await ctx.answerCbQuery();
  await ctx.reply("🎮 **Yangi o'yin nomini yozib yuboring (Masalan: Free Fire):**");
});

bot.action('set_music', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = 'AWAIT_MUSIC';
  await ctx.answerCbQuery();
  await ctx.reply("🎵 **Yangi fon musiqasini (MP3 Audio yoki Voice qilib) yuboring:**");
});

bot.action('clear_reviews', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  await storage.setItem('reviews', []);
  await ctx.answerCbQuery('✅ Barcha fikrlar tozalandi!', { show_alert: true });
});

bot.action('clear_orders_list', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  await storage.setItem('orders', []);
  await ctx.answerCbQuery('✅ Buyurtmalar tarixi tozalandi!', { show_alert: true });
});

// Admin Fayl va Rasm Qabul Qilish (Galereyadan)
bot.on(['photo', 'audio', 'voice', 'text'], async (ctx, next) => {
  if (ctx.from.id.toString() !== OWNER_ID) return next();

  const currentState = adminState[OWNER_ID];

  // 1. Start Rasmini Saqlash
  if (currentState === 'AWAIT_START_PHOTO' && ctx.message.photo) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    await storage.setItem('startPhoto', fileLink.href);
    delete adminState[OWNER_ID];
    return ctx.reply("✅ **Start rasmi muvaffaqiyatli o'zgartirildi!**", { parse_mode: 'Markdown' });
  }

  // 2. Banner Rasmini Saqlash
  if (currentState === 'AWAIT_BANNER_PHOTO' && ctx.message.photo) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    let banners = (await storage.getItem('banners')) || [];
    banners.push(fileLink.href);
    await storage.setItem('banners', banners);

    return ctx.reply("✅ **Yangi banner qo'shildi!** Yana yuborishingiz yoki /admin deb menyuga qaytishingiz mumkin.", { parse_mode: 'Markdown' });
  }

  // 3. Audio/Muzika Saqlash
  if (currentState === 'AWAIT_MUSIC' && (ctx.message.audio || ctx.message.voice)) {
    const fileId = (ctx.message.audio || ctx.message.voice).file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    await storage.setItem('bgMusic', fileLink.href);
    delete adminState[OWNER_ID];
    return ctx.reply("✅ **Yangi muzika mini app uchun muvaffaqiyatli o'rnatildi!**", { parse_mode: 'Markdown' });
  }

  // 4. O'yin Qo'shish (Tekst)
  if (currentState === 'AWAIT_GAME_DETAILS' && ctx.message.text) {
    const gameName = ctx.message.text;
    let games = (await storage.getItem('games')) || [];
    games.push({
      id: Date.now(),
      name: gameName,
      img: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400'
    });
    await storage.setItem('games', games);
    delete adminState[OWNER_ID];
    return ctx.reply(`✅ **${gameName}** o'yini muvaffaqiyatli qo'shildi!`, { parse_mode: 'Markdown' });
  }

  return next();
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

bot.launch();

// ================= API ENDPOINTS =================

// Config API
app.get('/api/config', async (req, res) => {
  res.json({
    banners: (await storage.getItem('banners')) || [],
    games: (await storage.getItem('games')) || [],
    reviews: (await storage.getItem('reviews')) || [],
    bgMusic: (await storage.getItem('bgMusic')) || '',
    topUsers: Object.values((await storage.getItem('topUsers')) || {}).sort((a,b) => b.total - a.total).slice(0, 10)
  });
});

// User Info (Doimiy Saqlash)
app.get('/api/user/:id', async (req, res) => {
  const users = (await storage.getItem('users')) || {};
  res.json(users[req.params.id] || { balance: 0, referrals: 0 });
});

// Verify Game ID
app.post('/api/verify-id', async (req, res) => {
  const { game, playerId } = req.body;

  if (game === 'PUBG Mobile') {
    if (!/^\d{8,11}$/.test(playerId)) {
      return res.json({ success: false, message: "ID formati noto'g'ri (8-11 ta raqam)!" });
    }
    try {
      const response = await axios.post(`${HYPERPIN_API_URL}/player-verify`, {
        game: 'pubg',
        player_id: playerId
      }, {
        headers: { 'Authorization': `Bearer ${HYPERPIN_API_KEY}` }
      });
      return res.json({ success: true, name: response.data.player_name || "O'yinchi topildi" });
    } catch (e) {
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
