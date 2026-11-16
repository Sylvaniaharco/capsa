import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, deal } from '../src/engine/cards.js';
import { solve, quickArrange } from '../src/engine/arrange.js';
import { isValid } from '../src/engine/hands.js';
import { botPick, LEVELS, DEFAULT_LEVEL, validLevel } from '../src/engine/bot.js';

test('level bot: nama, default, validasi', () => {
  assert.deepEqual(LEVELS, ['Mudah', 'Sedang', 'Sulit']);
  assert.equal(LEVELS[DEFAULT_LEVEL], 'Sedang');
  assert.ok(validLevel(0) && validLevel(2) && !validLevel(3) && !validLevel(-1) && !validLevel('1'));
});

test('level bot: selalu susunan sah, Sulit hanya terbaik/kedua, level rendah memakai ketiganya & susunan sederhana', () => {
  const hand = deal(mulberry32(5))[0];
  const opts = solve(hand, { keep: 3 });
  const quick = quickArrange(hand);
  const rnd = mulberry32(1);
  const seen = [new Set(), new Set(), new Set()];
  for (let i = 0; i < 400; i++) {
    for (const lv of [0, 1, 2]) {
      const r = botPick(opts, () => quick, lv, rnd);
      assert.ok(isValid(r.top, r.mid, r.bot));
      seen[lv].add(r === quick ? 'q' : opts.indexOf(r));
    }
  }
  assert.ok([...seen[2]].every((k) => k === 0 || k === 1), 'Sulit tidak pernah memilih ketiga/sederhana');
  for (const lv of [0, 1]) assert.ok(seen[lv].has('q') && seen[lv].has(0) && seen[lv].has(2), `level ${lv} bervariasi`);
});

test('level bot: hasil bisa diulang dari seed yang sama; tanpa pilihan kedua/ketiga tetap jalan', () => {
  const hand = deal(mulberry32(9))[1];
  const opts = solve(hand, { keep: 3 });
  const q = () => quickArrange(hand);
  assert.equal(botPick(opts, q, 1, mulberry32(42)), botPick(opts, q, 1, mulberry32(42)));
  const one = botPick([opts[0]], q, 0, mulberry32(3));
  assert.ok(one === opts[0] || one.top);
});
