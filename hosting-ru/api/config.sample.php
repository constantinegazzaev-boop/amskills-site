<?php
// Настройки платежей. На хостинге скопируйте этот файл в config.php (в той же папке api)
// и впишите свои значения. Файл config.php никому не отправляйте и в репозиторий не добавляйте.
return [
    'terminal_key' => 'ВСТАВЬТЕ_TerminalKey_боевого_терминала',
    'password'     => 'ВСТАВЬТЕ_пароль_терминала',
    // Адрес сайта без слеша на конце: сюда Т-Касса вернёт человека после оплаты (success.html / fail.html).
    // Для проверки на временном адресе хостинга укажите его (например, https://xxxx.tw1.ru), потом смените на https://amskills.ru
    'site_url'     => 'https://amskills.ru',
    // Система налогообложения для чека: patent (патент), usn_income, usn_income_outcome, osn
    'taxation'     => 'patent',
    // Ставка НДС в чеке: none (без НДС), vat0, vat5, vat7, vat20, vat22
    'vat'          => 'none',
];
