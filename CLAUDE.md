# capsa — "Capsa Kung2"

Capsa susun 13 kartu di browser: main sendiri vs 3 AI, meja koin 5/10/20 per poin. Saudara dari games-mahjong0hk
("Mahjong Kung2"). Live di https://sylvaniaharco.com/games/capsa/. README menjelaskan aturan & keputusan aturan.

## Cara kerja dengan Teddy (pemilik)

- Bahasa: Indonesia santai, to the point. Campur Inggris boleh.
- Langsung eksekusi pakai asumsi terbaik; sebut asumsinya singkat. Tanya hanya kalau benar-benar krusial.
- Hasil dulu, penjelasan singkat. Jangan over-engineering; kalau sesuatu gak perlu, bilang.
- Kalau nemu masalah (bug, risiko keamanan, data janggal), langsung kasih tahu walau gak ditanya.
- Semua kerja masuk GitHub (repo ini), bukan file lepas.

## Stack

- HTML/JS/CSS murni (ES modules), tanpa framework, tanpa bundler, tanpa dependensi npm. Belum ada backend/akun.
- `npm run build` menyalin `index.html`, `manifest.webmanifest`, `css`, `src`, `avatars`, `icons` ke `dist/games/capsa/`, lalu mengisi
  `sw.js` (daftar precache + versi dari hash isi) dan `version.json`. File/folder statis baru → daftarkan di `scripts/build.mjs`.
- Deploy otomatis oleh Cloudflare dari branch `main` (Worker `capsa`, assets saja; build `npm run build`, deploy `npx wrangler deploy`).
  **Merge/push ke `main` = langsung live.** Kerjakan di branch, lalu buat PR; CI (`.github/workflows/test.yml`) harus hijau sebelum merge.
  `name` di `wrangler.jsonc` harus tetap sama dengan nama Worker di Cloudflare (`capsa`).
- **Izin tetap dari Teddy (15 Nov 2026): setelah selesai, langsung buat PR dan merge ke `main` tanpa tanya dulu** (squash). Syaratnya:
  `npm test` lolos dan CI PR hijau (tunggu dulu; jangan merge kalau merah). Setelah merge, kabari Teddy singkat (nomor PR + apa yang
  berubah). Berlaku di sesi berikutnya juga. Kalau branch kerja sudah pernah di-squash-merge, mulai lagi dari `origin/main`.

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
- Bot = karakter & nama yang sama dengan Mahjong Kung2: `src/engine/roster.js` + `avatars/1..12.webp` adalah salinan dari
  games-mahjong0hk (kalau di sana berubah, salin lagi). Avatar pemain ikut pilihan di Mahjong (`hkmj-settings-v1` di localStorage, satu domain).
- Ronde yang sedang disusun disimpan di HP (`ROUND_KEY`, `saveRound`/`loadRound` di `src/main.js`): seed kartu, lawan, batas waktu,
  susunan terakhir. Saat boot ronde itu dilanjutkan; kalau waktunya sudah habis langsung diselesaikan. Jadi hasil ronde harus bisa
  dihitung ulang dari seed: keputusan bot jangan memakai `Math.random()` (pakai `mulberry32(R.seed + …)`).
- Cara main singkat (`showTutorial`) muncul sekali sebelum meja pertama (`TUT_KEY`).
- Teks UI bahasa Indonesia. Ikon lambang kartu pakai SVG `<symbol>` di `index.html` (bukan karakter ♠♥, yang di Android bisa jadi emoji).

## PWA

- `manifest.webmanifest`: **jangan** pakai `"orientation": "landscape"` atau `display: fullscreen` (di HP ColorOS app terpasang jadi tidak mau
  terbuka — pengalaman di Mahjong), dan jangan ganti `id` (ganti `id` = app baru bagi Chrome).
- `sw.js`: jaringan dulu, cache cadangan; `api/` tidak pernah dicache. Di lobi, game mengecek `version.json` saat tab aktif lagi dan memuat
  ulang kalau versinya beda (`checkUpdate` di `src/main.js`) — jangan lakukan itu saat ada ronde berjalan.
- Ikon: sumbernya `icons/icon.svg`; PNG dibuat `node scripts/icons.cjs` (butuh Playwright, hanya kalau desain berubah) dan ikut di-commit.

## UI yang perlu diingat

- Ukuran kartu dihitung dari `--vw`/`--vh` yang diisi JS dari ukuran `#app` (`fit()` di `src/main.js`); kelas `.portrait` ditambahkan kalau
  layar tegak. Cek tampilan di HP landscape (915×412) dan portrait (412×915) sebelum merge.
- Elemen yang dianimasikan dengan `transform` jangan diposisikan pakai `transform: translate(-50%, …)` (animasi menimpanya) — pakai wadah grid/flex.
- Tombol Keluar (`.tb-top`) harus tetap di atas layar susun (`z-index`), supaya pemain bisa keluar saat menyusun.
