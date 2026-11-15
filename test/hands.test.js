import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P, mulberry32, deal } from '../src/engine/cards.js';
import { eval5, eval3, catOf, CAT, isValid, orderRow } from '../src/engine/hands.js';

const cat5 = (s) => catOf(eval5(P(s)));
const cat3 = (s) => catOf(eval3(P(s)));

test('kategori 5 kartu', () => {
  assert.equal(cat5('As Kd 9h 5c 2s'), CAT.HIGH);
  assert.equal(cat5('As Ad 9h 5c 2s'), CAT.PAIR);
  assert.equal(cat5('As Ad 9h 9c 2s'), CAT.TWO_PAIR);
  assert.equal(cat5('As Ad Ah 9c 2s'), CAT.TRIPS);
  assert.equal(cat5('5s 6d 7h 8c 9s'), CAT.STRAIGHT);
  assert.equal(cat5('As 2d 3h 4c 5s'), CAT.STRAIGHT);
  assert.equal(cat5('10s Jd Qh Kc As'), CAT.STRAIGHT);
  assert.equal(cat5('Qs Kd Ah 2c 3s'), CAT.HIGH, 'K-A-2 bukan straight');
  assert.equal(cat5('2s 7s 9s Js Ks'), CAT.FLUSH);
  assert.equal(cat5('As Ad Ah 9c 9s'), CAT.FULL_HOUSE);
  assert.equal(cat5('As Ad Ah Ac 9s'), CAT.QUADS);
  assert.equal(cat5('5h 6h 7h 8h 9h'), CAT.STRAIGHT_FLUSH);
  assert.equal(cat5('Ah 2h 3h 4h 5h'), CAT.STRAIGHT_FLUSH);
  assert.equal(cat5('10h Jh Qh Kh Ah'), CAT.ROYAL);
});

test('kategori 3 kartu: tidak ada straight/flush', () => {
  assert.equal(cat3('As Ks Qs'), CAT.HIGH);
  assert.equal(cat3('As Ad Qs'), CAT.PAIR);
  assert.equal(cat3('7s 7d 7h'), CAT.TRIPS);
});

test('perbandingan dalam satu kategori', () => {
  const gt = (a, b) => assert.ok(eval5(P(a)) > eval5(P(b)), `${a} > ${b}`);
  gt('As Kd 9h 5c 2s', 'Ks Qd 9h 5c 2s');
  gt('2s 2d 9h 5c 3s', 'As Kd Qh Jc 9s');
  gt('As Ad 9h 5c 3s', 'As Ad 8h 7c 6s'); // kicker
  gt('3s 3d 2h 2c 4s', 'As Ad Kh Qc Js');
  gt('6s 7d 8h 9c 10s', '5s 6d 7h 8c 9s');
  gt('2s 3d 4h 5c 6s', 'As 2d 3h 4c 5s'); // A-2-3-4-5 paling kecil
  gt('2s 2d 2h 3c 3s', 'As Ks Qs Js 9s');
  gt('2s 2d 2h 2c 3s', 'As Ad Ah Kc Ks');
  gt('Ah 2h 3h 4h 5h', 'As Ad Ah Ac Ks');
  gt('10h Jh Qh Kh Ah', '9s 10s Js Qs Ks');
  assert.equal(eval5(P('As Kd 9h 5c 2s')), eval5(P('Ad Kh 9c 5s 2d')), 'suit tidak dipakai = seri');
});

test('atas vs tengah bisa dibandingkan (untuk cek susunan sah)', () => {
  assert.ok(eval3(P('As Ad Ks')) > eval5(P('Ks Kd Qh Jc 9s')));
  assert.ok(eval3(P('Ks Kd As')) < eval5(P('As Ad 3h 4c 6s')));
  assert.ok(eval3(P('As Ad Ks')) <= eval5(P('Ah Ac Kd 3c 2s')), 'pair & kicker sama -> tengah tetap >=');
  assert.ok(eval3(P('2s 2d 2h')) > eval5(P('As Ad Kh Kc Qs')), 'tris atas > two pair tengah');
  assert.ok(eval3(P('As Ad Ah')) < eval5(P('2s 3d 4h 5c 6s')), 'tris atas < straight tengah');
});

test('isValid', () => {
  assert.ok(isValid(P('2s 3d 5h'), P('7s 7d 9h Jc Ks'), P('As Ad 9s 9c 2d')));
  assert.ok(!isValid(P('As Ad 5h'), P('7s 7d 9h Jc Ks'), P('Qs Qd 9s 9c 2d')), 'atas lebih kuat dari tengah');
  assert.ok(!isValid(P('2s 3d 5h'), P('As Ad 9s 9c 2d'), P('7s 7d 9h Jc Ks')), 'tengah lebih kuat dari bawah');
  assert.ok(!isValid(P('2s 3d'), P('7s 7d 9h Jc Ks'), P('As Ad 9s 9c 2d')));
});

test('orderRow: kembar dulu, wheel jadi 5-4-3-2-A', () => {
  assert.deepEqual(orderRow(P('2s Ad 9h As 9c')), P('As Ad 9h 9c 2s'));
  assert.deepEqual(orderRow(P('As 3d 5h 2c 4s')), P('5h 4s 3d 2c As'));
  assert.deepEqual(orderRow(P('10s Ad Kh Qc Js')), P('Ad Kh Qc Js 10s'));
});

test('deal: 52 kartu unik, deterministik dari seed', () => {
  const a = deal(mulberry32(7)), b = deal(mulberry32(7));
  assert.deepEqual(a, b);
  assert.equal(new Set(a.flat()).size, 52);
  assert.notDeepEqual(a, deal(mulberry32(8)));
});
