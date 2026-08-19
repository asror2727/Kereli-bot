const TelegramBot = require('node-telegram-bot-api');
const { readDb, updateDb, getUser } = require('./db');

function initBot() {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'your_bot_token_here') {
    console.warn('⚠️  BOT_TOKEN .env faylda yo\'q — bot ishga tushirilmadi. Faqat sayt ishlaydi.');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  const webAppUrl = process.env.WEBAPP_URL;
  const channel = process.env.CHANNEL_USERNAME || 'arkootzif';
  const support = process.env.SUPPORT_USERNAME || 'x7fan';
  const ownerChatId = process.env.OWNER_CHAT_ID;

  // ---------- /start ----------
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const refCode = match && match[1] ? match[1].trim() : null;

    // Referal orqali kirgan yangi userni hisoblash
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
          bot.sendMessage(referrerId, `🎉 Sizning referal havolangiz orqali yangi foydalanuvchi qo'shildi!\n+200 so'm balansingizga qo'shildi.`).catch(() => {});
        }
      }
    });

    const db = readDb();
    const logo = db.splashLogo;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🛍 Do\'kon', web_app: { url: webAppUrl } }],
        [{ text: '📢 News', url: `https://t.me/${channel}` }],
        [{ text: '🆘 Support', url: `https://t.me/${support}` }]
      ]
    };

    const caption = "OlovPay — o'yin UC, Gold, Almaz va boshqa xaridlar uchun eng tezkor xizmat 🔥\n\nTugmalardan birini tanlang:";

    try {
      if (logo) {
        await bot.sendPhoto(chatId, logo, { caption, reply_markup: keyboard });
      } else {
        await bot.sendMessage(chatId, caption, { reply_markup: keyboard });
      }
    } catch (e) {
      // Agar logo rasm sifatida yuborilmasa (masalan noto'g'ri format), matn bilan yuborish
      await bot.sendMessage(chatId, caption, { reply_markup: keyboard });
    }
  });

  // ---------- Admin (owner) to'lovni Tasdiqlash / Bekor qilish ----------
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('dep_')) return;

    const [, action, depositId] = data.split('_'); // dep_confirm_<id> yoki dep_reject_<id>

    updateDb((db) => {
      const deposit = db.deposits.find((d) => d.id === depositId);
      if (!deposit || deposit.status !== 'pending') return;

      if (action === 'confirm') {
        deposit.status = 'confirmed';
        const user = getUser(db, deposit.userId);
        user.balance += deposit.amount;
        bot.sendMessage(deposit.userId, `✅ To'lovingiz tasdiqlandi! ${deposit.amount.toLocaleString('uz-UZ')} so'm balansingizga tushdi. Xarid qilishingiz mumkin.`).catch(() => {});
      } else if (action === 'reject') {
        deposit.status = 'rejected';
        bot.sendMessage(deposit.userId, `❌ To'lovingiz tasdiqlanmadi. Balki pul hali tushmagandir — birozdan keyin qayta urinib ko'ring yoki @${support} ga yozing.`).catch(() => {});
      }
    });

    bot.answerCallbackQuery(query.id, { text: action === 'confirm' ? 'Tasdiqlandi ✅' : 'Bekor qilindi ❌' }).catch(() => {});
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id }).catch(() => {});
  });

  console.log('🤖 Telegram bot ishga tushdi (polling).');
  return bot;
}

// Server.js dan chaqiriladi — foydalanuvchi "To'lovni amalga oshirdim" bosganda
// ownerga tasdiqlash tugmalari bilan xabar boradi.
function notifyOwnerNewDeposit(bot, deposit) {
  const ownerChatId = process.env.OWNER_CHAT_ID;
  if (!bot || !ownerChatId) return;
  const text = `💰 Yangi to'lov so'rovi\n\nFoydalanuvchi: ${deposit.userId}\nSumma: ${deposit.amount.toLocaleString('uz-UZ')} so'm\nUsul: ${deposit.method.toUpperCase()}\nVaqt: ${new Date(deposit.createdAt).toLocaleString('uz-UZ')}`;
  bot.sendMessage(ownerChatId, text, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Tasdiqlash', callback_data: `dep_confirm_${deposit.id}` },
        { text: '❌ Bekor qilish', callback_data: `dep_reject_${deposit.id}` }
      ]]
    }
  }).catch((e) => console.error('Ownerga xabar yuborilmadi:', e.message));
}

module.exports = { initBot, notifyOwnerNewDeposit };
