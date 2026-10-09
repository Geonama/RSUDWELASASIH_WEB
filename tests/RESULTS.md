# Hasil Pengujian Fitur

Tanggal: 8 Oktober 2026.
Hasil akhir setelah pengelompokan Ruang Transit dan penambahan isolasi: **82 dari 82 kelompok pengujian lolos**.

Lingkungan: PHP 8.2/XAMPP, MySQL lokal, Chrome headless melalui Playwright.
Seluruh perubahan data diuji pada database sementara `e_transit_qa_*`.
Dua server PHP digunakan untuk skenario transaksi bersamaan. Database uji
dan server sementara dibersihkan setelah selesai; fingerprint data inti
aplikasi tetap sama.

## Cakupan

- Login username/email, register kedua role perawat, password hashing,
  validasi register, password eye controls, dan logout.
- Semua menu Admin, Perawat IGD, dan Perawat Transit; akses privat,
  permission backend, POST palsu dari IGD, dan CSRF.
- Tambah/edit/nonaktifkan/hapus dokter dan rekomendasi berdasarkan keyword.
- Spesialis Dermatologi/Venereologi tersedia di dropdown, tersimpan pada
  dokter, dan tidak digandakan saat migrasi dijalankan ulang.
- Tambah/aktifkan/nonaktifkan bed, penolakan bed terisi, dan nomor bed duplikat.
- Daftar awal tepat 19 kode: 1A-1F, 2A-2F, 4A-4C, 5A-5B, Iso A, Iso B;
  kode tampil sesuai kelompok di Ruang Transit, Monitor IGD, dan API bed.
- Kelompok memiliki ringkasan status dan dapat dilipat lewat mouse/keyboard.
  Status lipatan serta fokus judul tetap dipertahankan saat polling;
  bed tambahan di luar kelompok tetap terlihat pada Bed Lainnya.
  Layout diuji pada lebar 1440px, 1024px, 390px, dan 320px untuk semua role.
- Iso A/B diuji untuk detail pasien, Set Siap, transfer, histori bed yang
  benar, pelepasan bed, serta ringkasan status kelompok isolasi.
- Skrip penyesuaian bed diuji untuk pratinjau tanpa perubahan, pemakaian
  ulang ID bed aktif/siap transfer/berhistori, penghapusan bed tanpa
  relasi, penambahan kode yang kurang, idempotensi, dan rollback jika
  ada bed berelasi yang tidak dapat dipetakan ke daftar baru.
- Tambah/detail/edit/soft delete pasien, alokasi bed, vital sign,
  sapaan otomatis, validasi tanggal/nomor RM, dan audit perubahan waktu.
- FIFO, filter gabungan, status siap transfer, transfer tunggal/multiple,
  konfirmasi batal/setuju, rollback batch tidak valid, dan pelepasan bed.
- Tombol Set Siap tampil konsisten untuk Admin/Perawat Transit sebelum
  dan sesudah polling bed; klik tombol tetap mengubah status pasien/bed
  menjadi siap transfer dan terbaca oleh Monitor IGD.
- Polling Monitor IGD serta ringkasan, komposisi bed, durasi, dan jam dashboard.
- Teks kriteria status kesadaran, parameter vital sign, dan eksklusi sama
  pada dashboard Admin, Perawat IGD, dan Perawat Transit; simbol >/< tampil
  utuh dan teks tidak terpotong pada lebar 1440px, 390px, dan 320px.
- Kop dashboard ketiga role memuat logo Jawa Barat/RSUD, nama instansi,
  alamat, telepon, fax, serta tautan telepon/email sesuai referensi.
  Posisi logo dan teks diuji tanpa tumpang tindih pada lebar 1440px,
  1024px, 390px, dan 320px; kop hanya tampil pada halaman dashboard.
- Rekap harian/bulanan/tahunan dan XLSX sesuai filter dengan 25 kolom.
- Identitas KTP/SIM/NIP, agama, penanggung pasien, kelas perawatan,
  penanggung jawab, hubungan, nomor HP, dan pendidikan tersimpan, dapat
  diedit ulang, tampil di detail, dan ikut diekspor.
- Pilihan ruangan/kesadaran baru divalidasi; nilai lama tetap bisa
  dipertahankan saat mengedit pasien lama.
- Pilihan agama/pembiayaan/kelas, format nomor HP/identitas, kolom opsional,
  tombol simpan bawah, dan peringatan DPJP belum tersedia.
- BPJS PBI APBD/APBN diuji melalui tambah/edit pasien, detail, dan XLSX.
- BPJS PBI umum tidak dapat dipilih atau ditetapkan ke pasien baru/lain.
  Nilai lama tetap tersimpan saat kolom lain diedit, serta dapat diganti
  ke APBD/APBN atau dikosongkan secara sengaja.
- Migrasi kolom pasien idempotent, mempertahankan data lama, serta layout
  pendaftaran diuji pada lebar 1440px, 390px, dan 320px.
- Pendaftaran bersamaan dan pengulangan transfer bersamaan.
- Pembuatan user, penonaktifan/aktivasi, ganti password, timeout sesi,
  histori transfer, audit log, XSS, dan input SQL-injection pada pencarian/login.
- Halaman semua role pada layar ponsel, tabel geser, dan menu mobile.

## Perbaikan

- Tanggal kalender tidak valid dan waktu kedatangan di masa depan ditolak.
- Pesan validasi pasien jelas, nilai form dipertahankan, dan error SQL tidak
  ditampilkan kepada pengguna.
- DPJP lama yang nonaktif tetap bisa dipertahankan saat mengedit pasien aktif.
- Histori pasien transfer tidak dapat diedit/dihapus melalui POST langsung.
- Sesi akun nonaktif dibatalkan; logout dan timeout mempertahankan notifikasi.
- POST awal tanpa token CSRF ditolak dan halaman tidak ditemukan mengirim 404.
- Ringkasan dan komposisi bed dashboard diperbarui otomatis setiap 15 detik.
- Migrasi `20261007_patient_registration.php` sudah diterapkan ke database
  aplikasi. Backup SQL dibuat sebelum migrasi; jumlah dan hash field lama
  pasien sama sebelum/sesudah migrasi. Tidak dilakukan setup/reset data.

## Catatan

Pada pemeriksaan 7 Oktober 2026, database aplikasi memiliki 16 bed kosong dan **0 dokter
DPJP aktif**. Pendaftaran pasien membutuhkan dokter aktif dari Data Dokter.
Tidak ada dokter/pasien contoh yang ditambahkan ke database aplikasi.

Penyesuaian 8 Oktober 2026 sudah diterapkan melalui `database/update_beds.php`
setelah backup SQL dibuat. Database utama sekarang memiliki tepat 19 bed:
18 kosong dan 1 terisi. Bed 1A tetap memakai ID serta pasien yang sama.
Iso A/B ditambahkan sebagai bed baru; seluruh 17 bed sebelumnya, termasuk
5A/5B, memiliki ID, status, pasien, dan timestamp yang tidak berubah.
Fingerprint tabel pasien, vital sign, transfer, dokter, spesialisasi,
user, dan role sama sebelum/sesudah penyesuaian. Tidak dilakukan setup
ulang atau reset data pasien.

Pengujian ini bukan uji beban berskala besar atau audit keamanan menyeluruh.
