# Pengujian Denah Bed Dashboard — 8 Oktober 2026

Denah bed dengan ikon kasur dan susunan seperti bioskop tampil pada
Dashboard Admin, Perawat IGD, dan Perawat Transit. Kelompok kamar dan bed mengikuti data Ruang Transit,
termasuk Isolasi serta kelompok Bed Lainnya jika ada bed tambahan.

- 36 kombinasi role/tema/ukuran layar lolos: ketiga role, tema terang dan
  gelap, lebar 1440, 1280, 1024, 821, 390, dan 320px.
- Seluruh 19 kode bed dan kelompok kamar sesuai dengan API/database.
- Kosong hijau, terisi merah, siap transfer biru, nonaktif abu-abu.
  Kontras kode bed terhadap warna isi ikon memenuhi rasio minimal 4,5:1.
- Pembaruan status, jumlah ringkasan, penambahan bed/kelompok, dan
  penghapusan bed melalui polling lolos pada ketiga role.
- Data polling yang sama mempertahankan elemen denah yang sudah tampil.
- Screenshot desktop dan ponsel diperiksa secara visual.
- 82/82 kelompok pengujian fitur utama tetap lolos.
- 265 pemeriksaan tema/halaman/viewport dan 16.628 pemeriksaan kontras
  teks lolos, tanpa error JavaScript atau kegagalan resource.
- 56 pemeriksaan halaman/API langsung melalui Apache XAMPP lolos;
  dashboard semua role menampilkan status bed yang cocok dengan API.

Tidak ada perubahan skema database atau alur transaksi pasien/transfer.
Pengujian perubahan status menggunakan database sementara yang dibersihkan
sesudahnya. Fingerprint data inti aplikasi tetap sama sebelum dan sesudah
pengujian; login/logout pemeriksaan langsung hanya memperbarui metadata
login dan audit. Screenshot memakai data contoh, bukan pasien asli.

Artefak denah: `C:\Users\ggmin\AppData\Local\Temp\etransit-dashboard-map-RLCTVy`.
Artefak fitur: `C:\Users\ggmin\AppData\Local\Temp\etransit-functional-m7eDPm`.
Artefak tema: `C:\Users\ggmin\AppData\Local\Temp\etransit-theme-Oj9Zeo`.
Artefak Apache: `C:\Users\ggmin\AppData\Local\Temp\etransit-live-health-54uT7z`.

Pembaruan ikon kursi menjadi kasur diuji ulang: seluruh 36 kombinasi
role/tema/viewport, warna/kontras, dan pembaruan status tetap lolos.
Screenshot desktop dan ponsel diperiksa; sintaks PHP/JavaScript lolos.
Artefak ikon kasur: `C:\Users\ggmin\AppData\Local\Temp\etransit-dashboard-map-sxlC2W`.
