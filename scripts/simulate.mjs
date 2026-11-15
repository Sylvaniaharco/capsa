// Simulasi AI vs AI tanpa UI: cek zero-sum, sebaran poin, seberapa sering tembus / kartu spesial,
// dan bandingkan AI (kursi 0) dengan susunan sederhana "bawah sekuat mungkin" (kursi 1–3).
//   node scripts/simulate.mjs [jumlah ronde] [seed]
import { mulberry32, deal } from '../src/engine/cards.js';
import { solve, greedy } from '../src/engine/arrange.js';
import { detectSpecial } from '../src/engine/special.js';
import { scoreRound } from '../src/engine/scoring.js';

const rounds = Number(process.argv[2]) || 2000;
const rng = mulberry32(Number(process.argv[3]) || 1);
const stat = { special: { straight: 0, flush: 0, pairs: 0 }, scoop: 0, sweep: 0, max: 0, absSum: 0 };
const total = [0, 0, 0, 0], vsGreedy = [0, 0, 0, 0];

for (let r = 0; r < rounds; r++) {
  const hands = deal(rng);
  const play = (cards, smart) => {
    const sp = detectSpecial(cards);
    if (sp) return { special: sp };
    return { rows: smart ? solve(cards, { keep: 1 })[0] : greedy(cards) };
  };
  const all = hands.map((h) => play(h, true));
  const res = scoreRound(all);
  if (res.net.reduce((s, x) => s + x, 0) !== 0) throw new Error('Tidak zero-sum di ronde ' + r);
  res.net.forEach((n, i) => { total[i] += n; stat.max = Math.max(stat.max, Math.abs(n)); stat.absSum += Math.abs(n); });
  for (const p of all) if (p.special) stat.special[p.special.type]++;
  stat.scoop += res.duels.filter((d) => d.scoop).length;
  if (res.sweep >= 0) stat.sweep++;
  if (r < rounds / 4) scoreRound(hands.map((h, i) => play(h, i === 0))).net.forEach((n, i) => { vsGreedy[i] += n; });
}
const hands = rounds * 4;
console.log(`${rounds} ronde AI vs AI`);
console.log(`  rata-rata |poin| per pemain per ronde: ${(stat.absSum / hands).toFixed(2)}, terbesar: ${stat.max}`);
console.log(`  tembus: ${(stat.scoop / rounds).toFixed(2)} per ronde, tembus keliling: 1 tiap ${(rounds / Math.max(1, stat.sweep)).toFixed(0)} ronde`);
console.log(`  kartu spesial per 1000 tangan: All Straight ${(stat.special.straight / hands * 1000).toFixed(1)}, All Flush ${(stat.special.flush / hands * 1000).toFixed(1)}, 6 Pair ${(stat.special.pairs / hands * 1000).toFixed(1)}`);
console.log(`  AI vs 3 susunan sederhana (${Math.floor(rounds / 4)} ronde): AI ${(vsGreedy[0] / (rounds / 4)).toFixed(2)} poin/ronde`);
