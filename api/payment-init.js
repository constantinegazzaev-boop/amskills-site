// Serverless-функция (формат Vercel) — создаёт платёж в Т-Кассе и возвращает ссылку на оплату.
// Два вида платежей, у каждого свой терминал Т-Кассы (и свой счёт в Т-Банке):
//   training — «Индивидуальная тренировка»: TINKOFF_TERMINAL_KEY, TINKOFF_PASSWORD
//   other    — «Прочие платежи»:            TINKOFF_TERMINAL_KEY_OTHER, TINKOFF_PASSWORD_OTHER
// Пароль терминала — секрет (НЕ публиковать, только в настройках хостинга).
//   SITE_URL              — https://amskills.ru (для Success/Fail редиректов)
// Для кассового чека (54-ФЗ), общие для обоих терминалов (для «прочих» можно задать свои с суффиксом _OTHER):
//   TINKOFF_TAXATION      — система налогообложения ИП: patent (по умолчанию) | usn_income | usn_income_outcome | osn
//   TINKOFF_VAT           — ставка НДС в чеке, по умолчанию none (без НДС): none | vat0 | vat5 | vat7 | vat20 | vat22
//   TINKOFF_ITEM_NAME_OTHER — название позиции в чеке для «прочих платежей» (по умолчанию «Оплата услуг»)
const crypto = require('crypto');
const https = require('https');
const { RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA } = require('./_russian-trusted-ca');

const INIT_HOST = 'securepay.tinkoff.ru';
const INIT_PATH = '/v2/Init';

// Виды платежей: суффикс переменных окружения, позиция в чеке, описание и префикс номера заказа.
const KINDS = {
  training: {
    suffix: '',
    itemName: 'Услуги по индивидуальной подготовке хоккеистов',
    description: 'Оплата индивидуальной тренировки',
    orderPrefix: 'amskills-training',
  },
  other: {
    suffix: '_OTHER',
    itemName: 'Оплата услуг',
    description: 'Прочие платежи',
    orderPrefix: 'amskills-other',
  },
};

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

// Настройки терминала для вида платежа или null, если ключи не заданы.
function terminalFor(kindName) {
  const kind = KINDS[kindName];
  const env = process.env;
  const key = (env['TINKOFF_TERMINAL_KEY' + kind.suffix] || '').trim();
  const password = (env['TINKOFF_PASSWORD' + kind.suffix] || '').trim();
  if (!key || !password) return null;
  return {
    key,
    password,
    taxation: (env['TINKOFF_TAXATION' + kind.suffix] || env.TINKOFF_TAXATION || 'patent').trim(),
    vat: (env['TINKOFF_VAT' + kind.suffix] || env.TINKOFF_VAT || 'none').trim(),
    itemName: (env['TINKOFF_ITEM_NAME' + kind.suffix] || kind.itemName).trim(),
  };
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

  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }

  // Что оплачивает человек — от этого зависит терминал (и счёт), на который придут деньги.
  const kindName = String(body.type || '');
  if (!Object.prototype.hasOwnProperty.call(KINDS, kindName)) {
    res.status(400).json({ error: 'Выберите, что вы оплачиваете' });
    return;
  }
  const kind = KINDS[kindName];

  const terminal = terminalFor(kindName);
  const siteUrl = process.env.SITE_URL || 'https://amskills.ru';

  if (!terminal) {
    res.status(500).json({ error: 'Платёжный модуль не настроен (нет ключей Т-Кассы)' });
    return;
  }

  const amount = Number(body.amount);
  const description = (body.description || kind.description).slice(0, 250);

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

  const orderId = `${kind.orderPrefix}-${Date.now()}`;
  const amountKop = Math.round(amount * 100); // в копейках

  const initParams = {
    TerminalKey: terminal.key,
    Amount: amountKop,
    OrderId: orderId,
    Description: description,
    SuccessURL: `${siteUrl}/success.html`,
    FailURL: `${siteUrl}/fail.html`,
  };

  const token = buildToken(initParams, terminal.password);

  // Кассовый чек по 54-ФЗ: одна позиция «услуга», расчёт в момент оплаты.
  // ИП на патенте — по умолчанию; способ расчёта (full_payment) подтвердите у бухгалтера.
  const receipt = {
    Email: email,
    Phone: phone,
    Taxation: terminal.taxation,
    Items: [
      {
        Name: terminal.itemName,
        Price: amountKop,
        Quantity: 1,
        Amount: amountKop,
        Tax: terminal.vat,
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
      console.error(`Т-Касса отклонила Init с чеком (${kindName}):`, data.ErrorCode, data.Message, data.Details);
      const retry = await sendInit(false);
      if (retry && retry.Success) {
        console.error(`Платёж (${kindName}) создан БЕЗ чека — проверьте подключение онлайн-кассы в личном кабинете Т-Кассы`);
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
