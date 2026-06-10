# Harga Emas Budi — ANTAM 100 gr

Web app kecil untuk melihat harga emas ANTAM 100 gram: beli, buyback/jual, dan grafik history bulanan.

## Cara deploy ke Vercel

1. Buka https://vercel.com dan login.
2. Klik **Add New Project**.
3. Upload/import folder project ini dari GitHub, atau pakai Vercel CLI.
4. Deploy.
5. Setelah jadi, buka URL Vercel dari iPhone/Safari.
6. Di Safari, pilih **Share > Add to Home Screen** supaya terasa seperti app.

## Sumber data

- Harga hari ini resmi: Logam Mulia ANTAM (`logammulia.com`).
- History bulanan: `harga-emas.org/history-harga`, yang menampilkan harga Logam Mulia ANTAM 100 gr dan harga pembelian kembali per gram.

Catatan: scraping bisa gagal jika struktur halaman sumber berubah. App menyediakan tombol refresh dan pesan error jika sumber tidak bisa dibaca.
