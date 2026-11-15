// Pencari susunan terbaik dari 13 kartu (dipakai AI lawan, tombol saran, dan susun otomatis saat waktu habis).
// Semua 72.072 cara bagi (5 bawah, 5 tengah, 3 atas) dicoba; tiap susunan sah dinilai dengan perkiraan poin
// melawan satu lawan: peluang menang/kalah tiap baris (tabel STRENGTH hasil simulasi) + bonus + peluang tembus.
import { eval3, eval5, catOf, orderRow, CAT } from './hands.js';
import { rowBonus } from './scoring.js';
import { STRENGTH } from './strength-data.js';

const FULL = (1 << 13) - 1;
const MASKS5 = [], MASKS3 = [];
for (let m = 0; m <= FULL; m++) {
  let c = 0;
  for (let x = m; x; x &= x - 1) c++;
  if (c === 5) MASKS5.push(m);
  else if (c === 3) MASKS3.push(m);
}
// 56 cara ambil 5 dari 8 sisa kartu (sebagai mask 8 bit)
const C8 = [];
for (let m = 0; m < 256; m++) {
  let c = 0;
  for (let x = m; x; x &= x - 1) c++;
  if (c === 5) C8.push(m);
}

function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }
function upperBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; } return lo; }

/** Peluang [menang, kalah] baris `row` bernilai v, dari tabel hasil simulasi. */
export function tableProb(row, v, table = STRENGTH) {
  const a = table[row];
  if (!a.length) return crudeProb(row, v);
  return [lowerBound(a, v) / a.length, 1 - upperBound(a, v) / a.length];
}

// Perkiraan kasar per kategori (hanya untuk titik awal kalibrasi / kalau tabel kosong).
const CRUDE = {
  top: [[0, 0.35], [0.35, 0.97], null, [0.97, 1]],
  mid: [[0, 0.1], [0.1, 0.5], [0.5, 0.72], [0.72, 0.8], [0.8, 0.88], [0.88, 0.95], [0.95, 0.99], [0.99, 1], [0.995, 1], [0.999, 1]],
  bot: [[0, 0.01], [0.01, 0.03], [0.03, 0.2], [0.2, 0.28], [0.28, 0.5], [0.5, 0.75], [0.75, 0.96], [0.96, 0.99], [0.99, 1], [0.999, 1]],
};
export function crudeProb(row, v) {
  const cat = catOf(v);
  const [lo, hi] = CRUDE[row][cat];
  const frac = (v / 14 ** 5 - cat); // 0..1 di dalam kategori (kicker pertama paling berpengaruh)
  const p = lo + (hi - lo) * frac;
  return [p, 1 - p];
}

/**
 * solve(cards13, { prob, keep }) -> daftar susunan sah terbaik, urut dari perkiraan poin tertinggi,
 * satu per "bentuk" (kategori bawah/tengah/atas) supaya pilihannya benar-benar beda.
 * Tiap elemen: { top, mid, bot, ev, values:[atas,tengah,bawah] }.
 */
export function solve(cards, { prob = tableProb, keep = 3 } = {}) {
  if (cards.length !== 13) throw new Error('Butuh 13 kartu');
  const val5 = new Int32Array(FULL + 1), val3 = new Int32Array(FULL + 1);
  const pick = (mask) => { const out = []; for (let i = 0; i < 13; i++) if (mask & (1 << i)) out.push(cards[i]); return out; };
  // peluang & bobot tiap baris per mask
  const wM = new Float64Array(FULL + 1), lM = new Float64Array(FULL + 1), gM = new Float64Array(FULL + 1);
  const wB = new Float64Array(FULL + 1), lB = new Float64Array(FULL + 1), gB = new Float64Array(FULL + 1);
  const wT = new Float64Array(FULL + 1), lT = new Float64Array(FULL + 1), gT = new Float64Array(FULL + 1);
  for (const m of MASKS5) {
    const v = (val5[m] = eval5(pick(m)));
    let p = prob('mid', v); wM[m] = p[0]; lM[m] = p[1]; gM[m] = 1 + rowBonus('mid', v);
    p = prob('bot', v); wB[m] = p[0]; lB[m] = p[1]; gB[m] = 1 + rowBonus('bot', v);
  }
  for (const m of MASKS3) {
    const v = (val3[m] = eval3(pick(m)));
    const p = prob('top', v); wT[m] = p[0]; lT[m] = p[1]; gT[m] = 1 + rowBonus('top', v);
  }

  const best = new Map(); // bentuk -> { ev, b, m, t }
  const rem = new Int32Array(8);
  for (const b of MASKS5) {
    const vb = val5[b];
    let k = 0;
    for (let i = 0; i < 13; i++) if (!(b & (1 << i))) rem[k++] = 1 << i;
    for (const c of C8) {
      let m = 0;
      for (let i = 0; i < 8; i++) if (c & (1 << i)) m |= rem[i];
      const vm = val5[m];
      if (vm > vb) continue;
      const t = FULL ^ b ^ m;
      const vt = val3[t];
      if (vt > vm) continue;
      const gain = gT[t] + gM[m] + gB[b];
      const ev = wT[t] * gT[t] - lT[t] + wM[m] * gM[m] - lM[m] + wB[b] * gB[b] - lB[b]
        + wT[t] * wM[m] * wB[b] * gain // tembus: poin dobel
        - lT[t] * lM[m] * lB[b] * 3; // kena tembus
      const key = (catOf(vb) * 10 + catOf(vm)) * 10 + catOf(vt);
      const cur = best.get(key);
      if (!cur || ev > cur.ev) best.set(key, { ev, b, m, t });
    }
  }
  return [...best.values()]
    .sort((x, y) => y.ev - x.ev)
    .slice(0, keep)
    .map(({ ev, b, m, t }) => ({
      top: orderRow(pick(t)), mid: orderRow(pick(m)), bot: orderRow(pick(b)), ev, values: [val3[t], val5[m], val5[b]],
    }));
}

/**
 * Susunan cepat & pasti sah: bawah = 5 kartu terkuat, tengah = 5 terkuat dari sisanya, atas = 3 sisanya.
 * Jauh lebih murah dari solve() (±1.300 evaluasi), dipakai server sebagai cadangan (pemain kehabisan waktu / CPU terbatas)
 * dan sebagai pembanding di simulasi.
 */
export function quickArrange(cards) {
  if (cards.length !== 13) throw new Error('Butuh 13 kartu');
  const pick = (mask) => { const out = []; for (let i = 0; i < 13; i++) if (mask & (1 << i)) out.push(cards[i]); return out; };
  let b = 0, vb = -1;
  for (const m of MASKS5) { const v = eval5(pick(m)); if (v > vb) { vb = v; b = m; } }
  let mid = 0, vm = -1;
  for (const m of MASKS5) { if (m & b) continue; const v = eval5(pick(m)); if (v > vm) { vm = v; mid = m; } }
  return { top: orderRow(pick(FULL ^ b ^ mid)), mid: orderRow(pick(mid)), bot: orderRow(pick(b)) };
}
export const greedy = quickArrange;
export { CAT };
