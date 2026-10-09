<?php

function db(bool $withDatabase = true): PDO
{
    static $connections = [];

    $config = function_exists('app_config') ? app_config('db') : null;
    if (!is_array($config)) {
        $fallback = require __DIR__ . '/app.php';
        $config = $fallback['db'];
    }
    $key = $withDatabase ? 'db' : 'server';

    if (isset($connections[$key])) {
        return $connections[$key];
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%s;%scharset=%s',
        $config['host'],
        $config['port'],
        $withDatabase ? 'dbname=' . $config['database'] . ';' : '',
        $config['charset']
    );

    $connections[$key] = new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $connections[$key];
}
