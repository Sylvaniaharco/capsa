// Simulasi Capsa 6 kartu (AI vs AI) per jumlah pemain: zero-sum, sebaran poin, seberapa sering tembus & kombinasi bawah,
// dan AI (kursi 0) dibandingkan susunan sederhana quickSix (kursi lain).
//   node scripts/simulate-six.mjs [ronde per jumlah pemain] [seed]
import { mulberry32 } from '../src/engine/cards.js';
import { dealSix, solveSix, quickSix, sixRules, sixCatName, SIX } from '../src/engine/six.js';
import { scoreRound } from '../src/engine/scoring.js';

const rounds = Number(process.argv[2]) || 2000;
const seed = Number(process.argv[3]) || 1;
for (let n = SIX.minPlayers; n <= SIX.maxPlayers; n++) {
  const rng = mulberry32(seed + n);
  const st = { abs: 0, max: 0, scoop: 0, sweep: 0, ai: 0, bot: {} };
  for (let r = 0; r < rounds; r++) {
    const { hands } = dealSix(rng, n);
    const all = hands.map((h) => ({ rows: solveSix(h, n, { keep: 1 })[0] }));
    const res = scoreRound(all, sixRules(n));
    if (res.net.reduce((a, b) => a + b, 0) !== 0) throw new Error(`Tidak zero-sum (n=${n}, ronde ${r})`);
    res.net.forEach((x) => { st.abs += Math.abs(x); st.max = Math.max(st.max, Math.abs(x)); });
    st.scoop += res.duels.filter((d) => d.scoop).length;
    if (res.sweep >= 0) st.sweep++;
    for (const p of all) { const c = sixCatName(p.rows.values[2]); st.bot[c] = (st.bot[c] || 0) + 1; }
    if (r % 4 === 0) st.ai += scoreRound(hands.map((h, i) => ({ rows: i === 0 ? all[0].rows : quickSix(h, n) })), sixRules(n)).net[0];
  }
  const hands = rounds * n;
  const bot = Object.entries(st.bot).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${((k / hands) * 100).toFixed(1)}%`).join(', ');
  console.log(`${n} pemain (${rounds} ronde): |poin| rata-rata ${(st.abs / hands).toFixed(2)}, terbesar ${st.max}, `
    + `tembus ${(st.scoop / rounds).toFixed(2)}/ronde, keliling ${st.sweep}x, AI vs sederhana ${(st.ai / (rounds / 4)).toFixed(2)} poin/ronde`);
  console.log(`  bawah: ${bot}`);
}
