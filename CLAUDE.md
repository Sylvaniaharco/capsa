# capsa — "Capsa Kung2"

Capsa susun 13 kartu di browser: main sendiri vs 3 AI, meja koin 5/10/20 per poin. Saudara dari games-mahjong0hk
("Mahjong Kung2"), rencananya di `sylvaniaharco.com/games/capsa/`. README menjelaskan aturan & keputusan aturan.

## Cara kerja dengan Teddy (pemilik)

- Bahasa: Indonesia santai, to the point. Campur Inggris boleh.
- Langsung eksekusi pakai asumsi terbaik; sebut asumsinya singkat. Tanya hanya kalau benar-benar krusial.
- Hasil dulu, penjelasan singkat. Jangan over-engineering; kalau sesuatu gak perlu, bilang.
- Kalau nemu masalah (bug, risiko keamanan, data janggal), langsung kasih tahu walau gak ditanya.
- Semua kerja masuk GitHub (repo ini), bukan file lepas.

## Stack

- HTML/JS/CSS murni (ES modules), tanpa framework, tanpa bundler, tanpa dependensi npm. Belum ada backend/akun.
- `npm run build` menyalin `index.html`, `css`, `src` ke `dist/games/capsa/`. File/folder statis baru → daftarkan di `scripts/build.mjs`.
- Belum di-deploy; `wrangler.jsonc` disiapkan (assets saja). Kalau nanti disambung ke Cloudflare dari `main`, merge ke `main` = live.

## Perintah

```bash
npm test                 # node --test test/*.test.js
npm run sim              # simulasi AI vs AI (zero-sum, sebaran poin)
npm run calibrate        # bikin ulang src/engine/strength-data.js (±4 menit)
npm run dev              # static server :8080
```

Jalankan `npm test` sebelum commit yang menyentuh `src/engine/`.

## Aturan kode

- `src/engine/` murni (tanpa DOM), dipakai browser & Node. Jangan pakai `Math.random()` di engine; pakai RNG berseed (`mulberry32`).
- Semua angka aturan (bonus, pengali tembus, poin kartu spesial, waktu susun) ada di `src/engine/rules.js`.
  Ubah aturan → update README + tes (`test/scoring.test.js`, `test/special.test.js`), lalu `npm run calibrate`
  karena AI menaksir nilai susunan dari bonus & pengali itu.
- `src/engine/strength-data.js` dibuat otomatis; jangan diedit tangan.
- Koin mengikuti Mahjong Kung2 (`src/engine/wallet.js`: STAKES, STAKE_MIN, reset 00.01 WIB). Sekarang disimpan di `localStorage`,
  jadi belum bisa dipercaya; kalau nanti ada akun/online, koin wajib dihitung di server.
- Hasil ronde dihitung & disimpan (`settle` di `src/main.js`) sebelum animasi buka kartu, supaya menutup halaman tidak membatalkan ronde.
- Teks UI bahasa Indonesia. Ikon lambang kartu pakai SVG `<symbol>` di `index.html` (bukan karakter ♠♥, yang di Android bisa jadi emoji).

## UI yang perlu diingat

- Ukuran kartu dihitung dari `--vw`/`--vh` yang diisi JS dari ukuran `#app` (`fit()` di `src/main.js`); kelas `.portrait` ditambahkan kalau
  layar tegak. Cek tampilan di HP landscape (915×412) dan portrait (412×915) sebelum merge.
- Elemen yang dianimasikan dengan `transform` jangan diposisikan pakai `transform: translate(-50%, …)` (animasi menimpanya) — pakai wadah grid/flex.
- Tombol Keluar (`.tb-top`) harus tetap di atas layar susun (`z-index`), supaya pemain bisa keluar saat menyusun.
