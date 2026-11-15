# capsa — "Capsa Kung2"

Capsa susun 13 kartu di browser: main sendiri vs 3 AI (meja koin 5/10/20 per poin) atau online bareng teman (tanpa koin). Saudara dari games-mahjong0hk
("Mahjong Kung2"). Live di https://sylvaniaharco.com/games/capsa/. README menjelaskan aturan & keputusan aturan.

## Cara kerja dengan Teddy (pemilik)

- Bahasa: Indonesia santai, to the point. Campur Inggris boleh.
- Langsung eksekusi pakai asumsi terbaik; sebut asumsinya singkat. Tanya hanya kalau benar-benar krusial.
- Hasil dulu, penjelasan singkat. Jangan over-engineering; kalau sesuatu gak perlu, bilang.
- Kalau nemu masalah (bug, risiko keamanan, data janggal), langsung kasih tahu walau gak ditanya.
- Semua kerja masuk GitHub (repo ini), bukan file lepas.

## Stack

- Frontend: HTML/JS/CSS murni (ES modules), tanpa framework, tanpa bundler, tanpa dependensi npm.
- Backend: Cloudflare Worker `capsa` (`worker/index.js`, API di `/games/capsa/api/*`) + Durable Object `CapsaRoom` (`worker/room.js`,
  satu per meja online, SQLite bawaan). Akun & koin memakai server Mahjong (lihat "Aturan kode").
  Migrasi DO ada di `wrangler.jsonc`: tambah class DO baru = tambah tag migrasi baru, jangan ubah yang lama.
- `npm run build` menyalin `index.html`, `manifest.webmanifest`, `css`, `src`, `avatars`, `icons` ke `dist/games/capsa/`, lalu mengisi
  `sw.js` (daftar precache + versi dari hash isi) dan `version.json`. File/folder statis baru → daftarkan di `scripts/build.mjs`.
- Deploy otomatis oleh Cloudflare dari branch `main` (Worker `capsa`; build `npm run build`, deploy `npx wrangler deploy`).
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
npm run dev              # static server :8080 (tanpa meja online & akun)
npm run dev:online       # build + wrangler dev :8787 (meja online jalan; buka /games/capsa/)
```

Jalankan `npm test` sebelum commit yang menyentuh `src/engine/` atau `worker/`.

## Aturan kode

- `src/engine/` murni (tanpa DOM), dipakai browser & Node. Jangan pakai `Math.random()` di engine; pakai RNG berseed (`mulberry32`).
- Semua angka aturan (bonus, pengali tembus, poin kartu spesial, waktu susun) ada di `src/engine/rules.js`.
  Ubah aturan → update README + tes (`test/scoring.test.js`, `test/special.test.js`), lalu `npm run calibrate`
  karena AI menaksir nilai susunan dari bonus & pengali itu.
- `src/engine/strength-data.js` dibuat otomatis; jangan diedit tangan.
- **Akun & koin jadi satu dengan Mahjong Kung2** (keputusan Teddy, 15 Nov 2026). `src/ui/account.js` memanggil API Mahjong dari origin
  yang sama: `GET /games/mahjonghk/api/me` (nama + saldo koin akun), `/config`, `POST /auth/logout`, `POST /errors` (mode `capsa`, masuk
  dashboard admin Mahjong). Login: `/games/mahjonghk/api/auth/google?next=capsa` → kembali ke `/games/capsa/?login=ok`. Tamu Mahjong
  dihitung belum masuk. Fitur ini hanya aktif kalau game dibuka dari `/games/capsa/`; di tempat lain state-nya `off` dan game jalan biasa.
  Kontrak API-nya ada di repo games-mahjong0hk (`worker/index.js`, `worker/next.js`) — perubahan di sana bisa merusak sini.
- Ada **dua saldo** untuk sementara: koin akun (server, dipakai bersama Mahjong, di Capsa baru ditampilkan) dan koin meja lawan AI
  (`src/engine/wallet.js`, di `localStorage`, tidak bisa dipercaya). Koin akun **tidak boleh** berubah dari permainan lawan AI atau dari
  apa pun yang dihitung di HP. Rencana: meja online/Ranked memakai koin akun dan dihitung di server; setelah itu meja koin lawan AI
  jadi latihan saja.
- **Meja online bareng teman** (tanpa koin, hanya poin): logika mejanya murni di `src/engine/room.js` (dites di `test/room.test.js`),
  `worker/room.js` hanya penyimpanan + WebSocket + alarm. Server yang membagi kartu; klien hanya menerima `viewFor(room, seat)` —
  **jangan pernah** mengirim kartu/susunan lawan sebelum ronde dibuka, dan jangan mengirim id pemain. Kiriman pemain divalidasi server
  (`submit`: kartunya harus persis kartu yang dibagikan dan susunannya sah). Pemain dikenali dari id acak buatan HP (`capsa-cid`) + nama,
  **bukan akun** — cukup karena tidak ada koin. Fitur yang memakai koin akun (Ranked) wajib memverifikasi akun lewat server Mahjong.
- Bot di meja online menyusun di server lewat alarm, satu bot per alarm (`solve()` berat). Percobaan pertama pakai `solve()`; kalau panggilan
  itu dihentikan batas CPU, alarm berikutnya memakai `quickArrange()` (murah, pasti sah) — tandanya `room.tried`. Waktu habis juga memakai
  `quickArrange()`. Jangan menaruh beberapa `solve()` dalam satu panggilan Worker.
- Klien online: `src/net/online.js` (API + `RoomSession` dengan sambung ulang), bagian "meja online" di `src/main.js`. Kursi server diputar
  supaya kursi sendiri selalu indeks 0 (`toSeat`). Layar hasil memakai `showdown()` yang sama dengan mode solo: poin dihitung ulang di klien
  dari kartu yang dibuka server. Kode meja terakhir disimpan di `capsa-room` (masuk lagi saat boot); link meja: `#room=KODE`.
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
