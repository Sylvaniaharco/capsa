# capsa — "Capsa Kung2"

Capsa susun 13 kartu di browser: main sendiri vs 3 AI, online bareng teman (tanpa koin), atau Ranked online (koin akun, meja 5/10/20).
Plus **Capsa 6 kartu** (susun 1-2-3, 3–8 pemain, hanya lawan AI). Saudara dari games-mahjong0hk
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
  satu per meja online, SQLite bawaan) dan `CapsaLobby` (`worker/lobby.js`, satu global: pencari meja Ranked).
  Akun & koin ada di Worker Mahjong; Ranked memanggilnya lewat service binding `MAHJONG` → entrypoint `CapsaGate` (lihat "Aturan kode").
  Deploy Capsa gagal kalau Worker Mahjong belum punya `CapsaGate`: perubahan di kedua repo → merge Mahjong dulu, tunggu deploy-nya, baru Capsa.
  Migrasi DO ada di `wrangler.jsonc`: tambah class DO baru = tambah tag migrasi baru, jangan ubah yang lama.
- `npm run build` menyalin `index.html`, `manifest.webmanifest`, `css`, `src`, `avatars`, `icons` ke `dist/games/capsa/`, lalu mengisi
  `sw.js` (daftar precache + versi dari hash isi) dan `version.json`. File/folder statis baru → daftarkan di `scripts/build.mjs`.
- **Halaman depan semua game** `sylvaniaharco.com/games/` (keputusan Teddy, 17 Nov 2026) juga ada di repo ini: `hub/index.html`
  (satu file, CSS/JS di dalamnya) → `dist/games/index.html`, route `sylvaniaharco.com/games` + `/games/` di `wrangler.jsonc`.
  Route hanya dua alamat itu, jadi file lain di `dist/games/` (selain `capsa/`) tidak tersaji. Daftar game = array `GAMES` di file itu
  (status `live`/`new`/`soon`); gambar diambil dari folder tiap game (`/games/mahjonghk/icons`, `/games/domracer/icons`, ...).
  Game yang Worker-nya baru (mis. Capsa Banting) diberi `probe` (`version.json` game itu): kartu tampil "segera hadir" sampai file itu bisa
  diambil, jadi hub tidak pernah menautkan halaman 404.
  Akun: baca `/games/mahjonghk/api/me`, login `?next=games` (kunci `games` di `NEXT` repo Mahjong). DOM Racer = repo games-kart-racer.
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
npm run sim:six          # simulasi Capsa 6 kartu per jumlah pemain 3–8
npm run calibrate        # bikin ulang src/engine/strength-data.js (±4 menit)
npm run dev              # static server :8080 (tanpa meja online & akun)
npm run dev:online       # build + wrangler dev :8787 (meja teman jalan; buka /games/capsa/). Ranked butuh Worker Mahjong juga jalan
                         # (wrangler dev di repo games-mahjong0hk, DEV_LOGIN=1) + proxy satu origin untuk kedua port.
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
- Ada **dua saldo**: koin akun (server, dipakai bersama Mahjong, bergerak hanya di Ranked) dan koin meja lawan AI
  (`src/engine/wallet.js`, di `localStorage`, tidak bisa dipercaya). Koin akun **tidak boleh** berubah dari permainan lawan AI atau dari
  apa pun yang dihitung di HP.
- **Ranked** (koin akun, meja 5/10/20, saldo minimal sama dengan Mahjong): klien minta tiket sekali pakai ke server akun
  (`fetchTicket` → `POST /games/mahjonghk/api/auth/ticket`), lalu `POST /api/ranked/join {ticket, stake}`; Worker menukar tiket lewat
  `env.MAHJONG.redeem()` (id akun & saldo dari server akun), `CapsaLobby.assign` menaruhnya di meja yang masih bisa dimasuki atau membuat
  meja baru, dan membalas kode meja + **kunci kursi** (`seat.id`). Satu akun satu meja Ranked. Logikanya di `src/engine/room.js` bagian
  "Ranked" (`reserve`, `rankedDue`, `startRanked`, `nextRanked`, `settlePayload`, `applySettle`): tanpa host, mulai 8 dtk setelah pemain
  pertama, ronde berikutnya otomatis, pemain baru saat ronde jalan menunggu lalu menggantikan bot, tidak menyusun 2 ronde = dikeluarkan,
  koin kurang = dilepas. Tiap ronde koin diselesaikan di server akun (`env.MAHJONG.settle`, aman diulang; gagal → dicoba lagi lewat
  alarm, ronde berikutnya menunggu). `seat.userId` dan saldo lawan **tidak pernah** masuk `viewFor`. Belum ada rating/leaderboard/bonus,
  dan belum ada anti-kolusi (sengaja: pemain masih sedikit; buang koin ke teman di capsa mahal karena kalah ke semua lawan).
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
  dari kartu yang dibuka server. Meja terakhir disimpan di `capsa-room` sebagai `{code, id, ranked}` (id = id HP untuk meja teman,
  kunci kursi untuk Ranked; masuk lagi saat boot); link meja teman: `#room=KODE`. Pemain putus yang tidak kembali tidak menahan meja
  60 dtk: kalau semua yang tersambung sudah menyusun, ronde ditutup `OFFLINE_MS` kemudian (`worker/room.js`).
- Hasil ronde dihitung & disimpan (`settle` di `src/main.js`) sebelum animasi buka kartu, supaya menutup halaman tidak membatalkan ronde.
- Bot = karakter & nama yang sama dengan Mahjong Kung2: `src/engine/roster.js` + `avatars/1..12.webp` adalah salinan dari
  games-mahjong0hk (kalau di sana berubah, salin lagi). Avatar pemain ikut pilihan di Mahjong (`hkmj-settings-v1` di localStorage, satu domain).
- Ronde yang sedang disusun disimpan di HP (`ROUND_KEY`, `saveRound`/`loadRound` di `src/main.js`): seed kartu, lawan, batas waktu,
  susunan terakhir. Saat boot ronde itu dilanjutkan; kalau waktunya sudah habis langsung diselesaikan. Jadi hasil ronde harus bisa
  dihitung ulang dari seed: keputusan bot jangan memakai `Math.random()` (pakai `mulberry32(R.seed + …)`).
- Cara main singkat (`showTutorial`) muncul sekali sebelum meja pertama (`TUT_KEY`); Capsa 6 kartu punya sendiri (`showTutorial6`, `TUT6_KEY`).
- **Capsa 6 kartu** (keputusan Teddy, 16 Nov 2026): engine di `src/engine/six.js`, angka aturan di `SIX`/`SIX_CAT` (`rules.js`), tes
  `test/six.test.js`. Susun 1-2-3, dek dari As ke bawah `ceil(6n/4)` nilai, flush > straight, As selalu tertinggi (tidak ada straight As-kecil), lambang penentu kalau nilai sama (tidak ada
  seri), bonus tengah pair As +1, bawah tris +3 / SF +5 / royal +7, tembus keliling hanya ≤4 pemain, tanpa kartu spesial.
  `scoreRound(players, sixRules(n))` — `scoreRound` menerima aturan (default `CAPSA13`). Tabel AI (`sixStrength`) dibuat saat jalan,
  bukan lewat `calibrate`. Di `src/main.js` semua bagian meja memakai `G.v` (jenis permainan: `V13` atau `sixVariant(n)`), jumlah kursi
  = `G.seats.length`; kursi dibuat `buildSeats()` (bukan di HTML). Ranked 6 kartu ada (di bawah); belum ada meja bareng teman untuk 6 kartu.
  Lobi: pilih mode dulu (`#modePick`, 13 / 6 kartu, diingat di `settings.mode`); `#m13` = Ranked + lawan AI + bareng teman, `#m6` = jumlah pemain + meja.
- **Ranked 6 kartu** (keputusan Teddy, 16 Nov 2026): meja Ranked yang sama, `room.six` = jumlah pemain (3–8) = jumlah kursi (0 = 13 kartu, 4 kursi);
  `createRanked(code, stake, now, six)`. `dealRound`/`submit`/`autoArrange`/`finishRound` di `src/engine/room.js` bercabang di `room.six`
  (six.js; tanpa kartu spesial, waktu `SIX.seconds`). **Maksimal 4 pemain asli per meja** (`maxHumans`) karena `cleanSettle` di Mahjong
  menolak >4 pemain — jangan naikkan tanpa mengubah repo Mahjong dulu. `/ranked/join` menerima `six` (0 atau 3–8); `CapsaLobby.assign(stake, user, six)`
  memakai antrean per jenis meja (`six8:5`, dst). Klien: `O.n` = jumlah kursi (`toSeat`), `G.v` = `sixVariant(v.six)` untuk meja online,
  `view.six` dari server. Lobi: `#lbRanked6` di `#m6` (ikut `settings.sixN`).
- **Level bot** (16 Nov 2026): `src/engine/bot.js` (`botPick`, `LEVELS` Mudah/Sedang/Sulit, tes `test/bot.test.js`). Bot mengambil dari 3 susunan
  terbaik `solve()`/`solveSix()` atau susunan sederhana (`quick`). Sulit = perilaku lama (terbaik, kadang kedua). Solo: tombol `#btnLevel`
  di lobi (`settings.level`, default Sedang), acak dari `mulberry32(R.seed + kursi*7919)` supaya ronde lanjutan sama. Bot di server (Ranked)
  selalu `DEFAULT_LEVEL`; pemain yang keluar / habis waktu tetap disusun sebaik mungkin (`autoArrange` hanya melemahkan `seat.bot`).
  Hasil simulasi (2000 ronde, poin/ronde pemain "bawah sekuat mungkin" vs 3 bot): Mudah −2,0, Sedang −3,0, Sulit −5,0.
- Teks UI bahasa Indonesia. Ikon lambang kartu pakai SVG `<symbol>` di `index.html` (bukan karakter ♠♥, yang di Android bisa jadi emoji).

- **Musik latar** = salinan `src/ui/music.js` repo games-mahjong0hk (generatif Web Audio, tanpa file), setelan nyala/mati di localStorage `mjhk-music`
  (sama dengan Mahjong, jadi berlaku di semua game). `initMusic([tombol...], { label })`: tombol `data-music="label"` = tulisan di lobi, lainnya ikon 🎵/🔇.
  Kalau musik Mahjong berubah, salin lagi (bagian suara jangan diubah sendiri).

## PWA

- `manifest.webmanifest`: **jangan** pakai `"orientation": "landscape"` atau `display: fullscreen` (di HP ColorOS app terpasang jadi tidak mau
  terbuka — pengalaman di Mahjong), dan jangan ganti `id` (ganti `id` = app baru bagi Chrome).
- `sw.js`: jaringan dulu, cache cadangan; `api/` tidak pernah dicache. Di lobi, game mengecek `version.json` saat tab aktif lagi dan memuat
  ulang kalau versinya beda (`checkUpdate` di `src/main.js`) — jangan lakukan itu saat ada ronde berjalan.
- Ikon: sumbernya `icons/icon.svg` (susunan 6 kartu 1-2-3: A♥ / A♣ A♦ / A♠ K♠ Q♠ + tulisan emas CAPSA / SUSUN KUNG2 gaya logo Mahjong Kung2,
  keputusan Teddy 17 Nov 2026, tulisan jadi "Susun Kung2" 19 Nov); PNG dibuat `node scripts/icons.cjs` (butuh Playwright + akses Google Fonts untuk font Cinzel, hanya kalau
  desain berubah) dan ikut di-commit. Emblem lobi (`renderEmblem`) dan judul emas `.lb-brand h1` meniru logo ini.

## UI yang perlu diingat

- Ukuran kartu dihitung dari `--vw`/`--vh` yang diisi JS dari ukuran `#app` (`fit()` di `src/main.js`); kelas `.portrait` ditambahkan kalau
  layar tegak. Meja 6 kartu (`#table.six`, kursi `.seat.sx`): posisi lawan di `--lx/--ly` (landscape) dan `--px/--py` (portrait) dari
  `buildSeats()`; cek dengan 8 pemain. Cek tampilan di HP landscape (915×412) dan portrait (412×915) sebelum merge.
- Elemen yang dianimasikan dengan `transform` jangan diposisikan pakai `transform: translate(-50%, …)` (animasi menimpanya) — pakai wadah grid/flex.
- Tombol Keluar (`.tb-top`) harus tetap di atas layar susun (`z-index`), supaya pemain bisa keluar saat menyusun.
- Tembus keliling = layar "Hu besar" (`bigWin()` di `src/main.js`, CSS `.bigwin`, suara `sweep` di `src/ui/sfx.js`, getar kalau pemain sendiri);
  dipakai semua mode (13/6 kartu, online). Cari seed untuk ngetes: mode 6 kartu 3 pemain `?seed=6` + Saran 1 = kamu tembus keliling.
- Baris yang dapat bonus bersinar emas (`.shine` di `.hrow` meja & `.arow` layar susun; `shines()` di `src/main.js` = `G.v.bonus > 0`).
