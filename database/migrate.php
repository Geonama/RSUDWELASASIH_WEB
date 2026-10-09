<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Migrasi database hanya boleh dijalankan dari CLI.');
}

$GLOBALS['config'] = require __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../config/database.php';

$pdo = db();
$migrations = glob(__DIR__ . '/migrations/*.php');
sort($migrations);
foreach ($migrations as $file) {
    $migration = require $file;
    $migration($pdo);
    echo basename($file) . " selesai.\n";
}
