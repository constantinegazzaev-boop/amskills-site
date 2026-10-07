<?php
// Создаёт платёж в Т-Кассе и возвращает ссылку на оплату. Аналог api/payment-init.js для PHP-хостинга.
// Адрес для сайта: /api/payment-init (правило в .htaccess). Ключи берутся из config.php.
require_once __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    tk_json(405, ['error' => 'Method not allowed']);
    return;
}

$cfg         = tk_config();
$terminalKey = trim((string) ($cfg['terminal_key'] ?? ''));
$password    = trim((string) ($cfg['password'] ?? ''));
$siteUrl     = rtrim((string) ($cfg['site_url'] ?? 'https://amskills.ru'), '/');

if ($terminalKey === '' || $password === '' || strpos($terminalKey, 'ВСТАВЬТЕ') !== false) {
    tk_json(500, ['error' => 'Платёжный модуль не настроен (нет ключей Т-Кассы)']);
    return;
}

$body = tk_input();

$amount = is_numeric($body['amount'] ?? null) ? (float) $body['amount'] : 0.0;
$description = (string) ($body['description'] ?? '');
if ($description === '') {
    $description = 'Оплата тренировки AMSkills';
}
$description = function_exists('mb_substr') ? mb_substr($description, 0, 250) : substr($description, 0, 250);

if ($amount <= 0 || !is_finite($amount)) {
    tk_json(400, ['error' => 'Некорректная сумма']);
    return;
}

$email = trim((string) ($body['email'] ?? ''));
$phone = tk_normalize_phone($body['phone'] ?? '');

if (!tk_valid_email($email)) {
    tk_json(400, ['error' => 'Укажите корректный e-mail для чека']);
    return;
}
if ($phone === null) {
    tk_json(400, ['error' => 'Укажите телефон, например +7 900 000-00-00']);
    return;
}

$orderId   = 'amskills-' . sprintf('%.0f', round(microtime(true) * 1000));
$amountKop = (int) round($amount * 100); // в копейках

$initParams = [
    'TerminalKey' => $terminalKey,
    'Amount'      => $amountKop,
    'OrderId'     => $orderId,
    'Description' => $description,
    'SuccessURL'  => $siteUrl . '/success.html',
    'FailURL'     => $siteUrl . '/fail.html',
];

$token = tk_token($initParams, $password);

// Кассовый чек по 54-ФЗ: одна позиция «услуга», расчёт в момент оплаты.
// По умолчанию ИП на патенте без НДС (меняется в config.php); способ расчёта (full_payment) подтвердите у бухгалтера.
$taxation = trim((string) ($cfg['taxation'] ?? ''));
$vat      = trim((string) ($cfg['vat'] ?? ''));
$receipt = [
    'Email'    => $email,
    'Phone'    => $phone,
    'Taxation' => $taxation !== '' ? $taxation : 'patent',
    'Items'    => [[
        'Name'          => 'Услуги по индивидуальной подготовке хоккеистов',
        'Price'         => $amountKop,
        'Quantity'      => 1,
        'Amount'        => $amountKop,
        'Tax'           => $vat !== '' ? $vat : 'none',
        'PaymentMethod' => 'full_payment',
        'PaymentObject' => 'service',
    ]],
];

$sendInit = function ($withReceipt) use ($initParams, $token, $receipt) {
    $payload = $initParams + ['Token' => $token];
    if ($withReceipt) {
        $payload['Receipt'] = $receipt;
    }
    return tk_post('/v2/Init', $payload);
};

try {
    $data = $sendInit(true);

    // Если Т-Касса не приняла чек (например, касса не привязана к терминалу), создаём платёж без него,
    // чтобы не терять оплаты, и пишем в лог ошибок: чек тогда придётся пробить вручную.
    // Данные плательщика (e-mail, телефон) в лог не попадают.
    if ($data !== null && empty($data['Success'])) {
        error_log('Т-Касса отклонила Init с чеком: ' . ($data['ErrorCode'] ?? '') . ' ' . ($data['Message'] ?? '') . ' ' . ($data['Details'] ?? ''));
        $retry = $sendInit(false);
        if ($retry !== null && !empty($retry['Success'])) {
            error_log('Платёж создан БЕЗ чека: проверьте подключение онлайн-кассы в личном кабинете Т-Кассы');
            $data = $retry;
        }
    }
} catch (Throwable $e) {
    error_log('Tinkoff Init error: ' . $e->getMessage());
    tk_json(500, ['error' => 'Не удалось связаться с Т-Кассой']);
    return;
}

if ($data === null) {
    tk_json(502, ['error' => 'Т-Касса вернула не JSON']);
    return;
}
if (empty($data['Success'])) {
    tk_json(502, ['error' => !empty($data['Message']) ? $data['Message'] : 'Т-Касса отклонила запрос']);
    return;
}

tk_json(200, ['paymentUrl' => $data['PaymentURL'] ?? '']);
