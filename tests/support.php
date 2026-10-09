<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

$root = dirname(__DIR__);
$GLOBALS['config'] = require $root . '/config/app.php';
require $root . '/includes/helpers.php';
require $root . '/config/database.php';
date_default_timezone_set(app_config('timezone'));

$command = $argv[1] ?? '';
$database = (string) app_config('db.database');

if ($command === 'fingerprint') {
    $pdo = db();
    $hashes = [];
    foreach (['roles', 'users', 'specializations', 'doctors', 'beds', 'patients', 'vital_signs', 'transfers'] as $table) {
        $rows = $pdo->query("SELECT * FROM `$table` ORDER BY id")->fetchAll();
        if ($table === 'users') {
            foreach ($rows as &$row) {
                unset($row['last_login_at'], $row['updated_at']);
            }
            unset($row);
        }
        $hashes[$table] = ['count' => count($rows), 'hash' => hash('sha256', json_encode($rows))];
    }
    echo json_encode($hashes);
    exit;
}

if (!preg_match('/^e_transit_qa_[0-9_]+$/', $database)) {
    throw new RuntimeException('Pengujian hanya boleh memakai database e_transit_qa_* yang terpisah.');
}

if ($command === 'create') {
    db(false)->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    require $root . '/database/setup.php';
    exit;
}

if ($command === 'drop') {
    db(false)->exec("DROP DATABASE `$database`");
    exit;
}

$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
if ($command === 'query') {
    $stmt = db()->prepare($input['sql']);
    $stmt->execute($input['params'] ?? []);
    echo json_encode($stmt->columnCount() ? $stmt->fetchAll() : ['affected' => $stmt->rowCount()]);
} elseif ($command === 'login-throttle-path') {
    echo json_encode(login_throttle_path($input['ip']));
} elseif ($command === 'xlsx') {
    $zip = new ZipArchive();
    if ($zip->open($input['path']) !== true) {
        throw new RuntimeException('Export bukan arsip XLSX yang valid.');
    }
    $xml = simplexml_load_string($zip->getFromName('xl/worksheets/sheet1.xml'));
    $rows = [];
    foreach ($xml->sheetData->row as $row) {
        $values = [];
        foreach ($row->c as $cell) {
            $values[] = (string) $cell->is->t;
        }
        $rows[] = $values;
    }
    $zip->close();
    echo json_encode($rows);
} elseif ($command === 'expire-session') {
    session_name(app_config('session_name'));
    session_id($input['id']);
    session_start();
    $_SESSION['last_activity'] = time() - 1900;
    session_write_close();
} elseif ($command === 'helpers') {
    echo json_encode([
        patient_title('L', date('Y-m-d'), 'Belum Menikah'),
        patient_title('P', date('Y-m-d', strtotime('-10 years')), 'Belum Menikah'),
        patient_title('L', '1990-01-01', 'Menikah'),
        patient_title('P', '1990-01-01', 'Menikah'),
        patient_title('P', '1990-01-01', 'Belum Menikah'),
        format_duration_between('2026-01-01 08:00:00', '2026-01-01 10:35:00'),
    ]);
} else {
    throw new RuntimeException('Perintah pengujian tidak dikenal.');
}
