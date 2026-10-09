# Audit fitur dan keamanan E-Transit

Tanggal: 9 Oktober 2026, WIB. Lingkungan yang diperiksa:
`C:\xampp\htdocs\project_web`, Apache XAMPP lokal, dan database `e_transit`.
Penggunaan yang diminta: komputer lokal/jaringan internal rumah sakit.

**Fitur yang diuji berjalan, tetapi konfigurasi saat ini belum layak dinyatakan
aman untuk penggunaan data pasien asli di jaringan rumah sakit.** Ada risiko
nyata pada kredensial, koneksi, dan versi server yang masih harus ditangani.
Lulusnya pengujian regresi tidak menghapus temuan konfigurasi tersebut.

## Hasil pengujian

| Pemeriksaan | Hasil | Cakupan utama |
| --- | --- | --- |
| Fitur aplikasi | 83/83 kelompok lulus | Login/register/logout, role, CSRF, dokter, pasien/vital sign, bed, edit rencana transfer, FIFO, transfer, transaksi bersamaan, riwayat, rekap/Excel, user, profil, audit, timeout |
| Regresi keamanan tambahan | 10/10 kelompok lulus | Session ID, cookie, header/CSP, redirect, pembatas login, sesi setelah password/role berubah, password bcrypt, ekspor, dan perubahan bed bersamaan |
| Proteksi Apache aktual | 5/5 kelompok lulus | Direktori sensitif, akses anonim, header/cookie, redirect, dan fingerprint data |
| Audit database aktual | 97/97 pemeriksaan lulus | Tabel/kolom/indeks, foreign key, relasi pasien-bed-transfer, duplikasi, status, dan waktu |
| Halaman/API Apache aktual | 56/56 pemeriksaan lulus | Ketiga role, login/logout, aset, desktop/ponsel, tema, API bed |
| Tema dan responsivitas | 265 pemeriksaan halaman lulus | Tema terang/gelap, lebar 320-1440px, keyboard, penyimpanan/sinkronisasi pilihan; 16.628 pemeriksaan kontras teks |
| Navigasi sidebar | 101 pemeriksaan lulus | Ketiga role, keyboard, kembali, klik cepat, reduced motion, resize, dan CPU diperlambat |
| Denah dashboard | 36 layout lulus | Status/warna/kontras, kelompok bed, polling, penambahan bed, dan kedua tema |
| Sintaks | 15 PHP dan 11 JavaScript/CJS lulus | Tidak ada kesalahan sintaks pada file sumber yang diperiksa |

Pengujian perubahan data menggunakan database sementara `e_transit_qa_*`.
Database dan server uji dibersihkan. Fingerprint data inti database utama
tetap sama. Pemeriksaan Apache melalui login/logout hanya memperbarui
metadata login dan audit biasa. Data pasien asli tidak diubah atau dijadikan
screenshot. Pengujian layout memakai data contoh.

## Perbaikan yang diterapkan

- Login dibatasi setelah 5 kegagalan per akun/alamat IP dalam 5 menit,
  dengan batas keseluruhan 100 kegagalan per IP. Username/email berbagi
  penghitung akun. Cookie baru tidak melewati batas; akses file penghitung
  dikunci agar permintaan bersamaan tidak melewati pemeriksaan. File berada
  di direktori sementara sistem, di luar direktori web. Penyimpanan yang
  gagal membuat login ditolak, bukan melewati batas.
- Session strict mode dan cookie-only diaktifkan. Cookie memakai HttpOnly,
  SameSite=Lax, serta path direktori aplikasi. Secure digunakan pada HTTPS.
- Sesi diperiksa terhadap fingerprint password/role. Ganti password
  memutar session ID saat ini dan membatalkan sesi lain pada permintaan
  berikutnya. Pergantian role juga mengharuskan login kembali.
- Redirect dari Referer diubah menjadi tujuan lokal `index.php`; host luar
  dan karakter kontrol tidak diteruskan menjadi tujuan pengalihan.
- Header CSP, anti-framing, nosniff, referrer, dan permissions diterapkan pada
  respons PHP. Header versi PHP dihapus. Duplikasi header PHP/Apache yang
  ditemukan pada pemeriksaan langsung sudah dibersihkan dan diuji ulang.
  CSP melarang script inline; style inline masih diperlukan oleh tampilan.
- Nonaktifkan/aktifkan bed menggunakan transaksi dan row lock. Skenario
  pendaftaran bersamaan membuktikan bed yang baru terisi tidak menjadi
  nonaktif akibat permintaan yang lebih dulu membaca status kosong.
- Filename ekspor dinormalisasi sehingga nilai filter tidak memasukkan
  karakter kontrol/quote ke header unduhan. Sel Excel tetap berupa teks,
  termasuk nilai yang diawali formula.
- Password baru dibatasi 8-72 karakter untuk menghindari pemotongan bcrypt.
- Apache menolak direktori config/includes/database/logs/tests serta file
  tersembunyi, dokumentasi sumber, log, dan jenis backup yang diperiksa.

Pengamanan sesi mengacu pada [panduan sesi PHP](https://www.php.net/manual/en/session.security.ini.php),
pembatas login pada [panduan autentikasi OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
dan batas bcrypt pada [dokumentasi password_hash PHP](https://www.php.net/manual/en/function.password-hash.php).

## Temuan yang masih terbuka

| Prioritas | Bukti aktual | Tindakan yang diperlukan |
| --- | --- | --- |
| Tinggi | Akun aktif `admin`, `igd`, dan `transit` masih cocok dengan password awal yang tercantum di README | Ganti password ketiga akun, atau nonaktifkan akun demo setelah akun staf penggantinya tersedia |
| Tinggi | Aplikasi terhubung sebagai MySQL `root`, password kosong, dan hak global | Gunakan akun database khusus dengan password dan hak minimum pada database aplikasi; evaluasi keamanan akun root secara terpisah |
| Tinggi | Alamat penggunaan normal memakai HTTP; pemeriksaan HTTPS menghasilkan `CERT_HAS_EXPIRED` | Pasang sertifikat yang berlaku dan dipercaya perangkat staf, kemudian gunakan HTTPS untuk klien jaringan; jangan menganggap sertifikat bawaan XAMPP memadai |
| Tinggi | PHP 8.2.12, Apache 2.4.58/OpenSSL 3.1.3, dan MariaDB 10.4.32 | Rencanakan backup, pembaruan ke versi yang didukung, uji kompatibilitas di lingkungan terpisah, lalu pembaruan server |
| Rendah | Apache menerima TRACE dan header Server menampilkan versi software | Nonaktifkan TRACE dan kurangi informasi versi pada konfigurasi Apache |
| Kebijakan yang dipertahankan | Akun perawat baru langsung aktif dan bisa mendapat hak Perawat Transit | Sesuai instruksi pengguna, tidak ada aktivasi Admin. Akses jaringan harus dibatasi ke perangkat/staf yang berwenang; pendaftaran tidak membuktikan identitas staf |

MariaDB 10.4 telah berakhir masa pemeliharaannya pada 18 Juni 2024 menurut
[kebijakan pemeliharaan MariaDB](https://mariadb.org/about/#maintenance-policy).
Apache mencantumkan versi sampai 2.4.58 pada advisory yang diperbaiki pada
versi berikutnya; lihat [advisory Apache](https://httpd.apache.org/security/vulnerabilities_24.html).
Ini adalah alasan untuk memperbarui server. Eksploit advisory terhadap
server ini tidak dijalankan dan tidak ada klaim bahwa server sudah dibobol.

Password pengguna utama, hak database utama, sertifikat, dan konfigurasi
global XAMPP tidak diubah otomatis. Perubahan tersebut memerlukan kredensial,
domain/CA, dan rencana operasi yang sesuai agar akses aplikasi lain/staf
tidak terputus.

## Cakupan dan batas pemeriksaan

Kode menggunakan prepared statements pada input SQL yang diperiksa,
escaping output, CSRF pada POST perubahan, serta izin backend yang diuji
melalui permintaan palsu. Role IGD tidak dapat menjalankan aksi pengelolaan.
Implementasi saat ini mengizinkan IGD membaca detail pasien melalui URL,
termasuk pasien berhistori yang belum dihapus. Jika kebijakan rumah sakit
membatasi histori hanya untuk Transit/Admin, aturan baca ini perlu disesuaikan.

Apache/MySQL mendengar pada semua antarmuka jaringan dan profil firewall
Windows aktif. Audit ini tidak membuktikan port dapat diakses dari internet,
dan tidak menguji aturan firewall dari komputer lain. Pembatas login saat
ini berbasis akun/IP; serangan terdistribusi dari banyak alamat belum diuji.
Pembatas tidak mencakup CAPTCHA/MFA atau persetujuan identitas saat register.

Pengujian ini bukan penilaian seluruh jaringan rumah sakit atau jaminan
keamanan mutlak. Uji beban besar, backup/restore, gangguan listrik, seluruh
browser/perangkat, dan investigasi forensik insiden tidak dilakukan.

## Bukti pengujian

- Fitur: `C:\Users\ggmin\AppData\Local\Temp\etransit-functional-0fptq9`
- Regresi keamanan: `C:\Users\ggmin\AppData\Local\Temp\etransit-security-uOYOV9`
- Apache/config keamanan: `C:\Users\ggmin\AppData\Local\Temp\etransit-security-live-5urZy1`
- Database: `C:\Users\ggmin\AppData\Local\Temp\etransit-audit-20261009\database-health.json`
- Halaman Apache: `C:\Users\ggmin\AppData\Local\Temp\etransit-live-health-uYCWTj`
- Tema: `C:\Users\ggmin\AppData\Local\Temp\etransit-theme-D22bGW`
- Navigasi: `C:\Users\ggmin\AppData\Local\Temp\etransit-navigation-epYqdN`
- Denah: `C:\Users\ggmin\AppData\Local\Temp\etransit-dashboard-map-Nou5kZ`

Artefak dalam direktori sementara dapat hilang saat sistem membersihkan
temporary files. Ringkasan hasil permanen tersimpan dalam laporan ini.
