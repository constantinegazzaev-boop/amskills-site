<?php
// Создаёт платёж в Т-Кассе и возвращает ссылку на оплату. Аналог api/payment-init.js для PHP-хостинга.
// Адрес для сайта: /api/payment-init (правило в .htaccess). Ключи берутся из config.php.
// Два вида платежей: «training» (индивидуальная тренировка) и «other» (прочие платежи), у каждого свой терминал.
require_once __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    tk_json(405, ['error' => 'Method not allowed']);
    return;
}

$body = tk_input();

// Что оплачивает человек — от этого зависит терминал (и счёт), на который придут деньги.
$type = (string) ($body['type'] ?? '');
$kinds = tk_kinds();
if (!isset($kinds[$type])) {
    tk_json(400, ['error' => 'Выберите, что вы оплачиваете']);
    return;
}

$terminal = tk_terminal($type);
$cfg      = tk_config();
$siteUrl  = rtrim((string) ($cfg['site_url'] ?? 'https://amskills.ru'), '/');

if ($terminal === null) {
    tk_json(500, ['error' => 'Платёжный модуль не настроен (нет ключей Т-Кассы)']);
    return;
}

$amount = is_numeric($body['amount'] ?? null) ? (float) $body['amount'] : 0.0;
$description = (string) ($body['description'] ?? '');
if ($description === '') {
    $description = $terminal['description'];
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

$orderId   = $terminal['order_prefix'] . '-' . sprintf('%.0f', round(microtime(true) * 1000));
$amountKop = (int) round($amount * 100); // в копейках

$initParams = [
    'TerminalKey' => $terminal['key'],
    'Amount'      => $amountKop,
    'OrderId'     => $orderId,
    'Description' => $description,
    'SuccessURL'  => $siteUrl . '/success.html',
    'FailURL'     => $siteUrl . '/fail.html',
];

$token = tk_token($initParams, $terminal['password']);

// Кассовый чек по 54-ФЗ: одна позиция «услуга», расчёт в момент оплаты.
// Система налогообложения, НДС и название позиции берутся из настроек терминала (по умолчанию патент, без НДС);
// способ расчёта (full_payment) подтвердите у бухгалтера.
$receipt = [
    'Email'    => $email,
    'Phone'    => $phone,
    'Taxation' => $terminal['taxation'],
    'Items'    => [[
        'Name'          => $terminal['item_name'],
        'Price'         => $amountKop,
        'Quantity'      => 1,
        'Amount'        => $amountKop,
        'Tax'           => $terminal['vat'],
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
        error_log('Т-Касса отклонила Init с чеком (' . $type . '): ' . ($data['ErrorCode'] ?? '') . ' ' . ($data['Message'] ?? '') . ' ' . ($data['Details'] ?? ''));
        $retry = $sendInit(false);
        if ($retry !== null && !empty($retry['Success'])) {
            error_log('Платёж (' . $type . ') создан БЕЗ чека: проверьте подключение онлайн-кассы в личном кабинете Т-Кассы');
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
