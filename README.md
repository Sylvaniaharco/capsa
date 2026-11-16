# Capsa Kung2

Capsa susun (13 kartu, 3 baris) di browser: kamu lawan 3 AI dengan meja koin 5 / 10 / 20 per poin, **online bareng teman**, atau Ranked.
Ada juga **Capsa 6 kartu** (susun 1-2-3, 3–8 pemain, lawan AI).
HTML/JS/CSS murni (ES modules), tanpa framework, tanpa bundler. Server: Cloudflare Worker + Durable Object. Jalan di HP (landscape & portrait) dan desktop.

## Aturan

Tiap pemain dapat 13 kartu dan menyusunnya jadi 3 baris: **Atas** 3 kartu, **Tengah** 5 kartu, **Bawah** 5 kartu.
Bawah harus paling kuat (atau sama), lalu Tengah, lalu Atas. Tiap baris diadu dengan baris yang sama milik tiap lawan.

| Kejadian | Poin |
| --- | --- |
| Menang satu baris | +1 (kalah −1, sama kuat 0) |
| **Tembus** — menang 3 baris dari satu lawan | poin lawan itu ×2 |
| **Tembus keliling** — tembus ke 3 lawan | ×2 lagi (jadi ×4) |
| Atas: Tris | bonus +3 |
| Tengah: Full House / Four of a Kind / Straight Flush / Royal Flush | bonus +3 / +5 / +7 / +11 |
| Bawah: Four of a Kind / Straight Flush / Royal Flush | bonus +5 / +7 / +11 |
| **All Straight** (ketiga baris straight) | langsung menang, +4 dari tiap lawan |
| **All Flush** (ketiga baris flush) | langsung menang, +3 dari tiap lawan |
| **6 Pair** | langsung menang, +3 dari tiap lawan |

Hal yang diputuskan saat membuat (ubah di `src/engine/rules.js` kalau maunya lain):

- Bonus baris dibayar **hanya kalau baris itu menang**, ditambahkan ke 1 poin menang baris (Tris atas menang = 1 + 3 = 4 poin).
  Pengali tembus ikut mengalikan bonus.
- All Straight / All Flush = **ketiga baris** straight / flush (3 + 5 + 5). Dragon 2–A termasuk All Straight.
- Kartu spesial tidak kena pengali tembus. Dua pemain sama-sama spesial: poin lebih besar menang, sama = seri.
- Pemain boleh memilih tidak memakai kartu spesial dan menyusun biasa. AI selalu memakainya.
- Urutan kombinasi poker biasa; As paling tinggi, A-2-3-4-5 straight paling kecil; lambang tidak dipakai (nilai sama = seri).
- Susunan salah (mis. Atas lebih kuat dari Tengah) tidak bisa dikirim; kalau waktu 60 detik habis, kartu disusun otomatis.

## Capsa 6 kartu (lawan AI, 3–8 pemain)

Di lobi pilih mode **6 Kartu** (tombol 13 Kartu / 6 Kartu di atas daftar meja), lalu jumlah pemain (3–8) dan mejanya (Latihan / 5 / 10 / 20, koin sama dengan meja lawan AI). Tiap pemain dapat **6 kartu**
dan menyusunnya jadi **Atas 1**, **Tengah 2**, **Bawah 3** (Bawah ≥ Tengah ≥ Atas). Waktu susun 30 detik.

Kartu diambil dari As ke bawah sebanyak `ceil(6 × pemain / 4)` nilai; sisanya tidak dibagi (tidak ketahuan):

| Pemain | Kartu dibagi | Dek | Sisa |
| --- | --- | --- | --- |
| 3 | 18 | A–10 (20) | 2 |
| 4 | 24 | A–9 (24) | 0 |
| 5 | 30 | A–7 (32) | 2 |
| 6 | 36 | A–6 (36) | 0 |
| 7 | 42 | A–4 (44) | 2 |
| 8 | 48 | A–3 (48) | 0 |

| Kejadian | Poin |
| --- | --- |
| Menang satu baris | +1 (kalah −1; tidak ada seri) |
| **Tembus** — menang 3 baris dari satu lawan | poin lawan itu ×2 |
| **Tembus keliling** — tembus ke semua lawan | ×2 lagi, **hanya meja 3–4 pemain** |
| Tengah: pair As | bonus +1 |
| Bawah: Tris / Straight Flush / Royal Flush | bonus +3 / +5 / +7 |

- Urutan kombinasi: Kartu Tinggi < Pair < Straight < **Flush** < Tris < Straight Flush < Royal (A-K-Q satu lambang).
  Flush di atas straight karena di dek pendek flush 3 kartu lebih jarang. Tengah hanya bisa Kartu Tinggi atau Pair; Atas hanya satu kartu.
- As selalu kartu tertinggi: straight hanya tiga nilai berurutan (A-K-Q tertinggi); As tidak bisa jadi kartu kecil (A-10-J bukan straight).
- Nilai sama → **lambang** kartu penentu (♠ > ♥ > ♣ > ♦), jadi tidak ada seri. Kombinasi dibandingkan dulu, lalu nilai kartu
  (termasuk kicker), baru lambang kartu tertinggi.
- Tidak ada kartu spesial. Bonus dibayar hanya kalau baris itu menang dan ikut dikali tembus.
- AI: semua 60 cara susun dicoba, dinilai dari peluang menang tiap baris (sebaran dibuat saat pertama main per jumlah pemain, berseed tetap).
- Ranked (koin akun) tersedia juga untuk 6 kartu, lihat bagian Ranked. Belum ada meja online bareng teman untuk 6 kartu.

## Level bot

Tombol **Bot: Sedang** di lobi mengganti kekuatan lawan AI: Mudah / Sedang / Sulit (diingat di HP). Sulit = bot selalu memilih susunan
terbaik; Sedang dan Mudah sering memilih susunan kedua/ketiga atau susunan sederhana ("bawah sekuat mungkin"), jadi bisa salah strategi.
Bot di meja Ranked memakai level Sedang. Pemain sederhana (bawah sekuat mungkin) rata-rata kalah 2,0 / 3,0 / 5,0 poin per ronde
melawan 3 bot Mudah / Sedang / Sulit.

## Main bareng teman (online)

Di lobi: **Buat meja** → bagikan kode 5 huruf (atau link `…/games/capsa/#room=KODE`) → teman **Gabung pakai kode** → pembuat meja
menekan **Mulai**. Kursi yang kosong diisi bot. Tanpa login dan **tanpa koin**: yang dihitung hanya poin, dijumlah selama di meja itu.

- Server yang membagi kartu dan menghitung poin; tiap pemain hanya menerima kartunya sendiri sampai ronde dibuka.
- Waktu menyusun 60 detik. Yang belum menyusun saat waktu habis disusunkan otomatis.
- Koneksi putus: game menyambung lagi sendiri; app ditutup lalu dibuka lagi → kembali ke meja yang sama.
- Keluar di tengah permainan: kursinya dimainkan otomatis. Meja tanpa pemain dihapus setelah 10 menit.

## Ranked (online, koin akun)

Butuh login Google. Pilih meja 5 / 10 / 20 koin per poin (saldo minimal 100 / 5.000 / 10.000, sama dengan Mahjong). Game mencarikan
meja: kalau ada meja yang masih bisa dimasuki kamu duduk di sana, kalau tidak dibuat meja baru. Permainan mulai 8 detik setelah pemain
pertama duduk; kursi kosong diisi bot, dan pemain yang datang belakangan menggantikan bot di ronde berikutnya.

- Tiap ronde: koin = poin bersih × taruhan, langsung diselesaikan di server akun (saldo yang sama dengan Mahjong, tidak bisa di bawah 0).
- Ronde berikutnya jalan sendiri. Keluar kapan saja; ronde yang sedang jalan tetap dihitung (kartu disusun otomatis).
- Tidak menyusun 2 ronde berturut-turut = dikeluarkan dari meja. Koin di bawah minimal meja = tidak bisa lanjut di meja itu.
- Satu akun hanya bisa duduk di satu meja Ranked.
- **Ranked 6 kartu**: di tab 6 Kartu pilih jumlah pemain (3–8) lalu meja 5 / 10 / 20. Aturan, saldo minimal, dan koin sama dengan Ranked 13 kartu;
  waktu menyusun 30 detik. Satu meja memuat **maksimal 4 pemain asli** (batas penyelesaian koin di server akun), kursi sisanya bot.
  Pemain dengan jumlah pemain berbeda tidak dipertemukan (antrean per jumlah pemain).
- Belum ada rating, leaderboard, atau bonus harian untuk Capsa.

## Akun dan koin

Akun jadi satu dengan Mahjong Kung2: tombol **Masuk dengan Google** di lobi memakai login Mahjong (satu domain), dan lobi menampilkan
nama serta **koin akun** yang sama dengan di Mahjong. Keluar dari akun di Capsa berarti keluar juga dari Mahjong di HP itu.

Untuk sementara ada dua saldo:

- **Koin akun** (di server, dipakai bersama Mahjong): dipakai di meja Ranked.
- **Koin meja lawan AI** (di HP, `localStorage`): mengikuti aturan Mahjong — saldo awal 1.000, meja 5 / 10 / 20 koin per poin, saldo
  minimal masuk 100 / 5.000 / 10.000, tidak bisa di bawah 0, dan kalau kurang dari 100 direset ke 1.000 jam 00.01 WIB hari berikutnya.
  Ada juga meja **Latihan** (tanpa koin).

Error JavaScript dari HP pemain dikirim ke dashboard admin Mahjong (bagian error, mode `capsa`).

## Main di lokal

```bash
npm run dev         # python3 -m http.server 8080, lalu buka http://localhost:8080 (tanpa meja online)
npm run dev:online  # build + wrangler dev, lalu buka http://localhost:8787/games/capsa/ (meja online jalan)
npm test       # node --test test/*.test.js
npm run sim    # 2000 ronde AI vs AI: cek zero-sum, sebaran poin, frekuensi tembus & kartu spesial
npm run sim:six  # sama untuk Capsa 6 kartu, per jumlah pemain 3–8
```

`?seed=123` di alamat membuat kartu ronde pertama bisa diulang (untuk mengecek bug).

Ronde yang sedang disusun tersimpan di HP: kalau app tertutup, saat dibuka lagi ronde yang sama dilanjutkan (kartu & lawan sama),
dan kalau waktunya sudah habis ronde langsung diselesaikan dengan susunan terakhir (atau otomatis kalau susunannya tidak sah).

## Deploy

Live di **https://sylvaniaharco.com/games/capsa/** lewat Worker `capsa` (file statis + API meja online di `/games/capsa/api/*`). Repo ini tersambung ke Cloudflare
(Workers & Pages → Import a repository): build `npm run build`, deploy `npx wrangler deploy`, production branch `main`.
**Merge/push ke `main` = langsung live.** Route `sylvaniaharco.com/games/capsa*` diatur di `wrangler.jsonc`.

## Struktur

- `src/engine/` — murni, tanpa DOM: `cards` (kartu + RNG berseed), `hands` (nilai kombinasi), `special` (kartu spesial),
  `rules` (semua angka aturan), `scoring` (poin ronde), `arrange` (pencari susunan terbaik untuk AI & tombol Saran),
  `six` (Capsa 6 kartu: dek pendek, nilai baris, susunan sah, AI),
  `strength-data` (tabel hasil `npm run calibrate`), `wallet` (koin).
- `src/engine/room.js` — logika meja online & Ranked (murni); `worker/` — Worker (`index.js`: API), Durable Object meja (`room.js`),
  dan pencari meja Ranked (`lobby.js`);
  `src/net/online.js` — klien online.
- `src/engine/roster.js` + `avatars/` — nama & karakter bot, sama dengan Mahjong Kung2 (Dominic, Sebastian, Joy, Elaina, Ellery, Elon,
  Elton, Jason, James, Jordan, KungKung, PoPo).
- `src/ui/` — `cardview` (kartu DOM), `sfx` (suara), `install` (tombol pasang aplikasi), `account` (akun bersama Mahjong + laporan error); `src/main.js` — alur layar; `css/style.css`; `index.html`.
- PWA: `manifest.webmanifest`, `sw.js` (diisi saat build), `icons/` (sumber `icon.svg`, PNG dari `scripts/icons.cjs`).
- `scripts/` — `build`, `simulate`, `simulate-six`, `calibrate`, `icons`; `test/` — tes engine.
