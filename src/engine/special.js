// Kartu spesial dari 13 kartu (langsung menang): All Straight, All Flush, 6 Pair.
import { rankOf, suitOf } from './cards.js';
import { SPECIAL } from './rules.js';
import { eval5 } from './hands.js';

const byRankDesc = (a, b) => rankOf(b) - rankOf(a) || suitOf(b) - suitOf(a);

// Straight sebagai daftar rank. 5 kartu: A2345 + 23456 … 10JQKA. 3 kartu: A23 + 234 … QKA.
const RUN5 = [[12, 0, 1, 2, 3]];
for (let s = 0; s <= 8; s++) RUN5.push([s, s + 1, s + 2, s + 3, s + 4]);
const RUN3 = [[12, 0, 1]];
for (let s = 0; s <= 10; s++) RUN3.push([s, s + 1, s + 2]);

/** Ketiga baris straight (3 + 5 + 5). Dragon 2–A termasuk di sini. */
function allStraight(cards) {
  const cnt = new Array(13).fill(0);
  for (const c of cards) cnt[rankOf(c)]++;
  const take = (run, d) => { for (const r of run) cnt[r] += d; };
  const ok = (run) => run.every((r) => cnt[r] > 0);
  for (const a of RUN5) {
    if (!ok(a)) continue;
    take(a, -1);
    for (const b of RUN5) {
      if (!ok(b)) continue;
      take(b, -1);
      for (const t of RUN3) {
        if (!ok(t)) continue;
        // 13 kartu habis terpakai kalau ketiganya lolos (5 + 5 + 3)
        const pool = [...cards].sort(byRankDesc);
        const pick = (run) => run.map((r) => pool.splice(pool.findIndex((c) => rankOf(c) === r), 1)[0]);
        let bot = pick(a), mid = pick(b);
        const top = pick(t);
        if (eval5(mid) > eval5(bot)) [bot, mid] = [mid, bot];
        return { top, mid, bot };
      }
      take(b, 1);
    }
    take(a, 1);
  }
  return null;
}

/** Ketiga baris flush: jumlah kartu per suit harus bisa dipecah jadi 3 + 5 + 5. */
function allFlush(cards) {
  const bySuit = [[], [], [], []];
  for (const c of cards) bySuit[suitOf(c)].push(c);
  const g = bySuit.filter((s) => s.length).map((s) => s.sort(byRankDesc)).sort((a, b) => b.length - a.length);
  const sig = g.map((s) => s.length).join(',');
  let rows;
  if (sig === '13') rows = [g[0].slice(10), g[0].slice(5, 10), g[0].slice(0, 5)];
  else if (sig === '10,3') rows = [g[1], g[0].slice(5), g[0].slice(0, 5)];
  else if (sig === '8,5') rows = [g[0].slice(5), g[0].slice(0, 5), g[1]];
  else if (sig === '5,5,3') rows = [g[2], g[0], g[1]];
  else return null;
  let [top, mid, bot] = rows;
  if (eval5(mid) > eval5(bot)) [bot, mid] = [mid, bot];
  return { top, mid, bot };
}

/** 6 pasang + 1 kartu (empat kembar dihitung 2 pasang). */
function sixPairs(cards) {
  const cnt = new Array(13).fill(0);
  for (const c of cards) cnt[rankOf(c)]++;
  if (cnt.reduce((s, n) => s + (n >> 1), 0) < 6) return null;
  const s = [...cards].sort(byRankDesc);
  // kartu tunggal ditaruh paling akhir supaya pasangan tampil berdampingan
  const odd = s.findIndex((c) => cnt[rankOf(c)] % 2 === 1);
  if (odd >= 0) s.push(s.splice(odd, 1)[0]);
  return { bot: s.slice(0, 5), mid: s.slice(5, 10), top: s.slice(10) };
}

/** -> null | { type, pts, rows:{top,mid,bot} } (rows hanya untuk tampilan). Kalau dapat lebih dari satu, ambil poin terbesar. */
export function detectSpecial(cards) {
  if (cards.length !== 13) return null;
  const found = [['straight', allStraight], ['flush', allFlush], ['pairs', sixPairs]]
    .map(([type, fn]) => ({ type, pts: SPECIAL[type], rows: fn(cards) }))
    .filter((x) => x.rows);
  if (!found.length) return null;
  return found.sort((a, b) => b.pts - a.pts)[0];
}
