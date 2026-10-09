<?php

declare(strict_types=1);

// Read-only production audit. Never run setup/migrations or print patient records.
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

$root = dirname(__DIR__);
$GLOBALS['config'] = require $root . '/config/app.php';
require $root . '/includes/helpers.php';
require $root . '/config/database.php';
date_default_timezone_set(app_config('timezone'));

$report = ['checked_at' => date(DATE_ATOM), 'database' => app_config('db.database'), 'checks' => [], 'tables' => []];
$check = static function (string $name, bool $ok, $details = null) use (&$report): void {
    $report['checks'][] = ['name' => $name, 'ok' => $ok, 'details' => $details];
};

try {
    $pdo = db();
    $database = (string) app_config('db.database');
    $server = $pdo->query('SELECT VERSION() AS version, @@innodb_force_recovery AS recovery, @@read_only AS read_only, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS utc_offset_minutes')->fetch();
    $report['server'] = $server;
    $check('InnoDB recovery disabled', (int) $server['recovery'] === 0);
    $check('Server accepts application writes', (int) $server['read_only'] === 0);
    $check('Database and application timezone agree', (int) $server['utc_offset_minutes'] === (int) (date('Z') / 60));

    $schema = file_get_contents($root . '/database/schema.sql');
    preg_match_all('/CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\) ENGINE=/s', $schema, $matches, PREG_SET_ORDER);
    $available = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    $foreignKeys = [];
    foreach ($matches as $match) {
        [$unused, $table, $definition] = $match;
        $exists = in_array($table, $available, true);
        $check("Table $table exists", $exists);
        if (!$exists) {
            continue;
        }
        $columns = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
        preg_match_all('/^    ([a-z_]+) /m', $definition, $expectedColumns);
        $missingColumns = array_values(array_diff($expectedColumns[1], $columns));
        $check("Columns $table", $missingColumns === [], $missingColumns);
        $stmt = $pdo->prepare('SELECT ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?');
        $stmt->execute([$database, $table]);
        $metadata = $stmt->fetch();
        $check("InnoDB / UTF-8 $table", $metadata['ENGINE'] === 'InnoDB' && str_starts_with($metadata['TABLE_COLLATION'], 'utf8mb4'));
        $indexes = $pdo->query("SHOW INDEX FROM `$table`")->fetchAll();
        $check("Primary key $table", count(array_filter($indexes, static fn ($index) => $index['Key_name'] === 'PRIMARY')) === 1);
        preg_match_all('/^    (\w+) [^\n]* UNIQUE/m', $definition, $uniqueColumns);
        foreach ($uniqueColumns[1] as $column) {
            $check("Unique index $table.$column", count(array_filter($indexes, static fn ($index) => $index['Column_name'] === $column && (int) $index['Non_unique'] === 0)) > 0);
        }
        preg_match_all('/FOREIGN KEY \((\w+)\) REFERENCES (\w+)\((\w+)\)/', $definition, $relations, PREG_SET_ORDER);
        foreach ($relations as $relation) {
            $foreignKeys[] = [$table, $relation[1], $relation[2], $relation[3]];
        }
        $integrity = $pdo->query("CHECK TABLE `$table`")->fetchAll();
        $ok = count(array_filter($integrity, static fn ($row) => $row['Msg_type'] === 'status' && $row['Msg_text'] === 'OK')) === 1
            && count(array_filter($integrity, static fn ($row) => in_array($row['Msg_type'], ['error', 'warning'], true))) === 0;
        $check("CHECK TABLE $table", $ok, $integrity);
        $report['tables'][$table] = ['rows' => (int) $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn(), 'engine' => $metadata['ENGINE']];
    }
    $foreignKeys[] = ['beds', 'patient_id', 'patients', 'id'];
    $stmt = $pdo->prepare('SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL');
    $stmt->execute([$database]);
    $actualKeys = $stmt->fetchAll();

    // A consistent snapshot protects aggregate relation checks from normal user activity.
    $pdo->exec('SET TRANSACTION READ ONLY');
    $pdo->beginTransaction();
    foreach ($foreignKeys as [$table, $column, $parent, $parentColumn]) {
        $constraint = count(array_filter($actualKeys, static fn ($key) => $key['TABLE_NAME'] === $table && $key['COLUMN_NAME'] === $column && $key['REFERENCED_TABLE_NAME'] === $parent && $key['REFERENCED_COLUMN_NAME'] === $parentColumn)) > 0;
        $check("Foreign key $table.$column", $constraint);
        $orphans = (int) $pdo->query("SELECT COUNT(*) FROM `$table` c LEFT JOIN `$parent` p ON c.`$column`=p.`$parentColumn` WHERE c.`$column` IS NOT NULL AND p.`$parentColumn` IS NULL")->fetchColumn();
        $check("No orphan $table.$column", $orphans === 0, $orphans);
    }

    $invariants = [
        'Occupied beds match live patients and status' => "SELECT COUNT(*) FROM beds b LEFT JOIN patients p ON p.id=b.patient_id WHERE b.status IN ('TERISI','SIAP_TRANSFER') AND (p.id IS NULL OR p.deleted_at IS NOT NULL OR p.bed_id IS NULL OR p.bed_id<>b.id OR (b.status='TERISI' AND p.status<>'ACTIVE') OR (b.status='SIAP_TRANSFER' AND p.status<>'READY_TRANSFER'))",
        'Empty / inactive beds have no patient' => "SELECT COUNT(*) FROM beds WHERE status IN ('KOSONG','NONAKTIF') AND patient_id IS NOT NULL",
        'Live patients have reciprocal bed assignments' => "SELECT COUNT(*) FROM patients p LEFT JOIN beds b ON b.id=p.bed_id WHERE p.deleted_at IS NULL AND p.status IN ('ACTIVE','READY_TRANSFER') AND (b.id IS NULL OR b.patient_id IS NULL OR b.patient_id<>p.id OR (p.status='ACTIVE' AND b.status<>'TERISI') OR (p.status='READY_TRANSFER' AND b.status<>'SIAP_TRANSFER'))",
        'No duplicate live bed assignment' => "SELECT COUNT(*) FROM (SELECT bed_id FROM patients WHERE deleted_at IS NULL AND status IN ('ACTIVE','READY_TRANSFER') AND bed_id IS NOT NULL GROUP BY bed_id HAVING COUNT(*)>1) duplicates",
        'No patient occupies multiple beds' => 'SELECT COUNT(*) FROM (SELECT patient_id FROM beds WHERE patient_id IS NOT NULL GROUP BY patient_id HAVING COUNT(*)>1) duplicates',
        'Transferred patients have exactly one transfer' => "SELECT COUNT(*) FROM patients p WHERE p.status='TRANSFERRED' AND (p.transfer_time IS NULL OR (SELECT COUNT(*) FROM transfers t WHERE t.patient_id=p.id)<>1)",
        'Transfer records match patient status' => "SELECT COUNT(*) FROM transfers t JOIN patients p ON p.id=t.patient_id WHERE p.status<>'TRANSFERRED' OR t.stay_minutes<0 OR t.transfer_time<p.arrival_time",
        'No duplicate transfer' => 'SELECT COUNT(*) FROM (SELECT patient_id FROM transfers GROUP BY patient_id HAVING COUNT(*)>1) duplicates',
        'Patient transfer chronology' => 'SELECT COUNT(*) FROM patients WHERE transfer_time IS NOT NULL AND transfer_time<arrival_time',
        'No future patient dates' => 'SELECT COUNT(*) FROM patients WHERE birth_date>CURRENT_DATE() OR arrival_time>NOW()',
        'Live patients have vital signs' => "SELECT COUNT(*) FROM patients p WHERE p.deleted_at IS NULL AND p.status IN ('ACTIVE','READY_TRANSFER') AND NOT EXISTS (SELECT 1 FROM vital_signs v WHERE v.patient_id=p.id)",
        'Soft-deleted patients cancelled' => "SELECT COUNT(*) FROM patients WHERE deleted_at IS NOT NULL AND status<>'CANCELLED'",
    ];
    foreach ($invariants as $name => $sql) {
        $violations = (int) $pdo->query($sql)->fetchColumn();
        $check($name, $violations === 0, $violations);
    }
    foreach (['users' => ['username', 'email'], 'patients' => ['medical_record_number'], 'beds' => ['bed_code']] as $table => $columns) {
        foreach ($columns as $column) {
            $duplicates = (int) $pdo->query("SELECT COUNT(*) FROM (SELECT `$column` FROM `$table` GROUP BY `$column` HAVING COUNT(*)>1) duplicates")->fetchColumn();
            $check("No duplicate $table.$column", $duplicates === 0, $duplicates);
        }
    }
    $roles = $pdo->query('SELECT code FROM roles')->fetchAll(PDO::FETCH_COLUMN);
    $missingRoles = array_values(array_diff(['admin', 'perawat_igd', 'perawat_transit'], $roles));
    $check('All application roles exist', $missingRoles === [], $missingRoles);
    $check('At least one active administrator', (int) $pdo->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='admin' AND u.is_active=1")->fetchColumn() > 0);
    $bedCodes = $pdo->query('SELECT bed_code FROM beds')->fetchAll(PDO::FETCH_COLUMN);
    $expectedBeds = app_config('bed_codes');
    $check('Configured bed inventory matches database', array_diff($expectedBeds, $bedCodes) === [] && array_diff($bedCodes, $expectedBeds) === [], ['expected' => count($expectedBeds), 'actual' => count($bedCodes)]);
    $report['bed_status_counts'] = $pdo->query('SELECT status, COUNT(*) AS total FROM beds GROUP BY status')->fetchAll();
    $report['patient_status_counts'] = $pdo->query('SELECT status, COUNT(*) AS total FROM patients GROUP BY status')->fetchAll();
    $pdo->rollBack();
} catch (Throwable $exception) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $check('Audit completed', false, $exception->getMessage());
}

$report['passed'] = count(array_filter($report['checks'], static fn ($item) => $item['ok']));
$report['failed'] = count($report['checks']) - $report['passed'];
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
exit($report['failed'] === 0 ? 0 : 1);
