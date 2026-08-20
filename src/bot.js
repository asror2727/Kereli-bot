const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { readDb, updateDb, getUser } = require('./db');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const EMOJIS = ['🪙', '💎', '🎁', '🔫', '⭐', '🔥'];

// chatId -> { step, data }  — faqat admin bilan suhbat davomida vaqtinchalik saqlanadi
const sessions = new Map();

function initBot() {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'your_bot_token_here') {
    console.warn('⚠️  BOT_TOKEN .env faylda yo\'q — bot ishga tushirilmadi.');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  bot.on('polling_error', (err) => console.error('Polling xatosi (e\'tibor bermasa ham bo\'ladi):', err.message));

  const channel = process.env.CHANNEL_USERNAME || 'arkootzif';
  const support = process.env.SUPPORT_USERNAME || 'x7fan';
  const ownerChatId = process.env.OWNER_CHAT_ID;
  const webAppUrl = process.env.WEBAPP_URL;

  const isOwner = (chatId) => String(chatId) === String(ownerChatId);
  const cancelRow = [{ text: '❌ Bekor qilish', callback_data: 'adm|cancel' }];

  function toLocalPath(dbPath) {
    if (!dbPath) return null;
    return path.join(uploadsDir, path.basename(dbPath));
  }

  async function downloadPhoto(fileId) {
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
  // /start — mijozlar uchun (o'zgarishsiz)
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
    const caption = "OlovPay — o'yin UC, Gold, Almaz va boshqa xaridlar uchun eng tezkor xizmat 🔥\n\nTugmalardan birini tanlang:";

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
  // /admin — bosh menyu
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
    const text = '🔥 *OlovPay — Admin panel*\n\nBo\'limni tanlang:';
    const keyboard = {
      inline_keyboard: [
        [{ text: '🖼 Bannerlar', callback_data: 'adm|menu|banners' }, { text: '🎮 O\'yinlar', callback_data: 'adm|menu|games' }],
        [{ text: '🏆 Top', callback_data: 'adm|menu|top' }, { text: '💰 To\'lovlar', callback_data: 'adm|menu|deposits' }],
        [{ text: '📦 Buyurtmalar', callback_data: 'adm|menu|orders' }, { text: '🖼 Logo', callback_data: 'adm|menu|logo' }]
      ]
    };
    if (editMessageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
      });
    } else {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  // =========================================================
  // CALLBACK QUERY ROUTER
  // =========================================================
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data || '';

    // ---- eski to'lov tasdiqlash tugmalari (avtomatik xabar orqali kelgan) ----
    if (data.startsWith('dep_confirm_') || data.startsWith('dep_reject_')) {
      const action = data.startsWith('dep_confirm_') ? 'confirm' : 'reject';
      const depositId = data.slice(action === 'confirm' ? 'dep_confirm_'.length : 'dep_reject_'.length);
      handleDepositAction(depositId, action, chatId, msgId, query.id);
      return;
    }

    if (!data.startsWith('adm|')) return bot.answerCallbackQuery(query.id).catch(() => {});
    if (!isOwner(chatId)) return bot.answerCallbackQuery(query.id, { text: 'Ruxsat yo\'q' }).catch(() => {});

    const parts = data.split('|'); // ['adm', section, action, ...params]
    bot.answerCallbackQuery(query.id).catch(() => {});

    if (parts[1] === 'cancel') {
      sessions.delete(String(chatId));
      return sendMainMenu(chatId, msgId);
    }
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
    }
    if (parts[1] === 'banner') return handleBannerCallback(parts, chatId, msgId);
    if (parts[1] === 'game') return handleGameCallback(parts, chatId, msgId);
    if (parts[1] === 'pkg') return handlePkgCallback(parts, chatId, msgId);
    if (parts[1] === 'top') return handleTopCallback(parts, chatId, msgId);
    if (parts[1] === 'order') return handleOrderCallback(parts, chatId, msgId);
  });

  function handleDepositAction(depositId, action, chatId, msgId, queryId) {
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
      if (action === 'confirm') {
        bot.sendMessage(notifyUserId, `✅ To'lovingiz tasdiqlandi! ${amount.toLocaleString('uz-UZ')} so'm balansingizga tushdi.`).catch(() => {});
      } else {
        bot.sendMessage(notifyUserId, `❌ To'lovingiz tasdiqlanmadi. Balki pul hali tushmagandir, birozdan keyin qayta urinib ko'ring yoki @${support} ga yozing.`).catch(() => {});
      }
    }
    if (text) bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    else bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
  }

  // =========================================================
  // BANNERLAR
  // =========================================================
  function sendBannersMenu(chatId, msgId) {
    const db = readDb();
    const rows = [0, 1, 2].map((i) => {
      const b = db.banners[i];
      return [{ text: `${b ? '✅' : '⬜️'} Banner ${i + 1}`, callback_data: `adm|banner|view|${i}` }];
    });
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]);
    const text = '🖼 *Bannerlar* (3 ta slot)\n\nSlotni tanlang:';
    editOrSend(chatId, msgId, text, rows);
  }
  function handleBannerCallback(parts, chatId, msgId) {
    const action = parts[2];
    const slot = Number(parts[3]);
    if (action === 'view') {
      const db = readDb();
      const b = db.banners[slot];
      const text = b ? `🖼 *Banner ${slot + 1}*\n\nSarlavha: ${b.title || '—'}\nMatn: ${b.sub || '—'}` : `🖼 *Banner ${slot + 1}*\n\nHali bo'sh.`;
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

  // =========================================================
  // O'YINLAR
  // =========================================================
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
      editOrSend(chatId, msgId, '✏️ O\'yin nomini yozing (masalan: PUBG Mobile):', [cancelRow]);
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

  // =========================================================
  // PAKETLAR (UC / Prime)
  // =========================================================
  function handlePkgCallback(parts, chatId, msgId) {
    const action = parts[2];
    if (action === 'add') {
      const gameId = parts[3], type = parts[4];
      const rows = [EMOJIS.map((e, i) => ({ text: e, callback_data: `adm|pkg|emoji|${gameId}|${type}|${i}` }))];
      rows.push([{ text: '⬅️ Orqaga', callback_data: `adm|game|view|${gameId}` }]);
      editOrSend(chatId, msgId, `${type === 'uc' ? 'UC' : 'Prime'} paket uchun emoji tanlang:`, rows);
    }
    if (action === 'emoji') {
      const gameId = parts[3], type = parts[4], emoji = EMOJIS[Number(parts[5])];
      sessions.set(String(chatId), { step: 'pkg_text', data: { gameId, type, emoji } });
      editOrSend(chatId, msgId, `✏️ Nomi va narxini shu formatda yozing:\n\n\`60 UC-12000\`\n\n(chapda nomi, o'ngda narxi, orasida "-")`, [cancelRow], true);
    }
    if (action === 'list') {
      const gameId = parts[3];
      const db = readDb();
      const game = db.games.find((g) => g.id === gameId);
      if (!game) return sendGamesMenu(chatId, msgId);
      const rows = [];
      ['uc', 'prime'].forEach((type) => {
        (game.types[type] || []).forEach((p, idx) => {
          rows.push([{ text: `${p.icon} ${p.amt} — ${Number(p.price).toLocaleString('uz-UZ')} so'm`, callback_data: `adm|pkg|del|${gameId}|${type}|${idx}` }]);
        });
      });
      rows.push([{ text: '⬅️ Orqaga', callback_data: `adm|game|view|${gameId}` }]);
      const text = rows.length > 1 ? `📋 *${game.name}* paketlari\n\n(bosilsa o'chadi)` : `📋 *${game.name}*\n\nHali paket yo'q.`;
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

  // =========================================================
  // TOP
  // =========================================================
  function sendTopMenu(chatId, msgId) {
    const db = readDb();
    const text = `🏆 *Top xaridorlar*\n\nHozir ${db.topUsers.length} ta foydalanuvchi bor.`;
    const rows = [[{ text: '✏️ Ro\'yxatni tahrirlash', callback_data: 'adm|top|edit' }], [{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]];
    editOrSend(chatId, msgId, text, rows);
  }
  function handleTopCallback(parts, chatId, msgId) {
    if (parts[2] === 'edit') {
      sessions.set(String(chatId), { step: 'top_bulk', data: {} });
      editOrSend(chatId, msgId, '✏️ Har bir qatorga bitta foydalanuvchi, shu formatda yozing:\n\n`Ism | 12 buyurtma | 397 788 UZS`\n\nBir nechta qatorni birdan yuborsangiz bo\'ladi.', [cancelRow], true);
    }
  }

  // =========================================================
  // TO'LOVLAR
  // =========================================================
  function sendDepositsMenu(chatId, msgId) {
    const db = readDb();
    const pending = db.deposits.filter((d) => d.status === 'pending').slice(0, 15);
    if (!pending.length) {
      editOrSend(chatId, msgId, '💰 *To\'lovlar*\n\nKutilayotgan to\'lov yo\'q.', [[{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]]);
      return;
    }
    // Har birini alohida xabar qilib yuboramiz (tugmalar bilan), keyin menyuni qayta ko'rsatamiz
    bot.editMessageText(`💰 *To'lovlar* — ${pending.length} ta kutilmoqda:`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }).catch(() => {});
    pending.forEach((dep) => {
      bot.sendMessage(chatId, `💰 ${Number(dep.amount).toLocaleString('uz-UZ')} so'm — ${dep.method.toUpperCase()}\nFoydalanuvchi: ${dep.userId}\nVaqt: ${new Date(dep.createdAt).toLocaleString('uz-UZ')}`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `dep_confirm_${dep.id}` }, { text: '❌ Bekor qilish', callback_data: `dep_reject_${dep.id}` }]] }
      });
    });
    bot.sendMessage(chatId, 'Menyuga qaytish:', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Bosh menyu', callback_data: 'adm|menu|main' }]] } });
  }

  // =========================================================
  // BUYURTMALAR
  // =========================================================
  function sendOrdersMenu(chatId, msgId) {
    const db = readDb();
    const orders = db.orders.slice(0, 10);
    if (!orders.length) {
      editOrSend(chatId, msgId, '📦 *Buyurtmalar*\n\nHali buyurtma yo\'q.', [[{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]]);
      return;
    }
    const rows = orders.map((o) => {
      const label = `${o.status === 'processing' ? '🟡' : '✅'} ${o.packageLabel} (${o.gameName}) — ${Number(o.price).toLocaleString('uz-UZ')}`;
      return o.status === 'processing' ? [{ text: label, callback_data: `adm|order|done|${o.id}` }] : [{ text: label, callback_data: 'adm|noop' }];
    });
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm|menu|main' }]);
    editOrSend(chatId, msgId, '📦 *Buyurtmalar* (bosilsa "Bajarildi" bo\'ladi):', rows);
  }
  function handleOrderCallback(parts, chatId, msgId) {
    if (parts[2] === 'done') {
      const orderId = parts[3];
      updateDb((db) => {
        const order = db.orders.find((o) => o.id === orderId);
        if (order) order.status = 'done';
      });
      sendOrdersMenu(chatId, msgId);
    }
  }

  // =========================================================
  // LOGO
  // =========================================================
  function startLogoFlow(chatId, msgId) {
    sessions.set(String(chatId), { step: 'logo_photo', data: {} });
    editOrSend(chatId, msgId, '🖼 Yangi logo rasmini yuboring (bot /start xabarida va sayt yuklanish ekranida shu chiqadi):', [cancelRow]);
  }

  // =========================================================
  // MATN / RASM XABARLARI (session bosqichlarini davom ettirish)
  // =========================================================
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isOwner(chatId)) return;
    const session = sessions.get(String(chatId));
    if (!session) return;
    if (msg.text === '/cancel') { sessions.delete(String(chatId)); bot.sendMessage(chatId, 'Bekor qilindi.'); sendMainMenu(chatId); return; }

    try {
      switch (session.step) {
        case 'banner_photo': {
          if (!msg.photo) return bot.sendMessage(chatId, '📸 Iltimos, rasm yuboring.');
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          const image = await downloadPhoto(fileId);
          session.data.image = image;
          session.step = 'banner_title';
          bot.sendMessage(chatId, '✏️ Endi sarlavha yozing (masalan: Aksiya 20%):');
          break;
        }
        case 'banner_title': {
          session.data.title = msg.text || '';
          session.step = 'banner_sub';
          bot.sendMessage(chatId, '✏️ Qo\'shimcha matn yozing (bo\'lmasa "-" deb yuboring):');
          break;
        }
        case 'banner_sub': {
          const sub = msg.text === '-' ? '' : (msg.text || '');
          const { slot, image, title } = session.data;
          updateDb((db) => { db.banners[slot] = { image, title, sub }; });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ Banner ${slot + 1} saqlandi!`);
          sendMainMenu(chatId);
          break;
        }
        case 'game_name': {
          session.data.name = msg.text || 'O\'yin';
          session.step = 'game_photo';
          bot.sendMessage(chatId, '📸 Endi o\'yin uchun rasm yuboring:');
          break;
        }
        case 'game_photo': {
          if (!msg.photo) return bot.sendMessage(chatId, '📸 Iltimos, rasm yuboring.');
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          const image = await downloadPhoto(fileId);
          const newGame = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: session.data.name, rating: '5 · 0', image, types: { uc: [], prime: [] } };
          updateDb((db) => { db.games.push(newGame); });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ "${newGame.name}" qo'shildi!`);
          sendMainMenu(chatId);
          break;
        }
        case 'pkg_text': {
          const text = (msg.text || '').trim();
          const idx = text.lastIndexOf('-');
          if (idx === -1) { bot.sendMessage(chatId, '❌ Format noto\'g\'ri. Masalan: 60 UC-12000'); return; }
          const amt = text.slice(0, idx).trim();
          const price = parseInt(text.slice(idx + 1).trim().replace(/\s/g, ''), 10);
          if (!amt || isNaN(price)) { bot.sendMessage(chatId, '❌ Format noto\'g\'ri. Masalan: 60 UC-12000'); return; }
          const { gameId, type, emoji } = session.data;
          updateDb((db) => {
            const game = db.games.find((g) => g.id === gameId);
            if (game) { if (!game.types[type]) game.types[type] = []; game.types[type].push({ icon: emoji, amt, price }); }
          });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, `✅ Paket qo'shildi: ${emoji} ${amt} — ${price.toLocaleString('uz-UZ')} so'm`);
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
          bot.sendMessage(chatId, `✅ Top ro'yxati saqlandi (${topUsers.length} ta).`);
          sendMainMenu(chatId);
          break;
        }
        case 'logo_photo': {
          if (!msg.photo) return bot.sendMessage(chatId, '📸 Iltimos, rasm yuboring.');
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          const image = await downloadPhoto(fileId);
          updateDb((db) => { db.splashLogo = image; });
          sessions.delete(String(chatId));
          bot.sendMessage(chatId, '✅ Logo yangilandi!');
          sendMainMenu(chatId);
          break;
        }
      }
    } catch (e) {
      console.error('Admin session xatosi:', e.message);
      bot.sendMessage(chatId, '❌ Xatolik yuz berdi, qaytadan urinib ko\'ring yoki /admin bilan qaytadan boshlang.');
      sessions.delete(String(chatId));
    }
  });

  // Yordamchi: matnni tahrirlash yoki (agar iloji bo'lmasa) yangi xabar yuborish
  function editOrSend(chatId, msgId, text, rows, markdown = false) {
    const opts = { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rows } };
    if (markdown) opts.parse_mode = 'Markdown'; else opts.parse_mode = 'Markdown';
    if (msgId) {
      bot.editMessageText(text, opts).catch(() => {
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
      });
    } else {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
    }
  }

  console.log('🤖 Telegram bot ishga tushdi (polling) — admin panel botning o\'zida ishlaydi.');
  return bot;
}

function notifyOwnerNewDeposit(bot, deposit) {
  const ownerChatId = process.env.OWNER_CHAT_ID;
  if (!bot || !ownerChatId) return;
  const text = `💰 Yangi to'lov so'rovi\n\nFoydalanuvchi: ${deposit.userId}\nSumma: ${deposit.amount.toLocaleString('uz-UZ')} so'm\nUsul: ${deposit.method.toUpperCase()}\nVaqt: ${new Date(deposit.createdAt).toLocaleString('uz-UZ')}`;
  bot.sendMessage(ownerChatId, text, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `dep_confirm_${deposit.id}` }, { text: '❌ Bekor qilish', callback_data: `dep_reject_${deposit.id}` }]] }
  }).catch((e) => console.error('Ownerga xabar yuborilmadi:', e.message));
}

module.exports = { initBot, notifyOwnerNewDeposit };
