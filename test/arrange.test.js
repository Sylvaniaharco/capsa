import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P, mulberry32, deal } from '../src/engine/cards.js';
import { solve, greedy, tableProb } from '../src/engine/arrange.js';
import { isValid, eval5, eval3, catOf, CAT } from '../src/engine/hands.js';
import { STRENGTH } from '../src/engine/strength-data.js';

test('tabel kekuatan terisi & urut naik', () => {
  for (const row of ['top', 'mid', 'bot']) {
    assert.ok(STRENGTH[row].length >= 64, row);
    for (let i = 1; i < STRENGTH[row].length; i++) assert.ok(STRENGTH[row][i] >= STRENGTH[row][i - 1]);
  }
  const [w, l] = tableProb('bot', eval5(P('10h Jh Qh Kh Ah')));
  assert.ok(w > 0.99 && l === 0);
  assert.ok(tableProb('top', eval3(P('2s 3d 5h')))[1] > 0.95);
});

test('solve: selalu sah, 13 kartu yang sama, urut dari nilai terbaik', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 25; i++) {
    for (const cards of deal(rng)) {
      const opts = solve(cards);
      assert.ok(opts.length >= 1 && opts.length <= 3);
      for (const o of opts) {
        assert.ok(isValid(o.top, o.mid, o.bot));
        assert.deepEqual([...o.top, ...o.mid, ...o.bot].sort((a, b) => a - b), [...cards].sort((a, b) => a - b));
      }
      for (let k = 1; k < opts.length; k++) assert.ok(opts[k - 1].ev >= opts[k].ev);
      const g = greedy(cards);
      assert.ok(isValid(g.top, g.mid, g.bot));
    }
  }
});

test('solve: ambil kombinasi yang jelas', () => {
  // royal flush + full house + pair A: bawah royal, tengah full house, atas pair
  const [s] = solve(P('10h Jh Qh Kh Ah 8s 8d 8c 3c 3s As Ad 5c'));
  assert.equal(catOf(eval5(s.bot)), CAT.ROYAL);
  assert.equal(catOf(eval5(s.mid)), CAT.FULL_HOUSE);
  assert.equal(catOf(eval3(s.top)), CAT.PAIR);
  // four of a kind tidak dipecah
  const [q] = solve(P('9h 9s 9d 9c 2h 4s 6d 8c Jc Qs Kd 3h 7s'));
  assert.equal(catOf(eval5(q.bot)), CAT.QUADS);
});
