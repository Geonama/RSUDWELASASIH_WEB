# Hasil Pengujian Sidebar - 8 Oktober 2026

- **101 perpindahan sidebar lolos** dengan navigasi langsung, tanpa
  pembatalan klik untuk menunggu animasi atau snapshot seluruh halaman.
- Semua menu Admin, Perawat IGD, dan Perawat Transit diuji pada kedua tema
  di desktop 1440px dan ponsel 390px.
- Resize 320, 390, 820, 821, 1024, dan 1440px pada semua role: lolos.
  Konten tidak melebar keluar viewport; penanda aktif tetap tepat.
- Enam skenario CPU 6x lebih lambat (ketiga role, desktop/ponsel): lolos.
  Formulir dapat digunakan saat efek sidebar berjalan dan permintaan
  navigasi dimulai langsung. Telemetri klik disimpan di performance.json.
- Efek klik/ikon, Enter, Ctrl-click/tab baru, tombol kembali, klik beruntun,
  pengurangan gerakan, dan sessionStorage diblokir: lolos.
- Perpindahan dari login langsung masuk ke aplikasi tanpa snapshot halaman.
  Tidak ditemukan error JavaScript pada seluruh pengujian navigasi.
- Screenshot kedua tema dan ukuran layar diperiksa secara visual.
- **82/82 kelompok pengujian fitur utama lolos.**
- Database sementara dibersihkan; fingerprint data inti aplikasi sebelum
  dan sesudah kedua runner tetap sama.

Artefak navigasi: `C:\Users\ggmin\AppData\Local\Temp\etransit-navigation-rm0KxS`.
Artefak fitur: `C:\Users\ggmin\AppData\Local\Temp\etransit-functional-eQcbky`.
