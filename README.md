# RSUDWELASASIH_WEB

E-Transit adalah aplikasi PHP native + MySQL untuk monitoring dan manajemen ruang transit rumah sakit.

## Mengambil Proyek dari GitHub

Untuk pemasangan pertama di PC lain, jalankan dari `C:\xampp\htdocs`:

```powershell
git clone https://github.com/Geonama/RSUDWELASASIH_WEB.git project_web
cd project_web
```

Untuk memperbarui salinan yang sudah dipasang, jalankan dari folder proyek:

```powershell
git pull --ff-only origin main
```

Repository berisi kode, aset, skema, dan migrasi database. Database pasien,
log runtime, backup SQL, dan konfigurasi rahasia tidak disertakan. Siapkan
database serta konfigurasi lokal pada setiap PC server sesuai panduan di bawah.

## Menjalankan di XAMPP

1. Pastikan Apache dan MySQL XAMPP aktif.
2. Dari folder project, jalankan:

```bash
php database/setup.php
```

3. Buka:

```text
http://localhost/project_web/
```

## Akun awal

- Admin: `admin` / `Admin@123`
- Perawat IGD: `igd` / `Igd@1234`
- Perawat Transit: `transit` / `Transit@123`

## Tema Terang dan Gelap

Toggle matahari/bulan tersedia pada header semua halaman Admin, Perawat
IGD, dan Perawat Transit, serta halaman login/register. Pilihan tersimpan
di browser dan disinkronkan antar-tab. Jika belum memilih tema, aplikasi
mengikuti pengaturan tema sistem. Tema diterapkan sebelum halaman tampil
untuk menghindari kilatan warna terang. Pengaturan tema tidak memerlukan
migrasi database.

## Animasi Sidebar

Menu Admin, Perawat IGD, dan Perawat Transit memiliki efek kilau saat
diklik, gerakan ikon, serta penanda menu aktif yang bergeser. Efek ringan
berlangsung 140-240 ms hanya pada elemen sidebar, mengikuti kedua tema.
Klik langsung membuka halaman; konten dan formulir tetap stabil serta
dapat digunakan selama efek sidebar berjalan. Navigasi mendukung
keyboard/tab baru dan preferensi pengurangan gerakan pada perangkat.

## Denah Bed di Dashboard

Dashboard ketiga role menampilkan denah kecil dengan susunan seperti
bioskop dan ikon kasur. Nama kelompok kamar mengikuti Ruang Transit: 1A-1F,
2A-2F, 4A-4C, 5A-5B, dan Isolasi. Bed kosong berwarna hijau, terisi
merah, siap transfer biru, dan nonaktif abu-abu. Kode bed serta legenda
status tetap tersedia pada tema terang/gelap dan layar ponsel.
Denah mengikuti pembaruan status otomatis setiap 15 detik tanpa reload.

## Edit Rencana Transfer

Pada halaman Sistem Transfer, klik **Edit** pada baris pasien untuk mengubah
Dokter DPJP dan Rencana Ruangan, lalu klik **Simpan Perubahan**. Pilihan dokter
diambil dari master dokter aktif di database. Pilihan ruangan tersedia sebagai
**Hasan**, **Husen**, **Said**, dan **IGD**; tiga ruangan rawat tetap disimpan
dengan nama lengkap yang sudah digunakan aplikasi.

Edit ini tersedia untuk Admin dan Perawat Transit selama pasien masih transit
atau siap transfer. Penyimpanan hanya memperbarui dokter dan rencana ruangan
beserta metadata/audit perubahan. Tidak diperlukan migrasi database.

## Pengamanan Aplikasi

Login dibatasi setelah 5 kegagalan untuk akun dan alamat IP yang sama dalam
5 menit. Username dan email akun berbagi penghitung; mengganti cookie browser
tidak menghapus batas. Batas keseluruhan adalah 100 kegagalan per IP dalam
5 menit. Nilainya dapat diatur di `config/app.php`. Penghitung memakai file
terkunci di direktori sementara sistem, di luar direktori web.

Sesi memakai cookie HttpOnly/SameSite dan dibatasi ke direktori aplikasi.
Sesi lama dibatalkan setelah password atau role berubah. Pengguna yang masih
memakai sesi sebelum pembaruan keamanan perlu login kembali. Password baru
dibatasi 8-72 karakter sesuai algoritma bcrypt yang digunakan.

Pendaftaran perawat tetap langsung aktif. Untuk jaringan rumah sakit,
batasi akses ke komputer/perangkat staf yang diizinkan. Sebelum memakai data
pasien asli, ganti password akun demo, gunakan user database khusus dengan
password dan hak minimum, serta HTTPS dengan sertifikat yang berlaku dan
dipercaya perangkat staf. Versi PHP, Apache, dan MariaDB juga perlu diperbarui.

Hasil pemeriksaan dan batas cakupannya tersedia dalam
`tests/SECURITY-AUDIT-2026-10-09.md`.

## Konfigurasi database

Default database: `e_transit`, user `root`, password kosong. Jika berbeda, set environment variable:

```text
DB_HOST
DB_PORT
DB_DATABASE
DB_USERNAME
DB_PASSWORD
```

## Memperbarui Database Yang Sudah Ada

Untuk menambahkan kolom baru tanpa reset atau mengisi ulang data awal:

```powershell
C:\xampp\php\php.exe database/migrate.php
```

Migrasi dapat dijalankan berulang tanpa membuat kolom duplikat. Data pasien
lama tetap dipertahankan; kolom administrasi baru boleh kosong jika belum
tersedia. Form baru menyimpan identitas, agama, penanggung pasien, kelas,
penanggung jawab, hubungan, nomor HP, dan pendidikan ke tabel `patients`.

## Menyesuaikan Daftar Bed

Daftar awal berisi 19 bed: `1A` sampai `1F`, `2A` sampai `2F`,
`4A` sampai `4C`, `5A` dan `5B`, serta `Iso A` dan `Iso B`.
Pengelompokan di `config/app.php` digunakan oleh Ruang Transit dan
Monitor IGD, termasuk ringkasan status tiap kelompok saat polling.

Untuk database yang sudah berjalan, buat backup lalu periksa rencana:

```powershell
C:\xampp\php\php.exe database/update_beds.php --dry-run
```

Terapkan hanya setelah rencana sesuai:

```powershell
C:\xampp\php\php.exe database/update_beds.php --apply
```

Bed yang kodenya sudah sesuai tidak diubah. Bed lama dipakai ulang dengan
ID dan status yang sama; hanya bed kosong/nonaktif tanpa relasi pasien
atau transfer yang boleh dihapus. Jika daftar tidak dapat disesuaikan
tanpa menghilangkan relasi pasien, seluruh transaksi dibatalkan.
Skrip ini tidak dijalankan otomatis oleh migrasi kolom database.
