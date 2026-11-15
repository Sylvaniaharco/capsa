// Capsa Kung2 — titik masuk & alur layar: lobi → meja → susun kartu → buka kartu → hasil.
import { deal, mulberry32, rankOf, suitOf, parseCards } from './engine/cards.js';
import { evalRow, catName, orderRow } from './engine/hands.js';
import { detectSpecial } from './engine/special.js';
import { scoreRound, duelFor, rowBonus } from './engine/scoring.js';
import { solve } from './engine/arrange.js';
import { ROWS, ROW_NAMES, SPECIAL_NAMES, ARRANGE_SECONDS } from './engine/rules.js';
import { STAKES, minEntry, normalizeWallet, coinDelta, applyDelta, isBroke, START_COINS } from './engine/wallet.js';
import { pickBots, clampAvatar, AVATAR_COUNT } from './engine/roster.js';
import { cardEl, backEl } from './ui/cardview.js';
import { sfx, setSound } from './ui/sfx.js';
import { canShowInstall, installApp, onInstallChange } from './ui/install.js';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const fmt = (n) => Math.round(n).toLocaleString('id-ID');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- simpanan di HP ----------
const WALLET_KEY = 'capsa-wallet', SET_KEY = 'capsa-set', ROUND_KEY = 'capsa-round', TUT_KEY = 'capsa-tut';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* mode privat: jalan tanpa simpanan */ } };

let wallet = normalizeWallet(load(WALLET_KEY), Date.now());
const settings = { sound: true, ...(load(SET_KEY) || {}) };
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
  note.textContent = `Koin kurang dari ${fmt(minEntry(STAKES[0]))}. Saldo diisi lagi jadi ${fmt(START_COINS)} besok jam 00.01 WIB. Sementara itu main di meja Latihan dulu.`;
  $('#tables').innerHTML = TABLES.map((t) => {
    const locked = t.stake > 0 && wallet.coins < minEntry(t.stake);
    const sub = t.stake === 0 ? t.sub : locked ? `Butuh ${fmt(minEntry(t.stake))} koin` : `${t.sub} · min ${fmt(minEntry(t.stake))}`;
    return `<button class="tbl${locked ? ' locked' : ''}" data-stake="${t.stake}" type="button" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="chip" style="--c:${t.color}"><i>${t.chip}</i></span><span><b>${t.name}</b><small>${sub}</small></span></button>`;
  }).join('');
  const sb = $('#btnSound');
  sb.textContent = `Suara: ${settings.sound ? 'nyala' : 'mati'}`;
  sb.setAttribute('aria-pressed', String(settings.sound));
  $('#btnInstall').hidden = !canShowInstall();
}
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

/** saved = ronde yang belum selesai (ROUND_KEY): lawan & kartunya sama seperti saat ditinggal. */
function enterTable(stake, saved = null) {
  const mine = myAvatar();
  const unit = stake || 5;
  G = {
    stake, gen: 0, round: null, fast: false,
    seats: [
      { name: 'Kamu', avatar: mine, isMe: true },
      ...(saved ? saved.seats : pickBots(3, [mine], Math.random).map((b) => ({ ...b, coins: unit * (300 + Math.floor(Math.random() * 1700)) }))),
    ],
  };
  show('table');
  $('#tbInfo').innerHTML = stake ? `Meja <b>${stake}</b> koin / poin` : 'Meja <b>Latihan</b> · tanpa koin';
  G.seats.forEach((s, i) => {
    seatEl(i).innerHTML = `<div class="who"><div class="ava"><img src="${avatarSrc(s.avatar)}" alt="" draggable="false"></div>
      <div class="nm"><b>${esc(s.name)}</b><span class="coins"><i class="coin"></i> <span data-coins></span></span></div></div>
      <div class="handwrap"><div class="hand"><div class="hrow"></div><div class="hrow"></div><div class="hrow"></div></div><div class="cap"></div><div class="tag"></div></div>
      <div class="pts"></div>`;
  });
  renderCoins();
  startRound(saved);
}
function renderCoins() {
  G.seats.forEach((s, i) => { $('[data-coins]', seatEl(i)).textContent = fmt(s.isMe ? wallet.coins : s.coins); });
}
function leaveTable() {
  if (G?.round) clearRoundTimers(G.round);
  G = null;
  save(ROUND_KEY, null);
  $('#arrange').hidden = true;
  $('#result').hidden = true;
  $('#center').replaceChildren();
  renderLobby();
  show('lobby');
}

/** Gambar tangan satu kursi. rows = {top,mid,bot} | null (tertutup semua); open = [atas,tengah,bawah] sudah dibuka? */
function renderHand(i, rows, open = [false, false, false], anim = '') {
  const els = seatEl(i).querySelectorAll('.hrow');
  ROWS.forEach((r, k) => {
    const n = k === 0 ? 3 : 5;
    const cards = Array.from({ length: n }, (_, j) => {
      const el = rows && open[k] ? cardEl(rows[r][j], 'mini') : backEl('mini');
      if (anim) { el.classList.add(anim); el.style.setProperty('--i', k * 4 + j); }
      return el;
    });
    els[k].replaceChildren(...cards);
  });
}
function openRow(i, rows, k) {
  const row = seatEl(i).querySelectorAll('.hrow')[k];
  row.replaceChildren(...rows[ROWS[k]].map((c) => { const el = cardEl(c, 'mini'); el.classList.add('flip'); return el; }));
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
  for (let i = 0; i < 4; i++) {
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
  if (!R || (R.phase !== 'arrange' && R.phase !== 'wait')) return;
  save(ROUND_KEY, {
    v: 1, stake: G.stake, seed: R.seed, deadlineAt: R.deadlineAt, slots: A.slots,
    seats: G.seats.slice(1).map(({ name, avatar, coins }) => ({ name, avatar, coins })),
  });
}
function loadRound() {
  const sv = load(ROUND_KEY);
  const ok = sv && sv.v === 1 && [0, ...STAKES].includes(sv.stake) && Number.isInteger(sv.seed) && Number.isFinite(sv.deadlineAt)
    && Array.isArray(sv.seats) && sv.seats.length === 3
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
    players: deal(rng).map((cards) => ({ cards, special: detectSpecial(cards), rows: null, declared: false, ready: false })),
  });
  $('#result').hidden = true;
  $('#arrange').hidden = true;
  $('#center').replaceChildren();
  markRow(-1);
  for (let i = 0; i < 4; i++) { renderHand(i, null, undefined, 'dealt'); setCap(i, ''); setTag(i, ''); setPts(i, null); }
  sfx('deal');
  await sleep(750);
  if (stale(gen)) return;

  R.phase = 'arrange';
  for (let i = 1; i < 4; i++) {
    setTag(i, 'Menyusun…', true);
    R.botTimers[i] = setTimeout(() => botReady(i), 3000 + Math.random() * 11000);
  }
  R.deadlineAt = saved ? saved.deadlineAt : Date.now() + ARRANGE_SECONDS * 1000;
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
    const opts = solve(p.cards);
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
  const n = R.players.slice(1).filter((p) => p.ready).length;
  $('#arOpp').textContent = `Lawan siap ${n}/3`;
}

function onTick() {
  const R = G?.round;
  if (!R || (R.phase !== 'arrange' && R.phase !== 'wait')) return;
  const left = Math.max(0, R.deadline - performance.now());
  const sec = Math.ceil(left / 1000);
  for (const t of document.querySelectorAll('.timer')) {
    t.style.setProperty('--p', left / (ARRANGE_SECONDS * 1000));
    t.firstElementChild.textContent = sec;
    t.classList.toggle('low', sec <= 5);
  }
  if (sec <= 5 && sec !== R.lastSec && sec > 0 && R.phase === 'arrange') sfx('tick');
  R.lastSec = sec;
  if (left <= 0) timeUp();
}
function timeUp() {
  const R = G.round;
  if (!R.players[0].ready) {
    const ok = commitMine(true);
    toast(ok === 'auto' ? 'Waktu habis — kartu disusun otomatis' : 'Waktu habis');
  }
  for (let i = 1; i < 4; i++) { clearTimeout(R.botTimers[i]); botReady(i); }
  checkAllReady();
}
function checkAllReady() {
  const R = G?.round;
  if (!R || (R.phase !== 'arrange' && R.phase !== 'wait')) return;
  if (R.players.every((p) => p.ready)) showdown();
}

// ---------- layar susun ----------
const A = { slots: [], sel: -1, hints: null, hintIdx: -1, sortMode: 0, drag: null, note: '' };
const ROW_RANGE = { top: [0, 3], mid: [3, 8], bot: [8, 13] };
const rowsOf = (slots) => ({ top: slots.slice(0, 3), mid: slots.slice(3, 8), bot: slots.slice(8, 13) });
const flat = (r) => [...r.top, ...r.mid, ...r.bot];
const byRank = (a, b) => rankOf(b) - rankOf(a) || suitOf(b) - suitOf(a);

function openArrange(fresh) {
  const R = G.round, me = R.players[0];
  if (fresh) {
    const s = [...me.cards].sort(byRank); // awal: urut dari besar — 5 terbesar di bawah
    A.slots = flat({ bot: s.slice(0, 5), mid: s.slice(5, 10), top: s.slice(10) });
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
  $('#arrange').hidden = false;
  renderArrange(false);
  renderOppCount();
}

function renderArrange(animate = true) {
  const box = $('#arrange');
  const before = new Map();
  if (animate) for (const el of box.querySelectorAll('.card')) before.set(el.dataset.c, el.getBoundingClientRect());
  const have = new Map([...box.querySelectorAll('.card')].map((el) => [Number(el.dataset.c), el]));
  for (const [row, [from, to]] of Object.entries(ROW_RANGE)) {
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
  const v = ROWS.map((row) => evalRow(r[row]));
  const bad = [v[0] > v[1], v[0] > v[1] || v[1] > v[2], v[1] > v[2]];
  ROWS.forEach((row, k) => {
    const el = $(`.arow[data-row="${row}"]`, box);
    el.classList.toggle('bad', bad[k]);
    const bonus = rowBonus(row, v[k]);
    $('.alabel', el).innerHTML = `<span class="rn">${ROW_NAMES[row]}</span><span class="hn">${catName(v[k])}</span>${bonus ? `<span class="bn">bonus +${bonus}</span>` : ''}`;
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
function tidy() { A.slots = flat(Object.fromEntries(ROWS.map((r) => [r, orderRow(rowsOf(A.slots)[r])]))); }
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
  A.hints ||= solve(me.cards, { keep: 3 });
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
  A.slots = flat({ bot: s.slice(0, 5), mid: s.slice(5, 10), top: s.slice(10) });
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
  afterMineReady();
});
arBox.addEventListener('click', (e) => {
  if (!e.target.closest('#btnSpecial')) return;
  const me = G.round.players[0];
  me.declared = true; me.ready = true;
  sfx('scoop');
  afterMineReady();
});

/** Kunci susunan saya. force = waktu habis: susunan tidak sah diganti susunan terbaik. -> 'mine' | 'auto' */
function commitMine(force) {
  const me = G.round.players[0];
  let how = 'mine';
  if (!renderArrange(false)) {
    if (!force) return null;
    A.slots = flat(solve(me.cards, { keep: 1 })[0]);
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
  // lawan yang belum siap dipercepat supaya tidak lama menunggu
  for (let i = 1; i < 4; i++) {
    if (R.players[i].ready) continue;
    clearTimeout(R.botTimers[i]);
    R.botTimers[i] = setTimeout(() => botReady(i), 500 + Math.random() * 1300);
  }
  const c = $('#center');
  c.innerHTML = `<div class="waitbox"><div class="timer"><b></b></div><div class="status">Menunggu lawan…</div><button class="btn" id="btnRedo" type="button">Susun ulang</button></div>`;
  onTick();
  checkAllReady();
}
$('#center').addEventListener('click', (e) => {
  if (!e.target.closest('#btnRedo')) return;
  const R = G?.round;
  if (!R || R.phase !== 'wait') return;
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
  const res = scoreRound(R.players.map((p) => (p.declared ? { special: p.special } : { rows: p.rows })));
  const deltas = res.net.map((n) => coinDelta(n, G.stake));
  if (G.stake) {
    const beforeCoins = wallet.coins;
    wallet.coins = applyDelta(wallet.coins, deltas[0]);
    deltas[0] = wallet.coins - beforeCoins; // saldo tidak bisa minus
    saveWallet();
    for (let i = 1; i < 4; i++) {
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

async function showdown() {
  const gen = G.gen, R = G.round;
  R.phase = 'show';
  $('#arrange').hidden = true;
  const { res, deltas } = settle();
  const P = R.players;
  const run = [0, 0, 0, 0];
  const push = () => run.forEach((n, i) => setPts(i, n));

  for (let i = 0; i < 4; i++) { renderHand(i, null); setTag(i, ''); setCap(i, ''); }
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
    for (let i = 0; i < 4; i++) {
      if (P[i].declared) continue;
      openRow(i, P[i].rows, k);
      const bonus = rowBonus(ROWS[k], res.values[i][k]);
      setCap(i, catName(res.values[i][k]) + (bonus ? ` (bonus +${bonus})` : ''));
    }
    await pause(750);
    if (stale(gen)) return;
    for (let i = 0; i < 4; i++) run[i] += res.rowTotals[i][k];
    push();
    await pause(1250);
    if (stale(gen)) return;
  }
  markRow(-1);
  for (let i = 0; i < 4; i++) if (!P[i].declared) setCap(i, '');

  // tembus & tembus keliling
  const name = (i) => (i === 0 ? 'Kamu' : esc(G.seats[i].name));
  const extra = (d) => { run[d.a] += d.total - d.base; run[d.b] -= d.total - d.base; };
  if (res.sweep >= 0) {
    for (const d of res.duels) if (d.scoop && (d.scoop === 1 ? d.a : d.b) === res.sweep) extra(d);
    banner(`${name(res.sweep)} TEMBUS KELILING!<small>semua poinnya ×4</small>`, true);
    sfx('scoop');
    push();
    await pause(1900);
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
  renderCoins();
  R.phase = 'result';
  showResult(res, deltas);
}

function showResult(res, deltas) {
  const net = res.net[0];
  sfx(net > 0 ? 'win' : net < 0 ? 'lose' : 'tap');
  $('#center').replaceChildren();
  const cell = (n) => `<td class="${cls(n)}">${n === 0 ? '0' : signed(n)}</td>`;
  const rows = [1, 2, 3].map((o) => {
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
  const coins = G.stake ? ` · <span class="${cls(deltas[0])}"><i class="coin"></i> ${deltas[0] === 0 ? '0' : signed(deltas[0])}</span>` : '';
  const others = [1, 2, 3].map((i) => `<span>${esc(G.seats[i].name)} <b class="${cls(res.net[i])}">${res.net[i] === 0 ? '0' : signed(res.net[i])}</b></span>`).join('');
  const el = $('#result');
  el.classList.remove('peek');
  el.innerHTML = `<div class="rs-panel"><div class="rs-head"><h2 class="${net > 0 ? 'win' : net < 0 ? 'lose' : ''}">${net > 0 ? 'Menang' : net < 0 ? 'Kalah' : 'Seri'}</h2>
      <div class="rs-sum"><span class="${cls(net)}">${net === 0 ? '0' : signed(net)} poin</span>${coins}</div></div>
    <table class="rs-table"><thead><tr><th>Lawan</th><th>Atas</th><th>Tengah</th><th>Bawah</th><th>Tembus</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    ${sweepNote ? `<p class="rs-note">${sweepNote}</p>` : ''}
    <div class="rs-all">${others}</div>
    <div class="rs-btns"><button class="btn" id="btnExit" type="button">Keluar</button><button class="btn" id="btnPeek" type="button">Lihat meja</button><button class="btn primary" id="btnAgain" type="button">Main lagi</button></div></div>`;
  el.hidden = false;
}
$('#result').addEventListener('click', (e) => {
  if (e.target.closest('#btnExit')) { sfx('tap'); leaveTable(); return; }
  if (e.target.closest('#btnPeek')) {
    $('#result').classList.add('peek');
    $('#center').innerHTML = '<button class="btn primary" id="btnBack" type="button">Kembali ke hasil</button>';
    return;
  }
  if (e.target.closest('#btnAgain')) {
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
  if (!R) return leaveTable();
  if (R.phase === 'arrange' || R.phase === 'wait') {
    const yes = await ask('Keluar dari meja?', G.stake
      ? 'Ronde ini tetap dihitung: kartumu disusun otomatis dan koin langsung diselesaikan.'
      : 'Ronde latihan ini akan ditinggalkan.', 'Keluar', 'Lanjut main');
    if (!yes || G?.round !== R) return;
    if (G.stake && (R.phase === 'arrange' || R.phase === 'wait')) {
      const me = R.players[0];
      if (!me.ready) { me.rows = solve(me.cards, { keep: 1 })[0]; me.ready = true; }
      for (let i = 1; i < 4; i++) { clearTimeout(R.botTimers[i]); botReady.call(null, i); }
      // botReady → checkAllReady sudah memulai showdown (settle); kalau belum, selesaikan di sini
      const d = (R.result || settle()).deltas[0];
      toast(`Ronde diselesaikan otomatis: ${d === 0 ? '0' : signed(d)} koin`, 3200);
    }
  }
  leaveTable();
});

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
document.addEventListener('visibilitychange', () => { if (!document.hidden && !G) { renderLobby(); checkUpdate(); } });
{
  const sv = loadRound();
  if (sv) enterTable(sv.stake, sv);
}
