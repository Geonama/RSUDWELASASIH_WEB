<?php

function render_theme_assets(): void
{
    ?>
    <script src="assets/js/theme.js?v=<?= filemtime(__DIR__ . '/../assets/js/theme.js') ?>"></script>
    <link rel="stylesheet" href="assets/css/theme.css?v=<?= filemtime(__DIR__ . '/../assets/css/theme.css') ?>">
    <?php
}

function render_theme_toggle(): void
{
    ?>
    <button class="theme-toggle" type="button" data-theme-toggle role="switch" aria-checked="false" aria-label="Mode gelap" title="Aktifkan mode gelap">
        <span class="theme-toggle-track" aria-hidden="true">
            <svg class="theme-toggle-stars" viewBox="0 0 72 36" fill="none">
                <path d="m47 7 1.3 3.7L52 12l-3.7 1.3L47 17l-1.3-3.7L42 12l3.7-1.3L47 7Z" fill="currentColor"/>
                <circle cx="59" cy="8" r="1.3" fill="currentColor"/><circle cx="60" cy="23" r="1.7" fill="currentColor"/><circle cx="40" cy="26" r="1" fill="currentColor"/>
            </svg>
            <span class="theme-toggle-orb">
                <svg class="theme-toggle-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
                </svg>
                <svg class="theme-toggle-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19.7 14.2A8.2 8.2 0 0 1 9.8 4.3 8.2 8.2 0 1 0 19.7 14.2Z"/>
                    <path d="m17 3 .7 2.3L20 6l-2.3.7L17 9l-.7-2.3L14 6l2.3-.7L17 3Z" fill="currentColor" stroke="none"/>
                </svg>
            </span>
        </span>
        <span class="theme-toggle-copy" aria-hidden="true"><small>Mode tampilan</small><span data-theme-label>Terang</span></span>
    </button>
    <?php
}

function render_auth_header(string $title): void
{
    $isLogin = $title === 'Login';
    ?>
    <!doctype html>
    <html lang="id" data-auth-page="<?= $isLogin ? 'login' : 'register' ?>">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= e($title) ?> - E-Transit</title>
        <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
        <link rel="stylesheet" href="assets/css/styles.css?v=<?= filemtime(__DIR__ . '/../assets/css/styles.css') ?>">
        <link rel="stylesheet" href="assets/css/auth-transitions.css?v=<?= filemtime(__DIR__ . '/../assets/css/auth-transitions.css') ?>">
        <?php render_theme_assets(); ?>
        <script src="assets/js/auth-transitions.js?v=<?= filemtime(__DIR__ . '/../assets/js/auth-transitions.js') ?>"></script>
    </head>
    <body class="auth-page">
        <div class="auth-theme-toolbar"><?php render_theme_toggle(); ?></div>
        <div class="auth-background" style="background-image: url('background_rs.jpeg');" aria-hidden="true"></div>
        <div class="auth-overlay" aria-hidden="true"></div>
        <main class="auth-shell<?= $isLogin ? ' auth-shell-login' : ' auth-shell-register' ?>">
            <section class="auth-card auth-card-glass" aria-labelledby="auth-title">
                <div class="auth-affiliations">
                    <img src="logologo.png" alt="Logo Pemerintah Jawa Barat, Dinas Kesehatan, RSUD Welas Asih, UPI, dan Program Profesi Ners UPI" width="2086" height="754">
                </div>
                <header class="auth-brand">
                    <img class="etransit-logo" src="logo_etransit.png" alt="" width="1280" height="1186">
                    <div>
                        <h1>E-Transit</h1>
                        <p>Manajemen Ruang Transit</p>
                    </div>
                </header>
                <?php render_flash_messages(); ?>
    <?php
}

function render_auth_footer(): void
{
    ?>
            </section>
            <footer class="auth-footer">
                <span>RSUD Welas Asih</span>
                <span class="auth-footer-divider" aria-hidden="true">&middot;</span>
                <span>Universitas Pendidikan Indonesia</span>
            </footer>
        </main>
        <script src="assets/js/app.js?v=<?= filemtime(__DIR__ . '/../assets/js/app.js') ?>"></script>
    </body>
    </html>
    <?php
}

function render_app_header(PDO $pdo, string $title, string $activePage): void
{
    $user = current_user($pdo);
    $role = $user['role_code'] ?? '';
    ?>
    <!doctype html>
    <html lang="id">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= e($title) ?> - E-Transit</title>
        <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
        <link rel="stylesheet" href="assets/css/styles.css?v=<?= filemtime(__DIR__ . '/../assets/css/styles.css') ?>">
        <link rel="stylesheet" href="assets/css/app-glass.css?v=<?= filemtime(__DIR__ . '/../assets/css/app-glass.css') ?>">
        <?php render_theme_assets(); ?>
        <?php if ($activePage === 'dashboard'): ?>
            <link rel="stylesheet" href="assets/css/transit-map.css?v=<?= filemtime(__DIR__ . '/../assets/css/transit-map.css') ?>">
        <?php endif; ?>
        <link rel="stylesheet" href="assets/css/navigation.css?v=<?= filemtime(__DIR__ . '/../assets/css/navigation.css') ?>">
        <script defer src="assets/js/navigation.js?v=<?= filemtime(__DIR__ . '/../assets/js/navigation.js') ?>"></script>
    </head>
    <body class="app-page app-glass<?= $activePage === 'dashboard' ? ' app-dashboard' : '' ?>" data-app-page="<?= e($activePage) ?>">
        <div class="mobile-topbar">
            <img src="logo_etransit.png" alt="E-Transit">
            <button class="icon-button" type="button" data-menu-toggle aria-controls="app-sidebar" aria-expanded="false" aria-label="Buka menu" title="Buka menu">
                <img src="assets/icons/menu.svg" alt="" aria-hidden="true" width="20" height="20">
            </button>
        </div>
        <aside class="sidebar" id="app-sidebar" data-sidebar>
            <div class="sidebar-brand">
                <img class="app-brand-logo" src="logo_etransit.png" alt="" width="64" height="60">
                <div>
                    <strong>E-Transit</strong>
                    <span><?= e($user['role_name'] ?? '') ?></span>
                </div>
            </div>
            <nav class="nav-menu" aria-label="Navigasi utama">
                <?php foreach (app_menu($role) as $item): ?>
                    <a class="<?= $activePage === $item['page'] ? 'active' : '' ?>" href="<?= e(url_for($item['page'])) ?>"<?= $activePage === $item['page'] ? ' aria-current="page"' : '' ?>>
                        <span class="nav-icon" aria-hidden="true">
                            <img src="assets/icons/<?= e($item['icon']) ?>.svg" alt="" width="20" height="20">
                        </span>
                        <span class="nav-label"><?= e($item['label']) ?></span>
                        <svg class="nav-cue" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>
                    </a>
                <?php endforeach; ?>
            </nav>
            <div class="sidebar-institution">
                <img src="logo_rsud.png" alt="" width="30" height="34">
                <span>RSUD Welas Asih</span>
            </div>
            <form class="logout-form" method="post" action="<?= e(url_for('logout')) ?>">
                <?= csrf_field() ?>
                <button class="btn btn-ghost btn-full" type="submit">
                    <img src="assets/icons/log-out.svg" alt="" aria-hidden="true" width="18" height="18">
                    Logout
                </button>
            </form>
        </aside>
        <main class="content-shell">
            <?php if ($activePage === 'dashboard'): ?>
                <header class="dashboard-institution" aria-labelledby="dashboard-institution-title">
                    <div class="dashboard-institution-heading">
                        <img class="dashboard-institution-logo" src="logo_jabar.png" alt="Lambang Pemerintah Provinsi Jawa Barat" width="2048" height="2048">
                        <div class="dashboard-institution-copy">
                            <p class="dashboard-institution-government">PEMERINTAH PROVINSI JAWA BARAT</p>
                            <p class="dashboard-institution-office">DINAS KESEHATAN</p>
                            <h2 id="dashboard-institution-title">UOBK RUMAH SAKIT<br>UMUM DAERAH WELAS ASIH</h2>
                        </div>
                        <img class="dashboard-institution-logo" src="logo_rsud.png" alt="Logo RSUD Welas Asih Provinsi Jawa Barat" width="1280" height="1280">
                    </div>
                    <address class="dashboard-institution-contact">
                        <p>Jl. Kiastramanggala Baleendah, Kab. Bandung</p>
                        <div class="dashboard-institution-contact-line">
                            <span>Tlp. <a href="tel:+62225940872">(022) 5940872</a>, <a href="tel:+62225940875">5940875</a></span>
                            <span>Fax. 5941709</span>
                        </div>
                        <a class="dashboard-institution-email" href="mailto:rsudwelasasih@jabarprov.go.id">rsudwelasasih@jabarprov.go.id</a>
                    </address>
                </header>
            <?php endif; ?>
            <header class="topbar">
                <div>
                    <p class="eyebrow"><?= e(app_mode_label($role)) ?></p>
                    <h1><?= e($title) ?></h1>
                </div>
                <div class="topbar-actions">
                    <?php render_theme_toggle(); ?>
                    <div class="user-chip">
                        <img class="app-user-icon" src="assets/icons/user-round.svg" alt="" aria-hidden="true" width="20" height="20">
                        <div>
                            <span><?= e($user['full_name'] ?? '') ?></span>
                            <small><?= e($user['username'] ?? '') ?></small>
                        </div>
                    </div>
                </div>
            </header>
            <?php render_flash_messages(); ?>
    <?php
}

function render_app_footer(): void
{
    ?>
        </main>
        <script src="assets/js/app.js?v=<?= filemtime(__DIR__ . '/../assets/js/app.js') ?>"></script>
    </body>
    </html>
    <?php
}

function render_flash_messages(): void
{
    foreach (get_flash() as $flash) {
        $type = $flash['type'] ?? 'info';
        $message = $flash['message'] ?? '';
        echo '<div class="toast toast-' . e($type) . '" data-toast><span>' . e($message) . '</span><button type="button" aria-label="Tutup" data-toast-close>&times;</button></div>';
    }
}

function app_mode_label(string $roleCode): string
{
    return match ($roleCode) {
        'perawat_igd' => 'Monitor IGD',
        'perawat_transit' => 'Ruang Transit',
        'admin' => 'Admin Dashboard',
        default => 'E-Transit',
    };
}

function app_menu(string $roleCode): array
{
    if ($roleCode === 'perawat_igd') {
        return [
            ['page' => 'dashboard', 'label' => 'Dashboard', 'icon' => 'layout-dashboard'],
            ['page' => 'monitor', 'label' => 'Monitor IGD', 'icon' => 'monitor'],
            ['page' => 'profile', 'label' => 'Profil', 'icon' => 'user-round'],
        ];
    }

    $menu = [
        ['page' => 'dashboard', 'label' => 'Dashboard', 'icon' => 'layout-dashboard'],
        ['page' => 'transit', 'label' => 'Ruang Transit', 'icon' => 'bed-double'],
        ['page' => 'patient_form', 'label' => 'Pendaftaran Pasien', 'icon' => 'clipboard-plus'],
        ['page' => 'patients', 'label' => 'Data Pasien', 'icon' => 'users-round'],
        ['page' => 'transfer', 'label' => 'Sistem Transfer', 'icon' => 'arrow-right-left'],
        ['page' => 'doctors', 'label' => 'Data Dokter', 'icon' => 'stethoscope'],
        ['page' => 'reports', 'label' => 'Rekap Pasien', 'icon' => 'chart-no-axes-combined'],
    ];

    if ($roleCode === 'admin') {
        $menu[] = ['page' => 'beds', 'label' => 'Master Bed', 'icon' => 'bed-single'];
        $menu[] = ['page' => 'users', 'label' => 'User & Role', 'icon' => 'shield-check'];
        $menu[] = ['page' => 'audit', 'label' => 'Audit Log', 'icon' => 'history'];
    }

    $menu[] = ['page' => 'profile', 'label' => 'Profil', 'icon' => 'user-round'];
    return $menu;
}

function render_status_badge(string $status, string $type = 'bed'): string
{
    $label = $type === 'patient' ? patient_status_label($status) : bed_status_label($status);
    return '<span class="status-badge status-' . e(strtolower($status)) . '">' . e($label) . '</span>';
}

function render_app_icon(string $name): string
{
    return '<img src="assets/icons/' . e($name) . '.svg" alt="" aria-hidden="true" width="18" height="18">';
}

function render_empty_state(string $title, string $message): void
{
    ?>
    <div class="empty-state">
        <strong><?= e($title) ?></strong>
        <p><?= e($message) ?></p>
    </div>
    <?php
}
