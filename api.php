<?php

declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = db(true);
    require_auth($pdo);
    $action = (string) ($_GET['action'] ?? '');

    if ($action !== 'beds') {
        throw new RuntimeException('Endpoint tidak tersedia.');
    }

    if (!can($pdo, 'beds.monitor') && !can($pdo, 'beds.view')) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'message' => 'Akses ditolak.']);
        exit;
    }

    $beds = fetch_beds_with_patient_payload($pdo);
    $averageStay = $pdo->query('SELECT AVG(TIMESTAMPDIFF(MINUTE, arrival_time, COALESCE(transfer_time, NOW()))) FROM patients WHERE deleted_at IS NULL')->fetchColumn();
    $summary = [
        'empty' => 0,
        'occupied' => 0,
        'ready' => 0,
        'inactive' => 0,
        'today' => (int) $pdo->query('SELECT COUNT(*) FROM patients WHERE DATE(arrival_time) = CURDATE() AND deleted_at IS NULL')->fetchColumn(),
        'average_stay' => format_duration_minutes($averageStay !== null ? (int) $averageStay : 0),
    ];
    foreach ($beds as $bed) {
        if ($bed['status'] === 'KOSONG') {
            $summary['empty']++;
        } elseif ($bed['status'] === 'TERISI') {
            $summary['occupied']++;
        } elseif ($bed['status'] === 'SIAP_TRANSFER') {
            $summary['ready']++;
        } elseif ($bed['status'] === 'NONAKTIF') {
            $summary['inactive']++;
        }
    }
    $summary['active'] = $summary['empty'] + $summary['occupied'] + $summary['ready'];

    echo json_encode([
        'ok' => true,
        'summary' => $summary,
        'canManage' => can($pdo, 'patients.manage'),
        'csrf' => csrf_token(),
        'beds' => $beds,
        'groups' => array_map(fn ($group) => [
            'id' => $group['id'],
            'label' => $group['label'],
            'summary' => $group['summary'],
            'bed_ids' => array_column($group['beds'], 'id'),
        ], group_beds($beds)),
    ], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log($e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Terjadi kesalahan pada sistem.']);
}

function fetch_beds_with_patient_payload(PDO $pdo): array
{
    $rows = $pdo->query(
        'SELECT b.*, p.id AS patient_id_real, p.medical_record_number, p.full_name, p.gender, p.birth_date, p.marital_status,
                p.status AS patient_status, p.arrival_time, p.planned_room
         FROM beds b
         LEFT JOIN patients p ON p.id = b.patient_id AND p.deleted_at IS NULL
         ORDER BY b.bed_code'
    )->fetchAll();

    return array_map(function (array $bed): array {
        return [
            'id' => (int) $bed['id'],
            'bed_code' => $bed['bed_code'],
            'status' => $bed['status'],
            'status_label' => bed_status_label($bed['status']),
            'patient_id' => $bed['patient_id_real'] ? (int) $bed['patient_id_real'] : null,
            'patient_name' => $bed['patient_id_real'] ? patient_display_name($bed) : null,
            'medical_record_number' => $bed['medical_record_number'],
            'arrival_time' => $bed['arrival_time'] ? format_datetime($bed['arrival_time']) : null,
        ];
    }, $rows);
}
