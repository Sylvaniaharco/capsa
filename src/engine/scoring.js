// Hitung poin satu ronde (4 pemain). Murni.
// Tiap pemain: { rows: { top:[3], mid:[5], bot:[5] } } atau { special: { type, pts } }.
import { evalRow, catOf } from './hands.js';
import { BONUS, ROWS, SCOOP_MULT, SWEEP_MULT } from './rules.js';

export const rowBonus = (row, value) => BONUS[row][catOf(value)] || 0;

/**
 * -> {
 *   net: [poin bersih tiap pemain] (jumlahnya 0),
 *   duels: [{ a, b, rows:[atas,tengah,bawah] (poin dari sisi a, sudah + bonus), base, mult, total, scoop, special }],
 *   rowTotals: [[atas,tengah,bawah] per pemain] (sebelum dikali tembus),
 *   sweep: indeks pemain yang tembus keliling atau -1,
 *   values: [[nilai atas,tengah,bawah] | null]
 * }
 */
export function scoreRound(players) {
  const n = players.length;
  const values = players.map((p) => (p.special ? null : ROWS.map((r) => evalRow(p.rows[r]))));
  const duels = [];
  const scoops = Array.from({ length: n }, () => 0);

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const sa = players[a].special, sb = players[b].special;
      const d = { a, b, rows: [0, 0, 0], base: 0, mult: 1, total: 0, scoop: 0, special: null };
      if (sa || sb) {
        // kartu spesial langsung menang; sama-sama spesial -> poin lebih besar yang menang, sama = seri
        const pa = sa ? sa.pts : 0, pb = sb ? sb.pts : 0;
        d.special = pa === pb ? 'tie' : pa > pb ? 'a' : 'b';
        d.base = pa === pb ? 0 : pa > pb ? pa : -pb;
      } else {
        let wins = 0, losses = 0;
        ROWS.forEach((row, i) => {
          const va = values[a][i], vb = values[b][i];
          if (va > vb) { d.rows[i] = 1 + rowBonus(row, va); wins++; }
          else if (vb > va) { d.rows[i] = -(1 + rowBonus(row, vb)); losses++; }
        });
        d.base = d.rows[0] + d.rows[1] + d.rows[2];
        if (wins === 3) { d.scoop = 1; scoops[a]++; }
        if (losses === 3) { d.scoop = -1; scoops[b]++; }
        if (d.scoop) d.mult = SCOOP_MULT;
      }
      duels.push(d);
    }
  }

  const sweep = scoops.findIndex((s) => s === n - 1 && n > 2);
  const net = new Array(n).fill(0);
  const rowTotals = Array.from({ length: n }, () => [0, 0, 0]);
  for (const d of duels) {
    if (sweep >= 0 && ((d.a === sweep && d.scoop === 1) || (d.b === sweep && d.scoop === -1))) d.mult *= SWEEP_MULT;
    d.total = d.base * d.mult;
    net[d.a] += d.total;
    net[d.b] -= d.total;
    for (let i = 0; i < 3; i++) { rowTotals[d.a][i] += d.rows[i]; rowTotals[d.b][i] -= d.rows[i]; }
  }
  return { net, duels, rowTotals, sweep, values };
}

/** Duel dari sudut pandang pemain `me` melawan `other`. */
export function duelFor(result, me, other) {
  const d = result.duels.find((x) => (x.a === me && x.b === other) || (x.a === other && x.b === me));
  const s = d.a === me ? 1 : -1;
  const special = d.special === 'tie' || !d.special ? d.special : (d.special === 'a') === (d.a === me) ? 'win' : 'lose';
  return { rows: d.rows.map((x) => x * s), base: d.base * s, mult: d.mult, total: d.total * s, scoop: d.scoop * s, special };
}
