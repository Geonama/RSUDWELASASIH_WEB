# Pengujian Fitur E-Transit

Pengujian regresi keamanan pada database sementara:

```powershell
node tests/security.cjs
```

Mencakup header keamanan, penolakan session ID dari luar, redirect dari
Referer, pembatas login lintas cookie/username/email, pembatalan sesi setelah
password/role berubah, panjang password, pembatasan role, header ekspor,
formula Excel sebagai teks, serta perubahan status bed bersamaan.

Audit keamanan Apache dan konfigurasi aktual yang hanya membaca data:

```powershell
node tests/security-live.cjs
```

Audit ini memeriksa proteksi direktori, akses anonim, header/cookie,
redirect, akun demo, hak database, HTTP/HTTPS, dan TRACE. Temuan konfigurasi
disimpan terpisah dari hasil uji regresi: uji yang lulus tidak berarti semua
risiko konfigurasi sudah selesai. Password/hash, cookie, dan data pasien
tidak dicetak. Audit tidak mengganti password atau konfigurasi server.

Pengujian memakai database baru `e_transit_qa_*`, bukan database aplikasi.
Database uji dan server PHP sementara dibersihkan saat pengujian selesai.
Fingerprint data inti database aplikasi diperiksa sebelum dan setelah
pengujian. Audit log serta timestamp login tidak dibandingkan karena pengguna
bisa tetap menggunakan aplikasi utama selama pengujian berlangsung.

Prasyarat: MySQL aktif, PHP dengan PDO MySQL/ZIP, Node.js, Chrome, dan
`playwright-core` tersedia melalui `NODE_PATH` atau `PLAYWRIGHT_MODULE`.

Jalankan dari root project:

```powershell
$env:PHP_BINARY = 'C:\xampp\php\php.exe'
node tests/functional.cjs
```

Pengujian tema dan keterbacaan pada semua role:

```powershell
node tests/theme.cjs
```

Runner tema memakai database uji terpisah, memeriksa kedua tema pada lebar
1440, 1024, 821, 390, dan 320px, dan menyimpan screenshot di folder sementara.
Pengujian mencakup kontras teks/form/tombol, navigasi ponsel, kontrol keyboard,
penyimpanan pilihan, sinkronisasi antar-tab, tema sistem, dan storage yang
diblokir browser. Data inti aplikasi dibandingkan sebelum/sesudah pengujian.

Pengujian animasi sidebar pada semua role:

```powershell
node tests/navigation.cjs
```

Runner navigasi memeriksa setiap menu pada kedua tema di desktop dan
ponsel, efek klik/ikon, posisi penanda aktif, klik langsung tanpa jeda,
resize 320-1440px, keyboard, tab baru, tombol kembali, klik beruntun,
preferensi pengurangan gerakan, serta sessionStorage yang diblokir.
Simulasi CPU 6x lebih lambat memeriksa permintaan navigasi langsung dan
formulir yang tetap bisa digunakan saat efek sidebar berjalan.
Screenshot disimpan di folder sementara; database uji dibersihkan setelahnya.

Runner akan memilih dua port kosong untuk server uji. Semua perubahan data
pengujian dibatasi ke database uji. Jangan menjalankan setup ulang database
aplikasi untuk melakukan pengujian ini.

Audit database aplikasi secara langsung (hanya baca, tanpa setup/migrasi):

```powershell
C:\xampp\php\php.exe tests/database-health.php
```

Audit memeriksa tabel, kolom, indeks unik, foreign key, `CHECK TABLE`,
relasi pasien/bed/transfer, duplikasi, role, serta konfigurasi waktu.
Output hanya metadata dan jumlah data; rekam medis tidak ditampilkan.
Skrip ini tidak dapat dijalankan melalui browser.

Pemeriksaan halaman pada Apache XAMPP yang sedang dipakai:

```powershell
node tests/live-smoke.cjs
```

Runner ini hanya membuka halaman dan API bed, menggunakan akun awal
admin/igd/transit jika password-nya masih berlaku. Password tidak direset.
Login/logout memperbarui metadata login dan audit; data pasien/bed tidak
diubah. `LIVE_BASE_URL` dapat diatur bila alamat aplikasi berbeda.
Artefak hanya berisi hasil pemeriksaan, tanpa screenshot data pasien asli.

Pengujian denah bed dashboard dengan database sementara:

```powershell
node tests/dashboard-map.cjs
```

Runner memeriksa 19 bed dan kelompok kamar pada ketiga role, warna status
dan kontras kode bed, kedua tema, lebar 320–1440px, pembaruan status melalui
API, penambahan/penghapusan bed, dan pembaruan yang tidak mengganti elemen
denah ketika datanya sama. Screenshot hanya menggunakan data contoh.
