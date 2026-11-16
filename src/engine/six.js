// Capsa 6 kartu: tiap pemain 6 kartu, susun 1-2-3 (atas 1, tengah 2, bawah 3), 3–8 pemain. Murni (tanpa DOM).
// Dek dipendekkan dari As ke bawah: jumlah nilai kartu = ceil(6 × pemain / 4), sisanya tidak dibagi (tidak ketahuan).
// Lambang dipakai kalau nilai kartunya sama (♠ > ♥ > ♣ > ♦), jadi dua pemain tidak pernah seri di satu baris.
import { rankOf, suitOf, mulberry32 } from './cards.js';
import { SIX, SIX_CAT, ROWS } from './rules.js';

export { SIX, SIX_CAT };
export const SIX_CAT_NAMES = ['Kartu Tinggi', 'Pair', 'Straight', 'Flush', 'Tris', 'Straight Flush', 'Royal Flush'];

export const sixRankCount = (n) => Math.ceil((n * 6) / 4);
/** Rank terkecil yang dipakai (0 = "2" … 12 = "A"). 3 pemain: 8 (= "10"), 8 pemain: 1 (= "3"). */
export const sixLowRank = (n) => 13 - sixRankCount(n);
export const validPlayers = (n) => Number.isInteger(n) && n >= SIX.minPlayers && n <= SIX.maxPlayers;

/** Kartu yang dipakai untuk n pemain, urut naik. */
export function sixDeck(n) {
  if (!validPlayers(n)) throw new Error('Pemain 3–8');
  const low = sixLowRank(n);
  return Array.from({ length: (13 - low) * 4 }, (_, i) => low * 4 + i);
}

/** Bagi 6 kartu ke n pemain. -> { hands: [[6 kartu] × n], rest: [kartu sisa] } */
export function dealSix(rng, n) {
  const d = sixDeck(n);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return { hands: Array.from({ length: n }, (_, p) => d.slice(p * 6, p * 6 + 6)), rest: d.slice(n * 6) };
}

// Nilai = kategori, lalu nilai kartu (rank+1, 0 = tidak ada kartu), lalu lambang kartu penentu. Makin besar makin kuat.
// Baris beda panjang tetap bisa dibandingkan (untuk cek bawah ≥ tengah ≥ atas), sama seperti di capsa 13 kartu.
const B = 14;
const pack = (cat, a = 0, b = 0, c = 0, s = 0) => (((cat * B + a) * B + b) * B + c) * 4 + s;
export const sixCatOf = (v) => Math.floor(v / (B * B * B * 4));
export const sixCatName = (v) => SIX_CAT_NAMES[sixCatOf(v)];
/** Rank kartu penentu (0..12), mis. rank pair. */
const leadRank = (v) => Math.floor(v / (B * B * 4)) % B - 1;

/** Kartu urut dari kuat: rank turun, lalu lambang turun. */
const desc = (cards) => [...cards].sort((a, b) => b - a);

/** Nilai satu baris (1, 2, atau 3 kartu). n = jumlah pemain (tidak mengubah nilai sekarang; tetap diterima supaya pemanggil seragam). */
export function evalSix(cards, n) {
  const c = desc(cards);
  const r = c.map(rankOf);
  if (c.length === 1) return pack(SIX_CAT.HIGH, r[0] + 1, 0, 0, suitOf(c[0]));
  if (c.length === 2) {
    if (r[0] === r[1]) return pack(SIX_CAT.PAIR, r[0] + 1, 0, 0, suitOf(c[0]));
    return pack(SIX_CAT.HIGH, r[0] + 1, r[1] + 1, 0, suitOf(c[0]));
  }
  if (c.length !== 3) throw new Error('Baris 1–3 kartu');
  if (r[0] === r[2]) return pack(SIX_CAT.TRIPS, r[0] + 1, 0, 0, suitOf(c[0]));
  if (r[0] === r[1]) return pack(SIX_CAT.PAIR, r[0] + 1, r[2] + 1, 0, suitOf(c[0]));
  if (r[1] === r[2]) return pack(SIX_CAT.PAIR, r[1] + 1, r[0] + 1, 0, suitOf(c[1]));
  const flush = suitOf(c[0]) === suitOf(c[1]) && suitOf(c[1]) === suitOf(c[2]);
  // straight hanya tiga nilai berurutan; As selalu kartu tertinggi (tidak bisa jadi kartu kecil, keputusan Teddy)
  if (r[0] - r[2] === 2) {
    const s = suitOf(c[0]);
    if (flush) return r[0] === 12 ? pack(SIX_CAT.ROYAL, 13, 0, 0, s) : pack(SIX_CAT.STRAIGHT_FLUSH, r[0] + 1, 0, 0, s);
    return pack(SIX_CAT.STRAIGHT, r[0] + 1, 0, 0, s);
  }
  return pack(flush ? SIX_CAT.FLUSH : SIX_CAT.HIGH, r[0] + 1, r[1] + 1, r[2] + 1, suitOf(c[0]));
}

export function sixBonus(row, v) {
  const cat = sixCatOf(v);
  if (row === 'mid') return cat === SIX_CAT.PAIR && leadRank(v) === 12 ? SIX.bonus.mid.pairAce : 0;
  return SIX.bonus[row][cat] || 0;
}

/** Aturan hitung untuk scoreRound(players, sixRules(n)). */
const RULES = new Map();
export function sixRules(n) {
  if (!RULES.has(n)) {
    RULES.set(n, {
      evalRow: (cards) => evalSix(cards, n), rowBonus: sixBonus,
      scoopMult: SIX.scoopMult, sweepMult: SIX.sweepMult, sweepMaxPlayers: SIX.sweepMaxPlayers,
    });
  }
  return RULES.get(n);
}

/** Susunan sah: ukuran 1-2-3 dan bawah ≥ tengah ≥ atas. */
export function isValidSix(rows, n) {
  if (rows?.top?.length !== 1 || rows.mid?.length !== 2 || rows.bot?.length !== 3) return false;
  const m = evalSix(rows.mid, n);
  return evalSix(rows.top, n) <= m && m <= evalSix(rows.bot, n);
}

/** Urutan tampil satu baris: kembar dulu, lalu kuat ke lemah. */
export function orderSix(cards) {
  const cnt = new Map();
  for (const x of cards) cnt.set(rankOf(x), (cnt.get(rankOf(x)) || 0) + 1);
  return [...cards].sort((a, b) => cnt.get(rankOf(b)) - cnt.get(rankOf(a)) || b - a);
}

// 60 cara bagi 6 kartu: 3 ke bawah, 2 dari sisa ke tengah, 1 ke atas (indeks kartu).
const SPLITS = [];
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
  const rest = [0, 1, 2, 3, 4, 5].filter((x) => x !== a && x !== b && x !== c);
  for (let t = 0; t < 3; t++) SPLITS.push({ bot: [a, b, c], mid: rest.filter((_, k) => k !== t), top: [rest[t]] });
}

/** Susunan cepat & pasti sah: bawah = 3 kartu terkuat, tengah = 2 terkuat dari sisa, atas = sisanya. */
export function quickSix(cards, n) {
  if (cards.length !== 6) throw new Error('Butuh 6 kartu');
  let best = null, bv = -1;
  for (const s of SPLITS) {
    const v = evalSix(s.bot.map((i) => cards[i]), n);
    if (v > bv) { bv = v; best = s.bot; }
  }
  const rest = cards.filter((_, i) => !best.includes(i));
  let mid = null, mv = -1;
  for (let i = 0; i < 3; i++) {
    const m = rest.filter((_, k) => k !== i);
    const v = evalSix(m, n);
    if (v > mv) { mv = v; mid = i; }
  }
  const rows = { top: [rest[mid]], mid: rest.filter((_, k) => k !== mid), bot: best.map((i) => cards[i]) };
  return { top: orderSix(rows.top, n), mid: orderSix(rows.mid, n), bot: orderSix(rows.bot, n) };
}

// ---------- AI ----------
// Peluang menang tiap baris melawan satu lawan = posisi nilai baris itu di sebaran nilai baris lawan.
// Sebarannya dibuat sekali per jumlah pemain dari ronde acak berseed tetap (jadi hasil AI bisa diulang dari seed ronde):
// putaran 1 lawan menyusun pakai quickSix, putaran 2 lawan menyusun pakai AI hasil putaran 1.
const TABLES = new Map();
const SAMPLE_DEALS = 400;
function buildTable(n, arrange) {
  const t = { top: [], mid: [], bot: [] };
  const rng = mulberry32(0x5eed + n * 131);
  for (let k = 0; k < SAMPLE_DEALS; k++) {
    for (const h of dealSix(rng, n).hands) {
      const rows = arrange(h);
      for (const row of ROWS) t[row].push(evalSix(rows[row], n));
    }
  }
  for (const row of ROWS) t[row] = Int32Array.from(t[row]).sort();
  return t;
}
export function sixStrength(n) {
  if (!TABLES.has(n)) {
    const first = buildTable(n, (h) => quickSix(h, n));
    TABLES.set(n, buildTable(n, (h) => solveSix(h, n, { keep: 1, table: first })[0]));
  }
  return TABLES.get(n);
}
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }

/**
 * solveSix(6 kartu, n, { keep }) -> susunan sah terbaik, urut dari perkiraan poin tertinggi melawan satu lawan,
 * satu per "bentuk" (kategori bawah/tengah + kartu atas) supaya pilihan Saran benar-benar beda.
 * Tiap elemen: { top, mid, bot, ev, values:[atas,tengah,bawah] }.
 */
export function solveSix(cards, n, { keep = 3, table = null } = {}) {
  if (cards.length !== 6) throw new Error('Butuh 6 kartu');
  const T = table || sixStrength(n);
  const best = new Map();
  for (const s of SPLITS) {
    const rows = { top: s.top.map((i) => cards[i]), mid: s.mid.map((i) => cards[i]), bot: s.bot.map((i) => cards[i]) };
    const v = ROWS.map((row) => evalSix(rows[row], n));
    if (v[0] > v[1] || v[1] > v[2]) continue;
    let ev = 0, all = 1, none = 1, gain = 0;
    ROWS.forEach((row, k) => {
      const w = lowerBound(T[row], v[k]) / T[row].length, g = 1 + sixBonus(row, v[k]);
      ev += w * g - (1 - w);
      all *= w; none *= 1 - w; gain += g;
    });
    ev += all * gain - none * 3; // tembus: poin dobel / kena tembus
    const key = sixCatOf(v[2]) * 100 + sixCatOf(v[1]) * 20 + rankOf(rows.top[0]);
    const cur = best.get(key);
    if (!cur || ev > cur.ev) best.set(key, { ev, rows, values: v });
  }
  return [...best.values()]
    .sort((x, y) => y.ev - x.ev)
    .slice(0, keep)
    .map(({ ev, rows, values }) => ({ top: orderSix(rows.top, n), mid: orderSix(rows.mid, n), bot: orderSix(rows.bot, n), ev, values }));
}
