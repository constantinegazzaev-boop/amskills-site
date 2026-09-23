// Serverless-функция (формат Vercel) — создаёт платёж в Т-Кассе и возвращает ссылку на оплату.
// Требует переменные окружения:
//   TINKOFF_TERMINAL_KEY  — TerminalKey из личного кабинета Т-Кассы
//   TINKOFF_PASSWORD      — секретный пароль терминала (НЕ публиковать, только в .env / настройках хостинга)
//   SITE_URL              — https://amskills.ru (для Success/Fail редиректов)
const crypto = require('crypto');
const https = require('https');
const { RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA } = require('./_russian-trusted-ca');

const INIT_HOST = 'securepay.tinkoff.ru';
const INIT_PATH = '/v2/Init';

// securepay.tinkoff.ru использует сертификат от Минцифры России, которому
// стандартный набор доверенных CA (используемый fetch/undici) не доверяет.
// Добавляем официальный российский корневой сертификат в список доверенных
// именно для этого запроса — TLS-проверка остаётся полноценной, просто
// расширяется список доверенных корней.
const trustedCa = [...https.globalAgent.options.ca || [], RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA];

function postJson(hostname, path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        ca: trustedCa,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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
    const { status, raw } = await postJson(INIT_HOST, INIT_PATH, { ...initParams, Token: token });

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: 'Т-Касса вернула не JSON' });
      return;
    }

    if (!data.Success) {
      res.status(502).json({ error: data.Message || 'Т-Касса отклонила запрос', debugData: data });
      return;
    }

    res.status(200).json({ paymentUrl: data.PaymentURL });
  } catch (err) {
    console.error('Tinkoff Init error:', err);
    res.status(500).json({ error: 'Не удалось связаться с Т-Кассой' });
  }
};
