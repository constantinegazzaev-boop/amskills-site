// Webhook уведомлений от Т-Кассы о статусе платежа.
// Т-Касса требует ответ "OK" (без кавычек, статус 200), иначе будет повторять запрос.
// Сейчас функция только проверяет подпись и логирует статус — подключите e-mail/CRM/БД по необходимости.
// Терминала два («Индивидуальная тренировка» и «Прочие платежи»), у каждого свой пароль:
// пароль выбирается по TerminalKey из уведомления (TINKOFF_TERMINAL_KEY / TINKOFF_TERMINAL_KEY_OTHER).
const crypto = require('crypto');

function passwordFor(terminalKey) {
  const env = process.env;
  const pairs = [
    [env.TINKOFF_TERMINAL_KEY, env.TINKOFF_PASSWORD],
    [env.TINKOFF_TERMINAL_KEY_OTHER, env.TINKOFF_PASSWORD_OTHER],
  ];
  for (const [key, password] of pairs) {
    if (key && password && key.trim() === String(terminalKey)) return password.trim();
  }
  return null;
}

function buildToken(params, password) {
  const tokenParams = { ...params, Password: password };
  delete tokenParams.Token;
  delete tokenParams.Receipt;
  delete tokenParams.DATA;
  const sorted = Object.keys(tokenParams)
    .sort()
    .map((key) => String(tokenParams[key]))
    .join('');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
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

  const password = passwordFor(body.TerminalKey);
  if (!password) {
    res.status(400).send('Unknown terminal');
    return;
  }

  const expectedToken = buildToken(body, password);

  if (body.Token !== expectedToken) {
    res.status(400).send('Bad signature');
    return;
  }

  // TODO: при необходимости — отправить письмо/уведомление тренеру о статусе body.Status,
  // сумме body.Amount / 100 и OrderId body.OrderId.
  console.log('Tinkoff notification:', body.OrderId, body.Status, body.Amount);

  res.status(200).send('OK');
};
