import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P, mulberry32, rankOf } from '../src/engine/cards.js';
import { scoreRound, duelFor } from '../src/engine/scoring.js';
import {
  sixDeck, dealSix, sixLowRank, evalSix, sixCatName, sixBonus, sixRules, isValidSix, orderSix, quickSix, solveSix, SIX_CAT, sixCatOf,
} from '../src/engine/six.js';

const hand = (top, mid, bot) => ({ rows: { top: P(top), mid: P(mid), bot: P(bot) } });
const cat = (s, n = 4) => sixCatName(evalSix(P(s), n));

test('dek per jumlah pemain: dari As ke bawah, sisa 0 atau 2 kartu', () => {
  const want = { 3: ['10', 2], 4: ['9', 0], 5: ['7', 2], 6: ['6', 0], 7: ['4', 2], 8: ['3', 0] };
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  for (const [n, [low, rest]] of Object.entries(want)) {
    const d = sixDeck(Number(n));
    assert.equal(RANKS[sixLowRank(Number(n))], low);
    assert.equal(d.length - n * 6, rest);
    assert.ok(d.every((c) => rankOf(c) >= sixLowRank(Number(n))));
    const { hands, rest: r } = dealSix(mulberry32(5), Number(n));
    assert.equal(hands.length, Number(n));
    assert.ok(hands.every((h) => h.length === 6));
    assert.equal(new Set([...hands.flat(), ...r]).size, d.length);
  }
  assert.throws(() => sixDeck(2));
  assert.throws(() => sixDeck(9));
});

test('urutan kombinasi 3 kartu: kartu tinggi < pair < straight < flush < tris < straight flush < royal', () => {
  const order = ['As Kd 9h', '9s 9d Ah', '9s 10d Jh', '9h Jh Kh', '9s 9d 9h', '9h 10h Jh', 'Ah Kh Qh'].map((s) => evalSix(P(s), 4));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `urutan ${i}`);
  assert.equal(cat('As Kd 9h'), 'Kartu Tinggi');
  assert.equal(cat('Ah Kh Qh'), 'Royal Flush');
  assert.equal(cat('Ks Qs Js'), 'Straight Flush');
});

test('As selalu kartu tertinggi: tidak ada straight As-kecil', () => {
  for (const [s, n] of [['As 10d Jh', 3], ['As 9d 10h', 4], ['As 3d 4h', 8]]) assert.equal(cat(s, n), 'Kartu Tinggi');
  assert.equal(cat('As 10s Js', 3), 'Flush');
  assert.equal(cat('Ac 10c 9d', 4), 'Kartu Tinggi'); // contoh dari HP Teddy
  assert.equal(cat('As Kd Qh', 3), 'Straight');
  assert.ok(evalSix(P('As 10d Jh'), 3) < evalSix(P('10s Jd Qh'), 3));
  assert.deepEqual(orderSix(P('Jh As 10d')), P('As Jh 10d'));
});

test('nilai sama ditentukan lambang (♠ > ♥ > ♣ > ♦), jadi tidak ada seri', () => {
  assert.ok(evalSix(P('As'), 4) > evalSix(P('Ah'), 4));
  assert.ok(evalSix(P('Ah'), 4) > evalSix(P('Ac'), 4));
  assert.ok(evalSix(P('Ac'), 4) > evalSix(P('Ad'), 4));
  assert.ok(evalSix(P('Ks Kd'), 4) > evalSix(P('Kh Kc'), 4));
  assert.ok(evalSix(P('Qs Js 10s'), 4) > evalSix(P('Qh Jh 10h'), 4));
  assert.ok(evalSix(P('Ah Qd'), 4) > evalSix(P('Ac Qs'), 4)); // lambang kartu tertinggi
  // nilai kartu tetap lebih dulu dari lambang
  assert.ok(evalSix(P('Ad'), 4) > evalSix(P('Ks'), 4));
  assert.ok(evalSix(P('Ad Kd'), 4) > evalSix(P('As Qs'), 4));
  assert.ok(evalSix(P('9d 9c Ad'), 4) > evalSix(P('9s 9h Ks'), 4)); // pair sama: kicker dulu
});

test('susunan sah: bawah >= tengah >= atas', () => {
  const ok = (t, m, b, n = 4) => isValidSix({ top: P(t), mid: P(m), bot: P(b) }, n);
  assert.ok(ok('As', 'Kh Kd', 'Qs Js 10s'));
  assert.ok(ok('9s', 'Ah Kd', 'Qs Qh 10s'));
  assert.ok(ok('As', 'Ah Kd', 'Qs Qh 10s')); // tengah A-K tetap di atas A saja (ada kartu kedua)
  assert.ok(!ok('As', 'Kh Qd', 'Js Jh 10s')); // atas As, tengah cuma K tinggi
  assert.ok(!ok('9s', 'Kh Kd', 'Ac Qs 10d')); // tengah pair, bawah kartu tinggi
  assert.ok(!ok('9s', 'Kh Kd', 'Qs Qh As')); // pair K di tengah > pair Q di bawah
  assert.ok(!isValidSix({ top: P('As Kd'), mid: P('Qh'), bot: P('Js Jh 10s') }, 4));
});

test('bonus: pair As di tengah +1, bawah tris +3, straight flush +5, royal +7', () => {
  assert.equal(sixBonus('mid', evalSix(P('As Ad'), 4)), 1);
  assert.equal(sixBonus('mid', evalSix(P('Ks Kd'), 4)), 0);
  assert.equal(sixBonus('mid', evalSix(P('As Kd'), 4)), 0);
  assert.equal(sixBonus('bot', evalSix(P('9s 9d 9h'), 4)), 3);
  assert.equal(sixBonus('bot', evalSix(P('9h 10h Jh'), 4)), 5);
  assert.equal(sixBonus('bot', evalSix(P('Ah Kh Qh'), 4)), 7);
  assert.equal(sixBonus('bot', evalSix(P('As Ad Kh'), 4)), 0);
  assert.equal(sixBonus('top', evalSix(P('As'), 4)), 0);
});

test('skor: menang baris +1 plus bonus, tembus x2, tembus keliling hanya sampai 4 pemain', () => {
  const R = sixRules(4);
  const STRONG = hand('Ks', 'As Ad', 'Ah Kh Qh');
  const WEAK = hand('9d', '10c 9c', 'Jd 10d 9h');
  const MIDH = hand('Qd', 'Kc Kd', 'Jc Jh 9s');
  let r = scoreRound([STRONG, WEAK, MIDH, MIDH], R);
  let d = duelFor(r, 0, 1);
  assert.deepEqual(d.rows, [1, 2, 8]);
  assert.equal(d.mult, 4); // tembus semua lawan
  assert.equal(d.total, 44);
  assert.equal(r.sweep, 0);
  assert.equal(r.net.reduce((a, b) => a + b, 0), 0);
  // 5 pemain: tidak ada tembus keliling
  r = scoreRound([STRONG, WEAK, MIDH, MIDH, WEAK], sixRules(5));
  assert.equal(r.sweep, -1);
  assert.equal(duelFor(r, 0, 1).total, 22);
  // menang 2 kalah 1
  const A = hand('As', 'Qc Jc', 'Js Jh 10s');
  r = scoreRound([A, MIDH, WEAK], sixRules(3));
  d = duelFor(r, 0, 1);
  assert.deepEqual(d.rows, [1, -1, 1]);
  assert.equal(d.mult, 1);
  assert.equal(d.total, 1);
});

test('AI: quickSix & solveSix selalu sah, solveSix tidak kalah dari quickSix', () => {
  for (let n = 3; n <= 8; n++) {
    const rng = mulberry32(100 + n);
    let ai = 0;
    for (let k = 0; k < 60; k++) {
      const { hands } = dealSix(rng, n);
      for (const h of hands) {
        const q = quickSix(h, n), s = solveSix(h, n, { keep: 3 });
        assert.ok(isValidSix(q, n), 'quickSix sah');
        assert.ok(s.length >= 1 && s.every((x) => isValidSix(x, n)), 'solveSix sah');
        assert.deepEqual([...s[0].top, ...s[0].mid, ...s[0].bot].sort(), [...h].sort());
      }
      ai += scoreRound(hands.map((h, i) => ({ rows: i === 0 ? solveSix(h, n, { keep: 1 })[0] : quickSix(h, n) })), sixRules(n)).net[0];
    }
    assert.ok(ai > 0, `AI lebih baik dari susunan sederhana (n=${n}): ${ai}`);
  }
});

test('solveSix: susunan contoh masuk akal', () => {
  const s = solveSix(P('10s Jh Kc Qs Ah Js'), 3, { keep: 1 })[0];
  assert.equal(sixCatOf(s.values[2]), SIX_CAT.STRAIGHT_FLUSH);
});
