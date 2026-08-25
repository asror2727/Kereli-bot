const Payment = require('./models/Payment');

module.exports = (bot) => {
  bot.action(/check_payment_(.+)/, async (ctx) => {
    try {
      const paymentId = ctx.match[1];
      const payment = await Payment.findById(paymentId);

      if (!payment) {
        return ctx.reply("⚠️ To'lov topilmadi yoki muddati o'tgan.");
      }

      if (payment.status === 'PAID') {
        return ctx.reply("✅ Ushbu to'lov allaqachon balansingizga tushirilgan!");
      }

      if (payment.status === 'PENDING') {
        return ctx.reply(
          `❌ **To'lov aniqlanmadi!**\n\n` +
          `Siz ko'rsatilgan **${payment.amount} so'm** summani kartaga o'tkazmagansiz yoki bank SMS-xabari hali yetib kelmadi.\n\n` +
          `Agar pulingiz yechilgan bo'lsa, adminga murojaat qiling: @admin_username`
        );
      }
    } catch (err) {
      console.error(err);
      ctx.reply("Xatolik yuz berdi. Qaytadan urinib ko'ring.");
    }
  });
};
