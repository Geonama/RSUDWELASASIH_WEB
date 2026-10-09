<?php

declare(strict_types=1);

return static function (PDO $pdo): void {
    $stmt = $pdo->prepare('INSERT IGNORE INTO specializations (name, keywords) VALUES (?, ?)');
    foreach ([
        ['Spesialis Dermatologi', 'dermatologi'],
        ['Spesialis Venereologi', 'venereologi'],
    ] as $specialization) {
        $stmt->execute($specialization);
    }
};
