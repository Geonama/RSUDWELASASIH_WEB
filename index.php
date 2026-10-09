<?php

declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap.php';

try {
    $pdo = db(true);
} catch (Throwable $e) {
    error_log($e->getMessage());
    render_error_page('Database belum siap', 'Jalankan php database/setup.php dari folder project, lalu buka kembali aplikasi.');
    exit;
}

$page = $_GET['page'] ?? null;
$page = is_string($page) ? $page : null;

if ($page === null) {
    $page = current_user($pdo) ? 'dashboard' : 'login';
}

if ($page === 'login') {
    handle_login_page($pdo);
    exit;
}

if ($page === 'register') {
    handle_register_page($pdo);
    exit;
}

if ($page === 'logout') {
    handle_logout($pdo);
    exit;
}

$user = require_auth($pdo);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    handle_authenticated_action($pdo);
}

match ($page) {
    'dashboard' => render_dashboard($pdo),
    'monitor' => render_bed_page($pdo, false),
    'transit' => render_bed_page($pdo, true),
    'patients' => render_patients_page($pdo),
    'patient_form' => render_patient_form_page($pdo),
    'patient_detail' => render_patient_detail_page($pdo),
    'doctors' => render_doctors_page($pdo),
    'transfer' => render_transfer_page($pdo),
    'reports' => render_reports_page($pdo),
    'export' => render_export($pdo),
    'beds' => render_beds_admin_page($pdo),
    'users' => render_users_page($pdo),
    'audit' => render_audit_page($pdo),
    'profile' => render_profile_page($pdo),
    default => render_not_found($pdo),
};

function handle_login_page(PDO $pdo): void
{
    if (current_user($pdo)) {
        redirect(url_for('dashboard'));
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        verify_csrf();
        $identity = trim((string) ($_POST['identity'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        $stmt = $pdo->prepare(
            'SELECT u.*, r.code AS role_code
             FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE (u.username = ? OR u.email = ?) AND u.is_active = 1
             LIMIT 1'
        );
        $stmt->execute([$identity, $identity]);
        $user = $stmt->fetch();

        try {
            $attempt = verify_login_attempt($user ?: null, $identity, $password);
        } catch (Throwable $e) {
            error_log($e->getMessage());
            set_flash('error', 'Layanan login sementara tidak tersedia. Silakan coba kembali.');
            redirect(url_for('login'));
        }
        if ($attempt['retry_after'] > 0) {
            header('Retry-After: ' . $attempt['retry_after']);
            set_flash('error', 'Terlalu banyak percobaan login. Coba kembali dalam ' . (int) ceil($attempt['retry_after'] / 60) . ' menit.');
            redirect(url_for('login'));
        }
        if (!$attempt['ok']) {
            set_flash('error', 'Username atau password tidak valid.');
            redirect(url_for('login'));
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['last_activity'] = time();
        $_SESSION['auth_fingerprint'] = auth_fingerprint($user);
        unset($_SESSION['_csrf']);

        $pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')->execute([(int) $user['id']]);
        audit_log($pdo, 'Login', 'User berhasil login.', (int) $user['id']);

        redirect(match ($user['role_code']) {
            'perawat_igd' => url_for('monitor'),
            'admin' => url_for('dashboard'),
            default => url_for('dashboard'),
        });
    }

    render_auth_header('Login');
    ?>
    <form class="stack-form auth-login-form" method="post" data-loading-form>
        <?= csrf_field() ?>
        <div class="section-heading">
            <h2 id="auth-title">Selamat datang</h2>
        </div>
        <div class="auth-field">
            <label for="login-identity">Username atau email</label>
            <div class="auth-input-wrap">
                <img class="auth-input-icon" src="assets/icons/user-round.svg" alt="" aria-hidden="true" width="20" height="20">
                <input id="login-identity" type="text" name="identity" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            </div>
        </div>
        <div class="auth-field">
            <label for="login-password">Password</label>
            <div class="auth-input-wrap">
                <img class="auth-input-icon" src="assets/icons/lock-keyhole.svg" alt="" aria-hidden="true" width="20" height="20">
                <input id="login-password" type="password" name="password" autocomplete="current-password" required>
                <button class="password-toggle" type="button" data-password-toggle aria-controls="login-password" aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password">
                    <img src="assets/icons/eye.svg" alt="" width="20" height="20" data-password-toggle-icon>
                </button>
            </div>
        </div>
        <button class="btn btn-primary btn-full auth-submit" type="submit" data-loading-text="Memeriksa akun...">
            <span>Masuk</span>
            <img src="assets/icons/arrow-right.svg" alt="" aria-hidden="true" width="20" height="20">
        </button>
        <p class="auth-switch">Belum punya akun? <a href="<?= e(url_for('register')) ?>" data-auth-link>Daftar perawat</a></p>
    </form>
    <?php
    render_auth_footer();
}

function handle_register_page(PDO $pdo): void
{
    if (current_user($pdo)) {
        redirect(url_for('dashboard'));
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        verify_csrf();
        $fullName = trim((string) ($_POST['full_name'] ?? ''));
        $username = trim((string) ($_POST['username'] ?? ''));
        $email = trim((string) ($_POST['email'] ?? ''));
        $identity = trim((string) ($_POST['identity_number'] ?? ''));
        $roleCode = trim((string) ($_POST['role'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $confirm = (string) ($_POST['password_confirm'] ?? '');

        $errors = [];
        if ($fullName === '' || mb_strlen($fullName) < 3) {
            $errors[] = 'Nama lengkap wajib diisi minimal 3 karakter.';
        }
        if (!preg_match('/^[A-Za-z0-9_.-]{4,80}$/', $username)) {
            $errors[] = 'Username minimal 4 karakter dan hanya boleh huruf, angka, titik, strip, atau underscore.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'Format email tidak valid.';
        }
        if (!in_array($roleCode, ['perawat_igd', 'perawat_transit'], true)) {
            $errors[] = 'Role register tidak valid.';
        }
        if ($password !== $confirm) {
            $errors[] = 'Password dan konfirmasi password harus sama.';
        }
        if (!valid_password($password)) {
            $errors[] = 'Password harus 8-72 karakter, berisi huruf besar, huruf kecil, angka, dan karakter khusus.';
        }

        $exists = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ? OR email = ?');
        $exists->execute([$username, $email]);
        if ((int) $exists->fetchColumn() > 0) {
            $errors[] = 'Username atau email sudah digunakan.';
        }

        if ($errors) {
            set_flash('error', $errors[0]);
            redirect(url_for('register'));
        }

        $roleStmt = $pdo->prepare('SELECT id FROM roles WHERE code = ?');
        $roleStmt->execute([$roleCode]);
        $roleId = (int) $roleStmt->fetchColumn();

        $stmt = $pdo->prepare(
            'INSERT INTO users (role_id, full_name, username, email, identity_number, password_hash)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$roleId, $fullName, $username, $email, $identity ?: null, password_hash($password, PASSWORD_BCRYPT)]);

        audit_log($pdo, 'Register', 'Akun baru terdaftar: ' . $username, (int) $pdo->lastInsertId());
        set_flash('success', 'Registrasi berhasil. Silakan login menggunakan akun baru.');
        redirect(url_for('login'));
    }

    render_auth_header('Register');
    ?>
    <form class="stack-form" method="post" data-loading-form data-password-form>
        <?= csrf_field() ?>
        <div class="section-heading">
            <h2 id="auth-title">Daftar akun perawat</h2>
        </div>
        <div class="form-grid two">
            <label>Nama Lengkap
                <input type="text" name="full_name" required minlength="3">
            </label>
            <label>Nomor Identitas
                <input type="text" name="identity_number" maxlength="80">
            </label>
            <label>Username
                <input type="text" name="username" required pattern="[A-Za-z0-9_.-]{4,80}">
            </label>
            <label>Email
                <input type="email" name="email" required>
            </label>
            <label>Role
                <select name="role" required>
                    <option value="perawat_igd">Perawat IGD</option>
                    <option value="perawat_transit">Perawat Transit</option>
                </select>
            </label>
            <div class="auth-field">
                <label for="register-password">Password</label>
                <div class="auth-input-wrap auth-password-wrap">
                    <input id="register-password" type="password" name="password" autocomplete="new-password" required data-password-input>
                    <button class="password-toggle" type="button" data-password-toggle aria-controls="register-password" aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password">
                        <img src="assets/icons/eye.svg" alt="" aria-hidden="true" width="20" height="20" data-password-toggle-icon>
                    </button>
                </div>
            </div>
            <div class="auth-field">
                <label for="register-password-confirm">Konfirmasi Password</label>
                <div class="auth-input-wrap auth-password-wrap">
                    <input id="register-password-confirm" type="password" name="password_confirm" autocomplete="new-password" required>
                    <button class="password-toggle" type="button" data-password-toggle data-password-label="konfirmasi password" aria-controls="register-password-confirm" aria-label="Tampilkan konfirmasi password" aria-pressed="false" title="Tampilkan konfirmasi password">
                        <img src="assets/icons/eye.svg" alt="" aria-hidden="true" width="20" height="20" data-password-toggle-icon>
                    </button>
                </div>
            </div>
        </div>
        <p class="password-hint" data-password-hint>Gunakan huruf besar, huruf kecil, angka, dan karakter khusus.</p>
        <button class="btn btn-primary btn-full auth-submit" type="submit" data-loading-text="Menyimpan akun...">
            <span>Register</span>
            <img src="assets/icons/arrow-right.svg" alt="" aria-hidden="true" width="20" height="20">
        </button>
        <p class="auth-switch">Sudah punya akun? <a href="<?= e(url_for('login')) ?>" data-auth-link>Login</a></p>
    </form>
    <?php
    render_auth_footer();
}

function handle_logout(PDO $pdo): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        redirect(url_for('dashboard'));
    }

    verify_csrf();
    audit_log($pdo, 'Logout', 'User logout dari sistem.');
    reset_session();
    set_flash('success', 'Anda berhasil logout.');
    redirect(url_for('login'));
}

function handle_authenticated_action(PDO $pdo): void
{
    verify_csrf();
    $action = (string) ($_POST['action'] ?? '');

    try {
        match ($action) {
            'save_patient' => action_save_patient($pdo),
            'delete_patient' => action_delete_patient($pdo),
            'mark_ready' => action_mark_ready($pdo),
            'save_transfer_plan' => action_save_transfer_plan($pdo),
            'transfer_selected' => action_transfer_selected($pdo),
            'save_doctor' => action_save_doctor($pdo),
            'delete_doctor' => action_delete_doctor($pdo),
            'save_bed' => action_save_bed($pdo),
            'toggle_bed' => action_toggle_bed($pdo),
            'save_user' => action_save_user($pdo),
            'toggle_user' => action_toggle_user($pdo),
            'change_password' => action_change_password($pdo),
            default => redirect($_SERVER['HTTP_REFERER'] ?? url_for('dashboard')),
        };
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (!$e instanceof ValidationException) {
            error_log($e->getMessage());
        }
        set_flash('error', $e instanceof ValidationException ? $e->getMessage() : 'Terjadi kesalahan pada sistem. Silakan coba kembali.');
        redirect($_SERVER['HTTP_REFERER'] ?? url_for('dashboard'));
    }
}

function patient_input(PDO $pdo, ?int $id = null): array
{
    $data = [
        'medical_record_number' => trim((string) ($_POST['medical_record_number'] ?? '')),
        'identity_number' => trim((string) ($_POST['identity_number'] ?? '')),
        'religion' => trim((string) ($_POST['religion'] ?? '')),
        'payer_type' => trim((string) ($_POST['payer_type'] ?? '')),
        'care_class' => trim((string) ($_POST['care_class'] ?? '')),
        'guardian_name' => trim((string) ($_POST['guardian_name'] ?? '')),
        'guardian_relationship' => trim((string) ($_POST['guardian_relationship'] ?? '')),
        'guardian_phone' => trim((string) ($_POST['guardian_phone'] ?? '')),
        'education' => trim((string) ($_POST['education'] ?? '')),
        'full_name' => trim((string) ($_POST['full_name'] ?? '')),
        'gender' => trim((string) ($_POST['gender'] ?? '')),
        'birth_date' => trim((string) ($_POST['birth_date'] ?? '')),
        'address' => trim((string) ($_POST['address'] ?? '')),
        'marital_status' => trim((string) ($_POST['marital_status'] ?? '')),
        'dependency_level' => trim((string) ($_POST['dependency_level'] ?? '')),
        'doctor_id' => (int) ($_POST['doctor_id'] ?? 0),
        'diagnosis' => trim((string) ($_POST['diagnosis'] ?? '')),
        'consciousness_status' => trim((string) ($_POST['consciousness_status'] ?? '')),
        'planned_room' => trim((string) ($_POST['planned_room'] ?? '')),
        'arrival_time' => trim((string) ($_POST['arrival_time'] ?? '')),
    ];

    $vitals = [
        'blood_pressure' => trim((string) ($_POST['blood_pressure'] ?? '')),
        'pulse' => trim((string) ($_POST['pulse'] ?? '')),
        'respiration' => trim((string) ($_POST['respiration'] ?? '')),
        'temperature' => trim((string) ($_POST['temperature'] ?? '')),
        'oxygen_saturation' => trim((string) ($_POST['oxygen_saturation'] ?? '')),
        'notes' => trim((string) ($_POST['vital_notes'] ?? '')),
    ];

    $errors = [];
    if (!preg_match('/^[A-Za-z0-9 .\/-]{2,50}$/', $data['medical_record_number'])) {
        $errors[] = 'No. RM wajib diisi dan hanya boleh huruf, angka, spasi, titik, garis miring, atau strip.';
    }
    if ($data['full_name'] === '') {
        $errors[] = 'Nama pasien wajib diisi.';
    }
    if (!in_array($data['gender'], ['L', 'P'], true)) {
        $errors[] = 'Jenis kelamin tidak valid.';
    }
    $birth = parse_input_datetime($data['birth_date'], 'Y-m-d');
    if (!$birth || $data['birth_date'] > date('Y-m-d')) {
        $errors[] = 'Tanggal lahir harus valid dan tidak boleh melebihi hari ini.';
    }
    if ($data['address'] === '') {
        $errors[] = 'Alamat wajib diisi.';
    }
    if (!in_array($data['marital_status'], ['Belum Menikah', 'Menikah', 'Cerai'], true)) {
        $errors[] = 'Status perkawinan tidak valid.';
    }
    if (!in_array($data['dependency_level'], ['Minimal Care', 'Partial'], true)) {
        $errors[] = 'Tingkat ketergantungan tidak valid.';
    }
    if ($data['doctor_id'] <= 0) {
        $errors[] = 'Dokter DPJP wajib dipilih dari master dokter.';
    } else {
        $doctor = $pdo->prepare(
            "SELECT COUNT(*) FROM doctors d JOIN specializations s ON s.id = d.specialization_id
             WHERE d.id = ? AND ((d.is_active = 1 AND d.deleted_at IS NULL AND s.is_active = 1)
               OR EXISTS (SELECT 1 FROM patients p WHERE p.id = ? AND p.doctor_id = d.id
                          AND p.deleted_at IS NULL AND p.status IN ('ACTIVE', 'READY_TRANSFER')))"
        );
        $doctor->execute([$data['doctor_id'], $id ?? 0]);
        if ((int) $doctor->fetchColumn() === 0) {
            $errors[] = 'Dokter DPJP tidak aktif atau tidak tersedia.';
        }
    }
    if ($data['diagnosis'] === '') {
        $errors[] = 'Diagnosa wajib diisi.';
    }
    $previousSelections = [];
    if ($id) {
        $previous = $pdo->prepare(
            "SELECT consciousness_status, planned_room, payer_type FROM patients
             WHERE id = ? AND deleted_at IS NULL AND status IN ('ACTIVE', 'READY_TRANSFER')"
        );
        $previous->execute([$id]);
        $previousSelections = $previous->fetch() ?: [];
    }
    // A selected disabled legacy option is omitted from the browser's submission.
    if (!array_key_exists('payer_type', $_POST) && ($previousSelections['payer_type'] ?? null) === 'BPJS PBI') {
        $data['payer_type'] = $previousSelections['payer_type'];
    }
    foreach (['consciousness_status' => 'Status kesadaran', 'planned_room' => 'Rencana ruangan'] as $field => $label) {
        $allowed = app_config('patient_options.' . $field, []);
        if ($data[$field] === '' || (!in_array($data[$field], $allowed, true) && $data[$field] !== ($previousSelections[$field] ?? null))) {
            $errors[] = $label . ' wajib dipilih dari daftar yang tersedia.';
        }
    }
    foreach (['religion' => 'Agama', 'payer_type' => 'Penanggung pasien', 'care_class' => 'Kelas perawatan'] as $field => $label) {
        $retainedPayer = $field === 'payer_type' && $data[$field] === 'BPJS PBI'
            && $data[$field] === ($previousSelections[$field] ?? null);
        if ($data[$field] !== '' && !in_array($data[$field], app_config('patient_options.' . $field, []), true) && !$retainedPayer) {
            $errors[] = $label . ' tidak valid.';
        }
    }
    $optionalLengths = ['identity_number' => 80, 'guardian_name' => 150, 'guardian_relationship' => 80, 'guardian_phone' => 30, 'education' => 100];
    foreach ($optionalLengths as $field => $limit) {
        if (mb_strlen($data[$field]) > $limit) {
            $errors[] = 'Data identitas atau penanggung jawab melebihi panjang yang diperbolehkan.';
        }
    }
    if ($data['identity_number'] !== '' && !preg_match('/^[A-Za-z0-9 .\/-]{1,80}$/', $data['identity_number'])) {
        $errors[] = 'No. KTP/SIM/NIP hanya boleh berisi huruf, angka, spasi, titik, garis miring, atau strip.';
    }
    if ($data['guardian_phone'] !== '' && !preg_match('/^\+?[0-9][0-9 ()-]{5,28}$/', $data['guardian_phone'])) {
        $errors[] = 'No. HP harus berupa nomor telepon yang valid, maksimal 30 karakter.';
    }
    $arrival = parse_input_datetime($data['arrival_time'], 'Y-m-d\TH:i');
    if (!$arrival) {
        $errors[] = 'Waktu kedatangan tidak valid.';
    } elseif ($arrival > new DateTimeImmutable()) {
        $errors[] = 'Waktu kedatangan tidak boleh melebihi waktu sekarang.';
    } elseif ($birth && $arrival < $birth) {
        $errors[] = 'Waktu kedatangan tidak boleh sebelum tanggal lahir.';
    } else {
        $data['arrival_time'] = $arrival->format('Y-m-d H:i:s');
    }
    foreach (['blood_pressure', 'pulse', 'respiration', 'temperature', 'oxygen_saturation'] as $vitalKey) {
        if ($vitals[$vitalKey] === '') {
            $errors[] = 'Data tanda vital wajib lengkap.';
            break;
        }
    }

    $mr = $pdo->prepare('SELECT COUNT(*) FROM patients WHERE medical_record_number = ? AND id <> ?');
    $mr->execute([$data['medical_record_number'], $id ?? 0]);
    if ((int) $mr->fetchColumn() > 0) {
        $errors[] = 'No. RM sudah digunakan pasien lain.';
    }

    if ($errors) {
        throw new ValidationException($errors[0]);
    }

    foreach (['identity_number', 'religion', 'payer_type', 'care_class', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'education'] as $field) {
        $data[$field] = $data[$field] !== '' ? $data[$field] : null;
    }
    return [$data, $vitals];
}

function action_save_patient(PDO $pdo): void
{
    require_permission($pdo, 'patients.manage');
    $id = isset($_POST['id']) && $_POST['id'] !== '' ? (int) $_POST['id'] : null;
    $userId = (int) $_SESSION['user_id'];

    try {
        [$data, $vitals] = patient_input($pdo, $id);
        $pdo->beginTransaction();

        if ($id === null) {
            $bedStmt = $pdo->query("SELECT * FROM beds WHERE status = 'KOSONG' ORDER BY bed_code LIMIT 1 FOR UPDATE");
            $bed = $bedStmt->fetch();
            if (!$bed) {
                throw new ValidationException('Tidak ada bed kosong yang tersedia.');
            }

            $stmt = $pdo->prepare(
                'INSERT INTO patients
                 (medical_record_number, full_name, gender, birth_date, address, marital_status, dependency_level,
                  doctor_id, diagnosis, consciousness_status, planned_room, arrival_time, identity_number, religion,
                  payer_type, care_class, guardian_name, guardian_relationship, guardian_phone, education,
                  bed_id, status, created_by, updated_by)
                 VALUES (:medical_record_number, :full_name, :gender, :birth_date, :address, :marital_status,
                         :dependency_level, :doctor_id, :diagnosis, :consciousness_status, :planned_room, :arrival_time,
                         :identity_number, :religion, :payer_type, :care_class, :guardian_name, :guardian_relationship,
                         :guardian_phone, :education, :bed_id, "ACTIVE", :created_by, :updated_by)'
            );
            $stmt->execute($data + [
                'bed_id' => (int) $bed['id'], 'created_by' => $userId, 'updated_by' => $userId,
            ]);
            $patientId = (int) $pdo->lastInsertId();
            insert_vitals($pdo, $patientId, $vitals);
            $pdo->prepare("UPDATE beds SET status = 'TERISI', patient_id = ? WHERE id = ?")->execute([$patientId, (int) $bed['id']]);
            audit_log($pdo, 'Tambah pasien', 'Pasien ' . $data['medical_record_number'] . ' ditempatkan di ' . $bed['bed_code']);
            set_flash('success', 'Data pasien berhasil ditambahkan ke ' . $bed['bed_code'] . '.');
        } else {
            $old = $pdo->prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
            $old->execute([$id]);
            $patient = $old->fetch();
            if (!$patient) {
                throw new ValidationException('Pasien tidak ditemukan.');
            }
            if (!in_array($patient['status'], ['ACTIVE', 'READY_TRANSFER'], true)) {
                throw new ValidationException('Histori pasien yang sudah ditransfer tidak dapat diubah.');
            }

            $stmt = $pdo->prepare(
                'UPDATE patients SET medical_record_number = :medical_record_number, full_name = :full_name,
                 gender = :gender, birth_date = :birth_date, address = :address, marital_status = :marital_status,
                 dependency_level = :dependency_level, doctor_id = :doctor_id, diagnosis = :diagnosis,
                 consciousness_status = :consciousness_status, planned_room = :planned_room, arrival_time = :arrival_time,
                 identity_number = :identity_number, religion = :religion, payer_type = :payer_type, care_class = :care_class,
                 guardian_name = :guardian_name, guardian_relationship = :guardian_relationship,
                 guardian_phone = :guardian_phone, education = :education, updated_by = :updated_by
                 WHERE id = :id'
            );
            $stmt->execute($data + ['updated_by' => $userId, 'id' => $id]);
            insert_vitals($pdo, $id, $vitals);
            if ($patient['arrival_time'] !== $data['arrival_time']) {
                audit_log($pdo, 'Edit waktu kedatangan', 'Waktu kedatangan pasien ' . $data['medical_record_number'] . ' diubah dari ' . $patient['arrival_time'] . ' menjadi ' . $data['arrival_time']);
            }
            audit_log($pdo, 'Edit pasien', 'Data pasien ' . $data['medical_record_number'] . ' diperbarui.');
            set_flash('success', 'Data pasien berhasil diperbarui.');
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (!$e instanceof ValidationException) {
            error_log($e->getMessage());
        }
        $_SESSION['_patient_input'] = ['id' => $id, 'data' => $_POST];
        set_flash('error', $e instanceof ValidationException ? $e->getMessage() : 'Terjadi kesalahan pada sistem. Silakan coba kembali.');
        redirect($id ? url_for('patient_form', ['id' => $id]) : url_for('patient_form'));
    }

    unset($_SESSION['_patient_input']);
    redirect(url_for('patients'));
}

function insert_vitals(PDO $pdo, int $patientId, array $vitals): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO vital_signs (patient_id, blood_pressure, pulse, respiration, temperature, oxygen_saturation, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $patientId,
        $vitals['blood_pressure'],
        $vitals['pulse'],
        $vitals['respiration'],
        $vitals['temperature'],
        $vitals['oxygen_saturation'],
        $vitals['notes'] ?: null,
    ]);
}

function action_delete_patient(PDO $pdo): void
{
    require_permission($pdo, 'patients.manage');
    $id = (int) ($_POST['id'] ?? 0);

    $pdo->beginTransaction();
    $stmt = $pdo->prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $stmt->execute([$id]);
    $patient = $stmt->fetch();
    if (!$patient) {
        throw new ValidationException('Pasien tidak ditemukan.');
    }
    if (!in_array($patient['status'], ['ACTIVE', 'READY_TRANSFER'], true)) {
        throw new ValidationException('Histori pasien yang sudah ditransfer tidak dapat dihapus.');
    }

    $pdo->prepare("UPDATE patients SET deleted_at = NOW(), status = 'CANCELLED', updated_by = ? WHERE id = ?")->execute([(int) $_SESSION['user_id'], $id]);
    if (!empty($patient['bed_id']) && in_array($patient['status'], ['ACTIVE', 'READY_TRANSFER'], true)) {
        $pdo->prepare("UPDATE beds SET status = 'KOSONG', patient_id = NULL WHERE id = ?")->execute([(int) $patient['bed_id']]);
    }
    audit_log($pdo, 'Hapus pasien', 'Pasien ' . $patient['medical_record_number'] . ' dihapus secara soft delete.');
    $pdo->commit();

    set_flash('success', 'Data pasien berhasil dihapus dari daftar aktif.');
    redirect(url_for('patients'));
}

function action_mark_ready(PDO $pdo): void
{
    require_permission($pdo, 'patients.manage');
    $id = (int) ($_POST['id'] ?? 0);

    $pdo->beginTransaction();
    $stmt = $pdo->prepare("SELECT * FROM patients WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL FOR UPDATE");
    $stmt->execute([$id]);
    $patient = $stmt->fetch();
    if (!$patient || empty($patient['bed_id'])) {
        throw new ValidationException('Pasien tidak dapat diubah menjadi siap transfer.');
    }
    $pdo->prepare("UPDATE patients SET status = 'READY_TRANSFER', updated_by = ? WHERE id = ?")->execute([(int) $_SESSION['user_id'], $id]);
    $pdo->prepare("UPDATE beds SET status = 'SIAP_TRANSFER' WHERE id = ?")->execute([(int) $patient['bed_id']]);
    audit_log($pdo, 'Perubahan status bed', 'Pasien ' . $patient['medical_record_number'] . ' siap transfer.');
    $pdo->commit();

    set_flash('success', 'Status pasien diubah menjadi siap transfer.');
    redirect($_SERVER['HTTP_REFERER'] ?? url_for('transit'));
}

function action_save_transfer_plan(PDO $pdo): void
{
    require_permission($pdo, 'transfers.manage');
    $id = (int) ($_POST['id'] ?? 0);
    $doctorId = (int) ($_POST['doctor_id'] ?? 0);
    $plannedRoom = trim((string) ($_POST['planned_room'] ?? ''));

    $pdo->beginTransaction();
    $stmt = $pdo->prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $stmt->execute([$id]);
    $patient = $stmt->fetch();
    if (!$patient) {
        throw new ValidationException('Pasien tidak ditemukan.');
    }
    if (!in_array($patient['status'], ['ACTIVE', 'READY_TRANSFER'], true)) {
        throw new ValidationException('Rencana transfer hanya dapat diubah untuk pasien yang masih di ruang transit.');
    }

    $doctor = $pdo->prepare(
        'SELECT d.id FROM doctors d JOIN specializations s ON s.id = d.specialization_id
         WHERE d.id = ? AND ((d.is_active = 1 AND d.deleted_at IS NULL AND s.is_active = 1) OR d.id = ?)'
    );
    $doctor->execute([$doctorId, (int) $patient['doctor_id']]);
    if (!$doctor->fetch()) {
        throw new ValidationException('Dokter DPJP wajib dipilih dari daftar dokter aktif yang terdaftar.');
    }
    if (!array_key_exists($plannedRoom, app_config('transfer_room_options', []))) {
        throw new ValidationException('Rencana ruangan wajib dipilih: Hasan, Husen, Said, atau IGD.');
    }

    $pdo->prepare('UPDATE patients SET doctor_id = ?, planned_room = ?, updated_by = ? WHERE id = ?')->execute([
        $doctorId, $plannedRoom, (int) $_SESSION['user_id'], $id,
    ]);
    audit_log($pdo, 'Edit rencana transfer', 'Dokter DPJP pasien ' . $patient['medical_record_number']
        . ' diubah dari ID ' . $patient['doctor_id'] . ' menjadi ID ' . $doctorId
        . '; rencana ruangan dari ' . $patient['planned_room'] . ' menjadi ' . $plannedRoom . '.');
    $pdo->commit();

    set_flash('success', 'Dokter DPJP dan rencana ruangan berhasil diperbarui.');
    redirect(url_for('transfer'));
}

function action_transfer_selected(PDO $pdo): void
{
    require_permission($pdo, 'transfers.manage');
    $ids = array_values(array_unique(array_map('intval', (array) ($_POST['selected_patients'] ?? []))));
    $ids = array_filter($ids, fn (int $id) => $id > 0);
    if (!$ids) {
        set_flash('warning', 'Pilih minimal satu pasien siap transfer.');
        redirect(url_for('transfer'));
    }

    $pdo->beginTransaction();
    $transferred = 0;
    foreach ($ids as $id) {
        $stmt = $pdo->prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL FOR UPDATE");
        $stmt->execute([$id]);
        $patient = $stmt->fetch();
        if (!$patient || $patient['status'] !== 'READY_TRANSFER' || empty($patient['bed_id'])) {
            throw new ValidationException('Ada pasien yang belum siap transfer.');
        }

        $stayMinutes = max(0, (int) floor((time() - strtotime($patient['arrival_time'])) / 60));
        $pdo->prepare(
            'INSERT INTO transfers (patient_id, bed_id, transferred_by, destination_room, transfer_time, stay_minutes, notes)
             VALUES (?, ?, ?, ?, NOW(), ?, ?)'
        )->execute([
            $id,
            (int) $patient['bed_id'],
            (int) $_SESSION['user_id'],
            $patient['planned_room'],
            $stayMinutes,
            trim((string) ($_POST['transfer_notes'] ?? '')) ?: null,
        ]);
        $pdo->prepare("UPDATE patients SET status = 'TRANSFERRED', transfer_time = NOW(), updated_by = ? WHERE id = ?")->execute([(int) $_SESSION['user_id'], $id]);
        $pdo->prepare("UPDATE beds SET status = 'KOSONG', patient_id = NULL WHERE id = ?")->execute([(int) $patient['bed_id']]);
        $transferred++;
    }
    audit_log($pdo, 'Transfer pasien', $transferred . ' pasien berhasil ditransfer dengan transaksi database.');
    $pdo->commit();

    set_flash('success', $transferred . ' pasien berhasil ditransfer.');
    redirect(url_for('transfer'));
}

function action_save_doctor(PDO $pdo): void
{
    require_permission($pdo, 'doctors.manage');
    $id = isset($_POST['id']) && $_POST['id'] !== '' ? (int) $_POST['id'] : null;
    $name = trim((string) ($_POST['name'] ?? ''));
    $specializationId = (int) ($_POST['specialization_id'] ?? 0);
    $newSpec = trim((string) ($_POST['new_specialization'] ?? ''));
    $keywords = trim((string) ($_POST['keywords'] ?? ''));
    $active = isset($_POST['is_active']) ? 1 : 0;

    if ($name === '') {
        set_flash('error', 'Nama dokter wajib diisi.');
        redirect(url_for('doctors'));
    }

    if ($newSpec !== '') {
        $pdo->prepare('INSERT IGNORE INTO specializations (name, keywords) VALUES (?, ?)')->execute([$newSpec, $keywords ?: $newSpec]);
        $spec = $pdo->prepare('SELECT id FROM specializations WHERE name = ?');
        $spec->execute([$newSpec]);
        $specializationId = (int) $spec->fetchColumn();
    }

    if ($specializationId <= 0) {
        set_flash('error', 'Spesialisasi wajib dipilih atau dibuat.');
        redirect(url_for('doctors'));
    }

    if ($id) {
        $pdo->prepare('UPDATE doctors SET name = ?, specialization_id = ?, is_active = ? WHERE id = ? AND deleted_at IS NULL')
            ->execute([$name, $specializationId, $active, $id]);
        audit_log($pdo, 'Edit dokter', 'Dokter ' . $name . ' diperbarui.');
        set_flash('success', 'Data dokter berhasil diperbarui.');
    } else {
        $pdo->prepare('INSERT INTO doctors (name, specialization_id, is_active) VALUES (?, ?, ?)')
            ->execute([$name, $specializationId, $active]);
        audit_log($pdo, 'Tambah dokter', 'Dokter ' . $name . ' ditambahkan.');
        set_flash('success', 'Data dokter berhasil ditambahkan.');
    }

    redirect(url_for('doctors'));
}

function action_delete_doctor(PDO $pdo): void
{
    require_permission($pdo, 'doctors.manage');
    $id = (int) ($_POST['id'] ?? 0);
    $pdo->prepare('UPDATE doctors SET deleted_at = NOW(), is_active = 0 WHERE id = ?')->execute([$id]);
    audit_log($pdo, 'Hapus dokter', 'Dokter ID ' . $id . ' dinonaktifkan dan disembunyikan.');
    set_flash('success', 'Dokter berhasil dinonaktifkan.');
    redirect(url_for('doctors'));
}

function action_save_bed(PDO $pdo): void
{
    require_permission($pdo, '*');
    $code = strtoupper(trim((string) ($_POST['bed_code'] ?? '')));
    $status = (string) ($_POST['status'] ?? 'KOSONG');
    if ($code === '' || !in_array($status, ['KOSONG', 'NONAKTIF'], true)) {
        set_flash('error', 'Kode bed dan status wajib valid.');
        redirect(url_for('beds'));
    }
    $pdo->prepare('INSERT INTO beds (bed_code, status) VALUES (?, ?)')->execute([$code, $status]);
    audit_log($pdo, 'Tambah bed', 'Bed ' . $code . ' ditambahkan.');
    set_flash('success', 'Bed baru berhasil ditambahkan.');
    redirect(url_for('beds'));
}

function action_toggle_bed(PDO $pdo): void
{
    require_permission($pdo, '*');
    $id = (int) ($_POST['id'] ?? 0);
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('SELECT * FROM beds WHERE id = ? FOR UPDATE');
    $stmt->execute([$id]);
    $bed = $stmt->fetch();
    if (!$bed || !empty($bed['patient_id']) || !in_array($bed['status'], ['KOSONG', 'NONAKTIF'], true)) {
        throw new ValidationException('Bed sedang digunakan atau tidak ditemukan.');
    }
    $newStatus = $bed['status'] === 'NONAKTIF' ? 'KOSONG' : 'NONAKTIF';
    $pdo->prepare('UPDATE beds SET status = ? WHERE id = ?')->execute([$newStatus, $id]);
    audit_log($pdo, 'Perubahan status bed', $bed['bed_code'] . ' diubah menjadi ' . $newStatus);
    $pdo->commit();
    set_flash('success', 'Status bed berhasil diperbarui.');
    redirect(url_for('beds'));
}

function action_save_user(PDO $pdo): void
{
    require_permission($pdo, '*');
    $fullName = trim((string) ($_POST['full_name'] ?? ''));
    $username = trim((string) ($_POST['username'] ?? ''));
    $email = trim((string) ($_POST['email'] ?? ''));
    $identity = trim((string) ($_POST['identity_number'] ?? ''));
    $roleId = (int) ($_POST['role_id'] ?? 0);
    $password = (string) ($_POST['password'] ?? '');

    if ($fullName === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^[A-Za-z0-9_.-]{4,80}$/', $username) || !valid_password($password)) {
        set_flash('error', 'Data user belum valid atau password tidak memenuhi aturan.');
        redirect(url_for('users'));
    }
    $exists = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ? OR email = ?');
    $exists->execute([$username, $email]);
    if ((int) $exists->fetchColumn() > 0) {
        set_flash('error', 'Username atau email sudah digunakan.');
        redirect(url_for('users'));
    }
    $pdo->prepare(
        'INSERT INTO users (role_id, full_name, username, email, identity_number, password_hash)
         VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$roleId, $fullName, $username, $email, $identity ?: null, password_hash($password, PASSWORD_BCRYPT)]);
    audit_log($pdo, 'Tambah user', 'Admin membuat user ' . $username);
    set_flash('success', 'User berhasil dibuat.');
    redirect(url_for('users'));
}

function action_toggle_user(PDO $pdo): void
{
    require_permission($pdo, '*');
    $id = (int) ($_POST['id'] ?? 0);
    if ($id === (int) $_SESSION['user_id']) {
        set_flash('warning', 'Akun sendiri tidak dapat dinonaktifkan.');
        redirect(url_for('users'));
    }
    $pdo->prepare('UPDATE users SET is_active = IF(is_active = 1, 0, 1) WHERE id = ?')->execute([$id]);
    audit_log($pdo, 'Edit user', 'Status user ID ' . $id . ' diperbarui.');
    set_flash('success', 'Status user berhasil diperbarui.');
    redirect(url_for('users'));
}

function action_change_password(PDO $pdo): void
{
    require_permission($pdo, 'profile.manage');
    $current = (string) ($_POST['current_password'] ?? '');
    $password = (string) ($_POST['password'] ?? '');
    $confirm = (string) ($_POST['password_confirm'] ?? '');
    $user = current_user($pdo);

    if (!$user || !password_verify($current, $user['password_hash'])) {
        set_flash('error', 'Password saat ini tidak valid.');
        redirect(url_for('profile'));
    }
    if ($password !== $confirm || !valid_password($password)) {
        set_flash('error', 'Password baru belum memenuhi aturan keamanan.');
        redirect(url_for('profile'));
    }

    $newHash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$newHash, (int) $user['id']]);
    $_SESSION['auth_fingerprint'] = auth_fingerprint(array_replace($user, ['password_hash' => $newHash]));
    session_regenerate_id(true);
    unset($_SESSION['_csrf']);
    audit_log($pdo, 'Edit profil', 'User mengganti password.');
    set_flash('success', 'Password berhasil diperbarui.');
    redirect(url_for('profile'));
}

function render_dashboard(PDO $pdo): void
{
    require_permission($pdo, 'dashboard.view');
    render_app_header($pdo, 'Dashboard', 'dashboard');

    $today = (int) $pdo->query('SELECT COUNT(*) FROM patients WHERE DATE(arrival_time) = CURDATE() AND deleted_at IS NULL')->fetchColumn();
    $empty = (int) $pdo->query("SELECT COUNT(*) FROM beds WHERE status = 'KOSONG'")->fetchColumn();
    $occupied = (int) $pdo->query("SELECT COUNT(*) FROM beds WHERE status = 'TERISI'")->fetchColumn();
    $ready = (int) $pdo->query("SELECT COUNT(*) FROM beds WHERE status = 'SIAP_TRANSFER'")->fetchColumn();
    $avg = $pdo->query("SELECT AVG(TIMESTAMPDIFF(MINUTE, arrival_time, COALESCE(transfer_time, NOW()))) FROM patients WHERE deleted_at IS NULL")->fetchColumn();
    $avgText = format_duration_minutes($avg !== null ? (int) $avg : 0);
    $max = max(1, $empty, $occupied, $ready);
    ?>
    <section class="dashboard-clock">
        <div class="dashboard-date">
            <h2>Ringkasan Hari Ini</h2>
            <div class="dashboard-today">
                <img src="assets/icons/calendar-days.svg" alt="" aria-hidden="true" width="16" height="16">
                <strong data-date><?= e((new DateTimeImmutable())->format('l, d F Y')) ?></strong>
            </div>
        </div>
        <div class="dashboard-clock-actions">
            <div class="dashboard-time">
                <img src="assets/icons/clock-3.svg" alt="" aria-hidden="true" width="18" height="18">
                <time data-clock>--:--:--</time>
            </div>
            <a class="btn btn-secondary" href="<?= e(can($pdo, 'beds.monitor') && !can($pdo, 'patients.manage') ? url_for('monitor') : url_for('transit')) ?>">
                <img src="assets/icons/bed-double.svg" alt="" aria-hidden="true" width="18" height="18">
                Lihat Bed
                <img src="assets/icons/arrow-right.svg" alt="" aria-hidden="true" width="16" height="16">
            </a>
        </div>
    </section>

    <section class="stat-grid" data-live-summary>
        <article class="stat-card">
            <div class="stat-heading"><span>Pasien Masuk Hari Ini</span><img src="assets/icons/users-round.svg" alt="" aria-hidden="true" width="22" height="22"></div>
            <strong data-summary="today"><?= e($today) ?></strong>
        </article>
        <article class="stat-card green">
            <div class="stat-heading"><span>Bed Kosong</span><img src="assets/icons/bed-double.svg" alt="" aria-hidden="true" width="22" height="22"></div>
            <strong data-summary="empty"><?= e($empty) ?></strong>
        </article>
        <article class="stat-card blue">
            <div class="stat-heading"><span>Siap Transfer</span><img src="assets/icons/arrow-right-left.svg" alt="" aria-hidden="true" width="22" height="22"></div>
            <strong data-summary="ready"><?= e($ready) ?></strong>
        </article>
        <article class="stat-card rose">
            <div class="stat-heading"><span>Rata-rata Lama Rawat</span><img src="assets/icons/timer.svg" alt="" aria-hidden="true" width="22" height="22"></div>
            <strong class="stat-duration" data-summary="average_stay"><?= e($avgText) ?></strong>
        </article>
    </section>

    <?php render_dashboard_bed_map(group_beds(fetch_beds_with_patients($pdo))); ?>

    <section class="dashboard-details">
        <article class="dashboard-section dashboard-bed-section">
            <div class="panel-title"><h2 id="bed-composition-title">Komposisi Bed</h2><span class="dashboard-section-meta" data-summary="active" data-summary-suffix=" bed aktif"><?= e($empty + $occupied + $ready) ?> bed aktif</span></div>
            <div class="bed-composition" role="group" aria-labelledby="bed-composition-title">
                <div class="bed-composition-row">
                    <span class="bed-composition-label"><i class="dot green" aria-hidden="true"></i>Kosong</span>
                    <span class="bed-bar-track" aria-hidden="true"><i class="bed-bar-empty" data-bed-bar="empty" style="width: <?= e((string) (($empty / $max) * 100)) ?>%"></i></span>
                    <strong data-summary="empty"><?= e($empty) ?></strong>
                </div>
                <div class="bed-composition-row">
                    <span class="bed-composition-label"><i class="dot red" aria-hidden="true"></i>Terisi</span>
                    <span class="bed-bar-track" aria-hidden="true"><i class="bed-bar-occupied" data-bed-bar="occupied" style="width: <?= e((string) (($occupied / $max) * 100)) ?>%"></i></span>
                    <strong data-summary="occupied"><?= e($occupied) ?></strong>
                </div>
                <div class="bed-composition-row">
                    <span class="bed-composition-label"><i class="dot blue" aria-hidden="true"></i>Siap Transfer</span>
                    <span class="bed-bar-track" aria-hidden="true"><i class="bed-bar-ready" data-bed-bar="ready" style="width: <?= e((string) (($ready / $max) * 100)) ?>%"></i></span>
                    <strong data-summary="ready"><?= e($ready) ?></strong>
                </div>
            </div>
        </article>
        <article class="dashboard-section">
            <div class="panel-title"><h2>Kriteria Masuk Ruang Transit</h2></div>
            <div class="dashboard-criteria">
                <div class="dashboard-criterion">
                    <img src="assets/icons/user-round.svg" alt="" aria-hidden="true" width="19" height="19">
                    <div><strong>Status Kesadaran</strong><p>Compos Mentis E4V5M6 atau Apatis ringan yang stabil. Tidak mengalami penurunan kesadaran progresif.</p></div>
                </div>
                <div class="dashboard-criterion">
                    <img src="assets/icons/activity.svg" alt="" aria-hidden="true" width="19" height="19">
                    <div><strong>Parameter Vital Sign</strong><p>TD (100-140 mmHg), HR (60-100&times;/menit), RR (16-24x/menit), SpO2 (&gt;95%) dengan/tanpa O2 Nasal Cannul.</p></div>
                </div>
                <div class="dashboard-criterion">
                    <img src="assets/icons/circle-alert.svg" alt="" aria-hidden="true" width="19" height="19">
                    <div><strong>Eksklusi</strong><p>Kasus resusitasi atau syok, gangguan napas berat (Ventilator/CPAP), penurunan kesadaran (GCS &lt;11).</p></div>
                </div>
            </div>
        </article>
    </section>
    <?php
    render_app_footer();
}

function render_dashboard_bed_map(array $groups): void
{
    $total = array_sum(array_column(array_column($groups, 'summary'), 'total'));
    ?>
    <section class="transit-map" aria-labelledby="transit-map-title">
        <svg class="transit-map-symbols" aria-hidden="true" width="0" height="0">
            <defs>
                <g id="transit-bed-glyph" stroke-width="1.5">
                    <rect x="7" y="3" width="34" height="40" rx="4"/>
                    <rect x="10" y="7" width="28" height="31" rx="3"/>
                    <rect x="13" y="9" width="22" height="8" rx="2.5" fill="currentColor" opacity=".25"/>
                    <path d="M10 20h28M7 38h34M9 43v3m30-3v3" fill="none" stroke-linecap="round"/>
                </g>
            </defs>
        </svg>
        <div class="transit-map-heading">
            <div>
                <h2 id="transit-map-title">Denah Bed Ruang Transit</h2>
                <p>Susunan bed per kamar &middot; diperbarui otomatis</p>
            </div>
            <span class="transit-map-meta" data-transit-map-total><?= e($total) ?> bed &middot; <?= e(count($groups)) ?> kelompok kamar</span>
        </div>
        <div class="transit-map-legend" aria-label="Keterangan status bed">
            <span><i class="transit-legend-dot transit-legend-empty" aria-hidden="true"></i>Kosong</span>
            <span><i class="transit-legend-dot transit-legend-occupied" aria-hidden="true"></i>Terisi</span>
            <span><i class="transit-legend-dot transit-legend-ready" aria-hidden="true"></i>Siap Transfer</span>
            <span><i class="transit-legend-dot transit-legend-inactive" aria-hidden="true"></i>Nonaktif</span>
        </div>
        <div class="transit-map-rooms" data-transit-bed-map>
            <?php foreach ($groups as $group): ?>
                <article class="transit-room" data-transit-room="<?= e($group['id']) ?>">
                    <header class="transit-room-heading">
                        <h3><?= e($group['label']) ?></h3>
                        <span><?= e($group['summary']['total']) ?> bed</span>
                    </header>
                    <div class="transit-room-front" aria-hidden="true"></div>
                    <ul class="transit-room-seats<?= count($group['beds']) <= 2 ? ' transit-room-seats-small' : '' ?>" aria-label="Bed kamar <?= e($group['label']) ?>">
                        <?php foreach ($group['beds'] as $bed): ?>
                            <?php $label = 'Bed ' . $bed['bed_code'] . ', ' . bed_status_label($bed['status']); ?>
                            <li class="transit-seat transit-seat--<?= e(strtolower($bed['status'])) ?>" data-transit-bed="<?= e($bed['id']) ?>" data-status="<?= e($bed['status']) ?>" aria-label="<?= e($label) ?>" title="<?= e($label) ?>">
                                <span class="transit-seat-shape" aria-hidden="true">
                                    <svg class="transit-seat-icon" viewBox="0 0 48 48"><use href="#transit-bed-glyph"/></svg>
                                    <strong class="transit-seat-code"><?= e($bed['bed_code']) ?></strong>
                                </span>
                                <small class="transit-seat-status" aria-hidden="true"><?= e(bed_status_label($bed['status'])) ?></small>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                </article>
            <?php endforeach; ?>
        </div>
    </section>
    <?php
}

function fetch_beds_with_patients(PDO $pdo): array
{
    return $pdo->query(
        'SELECT b.*, p.id AS patient_id_real, p.medical_record_number, p.full_name, p.gender, p.birth_date, p.marital_status,
                p.status AS patient_status, p.arrival_time, p.planned_room
         FROM beds b
         LEFT JOIN patients p ON p.id = b.patient_id AND p.deleted_at IS NULL
         ORDER BY b.bed_code'
    )->fetchAll();
}

function render_bed_page(PDO $pdo, bool $manage): void
{
    if ($manage) {
        require_permission($pdo, 'beds.view');
    } else {
        require_permission($pdo, 'beds.monitor');
    }

    $title = $manage ? 'Ruang Transit' : 'Monitor IGD';
    render_app_header($pdo, $title, $manage ? 'transit' : 'monitor');
    ?>
    <section class="toolbar-panel">
        <div>
            <h2>Peta Bed Transit</h2>
            <p>Status diperbarui berkala dari database.</p>
        </div>
        <div class="legend">
            <span><i class="dot green"></i>Kosong</span>
            <span><i class="dot blue"></i>Siap Transfer</span>
            <span><i class="dot red"></i>Terisi</span>
        </div>
    </section>
    <div class="bed-groups" data-bed-grid data-manage="<?= $manage ? '1' : '0' ?>">
        <?php render_bed_groups($pdo, group_beds(fetch_beds_with_patients($pdo)), $manage); ?>
    </div>
    <?php
    render_app_footer();
}

function render_bed_groups(PDO $pdo, array $groups, bool $manage): void
{
    foreach ($groups as $group) {
        $summary = $group['summary'];
        ?>
        <details class="bed-group" data-bed-group="<?= e($group['id']) ?>" open>
            <summary class="bed-group-header">
                <div class="bed-group-title">
                    <?= render_app_icon($group['id'] === 'isolation' ? 'shield-check' : 'bed-double') ?>
                    <h2><?= e($group['label']) ?></h2>
                    <span class="bed-group-count"><?= e($summary['total']) ?> bed</span>
                </div>
                <div class="bed-group-summary">
                    <span><i class="dot green" aria-hidden="true"></i><b data-group-summary="empty"><?= e($summary['empty']) ?></b> kosong</span>
                    <span><i class="dot red" aria-hidden="true"></i><b data-group-summary="occupied"><?= e($summary['occupied']) ?></b> terisi</span>
                    <span><i class="dot blue" aria-hidden="true"></i><b data-group-summary="ready"><?= e($summary['ready']) ?></b> siap</span>
                    <?php if ($summary['inactive']): ?><span><b data-group-summary="inactive"><?= e($summary['inactive']) ?></b> nonaktif</span><?php endif; ?>
                </div>
                <img class="bed-group-chevron" src="assets/icons/arrow-right.svg" alt="" aria-hidden="true" width="18" height="18">
            </summary>
            <div class="bed-grid">
                <?php render_bed_cards($pdo, $group['beds'], $manage); ?>
            </div>
        </details>
        <?php
    }
}

function render_bed_cards(PDO $pdo, array $beds, bool $manage): void
{
    foreach ($beds as $bed) {
        $status = strtolower((string) $bed['status']);
        ?>
        <article class="bed-card bed-<?= e($status) ?>">
            <header>
                <strong><?= e($bed['bed_code']) ?></strong>
                <?= render_status_badge($bed['status']) ?>
            </header>
            <?php if ($bed['status'] === 'KOSONG'): ?>
                <div class="bed-empty">Bed tersedia</div>
            <?php elseif ($bed['status'] === 'NONAKTIF'): ?>
                <div class="bed-empty">Bed tidak aktif</div>
            <?php else: ?>
                <div class="bed-patient">
                    <strong><?= e(patient_display_name($bed)) ?></strong>
                    <span>No. RM <?= e($bed['medical_record_number']) ?></span>
                    <small>Masuk <?= e(format_datetime($bed['arrival_time'])) ?></small>
                </div>
                <div class="bed-actions">
                    <a class="btn btn-small btn-secondary" href="<?= e(url_for('patient_detail', ['id' => (int) $bed['patient_id_real']])) ?>"><?= render_app_icon('eye') ?>Detail</a>
                    <?php if ($manage && can($pdo, 'patients.manage')): ?>
                        <?php if ($bed['status'] === 'TERISI'): ?>
                            <a class="btn btn-small" href="<?= e(url_for('patient_form', ['id' => (int) $bed['patient_id_real']])) ?>"><?= render_app_icon('pencil') ?>Edit</a>
                            <form method="post" data-loading-form>
                                <?= csrf_field() ?>
                                <input type="hidden" name="action" value="mark_ready">
                                <input type="hidden" name="id" value="<?= e($bed['patient_id_real']) ?>">
                                <button class="btn btn-small btn-primary" type="submit" data-loading-text="Memproses..."><?= render_app_icon('arrow-right') ?>Set Siap</button>
                            </form>
                        <?php elseif ($bed['status'] === 'SIAP_TRANSFER'): ?>
                            <form method="post" data-loading-form data-confirm="Apakah Anda yakin ingin mentransfer 1 pasien?">
                                <?= csrf_field() ?>
                                <input type="hidden" name="action" value="transfer_selected">
                                <input type="hidden" name="selected_patients[]" value="<?= e($bed['patient_id_real']) ?>">
                                <button class="btn btn-small btn-primary" type="submit" data-loading-text="Transfer..."><?= render_app_icon('arrow-right-left') ?>Transfer</button>
                            </form>
                        <?php endif; ?>
                    <?php endif; ?>
                </div>
            <?php endif; ?>
        </article>
        <?php
    }
}

function render_patients_page(PDO $pdo): void
{
    require_permission($pdo, 'patients.manage');
    $q = trim((string) ($_GET['q'] ?? ''));
    $status = trim((string) ($_GET['status'] ?? ''));

    $where = ['p.deleted_at IS NULL'];
    $params = [];
    if ($q !== '') {
        $where[] = '(p.full_name LIKE ? OR p.medical_record_number LIKE ? OR p.diagnosis LIKE ?)';
        $params[] = "%$q%";
        $params[] = "%$q%";
        $params[] = "%$q%";
    }
    if ($status !== '') {
        $where[] = 'p.status = ?';
        $params[] = $status;
    }

    $stmt = $pdo->prepare(
        'SELECT p.*, d.name AS doctor_name, b.bed_code
         FROM patients p
         JOIN doctors d ON d.id = p.doctor_id
         LEFT JOIN beds b ON b.id = p.bed_id
         WHERE ' . implode(' AND ', $where) . '
         ORDER BY p.arrival_time DESC'
    );
    $stmt->execute($params);
    $patients = $stmt->fetchAll();

    render_app_header($pdo, 'Data Pasien', 'patients');
    ?>
    <section class="toolbar-panel">
        <form class="filter-form" method="get">
            <input type="hidden" name="page" value="patients">
            <label>Pencarian
                <input type="search" name="q" value="<?= e($q) ?>" placeholder="Nama, No. RM, diagnosa">
            </label>
            <label>Status
                <select name="status">
                    <option value="">Semua</option>
                    <?php foreach (app_config('patient_statuses') as $key => $label): ?>
                        <option value="<?= e($key) ?>"<?= selected($status, $key) ?>><?= e($label) ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <button class="btn btn-secondary" type="submit"><?= render_app_icon('search') ?>Filter</button>
        </form>
        <a class="btn btn-primary" href="<?= e(url_for('patient_form')) ?>"><?= render_app_icon('clipboard-plus') ?>Tambah Pasien</a>
    </section>
    <section class="panel table-panel">
        <div class="responsive-table" role="region" aria-label="Daftar pasien" tabindex="0">
        <table class="data-table">
            <thead><tr><th>No. RM</th><th>Nama</th><th>Bed</th><th>DPJP</th><th>Diagnosa</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
            <?php foreach ($patients as $patient): ?>
                <tr>
                    <td><?= e($patient['medical_record_number']) ?></td>
                    <td><?= e(patient_display_name($patient)) ?></td>
                    <td><?= e($patient['bed_code'] ?? '-') ?></td>
                    <td><?= e($patient['doctor_name']) ?></td>
                    <td><?= e($patient['diagnosis']) ?></td>
                    <td><?= render_status_badge($patient['status'], 'patient') ?></td>
                    <td class="table-actions">
                        <a class="btn btn-small btn-secondary" href="<?= e(url_for('patient_detail', ['id' => (int) $patient['id']])) ?>"><?= render_app_icon('eye') ?>Detail</a>
                        <?php if ($patient['status'] !== 'TRANSFERRED'): ?>
                            <a class="btn btn-small" href="<?= e(url_for('patient_form', ['id' => (int) $patient['id']])) ?>"><?= render_app_icon('pencil') ?>Edit</a>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
        <?php if (!$patients) render_empty_state('Belum ada data', 'Data pasien akan muncul setelah pendaftaran tersimpan.'); ?>
    </section>
    <?php
    render_app_footer();
}

function render_patient_form_page(PDO $pdo): void
{
    require_permission($pdo, 'patients.manage');
    $id = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $patient = null;
    $vitals = null;
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL');
        $stmt->execute([$id]);
        $patient = $stmt->fetch();
        if (!$patient) {
            render_not_found($pdo);
            return;
        }
        if (!in_array($patient['status'], ['ACTIVE', 'READY_TRANSFER'], true)) {
            set_flash('warning', 'Histori pasien yang sudah ditransfer hanya dapat dilihat.');
            redirect(url_for('patient_detail', ['id' => $id]));
        }
        $vitals = get_patient_vitals($pdo, $id);
    }

    $selectionOptions = app_config('patient_options');
    $hasLegacyPayer = ($patient['payer_type'] ?? '') === 'BPJS PBI';
    foreach (['consciousness_status', 'planned_room'] as $field) {
        if ($patient && $patient[$field] !== '' && !in_array($patient[$field], $selectionOptions[$field], true)) {
            $selectionOptions[$field][] = $patient[$field];
        }
    }

    $savedInput = $_SESSION['_patient_input'] ?? null;
    unset($_SESSION['_patient_input']);
    if (is_array($savedInput) && ($savedInput['id'] ?? null) === $id) {
        $input = $savedInput['data'];
        $patient = array_replace($patient ?: [], array_intersect_key($input, array_flip([
            'medical_record_number', 'full_name', 'gender', 'birth_date', 'address', 'marital_status',
            'dependency_level', 'doctor_id', 'diagnosis', 'consciousness_status', 'planned_room', 'arrival_time',
            'identity_number', 'religion', 'payer_type', 'care_class', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'education',
        ])));
        $vitals = array_replace($vitals ?: [], array_intersect_key($input, array_flip([
            'blood_pressure', 'pulse', 'respiration', 'temperature', 'oxygen_saturation',
        ])), ['notes' => $input['vital_notes'] ?? '']);
    }

    $doctors = fetch_active_doctors($pdo);
    $recommendationPayload = array_map(fn ($d) => [
        'id' => (int) $d['id'],
        'name' => $d['name'],
        'specialization' => $d['specialization_name'],
        'keywords' => $d['keywords'],
    ], $doctors);

    if ($id && !in_array((int) $patient['doctor_id'], array_map(fn ($d) => (int) $d['id'], $doctors), true)) {
        $previousDoctor = $pdo->prepare(
            'SELECT d.*, s.name AS specialization_name FROM doctors d
             JOIN specializations s ON s.id = d.specialization_id
             JOIN patients p ON p.doctor_id = d.id WHERE p.id = ?'
        );
        $previousDoctor->execute([$id]);
        if ($retainedDoctor = $previousDoctor->fetch()) {
            $retainedDoctor['name'] .= ' (DPJP sebelumnya, nonaktif)';
            $doctors[] = $retainedDoctor;
        }
    }

    render_app_header($pdo, $id ? 'Edit Pasien' : 'Pendaftaran Pasien', 'patient_form');
    ?>
    <form class="panel stack-form" method="post" data-loading-form data-patient-form data-doctors='<?= e(json_encode($recommendationPayload, JSON_UNESCAPED_UNICODE)) ?>'>
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="save_patient">
        <?php if ($id): ?><input type="hidden" name="id" value="<?= e($id) ?>"><?php endif; ?>
        <div class="panel-title">
            <div>
                <h2><?= $id ? 'Edit Data Pasien' : 'Form Masuk Ruang Transit' ?></h2>
                <p>Bed kosong akan dipilih otomatis oleh sistem saat pasien baru disimpan.</p>
            </div>
            <button class="btn btn-primary" type="submit" data-loading-text="Menyimpan data..."><?= render_app_icon('save') ?>Simpan</button>
        </div>

        <?php if (!$doctors): ?>
            <p class="recommendation-box" role="status">Belum ada dokter DPJP aktif. <a href="<?= e(url_for('doctors')) ?>">Tambah Dokter</a></p>
        <?php endif; ?>

        <div class="form-section">
            <h3>Identitas</h3>
            <div class="form-grid three">
                <label>No. RM
                    <input name="medical_record_number" required value="<?= e($patient['medical_record_number'] ?? '') ?>">
                </label>
                <label>No. KTP/SIM/NIP
                    <input name="identity_number" maxlength="80" pattern="[A-Za-z0-9 .\/\-]{1,80}" value="<?= e($patient['identity_number'] ?? '') ?>">
                </label>
                <label>Nama Lengkap
                    <input name="full_name" required value="<?= e($patient['full_name'] ?? '') ?>">
                </label>
                <label>Jenis Kelamin
                    <select name="gender" required>
                        <option value="">Pilih</option>
                        <option value="L"<?= selected($patient['gender'] ?? '', 'L') ?>>Laki-laki</option>
                        <option value="P"<?= selected($patient['gender'] ?? '', 'P') ?>>Perempuan</option>
                    </select>
                </label>
                <label>Tanggal Lahir
                    <input type="date" name="birth_date" max="<?= e(date('Y-m-d')) ?>" required value="<?= e($patient['birth_date'] ?? '') ?>">
                </label>
                <label>Agama
                    <select name="religion">
                        <option value="">Pilih agama</option>
                        <?php foreach ($selectionOptions['religion'] as $value): ?>
                            <option value="<?= e($value) ?>"<?= selected($patient['religion'] ?? '', $value) ?>><?= e($value) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label>Status Perkawinan
                    <select name="marital_status" required>
                        <option value="">Pilih</option>
                        <?php foreach (['Belum Menikah', 'Menikah', 'Cerai'] as $m): ?>
                            <option value="<?= e($m) ?>"<?= selected($patient['marital_status'] ?? '', $m) ?>><?= e($m) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label>Pendidikan
                    <input name="education" maxlength="100" value="<?= e($patient['education'] ?? '') ?>">
                </label>
                <label>Tingkat Ketergantungan
                    <select name="dependency_level" required>
                        <option value="">Pilih</option>
                        <option value="Minimal Care"<?= selected($patient['dependency_level'] ?? '', 'Minimal Care') ?>>Minimal Care</option>
                        <option value="Partial"<?= selected($patient['dependency_level'] ?? '', 'Partial') ?>>Partial</option>
                    </select>
                </label>
            </div>
            <label>Alamat
                <textarea name="address" required><?= e($patient['address'] ?? '') ?></textarea>
            </label>
        </div>

        <div class="form-section">
            <h3>Penanggung Pasien</h3>
            <div class="form-grid two">
                <label>Penanggung Pasien
                    <select name="payer_type">
                        <option value="">Pilih penanggung pasien</option>
                        <?php if ($hasLegacyPayer && ($patient['payer_type'] ?? '') === 'BPJS PBI'): ?>
                            <option value="BPJS PBI" selected disabled>BPJS PBI (data lama)</option>
                        <?php endif; ?>
                        <?php foreach ($selectionOptions['payer_type'] as $value): ?>
                            <option value="<?= e($value) ?>"<?= selected($patient['payer_type'] ?? '', $value) ?>><?= e($value) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label>Kelas Perawatan
                    <select name="care_class">
                        <option value="">Pilih kelas perawatan</option>
                        <?php foreach ($selectionOptions['care_class'] as $value): ?>
                            <option value="<?= e($value) ?>"<?= selected($patient['care_class'] ?? '', $value) ?>><?= e($value) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
            </div>
        </div>

        <div class="form-section">
            <h3>Penanggung Jawab</h3>
            <div class="form-grid three">
                <label>Nama Penanggung Jawab
                    <input name="guardian_name" maxlength="150" autocomplete="off" value="<?= e($patient['guardian_name'] ?? '') ?>">
                </label>
                <label>Hubungan dengan Pasien
                    <input name="guardian_relationship" maxlength="80" value="<?= e($patient['guardian_relationship'] ?? '') ?>">
                </label>
                <label>No. HP
                    <input type="tel" name="guardian_phone" maxlength="30" pattern="[+]?[0-9][0-9 \(\)\-]{5,28}" value="<?= e($patient['guardian_phone'] ?? '') ?>">
                </label>
            </div>
        </div>

        <div class="form-section">
            <h3>Kondisi Pasien</h3>
            <div class="form-grid two">
                <label>Diagnosa
                    <input name="diagnosis" required data-diagnosis-input value="<?= e($patient['diagnosis'] ?? '') ?>">
                </label>
                <label>Dokter DPJP
                    <select name="doctor_id" required data-doctor-select>
                        <option value="">Pilih dokter aktif</option>
                        <?php foreach ($doctors as $doctor): ?>
                            <option value="<?= e($doctor['id']) ?>"<?= selected($patient['doctor_id'] ?? '', $doctor['id']) ?>>
                                <?= e($doctor['name'] . ' - ' . $doctor['specialization_name']) ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label>Status Kesadaran
                    <select name="consciousness_status" required>
                        <option value="">Pilih status kesadaran</option>
                        <?php foreach ($selectionOptions['consciousness_status'] as $value): ?>
                            <option value="<?= e($value) ?>"<?= selected($patient['consciousness_status'] ?? '', $value) ?>><?= e($value) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label>Rencana Ruangan
                    <select name="planned_room" required>
                        <option value="">Pilih rencana ruangan</option>
                        <?php foreach ($selectionOptions['planned_room'] as $value): ?>
                            <option value="<?= e($value) ?>"<?= selected($patient['planned_room'] ?? '', $value) ?>><?= e($value) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label>Waktu Kedatangan Transit
                    <input type="datetime-local" name="arrival_time" required value="<?= e(html_datetime_value($patient['arrival_time'] ?? null)) ?>">
                </label>
            </div>
            <p class="recommendation-box" data-doctor-recommendation>Rekomendasi dokter akan muncul setelah diagnosa diisi.</p>
        </div>

        <div class="form-section">
            <h3>Tanda Vital</h3>
            <div class="form-grid three">
                <label>Tekanan Darah
                    <input name="blood_pressure" required placeholder="120/80" value="<?= e($vitals['blood_pressure'] ?? '') ?>">
                </label>
                <label>Nadi
                    <input name="pulse" required placeholder="80 x/menit" value="<?= e($vitals['pulse'] ?? '') ?>">
                </label>
                <label>Respirasi
                    <input name="respiration" required placeholder="20 x/menit" value="<?= e($vitals['respiration'] ?? '') ?>">
                </label>
                <label>Suhu
                    <input name="temperature" required placeholder="36.8 C" value="<?= e($vitals['temperature'] ?? '') ?>">
                </label>
                <label>Saturasi Oksigen
                    <input name="oxygen_saturation" required placeholder="98%" value="<?= e($vitals['oxygen_saturation'] ?? '') ?>">
                </label>
                <label>Catatan
                    <input name="vital_notes" value="<?= e($vitals['notes'] ?? '') ?>">
                </label>
            </div>
        </div>
        <div class="form-section inline-actions">
            <button class="btn btn-primary" type="submit" data-loading-text="Menyimpan data..." data-patient-save-bottom><?= render_app_icon('save') ?>Simpan Pasien</button>
            <a class="btn btn-secondary" href="<?= e(url_for('patients')) ?>">Batal</a>
        </div>
    </form>
    <?php
    render_app_footer();
}

function render_patient_detail_page(PDO $pdo): void
{
    if (!can($pdo, 'patients.manage') && !can($pdo, 'beds.monitor')) {
        require_permission($pdo, 'patients.manage');
    }
    $id = (int) ($_GET['id'] ?? 0);
    $stmt = $pdo->prepare(
        'SELECT p.*, d.name AS doctor_name, s.name AS specialization_name, b.bed_code, b.status AS bed_status
         FROM patients p
         JOIN doctors d ON d.id = p.doctor_id
         JOIN specializations s ON s.id = d.specialization_id
         LEFT JOIN beds b ON b.id = p.bed_id
         WHERE p.id = ? AND p.deleted_at IS NULL'
    );
    $stmt->execute([$id]);
    $patient = $stmt->fetch();
    if (!$patient) {
        render_not_found($pdo);
        return;
    }
    $vitals = get_patient_vitals($pdo, $id);

    render_app_header($pdo, 'Detail Pasien', 'patients');
    ?>
    <section class="panel detail-panel">
        <div class="panel-title">
            <div>
                <h2><?= e(patient_display_name($patient)) ?></h2>
                <p>No. RM <?= e($patient['medical_record_number']) ?> - <?= e($patient['bed_code'] ?? '-') ?></p>
            </div>
            <div class="inline-actions">
                <?= render_status_badge($patient['status'], 'patient') ?>
                <?php if (can($pdo, 'patients.manage') && $patient['status'] !== 'TRANSFERRED'): ?>
                    <a class="btn btn-secondary" href="<?= e(url_for('patient_form', ['id' => $id])) ?>"><?= render_app_icon('pencil') ?>Edit</a>
                <?php endif; ?>
            </div>
        </div>
        <h3>Identitas Pasien</h3>
        <div class="detail-grid">
            <div><span>No. KTP/SIM/NIP</span><strong><?= e($patient['identity_number'] ?: '-') ?></strong></div>
            <div><span>Jenis Kelamin</span><strong><?= e(format_gender($patient['gender'])) ?></strong></div>
            <div><span>Tanggal Lahir</span><strong><?= e($patient['birth_date']) ?></strong></div>
            <div><span>Agama</span><strong><?= e($patient['religion'] ?: '-') ?></strong></div>
            <div><span>Status Perkawinan</span><strong><?= e($patient['marital_status']) ?></strong></div>
            <div><span>Pendidikan</span><strong><?= e($patient['education'] ?: '-') ?></strong></div>
            <div><span>Alamat</span><strong><?= e($patient['address']) ?></strong></div>
        </div>
        <h3>Penanggung Pasien</h3>
        <div class="detail-grid">
            <div><span>Penanggung Pasien</span><strong><?= e($patient['payer_type'] ?: '-') ?></strong></div>
            <div><span>Kelas Perawatan</span><strong><?= e($patient['care_class'] ?: '-') ?></strong></div>
        </div>
        <h3>Penanggung Jawab</h3>
        <div class="detail-grid">
            <div><span>Penanggung Jawab</span><strong><?= e($patient['guardian_name'] ?: '-') ?></strong></div>
            <div><span>Hubungan dengan Pasien</span><strong><?= e($patient['guardian_relationship'] ?: '-') ?></strong></div>
            <div><span>No. HP</span><strong><?= e($patient['guardian_phone'] ?: '-') ?></strong></div>
        </div>
        <h3>Kondisi dan Ruang Transit</h3>
        <div class="detail-grid">
            <div><span>Ketergantungan</span><strong><?= e($patient['dependency_level']) ?></strong></div>
            <div><span>Status Kesadaran</span><strong><?= e($patient['consciousness_status']) ?></strong></div>
            <div><span>DPJP</span><strong><?= e($patient['doctor_name']) ?></strong></div>
            <div><span>Spesialisasi</span><strong><?= e($patient['specialization_name']) ?></strong></div>
            <div><span>Diagnosa</span><strong><?= e($patient['diagnosis']) ?></strong></div>
            <div><span>Rencana Ruangan</span><strong><?= e($patient['planned_room']) ?></strong></div>
            <div><span>Waktu Masuk</span><strong><?= e(format_datetime($patient['arrival_time'])) ?></strong></div>
            <div><span>Waktu Transfer</span><strong><?= e(format_datetime($patient['transfer_time'])) ?></strong></div>
            <div><span>Lama Rawat</span><strong><?= e(format_duration_between($patient['arrival_time'], $patient['transfer_time'])) ?></strong></div>
        </div>
        <h3>Tanda Vital Terakhir</h3>
        <div class="detail-grid">
            <div><span>Tekanan Darah</span><strong><?= e($vitals['blood_pressure'] ?? '-') ?></strong></div>
            <div><span>Nadi</span><strong><?= e($vitals['pulse'] ?? '-') ?></strong></div>
            <div><span>Respirasi</span><strong><?= e($vitals['respiration'] ?? '-') ?></strong></div>
            <div><span>Suhu</span><strong><?= e($vitals['temperature'] ?? '-') ?></strong></div>
            <div><span>Saturasi</span><strong><?= e($vitals['oxygen_saturation'] ?? '-') ?></strong></div>
            <div><span>Catatan</span><strong><?= e($vitals['notes'] ?? '-') ?></strong></div>
        </div>
        <?php if (can($pdo, 'patients.manage') && $patient['status'] !== 'TRANSFERRED'): ?>
            <form method="post" class="danger-zone" data-confirm="Apakah Anda yakin ingin menghapus data pasien ini?">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="delete_patient">
                <input type="hidden" name="id" value="<?= e($id) ?>">
                <button class="btn btn-danger" type="submit"><?= render_app_icon('trash-2') ?>Hapus Pasien</button>
            </form>
        <?php endif; ?>
    </section>
    <?php
    render_app_footer();
}

function render_doctors_page(PDO $pdo): void
{
    require_permission($pdo, 'doctors.manage');
    $doctors = $pdo->query(
        'SELECT d.*, s.name AS specialization_name
         FROM doctors d
         JOIN specializations s ON s.id = d.specialization_id
         WHERE d.deleted_at IS NULL
         ORDER BY d.is_active DESC, d.name'
    )->fetchAll();
    $specializations = $pdo->query('SELECT * FROM specializations WHERE is_active = 1 ORDER BY name')->fetchAll();
    $edit = null;
    if (isset($_GET['edit'])) {
        $stmt = $pdo->prepare('SELECT * FROM doctors WHERE id = ? AND deleted_at IS NULL');
        $stmt->execute([(int) $_GET['edit']]);
        $edit = $stmt->fetch() ?: null;
    }

    render_app_header($pdo, 'Master Dokter', 'doctors');
    ?>
    <section class="panel stack-form">
        <div class="panel-title"><h2><?= $edit ? 'Edit Dokter' : 'Tambah Dokter' ?></h2></div>
        <form method="post" class="form-grid three" data-loading-form>
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="save_doctor">
            <?php if ($edit): ?><input type="hidden" name="id" value="<?= e($edit['id']) ?>"><?php endif; ?>
            <label>Nama Dokter
                <input name="name" required value="<?= e($edit['name'] ?? '') ?>">
            </label>
            <label>Spesialisasi
                <select name="specialization_id">
                    <option value="">Pilih</option>
                    <?php foreach ($specializations as $spec): ?>
                        <option value="<?= e($spec['id']) ?>"<?= selected($edit['specialization_id'] ?? '', $spec['id']) ?>><?= e($spec['name']) ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <label>Spesialisasi Baru
                <input name="new_specialization" placeholder="Opsional">
            </label>
            <label>Kata Kunci Rekomendasi
                <input name="keywords" placeholder="jantung, diabetes, stroke">
            </label>
            <label class="check-row">
                <input type="checkbox" name="is_active" value="1"<?= checked($edit['is_active'] ?? 1, 1) ?>> Aktif
            </label>
            <button class="btn btn-primary" type="submit" data-loading-text="Menyimpan dokter..."><?= render_app_icon('save') ?>Simpan Dokter</button>
        </form>
    </section>

    <section class="panel table-panel">
        <div class="responsive-table" role="region" aria-label="Daftar dokter" tabindex="0">
        <table class="data-table">
            <thead><tr><th>Nama Dokter</th><th>Spesialisasi</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
            <?php foreach ($doctors as $doctor): ?>
                <tr>
                    <td><?= e($doctor['name']) ?></td>
                    <td><?= e($doctor['specialization_name']) ?></td>
                    <td><?= $doctor['is_active'] ? '<span class="status-badge status-kosong">Aktif</span>' : '<span class="status-badge status-nonaktif">Nonaktif</span>' ?></td>
                    <td class="table-actions">
                        <a class="btn btn-small" href="<?= e(url_for('doctors', ['edit' => (int) $doctor['id']])) ?>"><?= render_app_icon('pencil') ?>Edit</a>
                        <form method="post" data-confirm="Nonaktifkan dokter ini?">
                            <?= csrf_field() ?>
                            <input type="hidden" name="action" value="delete_doctor">
                            <input type="hidden" name="id" value="<?= e($doctor['id']) ?>">
                            <button class="btn btn-small btn-danger" type="submit"><?= render_app_icon('trash-2') ?>Hapus</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    </section>
    <?php
    render_app_footer();
}

function render_transfer_page(PDO $pdo): void
{
    require_permission($pdo, 'transfers.manage');
    $filters = [
        'name' => trim((string) ($_GET['name'] ?? '')),
        'mr' => trim((string) ($_GET['mr'] ?? '')),
        'doctor_id' => trim((string) ($_GET['doctor_id'] ?? '')),
        'status' => trim((string) ($_GET['status'] ?? '')),
        'diagnosis' => trim((string) ($_GET['diagnosis'] ?? '')),
    ];

    $where = ["p.deleted_at IS NULL", "p.status IN ('ACTIVE','READY_TRANSFER')"];
    $params = [];
    if ($filters['name'] !== '') {
        $where[] = 'p.full_name LIKE ?';
        $params[] = '%' . $filters['name'] . '%';
    }
    if ($filters['mr'] !== '') {
        $where[] = 'p.medical_record_number LIKE ?';
        $params[] = '%' . $filters['mr'] . '%';
    }
    if ($filters['doctor_id'] !== '') {
        $where[] = 'p.doctor_id = ?';
        $params[] = (int) $filters['doctor_id'];
    }
    if ($filters['status'] !== '') {
        $where[] = 'p.status = ?';
        $params[] = $filters['status'];
    }
    if ($filters['diagnosis'] !== '') {
        $where[] = 'p.diagnosis LIKE ?';
        $params[] = '%' . $filters['diagnosis'] . '%';
    }

    $stmt = $pdo->prepare(
        'SELECT p.*, d.name AS doctor_name, b.bed_code, b.status AS bed_status
         FROM patients p
         JOIN doctors d ON d.id = p.doctor_id
         LEFT JOIN beds b ON b.id = p.bed_id
         WHERE ' . implode(' AND ', $where) . '
         ORDER BY p.arrival_time ASC'
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    $doctors = fetch_active_doctors($pdo);

    $edit = null;
    $editDoctors = $doctors;
    if (isset($_GET['edit'])) {
        $editStmt = $pdo->prepare(
            "SELECT p.*, d.name AS doctor_name, s.name AS specialization_name
             FROM patients p JOIN doctors d ON d.id = p.doctor_id
             JOIN specializations s ON s.id = d.specialization_id
             WHERE p.id = ? AND p.deleted_at IS NULL AND p.status IN ('ACTIVE', 'READY_TRANSFER')"
        );
        $editStmt->execute([(int) $_GET['edit']]);
        $edit = $editStmt->fetch();
        if (!$edit) {
            set_flash('warning', 'Pasien tidak ditemukan atau sudah tidak berada di ruang transit.');
            redirect(url_for('transfer', $filters));
        }
        if (!in_array((int) $edit['doctor_id'], array_map(fn ($doctor) => (int) $doctor['id'], $editDoctors), true)) {
            $editDoctors[] = [
                'id' => $edit['doctor_id'],
                'name' => $edit['doctor_name'] . ' (DPJP sebelumnya, nonaktif)',
                'specialization_name' => $edit['specialization_name'],
            ];
        }
    }

    render_app_header($pdo, 'Sistem Transfer', 'transfer');
    ?>
    <section class="toolbar-panel">
        <form class="filter-form" method="get">
            <input type="hidden" name="page" value="transfer">
            <label>Nama pasien <input name="name" value="<?= e($filters['name']) ?>"></label>
            <label>No. RM <input name="mr" value="<?= e($filters['mr']) ?>"></label>
            <label>Dokter DPJP
                <select name="doctor_id"><option value="">Semua</option><?php foreach ($doctors as $doctor): ?><option value="<?= e($doctor['id']) ?>"<?= selected($filters['doctor_id'], $doctor['id']) ?>><?= e($doctor['name']) ?></option><?php endforeach; ?></select>
            </label>
            <label>Status
                <select name="status">
                    <option value="">Semua</option>
                    <option value="ACTIVE"<?= selected($filters['status'], 'ACTIVE') ?>>Terisi</option>
                    <option value="READY_TRANSFER"<?= selected($filters['status'], 'READY_TRANSFER') ?>>Siap Transfer</option>
                </select>
            </label>
            <label>Diagnosa <input name="diagnosis" value="<?= e($filters['diagnosis']) ?>"></label>
            <button class="btn btn-secondary" type="submit"><?= render_app_icon('search') ?>Filter</button>
        </form>
    </section>

    <?php if ($edit): ?>
    <form id="transfer-edit" class="panel stack-form" method="post" data-loading-form data-transfer-edit-form>
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="save_transfer_plan">
        <input type="hidden" name="id" value="<?= e($edit['id']) ?>">
        <div class="panel-title">
            <div>
                <h2>Edit Rencana Transfer</h2>
                <p><?= e(patient_display_name($edit)) ?> &middot; No. RM <?= e($edit['medical_record_number']) ?></p>
            </div>
        </div>
        <div class="form-grid two">
            <label>Dokter DPJP
                <select name="doctor_id" required>
                    <option value="">Pilih dokter DPJP</option>
                    <?php foreach ($editDoctors as $doctor): ?>
                        <option value="<?= e($doctor['id']) ?>"<?= selected($edit['doctor_id'], $doctor['id']) ?>><?= e($doctor['name'] . ' - ' . $doctor['specialization_name']) ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <label>Rencana Ruangan
                <select name="planned_room" required>
                    <option value="">Pilih rencana ruangan</option>
                    <?php foreach (app_config('transfer_room_options') as $value => $label): ?>
                        <option value="<?= e($value) ?>"<?= selected($edit['planned_room'], $value) ?>><?= e($label) ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
        </div>
        <div class="inline-actions">
            <button class="btn btn-primary" type="submit" data-loading-text="Menyimpan perubahan..."><?= render_app_icon('save') ?>Simpan Perubahan</button>
            <a class="btn btn-secondary" href="<?= e(url_for('transfer', $filters)) ?>">Batal</a>
        </div>
    </form>
    <?php endif; ?>

    <form class="panel table-panel" method="post" data-transfer-form>
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="transfer_selected">
        <div class="panel-title">
            <div><h2>Daftar FIFO</h2><p>Urutan berdasarkan waktu kedatangan transit paling awal.</p></div>
            <button class="btn btn-primary" type="submit" data-loading-text="Memproses transfer..."><?= render_app_icon('arrow-right-left') ?>Transfer Pasien Terpilih</button>
        </div>
        <div class="responsive-table" role="region" aria-label="Daftar transfer pasien" tabindex="0">
            <table class="data-table">
                <thead><tr><th><input type="checkbox" data-check-all></th><th>FIFO</th><th>Bed</th><th>Identitas Pasien</th><th>Nama Pasien</th><th>Dokter DPJP</th><th>Rencana Ruangan</th><th>Waktu Kedatangan</th><th>Lama Rawat</th><th>Status Bed</th><th>Aksi</th></tr></thead>
                <tbody>
                <?php foreach ($rows as $index => $patient): ?>
                    <tr>
                        <td><?php if ($patient['status'] === 'READY_TRANSFER'): ?><input type="checkbox" name="selected_patients[]" value="<?= e($patient['id']) ?>" data-transfer-checkbox><?php endif; ?></td>
                        <td><?= e((string) ($index + 1)) ?></td>
                        <td><?= e($patient['bed_code']) ?></td>
                        <td><?= e($patient['medical_record_number']) ?></td>
                        <td><?= e(patient_display_name($patient)) ?></td>
                        <td><?= e($patient['doctor_name']) ?></td>
                        <td><?= e($patient['planned_room']) ?></td>
                        <td><?= e(format_datetime($patient['arrival_time'])) ?></td>
                        <td><?= e(format_duration_between($patient['arrival_time'])) ?></td>
                        <td><?= render_status_badge($patient['bed_status']) ?></td>
                        <td class="table-actions">
                            <a class="btn btn-small" href="<?= e(url_for('transfer', array_merge($filters, ['edit' => (int) $patient['id']]))) ?>#transfer-edit" aria-label="<?= e('Edit rencana transfer ' . patient_display_name($patient)) ?>"><?= render_app_icon('pencil') ?>Edit</a>
                            <?php if ($patient['status'] === 'ACTIVE'): ?>
                                <button class="btn btn-small btn-secondary" type="submit" name="noop" disabled>Belum Siap</button>
                            <?php else: ?>
                                <span class="status-badge status-siap_transfer">Siap</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <?php if (!$rows) render_empty_state('Tidak ada pasien', 'Pasien aktif atau siap transfer akan tampil di sini.'); ?>
    </form>
    <?php
    render_app_footer();
}

function render_reports_page(PDO $pdo): void
{
    require_permission($pdo, 'reports.view');
    $filters = report_filters_from_request($_GET);
    $patients = fetch_report_patients($pdo, $filters);
    $doctors = fetch_active_doctors($pdo);
    $total = count($patients);
    $transferred = count(array_filter($patients, fn ($p) => $p['status'] === 'TRANSFERRED'));
    $active = count(array_filter($patients, fn ($p) => in_array($p['status'], ['ACTIVE', 'READY_TRANSFER'], true)));
    $avg = $total ? (int) round(array_sum(array_map(fn ($p) => (int) $p['stay_minutes'], $patients)) / $total) : 0;
    $year = $filters['year'] !== '' ? (int) $filters['year'] : (int) date('Y');
    $monthlyStmt = $pdo->prepare(
        'SELECT MONTH(arrival_time) AS month_no, COUNT(*) AS total
         FROM patients
         WHERE deleted_at IS NULL AND YEAR(arrival_time) = ?
         GROUP BY MONTH(arrival_time)'
    );
    $monthlyStmt->execute([$year]);
    $monthly = array_column($monthlyStmt->fetchAll(), 'total', 'month_no');
    $maxMonthly = max(1, ...array_map('intval', $monthly ?: [1]));

    render_app_header($pdo, 'Rekap Data Pasien', 'reports');
    ?>
    <section class="toolbar-panel">
        <form class="filter-form" method="get">
            <input type="hidden" name="page" value="reports">
            <label>Hari <input type="date" name="day" value="<?= e($filters['day']) ?>"></label>
            <label>Bulan <input type="month" name="month" value="<?= e($filters['month']) ?>"></label>
            <label>Tahun <input type="number" name="year" min="2020" max="2100" value="<?= e($filters['year']) ?>"></label>
            <label>Dokter
                <select name="doctor_id"><option value="">Semua</option><?php foreach ($doctors as $doctor): ?><option value="<?= e($doctor['id']) ?>"<?= selected($filters['doctor_id'], $doctor['id']) ?>><?= e($doctor['name']) ?></option><?php endforeach; ?></select>
            </label>
            <label>Diagnosa <input name="diagnosis" value="<?= e($filters['diagnosis']) ?>"></label>
            <label>Status
                <select name="status"><option value="">Semua</option><?php foreach (app_config('patient_statuses') as $key => $label): ?><option value="<?= e($key) ?>"<?= selected($filters['status'], $key) ?>><?= e($label) ?></option><?php endforeach; ?></select>
            </label>
            <label>Ruangan <input name="room" value="<?= e($filters['room']) ?>"></label>
            <label>Status Bed
                <select name="bed_status"><option value="">Semua</option><?php foreach (app_config('bed_statuses') as $key => $label): ?><option value="<?= e($key) ?>"<?= selected($filters['bed_status'], $key) ?>><?= e($label) ?></option><?php endforeach; ?></select>
            </label>
            <button class="btn btn-secondary" type="submit"><?= render_app_icon('search') ?>Filter</button>
            <a class="btn btn-primary" href="<?= e(url_for('export', $filters)) ?>"><?= render_app_icon('file-down') ?>Export Excel</a>
        </form>
    </section>
    <section class="stat-grid">
        <article class="stat-card"><span>Total Pasien</span><strong><?= e($total) ?></strong></article>
        <article class="stat-card blue"><span>Pasien Transfer</span><strong><?= e($transferred) ?></strong></article>
        <article class="stat-card green"><span>Masih Transit</span><strong><?= e($active) ?></strong></article>
        <article class="stat-card rose"><span>Rata-rata Lama Rawat</span><strong class="stat-duration"><?= e(format_duration_minutes($avg)) ?></strong></article>
    </section>
    <section class="panel">
        <div class="panel-title"><h2>Rekap Tahunan <?= e($year) ?></h2></div>
        <div class="year-chart">
            <?php for ($m = 1; $m <= 12; $m++): $value = (int) ($monthly[$m] ?? 0); ?>
                <div><span><?= e(DateTimeImmutable::createFromFormat('!m', (string) $m)->format('M')) ?></span><i style="height: <?= e((string) max(4, ($value / $maxMonthly) * 100)) ?>%"></i><strong><?= e($value) ?></strong></div>
            <?php endfor; ?>
        </div>
    </section>
    <section class="panel table-panel">
        <div class="responsive-table" role="region" aria-label="Rekap data pasien" tabindex="0">
            <table class="data-table">
                <thead><tr><th>No. RM</th><th>Nama</th><th>DPJP</th><th>Diagnosa</th><th>Bed</th><th>Masuk</th><th>Transfer</th><th>Lama Rawat</th><th>Status</th></tr></thead>
                <tbody>
                <?php foreach ($patients as $patient): ?>
                    <tr>
                        <td><?= e($patient['medical_record_number']) ?></td>
                        <td><?= e(patient_display_name($patient)) ?></td>
                        <td><?= e($patient['doctor_name'] ?? '-') ?></td>
                        <td><?= e($patient['diagnosis']) ?></td>
                        <td><?= e($patient['bed_code'] ?? '-') ?></td>
                        <td><?= e(format_datetime($patient['arrival_time'])) ?></td>
                        <td><?= e(format_datetime($patient['transfer_time'])) ?></td>
                        <td><?= e(format_duration_minutes((int) $patient['stay_minutes'])) ?></td>
                        <td><?= render_status_badge($patient['status'], 'patient') ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </section>
    <?php
    render_app_footer();
}

function render_export(PDO $pdo): void
{
    require_permission($pdo, 'exports.download');
    $filters = report_filters_from_request($_GET);
    $patients = fetch_report_patients($pdo, $filters);
    $rows = [[
        'No', 'No. RM', 'Nama Pasien', 'Jenis Kelamin', 'Tanggal Lahir', 'Alamat', 'Status Perkawinan',
        'Tingkat Ketergantungan', 'Dokter DPJP', 'Diagnosa', 'Bed', 'Waktu Kedatangan Transit',
        'Waktu Transfer', 'Lama Rawat', 'Status',
        'No. KTP/SIM/NIP', 'Agama', 'Penanggung Pasien', 'Kelas Perawatan', 'Penanggung Jawab',
        'Hubungan dengan Pasien', 'No. HP', 'Pendidikan', 'Rencana Ruangan', 'Status Kesadaran',
    ]];

    foreach ($patients as $i => $patient) {
        $rows[] = [
            (string) ($i + 1),
            $patient['medical_record_number'],
            patient_display_name($patient),
            format_gender($patient['gender']),
            $patient['birth_date'],
            $patient['address'],
            $patient['marital_status'],
            $patient['dependency_level'],
            $patient['doctor_name'] ?? '-',
            $patient['diagnosis'],
            $patient['bed_code'] ?? '-',
            format_datetime($patient['arrival_time']),
            format_datetime($patient['transfer_time']),
            format_duration_minutes((int) $patient['stay_minutes']),
            patient_status_label($patient['status']),
            $patient['identity_number'] ?? '',
            $patient['religion'] ?? '',
            $patient['payer_type'] ?? '',
            $patient['care_class'] ?? '',
            $patient['guardian_name'] ?? '',
            $patient['guardian_relationship'] ?? '',
            $patient['guardian_phone'] ?? '',
            $patient['education'] ?? '',
            $patient['planned_room'],
            $patient['consciousness_status'],
        ];
    }

    $suffix = date('Y_m');
    if ($filters['month'] !== '') {
        $suffix = str_replace('-', '_', $filters['month']);
    } elseif ($filters['year'] !== '') {
        $suffix = $filters['year'];
    }
    audit_log($pdo, 'Export Excel', 'Export rekap pasien dengan filter aktif.');
    send_xlsx('rekap_e_transit_' . $suffix . '.xlsx', $rows);
}

function render_beds_admin_page(PDO $pdo): void
{
    require_permission($pdo, '*');
    $beds = fetch_beds_with_patients($pdo);
    render_app_header($pdo, 'Master Bed', 'beds');
    ?>
    <section class="panel">
        <div class="panel-title"><h2>Tambah Bed</h2></div>
        <form class="form-grid three" method="post" data-loading-form>
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="save_bed">
            <label>Kode Bed <input name="bed_code" placeholder="Kode bed" required></label>
            <label>Status
                <select name="status"><option value="KOSONG">Kosong</option><option value="NONAKTIF">Nonaktif</option></select>
            </label>
            <button class="btn btn-primary" type="submit"><?= render_app_icon('save') ?>Simpan Bed</button>
        </form>
    </section>
    <section class="panel table-panel">
        <div class="responsive-table" role="region" aria-label="Daftar bed" tabindex="0">
        <table class="data-table">
            <thead><tr><th>Kode</th><th>Status</th><th>Pasien</th><th>Aksi</th></tr></thead>
            <tbody>
            <?php foreach ($beds as $bed): ?>
                <tr>
                    <td><?= e($bed['bed_code']) ?></td>
                    <td><?= render_status_badge($bed['status']) ?></td>
                    <td><?= e($bed['full_name'] ? patient_display_name($bed) : '-') ?></td>
                    <td>
                        <?php if (empty($bed['patient_id'])): ?>
                            <form method="post">
                                <?= csrf_field() ?>
                                <input type="hidden" name="action" value="toggle_bed">
                                <input type="hidden" name="id" value="<?= e($bed['id']) ?>">
                                <button class="btn btn-small btn-secondary" type="submit"><?= render_app_icon('bed-single') ?><?= $bed['status'] === 'NONAKTIF' ? 'Aktifkan' : 'Nonaktifkan' ?></button>
                            </form>
                        <?php else: ?>
                            -
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    </section>
    <?php
    render_app_footer();
}

function render_users_page(PDO $pdo): void
{
    require_permission($pdo, '*');
    $roles = fetch_roles($pdo, true);
    $users = $pdo->query(
        'SELECT u.*, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         ORDER BY u.is_active DESC, u.full_name'
    )->fetchAll();
    render_app_header($pdo, 'User & Role', 'users');
    ?>
    <section class="panel">
        <div class="panel-title"><h2>Tambah User</h2></div>
        <form class="form-grid three" method="post" data-loading-form data-password-form>
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="save_user">
            <label>Nama Lengkap <input name="full_name" required></label>
            <label>Username <input name="username" required pattern="[A-Za-z0-9_.-]{4,80}"></label>
            <label>Email <input type="email" name="email" required></label>
            <label>Nomor Identitas <input name="identity_number"></label>
            <label>Role
                <select name="role_id" required><?php foreach ($roles as $role): ?><option value="<?= e($role['id']) ?>"><?= e($role['name']) ?></option><?php endforeach; ?></select>
            </label>
            <label>Password <input type="password" name="password" required data-password-input></label>
            <button class="btn btn-primary" type="submit"><?= render_app_icon('save') ?>Simpan User</button>
        </form>
        <p class="password-hint" data-password-hint>Gunakan huruf besar, huruf kecil, angka, dan karakter khusus.</p>
    </section>
    <section class="panel table-panel">
        <div class="responsive-table" role="region" aria-label="Daftar user" tabindex="0">
        <table class="data-table">
            <thead><tr><th>Nama</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
            <?php foreach ($users as $row): ?>
                <tr>
                    <td><?= e($row['full_name']) ?></td>
                    <td><?= e($row['username']) ?></td>
                    <td><?= e($row['email']) ?></td>
                    <td><?= e($row['role_name']) ?></td>
                    <td><?= $row['is_active'] ? '<span class="status-badge status-kosong">Aktif</span>' : '<span class="status-badge status-nonaktif">Nonaktif</span>' ?></td>
                    <td>
                        <form method="post">
                            <?= csrf_field() ?>
                            <input type="hidden" name="action" value="toggle_user">
                            <input type="hidden" name="id" value="<?= e($row['id']) ?>">
                            <button class="btn btn-small btn-secondary" type="submit"><?= render_app_icon('shield-check') ?><?= $row['is_active'] ? 'Nonaktifkan' : 'Aktifkan' ?></button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    </section>
    <?php
    render_app_footer();
}

function render_audit_page(PDO $pdo): void
{
    require_permission($pdo, '*');
    $stmt = $pdo->query(
        'SELECT a.*, u.full_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC
         LIMIT 200'
    );
    $logs = $stmt->fetchAll();
    render_app_header($pdo, 'Audit Log', 'audit');
    ?>
    <section class="panel table-panel">
        <div class="responsive-table" role="region" aria-label="Audit aktivitas" tabindex="0">
        <table class="data-table">
            <thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>IP</th><th>Deskripsi</th></tr></thead>
            <tbody>
            <?php foreach ($logs as $log): ?>
                <tr>
                    <td><?= e(format_datetime($log['created_at'])) ?></td>
                    <td><?= e($log['full_name'] ?? '-') ?></td>
                    <td><?= e($log['action']) ?></td>
                    <td><?= e($log['ip_address']) ?></td>
                    <td><?= e($log['description']) ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    </section>
    <?php
    render_app_footer();
}

function render_profile_page(PDO $pdo): void
{
    require_permission($pdo, 'profile.manage');
    $user = current_user($pdo);
    render_app_header($pdo, 'Profil', 'profile');
    ?>
    <section class="panel detail-panel">
        <div class="panel-title"><h2><?= e($user['full_name']) ?></h2><span class="status-badge status-kosong"><?= e($user['role_name']) ?></span></div>
        <div class="detail-grid">
            <div><span>Username</span><strong><?= e($user['username']) ?></strong></div>
            <div><span>Email</span><strong><?= e($user['email']) ?></strong></div>
            <div><span>Nomor Identitas</span><strong><?= e($user['identity_number'] ?? '-') ?></strong></div>
            <div><span>Login Terakhir</span><strong><?= e(format_datetime($user['last_login_at'])) ?></strong></div>
        </div>
    </section>
    <section class="panel">
        <div class="panel-title"><h2>Ganti Password</h2></div>
        <form method="post" class="form-grid three" data-loading-form data-password-form>
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="change_password">
            <label>Password Saat Ini <input type="password" name="current_password" required></label>
            <label>Password Baru <input type="password" name="password" required data-password-input></label>
            <label>Konfirmasi Password <input type="password" name="password_confirm" required></label>
            <button class="btn btn-primary" type="submit"><?= render_app_icon('save') ?>Perbarui Password</button>
        </form>
        <p class="password-hint" data-password-hint>Gunakan huruf besar, huruf kecil, angka, dan karakter khusus.</p>
    </section>
    <?php
    render_app_footer();
}

function render_not_found(PDO $pdo): void
{
    http_response_code(404);
    render_app_header($pdo, 'Halaman Tidak Ditemukan', 'dashboard');
    render_empty_state('Halaman tidak ditemukan', 'Periksa kembali menu atau alamat yang dibuka.');
    render_app_footer();
}
