import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P, mulberry32, deal } from '../src/engine/cards.js';
import { scoreRound, duelFor } from '../src/engine/scoring.js';
import { solve } from '../src/engine/arrange.js';
import { detectSpecial } from '../src/engine/special.js';

const hand = (top, mid, bot) => ({ rows: { top: P(top), mid: P(mid), bot: P(bot) } });
// Catatan: tes skor boleh memakai kartu yang sama di beberapa pemain; scoreRound hanya membandingkan baris.
const WEAK = hand('2s 3d 5h', '2c 3s 4d 6h 8c', '2d 3h 4s 6c 9d');
const MID = hand('Ks Qd 5h', '7s 7d 9h Jc Ks', '9s 9c Qs Qd 2d');
const STRONG = hand('As Ad 5h', 'Ks Kd 9h 9c 2s', '5s 6d 7h 8c 9s');

test('menang 2 kalah 1 = +1, tanpa pengali', () => {
  const a = hand('As Kd 5h', '2c 3s 4d 6h 8c', 'As Ad 9s 9c 2d'); // atas & bawah menang, tengah kalah dari MID
  const r = scoreRound([a, MID, MID, MID]);
  const d = duelFor(r, 0, 1);
  assert.deepEqual(d.rows, [1, -1, 1]);
  assert.equal(d.mult, 1);
  assert.equal(d.total, 1);
  assert.deepEqual(r.net, [3, -1, -1, -1]);
});

test('tembus = poin x2', () => {
  const r = scoreRound([STRONG, WEAK, STRONG, STRONG]);
  const d = duelFor(r, 0, 1);
  assert.equal(d.scoop, 1);
  assert.equal(d.base, 3);
  assert.equal(d.total, 6);
  assert.equal(duelFor(r, 1, 0).total, -6);
  assert.equal(r.sweep, -1);
  assert.deepEqual(r.net, [6, -18, 6, 6]);
});

test('tembus keliling = x2 lagi (x4)', () => {
  const r = scoreRound([STRONG, WEAK, WEAK, WEAK]);
  assert.equal(r.sweep, 0);
  assert.equal(duelFor(r, 0, 1).mult, 4);
  assert.deepEqual(r.net, [36, -12, -12, -12]);
  // lawan vs lawan seri, tidak ikut dikali
  assert.equal(duelFor(r, 1, 2).total, 0);
});

test('seri di satu baris: bukan tembus', () => {
  const a = hand('2c 3c 5c', 'Ks Kd 9h 9c 2s', '5s 6d 7h 8c 9s'); // atas sama dengan WEAK
  const d = duelFor(scoreRound([a, WEAK, WEAK, WEAK]), 0, 1);
  assert.deepEqual(d.rows, [0, 1, 1]);
  assert.equal(d.scoop, 0);
  assert.equal(d.total, 2);
});

test('bonus: tris atas +3', () => {
  const a = hand('7s 7d 7h', 'Ks Kd Kh 9c 2s', '5s 6d 7c 8c 9s');
  const d = duelFor(scoreRound([a, WEAK, a, a]), 0, 1); // pemain lain seri, jadi bukan tembus keliling
  assert.deepEqual(d.rows, [4, 1, 1]);
  assert.equal(d.total, 12); // (4+1+1) x2 tembus
});

test('bonus tengah: full house +3, four of a kind +5, straight flush +7, royal flush +11', () => {
  const bot = '10s Js Qs Ks As';
  const mid = (m) => duelFor(scoreRound([hand('2s 3d 5h', m, bot), MID, MID, MID]), 0, 1).rows[1];
  assert.equal(mid('8s 8d 8h 3c 3s'), 4);
  assert.equal(mid('8s 8d 8h 8c 3s'), 6);
  assert.equal(mid('4h 5h 6h 7h 8h'), 8);
  assert.equal(mid('10h Jh Qh Kh Ah'), 12);
  assert.equal(mid('2h 5h 6h 7h 8h'), 1, 'flush tengah tidak ada bonus');
});

test('bonus bawah: four of a kind +5, straight flush +7, royal flush +11; full house bawah tanpa bonus', () => {
  const bot = (b) => duelFor(scoreRound([hand('2s 3d 5h', '2c 3s 4d 6h 8c', b), MID, MID, MID]), 0, 1).rows[2];
  assert.equal(bot('8s 8d 8h 3c 3s'), 1);
  assert.equal(bot('8s 8d 8h 8c 3s'), 6);
  assert.equal(bot('4h 5h 6h 7h 8h'), 8);
  assert.equal(bot('10h Jh Qh Kh Ah'), 12);
});

test('bonus hanya dibayar kalau baris itu menang', () => {
  const a = hand('7s 7d 7h', 'Ks Kd Kh 9c 2s', '5s 6d 7c 8c 9s');
  const b = hand('8s 8d 8h', 'As Ad Ah 9c 2s', '6s 7d 8c 9c 10s');
  const d = duelFor(scoreRound([a, b, b, b]), 0, 1);
  assert.deepEqual(d.rows, [-4, -1, -1]);
  assert.equal(d.total, -12);
});

test('kartu spesial langsung menang dari tiap lawan, tanpa pengali', () => {
  const sp = { special: { type: 'straight', pts: 4 } };
  const r = scoreRound([sp, STRONG, WEAK, MID]);
  assert.equal(duelFor(r, 0, 1).total, 4);
  assert.equal(duelFor(r, 0, 1).special, 'win');
  assert.equal(duelFor(r, 1, 0).special, 'lose');
  assert.equal(r.net[0], 12);
  assert.equal(r.net.reduce((s, x) => s + x, 0), 0);
  // STRONG tembus WEAK tapi bukan keliling (kalah dari kartu spesial)
  assert.equal(duelFor(r, 1, 2).mult, 2);
  assert.equal(r.sweep, -1);
});

test('spesial vs spesial: poin lebih besar menang, sama = seri', () => {
  const s4 = { special: { type: 'straight', pts: 4 } }, f3 = { special: { type: 'flush', pts: 3 } }, p3 = { special: { type: 'pairs', pts: 3 } };
  const r = scoreRound([s4, f3, p3, MID]);
  assert.equal(duelFor(r, 0, 1).total, 4);
  assert.equal(duelFor(r, 1, 2).total, 0);
  assert.equal(duelFor(r, 1, 2).special, 'tie');
  assert.deepEqual(r.net, [12, -1, -1, -10]);
});

test('acak: selalu zero-sum & susunan AI selalu sah', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 40; i++) {
    const players = deal(rng).map((cards) => {
      const sp = detectSpecial(cards);
      if (sp) return { special: sp };
      const [s] = solve(cards, { keep: 1 });
      return { rows: s };
    });
    const r = scoreRound(players);
    assert.equal(r.net.reduce((s, x) => s + x, 0), 0);
    for (let p = 0; p < 4; p++) {
      const sum = [0, 1, 2, 3].filter((o) => o !== p).reduce((s, o) => s + duelFor(r, p, o).total, 0);
      assert.equal(sum, r.net[p]);
    }
  }
});
