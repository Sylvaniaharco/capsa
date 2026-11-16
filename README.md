# Capsa Kung2

Capsa susun (13 kartu, 3 baris) di browser: kamu lawan 3 AI dengan meja koin 5 / 10 / 20 per poin, atau **online bareng teman**.
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
  `strength-data` (tabel hasil `npm run calibrate`), `wallet` (koin).
- `src/engine/room.js` — logika meja online & Ranked (murni); `worker/` — Worker (`index.js`: API), Durable Object meja (`room.js`),
  dan pencari meja Ranked (`lobby.js`);
  `src/net/online.js` — klien online.
- `src/engine/roster.js` + `avatars/` — nama & karakter bot, sama dengan Mahjong Kung2 (Dominic, Sebastian, Joy, Elaina, Ellery, Elon,
  Elton, Jason, James, Jordan, KungKung, PoPo).
- `src/ui/` — `cardview` (kartu DOM), `sfx` (suara), `install` (tombol pasang aplikasi), `account` (akun bersama Mahjong + laporan error); `src/main.js` — alur layar; `css/style.css`; `index.html`.
- PWA: `manifest.webmanifest`, `sw.js` (diisi saat build), `icons/` (sumber `icon.svg`, PNG dari `scripts/icons.cjs`).
- `scripts/` — `build`, `simulate`, `calibrate`, `icons`; `test/` — tes engine.
