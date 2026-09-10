// Webhook уведомлений от Т-Кассы о статусе платежа.
// Т-Касса требует ответ "OK" (без кавычек, статус 200), иначе будет повторять запрос.
// Сейчас функция только проверяет подпись и логирует статус — подключите e-mail/CRM/БД по необходимости.
const crypto = require('crypto');

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

  const password = process.env.TINKOFF_PASSWORD;
  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
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
