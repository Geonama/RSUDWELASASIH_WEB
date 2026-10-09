<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Penyesuaian bed hanya boleh dijalankan dari CLI.');
}

$arguments = array_slice($argv, 1);
if (count($arguments) > 1 || array_diff($arguments, ['--dry-run', '--apply'])) {
    fwrite(STDERR, "Gunakan --dry-run untuk pratinjau atau --apply untuk menerapkan.\n");
    exit(1);
}
$apply = $arguments === ['--apply'];
$GLOBALS['config'] = require __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../config/database.php';

$pdo = db();
$codes = app_config('bed_codes');

try {
    $pdo->beginTransaction();
    // Reuse occupied or historically referenced beds before unreferenced empty beds.
    $beds = $pdo->query(
        "SELECT b.*,
            EXISTS (SELECT 1 FROM patients p WHERE p.bed_id = b.id) AS has_patients,
            EXISTS (SELECT 1 FROM transfers t WHERE t.bed_id = b.id) AS has_transfers
         FROM beds b
         ORDER BY (b.patient_id IS NOT NULL OR b.status IN ('TERISI', 'SIAP_TRANSFER')) DESC,
                  (has_patients OR has_transfers) DESC, b.id
         FOR UPDATE"
    )->fetchAll();
    $missing = array_values(array_diff($codes, array_column($beds, 'bed_code')));
    $extra = array_values(array_filter($beds, fn ($bed) => !in_array($bed['bed_code'], $codes, true)));
    $renameCount = min(count($missing), count($extra));
    $removed = array_slice($extra, $renameCount);

    foreach ($removed as $bed) {
        if ($bed['patient_id'] !== null || in_array($bed['status'], ['TERISI', 'SIAP_TRANSFER'], true)
            || $bed['has_patients'] || $bed['has_transfers']) {
            throw new RuntimeException('Bed ' . $bed['bed_code'] . ' tidak dapat dihapus karena masih dipakai atau terkait histori pasien.');
        }
    }

    $rename = $pdo->prepare('UPDATE beds SET bed_code = ? WHERE id = ?');
    for ($i = 0; $i < $renameCount; $i++) {
        echo 'Ubah ' . $extra[$i]['bed_code'] . ' menjadi ' . $missing[$i] . " (ID tetap).\n";
        if ($apply) {
            $rename->execute([$missing[$i], $extra[$i]['id']]);
        }
    }
    $insert = $pdo->prepare("INSERT INTO beds (bed_code, status) VALUES (?, 'KOSONG')");
    foreach (array_slice($missing, $renameCount) as $code) {
        echo 'Tambah bed ' . $code . ".\n";
        if ($apply) {
            $insert->execute([$code]);
        }
    }
    $delete = $pdo->prepare(
        "DELETE FROM beds WHERE id = ? AND patient_id IS NULL AND status IN ('KOSONG', 'NONAKTIF')
         AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.bed_id = beds.id)
         AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.bed_id = beds.id)"
    );
    foreach ($removed as $bed) {
        echo 'Hapus bed kosong tanpa histori ' . $bed['bed_code'] . ".\n";
        if ($apply) {
            $delete->execute([$bed['id']]);
            if ($delete->rowCount() !== 1) {
                throw new RuntimeException('Bed ' . $bed['bed_code'] . ' berubah; penyesuaian dibatalkan.');
            }
        }
    }

    if ($apply) {
        if ($missing || $extra) {
            $pdo->prepare('INSERT INTO audit_logs (action, ip_address, description) VALUES (?, ?, ?)')
                ->execute(['Penyesuaian bed', 'CLI', 'Daftar bed disesuaikan: ' . implode(', ', $codes)]);
        }
        $pdo->commit();
        echo count($codes) . " bed telah sesuai. Status dan relasi pasien tetap dipertahankan.\n";
    } else {
        $pdo->rollBack();
        echo "Pratinjau selesai; database tidak berubah. Gunakan --apply untuk menerapkan.\n";
    }
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Penyesuaian dibatalkan: ' . $error->getMessage() . "\n");
    exit(1);
}
