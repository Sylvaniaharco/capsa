// Level lawan AI (bot). Bot memilih dari 3 susunan terbaik hasil solve()/solveSix() atau, kadang, susunan sederhana
// ("bawah sekuat mungkin"), jadi level rendah sering salah strategi seperti pemain biasa. Murni: acak lewat rnd() dari pemanggil.
export const LEVELS = ['Mudah', 'Sedang', 'Sulit'];
export const DEFAULT_LEVEL = 1;
export const validLevel = (l) => Number.isInteger(l) && l >= 0 && l < LEVELS.length;

// Bobot memilih: [susunan sederhana, terbaik, kedua, ketiga]. Sulit = hampir selalu terbaik (lihat botPick).
const WEIGHTS = [[0.4, 0.15, 0.25, 0.2], [0.15, 0.35, 0.3, 0.2]];

/**
 * opts = daftar susunan terbaik (urut dari ev tertinggi, max 3); quick() = susunan sederhana yang pasti sah.
 * -> satu susunan { top, mid, bot }.
 */
export function botPick(opts, quick, level, rnd) {
  if (level >= 2) {
    // sulit: sesekali ambil pilihan kedua kalau nilainya hampir sama, supaya tidak selalu "sempurna"
    const second = opts[1] && opts[0].ev - opts[1].ev < 0.35 && rnd() < 0.2;
    return second ? opts[1] : opts[0];
  }
  const w = [WEIGHTS[level][0], ...[0, 1, 2].map((k) => (opts[k] ? WEIGHTS[level][k + 1] : 0))];
  let x = rnd() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 4; k++) {
    if ((x -= w[k]) < 0) return k === 0 ? quick() : opts[k - 1];
  }
  return opts[0];
}
