<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo 'Setup database hanya boleh dijalankan dari CLI.';
    exit;
}

$GLOBALS['config'] = require __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../config/database.php';

$config = app_config('db');
$server = db(false);
$database = preg_replace('/[^a-zA-Z0-9_]/', '', $config['database']);

$server->exec("CREATE DATABASE IF NOT EXISTS `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo = db(true);

$schema = file_get_contents(__DIR__ . '/schema.sql');
$pdo->exec($schema);
require __DIR__ . '/migrate.php';

$roles = [
    ['perawat_igd', 'Perawat IGD'],
    ['perawat_transit', 'Perawat Transit'],
    ['admin', 'Admin'],
];

$stmtRole = $pdo->prepare('INSERT IGNORE INTO roles (code, name) VALUES (?, ?)');
foreach ($roles as $role) {
    $stmtRole->execute($role);
}

$specializations = [
    ['Spesialis Jantung', 'jantung,kardiologi,cardiac,hipertensi'],
    ['Spesialis Penyakit Dalam', 'diabetes,ginjal,paru,infeksi,penyakit dalam,internal'],
    ['Spesialis Saraf', 'stroke,saraf,kejang,neurologi'],
    ['Spesialis Anak', 'anak,bayi,pediatri'],
    ['Spesialis Bedah', 'bedah,luka,operasi,trauma'],
    ['Dokter Umum', 'umum,observasi,demam'],
];

$stmtSpec = $pdo->prepare('INSERT IGNORE INTO specializations (name, keywords) VALUES (?, ?)');
foreach ($specializations as $spec) {
    $stmtSpec->execute($spec);
}

$doctors = [
    ['Dr. Budi Santoso', 'Spesialis Jantung'],
    ['Dr. Andi Wijaya', 'Spesialis Penyakit Dalam'],
    ['Dr. Sari Prameswari', 'Spesialis Saraf'],
    ['Dr. Rina Kusuma', 'Spesialis Anak'],
    ['Dr. Bagas Firmansyah', 'Spesialis Bedah'],
];

$stmtDoctor = $pdo->prepare(
    'INSERT INTO doctors (name, specialization_id)
     SELECT ?, id FROM specializations WHERE name = ?
     ON DUPLICATE KEY UPDATE name = VALUES(name)'
);
foreach ($doctors as $doctor) {
    $exists = $pdo->prepare('SELECT COUNT(*) FROM doctors WHERE name = ? AND deleted_at IS NULL');
    $exists->execute([$doctor[0]]);
    if ((int) $exists->fetchColumn() === 0) {
        $stmtDoctor->execute($doctor);
    }
}

$stmtBed = $pdo->prepare('INSERT IGNORE INTO beds (bed_code, status) VALUES (?, "KOSONG")');
foreach (app_config('bed_codes') as $code) {
    $stmtBed->execute([$code]);
}

$roleId = $pdo->prepare('SELECT id FROM roles WHERE code = ?');
$insertUser = $pdo->prepare(
    'INSERT INTO users (role_id, full_name, username, email, identity_number, password_hash, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)'
);

$seedUsers = [
    ['admin', 'Administrator E-Transit', 'admin', 'admin@etransit.local', 'ADM-001', 'Admin@123'],
    ['perawat_igd', 'Perawat IGD Demo', 'igd', 'igd@etransit.local', 'IGD-001', 'Igd@1234'],
    ['perawat_transit', 'Perawat Transit Demo', 'transit', 'transit@etransit.local', 'TRN-001', 'Transit@123'],
];

foreach ($seedUsers as $seed) {
    [$roleCode, $fullName, $username, $email, $identity, $password] = $seed;
    $exists = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ? OR email = ?');
    $exists->execute([$username, $email]);
    if ((int) $exists->fetchColumn() > 0) {
        continue;
    }
    $roleId->execute([$roleCode]);
    $insertUser->execute([
        (int) $roleId->fetchColumn(),
        $fullName,
        $username,
        $email,
        $identity,
        password_hash($password, PASSWORD_BCRYPT),
    ]);
}

echo "Database E-Transit siap digunakan.\n";
echo "Akun awal:\n";
echo "- admin / Admin@123\n";
echo "- igd / Igd@1234\n";
echo "- transit / Transit@123\n";
