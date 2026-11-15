import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P } from '../src/engine/cards.js';
import { detectSpecial } from '../src/engine/special.js';
import { eval5, catOf, CAT } from '../src/engine/hands.js';

const sameCards = (rows, cards) => assert.deepEqual([...rows.top, ...rows.mid, ...rows.bot].sort((a, b) => a - b), [...cards].sort((a, b) => a - b));

test('All Straight: dragon 2–A', () => {
  const c = P('2s 3d 4h 5c 6s 7d 8h 9c 10s Jd Qh Kc As');
  const s = detectSpecial(c);
  assert.equal(s.type, 'straight');
  assert.equal(s.pts, 4);
  sameCards(s.rows, c);
});

test('All Straight: tiga straight dengan rank dobel', () => {
  const c = P('3s 4d 5h   4s 5d 6h 7c 8s   6d 7h 8c 9s 10d');
  const s = detectSpecial(c);
  assert.equal(s.type, 'straight');
  sameCards(s.rows, c);
  assert.equal(catOf(eval5(s.rows.mid)), CAT.STRAIGHT);
  assert.equal(catOf(eval5(s.rows.bot)), CAT.STRAIGHT);
  assert.ok(eval5(s.rows.bot) >= eval5(s.rows.mid));
});

test('All Straight: A-2-3 di atas dan Q-K-A di atas', () => {
  assert.equal(detectSpecial(P('As 2d 3h   4s 5d 6h 7c 8s   9d 10h Jc Qs Kd')).type, 'straight');
  assert.equal(detectSpecial(P('Qs Kd Ah   2s 3d 4h 5c 6s   7d 8h 9c 10s Jd')).type, 'straight');
});

test('All Flush: 5-5-3, 8-5, 10-3', () => {
  const a = P('2s 5s 9s   3h 6h 8h Jh Kh   2d 4d 7d 9d Qd');
  assert.equal(detectSpecial(a).type, 'flush');
  assert.equal(detectSpecial(a).pts, 3);
  sameCards(detectSpecial(a).rows, a);
  const b = P('2s 5s 9s Js Ks As 3s 4s   2d 4d 7d 9d Qd');
  const sb = detectSpecial(b);
  assert.equal(sb.type, 'flush');
  sameCards(sb.rows, b);
  for (const row of [sb.rows.top, sb.rows.mid, sb.rows.bot]) assert.equal(new Set(row.map((x) => x & 3)).size, 1);
  assert.equal(detectSpecial(P('2s 5s 9s Js Ks As 3s 4s 7s 8s   2d 4d 7d')).type, 'flush');
  assert.equal(detectSpecial(P('2s 5s 9s Js Ks As 3s 4s 7s   2d 4d 7d 9d')), null, '9-4 tidak bisa jadi 3 flush');
});

test('6 Pair (empat kembar = 2 pasang)', () => {
  const a = P('2s 2d 5h 5c 7s 7d 9h 9c Js Jd Kh Kc As');
  assert.equal(detectSpecial(a).type, 'pairs');
  assert.equal(detectSpecial(a).pts, 3);
  sameCards(detectSpecial(a).rows, a);
  assert.equal(detectSpecial(P('2s 2d 2h 2c 7s 7d 9h 9c Js Jd Kh Kc As')).type, 'pairs');
  assert.equal(detectSpecial(P('2s 2d 5h 5c 7s 7d 9h 9c Js Jd Kh Qc As')), null, 'cuma 5 pasang');
});

test('tangan biasa -> null; dobel spesial ambil poin terbesar', () => {
  assert.equal(detectSpecial(P('2s 2d 5h 6c 7s 9d 9h Jc Js Qd Kh Kc As')), null);
  // 13 kartu satu suit: All Straight (+4) menang dari All Flush (+3)
  assert.equal(detectSpecial(P('2s 3s 4s 5s 6s 7s 8s 9s 10s Js Qs Ks As')).type, 'straight');
});
