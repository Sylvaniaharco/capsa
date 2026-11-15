// Evaluasi kombinasi 3 kartu (baris atas) dan 5 kartu (tengah/bawah).
// Nilai = satu angka: kategori dulu, lalu kicker. Makin besar makin kuat; sama = seri (suit tidak dipakai).
import { rankOf, suitOf } from './cards.js';

export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8, ROYAL: 9,
};
export const CAT_NAMES = [
  'Kartu Tinggi', 'Pair', 'Two Pair', 'Tris', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush',
];
const B = 14;
const B5 = B ** 5;
export const catOf = (v) => Math.floor(v / B5);
export const catName = (v) => CAT_NAMES[catOf(v)];

// kicker disimpan sebagai rank+1 (1..13) supaya 0 = "tidak ada kartu" (baris atas cuma 3 kartu)
const pack = (cat, a = 0, b = 0, c = 0, d = 0, e = 0) => ((((cat * B + a) * B + b) * B + c) * B + d) * B + e;

const cnt = new Int8Array(13);

/** Urutan rank menurut (jumlah kembar turun, rank turun). */
function groups(cards) {
  cnt.fill(0);
  for (const c of cards) cnt[rankOf(c)]++;
  const g = [];
  for (let r = 12; r >= 0; r--) if (cnt[r]) g.push(cnt[r] * 16 + r);
  g.sort((x, y) => y - x);
  return g; // tiap elemen: count*16 + rank
}

export function eval5(cards) {
  const g = groups(cards);
  const n0 = g[0] >> 4;
  const r = (i) => (g[i] & 15) + 1;
  if (g.length === 5) {
    const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
    const hi = g[0] & 15, lo = g[4] & 15;
    let straightHi = -1;
    if (hi - lo === 4) straightHi = hi;
    else if (hi === 12 && (g[1] & 15) === 3) straightHi = 3; // A-2-3-4-5: straight paling kecil
    if (straightHi >= 0) {
      if (flush) return straightHi === 12 ? pack(CAT.ROYAL, 13) : pack(CAT.STRAIGHT_FLUSH, straightHi + 1);
      return pack(CAT.STRAIGHT, straightHi + 1);
    }
    return pack(flush ? CAT.FLUSH : CAT.HIGH, r(0), r(1), r(2), r(3), r(4));
  }
  if (n0 === 4) return pack(CAT.QUADS, r(0), r(1));
  if (n0 === 3) return g.length === 2 ? pack(CAT.FULL_HOUSE, r(0), r(1)) : pack(CAT.TRIPS, r(0), r(1), r(2));
  if (g.length === 3) return pack(CAT.TWO_PAIR, r(0), r(1), r(2));
  return pack(CAT.PAIR, r(0), r(1), r(2), r(3));
}

export function eval3(cards) {
  const g = groups(cards);
  const r = (i) => (g[i] & 15) + 1;
  if (g.length === 1) return pack(CAT.TRIPS, r(0));
  if (g.length === 2) return pack(CAT.PAIR, r(0), r(1));
  return pack(CAT.HIGH, r(0), r(1), r(2));
}

export const evalRow = (cards) => (cards.length === 3 ? eval3(cards) : eval5(cards));

/** Susunan sah: bawah >= tengah >= atas. */
export function isValid(top, mid, bot) {
  if (top.length !== 3 || mid.length !== 5 || bot.length !== 5) return false;
  const m = eval5(mid);
  return eval3(top) <= m && m <= eval5(bot);
}

/** Urutkan kartu satu baris untuk ditampilkan: yang kembar dulu, lalu rank turun (A-2-3-4-5 jadi 5-4-3-2-A). */
export function orderRow(cards) {
  const c = new Map();
  for (const x of cards) c.set(rankOf(x), (c.get(rankOf(x)) || 0) + 1);
  const out = [...cards].sort((a, b) => c.get(rankOf(b)) - c.get(rankOf(a)) || rankOf(b) - rankOf(a) || suitOf(b) - suitOf(a));
  if (cards.length === 5) {
    const cat = catOf(eval5(cards));
    if ((cat === CAT.STRAIGHT || cat === CAT.STRAIGHT_FLUSH) && rankOf(out[0]) === 12 && rankOf(out[1]) === 3) out.push(out.shift());
  }
  return out;
}
