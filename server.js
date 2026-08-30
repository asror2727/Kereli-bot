const express = require('express');
const path = require('path');
const cors = require('cors');
const storage = require('node-persist');
const { Telegraf, Markup } = require('telegraf');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const OWNER_ID = process.env.OWNER_ID || '7651404790';

const bot = new Telegraf(BOT_TOKEN);
const adminState = {};

(async () => {
  await storage.init({ dir: './.dbdata' });

  if (!(await storage.getItem('banners'))) await storage.setItem('banners', []);
  if (!(await storage.getItem('games'))) await storage.setItem('games', []);
  if (!(await storage.getItem('reviews'))) await storage.setItem('reviews', []);
  if (!(await storage.getItem('orders'))) await storage.setItem('orders', []);
  if (!(await storage.getItem('users'))) await storage.setItem('users', {});
})();

// ================= TELEGRAM BOT LOGIC =================

bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const userName = ctx.from.first_name || 'Foydalanuvchi';
  const username = ctx.from.username ? `@${ctx.from.username}` : '';

  let avatarUrl = '';
  try {
    const userPhotos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);
    if (userPhotos.total_count > 0) {
      const fileId = userPhotos.photos[0][0].file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      avatarUrl = fileLink.href;
    }
  } catch (e) {}

  let users = (await storage.getItem('users')) || {};
  if (!users[userId]) {
    users[userId] = { id: userId, name: userName, username, avatar: avatarUrl, balance: 0, spent: 0, ordersCount: 0 };
  } else {
    users[userId].avatar = avatarUrl || users[userId].avatar;
    users[userId].name = userName;
  }
  await storage.setItem('users', users);

  const startPhoto = await storage.getItem('startPhoto');
  const webAppUrl = process.env.WEB_APP_URL || 'https://your-render-app.onrender.com';
  const caption = `Assalomu alaykum **${userName}**!\n\n🔥 **OlovPay** xizmatiga xush kelibsiz!`;

  // So'ralgan yangi tugmalar joylashuvi
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🛒 Do\'kon', webAppUrl)],
    [Markup.button.url('📢 Yangilik', 'https://t.me/arkootzif'), Markup.button.url('🎧 Yordam', 'https://t.me/x7fan')]
  ]);

  if (startPhoto) {
    ctx.replyWithPhoto({ url: startPhoto }, { caption, parse_mode: 'Markdown', ...keyboard });
  } else {
    ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
  }
});

// Admin Panel
bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;

  await ctx.reply('👑 **Admin Panel**', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📢 Banner Sozlash (Rasm/Video)', 'set_banner'), Markup.button.callback('🎮 O\'yin Yaratish', 'add_game')],
      [Markup.button.callback('💎 O\'yinga Paket Qo\'shish', 'add_pack')],
      [Markup.button.callback('💬 Fikrlarni Tozalash', 'clear_reviews'), Markup.button.callback('🗑 Buyurtmalarni Tozalash', 'clear_orders')]
    ])
  });
});

// Admin Handlers
bot.action('set_banner', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = { step: 'AWAIT_BANNER' };
  await ctx.answerCbQuery();
  await ctx.reply("📢 **Banner uchun Galereyadan Video (5-10 sek) yoki Rasm yuboring:**");
});

bot.action('add_game', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = { step: 'AWAIT_GAME_NAME' };
  await ctx.answerCbQuery();
  await ctx.reply("🎮 **Yangi o'yin nomini kiriting (Masalan: PUBG Mobile):**");
});

bot.action('add_pack', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  const games = (await storage.getItem('games')) || [];
  if (games.length === 0) {
    return ctx.reply("⚠️ Avval kamida bitta o'yin yarating!");
  }
  
  const buttons = games.map(g => [Markup.button.callback(g.name, `select_game_${g.id}`)]);
  await ctx.reply("Qaysi o'yinga paket qo'shmoqchisiz?", Markup.inlineKeyboard(buttons));
});

bot.action(/select_game_(\d+)/, async (ctx) => {
  const gameId = ctx.match[1];
  adminState[OWNER_ID] = { step: 'AWAIT_PACK_TITLE', gameId };
  await ctx.answerCbQuery();
  await ctx.reply("💎 **Paket nomini kiriting (Masalan: 60 UC yoki Prime):**");
});

// Admin Message Receiver
bot.on(['photo', 'video', 'document', 'text'], async (ctx, next) => {
  if (ctx.from.id.toString() !== OWNER_ID) return next();
  const state = adminState[OWNER_ID];
  if (!state) return next();

  // Banner Upload (Video or Image)
  if (state.step === 'AWAIT_BANNER') {
    let fileId, type;
    if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      type = 'video';
    } else if (ctx.message.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      type = 'image';
    }

    if (fileId) {
      const link = await ctx.telegram.getFileLink(fileId);
      let banners = (await storage.getItem('banners')) || [];
      banners.push({ url: link.href, type });
      if (banners.length > 3) banners.shift(); // Max 3 items
      await storage.setItem('banners', banners);
      delete adminState[OWNER_ID];
      return ctx.reply("✅ **Yangi banner saqlandi!**");
    }
  }

  // Create Game
  if (state.step === 'AWAIT_GAME_NAME' && ctx.message.text) {
    state.gameName = ctx.message.text;
    state.step = 'AWAIT_GAME_PHOTO';
    return ctx.reply("🖼 **O'yin rasmini (Galereyadan) yuboring:**");
  }

  if (state.step === 'AWAIT_GAME_PHOTO' && ctx.message.photo) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    let games = (await storage.getItem('games')) || [];
    games.push({ id: Date.now().toString(), name: state.gameName, img: link.href, packs: [] });
    await storage.setItem('games', games);
    delete adminState[OWNER_ID];
    return ctx.reply(`🎉 **${state.gameName}** o'yini yaratildi!`);
  }

  // Add Pack Steps
  if (state.step === 'AWAIT_PACK_TITLE' && ctx.message.text) {
    state.packTitle = ctx.message.text;
    state.step = 'AWAIT_PACK_PRICE';
    return ctx.reply("💰 **Paket narxini kiriting (faqat raqam, masalan: 12000):**");
  }

  if (state.step === 'AWAIT_PACK_PRICE' && ctx.message.text) {
    state.packPrice = Number(ctx.message.text);
    state.step = 'AWAIT_PACK_ICON';
    return ctx.reply("🖼 **Paket ikonkasi uchun PNG rasm yuboring:**");
  }

  if (state.step === 'AWAIT_PACK_ICON' && (ctx.message.photo || ctx.message.document)) {
    const fileId = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id;
    const link = await ctx.telegram.getFileLink(fileId);

    let games = (await storage.getItem('games')) || [];
    const game = games.find(g => g.id === state.gameId);
    if (game) {
      game.packs.push({ id: Date.now().toString(), title: state.packTitle, price: state.packPrice, icon: link.href });
      await storage.setItem('games', games);
      ctx.reply(`✅ **${state.packTitle}** paketi qo'shildi!`);
    }
    delete adminState[OWNER_ID];
    return;
  }

  // Chek skrinshoti qabul qilish
  if (state.step === 'AWAIT_RECEIPT' && (ctx.message.photo || ctx.message.document)) {
    await ctx.reply("✅ **Chekingiz qabul qilindi va adminga yuborildi! Tekshirilgach balans to'ldiriladi.**");
    delete adminState[OWNER_ID];
    return;
  }

  return next();
});

// Admin Approval Actions for Purchases
bot.action(/approve_order_(\d+)_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const orderId = ctx.match[2];

  let orders = (await storage.getItem('orders')) || [];
  const order = orders.find(o => o.id === orderId);
  if (order) {
    order.status = 'approved';
    await storage.setItem('orders', orders);

    let users = (await storage.getItem('users')) || {};
    if (users[userId]) {
      users[userId].spent = (users[userId].spent || 0) + order.price;
      users[userId].ordersCount = (users[userId].ordersCount || 0) + 1;
      await storage.setItem('users', users);
    }
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ **TASDIQLANDI VA TOPGA QO\'SHILDI**');
    bot.telegram.sendMessage(userId, `🎉 **${order.packTitle}** xaridingiz tasdiqlandi!`).catch(() => {});
  }
});

bot.launch();

// ================= API ENDPOINTS =================

app.get('/api/config', async (req, res) => {
  res.json({
    banners: (await storage.getItem('banners')) || [],
    games: (await storage.getItem('games')) || [],
    reviews: (await storage.getItem('reviews')) || []
  });
});

app.get('/api/top-users', async (req, res) => {
  const users = (await storage.getItem('users')) || {};
  const sorted = Object.values(users)
    .filter(u => u.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 10);
  res.json(sorted);
});

app.post('/api/buy', async (req, res) => {
  const { userId, packTitle, price, playerId } = req.body;
  let users = (await storage.getItem('users')) || {};
  const user = users[userId];

  if (!user || user.balance < price) {
    return res.json({ success: false, message: "Mablag' yetarli emas!" });
  }

  user.balance -= price;
  await storage.setItem('users', users);

  const orderId = Date.now().toString();
  let orders = (await storage.getItem('orders')) || [];
  orders.push({ id: orderId, userId, userName: user.name, packTitle, price, playerId, status: 'pending' });
  await storage.setItem('orders', orders);

  // Send Notification to Owner
  bot.telegram.sendMessage(OWNER_ID, `🛒 **Yangi Buyurtma!**\n\n👤 User: ${user.name}\n🎮 ID: \`${playerId}\`\n💎 Paket: ${packTitle}\n💰 Narx: ${price} so'm`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('✅ Tasdiqlash', `approve_order_${userId}_${orderId}`)]])
  }).catch(() => {});

  res.json({ success: true, newBalance: user.balance });
});

// React to Reviews
app.post('/api/reviews/react', async (req, res) => {
  const { reviewId, emoji } = req.body;
  let reviews = (await storage.getItem('reviews')) || [];
  const review = reviews.find(r => r.id === reviewId);
  if (review) {
    if (!review.reactions) review.reactions = {};
    review.reactions[emoji] = (review.reactions[emoji] || 0) + 1;
    await storage.setItem('reviews', reviews);
  }
  res.json({ success: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
