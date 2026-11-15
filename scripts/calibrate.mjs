// Bikin tabel kekuatan baris (src/engine/strength-data.js) dari simulasi AI vs AI.
// Tabel = kuantil nilai baris yang benar-benar dimainkan; dipakai solve() untuk menaksir peluang menang tiap baris.
// Jalankan ulang kalau aturan bonus/tembus berubah:  node scripts/calibrate.mjs [jumlah deal] [putaran]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32, deal } from '../src/engine/cards.js';
import { solve, crudeProb, tableProb } from '../src/engine/arrange.js';
import { detectSpecial } from '../src/engine/special.js';

const deals = Number(process.argv[2]) || 6000;
const rounds = Number(process.argv[3]) || 3;
const Q = 256;
const quantiles = (arr) => {
  arr.sort((a, b) => a - b);
  return Array.from({ length: Q }, (_, i) => arr[Math.floor(((i + 0.5) / Q) * arr.length)]);
};

let table = null;
for (let r = 0; r < rounds; r++) {
  const rng = mulberry32(1000 + r);
  const prob = table ? ((t) => (row, v) => tableProb(row, v, t))(table) : crudeProb;
  const samples = { top: [], mid: [], bot: [] };
  for (let d = 0; d < deals; d++) {
    for (const hand of deal(rng)) {
      if (detectSpecial(hand)) continue;
      const [s] = solve(hand, { prob, keep: 1 });
      samples.top.push(s.values[0]); samples.mid.push(s.values[1]); samples.bot.push(s.values[2]);
    }
  }
  table = { top: quantiles(samples.top), mid: quantiles(samples.mid), bot: quantiles(samples.bot) };
  console.log(`putaran ${r + 1}/${rounds}: ${samples.top.length} tangan`);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engine', 'strength-data.js');
writeFileSync(out, `// DIBUAT OTOMATIS oleh scripts/calibrate.mjs — jangan diedit tangan.
// ${Q} kuantil nilai baris (lihat hands.js) dari ${deals} deal x ${rounds} putaran AI vs AI.
export const STRENGTH = ${JSON.stringify(table).replace(/"/g, '').replace(/(top|mid|bot):/g, '\n  $1: ')}\n};\n`.replace(/\]\}\n\};/, ']\n};'));
console.log('Tersimpan →', out);
