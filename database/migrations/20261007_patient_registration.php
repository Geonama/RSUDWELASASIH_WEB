<?php

declare(strict_types=1);

return static function (PDO $pdo): void {
    $definitions = [
        'identity_number' => 'VARCHAR(80) NULL',
        'religion' => 'VARCHAR(30) NULL',
        'payer_type' => 'VARCHAR(30) NULL',
        'care_class' => 'VARCHAR(15) NULL',
        'guardian_name' => 'VARCHAR(150) NULL',
        'guardian_relationship' => 'VARCHAR(80) NULL',
        'guardian_phone' => 'VARCHAR(30) NULL',
        'education' => 'VARCHAR(100) NULL',
    ];
    $existing = $pdo->query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patients'"
    )->fetchAll(PDO::FETCH_COLUMN);
    $changes = [];
    foreach ($definitions as $column => $definition) {
        if (!in_array($column, $existing, true)) {
            $changes[] = "ADD COLUMN `$column` $definition";
        }
    }
    if ($changes) {
        $pdo->exec('ALTER TABLE patients ' . implode(', ', $changes));
    }
};
