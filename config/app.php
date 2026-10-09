<?php

$bedGroups = [
    'area_1' => ['label' => '1A-1F', 'codes' => ['1A', '1B', '1C', '1D', '1E', '1F']],
    'area_2' => ['label' => '2A-2F', 'codes' => ['2A', '2B', '2C', '2D', '2E', '2F']],
    'area_4' => ['label' => '4A-4C', 'codes' => ['4A', '4B', '4C']],
    'area_5' => ['label' => '5A-5B', 'codes' => ['5A', '5B']],
    'isolation' => ['label' => 'Isolasi', 'codes' => ['Iso A', 'Iso B']],
];

return [
    'name' => 'E-Transit',
    'timezone' => 'Asia/Jakarta',
    'session_name' => 'ETRANSITSESSID',
    'session_timeout' => 1800,
    'login_max_failures' => 5,
    'login_ip_max_failures' => 100,
    'login_window_seconds' => 300,
    'password_regex' => '/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/',
    'db' => [
        'host' => getenv('DB_HOST') ?: '127.0.0.1',
        'port' => getenv('DB_PORT') ?: '3306',
        'database' => getenv('DB_DATABASE') ?: 'e_transit',
        'username' => getenv('DB_USERNAME') ?: 'root',
        'password' => getenv('DB_PASSWORD') ?: '',
        'charset' => 'utf8mb4',
    ],
    'bed_statuses' => [
        'KOSONG' => 'Kosong',
        'TERISI' => 'Terisi',
        'SIAP_TRANSFER' => 'Siap Transfer',
        'NONAKTIF' => 'Nonaktif',
    ],
    'bed_groups' => $bedGroups,
    'bed_codes' => array_merge(...array_column($bedGroups, 'codes')),
    'patient_statuses' => [
        'ACTIVE' => 'Masih Transit',
        'READY_TRANSFER' => 'Siap Transfer',
        'TRANSFERRED' => 'Sudah Transfer',
        'CANCELLED' => 'Dibatalkan',
    ],
    'transfer_room_options' => [
        'Hasan bin Ali' => 'Hasan',
        'Husain bin Ali' => 'Husen',
        'Said bin Zaid' => 'Said',
        'IGD' => 'IGD',
    ],
    'patient_options' => [
        'religion' => ['Islam', 'Kristen', 'Katolik', 'Buddha', 'Konghucu', 'Hindu', 'Lainnya'],
        'payer_type' => ['BPJS-Non PBI', 'BPJS PBI APBD', 'BPJS PBI APBN', 'SKTM', 'Umum'],
        'care_class' => ['Kelas I', 'Kelas II', 'Kelas III'],
        'planned_room' => ['Hasan bin Ali', 'Husain bin Ali', 'Said bin Zaid'],
        'consciousness_status' => ['Compos Mentis', 'Apatis'],
    ],
    'roles' => [
        'perawat_igd' => 'Perawat IGD',
        'perawat_transit' => 'Perawat Transit',
        'admin' => 'Admin',
    ],
];
