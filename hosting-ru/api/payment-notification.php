<?php
// Уведомления Т-Кассы о статусе платежа. Аналог api/payment-notification.js для PHP-хостинга.
// Т-Касса ждёт ответ «OK» (без кавычек, статус 200), иначе повторяет запрос.
// Терминала два («Индивидуальная тренировка» и «Прочие платежи»), у каждого свой пароль:
// пароль выбирается по TerminalKey из уведомления.
// Сейчас скрипт только проверяет подпись и пишет статус в лог ошибок хостинга.
require_once __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    tk_text(405, 'Method not allowed');
    return;
}

$body     = tk_input();
$password = tk_password_for_terminal($body['TerminalKey'] ?? '');

if ($password === null) {
    tk_text(400, 'Unknown terminal');
    return;
}

$expected = tk_token($body, $password);
$given    = isset($body['Token']) ? (string) $body['Token'] : '';

if ($given === '' || !hash_equals($expected, $given)) {
    tk_text(400, 'Bad signature');
    return;
}

error_log('Tinkoff notification: ' . ($body['OrderId'] ?? '') . ' ' . ($body['Status'] ?? '') . ' ' . ($body['Amount'] ?? ''));

tk_text(200, 'OK');
