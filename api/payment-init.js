// Serverless-функция (формат Vercel) — создаёт платёж в Т-Кассе и возвращает ссылку на оплату.
// Требует переменные окружения:
//   TINKOFF_TERMINAL_KEY  — TerminalKey из личного кабинета Т-Кассы
//   TINKOFF_PASSWORD      — секретный пароль терминала (НЕ публиковать, только в .env / настройках хостинга)
//   SITE_URL              — https://amskills.ru (для Success/Fail редиректов)
// Для кассового чека (54-ФЗ):
//   TINKOFF_TAXATION      — система налогообложения ИП: patent (по умолчанию) | usn_income | usn_income_outcome | osn
//   TINKOFF_VAT           — ставка НДС в чеке, по умолчанию none (без НДС): none | vat0 | vat5 | vat7 | vat20 | vat22
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Т-Касса принимает телефон в формате +79991234567
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return '+7' + digits.slice(1);
  if (digits.length === 10) return '+7' + digits;
  return null;
}

// Токен считается только по плоским полям корневого объекта — Receipt в него не входит.
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

  const terminalKey = (process.env.TINKOFF_TERMINAL_KEY || '').trim();
  const password = (process.env.TINKOFF_PASSWORD || '').trim();
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

  const email = String(body.email || '').trim();
  const phone = normalizePhone(body.phone);

  if (!EMAIL_RE.test(email) || email.length > 64) {
    res.status(400).json({ error: 'Укажите корректный e-mail для чека' });
    return;
  }
  if (!phone) {
    res.status(400).json({ error: 'Укажите телефон, например +7 900 000-00-00' });
    return;
  }

  const orderId = `amskills-${Date.now()}`;
  const amountKop = Math.round(amount * 100); // в копейках

  const initParams = {
    TerminalKey: terminalKey,
    Amount: amountKop,
    OrderId: orderId,
    Description: description,
    SuccessURL: `${siteUrl}/success.html`,
    FailURL: `${siteUrl}/fail.html`,
  };

  const token = buildToken(initParams, password);

  // Кассовый чек по 54-ФЗ: одна позиция «услуга», расчёт в момент оплаты.
  // ИП на патенте — по умолчанию; способ расчёта (full_payment) подтвердите у бухгалтера.
  const receipt = {
    Email: email,
    Phone: phone,
    Taxation: (process.env.TINKOFF_TAXATION || 'patent').trim(),
    Items: [
      {
        Name: 'Услуги по индивидуальной подготовке хоккеистов',
        Price: amountKop,
        Quantity: 1,
        Amount: amountKop,
        Tax: (process.env.TINKOFF_VAT || 'none').trim(),
        PaymentMethod: 'full_payment',
        PaymentObject: 'service',
      },
    ],
  };

  const sendInit = async (withReceipt) => {
    const { raw } = await postJson(INIT_HOST, INIT_PATH, {
      ...initParams,
      Token: token,
      ...(withReceipt ? { Receipt: receipt } : {}),
    });
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  try {
    let data = await sendInit(true);

    // Если Т-Касса не приняла чек (например, касса не привязана к терминалу), создаём платёж без него,
    // чтобы не терять оплаты, и пишем в лог — чек тогда придётся пробить вручную. Данные плательщика в лог не попадают.
    if (data && !data.Success) {
      console.error('Т-Касса отклонила Init с чеком:', data.ErrorCode, data.Message, data.Details);
      const retry = await sendInit(false);
      if (retry && retry.Success) {
        console.error('Платёж создан БЕЗ чека — проверьте подключение онлайн-кассы в личном кабинете Т-Кассы');
        data = retry;
      }
    }

    if (!data) {
      res.status(502).json({ error: 'Т-Касса вернула не JSON' });
      return;
    }

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
