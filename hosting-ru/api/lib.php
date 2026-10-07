<?php
// Общие функции платёжных скриптов Т-Кассы для обычного (PHP) хостинга. Нужен PHP 7.2 или новее.
// Секреты здесь не хранятся: ключ и пароль терминала лежат в config.php (его создают на хостинге сами).

const TK_API_HOST = 'securepay.tinkoff.ru';

function tk_config()
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/config.php';
        $loaded = is_file($file) ? require $file : [];
        $cfg = is_array($loaded) ? $loaded : [];
    }
    return $cfg;
}

// Тело запроса: JSON или form-urlencoded (в тестах подменяется через $GLOBALS['TK_INPUT'])
function tk_input()
{
    if (isset($GLOBALS['TK_INPUT'])) {
        return $GLOBALS['TK_INPUT'];
    }
    if (!empty($_POST)) {
        return $_POST;
    }
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

function tk_json($code, array $data)
{
    $GLOBALS['TK_LAST_STATUS'] = $code; // нужно только для автотестов
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function tk_text($code, $text)
{
    $GLOBALS['TK_LAST_STATUS'] = $code; // нужно только для автотестов
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo $text;
}

// Значение для подписи: как String() в JS (true → "true", false → "false")
function tk_scalar_to_string($v)
{
    if (is_bool($v)) {
        return $v ? 'true' : 'false';
    }
    return (string) $v;
}

// Подпись Т-Кассы: SHA-256 от значений плоских полей в алфавитном порядке ключей, включая Password.
// Token, Receipt, DATA и любые вложенные поля в подпись не входят.
function tk_token(array $params, $password)
{
    $p = $params;
    $p['Password'] = $password;
    unset($p['Token']);
    foreach ($p as $k => $v) {
        if (is_array($v) || is_object($v) || $v === null) {
            unset($p[$k]);
        }
    }
    ksort($p, SORT_STRING);
    return hash('sha256', implode('', array_map('tk_scalar_to_string', $p)));
}

// Т-Касса принимает телефон в формате +79991234567
function tk_normalize_phone($raw)
{
    $digits = preg_replace('/\D/', '', (string) $raw);
    if (strlen($digits) === 11 && ($digits[0] === '7' || $digits[0] === '8')) {
        return '+7' . substr($digits, 1);
    }
    if (strlen($digits) === 10) {
        return '+7' . $digits;
    }
    return null;
}

function tk_valid_email($email)
{
    return strlen($email) <= 64 && preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u', $email) === 1;
}

// POST в API Т-Кассы. Возвращает массив ответа, null если ответ не JSON; при сбое связи бросает исключение.
function tk_post($path, array $payload)
{
    if (isset($GLOBALS['TK_HTTP']) && is_callable($GLOBALS['TK_HTTP'])) {   // подмена транспорта в тестах
        return call_user_func($GLOBALS['TK_HTTP'], $path, $payload);
    }
    $ch = curl_init('https://' . TK_API_HOST . $path);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT        => 25,
    ]);
    $raw = curl_exec($ch);
    // securepay.tinkoff.ru использует сертификат Минцифры. Если хостинг ему не доверяет,
    // повторяем запрос с корневым сертификатом, который лежит рядом (russian-trusted-ca.pem).
    if ($raw === false && in_array(curl_errno($ch), [35, 58, 60], true)) {
        curl_setopt($ch, CURLOPT_CAINFO, __DIR__ . '/russian-trusted-ca.pem');
        $raw = curl_exec($ch);
    }
    if ($raw === false) {
        throw new RuntimeException('cURL: ' . curl_error($ch));
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}
