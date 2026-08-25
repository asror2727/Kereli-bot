app.post('/api/sms-receiver', async (req, res) => {
  try {
    const { message, secret } = req.body;

    console.log("[SMS KELDI]:", message);

    if (secret !== SMS_SECRET_KEY) {
      return res.status(403).json({ success: false });
    }

    if (!message) return res.status(400).json({ success: false });

    // 1. Bank SMS'idan summani ajratib olish (Masalan: 1 000.00 UZS, 15000 UZS, +50000 сум)
    const amountMatch = message.match(/(?:karta|to'lov|tushdi|baza|summa|balans)[\s\S]*?([\d\s\.]+)\s*(?:UZS|so'm|sum)/i) || 
                        message.match(/([\d\s\.]+)\s*UZS/i);

    if (amountMatch) {
      // Summani toza raqamga o'tkazish (1 000.00 -> 1000)
      const rawAmount = amountMatch[1].replace(/\s+/g, '').split('.')[0];
      const receivedAmount = parseInt(rawAmount, 10);

      console.log(`[AVTO TUSHUNDI] Summa: ${receivedAmount} so'm`);

      // 2. Bazadan kutilayotgan to'lovni avtomatik tasdiqlash kodi:
      // await autoApprovePayment(receivedAmount); 
    } else {
      console.log("[XATO] Summani aniqlab bo'lmadi");
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('SMS Error:', err);
    return res.status(500).json({ success: false });
  }
});
