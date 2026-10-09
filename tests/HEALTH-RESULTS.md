# Audit Website dan Database — 8 Oktober 2026

Pada kondisi pemeriksaan ini, database utama dan alur fitur yang diuji
berjalan normal. Tidak ditemukan kerusakan tabel, relasi data yang putus,
atau error runtime baru pada pemeriksaan aplikasi melalui Apache XAMPP.
Hasil ini bukan jaminan bahwa semua kemungkinan kondisi bebas masalah.

| Bagian | Hasil | Cakupan |
| --- | --- | --- |
| Database `e_transit` | 97/97 lolos | 9 tabel InnoDB, kolom, indeks unik, foreign key, `CHECK TABLE`, status dan relasi pasien/bed/transfer, duplikasi, role, waktu |
| Sistem MySQL/phpMyAdmin | 47 tabel OK | `mysqlcheck --check --databases mysql phpmyadmin` |
| Alur fitur | 82/82 lolos | Login/register, hak akses, CSRF, pasien/vital sign, dokter, bed, transfer, rollback/transaksi bersamaan, riwayat, laporan/Excel, pengguna, audit, sesi/logout |
| Aplikasi aktual melalui Apache | 56/56 lolos | Semua halaman yang diizinkan pada ketiga role, desktop/light dan ponsel/dark, aset, login/logout, API bed |
| Dark/light mode | 265 pemeriksaan halaman lolos | Semua role dan halaman auth, lebar 320–1440px, 15.206 pemeriksaan kontras teks, keyboard, persistensi, sinkronisasi tab, tema sistem, storage diblokir, cetak |
| Sidebar dan responsivitas | 101 pemeriksaan navigasi lolos | Semua role, kedua tema, resize 320–1440px, efek lokal, keyboard, kembali, klik cepat, reduced motion, 6 skenario CPU 6x lebih lambat |
| Sintaks | Lolos | 15 file PHP dan 8 file JavaScript/CJS |

Database menggunakan MariaDB 10.4.32, `innodb_force_recovery=0`,
`read_only=0`, dan zona waktu UTC+7. Inventaris berisi 19 bed, semuanya
kosong saat diperiksa; 3 pasien yang tersimpan berstatus sudah ditransfer.
Relasi riwayat transfer tetap konsisten. Tidak ada duplikasi transfer,
pasien aktif tanpa bed yang sesuai, atau referensi foreign key yang putus.

Log MySQL menyimpan error InnoDB dari sebelum pemulihan pukul 14.25.
Proses MySQL tetap PID 8704 sepanjang audit, dan log MySQL tidak bertambah
setelah startup pukul 14.25.45. Log Apache juga tidak bertambah selama
audit. Log PHP bertambah satu pesan duplikasi `QA BED` pukul 16.09.47;
pesan itu berasal dari pengujian sengaja menolak kode bed duplikat di
database sementara. Pemeriksaan aplikasi aktual tidak menambahkan error.

Satu pengujian tema pertama membaca kontras sidebar yang tidak sesuai
pada dashboard Transit dalam mode terang. Dua pengujian penuh berikutnya
lolos, dan pemeriksaan Apache juga lolos tanpa kegagalan aset atau
JavaScript. Penyebab hasil pertama belum dapat dipastikan. Diagnostik
stylesheet, screenshot kegagalan, dan pencatatan kegagalan resource telah
ditambahkan ke runner tema untuk membantu bila kejadian itu berulang.
Temuan ini tidak dianggap telah diperbaiki hanya karena pengujian ulang
lolos.

Pengujian yang mengubah pasien, bed, dokter, pengguna, dan transfer memakai
database sementara yang dibersihkan setelahnya. Fingerprint delapan tabel
data inti utama cocok sebelum dan sesudah seluruh audit. Pemeriksaan
langsung hanya memperbarui timestamp login dan audit melalui login/logout
biasa. Tidak ada data pasien asli yang diubah atau disimpan ke screenshot
audit langsung, dan tidak ada setup/migrasi ulang database utama.

Pemeriksaan dilakukan menggunakan Chrome pada komputer ini. Alur perubahan
data memakai data contoh, bukan transaksi pasien asli; beban banyak
pengguna, semua jenis perangkat/browser, dan pemulihan setelah gangguan
listrik belum diuji pada audit ini.

Artefak:

- Database, 47 tabel sistem, dan bukti runtime: `C:\Users\ggmin\AppData\Local\Temp\etransit-health-00ac3d36`
- Fitur: `C:\Users\ggmin\AppData\Local\Temp\etransit-functional-wADcvI`
- Sidebar: `C:\Users\ggmin\AppData\Local\Temp\etransit-navigation-Ck1uMS`
- Tema, hasil akhir dengan pencatatan resource: `C:\Users\ggmin\AppData\Local\Temp\etransit-theme-EPdOKE`
- Tema, pengujian ulang sebelumnya: `C:\Users\ggmin\AppData\Local\Temp\etransit-theme-aG7N6u`
- Apache aktual: `C:\Users\ggmin\AppData\Local\Temp\etransit-live-health-vzseMn`
