// Serverless-функция (формат Vercel) — создаёт платёж в Т-Кассе и возвращает ссылку на оплату.
// Требует переменные окружения:
//   TINKOFF_TERMINAL_KEY  — TerminalKey из личного кабинета Т-Кассы
//   TINKOFF_PASSWORD      — секретный пароль терминала (НЕ публиковать, только в .env / настройках хостинга)
//   SITE_URL              — https://amskills.ru (для Success/Fail редиректов)
const crypto = require('crypto');

const INIT_URL = 'https://securepay.tinkoff.ru/v2/Init';

function buildToken(params, password) {
  const tokenParams = { ...params, Password: password };
  const sorted = Object.keys(tokenParams)
    .sort()
    .map((key) => String(tokenParams[key]))
    .join('');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const terminalKey = process.env.TINKOFF_TERMINAL_KEY;
  const password = process.env.TINKOFF_PASSWORD;
  const siteUrl = process.env.SITE_URL || 'https://amskills.ru';

  if (!terminalKey || !password) {
    res.status(500).json({ error: 'Платёжный модуль не настроен (нет ключей Т-Кассы)' });
    return;
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }

  const amount = Number(body.amount);
  const description = (body.description || 'Оплата тренировки AMSkills').slice(0, 250);

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'Некорректная сумма' });
    return;
  }

  const orderId = `amskills-${Date.now()}`;

  const initParams = {
    TerminalKey: terminalKey,
    Amount: Math.round(amount * 100), // в копейках
    OrderId: orderId,
    Description: description,
    SuccessURL: `${siteUrl}/success.html`,
    FailURL: `${siteUrl}/fail.html`,
  };

  const token = buildToken(initParams, password);

  try {
    const tinkoffRes = await fetch(INIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...initParams, Token: token }),
    });

    const data = await tinkoffRes.json();

    if (!data.Success) {
      res.status(502).json({ error: data.Message || 'Т-Касса отклонила запрос' });
      return;
    }

    res.status(200).json({ paymentUrl: data.PaymentURL });
  } catch (err) {
    console.error('Tinkoff Init error:', err);
    res.status(500).json({ error: 'Не удалось связаться с Т-Кассой' });
  }
};
