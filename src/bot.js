const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { readDb, updateDb, getUser } = require('./db');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const sessions = new Map();
const customerSessions = new Map();

let botUsernameCache = null;
function getBotUsername() { return botUsernameCache; }

function initBot() {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'your_bot_token_here') {
    console.warn('⚠️  BOT_TOKEN .env faylda yo\'q — bot ishga tushirilmadi.');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  bot.on('polling_error', (err) => console.error('Polling xatosi:', err.message));
  bot.getMe().then((me) => { botUsernameCache = me.username; }).catch(() => {});

  const channel = process.env.CHANNEL_USERNAME || 'arkootzif';
  const support = process.env.SUPPORT_USERNAME || 'x7fan';
  const ownerChatId = process.env.OWNER_CHAT_ID;
  const webAppUrl = process.env.WEBAPP_URL;

  function isOwner(chatId) {
    if (String(chatId) === String(ownerChatId)) return true;
    const db = readDb();
    return (db.admins || []).includes(String(chatId));
  }

  function getAllAdminIds(db) {
    const set = new Set([String(ownerChatId), ...(db.admins || [])]);
    set.delete('undefined');
    return [...set];
  }

  const cancelRow = [{ text: '❌ Bekor qilish', callback_data: 'adm|cancel' }];

  function toLocalPath(dbPath) {
    if (!dbPath) return null;
    return path.join(uploadsDir, path.basename(dbPath));
  }

  async function downloadTelegramFile(fileId) {
    const link = await bot.getFileLink(fileId);
    const ext = path.extname(link.split('?')[0]) || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const dest = path.join(uploadsDir, filename);
    const response = await axios.get(link, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(dest);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    return `/uploads/${filename}`;
  }

  // =========================================================
  // /start — FAQAT YANGI MATN VA TUGMALAR
  // =========================================================
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const refCode = match && match[1] ? match[1].trim() : null;

    updateDb((db) => {
      const user = getUser(db, chatId);
      if (refCode && !user.referredBy && refCode !== user.refCode) {
        const referrer = Object.entries(db.users).find(([, u]) => u.refCode === refCode);
        if (referrer) {
          const [referrerId, referrerData] = referrer;
          user.referredBy = referrerId;
          referrerData.balance += 200;
          referrerData.refCount += 1;
          referrerData.refEarned += 200;
          bot.sendMessage(referrerId, `🎉 Referal havolangiz orqali yangi foydalanuvchi qo'shildi!\n+200 so'm balansingizga qo'shildi.`).catch(() => {});
        }
      }
    });

    const db = readDb();
    const keyboard = {
      inline_keyboard: [
        [{ text: '🛍 Do\'kon', web_app: { url: webAppUrl } }],
        [{ text: '📢 News', url: `https://t.me/${channel}` }],
        [{ text: '🆘 Support', url: `https://t.me/${support}` }]
      ]
    };
    const caption = "FlayPay — o'yin UC, Gold, Almaz va boshqa xaridlar uchun eng tezkor xizmat 🔥\n\nTugmalardan birini tanlang:";

    try {
      const localLogo = toLocalPath(db.splashLogo);
      if (localLogo && fs.existsSync(localLogo)) {
        await bot.sendPhoto(chatId, localLogo, { caption, reply_markup: keyboard });
      } else {
        await bot.sendMessage(chatId, caption, { reply_markup: keyboard });
      }
    } catch (e) {
      await bot.sendMessage(chatId, caption, { reply_markup: keyboard });
    }
  });

  // =========================================================
  // /admin — ADMIN PANEL
  // =========================================================
  bot.onText(/\/admin/, (msg) => {
    if (!isOwner(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, 'Bu buyruq faqat admin uchun.');
      return;
    }
    sessions.delete(String(msg.chat.id));
    sendMainMenu(msg.chat.id);
  });

  function sendMainMenu(chatId, editMessageId) {
    const text = '🔥 *FlayPay — Admin panel*\n\nBo\'limni tanlang:';
    const rows = [
      [{ text: '🖼 Bannerlar', callback_data: 'adm|menu|banners' }, { text: '🎮 O\'yinlar', callback_data: 'adm|menu|games' }],
      [{ text: '🏆 Top', callback_data: 'adm|menu|top' }, { text: '💰 To\'lovlar', callback_data: 'adm|menu|deposits' }],
      [{ text: '📦 Buyurtmalar', callback_data: 'adm|menu|orders' }, { text: '🖼 Logo', callback_data: 'adm|menu|logo' }],
      [{ text: '🎵 Musiqa', callback_data: 'adm|menu|music' }, { text: '👥 Adminlar', callback_data: 'adm|menu|admins' }]
    ];
    editOrSend(chatId, editMessageId, text, rows);
  }

  // =========================================================
  // CALLBACK QUERY HANDLER
  // =========================================================
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data || '';

    if (data.startsWith('dep_confirm_') || data.startsWith('dep_reject_')) {
      const action = data.startsWith('dep_confirm_') ? 'confirm' : 'reject';
      const depositId = data.slice(action === 'confirm' ? 'dep_confirm_'.length : 'dep_reject_'.length);
      if (!isOwner(chatId)) return bot.answerCallbackQuery(query.id, { text: 'Ruxsat yo\'q' }).catch(() => {});
      handleDepositAction(depositId, action, chatId, msgId);
      bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    if (data.startsWith('ord_confirm_') || data.startsWith('ord_reject_')) {
      const action = data.startsWith('ord_confirm_') ? 'confirm' : 'reject';
      const orderId = data.slice(action === 'confirm' ? 'ord_confirm_'.length : 'ord_reject_'.length);
      if (!isOwner(chatId)) return bot.answerCallbackQuery(query.id, { text: 'Ruxsat yo\'q' }).catch(() => {});
      handleOrderAction(orderId, action, chatId, msgId);
      bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    if (data.startsWith('rate|')) {
      const [, orderId, val] = data.split('|');
      handleRating(orderId, Number(val), chatId, msgId);
      bot.answerCallbackQuery(query.id, { text: 'Rahmat!' }).catch(() => {});
      return;
    }
    if (data.startsWith('revcmt|')) {
      const [, orderId] = data.split('|');
      customerSessions.set(String(chatId), { step: 'review_comment', data: { orderId } });
      bot.sendMessage(chatId, '✏️ Izohingizni yozing:');
      bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }
    if (data === 'revskip') {
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
      bot.answerCallbackQuery(query.id, { text: 'Rahmat!' }).catch(() => {});
      return;
    }

    if (!data.startsWith('adm|')) return bot.answerCallbackQuery(query.id).catch(() => {});
    if (!isOwner(chatId)) return bot.answerCallbackQuery(query.id, { text: 'Ruxsat yo\'q' }).catch(() => {});

    const parts = data.split('|');
    bot.answerCallbackQuery(query.id).catch(() => {});

    if (parts[1] === 'noop') return;
    if (parts[1] === 'cancel') { sessions.delete(String(chatId)); return sendMainMenu(chatId, msgId); }
    if (parts[1] === 'menu') {
      sessions.delete(String(chatId));
      const section = parts[2];
      if (section === 'main') return sendMainMenu(chatId, msgId);
      if (section === 'banners') return sendBannersMenu(chatId, msgId);
      if (section === 'games') return sendGamesMenu(chatId, msgId);
      if (section === 'top') return sendTopMenu(chatId, msgId);
      if (section === 'deposits') return sendDepositsMenu(chatId, msgId);
      if (section === 'orders') return sendOrdersMenu(chatId, msgId);
      if (section === 'logo') return startLogoFlow(chatId, msgId);
      if (section === 'music') return startMusicFlow(chatId, msgId);
      if (section === 'admins') return sendAdminsMenu(chatId, msgId);
    }
    if (parts[1] === 'banner') return handleBannerCallback(parts, chatId, msgId);
    if (parts[1] === 'game') return handleGameCallback(parts, chatId, msgId);
    if (parts[1] === 'pkg') return handlePkgCallback(parts, chatId, msgId);
    if (parts[1] === 'top') return handleTopCallback(parts, chatId, msgId);
    if (parts[1] === 'admins') return handleAdminsCallback(parts, chatId, msgId);
  });

  function handleDepositAction(depositId, action, chatId, msgId) {
    let notifyUserId = null, amount = 0, text = '';
    updateDb((db) => {
      const dep = db.deposits.find((d) => d.id === depositId);
      if (!dep || dep.status !== 'pending') return;
      if (action === 'confirm') {
        dep.status = 'confirmed';
        getUser(db, dep.userId).balance += dep.amount;
        notifyUserId = dep.userId; amount = dep.amount;
        text = `✅ ${amount.toLocaleString('uz-UZ')} so'mlik to'lov tasdiqlandi.`;
      } else {
        dep.status = 'rejected';
        notifyUserId = dep.userId;
        text = `❌ To'lov bekor qilindi.`;
      }
    });
    if (notifyUserId) {
      if (action === 'confirm') bot.sendMessage(notifyUserId, `✅ To'lovingiz tasdiqlandi! ${amount.toLocaleString('uz-UZ')} so'm balansingizga tushdi.`).catch(() => {});
      else bot.sendMessage(notifyUserId, `❌ To'lovingiz tasdiqlanmadi. Admin bilan bog'laning: @${support}`).catch(() => {});
    }
    if (text) bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    else bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
  }

  function handleOrderAction(orderId, action, chatId, msgId) {
    let result = null;
    updateDb((db) => {
      const order = db.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'pending') return;
      if (action === 'confirm') {
        order.status = 'done';
        order.completedAt = new Date().toISOString();
      } else {
        order.status = 'rejected';
        getUser(db, order.userId).balance += order.price;
      }
      result = { ...order };
    });

    if (!result) {
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
      bot.sendMessage(chatId, 'Bu buyurtma allaqachon ko\'rib chiqilgan.');
      return;
    }

    const when = new Date(result.completedAt || result.createdAt).toLocaleString('uz-UZ');

    if (action === 'confirm') {
      bot.editMessageText(`✅ Tasdiqlandi — #${result.number}`, { chat_id: chatId, message_id: msgId }).catch(() => {});

      const customerText = `✅ Buyurtmangiz muvaffaqiyatli yakunlandi!\n\n🧾 Buyurtma: #${result.number}\n🎮 O'yin: ${result.gameName}\n📦 Miqdor: ${result.packageLabel}\n🆔 O'yinchi ID: ${result.playerId}\n💰 Narx: ${Number(result.price).toLocaleString('uz-UZ')} so'm\n🕐 Yakunlandi: ${when}\n\n❤️ Ishonchingiz uchun rahmat!`;
      bot.sendMessage(result.userId, customerText).then(() => {
        bot.sendMessage(result.userId, 'Xizmatimizni baholab bera olasizmi? ⭐', {
          reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: String(n), callback_data: `rate|${result.id}|${n}` }))] }
        });
      }).catch(() => {});
    } else {
      bot.editMessageText(`❌ Bekor qilindi — #${result.number}`, { chat_id: chatId, message_id: msgId }).catch(() => {});
      const customerText = `❌ Buyurtmangiz bekor qilindi.\n\nBuyurtma: #${result.number}\n💰 ${Number(result.price).toLocaleString('uz-UZ')} so'm balansingizga qaytarildi.\n\nSavol bo'lsa @${support} ga yozing.`;
      bot.sendMessage(result.userId, customerText).catch(() => {});
    }
  }

  function handleRating(orderId, val, chatId, msgId) {
    bot.editMessageText(`✅ Bahoyingiz uchun rahmat! ${'⭐'.repeat(val)}`, { chat_id: chatId, message_id: msgId }).catch(() => {});
    bot.sendMessage(chatId, 'Izoh ham qoldirmoqchimisiz?', {
      reply_markup: { inline_keyboard: [[{ text: '✏️ Izoh qoldirish', callback_data: `revcmt|${orderId}` }, { text: '⏭ Kerak emas', callback_data: 'revskip' }]] }
    });
  }

  function sendBannersMenu(chatId, msgId) {
    const db = readDb();
    const rows = [0, 1, 2].map((i) => {
      const b = db.banners[i];
      return [{ text: `${b ? '✅' : '⬜️'} Banner ${i + 1}`, callback_data: `adm|banner|view|${i}` }];
    });
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]);
    editOrSend(chatId, msgId, '🖼 *Bannerlar* (3 ta slot)\n\nSlotni tanlang:', rows);
  }

  function handleBannerCallback(parts, chatId, msgId) {
    const action = parts[2];
    const slot = Number(parts[3]);
    if (action === 'view') {
      const db = readDb();
      const b = db.banners[slot];
      const text = b ? `🖼 *Banner ${slot + 1}*\n\nRasm o'rnatilgan.` : `🖼 *Banner ${slot + 1}*\n\nHali bo'sh.`;
      const rows = [
        [{ text: '🔄 Yangilash', callback_data: `adm|banner|update|${slot}` }],
        ...(b ? [[{ text: '🗑 O\'chirish', callback_data: `adm|banner|delete|${slot}` }]] : []),
        [{ text: '⬅️ Orqaga', callback_data: 'adm|menu|banners' }]
      ];
      editOrSend(chatId, msgId, text, rows);
    }
    if (action === 'update') {
      sessions.set(String(chatId), { step: 'banner_photo', data: { slot } });
      editOrSend(chatId, msgId, '📸 Banner uchun rasm yuboring:', [cancelRow]);
    }
    if (action === 'delete') {
      updateDb((db) => { db.banners[slot] = null; });
      sendBannersMenu(chatId, msgId);
    }
  }

  function sendGamesMenu(chatId, msgId) {
    const db = readDb();
    const rows = db.games.map((g) => [{ text: `🎮 ${g.name}`, callback_data: `adm|game|view|${g.id}` }]);
    rows.push([{ text: '➕ Yangi o\'yin qo\'shish', callback_data: 'adm|game|add' }]);
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]);
    const text = db.games.length ? '🎮 *O\'yinlar*' : '🎮 *O\'yinlar*\n\nHali o\'yin qo\'shilmagan.';
    editOrSend(chatId, msgId, text, rows);
  }

  function handleGameCallback(parts, chatId, msgId) {
    const action = parts[2];
    if (action === 'add') {
      sessions.set(String(chatId), { step: 'game_name', data: {} });
      editOrSend(chatId, msgId, '✏️ O\'yin nomini yozing:', [cancelRow]);
      return;
    }
    const gameId = parts[3];
    const db = readDb();
    const game = db.games.find((g) => g.id === gameId);
    if (!game) return sendGamesMenu(chatId, msgId);

    if (action === 'view') {
      const ucCount = (game.types.uc || []).length;
      const primeCount = (game.types.prime || []).length;
      const text = `🎮 *${game.name}*\nReyting: ${game.rating || '—'}\n\nUC paketlari: ${ucCount}\nPrime paketlari: ${primeCount}`;
      const rows = [
        [{ text: '➕ UC paket', callback_data: `adm|pkg|add|${gameId}|uc` }, { text: '➕ Prime paket', callback_data: `adm|pkg|add|${gameId}|prime` }],
        [{ text: '📋 Paketlar ro\'yxati', callback_data: `adm|pkg|list|${gameId}` }],
        [{ text: '🗑 O\'yinni o\'chirish', callback_data: `adm|game|delete|${gameId}` }],
        [{ text: '⬅️ Orqaga', callback_data: 'adm|menu|games' }]
      ];
      editOrSend(chatId, msgId, text, rows);
    }
    if (action === 'delete') {
      updateDb((db2) => { db2.games = db2.games.filter((g) => g.id !== gameId); });
      sendGamesMenu(chatId, msgId);
    }
  }

  function handlePkgCallback(parts, chatId, msgId) {
    const action = parts[2];
    if (action === 'add') {
      const gameId = parts[3], type = parts[4];
      sessions.set(String(chatId), { step: 'pkg_icon', data: { gameId, type } });
      editOrSend(chatId, msgId, `${type === 'uc' ? 'UC' : 'Prime'} paket uchun ikonka yuboring (Emoji yoki Rasm):`, [cancelRow]);
    }
    if (action === 'list') {
      const gameId = parts[3];
      const db = readDb();
      const game = db.games.find((g) => g.id === gameId);
      if (!game) return sendGamesMenu(chatId, msgId);
      const rows = [];
      ['uc', 'prime'].forEach((type) => {
        (game.types[type] || []).forEach((p, idx) => {
          const iconLabel = p.icon && p.icon.startsWith('/uploads/') ? '🖼' : p.icon;
          rows.push([{ text: `${iconLabel} ${p.amt} — ${Number(p.price).toLocaleString('uz-UZ')} so'm`, callback_data: `adm|pkg|del|${gameId}|${type}|${idx}` }]);
        });
      });
      rows.push([{ text: '⬅️ Orqaga', callback_data: `adm|game|view|${gameId}` }]);
      const text = rows.length > 1 ? `📋 *${game.name}* paketlari` : `📋 *${game.name}*\n\nHali paket yo'q.`;
      editOrSend(chatId, msgId, text, rows);
    }
    if (action === 'del') {
      const gameId = parts[3], type = parts[4], idx = Number(parts[5]);
      updateDb((db) => {
        const game = db.games.find((g) => g.id === gameId);
        if (game && game.types[type]) game.types[type].splice(idx, 1);
      });
      handlePkgCallback(['adm', 'pkg', 'list', gameId], chatId, msgId);
    }
  }

  function sendTopMenu(chatId, msgId) {
    const db = readDb();
    const text = `🏆 *Top xaridorlar*\n\nHozir ${db.topUsers.length} ta foydalanuvchi bor.`;
    const rows = [[{ text: '✏️ Ro\'yxatni tahrirlash', callback_data: 'adm|top|edit' }], [{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]];
    editOrSend(chatId, msgId, text, rows);
  }

  function handleTopCallback(parts, chatId, msgId) {
    if (parts[2] === 'edit') {
      sessions.set(String(chatId), { step: 'top_bulk', data: {} });
      editOrSend(chatId, msgId, '✏️ Har bir qatorga: `Ism | 12 buyurtma | 397 788 UZS` formatda yozing:', [cancelRow]);
    }
  }

  function sendDepositsMenu(chatId, msgId) {
    const db = readDb();
    const pending = db.deposits.filter((d) => d.status === 'pending').slice(0, 15);
    if (!pending.length) {
      editOrSend(chatId, msgId, '💰 *To\'lovlar*\n\nKutilayotgan to\'lov yo\'q.', [[{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]]);
      return;
    }
    bot.editMessageText(`💰 *To'lovlar* — ${pending.length} ta kutilmoqda:`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }).catch(() => {});
    pending.forEach((dep) => {
      bot.sendMessage(chatId, `💰 ${Number(dep.amount).toLocaleString('uz-UZ')} so'm — ${dep.method.toUpperCase()}\nFoydalanuvchi: ${dep.userId}`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `dep_confirm_${dep.id}` }, { text: '❌ Bekor qilish', callback_data: `dep_reject_${dep.id}` }]] }
      });
    });
    bot.sendMessage(chatId, 'Menyuga qaytish:', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Bosh menyu', callback_data: 'adm|menu|main' }]] } });
  }

  function sendOrdersMenu(chatId, msgId) {
    const db = readDb();
    const pending = db.orders.filter((o) => o.status === 'pending').slice(0, 15);
    if (!pending.length) {
      editOrSend(chatId, msgId, '📦 *Buyurtmalar*\n\nKutilayotgan buyurtma yo\'q.', [[{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]]);
      return;
    }
    bot.editMessageText(`📦 *Buyurtmalar* — ${pending.length} ta kutilmoqda:`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }).catch(() => {});
    pending.forEach((order) => sendOrderNotification(order));
    bot.sendMessage(chatId, 'Menyuga qaytish:', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Bosh menyu', callback_data: 'adm|menu|main' }]] } });
  }

  function sendOrderNotification(order) {
    const db = readDb();
    const text = `📦 Buyurtma #${order.number}\n\n👤 Foydalanuvchi: ${order.userName || 'Nomsiz'}\n🆔 User ID: ${order.userId}\n🎮 O'yin: ${order.gameName}\n📦 Miqdor: ${order.packageLabel}\n🆔 O'yinchi ID: ${order.playerId}\n💰 Narx: ${Number(order.price).toLocaleString('uz-UZ')} so'm`;
    getAllAdminIds(db).forEach((adminId) => {
      bot.sendMessage(adminId, text, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `ord_confirm_${order.id}` }, { text: '❌ Bekor qilish', callback_data: `ord_reject_${order.id}` }]] }
      }).catch(() => {});
    });
  }

  function startLogoFlow(chatId, msgId) {
    sessions.set(String(chatId), { step: 'logo_photo', data: {} });
    editOrSend(chatId, msgId, '🖼 Yangi logo rasmini yuboring:', [cancelRow]);
  }

  function startMusicFlow(chatId, msgId) {
    sessions.set(String(chatId), { step: 'music_file', data: {} });
    editOrSend(chatId, msgId, '🎵 Musiqa audio faylini yuboring:', [cancelRow]);
  }

  function sendAdminsMenu(chatId, msgId) {
    const db = readDb();
    const rows = (db.admins || []).map((id) => [{ text: `🗑 ${id}`, callback_data: `adm|admins|del|${id}` }]);
    rows.push([{ text: '➕ Admin qo\'shish', callback_data: 'adm|admins|add' }]);
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]);
    const text = `👥 *Adminlar*\n\nAsosiy: \`${ownerChatId}\``;
    editOrSend(chatId, msgId, text, rows);
  }

  function handleAdminsCallback(parts, chatId, msgId) {
    if (parts[2] === 'add') {
      sessions.set(String(chatId), { step: 'admin_add', data: {} });
      editOrSend(chatId, msgId, '✏️ Yangi adminning Telegram ID raqamini yuboring:', [cancelRow]);
    }
    if (parts[2] === 'del') {
      const id = parts[3];
      updateDb((db) => { db.admins = (db.admins || []).filter((a) => a !== id); });
      sendAdminsMenu(chatId, msgId);
    }
  }

  // =========================================================
  // MESSAGE HANDLER
  // =========================================================
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    const custSession = customerSessions.get(String(chatId));
    if (custSession && custSession.step === 'review_comment') {
      const name = msg.from.first_name || msg.from.username || 'Mijoz';
      updateDb((d) => { d.reviews.unshift({ name, stars: 5, text: msg.text || '' }); d.reviews = d.reviews.slice(0, 50); });
      customerSessions.delete(String(chatId));
      bot.sendMessage(chatId, 'Izoh uchun rahmat! ❤️');
      return;
    }

    if (!isOwner(chatId)) return;
    const session = sessions.get(String(chatId));
    if (!session) return;

    try {
      switch (session.step) {
        case 'banner_photo': {
          if (!msg.photo) return bot.sendMessage(chatId, '📸 Iltimos, rasm yuboring.');
          const image = await downloadTelegramFile(msg.photo[msg.photo.length - 1].file_id);
          updateDb((db) => { db.banners[session.data.slot] = { image }; });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ Banner saqlandi!`);
          sendMainMenu(chatId);
          break;
        }
        case 'game_name': {
          session.data.name = msg.text || 'O\'yin';
          session.step = 'game_photo';
          bot.sendMessage(chatId, '📸 Endi o\'yin rasmini yuboring:');
          break;
        }
        case 'game_photo': {
          if (!msg.photo) return bot.sendMessage(chatId, '📸 Iltimos, rasm yuboring.');
          const image = await downloadTelegramFile(msg.photo[msg.photo.length - 1].file_id);
          const newGame = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: session.data.name, rating: '5 · 0', image, types: { uc: [], prime: [] } };
          updateDb((db) => { db.games.push(newGame); });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ "${newGame.name}" qo'shildi!`);
          sendMainMenu(chatId);
          break;
        }
        case 'pkg_icon': {
          let icon;
          if (msg.photo) icon = await downloadTelegramFile(msg.photo[msg.photo.length - 1].file_id);
          else if (msg.text) icon = msg.text.trim();
          else return bot.sendMessage(chatId, '❌ Emoji yozing yoki rasm yuboring.');
          session.data.icon = icon;
          session.step = 'pkg_text';
          bot.sendMessage(chatId, '✏️ Nomi va narxini yozing (masalan: 60 UC-12000):');
          break;
        }
        case 'pkg_text': {
          const text = (msg.text || '').trim();
          const idx = text.lastIndexOf('-');
          if (idx === -1) return bot.sendMessage(chatId, '❌ Noto\'g\'ri format. Masalan: 60 UC-12000');
          const amt = text.slice(0, idx).trim();
          const price = parseInt(text.slice(idx + 1).trim().replace(/\s/g, ''), 10);
          if (!amt || isNaN(price)) return bot.sendMessage(chatId, '❌ Noto\'g\'ri format. Masalan: 60 UC-12000');
          const { gameId, type, icon } = session.data;
          updateDb((db) => {
            const game = db.games.find((g) => g.id === gameId);
            if (game) { if (!game.types[type]) game.types[type] = []; game.types[type].push({ icon, amt, price }); }
          });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ Paket qo'shildi!`);
          sendMainMenu(chatId);
          break;
        }
        case 'top_bulk': {
          const lines = (msg.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
          const medals = ['🥇', '🥈', '🥉'];
          const topUsers = lines.map((line, i) => {
            const [name, sub, amt] = line.split('|').map((s) => (s || '').trim());
            return { rank: i + 1, medal: medals[i] || null, name: name || '—', sub: sub || '', amt: amt || '', initial: (name || '?')[0].toUpperCase() };
          });
          updateDb((db) => { db.topUsers = topUsers; });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ Top saqlandi!`);
          sendMainMenu(chatId);
          break;
        }
        case 'logo_photo': {
          if (!msg.photo) return bot.sendMessage(chatId, '📸 Iltimos, rasm yuboring.');
          const image = await downloadTelegramFile(msg.photo[msg.photo.length - 1].file_id);
          updateDb((db) => { db.splashLogo = image; });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, '✅ Logo yangilandi!');
          sendMainMenu(chatId);
          break;
        }
        case 'music_file': {
          const fileObj = msg.audio || msg.voice || (msg.document && /audio|mpeg/.test(msg.document.mime_type || '') ? msg.document : null);
          if (!fileObj) return bot.sendMessage(chatId, '🎵 Iltimos, audio fayl yuboring.');
          const url = await downloadTelegramFile(fileObj.file_id);
          updateDb((db) => { db.musicUrl = url; });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, '✅ Musiqa yangilandi!');
          sendMainMenu(chatId);
          break;
        }
        case 'admin_add': {
          const id = (msg.text || '').trim();
          if (!/^\d+$/.test(id)) return bot.sendMessage(chatId, '❌ Faqat raqam yuboring.');
          updateDb((db) => { if (!db.admins) db.admins = []; if (!db.admins.includes(id)) db.admins.push(id); });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ Admin qo'shildi: ${id}`);
          sendMainMenu(chatId);
          break;
        }
      }
    } catch (e) {
      console.error('Session xatosi:', e.message);
      sessions.delete(String(chatId));
    }
  });

  function editOrSend(chatId, msgId, text, rows) {
    const opts = { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
    if (msgId) {
      bot.editMessageText(text, opts).catch(() => {
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
      });
    } else {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    }
  }

  function sendDepositNotification(deposit) {
    const db = readDb();
    const text = `💰 Yangi to'lov so'rovi\n\nFoydalanuvchi: ${deposit.userId}\nSumma: ${deposit.amount.toLocaleString('uz-UZ')} so'm`;
    getAllAdminIds(db).forEach((adminId) => {
      bot.sendMessage(adminId, text, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `dep_confirm_${deposit.id}` }, { text: '❌ Bekor qilish', callback_data: `dep_reject_${deposit.id}` }]] }
      }).catch(() => {});
    });
  }

  console.log('🤖 Telegram bot ishga tushdi.');
  bot._sendOrderNotification = sendOrderNotification;
  bot._sendDepositNotification = sendDepositNotification;
  return bot;
}

module.exports = { initBot, getBotUsername };
