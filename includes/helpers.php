<?php

class ValidationException extends RuntimeException
{
}

function parse_input_datetime(string $value, string $format): ?DateTimeImmutable
{
    $date = DateTimeImmutable::createFromFormat('!' . $format, $value);
    return $date && $date->format($format) === $value ? $date : null;
}

function app_config(?string $key = null, mixed $default = null): mixed
{
    $config = $GLOBALS['config'] ?? [];
    if ($key === null) {
        return $config;
    }

    $value = $config;
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return $default;
        }
        $value = $value[$part];
    }

    return $value;
}

function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function redirect(string $url): never
{
    header('Location: ' . safe_redirect_url($url));
    exit;
}

function safe_redirect_url(string $url): string
{
    if (preg_match('/[\x00-\x20\x7f\\\\]/', $url)) {
        return 'index.php';
    }
    $parts = parse_url($url);
    $scriptPath = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
    if (!is_array($parts) || !in_array($parts['path'] ?? '', ['index.php', $scriptPath], true)) {
        return 'index.php';
    }
    // Return only the local entry point, never a host supplied by the request.
    return 'index.php' . (isset($parts['query']) ? '?' . $parts['query'] : '');
}

function send_security_headers(): void
{
    header_remove('X-Powered-By');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
}

function auth_fingerprint(array $user): string
{
    return hash('sha256', $user['password_hash'] . '|' . $user['role_id']);
}

function login_throttle_path(string $ip): string
{
    $namespace = __DIR__ . '|' . app_config('db.host') . '|' . app_config('db.database');
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'etransit_login_' . hash('sha256', $namespace . '|' . $ip) . '.json';
}

function verify_login_attempt(?array $user, string $identity, string $password): array
{
    $path = login_throttle_path($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $file = fopen($path, 'c+');
    if ($file === false) {
        throw new RuntimeException('Penyimpanan pembatas login tidak tersedia.');
    }
    try {
        if (!flock($file, LOCK_EX)) {
            throw new RuntimeException('Pembatas login tidak dapat dikunci.');
        }
        $now = time();
        $window = max(60, (int) app_config('login_window_seconds', 300));
        $state = json_decode(stream_get_contents($file), true);
        if (!is_array($state) || (int) ($state['started_at'] ?? 0) <= $now - $window) {
            $state = ['started_at' => $now, 'failures' => 0, 'accounts' => []];
        }
        // Username and email for the same account share a counter. Cookies are irrelevant.
        $key = hash('sha256', $user ? 'user:' . $user['id'] : 'identity:' . mb_strtolower($identity));
        $failures = (int) ($state['accounts'][$key] ?? 0);
        $blocked = $failures >= max(1, (int) app_config('login_max_failures', 5))
            || (int) $state['failures'] >= max(1, (int) app_config('login_ip_max_failures', 100));
        if ($blocked) {
            return ['ok' => false, 'retry_after' => max(1, (int) $state['started_at'] + $window - $now)];
        }
        $hash = $user['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi';
        $matches = password_verify($password, $hash);
        $ok = $user !== null && $matches && strlen($password) <= 72;
        if ($ok) {
            unset($state['accounts'][$key]);
        } else {
            $state['accounts'][$key] = $failures + 1;
            $state['failures']++;
        }
        rewind($file);
        if (!ftruncate($file, 0) || fwrite($file, json_encode($state, JSON_THROW_ON_ERROR)) === false || !fflush($file)) {
            throw new RuntimeException('Pembatas login tidak dapat disimpan.');
        }
        return ['ok' => $ok, 'retry_after' => 0];
    } finally {
        flock($file, LOCK_UN);
        fclose($file);
    }
}

function url_for(string $page, array $params = []): string
{
    return 'index.php?' . http_build_query(array_merge(['page' => $page], $params));
}

function csrf_token(): string
{
    if (empty($_SESSION['_csrf'])) {
        $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['_csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function verify_csrf(): void
{
    $posted = $_POST['_csrf'] ?? '';
    $expected = $_SESSION['_csrf'] ?? null;
    if (!is_string($posted) || !is_string($expected) || $expected === '' || !hash_equals($expected, $posted)) {
        set_flash('error', 'Sesi formulir tidak valid. Silakan coba kembali.');
        redirect($_SERVER['HTTP_REFERER'] ?? 'index.php');
    }
}

function set_flash(string $type, string $message): void
{
    $_SESSION['_flash'][] = ['type' => $type, 'message' => $message];
}

function get_flash(): array
{
    $messages = $_SESSION['_flash'] ?? [];
    unset($_SESSION['_flash']);
    return $messages;
}

function current_user(PDO $pdo): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }

    $stmt = $pdo->prepare(
        'SELECT u.*, r.code AS role_code, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? AND u.is_active = 1'
    );
    $stmt->execute([(int) $_SESSION['user_id']]);
    $cache = $stmt->fetch() ?: null;
    if ($cache === null || !hash_equals(auth_fingerprint($cache), (string) ($_SESSION['auth_fingerprint'] ?? ''))) {
        $cache = null;
        reset_session();
    }
    return $cache;
}

function require_auth(PDO $pdo): array
{
    $user = current_user($pdo);
    if (!$user) {
        redirect(url_for('login'));
    }
    send_private_cache_headers();
    return $user;
}

function send_private_cache_headers(): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: Thu, 01 Jan 1970 00:00:00 GMT');
}

function reset_session(): void
{
    $_SESSION = [];
    session_regenerate_id(true);
}

function guard_session_timeout(): void
{
    if (empty($_SESSION['user_id'])) {
        return;
    }

    $timeout = (int) app_config('session_timeout', 1800);
    $last = (int) ($_SESSION['last_activity'] ?? time());

    if (time() - $last > $timeout) {
        reset_session();
        set_flash('warning', 'Sesi Anda berakhir. Silakan login kembali.');
        redirect(url_for('login'));
    }

    $_SESSION['last_activity'] = time();
}

function role_permissions(string $roleCode): array
{
    return match ($roleCode) {
        'admin' => ['*'],
        'perawat_transit' => [
            'dashboard.view',
            'beds.view',
            'patients.manage',
            'doctors.manage',
            'transfers.manage',
            'reports.view',
            'exports.download',
            'profile.manage',
        ],
        'perawat_igd' => [
            'dashboard.view',
            'beds.monitor',
            'profile.manage',
        ],
        default => [],
    };
}

function can(PDO $pdo, string $permission): bool
{
    $user = current_user($pdo);
    if (!$user) {
        return false;
    }

    $permissions = role_permissions($user['role_code']);
    return in_array('*', $permissions, true) || in_array($permission, $permissions, true);
}

function require_permission(PDO $pdo, string $permission): void
{
    if (!can($pdo, $permission)) {
        http_response_code(403);
        render_error_page('Akses ditolak', 'Akun Anda tidak memiliki hak untuk membuka halaman ini.');
        exit;
    }
}

function audit_log(PDO $pdo, string $action, string $description, ?int $userId = null): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'CLI';
    $userId ??= isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;

    $stmt = $pdo->prepare(
        'INSERT INTO audit_logs (user_id, action, ip_address, description, created_at)
         VALUES (?, ?, ?, ?, NOW())'
    );
    $stmt->execute([$userId, $action, $ip, $description]);
}

function valid_password(string $password): bool
{
    return strlen($password) <= 72 && preg_match(app_config('password_regex'), $password) === 1;
}

function selected(mixed $a, mixed $b): string
{
    return (string) $a === (string) $b ? ' selected' : '';
}

function checked(mixed $a, mixed $b): string
{
    return (string) $a === (string) $b ? ' checked' : '';
}

function fetch_roles(PDO $pdo, bool $includeAdmin = true): array
{
    $sql = 'SELECT * FROM roles';
    if (!$includeAdmin) {
        $sql .= " WHERE code <> 'admin'";
    }
    $sql .= ' ORDER BY FIELD(code, "perawat_igd", "perawat_transit", "admin")';
    return $pdo->query($sql)->fetchAll();
}

function fetch_active_doctors(PDO $pdo): array
{
    return $pdo->query(
        'SELECT d.*, s.name AS specialization_name, s.keywords
         FROM doctors d
         JOIN specializations s ON s.id = d.specialization_id
         WHERE d.is_active = 1 AND d.deleted_at IS NULL AND s.is_active = 1
         ORDER BY d.name'
    )->fetchAll();
}

function get_patient_vitals(PDO $pdo, int $patientId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM vital_signs WHERE patient_id = ? ORDER BY id DESC LIMIT 1');
    $stmt->execute([$patientId]);
    return $stmt->fetch() ?: null;
}

function calculate_age_years(string $birthDate, ?string $at = null): int
{
    $birth = new DateTimeImmutable($birthDate);
    $now = new DateTimeImmutable($at ?: 'now');
    return (int) $birth->diff($now)->y;
}

function patient_title(string $gender, string $birthDate, string $maritalStatus): string
{
    $age = calculate_age_years($birthDate);
    if ($age <= 1) {
        return 'By.';
    }
    if ($age < 18) {
        return 'An.';
    }
    if ($gender === 'L') {
        return 'Tn.';
    }
    return $maritalStatus === 'Menikah' ? 'Ny.' : 'Nn.';
}

function patient_display_name(array $patient): string
{
    if (empty($patient['birth_date']) || empty($patient['gender']) || empty($patient['marital_status'])) {
        return $patient['full_name'] ?? '';
    }
    return patient_title($patient['gender'], $patient['birth_date'], $patient['marital_status']) . ' ' . $patient['full_name'];
}

function format_gender(string $gender): string
{
    return $gender === 'L' ? 'Laki-laki' : 'Perempuan';
}

function format_datetime(?string $value): string
{
    if (!$value) {
        return '-';
    }
    return (new DateTimeImmutable($value))->format('d M Y H:i');
}

function html_datetime_value(?string $value): string
{
    if (!$value) {
        return (new DateTimeImmutable())->format('Y-m-d\TH:i');
    }
    $date = parse_input_datetime($value, 'Y-m-d H:i:s') ?? parse_input_datetime($value, 'Y-m-d\TH:i');
    return $date ? $date->format('Y-m-d\TH:i') : '';
}

function format_duration_minutes(?int $minutes): string
{
    if ($minutes === null || $minutes < 0) {
        return '-';
    }
    $hours = intdiv($minutes, 60);
    $remaining = $minutes % 60;
    return sprintf('%02d Jam %02d Menit', $hours, $remaining);
}

function format_duration_between(?string $arrival, ?string $transfer = null): string
{
    if (!$arrival) {
        return '-';
    }
    $start = new DateTimeImmutable($arrival);
    $end = new DateTimeImmutable($transfer ?: 'now');
    $minutes = max(0, (int) floor(($end->getTimestamp() - $start->getTimestamp()) / 60));
    return format_duration_minutes($minutes);
}

function bed_status_label(string $status): string
{
    return app_config('bed_statuses')[$status] ?? $status;
}

function patient_status_label(string $status): string
{
    return app_config('patient_statuses')[$status] ?? $status;
}

function available_bed_count(PDO $pdo): int
{
    return (int) $pdo->query("SELECT COUNT(*) FROM beds WHERE status = 'KOSONG'")->fetchColumn();
}

function group_beds(array $beds): array
{
    $groups = [];
    $lookup = [];
    $statuses = ['KOSONG' => 'empty', 'TERISI' => 'occupied', 'SIAP_TRANSFER' => 'ready', 'NONAKTIF' => 'inactive'];
    $summary = ['total' => 0, 'empty' => 0, 'occupied' => 0, 'ready' => 0, 'inactive' => 0];
    foreach (app_config('bed_groups', []) as $id => $definition) {
        $groups[$id] = ['id' => $id, 'label' => $definition['label'], 'beds' => [], 'summary' => $summary];
        foreach ($definition['codes'] as $code) {
            $lookup[strtoupper($code)] = $id;
        }
    }
    foreach ($beds as $bed) {
        $id = $lookup[strtoupper($bed['bed_code'])] ?? 'other';
        if (!isset($groups[$id])) {
            $groups[$id] = ['id' => $id, 'label' => 'Bed Lainnya', 'beds' => [], 'summary' => $summary];
        }
        $groups[$id]['beds'][] = $bed;
        $groups[$id]['summary']['total']++;
        if (isset($statuses[$bed['status']])) {
            $groups[$id]['summary'][$statuses[$bed['status']]]++;
        }
    }
    return array_values(array_filter($groups, fn ($group) => $group['beds'] !== []));
}

function report_filters_from_request(array $source): array
{
    return [
        'day' => trim((string) ($source['day'] ?? '')),
        'month' => trim((string) ($source['month'] ?? '')),
        'year' => trim((string) ($source['year'] ?? '')),
        'doctor_id' => trim((string) ($source['doctor_id'] ?? '')),
        'diagnosis' => trim((string) ($source['diagnosis'] ?? '')),
        'status' => trim((string) ($source['status'] ?? '')),
        'room' => trim((string) ($source['room'] ?? '')),
        'bed_status' => trim((string) ($source['bed_status'] ?? '')),
    ];
}

function build_patient_report_query(array $filters): array
{
    $where = ['p.deleted_at IS NULL'];
    $params = [];

    if ($filters['day'] !== '') {
        $where[] = 'DATE(p.arrival_time) = ?';
        $params[] = $filters['day'];
    }
    if ($filters['month'] !== '') {
        $where[] = 'DATE_FORMAT(p.arrival_time, "%Y-%m") = ?';
        $params[] = $filters['month'];
    }
    if ($filters['year'] !== '') {
        $where[] = 'YEAR(p.arrival_time) = ?';
        $params[] = (int) $filters['year'];
    }
    if ($filters['doctor_id'] !== '') {
        $where[] = 'p.doctor_id = ?';
        $params[] = (int) $filters['doctor_id'];
    }
    if ($filters['diagnosis'] !== '') {
        $where[] = 'p.diagnosis LIKE ?';
        $params[] = '%' . $filters['diagnosis'] . '%';
    }
    if ($filters['status'] !== '') {
        $where[] = 'p.status = ?';
        $params[] = $filters['status'];
    }
    if ($filters['room'] !== '') {
        $where[] = 'p.planned_room LIKE ?';
        $params[] = '%' . $filters['room'] . '%';
    }
    if ($filters['bed_status'] !== '') {
        $where[] = 'b.status = ?';
        $params[] = $filters['bed_status'];
    }

    $sql = 'FROM patients p
            LEFT JOIN doctors d ON d.id = p.doctor_id
            LEFT JOIN specializations s ON s.id = d.specialization_id
            LEFT JOIN beds b ON b.id = p.bed_id
            WHERE ' . implode(' AND ', $where);

    return [$sql, $params];
}

function fetch_report_patients(PDO $pdo, array $filters): array
{
    [$from, $params] = build_patient_report_query($filters);
    $stmt = $pdo->prepare(
        'SELECT p.*, d.name AS doctor_name, s.name AS specialization_name, b.bed_code, b.status AS bed_status, ' .
        'TIMESTAMPDIFF(MINUTE, p.arrival_time, COALESCE(p.transfer_time, NOW())) AS stay_minutes ' .
        $from . ' ORDER BY p.arrival_time DESC'
    );
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function render_error_page(string $title, string $message): void
{
    ?>
    <!doctype html>
    <html lang="id">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= e($title) ?> - E-Transit</title>
        <link rel="stylesheet" href="assets/css/styles.css?v=<?= filemtime(__DIR__ . '/../assets/css/styles.css') ?>">
    </head>
    <body class="center-page">
        <main class="error-card">
            <img src="logo_etransit.png" alt="E-Transit">
            <h1><?= e($title) ?></h1>
            <p><?= e($message) ?></p>
            <a class="btn btn-primary" href="index.php">Kembali</a>
        </main>
    </body>
    </html>
    <?php
}
