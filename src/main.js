// Capsa Kung2 — titik masuk & alur layar: lobi → meja → susun kartu → buka kartu → hasil.
import { deal, mulberry32, rankOf, suitOf, parseCards, RANKS } from './engine/cards.js';
import { evalRow, catName, orderRow } from './engine/hands.js';
import { detectSpecial } from './engine/special.js';
import { scoreRound, duelFor, rowBonus } from './engine/scoring.js';
import { solve } from './engine/arrange.js';
import { ROWS, ROW_NAMES, SPECIAL, SPECIAL_NAMES, ARRANGE_SECONDS } from './engine/rules.js';
import { SIX, dealSix, evalSix, sixCatName, sixBonus, sixRules, orderSix, solveSix, sixStrength, sixRankCount, validPlayers } from './engine/six.js';
import { STAKES, minEntry, normalizeWallet, coinDelta, applyDelta, isBroke, START_COINS } from './engine/wallet.js';
import { pickBots, clampAvatar, AVATAR_COUNT } from './engine/roster.js';
import { cardEl, backEl } from './ui/cardview.js';
import { sfx, setSound } from './ui/sfx.js';
import { canShowInstall, installApp, onInstallChange } from './ui/install.js';
import { fetchAccount, fetchTicket, loginUrl, logout, installErrorLog } from './ui/account.js';
import { GRACE_MS, ROOM_CODE } from './engine/room.js';
import { clientId, api, onlineConfig, RoomSession } from './net/online.js';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const fmt = (n) => Math.round(n).toLocaleString('id-ID');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- jenis permainan ----------
// Capsa 13 kartu (4 pemain, susun 3-5-5) atau Capsa 6 kartu (3–8 pemain, susun 1-2-3). Semua bagian meja memakai G.v.
const V13 = {
  six: 0, n: 4, sizes: [3, 5, 5], secs: ARRANGE_SECONDS, rules: undefined,
  ev: evalRow, cat: catName, bonus: rowBonus, order: orderRow, special: detectSpecial,
  deal: (rng) => deal(rng), solve: (cards, keep) => solve(cards, { keep }),
};
function sixVariant(n) {
  return {
    six: n, n, sizes: SIX.sizes, secs: SIX.seconds, rules: sixRules(n),
    ev: (c) => evalSix(c, n), cat: sixCatName, bonus: sixBonus, order: (c) => orderSix(c, n), special: () => null,
    deal: (rng) => dealSix(rng, n).hands, solve: (cards, keep) => solveSix(cards, n, { keep }),
  };
}

// ---------- simpanan di HP ----------
const WALLET_KEY = 'capsa-wallet', SET_KEY = 'capsa-set', ROUND_KEY = 'capsa-round', TUT_KEY = 'capsa-tut', TUT6_KEY = 'capsa-tut6';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* mode privat: jalan tanpa simpanan */ } };

let wallet = normalizeWallet(load(WALLET_KEY), Date.now());
const settings = { sound: true, sixN: 4, mode: '13', ...(load(SET_KEY) || {}) };
if (settings.mode !== '6') settings.mode = '13';
if (!validPlayers(settings.sixN)) settings.sixN = 4;
setSound(settings.sound);
const saveWallet = () => save(WALLET_KEY, wallet);
saveWallet();

// ---------- ukuran layar ----------
function fit() {
  const r = app.getBoundingClientRect();
  app.style.setProperty('--vw', r.width / 100 + 'px');
  app.style.setProperty('--vh', r.height / 100 + 'px');
  app.classList.toggle('portrait', r.height > r.width);
}
fit();
addEventListener('resize', fit);
new ResizeObserver(fit).observe(app);

// ---------- toast & modal ----------
let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function modal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  return m;
}
const closeModal = () => { $('#modal').hidden = true; };
/** Konfirmasi di dalam halaman (confirm() bawaan tidak selalu muncul di webview). */
function ask(title, body, yes, no = 'Batal') {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="rs-btns"><button class="btn" data-a="no" type="button">${esc(no)}</button><button class="btn primary" data-a="yes" type="button">${esc(yes)}</button></div>`);
    m.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a && e.target !== m) return;
      m.onclick = null;
      closeModal();
      res(a === 'yes');
    };
  });
}

// ---------- lobi ----------
const TABLES = [
  { stake: 0, name: 'Latihan', sub: 'Tanpa koin', color: '#5b6f7f', chip: '0' },
  ...STAKES.map((s, i) => ({ stake: s, name: `Meja ${s}`, sub: `${s} koin / poin`, color: ['#2c8f73', '#2d6fd8', '#b8324a'][i], chip: String(s) })),
];
const show = (id) => { for (const s of ['lobby', 'table']) $('#' + s).hidden = s !== id; };

function renderLobby() {
  wallet = normalizeWallet(wallet, Date.now());
  saveWallet();
  $('#lbCoins').textContent = fmt(wallet.coins);
  const note = $('#lbNote');
  note.hidden = !isBroke(wallet.coins);
  note.textContent = `Koin meja AI kurang dari ${fmt(minEntry(STAKES[0]))}. Saldo diisi lagi jadi ${fmt(START_COINS)} besok jam 00.01 WIB. Sementara itu main di meja Latihan dulu.`;
  $('#tables').innerHTML = TABLES.map((t) => {
    const locked = t.stake > 0 && wallet.coins < minEntry(t.stake);
    const sub = t.stake === 0 ? t.sub : locked ? `Butuh ${fmt(minEntry(t.stake))}` : `min ${fmt(minEntry(t.stake))}`;
    return `<button class="tbl${locked ? ' locked' : ''}" data-stake="${t.stake}" type="button" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="chip" style="--c:${t.color}"><i>${t.chip}</i></span><span><b>${t.name}</b><small>${sub}</small></span></button>`;
  }).join('');
  // Ranked: koin akun (server). Terkunci kalau belum login atau saldo akun di bawah minimal meja.
  $('#lbRanked').hidden = !(rankedOn && account.state !== 'off');
  $('#rankedTables').innerHTML = TABLES.filter((t) => t.stake > 0).map((t) => {
    const need = account.state !== 'in' ? 'Masuk dulu' : account.coins !== null && account.coins < minEntry(t.stake) ? `Butuh ${fmt(minEntry(t.stake))}` : '';
    return `<button class="tbl${need ? ' locked' : ''}" data-ranked="${t.stake}" type="button" ${need ? 'aria-disabled="true"' : ''}>
      <span class="chip" style="--c:${t.color}"><i>${t.chip}</i></span><span><b>${t.name}</b><small>${need || `min ${fmt(minEntry(t.stake))}`}</small></span></button>`;
  }).join('');
  $('#aiCoinsTag').hidden = $('#lbRanked').hidden;
  // pilih mode dulu (13 / 6 kartu), baru mejanya
  const six = settings.mode === '6';
  $('#m13').hidden = six;
  $('#m6').hidden = !six;
  for (const b of document.querySelectorAll('#modePick .mode-b')) {
    const on = b.dataset.mode === settings.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  // Capsa 6 kartu: pilih jumlah pemain, lalu meja (koin sama dengan meja lawan AI)
  $('#sixPlayers').innerHTML = Array.from({ length: SIX.maxPlayers - SIX.minPlayers + 1 }, (_, k) => {
    const n = SIX.minPlayers + k;
    return `<button class="seg-b${n === settings.sixN ? ' on' : ''}" data-n="${n}" type="button" aria-pressed="${n === settings.sixN}">${n}</button>`;
  }).join('');
  const low = RANKS[13 - sixRankCount(settings.sixN)];
  $('#sixInfo').textContent = `${settings.sixN} pemain · kartu A sampai ${low}`;
  $('#sixTables').innerHTML = $('#tables').innerHTML.replaceAll('data-stake=', 'data-six=');
  // Ranked 6 kartu: koin akun, jumlah pemain ikut pilihan di atas (maks 4 pemain asli, sisanya bot)
  $('#lbRanked6').hidden = $('#lbRanked').hidden;
  $('#rankedSixTables').innerHTML = $('#rankedTables').innerHTML.replaceAll('data-ranked=', 'data-ranked-six=');
  $('#rankedSixInfo').textContent = `Meja ${settings.sixN} pemain · maksimal 4 pemain asli, sisa kursi diisi bot`;
  const sb = $('#btnSound');
  sb.textContent = `Suara: ${settings.sound ? 'nyala' : 'mati'}`;
  sb.setAttribute('aria-pressed', String(settings.sound));
  $('#btnInstall').hidden = !canShowInstall();
  $('#lbOnline').hidden = !onlineOn;
  renderAccount();
}

// ---------- akun bersama Mahjong Kung2 ----------
const GOOGLE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
let account = { state: 'off' }; // { state: 'off' | 'out' | 'in', name, coins } — lihat src/ui/account.js
function renderAccount() {
  const box = $('#lbAccount');
  box.hidden = account.state === 'off';
  $('#lbCoinsTag').hidden = account.state !== 'in';
  if (account.state === 'out') {
    box.innerHTML = `<a class="btn google" href="${loginUrl}">${GOOGLE_ICON} Masuk dengan Google</a><p>Satu akun dengan Mahjong Kung2.</p>`;
  } else if (account.state === 'in') {
    const coins = account.coins === null ? '' : ` · <span><i class="coin"></i> ${fmt(account.coins)}</span>`;
    box.innerHTML = `<button class="btn ghost acct" id="btnAccount" type="button"><img src="${avatarSrc(myAvatar())}" alt="">${esc(account.name)}${coins}</button>
      <p>Koin akun (dipakai bersama Mahjong Kung2) hanya untuk Ranked. Meja lawan AI pakai koin HP.</p>`;
  }
}
async function refreshAccount() {
  account = await fetchAccount();
  if (!G) renderLobby(); // ubin Ranked bergantung pada status & saldo akun
  return account;
}
$('#lbAccount').addEventListener('click', (e) => {
  if (!e.target.closest('#btnAccount') || account.state !== 'in') return;
  const m = modal(`<h2>${esc(account.name)}</h2>
    <p>Akun Google yang sama dengan Mahjong Kung2.</p>
    ${account.coins === null ? '' : `<p>Koin akun: <b><i class="coin"></i> ${fmt(account.coins)}</b></p>`}
    <p>Koin akun dipakai di Ranked Mahjong, dan nanti di meja online Capsa. Meja lawan AI di Capsa masih memakai koin yang tersimpan di HP ini.</p>
    <div class="rs-btns"><button class="btn" data-a="out" type="button">Keluar dari akun</button><button class="btn primary" data-a="ok" type="button">Tutup</button></div>
    <p style="margin-top:8px;font-size:12px">Keluar di sini berarti keluar juga dari Mahjong Kung2 di HP ini.</p>`);
  m.onclick = async (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (!a && ev.target !== m) return;
    m.onclick = null;
    closeModal();
    if (a !== 'out') return;
    const ok = await logout();
    toast(ok ? 'Sudah keluar dari akun' : 'Gagal keluar — cek koneksi lalu coba lagi');
    refreshAccount();
  };
});
function renderEmblem() {
  // tangan impian: tris A di atas, full house di tengah, royal flush di bawah
  const rows = ['As Ah Ad', '9s 9h 9c 4d 4c', '10h Jh Qh Kh Ah'].map(parseCards);
  $('#emblem').replaceChildren(...rows.map((r) => {
    const d = document.createElement('div');
    d.className = 'hrow';
    d.append(...r.map((c) => cardEl(c, 'mini')));
    return d;
  }));
}

$('#tables').addEventListener('click', (e) => {
  const b = e.target.closest('.tbl');
  if (!b) return;
  const stake = Number(b.dataset.stake);
  if (stake > 0 && wallet.coins < minEntry(stake)) { sfx('bad'); toast(`Meja ${stake} butuh saldo minimal ${fmt(minEntry(stake))} koin`); return; }
  sfx('tap');
  if (!load(TUT_KEY)) return showTutorial(() => enterTable(stake));
  enterTable(stake);
});
$('#modePick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === settings.mode) return;
  settings.mode = b.dataset.mode;
  save(SET_KEY, settings);
  sfx('tap');
  renderLobby();
});
$('#sixPlayers').addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  settings.sixN = Number(b.dataset.n);
  save(SET_KEY, settings);
  sfx('tap');
  renderLobby();
});
$('#sixTables').addEventListener('click', (e) => {
  const b = e.target.closest('.tbl');
  if (!b) return;
  const stake = Number(b.dataset.six), n = settings.sixN;
  if (stake > 0 && wallet.coins < minEntry(stake)) { sfx('bad'); toast(`Meja ${stake} butuh saldo minimal ${fmt(minEntry(stake))} koin`); return; }
  sfx('tap');
  if (!load(TUT6_KEY)) return showTutorial6(() => enterTable(stake, null, n));
  enterTable(stake, null, n);
});
$('#btnInstall').addEventListener('click', async () => {
  const hint = await installApp();
  if (hint) modal(`<h2>Pasang Capsa Kung2</h2><p>${esc(hint)}</p><div class="rs-btns"><button class="btn primary" data-a="ok" type="button">Oke</button></div>`).onclick = (e) => {
    if (e.target.id === 'modal' || e.target.closest('[data-a]')) closeModal();
  };
});
onInstallChange(() => { if (!G) renderLobby(); });

/** Cara main singkat, muncul sekali sebelum meja pertama. */
function showTutorial(then) {
  const ex = { top: parseCards('Ks Kd 4c'), mid: parseCards('9s 9h 6d 6c Qh'), bot: parseCards('3h 7h 9h Jh Ah') };
  const m = modal(`<h2>Cara main</h2>
    <div class="tut">
      <div class="tut-hand">${ROWS.map((r) => `<div class="tut-row"><span>${ROW_NAMES[r]}<small>${catName(evalRow(ex[r]))}</small></span><div class="hrow" data-r="${r}"></div></div>`).join('')}</div>
      <ol>
        <li>Kamu dapat <b>13 kartu</b>. Susun jadi 3 baris: Atas 3 kartu, Tengah 5, Bawah 5.</li>
        <li><b>Bawah harus paling kuat</b>, lalu Tengah, lalu Atas. Kalau terbalik, tombol Siap tidak bisa ditekan.</li>
        <li><b>Ketuk dua kartu</b> untuk menukar (atau seret). Bingung? Tekan <b>Saran</b>.</li>
        <li>Tiap baris diadu dengan lawan: menang +1, kalah −1. Menang 3 baris dari satu lawan = <b>tembus</b>, poin ×2.</li>
      </ol>
    </div>
    <div class="rs-btns"><button class="btn primary" data-a="go" type="button">Mulai main</button></div>`);
  for (const r of ROWS) $(`.hrow[data-r="${r}"]`, m).append(...ex[r].map((c) => cardEl(c, 'mini')));
  m.onclick = (e) => {
    if (!e.target.closest('[data-a]')) return;
    m.onclick = null;
    closeModal();
    save(TUT_KEY, 1);
    then();
  };
}
// urutan lambang (SVG, bukan karakter ♠♥ yang di Android bisa jadi emoji)
const suitIcon = (k) => `<svg class="su-i${k === 0 || k === 2 ? ' red' : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#su${k}"/></svg>`;
const SUIT_ORDER = `<span class="su-order" aria-label="sekop, hati, keriting, wajik">${[3, 2, 1, 0].map(suitIcon).join(' &gt; ')}</span>`;
/** Cara main Capsa 6 kartu, muncul sekali sebelum meja 6 kartu pertama. */
function showTutorial6(then) {
  const ex = { top: parseCards('As'), mid: parseCards('Kh Kd'), bot: parseCards('Qs Js 10s') };
  const m = modal(`<h2>Capsa 6 kartu</h2>
    <div class="tut">
      <div class="tut-hand">${ROWS.map((r) => `<div class="tut-row"><span>${ROW_NAMES[r]}<small>${sixCatName(evalSix(ex[r], 3))}</small></span><div class="hrow" data-r="${r}"></div></div>`).join('')}</div>
      <ol>
        <li>Tiap pemain dapat <b>6 kartu</b>, susun jadi Atas 1, Tengah 2, Bawah 3. Bawah harus paling kuat.</li>
        <li>Kartu yang dipakai dari As ke bawah, sesuai jumlah pemain (3 pemain: A sampai 10).</li>
        <li>Urutan Bawah: Kartu Tinggi &lt; Pair &lt; Straight &lt; <b>Flush</b> &lt; Tris &lt; Straight Flush &lt; Royal. Nilai sama? <b>Lambang</b> yang menentukan: ${SUIT_ORDER}.</li>
        <li>Menang baris +1. Bonus: pair As di Tengah +1, Tris di Bawah +3, Straight Flush +5, Royal +7. Tembus = ×2.</li>
      </ol>
    </div>
    <div class="rs-btns"><button class="btn primary" data-a="go" type="button">Mulai main</button></div>`);
  for (const r of ROWS) $(`.hrow[data-r="${r}"]`, m).append(...ex[r].map((c) => cardEl(c, 'mini')));
  m.onclick = (e) => {
    if (!e.target.closest('[data-a]')) return;
    m.onclick = null;
    closeModal();
    save(TUT6_KEY, 1);
    then();
  };
}
$('#btnSound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  setSound(settings.sound);
  save(SET_KEY, settings);
  renderLobby();
  sfx('tap');
});
$('#btnRules').addEventListener('click', () => {
  const m = modal(`<h2>Aturan Capsa Kung2</h2>
    <p>Tiap pemain dapat 13 kartu, disusun jadi 3 baris: <b>Atas</b> 3 kartu, <b>Tengah</b> 5 kartu, <b>Bawah</b> 5 kartu.
    Bawah harus paling kuat, lalu Tengah, lalu Atas. Tiap baris diadu dengan baris yang sama milik tiap lawan.</p>
    <h3>Poin</h3>
    <ul><li>Menang satu baris: <b>+1</b> (kalah −1, sama kuat 0).</li>
    <li><b>Tembus</b> (menang 3 baris dari satu lawan): poin lawan itu <b>×2</b>.</li>
    <li><b>Tembus keliling</b> (tembus ke 3 lawan): <b>×2 lagi</b>, jadi ×4.</li></ul>
    <h3>Bonus (kalau baris itu menang)</h3>
    <ul><li>Atas: Tris <b>+3</b></li>
    <li>Tengah: Full House <b>+3</b>, Four of a Kind <b>+5</b>, Straight Flush <b>+7</b>, Royal Flush <b>+11</b></li>
    <li>Bawah: Four of a Kind <b>+5</b>, Straight Flush <b>+7</b>, Royal Flush <b>+11</b></li></ul>
    <h3>Kartu spesial (langsung menang)</h3>
    <ul><li>All Straight (ketiga baris straight): <b>+4</b> dari tiap lawan</li>
    <li>All Flush (ketiga baris flush): <b>+3</b> dari tiap lawan</li>
    <li>6 Pair: <b>+3</b> dari tiap lawan</li></ul>
    <h3>Urutan kombinasi</h3>
    <p>Kartu Tinggi &lt; Pair &lt; Two Pair &lt; Tris &lt; Straight &lt; Flush &lt; Full House &lt; Four of a Kind &lt; Straight Flush &lt; Royal Flush.
    As paling tinggi; A-2-3-4-5 adalah straight paling kecil. Lambang kartu tidak dipakai untuk menentukan menang.</p>
    <h3>Koin</h3>
    <p>Poin bersih dikali taruhan meja (5, 10, atau 20 koin per poin). Saldo awal ${fmt(START_COINS)}. Masuk meja 5 butuh ${fmt(minEntry(5))} koin,
    meja 10 butuh ${fmt(minEntry(10))}, meja 20 butuh ${fmt(minEntry(20))}. Kalau koin habis, saldo diisi lagi besok jam 00.01 WIB.</p>
    <h3>Capsa 6 kartu (lawan AI, 3–8 pemain)</h3>
    <p>Tiap pemain dapat 6 kartu, disusun <b>Atas 1</b>, <b>Tengah 2</b>, <b>Bawah 3</b> (Bawah ≥ Tengah ≥ Atas). Kartu diambil dari As ke bawah
    sebanyak yang perlu: 3 pemain A–10 (2 kartu tidak dibagi), 4 pemain A–9, 5 pemain A–7, 6 pemain A–6, 7 pemain A–4, 8 pemain A–3.</p>
    <ul><li>Urutan: Kartu Tinggi &lt; Pair &lt; Straight &lt; Flush &lt; Tris &lt; Straight Flush &lt; Royal (A-K-Q satu lambang).
    As selalu kartu tertinggi (A-10-J bukan straight).</li>
    <li>Nilai sama ditentukan <b>lambang</b>: ${SUIT_ORDER} — tidak ada seri.</li>
    <li>Menang baris <b>+1</b>. Bonus: Tengah pair As <b>+1</b>; Bawah Tris <b>+3</b>, Straight Flush <b>+5</b>, Royal <b>+7</b>.</li>
    <li>Tembus <b>×2</b>. Tembus keliling (×2 lagi) hanya di meja 3–4 pemain. Tidak ada kartu spesial.</li></ul>
    <div class="rs-btns"><button class="btn primary" data-a="ok" type="button">Mengerti</button></div>`);
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-a]')) { m.onclick = null; closeModal(); } };
});

// ---------- meja ----------
// Bot = karakter & nama yang sama dengan Mahjong Kung2 (src/engine/roster.js, gambar di avatars/).
const avatarSrc = (i) => `avatars/${(i % AVATAR_COUNT) + 1}.webp`;
/** Avatar pemain: ikut pilihan di Mahjong Kung2 kalau ada (satu domain = satu localStorage), kalau tidak avatar pertama. */
function myAvatar() {
  try { return clampAvatar(JSON.parse(localStorage.getItem('hkmj-settings-v1') || '{}').avatar) ?? 0; } catch { return 0; }
}
let G = null; // { stake, gen, seats:[{name,color,coins,isMe}], round }
const seatEl = (i) => $(`.seat[data-seat="${i}"]`);
const others = () => G.seats.map((_, i) => i).slice(1);

/** saved = ronde yang belum selesai (ROUND_KEY): lawan & kartunya sama seperti saat ditinggal. */
function enterTable(stake, saved = null, six = 0) {
  const mine = myAvatar();
  const unit = stake || 5;
  const v = six ? sixVariant(six) : V13;
  G = {
    mode: 'solo', stake, gen: 0, round: null, fast: false, v,
    seats: [
      { name: 'Kamu', avatar: mine, isMe: true },
      ...(saved ? saved.seats : pickBots(v.n - 1, [mine], Math.random).map((b) => ({ ...b, coins: unit * (300 + Math.floor(Math.random() * 1700)) }))),
    ],
  };
  if (six) sixStrength(six); // tabel AI dibuat sekali per jumlah pemain (±0,1 dtk)
  show('table');
  $('#table').classList.remove('online');
  $('#table').classList.toggle('six', !!six);
  $('#tbInfo').innerHTML = six ? `${stake ? `Meja <b>${stake}</b>` : '<b>Latihan</b>'} · 6 kartu`
    : stake ? `Meja <b>${stake}</b> koin / poin` : 'Meja <b>Latihan</b> · tanpa koin';
  buildSeats();
  renderCoins();
  startRound(saved);
}
/** Kursi dibuat ulang tiap masuk meja: 4 kursi tetap (13 kartu / online) atau 3–8 kursi melingkar (6 kartu). */
function buildSeats() {
  const table = $('#table');
  table.querySelectorAll('.seat').forEach((el) => el.remove());
  const n = G.seats.length, six = !!G.v.six;
  G.seats.forEach((s, i) => {
    const el = document.createElement('div');
    el.dataset.seat = i;
    el.className = six && i > 0 ? 'seat sx' : `seat s${i}`;
    if (six && i > 0) {
      // urutan kursi searah jarum jam dari pemain: kiri → atas → kanan
      const m = n - 1, k = i - 1;
      // landscape: 3+ lawan = satu di kiri, satu di kanan, sisanya berjajar di atas
      const sides = m >= 3, row = sides ? m - 2 : m, j = sides ? k - 1 : k;
      const [lx, ly] = sides && k === 0 ? [8, 56] : sides && k === m - 1 ? [92, 56] : [15 + ((j + 0.5) * 70) / row, 23];
      // portrait: kolom kiri (bawah → atas), deret atas, kolom kanan (atas → bawah)
      const col = Math.floor((m - 1) / 2), top = m - 2 * col;
      const ys = [[], [44], [54, 34], [58, 42, 26]][col], topY = [25, 22, 16, 11][col];
      const [px, py] = k < col ? [18, ys[k]] : k >= col + top ? [82, ys[m - 1 - k]] : [50 + (k - col + 0.5 - top / 2) * 34, topY];
      const pos = { '--lx': lx, '--ly': ly, '--px': px, '--py': py };
      for (const [key, val] of Object.entries(pos)) el.style.setProperty(key, val.toFixed(1) + '%');
      el.classList.toggle('rl', lx > 80); // kursi di kanan: poin di kiri kartu supaya tidak keluar layar
      el.classList.toggle('rp', px > 80);
    }
    table.insertBefore(el, $('#center'));
  });
  G.seats.forEach((s, i) => {
    seatEl(i).innerHTML = `<div class="who"><div class="ava"><img src="${avatarSrc(s.avatar)}" alt="" draggable="false"></div>
      <div class="nm"><b>${esc(s.name)}</b><span class="coins"><i class="coin"></i> <span data-coins></span></span></div></div>
      <div class="handwrap"><div class="hand"><div class="hrow"></div><div class="hrow"></div><div class="hrow"></div></div><div class="cap"></div><div class="tag"></div></div>
      <div class="pts"></div>`;
  });
}
function renderCoins() {
  G.seats.forEach((s, i) => {
    // meja online tanpa koin: yang tampil total poin selama di meja itu
    const mine = G.mode === 'online' && s.isMe && O?.ranked && s.coins != null; // Ranked: saldo koin akun sendiri
    const text = mine ? fmt(s.coins) : G.mode === 'online' ? (s.empty ? '' : `Total ${signed(s.shownTotal ?? 0)}`) : fmt(s.isMe ? wallet.coins : s.coins);
    $('[data-coins]', seatEl(i)).textContent = text;
  });
}
function leaveTable() {
  if (G?.round) clearRoundTimers(G.round);
  if (O) {
    const ranked = O.ranked;
    clearInterval(O.timer);
    O.session?.close(true);
    O = null;
    save(ROOM_KEY, null);
    if (ranked) {
      // saldo akun berubah selama main; ronde yang ditinggal baru selesai belakangan, jadi dicek lagi nanti
      refreshAccount();
      for (const ms of [25000, 80000]) setTimeout(() => { if (!G) refreshAccount(); }, ms);
    }
  }
  $('#table').classList.remove('online', 'ranked', 'six');
  G = null;
  save(ROUND_KEY, null);
  $('#arrange').hidden = true;
  $('#result').hidden = true;
  $('#center').replaceChildren();
  renderLobby();
  show('lobby');
}

/** Gambar tangan satu kursi. rows = {top,mid,bot} | null (tertutup semua); open = [atas,tengah,bawah] sudah dibuka? */
/** Baris yang dapat bonus (mis. pair As di tengah, tris / straight flush di bawah) dibuat bersinar. */
const shines = (row, cards) => cards?.length === G.v.sizes[ROWS.indexOf(row)] && G.v.bonus(row, G.v.ev(cards)) > 0;
function renderHand(i, rows, open = [false, false, false], anim = '') {
  const els = seatEl(i).querySelectorAll('.hrow');
  ROWS.forEach((r, k) => {
    const n = G.v.sizes[k];
    const cards = Array.from({ length: n }, (_, j) => {
      const el = rows && open[k] ? cardEl(rows[r][j], 'mini') : backEl('mini');
      if (anim) { el.classList.add(anim); el.style.setProperty('--i', k * 4 + j); }
      return el;
    });
    els[k].replaceChildren(...cards);
    els[k].classList.toggle('shine', !!(rows && open[k] && shines(r, rows[r])));
  });
}
function openRow(i, rows, k) {
  const row = seatEl(i).querySelectorAll('.hrow')[k];
  row.replaceChildren(...rows[ROWS[k]].map((c) => { const el = cardEl(c, 'mini'); el.classList.add('flip'); return el; }));
  row.classList.toggle('shine', shines(ROWS[k], rows[ROWS[k]]));
}
const setCap = (i, text, special = false) => { const c = $('.cap', seatEl(i)); c.textContent = text; c.classList.toggle('special', special); };
const setTag = (i, text, think = false) => { const t = $('.tag', seatEl(i)); t.textContent = text; t.classList.toggle('think', think); };
function setPts(i, n, showZero = true) {
  const p = $('.pts', seatEl(i));
  const txt = n === null ? '' : n === 0 && !showZero ? '' : signed(n) || '0';
  if (p.textContent !== txt) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
  p.textContent = txt;
  p.className = `pts ${n ? cls(n) : ''}${p.classList.contains('pop') ? ' pop' : ''}`;
}
const markRow = (k) => {
  for (let i = 0; i < G.seats.length; i++) {
    seatEl(i).querySelectorAll('.hrow').forEach((r, j) => r.classList.toggle('now', j === k));
    $('.hand', seatEl(i)).classList.toggle('dim', k >= 0);
  }
};

// ---------- ronde ----------
function clearRoundTimers(R) {
  clearInterval(R.tick);
  R.botTimers.forEach(clearTimeout);
}
const stale = (gen) => !G || G.gen !== gen;

/**
 * Ronde yang sedang jalan disimpan di HP (seed kartu, lawan, batas waktu, susunan terakhir), jadi menutup app saat menyusun
 * tidak membuang ronde: saat dibuka lagi kartunya sama, dan kalau waktunya sudah habis ronde langsung diselesaikan.
 */
function saveRound() {
  const R = G?.round;
  if (!R || G.mode === 'online' || (R.phase !== 'arrange' && R.phase !== 'wait')) return; // meja online disimpan server
  save(ROUND_KEY, {
    v: 1, stake: G.stake, six: G.v.six, seed: R.seed, deadlineAt: R.deadlineAt, slots: A.slots,
    seats: G.seats.slice(1).map(({ name, avatar, coins }) => ({ name, avatar, coins })),
  });
}
function loadRound() {
  const sv = load(ROUND_KEY);
  const six = sv?.six || 0;
  const ok = sv && sv.v === 1 && [0, ...STAKES].includes(sv.stake) && Number.isInteger(sv.seed) && Number.isFinite(sv.deadlineAt)
    && (six === 0 || validPlayers(six))
    && Array.isArray(sv.seats) && sv.seats.length === (six || 4) - 1
    && sv.seats.every((b) => b && typeof b.name === 'string' && clampAvatar(b.avatar) !== null && Number.isFinite(b.coins));
  return ok ? sv : null;
}

async function startRound(saved = null) {
  const gen = ++G.gen;
  G.fast = false;
  // ?seed=123 di alamat = kartu ronde pertama bisa diulang (untuk cek bug)
  const forced = G.gen === 1 ? Number(new URLSearchParams(location.search).get('seed')) : 0;
  const seed = saved?.seed || forced || (Date.now() ^ Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const rng = mulberry32(seed);
  const R = (G.round = {
    phase: 'deal', seed, deadlineAt: 0, botTimers: [], tick: 0, deadline: 0, result: null,
    players: G.v.deal(rng).map((cards) => ({ cards, special: G.v.special(cards), rows: null, declared: false, ready: false })),
  });
  $('#result').hidden = true;
  $('#arrange').hidden = true;
  $('#center').replaceChildren();
  markRow(-1);
  for (let i = 0; i < G.seats.length; i++) { renderHand(i, null, undefined, 'dealt'); setCap(i, ''); setTag(i, ''); setPts(i, null); }
  sfx('deal');
  await sleep(750);
  if (stale(gen)) return;

  R.phase = 'arrange';
  const pace = G.v.secs / ARRANGE_SECONDS; // meja 6 kartu waktunya lebih pendek, bot juga lebih cepat
  for (const i of others()) {
    setTag(i, 'Menyusun…', true);
    R.botTimers[i] = setTimeout(() => botReady(i), (3000 + Math.random() * 11000) * pace);
  }
  R.deadlineAt = saved ? saved.deadlineAt : Date.now() + G.v.secs * 1000;
  R.deadline = performance.now() + (R.deadlineAt - Date.now());
  R.tick = setInterval(onTick, 200);
  openArrange(true);
  // lanjutkan susunan terakhir kalau kartunya memang kartu ronde ini
  const mine = [...R.players[0].cards].sort((a, b) => a - b).join();
  if (saved && Array.isArray(saved.slots) && [...saved.slots].sort((a, b) => a - b).join() === mine) {
    A.slots = [...saved.slots];
    A.note = 'Ronde sebelumnya dilanjutkan';
    renderArrange(false);
  }
  saveRound();
  onTick();
}

function botReady(i) {
  const R = G?.round;
  if (!R || R.players[i].ready) return;
  const p = R.players[i];
  if (p.special) p.declared = true;
  else {
    const opts = G.v.solve(p.cards, 3);
    // sesekali ambil pilihan kedua kalau nilainya hampir sama, supaya lawan tidak selalu main "sempurna"
    // (acak dari seed ronde + kursi, supaya ronde yang dilanjutkan hasilnya sama)
    const second = opts[1] && opts[0].ev - opts[1].ev < 0.35 && mulberry32(R.seed + i * 7919)() < 0.2;
    p.rows = second ? opts[1] : opts[0];
  }
  p.ready = true;
  setTag(i, 'Siap');
  renderOppCount();
  checkAllReady();
}
function renderOppCount() {
  const R = G?.round;
  if (!R) return;
  if (G.mode === 'online') {
    const others = O.view.seats.filter((s, i) => s && i !== O.view.seat);
    $('#arOpp').textContent = `Lawan siap ${others.filter((s) => s.ready).length}/${others.length}`;
    return;
  }
  const n = R.players.slice(1).filter((p) => p.ready).length;
  $('#arOpp').textContent = `Lawan siap ${n}/${R.players.length - 1}`;
}

function onTick() {
  const R = G?.round;
  if (!R || (R.phase !== 'arrange' && R.phase !== 'wait')) return;
  const left = Math.max(0, R.deadline - performance.now());
  const sec = Math.ceil(left / 1000);
  for (const t of document.querySelectorAll('.timer')) {
    t.style.setProperty('--p', left / (G.v.secs * 1000));
    t.firstElementChild.textContent = sec;
    t.classList.toggle('low', sec <= 5);
  }
  if (sec <= 5 && sec !== R.lastSec && sec > 0 && R.phase === 'arrange') sfx('tick');
  R.lastSec = sec;
  if (left <= 0) timeUp();
}
function timeUp() {
  const R = G.round;
  if (G.mode === 'online') {
    // server yang menutup ronde; di sini cukup kirim susunan terakhir kalau sah (kalau tidak, server menyusunkan)
    if (R.players[0].ready || R.timedOut) return;
    R.timedOut = true;
    if (commitMine(false)) {
      sendSubmit();
      afterMineReady();
      toast('Waktu habis');
    } else {
      $('#arrange').hidden = true;
      R.phase = 'wait';
      R.players[0].ready = true;
      $('#center').innerHTML = '<div class="banner">Waktu habis<small>Kartumu disusun otomatis</small></div>';
    }
    return;
  }
  if (!R.players[0].ready) {
    const ok = commitMine(true);
    toast(ok === 'auto' ? 'Waktu habis — kartu disusun otomatis' : 'Waktu habis');
  }
  for (const i of others()) { clearTimeout(R.botTimers[i]); botReady(i); }
  checkAllReady();
}
function checkAllReady() {
  const R = G?.round;
  if (!R || G.mode === 'online' || (R.phase !== 'arrange' && R.phase !== 'wait')) return; // online: server yang membuka ronde
  if (R.players.every((p) => p.ready)) showdown();
}

// ---------- layar susun ----------
const A = { slots: [], sel: -1, hints: null, hintIdx: -1, sortMode: 0, drag: null, note: '' };
/** Batas slot tiap baris: 13 kartu {top:[0,3], mid:[3,8], bot:[8,13]}, 6 kartu {top:[0,1], mid:[1,3], bot:[3,6]}. */
function rowRange() {
  const [t, m, b] = G.v.sizes;
  return { top: [0, t], mid: [t, t + m], bot: [t + m, t + m + b] };
}
const rowsOf = (slots) => Object.fromEntries(Object.entries(rowRange()).map(([r, [a, b]]) => [r, slots.slice(a, b)]));
const flat = (r) => [...r.top, ...r.mid, ...r.bot];
/** Kartu urut dari kuat → bawah diisi dulu, lalu tengah, sisanya atas. */
const fillRows = (s) => { const [, m, b] = G.v.sizes; return flat({ bot: s.slice(0, b), mid: s.slice(b, b + m), top: s.slice(b + m) }); };
const byRank = (a, b) => rankOf(b) - rankOf(a) || suitOf(b) - suitOf(a);

function openArrange(fresh) {
  const R = G.round, me = R.players[0];
  if (fresh) {
    A.slots = fillRows([...me.cards].sort(byRank)); // awal: urut dari besar — kartu terbesar di bawah
    A.hints = null; A.hintIdx = -1; A.sortMode = 0; A.note = 'Ketuk dua kartu untuk menukar, atau seret kartu ke kartu lain';
  }
  A.sel = -1;
  me.ready = false; me.declared = false;
  R.phase = 'arrange';
  $('#center').replaceChildren();
  const sp = $('#arSpecial');
  sp.hidden = !me.special;
  if (me.special) {
    sp.innerHTML = `<span>Kartu spesial: <b>${SPECIAL_NAMES[me.special.type]}</b> — langsung menang, +${me.special.pts} dari tiap lawan</span>
      <button class="btn" id="btnSpecial" type="button">Pakai</button>`;
  }
  $('#btnSwap').hidden = G.v.sizes[1] !== G.v.sizes[2]; // tukar tengah-bawah hanya kalau ukurannya sama
  $('#arrange').classList.toggle('six', !!G.v.six);
  $('#arrange').hidden = false;
  renderArrange(false);
  renderOppCount();
}

function renderArrange(animate = true) {
  const box = $('#arrange');
  const before = new Map();
  if (animate) for (const el of box.querySelectorAll('.card')) before.set(el.dataset.c, el.getBoundingClientRect());
  const have = new Map([...box.querySelectorAll('.card')].map((el) => [Number(el.dataset.c), el]));
  for (const [row, [from, to]] of Object.entries(rowRange())) {
    const wrap = $(`.arow[data-row="${row}"] .acards`, box);
    const els = A.slots.slice(from, to).map((c) => have.get(c) || cardEl(c, 'big'));
    wrap.replaceChildren(...els);
  }
  box.querySelectorAll('.card').forEach((el) => {
    el.classList.remove('drag', 'over');
    el.style.transform = '';
    el.classList.toggle('sel', A.slots[A.sel] === Number(el.dataset.c));
  });
  if (animate) {
    for (const el of box.querySelectorAll('.card')) {
      const b = before.get(el.dataset.c);
      if (!b) continue;
      const a = el.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
  }
  // label tiap baris + cek urutan
  const r = rowsOf(A.slots);
  const v = ROWS.map((row) => G.v.ev(r[row]));
  const bad = [v[0] > v[1], v[0] > v[1] || v[1] > v[2], v[1] > v[2]];
  ROWS.forEach((row, k) => {
    const el = $(`.arow[data-row="${row}"]`, box);
    el.classList.toggle('bad', bad[k]);
    const bonus = G.v.bonus(row, v[k]);
    el.classList.toggle('shine', bonus > 0 && !bad[k]);
    $('.alabel', el).innerHTML = `<span class="rn">${ROW_NAMES[row]}</span><span class="hn">${G.v.cat(v[k])}</span>${bonus ? `<span class="bn">bonus +${bonus}</span>` : ''}`;
  });
  const invalid = bad.some(Boolean);
  const msg = $('#arMsg');
  msg.classList.toggle('bad', invalid);
  msg.textContent = !invalid ? A.note : v[1] > v[2] ? 'Bawah harus lebih kuat (atau sama) dari Tengah' : 'Tengah harus lebih kuat (atau sama) dari Atas';
  $('#btnReady').disabled = invalid;
  saveRound();
  return !invalid;
}

/** Rapikan urutan kartu di dalam tiap baris (kembar berdampingan). */
function tidy() { A.slots = flat(Object.fromEntries(ROWS.map((r) => [r, G.v.order(rowsOf(A.slots)[r])]))); }
function swapSlots(i, j) {
  if (i === j || i < 0 || j < 0) return;
  [A.slots[i], A.slots[j]] = [A.slots[j], A.slots[i]];
  A.sel = -1;
  A.note = '';
  tidy();
  sfx('swap');
  renderArrange();
}

// ketuk dua kartu untuk tukar, atau seret satu kartu ke kartu lain
const arBox = $('#arrange');
arBox.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.card');
  if (!el || A.drag) return;
  A.drag = { el, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, over: null };
  el.setPointerCapture?.(e.pointerId);
});
arBox.addEventListener('pointermove', (e) => {
  const d = A.drag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  if (!d.moved && Math.hypot(dx, dy) < 8) return;
  d.moved = true;
  d.el.classList.add('drag');
  d.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#arrange .card') || null;
  if (over !== d.over) { d.over?.classList.remove('over'); over?.classList.add('over'); d.over = over; }
});
const endDrag = (e) => {
  const d = A.drag;
  if (!d || e.pointerId !== d.id) return;
  A.drag = null;
  const from = A.slots.indexOf(Number(d.el.dataset.c));
  d.over?.classList.remove('over');
  if (d.moved) {
    d.el.classList.remove('drag');
    d.el.style.transform = '';
    if (d.over && e.type === 'pointerup') swapSlots(from, A.slots.indexOf(Number(d.over.dataset.c)));
    return;
  }
  if (e.type !== 'pointerup') return;
  if (A.sel < 0) { A.sel = from; sfx('tap'); renderArrange(false); }
  else if (A.sel === from) { A.sel = -1; renderArrange(false); }
  else swapSlots(A.sel, from);
};
arBox.addEventListener('pointerup', endDrag);
arBox.addEventListener('pointercancel', endDrag);

$('#btnHint').addEventListener('click', () => {
  const me = G.round.players[0];
  A.hints ||= G.v.solve(me.cards, 3);
  A.hintIdx = (A.hintIdx + 1) % A.hints.length;
  const h = A.hints[A.hintIdx];
  A.slots = flat(h);
  A.sel = -1;
  A.note = `Saran ${A.hintIdx + 1} dari ${A.hints.length} — tekan Saran lagi untuk pilihan lain`;
  sfx('swap');
  renderArrange();
});
$('#btnSort').addEventListener('click', () => {
  A.sortMode = (A.sortMode + 1) % 2;
  let s;
  if (A.sortMode === 1) {
    // per lambang: lambang terbanyak dulu
    const n = [0, 0, 0, 0];
    for (const c of A.slots) n[suitOf(c)]++;
    s = [...A.slots].sort((a, b) => n[suitOf(b)] - n[suitOf(a)] || suitOf(b) - suitOf(a) || rankOf(b) - rankOf(a));
  } else s = [...A.slots].sort(byRank);
  A.slots = fillRows(s);
  A.sel = -1;
  A.note = A.sortMode === 1 ? 'Diurutkan per lambang' : 'Diurutkan per angka';
  sfx('swap');
  renderArrange();
});
$('#btnSwap').addEventListener('click', () => {
  const r = rowsOf(A.slots);
  A.slots = flat({ top: r.top, mid: r.bot, bot: r.mid });
  A.sel = -1;
  A.note = '';
  sfx('swap');
  renderArrange();
});
$('#btnReady').addEventListener('click', () => {
  if (!renderArrange(false)) { sfx('bad'); return; }
  commitMine(false);
  sfx('ready');
  if (G.mode === 'online') sendSubmit();
  afterMineReady();
});
arBox.addEventListener('click', (e) => {
  if (!e.target.closest('#btnSpecial')) return;
  const me = G.round.players[0];
  me.declared = true; me.ready = true;
  sfx('scoop');
  if (G.mode === 'online') sendSubmit();
  afterMineReady();
});

/** Kunci susunan saya. force = waktu habis: susunan tidak sah diganti susunan terbaik. -> 'mine' | 'auto' */
function commitMine(force) {
  const me = G.round.players[0];
  let how = 'mine';
  if (!renderArrange(false)) {
    if (!force) return null;
    A.slots = flat(G.v.solve(me.cards, 1)[0]);
    how = 'auto';
  }
  tidy();
  me.rows = rowsOf(A.slots);
  me.declared = false;
  me.ready = true;
  return how;
}

function afterMineReady() {
  const R = G.round, me = R.players[0];
  $('#arrange').hidden = true;
  R.phase = 'wait';
  renderHand(0, me.declared ? me.special.rows : me.rows, [true, true, true]);
  setCap(0, me.declared ? `${SPECIAL_NAMES[me.special.type]} +${me.special.pts}` : '', me.declared);
  // lawan (bot) yang belum siap dipercepat supaya tidak lama menunggu
  for (let i = 1; i < R.players.length && G.mode !== 'online'; i++) {
    if (R.players[i].ready) continue;
    clearTimeout(R.botTimers[i]);
    R.botTimers[i] = setTimeout(() => botReady(i), 500 + Math.random() * 1300);
  }
  const c = $('#center');
  c.innerHTML = `<div class="waitbox"><div class="timer"><b></b></div><div class="status">Menunggu lawan…</div>${R.timedOut ? '' : '<button class="btn" id="btnRedo" type="button">Susun ulang</button>'}</div>`;
  onTick();
  checkAllReady();
}
$('#center').addEventListener('click', (e) => {
  if (!e.target.closest('#btnRedo')) return;
  const R = G?.round;
  if (!R || R.phase !== 'wait') return;
  if (G.mode === 'online') {
    if (R.timedOut) return;
    R.pendingSubmit = false;
    O.session?.send({ t: 'redo' });
  }
  sfx('tap');
  renderHand(0, null);
  setCap(0, '');
  openArrange(false);
});

// ---------- buka kartu ----------
/** Hitung hasil & langsung simpan koin (sebelum animasi), supaya menutup halaman tidak membatalkan ronde. */
function settle() {
  const R = G.round;
  clearRoundTimers(R);
  save(ROUND_KEY, null);
  const res = scoreRound(R.players.map((p) => (p.declared ? { special: p.special } : { rows: p.rows })), G.v.rules);
  const deltas = res.net.map((n) => coinDelta(n, G.stake));
  if (G.stake) {
    const beforeCoins = wallet.coins;
    wallet.coins = applyDelta(wallet.coins, deltas[0]);
    deltas[0] = wallet.coins - beforeCoins; // saldo tidak bisa minus
    saveWallet();
    for (const i of others()) {
      const s = G.seats[i];
      s.coins = applyDelta(s.coins, deltas[i]);
      if (s.coins < minEntry(G.stake)) s.coins += G.stake * 1000; // lawan isi ulang
    }
  }
  R.result = { res, deltas };
  return R.result;
}

/** Jeda animasi; ketuk meja = percepat. */
const pause = (ms) => sleep(G?.fast ? Math.min(ms, 140) : ms);
$('#table').addEventListener('pointerdown', (e) => {
  if (G?.round?.phase === 'show' && !e.target.closest('button')) G.fast = true;
});
function banner(html, gold = false) {
  $('#center').innerHTML = `<div class="banner${gold ? ' gold' : ''}">${html}</div><div class="skiphint">ketuk meja untuk percepat</div>`;
}

/** Tembus keliling: layar besar seperti "Hu besar" di Mahjong (tulisan meletup, sinar emas, gong, HP bergetar). */
async function bigWin(who) {
  const me = who === 0;
  const s = G.seats[who];
  const el = document.createElement('div');
  el.className = `bigwin${me ? ' mine' : ''}`;
  el.innerHTML = `<div class="bw-rays"></div><div class="bw-box">
    <div class="bw-ava"><img src="${avatarSrc(s.avatar)}" alt=""></div>
    <div class="bw-title">TEMBUS<br>KELILING!</div>
    <div class="bw-sub">${me ? 'Kamu' : esc(s.name)} tembus semua lawan · poin ×4</div></div>`;
  $('#center').replaceChildren();
  $('#table').append(el);
  seatEl(who).classList.add('glow');
  sfx('sweep');
  if (me) try { navigator.vibrate?.([60, 80, 60, 80, 160]); } catch { /* tanpa getar */ }
  await pause(2600);
  el.classList.add('out');
  await sleep(250);
  el.remove();
  seatEl(who)?.classList.remove('glow');
}

async function showdown() {
  const gen = G.gen, R = G.round;
  R.phase = 'show';
  $('#arrange').hidden = true;
  const { res, deltas } = settle();
  const P = R.players;
  const N = P.length;
  const run = new Array(N).fill(0);
  const push = () => run.forEach((n, i) => setPts(i, n));

  for (let i = 0; i < N; i++) { renderHand(i, null); setTag(i, ''); setCap(i, ''); }
  banner('Buka kartu!');
  await pause(650);
  if (stale(gen)) return;

  // kartu spesial dibuka dulu
  const specials = P.map((p, i) => (p.declared ? i : -1)).filter((i) => i >= 0);
  if (specials.length) {
    for (const i of specials) {
      renderHand(i, P[i].special.rows, [true, true, true], 'flip');
      setCap(i, `${SPECIAL_NAMES[P[i].special.type]} +${P[i].special.pts}`, true);
    }
    for (const d of res.duels) if (d.special) { run[d.a] += d.total; run[d.b] -= d.total; }
    const names = specials.map((i) => `${esc(G.seats[i].name)}: ${SPECIAL_NAMES[P[i].special.type]}`).join('<br>');
    banner(`${names}<small>Kartu spesial — langsung menang</small>`, true);
    sfx('scoop');
    push();
    await pause(2100);
    if (stale(gen)) return;
  }

  // baris demi baris
  for (let k = 0; k < 3; k++) {
    banner(`Baris ${ROW_NAMES[ROWS[k]]}`);
    markRow(k);
    sfx('flip');
    for (let i = 0; i < N; i++) {
      if (P[i].declared) continue;
      openRow(i, P[i].rows, k);
      const bonus = G.v.bonus(ROWS[k], res.values[i][k]);
      setCap(i, G.v.cat(res.values[i][k]) + (bonus ? ` (bonus +${bonus})` : ''), bonus > 0);
    }
    await pause(750);
    if (stale(gen)) return;
    for (let i = 0; i < N; i++) run[i] += res.rowTotals[i][k];
    push();
    await pause(1250);
    if (stale(gen)) return;
  }
  markRow(-1);
  for (let i = 0; i < N; i++) if (!P[i].declared) setCap(i, '');

  // tembus & tembus keliling
  const name = (i) => (i === 0 ? 'Kamu' : esc(G.seats[i].name));
  const extra = (d) => { run[d.a] += d.total - d.base; run[d.b] -= d.total - d.base; };
  if (res.sweep >= 0) {
    for (const d of res.duels) if (d.scoop && (d.scoop === 1 ? d.a : d.b) === res.sweep) extra(d);
    push();
    await bigWin(res.sweep);
    if (stale(gen)) return;
  }
  for (const d of res.duels) {
    if (!d.scoop) continue;
    const w = d.scoop === 1 ? d.a : d.b, l = d.scoop === 1 ? d.b : d.a;
    if (w === res.sweep) continue;
    extra(d);
    banner(`${name(w)} tembus ${name(l)}<small>poin ×2</small>`, true);
    sfx('scoop');
    push();
    await pause(1300);
    if (stale(gen)) return;
  }

  res.net.forEach((n, i) => setPts(i, n));
  if (G.mode === 'online') G.seats.forEach((s) => { s.shownTotal = s.total; });
  renderCoins();
  R.phase = 'result';
  showResult(res, deltas);
}

function showResult(res, deltas) {
  const net = res.net[0];
  sfx(net > 0 ? 'win' : net < 0 ? 'lose' : 'tap');
  $('#center').replaceChildren();
  const cell = (n) => `<td class="${cls(n)}">${n === 0 ? '0' : signed(n)}</td>`;
  const rows = others().map((o) => {
    const d = duelFor(res, 0, o);
    const who = `<td>${esc(G.seats[o].name)}</td>`;
    if (d.special) {
      const p = G.round.players[d.special === 'lose' ? o : 0];
      const txt = d.special === 'tie' ? 'Sama-sama kartu spesial (seri)' : `${SPECIAL_NAMES[p.special.type]} ${d.special === 'win' ? '(kamu)' : '(lawan)'}`;
      return `<tr>${who}<td colspan="4" class="mult" style="text-align:center">${txt}</td><td class="tot ${cls(d.total)}">${d.total === 0 ? '0' : signed(d.total)}</td></tr>`;
    }
    return `<tr>${who}${d.rows.map(cell).join('')}<td class="mult">${d.mult > 1 ? '×' + d.mult : ''}</td><td class="tot ${cls(d.total)}">${d.total === 0 ? '0' : signed(d.total)}</td></tr>`;
  }).join('');
  const sweepNote = res.sweep === 0 ? 'Kamu tembus keliling — semua poin ×4!' : res.sweep > 0 ? `${esc(G.seats[res.sweep].name)} tembus keliling.` : '';
  const coins = G.mode === 'online' && O?.ranked ? ' · <span id="rsCoins"></span>'
    : G.stake ? ` · <span class="${cls(deltas[0])}"><i class="coin"></i> ${deltas[0] === 0 ? '0' : signed(deltas[0])}</span>` : '';
  const all = others().map((i) => `<span>${esc(G.seats[i].name)} <b class="${cls(res.net[i])}">${res.net[i] === 0 ? '0' : signed(res.net[i])}</b></span>`).join('');
  const online = G.mode === 'online';
  const totals = online ? `<p class="rs-total">Total di meja ini: ${G.seats.map((s) => `${esc(s.name)} <b>${signed(s.total)}</b>`).join(' · ')}</p>` : '';
  const again = online ? '<button class="btn primary" id="btnAgain" type="button"></button>' : '<button class="btn primary" id="btnAgain" type="button">Main lagi</button>';
  const el = $('#result');
  el.classList.remove('peek');
  el.innerHTML = `<div class="rs-panel"><div class="rs-head"><h2 class="${net > 0 ? 'win' : net < 0 ? 'lose' : ''}">${net > 0 ? 'Menang' : net < 0 ? 'Kalah' : 'Seri'}</h2>
      <div class="rs-sum"><span class="${cls(net)}">${net === 0 ? '0' : signed(net)} poin</span>${coins}</div></div>
    <table class="rs-table"><thead><tr><th>Lawan</th><th>Atas</th><th>Tengah</th><th>Bawah</th><th>Tembus</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    ${sweepNote ? `<p class="rs-note">${sweepNote}</p>` : ''}
    <div class="rs-all">${all}</div>${totals}
    <div class="rs-btns"><button class="btn" id="btnExit" type="button">Keluar</button><button class="btn" id="btnPeek" type="button">Lihat meja</button>${again}</div></div>`;
  el.hidden = false;
  if (online) renderOnlineResultButtons();
}
$('#result').addEventListener('click', (e) => {
  if (e.target.closest('#btnExit')) { sfx('tap'); leaveTable(); return; }
  if (e.target.closest('#btnPeek')) {
    $('#result').classList.add('peek');
    $('#center').innerHTML = '<button class="btn primary" id="btnBack" type="button">Kembali ke hasil</button>';
    return;
  }
  if (e.target.closest('#btnAgain')) {
    if (G.mode === 'online') { sfx('tap'); O.session?.send({ t: 'next' }); return; }
    if (G.stake && wallet.coins < minEntry(G.stake)) {
      toast(`Koin tidak cukup untuk Meja ${G.stake} (minimal ${fmt(minEntry(G.stake))})`, 3200);
      leaveTable();
      return;
    }
    sfx('tap');
    startRound();
  }
});
$('#center').addEventListener('click', (e) => {
  if (!e.target.closest('#btnBack')) return;
  $('#result').classList.remove('peek');
  $('#center').replaceChildren();
});

$('#btnLeave').addEventListener('click', async () => {
  const R = G?.round;
  if (G?.mode === 'online') {
    const playing = O?.view && O.view.status !== 'lobby';
    const warn = O?.ranked ? 'Ronde yang sedang jalan tetap dihitung: kartumu disusun otomatis dan koinnya tetap diselesaikan.' : 'Kursimu akan dimainkan otomatis sampai permainan selesai.';
    if (playing && !(await ask('Keluar dari meja?', warn, 'Keluar', 'Lanjut main'))) return;
    if (G?.mode === 'online') leaveTable();
    return;
  }
  if (!R) return leaveTable();
  if (R.phase === 'arrange' || R.phase === 'wait') {
    const yes = await ask('Keluar dari meja?', G.stake
      ? 'Ronde ini tetap dihitung: kartumu disusun otomatis dan koin langsung diselesaikan.'
      : 'Ronde latihan ini akan ditinggalkan.', 'Keluar', 'Lanjut main');
    if (!yes || G?.round !== R) return;
    if (G.stake && (R.phase === 'arrange' || R.phase === 'wait')) {
      const me = R.players[0];
      if (!me.ready) { me.rows = G.v.solve(me.cards, 1)[0]; me.ready = true; }
      for (const i of others()) { clearTimeout(R.botTimers[i]); botReady.call(null, i); }
      // botReady → checkAllReady sudah memulai showdown (settle); kalau belum, selesaikan di sini
      const d = (R.result || settle()).deltas[0];
      toast(`Ronde diselesaikan otomatis: ${d === 0 ? '0' : signed(d)} koin`, 3200);
    }
  }
  leaveTable();
});

// ---------- meja online (bareng teman) ----------
// Server (worker/room.js) yang membagi kartu & menghitung; di sini hanya menampilkan viewFor() dari server.
// Kursi server diputar supaya kursi sendiri selalu di bawah (indeks tampilan 0).
const ROOM_KEY = 'capsa-room', NAME_KEY = 'capsa-name';
let O = null; // { session, code, seat, view, shown } — shown = nomor ronde yang hasilnya sudah ditampilkan
let onlineOn = false;
let rankedOn = false; // server punya sambungan ke server akun (config.ranked)
const toSeat = (d) => (d + O.seat) % O.n;
const myOnlineName = () => (account.state === 'in' ? account.name : load(NAME_KEY));
/** Detik tersisa sampai waktu server `at` (jam HP dikoreksi dengan selisih jam server). */
const secsUntil = (at) => Math.max(0, Math.ceil((at - (Date.now() + (O?.offset || 0))) / 1000));

/** Dialog isian satu baris. -> teks atau null kalau dibatalkan. */
function askText(title, body, { value = '', cls: fieldCls = '', max = 16, okLabel = 'Lanjut' } = {}) {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p>
      <input class="field ${fieldCls}" id="fldText" type="text" maxlength="${max}" autocomplete="off" autocapitalize="${fieldCls ? 'characters' : 'words'}" spellcheck="false" value="${esc(value)}">
      <div class="rs-btns"><button class="btn" data-a="no" type="button">Batal</button><button class="btn primary" data-a="yes" type="button">${esc(okLabel)}</button></div>`);
    const fld = $('#fldText', m);
    const done = (ok) => { m.onclick = null; m.onkeydown = null; closeModal(); res(ok ? fld.value : null); };
    fld.focus();
    fld.select();
    m.onkeydown = (e) => { if (e.key === 'Enter') done(true); };
    m.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a || e.target === m) done(a === 'yes');
    };
  });
}
async function ensureName() {
  const known = myOnlineName();
  if (known) return known;
  const typed = await askText('Nama kamu', 'Nama ini yang dilihat teman di meja.', { value: `Tamu ${100 + Math.floor(Math.random() * 900)}` });
  const name = (typed || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!name) return null;
  save(NAME_KEY, name);
  return name;
}

async function createOnline() {
  if (!load(TUT_KEY)) return showTutorial(createOnline);
  const name = await ensureName();
  if (!name) return;
  try {
    const { code } = await api('/rooms', { method: 'POST', body: { id: clientId(), name, avatar: myAvatar() } });
    connectOnline(code, name);
  } catch (e) {
    toast(e.message || 'Gagal membuat meja');
  }
}
async function joinOnline(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ROOM_CODE.test(code)) return toast('Kode meja terdiri dari 5 huruf/angka');
  let info;
  try { info = await api(`/rooms/${code}?id=${clientId()}`); } catch (e) { return toast(e.message || 'Server tidak menjawab'); }
  if (info.status === 'none') return toast('Meja tidak ditemukan');
  if (!info.mine && info.status !== 'lobby') return toast('Permainan di meja itu sudah mulai');
  if (!info.mine && !info.free) return toast('Meja penuh');
  if (!load(TUT_KEY)) return showTutorial(() => joinOnline(code));
  const name = await ensureName();
  if (name) connectOnline(code, name);
}
/** id = kunci kursi: id acak HP ini (meja teman) atau kunci dari server (Ranked). */
function connectOnline(code, name, id = clientId(), ranked = false) {
  if (G) return;
  O = { code, seat: 0, n: 4, view: null, shown: 0, session: null, ranked, spect: false, offset: 0, timer: 0 };
  save(ROOM_KEY, { code, id, ranked });
  O.timer = setInterval(tickOnline, 500);
  O.session = new RoomSession(code, { id, name, avatar: myAvatar() }, {
    onState: onOnlineState,
    onError: (msg) => { sfx('bad'); toast(msg, 3000); if (G?.round) G.round.pendingSubmit = false; if (O?.view) onOnlineState(O.view, 0); },
    onStatus: (st) => toast(st === 'reconnecting' ? 'Koneksi putus — menyambung lagi…' : 'Tersambung lagi', st === 'reconnecting' ? 8000 : 1500),
    onEnd: (msg) => { toast(msg, 3500); if (O) { O.session = null; leaveTable(); } },
  });
}
/** Masuk meja Ranked: minta tiket ke server akun, tukar di server Capsa jadi kode meja + kunci kursi. */
async function joinRanked(stake, six = 0) {
  if (account.state !== 'in') return toast('Masuk dengan Google dulu untuk main Ranked', 3000);
  if (account.coins !== null && account.coins < minEntry(stake)) return toast(`Meja ${stake} butuh saldo minimal ${fmt(minEntry(stake))} koin`, 3000);
  if (six ? !load(TUT6_KEY) : !load(TUT_KEY)) return (six ? showTutorial6 : showTutorial)(() => joinRanked(stake, six));
  try {
    const ticket = await fetchTicket();
    const { code, key } = await api('/ranked/join', { method: 'POST', body: { ticket, stake, six, avatar: myAvatar() } });
    connectOnline(code, account.name, key, true);
  } catch (e) {
    toast(e.message || 'Gagal masuk meja Ranked', 3500);
    refreshAccount();
  }
}
/** Hitung mundur di ruang tunggu & layar hasil Ranked. */
function tickOnline() {
  const r = O?.view?.ranked;
  if (!r) return;
  const c = $('#rkCount');
  if (c) c.textContent = secsUntil(r.startAt);
  if (O.view.status === 'result' && G?.round?.phase === 'result') renderOnlineResultButtons();
}
function sendSubmit() {
  const R = G.round, me = R.players[0];
  R.pendingSubmit = true;
  O.session?.send(me.declared ? { t: 'submit', special: true } : { t: 'submit', rows: me.rows });
}

function onOnlineState(v, serverNow) {
  if (!O) return;
  O.view = v;
  O.seat = Math.max(0, v.seat);
  O.n = v.seats.length; // 4 kursi (13 kartu) atau 3–8 (Ranked 6 kartu)
  O.ranked = !!v.ranked;
  O.spect = v.seat < 0; // Ranked: sudah pesan kursi tapi ronde sedang jalan, masuk di ronde berikutnya
  if (serverNow) O.offset = serverNow - Date.now();
  if (!G || G.mode !== 'online') {
    G = { mode: 'online', stake: 0, gen: 0, round: null, fast: false, v: v.six ? sixVariant(v.six) : V13, seats: Array.from({ length: O.n }, (_, d) => ({ name: '', avatar: 0, isMe: d === 0 })) };
    if (v.six) sixStrength(v.six); // tabel AI untuk tombol Saran
    closeModal();
    show('table');
    $('#table').classList.add('online');
    $('#table').classList.toggle('ranked', O.ranked);
    $('#table').classList.toggle('six', !!v.six);
    $('#tbInfo').innerHTML = O.ranked ? (v.six ? `Ranked 6 kartu · <b>${v.ranked.stake}</b> koin` : `Ranked · <b>${v.ranked.stake}</b> koin / poin`) : `Meja <b>${esc(O.code)}</b> · bareng teman`;
    buildSeats();
    $('#arrange').hidden = true;
    $('#result').hidden = true;
    $('#center').replaceChildren();
  }
  syncOnlineSeats(v);
  if (v.status === 'lobby') return renderWaitroom(v);
  if (O.spect) return renderSpectate(v);
  if (v.status === 'arrange') {
    if (G.round?.no !== v.round) return beginOnlineRound(v, serverNow);
    const R = G.round;
    if (v.mine) R.pendingSubmit = false;
    else if (R.phase === 'wait' && !R.pendingSubmit && !R.timedOut) {
      // server tidak memegang susunan kita (ditolak / dibatalkan): buka lagi layar susun
      renderHand(0, null);
      setCap(0, '');
      openArrange(false);
    }
    renderOppCount();
    return;
  }
  if (v.status === 'result' && v.last) {
    if (O.shown !== v.last.round) {
      O.shown = v.last.round;
      playOnlineResult(v);
    } else if (G.round?.phase === 'result') renderOnlineResultButtons();
  }
}

/** Nama, avatar, total poin, dan tanda status tiap kursi dari tampilan server. */
function syncOnlineSeats(v) {
  const pending = v.status === 'result' && v.last && G.round?.phase !== 'result'; // hasil ronde belum selesai ditampilkan
  for (let d = 0; d < O.n; d++) {
    const k = toSeat(d), s = v.seats[k], el = seatEl(d);
    const total = v.totals[k];
    const me = d === 0 && !O.spect;
    G.seats[d] = s
      ? { name: me ? 'Kamu' : s.name, avatar: s.avatar, isMe: me, total, shownTotal: pending ? total - v.last.net[k] : total, coins: me ? v.ranked?.coins ?? null : null }
      : { name: 'Kosong', avatar: 0, empty: true, total: 0, shownTotal: 0 };
    el.classList.toggle('empty', !s);
    el.classList.toggle('off', !!s && !s.bot && (!s.online || s.left));
    $('.nm b', el).textContent = (s && k === v.host && v.status === 'lobby' ? '★ ' : '') + G.seats[d].name; // ★ = pembuat meja
    const img = $('.ava img', el);
    if (s && img.getAttribute('src') !== avatarSrc(s.avatar)) img.src = avatarSrc(s.avatar);
    if (v.status === 'lobby') {
      el.querySelectorAll('.hrow').forEach((r) => r.replaceChildren());
      setCap(d, '');
      setTag(d, '');
      setPts(d, null);
    } else if (v.status === 'arrange' && (d !== 0 || O.spect)) {
      setTag(d, s.ready ? 'Siap' : s.left ? 'Otomatis' : !s.online ? 'Putus' : 'Menyusun…', !s.ready);
    }
  }
  renderCoins();
}

/** Ranked: kursi sudah dipesan tapi ronde sedang jalan — tonton sebentar, masuk di ronde berikutnya. */
function renderSpectate(v) {
  if (G.round) { clearRoundTimers(G.round); G.round = null; }
  $('#arrange').hidden = true;
  $('#result').hidden = true;
  for (let i = 0; i < O.n; i++) {
    if (!seatEl(i).querySelector('.hrow .card')) renderHand(i, null);
    setCap(i, '');
    setPts(i, null);
    if (v.status !== 'arrange') setTag(i, '');
  }
  $('#center').innerHTML = `<div class="banner">Kamu masuk di ronde berikutnya<small>Ronde ${v.round} sedang jalan</small></div>`;
}
function renderWaitroom(v) {
  if (G.round) { clearRoundTimers(G.round); G.round = null; }
  if (v.ranked) {
    const n = v.seats.filter(Boolean).length;
    $('#center').innerHTML = `<div class="waitroom"><small>Mencari pemain</small><div class="count" id="rkCount">${secsUntil(v.ranked.startAt)}</div>
      <p>${n} pemain di meja · kursi kosong diisi bot saat hitungan habis</p></div>`;
    return;
  }
  const host = v.host === v.seat;
  const n = v.seats.filter(Boolean).length;
  $('#center').innerHTML = `<div class="waitroom"><small>Kode meja</small><div class="code">${esc(O.code)}</div>
    <p>${n} dari 4 kursi terisi${n < 4 ? ' · kursi kosong diisi bot' : ''}</p>
    <div class="rs-btns"><button class="btn" id="btnShare" type="button">Bagikan link</button>${host ? '<button class="btn primary" id="btnStartOnline" type="button">Mulai</button>' : ''}</div>
    ${host ? '' : '<p>Menunggu pembuat meja memulai…</p>'}</div>`;
}
async function shareRoom() {
  const url = `${location.origin}${location.pathname}#room=${O.code}`;
  const text = `Main Capsa Kung2 bareng yuk! Kode meja: ${O.code}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Capsa Kung2', text, url }); return; }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Link meja disalin');
  } catch {
    toast(`Bagikan kode meja ini: ${O.code}`, 4000);
  }
}
$('#center').addEventListener('click', (e) => {
  if (!O) return;
  if (e.target.closest('#btnShare')) { sfx('tap'); shareRoom(); }
  if (e.target.closest('#btnStartOnline')) { sfx('tap'); O.session?.send({ t: 'start' }); }
});

function beginOnlineRound(v, serverNow) {
  ++G.gen; // hentikan animasi hasil ronde sebelumnya kalau masih jalan
  G.fast = false;
  if (G.round) clearRoundTimers(G.round);
  const R = (G.round = {
    no: v.round, phase: 'arrange', botTimers: [], tick: 0, result: null, pendingSubmit: false, timedOut: false,
    // jam di layar berhenti GRACE_MS sebelum batas server, supaya kiriman terakhir masih sempat sampai
    deadline: performance.now() + (v.deadline - serverNow) - GRACE_MS,
    players: Array.from({ length: O.n }, (_, d) => ({ cards: d === 0 ? v.hand : null, special: d === 0 ? G.v.special(v.hand) : null, rows: null, declared: false, ready: false })),
  });
  $('#result').hidden = true;
  $('#arrange').hidden = true;
  $('#center').replaceChildren();
  markRow(-1);
  for (let i = 0; i < O.n; i++) { renderHand(i, null, undefined, 'dealt'); setCap(i, ''); setPts(i, null); }
  sfx('deal');
  R.tick = setInterval(onTick, 200);
  const me = R.players[0];
  if (v.mine) {
    // masuk lagi setelah sempat mengirim susunan: langsung ke layar tunggu
    if (v.mine.special) me.declared = true;
    else { me.rows = v.mine.rows; A.slots = flat(v.mine.rows); }
    me.ready = true;
    A.hints = null; A.hintIdx = -1; A.sel = -1; A.note = '';
    afterMineReady();
  } else openArrange(true);
  renderOppCount();
  onTick();
}

function playOnlineResult(v) {
  if (G.round?.no !== v.last.round) {
    // masuk saat layar hasil (tidak ikut menyusun ronde ini)
    if (G.round) clearRoundTimers(G.round);
    ++G.gen;
    G.round = { no: v.last.round, phase: 'wait', botTimers: [], tick: 0, result: null };
  }
  G.round.players = Array.from({ length: O.n }, (_, d) => {
    const p = v.last.shown[toSeat(d)];
    return p.special
      ? { declared: true, special: { type: p.special, pts: SPECIAL[p.special], rows: p.rows }, rows: null, ready: true }
      : { declared: false, special: null, rows: p.rows, ready: true };
  });
  showdown(); // poin dihitung ulang di sini dari kartu yang dibuka server (aturannya sama)
}
function renderOnlineResultButtons() {
  const b = $('#btnAgain');
  if (!b || !O?.view) return;
  if (O.ranked) {
    // Ranked: ronde berikutnya jalan sendiri; koin ditampilkan dari jawaban server akun
    const v = O.view, last = v.last;
    b.disabled = true;
    b.textContent = last && !last.settled ? 'Menyelesaikan koin…' : `Ronde berikutnya ${secsUntil(v.ranked.nextAt)} dtk`;
    const c = $('#rsCoins');
    if (c && last && v.seat >= 0) {
      const d = last.deltas?.[v.seat] ?? 0;
      c.className = cls(d);
      c.innerHTML = last.failed ? 'koin tidak berubah (server akun bermasalah)' : `<i class="coin"></i> ${d === 0 ? '0' : signed(d)}${last.settled ? '' : ' …'}`;
    }
    return;
  }
  const host = O.view.host === O.view.seat;
  b.disabled = !host;
  b.textContent = host ? 'Ronde berikutnya' : 'Menunggu pembuat meja…';
}

$('#rankedTables').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ranked]');
  if (!b) return;
  sfx('tap');
  joinRanked(Number(b.dataset.ranked));
});
$('#rankedSixTables').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ranked-six]');
  if (!b) return;
  sfx('tap');
  joinRanked(Number(b.dataset.rankedSix), settings.sixN);
});
$('#btnCreate').addEventListener('click', () => { sfx('tap'); createOnline(); });
$('#btnJoin').addEventListener('click', async () => {
  sfx('tap');
  const code = await askText('Gabung meja', 'Masukkan kode meja dari temanmu.', { cls: 'code', max: 5, okLabel: 'Gabung' });
  if (code) joinOnline(code);
});

/** Saat boot: buka link meja (#room=KODE), atau kembali ke meja online yang ditinggal. */
async function resumeOnline() {
  const fromLink = (location.hash.match(/^#room=([A-Za-z0-9]{5})$/) || [])[1];
  if (fromLink) history.replaceState(null, '', location.pathname + location.search);
  if (G) {
    if (fromLink) toast('Selesaikan ronde ini dulu, lalu buka lagi link mejanya', 4000);
    return;
  }
  if (fromLink) return joinOnline(fromLink);
  const saved = load(ROOM_KEY);
  const sv = typeof saved === 'string' ? { code: saved, id: clientId(), ranked: false } : saved; // bentuk lama: kode saja
  if (!sv || typeof sv.code !== 'string' || !ROOM_CODE.test(sv.code) || typeof sv.id !== 'string' || !/^[a-z0-9]{12,40}$/.test(sv.id)) return save(ROOM_KEY, null);
  try {
    const info = await api(`/rooms/${sv.code}?id=${sv.id}`);
    if (info.mine && !G) connectOnline(sv.code, myOnlineName() || 'Pemain', sv.id, !!info.ranked);
    else save(ROOM_KEY, null);
  } catch { /* server tidak menjawab: coba lagi saat dibuka berikutnya */ }
}

// ---------- PWA: service worker + cek versi baru ----------
let bootVersion = null;
async function liveVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    return r.ok ? (await r.json()).v : null;
  } catch { return null; }
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* tanpa SW game tetap jalan */ });
  liveVersion().then((v) => { bootVersion = v; });
}
/** Di lobi (tidak ada ronde yang hilang): kalau sudah ada versi baru, muat ulang supaya langsung terpakai. */
async function checkUpdate() {
  if (!bootVersion || G) return;
  const v = await liveVersion();
  if (v && v !== bootVersion && !G) location.reload();
}

// ---------- mulai ----------
renderEmblem();
renderLobby();
show('lobby');
document.addEventListener('visibilitychange', () => { if (!document.hidden && !G) { renderLobby(); checkUpdate(); refreshAccount(); } });
installErrorLog(() => bootVersion);
{
  // kembali dari login Google (server Mahjong mengarahkan ke ?login=ok): sapa pemain, lalu bersihkan alamat
  const justLoggedIn = new URLSearchParams(location.search).get('login') === 'ok';
  if (justLoggedIn) history.replaceState(null, '', location.pathname);
  refreshAccount().then((a) => {
    if (!justLoggedIn) return;
    toast(a.state === 'in' ? `Masuk sebagai ${a.name}` : 'Login belum berhasil — coba lagi', 3000);
  });
}
{
  const sv = loadRound();
  if (sv) enterTable(sv.stake, sv, sv.six || 0);
}
onlineConfig().then((cfg) => {
  onlineOn = cfg.online;
  rankedOn = cfg.ranked;
  if (!G) renderLobby();
  if (cfg.online) resumeOnline();
});
