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

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const OWNER_ID = process.env.OWNER_ID || '7651404790';
const HYPERPIN_API_KEY = process.env.API_KEY || 'hp_0bd4dfa6e45e4131db94f2492b2807cd';
const HYPERPIN_API_URL = 'https://api.hyperpin.top/api/v1';

const bot = new Telegraf(BOT_TOKEN);
const adminState = {};

(async () => {
  await storage.init({ dir: './.dbdata' });

  if (!(await storage.getItem('startPhoto'))) await storage.setItem('startPhoto', '');
  if (!(await storage.getItem('banners'))) await storage.setItem('banners', []);
  if (!(await storage.getItem('bgMusic'))) await storage.setItem('bgMusic', '');
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

  // User Profile Photo
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
    users[userId] = {
      id: userId,
      name: userName,
      username: username,
      avatar: avatarUrl,
      balance: 0,
      spent: 0,
      referrals: 0,
      ordersCount: 0
    };
  } else {
    users[userId].avatar = avatarUrl || users[userId].avatar;
    users[userId].name = userName;
  }
  await storage.setItem('users', users);

  const startPhoto = await storage.getItem('startPhoto');
  const webAppUrl = process.env.WEB_APP_URL || 'https://your-render-app.onrender.com';
  const caption = `Assalomu alaykum **${userName}**!\n\n🔥 **OlovPay** xizmatiga xush kelibsiz!`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🛒 Do\'kon (Mini App)', webAppUrl)],
    [Markup.button.url('📢 Kanal', 'https://t.me/arkootzif'), Markup.button.url('🎧 Support', 'https://t.me/x7fan')]
  ]);

  if (startPhoto) {
    ctx.replyWithPhoto({ url: startPhoto }, { caption, parse_mode: 'Markdown', ...keyboard });
  } else {
    ctx.reply(caption, { parse_mode: 'Markdown', ...keyboard });
  }
});

// ================= ADMIN PANEL =================

bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;

  await ctx.reply('👑 **Admin Panel**', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📊 Statistika', 'admin_stats'), Markup.button.callback('🛒 Buyurtmalar', 'admin_orders')],
      [Markup.button.callback('🖼 Start Rasmi', 'set_start_photo'), Markup.button.callback('📢 3 ta Banner Qo\'shish', 'set_banners')],
      [Markup.button.callback('🎮 Yangi O\'yin Yaratish', 'add_game_step1'), Markup.button.callback('🎵 Muzika Fayl Yuborish', 'set_music')],
      [Markup.button.callback('💬 Fikrlarni Tozalash', 'clear_reviews'), Markup.button.callback('🗑 Buyurtmalarni Tozalash', 'clear_orders_list')]
    ])
  });
});

bot.action('add_game_step1', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = { step: 'AWAIT_GAME_NAME', data: {} };
  await ctx.answerCbQuery();
  await ctx.reply("🎮 **1-Qadam:** O'yin nomini kiriting (Masalan: `PUBG Mobile`):");
});

bot.action('set_banners', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = { step: 'AWAIT_BANNERS', list: [] };
  await ctx.answerCbQuery();
  await ctx.reply("📢 **3 ta Banner uchun birma-bir 3 ta rasm yuboring (1-rasmni yuboring):**");
});

bot.action('set_start_photo', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = { step: 'AWAIT_START_PHOTO' };
  await ctx.answerCbQuery();
  await ctx.reply("🖼 **Galereyadan Start rasmini yuboring:**");
});

bot.action('set_music', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  adminState[OWNER_ID] = { step: 'AWAIT_MUSIC' };
  await ctx.answerCbQuery();
  await ctx.reply("🎵 **Mini App uchun MP3 Audio fayl yuboring:**");
});

// Admin Message Processing Steps
bot.on(['photo', 'audio', 'document', 'text'], async (ctx, next) => {
  if (ctx.from.id.toString() !== OWNER_ID) return next();

  const state = adminState[OWNER_ID];
  if (!state) return next();

  // Banner Handling (Strictly 3 Images)
  if (state.step === 'AWAIT_BANNERS' && ctx.message.photo) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    state.list.push(fileLink.href);

    if (state.list.length < 3) {
      return ctx.reply(`✅ ${state.list.length}-rasm qabul qilindi. **${state.list.length + 1}-rasmni yuboring:**`);
    } else {
      await storage.setItem('banners', state.list);
      delete adminState[OWNER_ID];
      return ctx.reply("🎉 **3 ta reklama banneri muvaffaqiyatli saqlandi!**");
    }
  }

  // Music Handling
  if (state.step === 'AWAIT_MUSIC' && (ctx.message.audio || ctx.message.document)) {
    const fileId = (ctx.message.audio || ctx.message.document).file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    await storage.setItem('bgMusic', fileLink.href);
    delete adminState[OWNER_ID];
    return ctx.reply("🎵 **Muzika muvaffaqiyatli yuklandi va o'rnatildi!**");
  }

  // Start Photo
  if (state.step === 'AWAIT_START_PHOTO' && ctx.message.photo) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    await storage.setItem('startPhoto', fileLink.href);
    delete adminState[OWNER_ID];
    return ctx.reply("✅ **Start rasmi o'zgardi!**");
  }

  // Game Builder Steps
  if (state.step === 'AWAIT_GAME_NAME' && ctx.message.text) {
    state.data.name = ctx.message.text;
    state.step = 'AWAIT_GAME_BANNER';
    return ctx.reply("🖼 **2-Qadam:** O'yin uchun **Banner Rasmini** (Galereyadan) yuboring:");
  }

  if (state.step === 'AWAIT_GAME_BANNER' && ctx.message.photo) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    state.data.banner = fileLink.href;
    state.step = 'AWAIT_GAME_PACKS';
    return ctx.reply("💎 **3-Qadam:** Paketlar va narxlarni kiriting.\n\nFormata e'tibor bering:\n`60 UC - 12000, 325 UC - 59000, 660 UC - 115000`");
  }

  if (state.step === 'AWAIT_GAME_PACKS' && ctx.message.text) {
    const packsRaw = ctx.message.text.split(',');
    state.data.packs = packsRaw.map(p => {
      const [title, price] = p.split('-');
      return { title: title ? title.trim() : '', price: Number(price ? price.trim() : 0) };
    });
    state.step = 'AWAIT_GAME_EMOJI';
    return ctx.reply("💎 **4-Qadam:** Valyuta Emojisiz kiriting (Masalan: `💎` yoki `🟡 UC`):");
  }

  if (state.step === 'AWAIT_GAME_EMOJI' && ctx.message.text) {
    state.data.currency = ctx.message.text.trim();
    state.data.id = Date.now();

    let games = (await storage.getItem('games')) || [];
    games.push(state.data);
    await storage.setItem('games', games);

    delete adminState[OWNER_ID];
    return ctx.reply(`🎉 **${state.data.name}** o'yini muvaffaqiyatli yaratildi va do'konga qo'shildi!`);
  }

  return next();
});

bot.launch();

// ================= API ENDPOINTS =================

app.get('/api/config', async (req, res) => {
  res.json({
    banners: (await storage.getItem('banners')) || [],
    games: (await storage.getItem('games')) || [],
    reviews: (await storage.getItem('reviews')) || [],
    bgMusic: (await storage.getItem('bgMusic')) || ''
  });
});

app.get('/api/top-users', async (req, res) => {
  const users = (await storage.getItem('users')) || {};
  const sorted = Object.values(users)
    .sort((a, b) => (b.spent || 0) - (a.spent || 0))
    .slice(0, 10);
  res.json(sorted);
});

app.get('/api/user/:id', async (req, res) => {
  const users = (await storage.getItem('users')) || {};
  res.json(users[req.params.id] || { balance: 0, spent: 0, ordersCount: 0 });
});

// HyperPin Real Verification
app.post('/api/verify-id', async (req, res) => {
  const { game, playerId } = req.body;

  try {
    const response = await axios.post(`${HYPERPIN_API_URL}/player-verify`, {
      game: game.toLowerCase().includes('pubg') ? 'pubg' : 'bloodstrike',
      player_id: playerId
    }, {
      headers: { 'Authorization': `Bearer ${HYPERPIN_API_KEY}` }
    });

    if (response.data && response.data.player_name) {
      return res.json({ success: true, name: response.data.player_name });
    } else {
      return res.json({ success: false, message: "Aka bunday ID topilmadi, tekshirib qayta yozing!" });
    }
  } catch (e) {
    return res.json({ success: false, message: "ID noto'g'ri yoki o'yinda bunday akkaunt yo'q!" });
  }
});

// Auto Purchase & HyperPin Integration
app.post('/api/buy', async (req, res) => {
  const { userId, gameId, packTitle, price, playerId } = req.body;
  let users = (await storage.getItem('users')) || {};
  const user = users[userId];

  if (!user || (user.balance || 0) < price) {
    return res.json({ success: false, message: "Mablag' yetarli emas! Hisobingizni to'ldiring." });
  }

  try {
    // Send Order to HyperPin API
    await axios.post(`${HYPERPIN_API_URL}/orders`, {
      player_id: playerId,
      pack: packTitle
    }, {
      headers: { 'Authorization': `Bearer ${HYPERPIN_API_KEY}` }
    });

    // Deduct Balance
    user.balance -= price;
    user.spent = (user.spent || 0) + price;
    user.ordersCount = (user.ordersCount || 0) + 1;
    await storage.setItem('users', users);

    let orders = (await storage.getItem('orders')) || [];
    orders.push({ userId, userName: user.name, pack: packTitle, price, date: new Date().toLocaleDateString() });
    await storage.setItem('orders', orders);

    return res.json({ success: true, newBalance: user.balance });
  } catch (err) {
    return res.json({ success: false, message: "HyperPin API bilan xatolik yuz berdi." });
  }
});

app.post('/api/reviews', async (req, res) => {
  const { name, text, stars } = req.body;
  let reviews = (await storage.getItem('reviews')) || [];
  reviews.push({ name, text, stars, date: new Date().toLocaleDateString() });
  await storage.setItem('reviews', reviews);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
