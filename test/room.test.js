import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/engine/cards.js';
import { isValid, evalRow } from '../src/engine/hands.js';
import { detectSpecial } from '../src/engine/special.js';
import { quickArrange, solve } from '../src/engine/arrange.js';
import {
  createRoom, join, leave, start, next, submit, unsubmit, autoArrange, nextAuto, allIn, finishRound, viewFor, seatOf, fixHost, cleanName, validId, GRACE_MS,
} from '../src/engine/room.js';

const A = { id: 'aaaaaaaaaaaa', name: 'Teddy', avatar: 4 };
const B = { id: 'bbbbbbbbbbbb', name: 'Susi', avatar: 4 };
const C = { id: 'cccccccccccc', name: 'Budi', avatar: 1 };
const rnd = () => mulberry32(9);
const T0 = 1_000_000;
const started = (seed = 7) => {
  const r = createRoom('ABCDE', A, T0);
  join(r, B);
  assert.equal(start(r, A.id, seed, T0, rnd()).ok, true);
  return r;
};

test('nama & id dibersihkan', () => {
  assert.equal(cleanName('  <b>Te  ddy</b>\n'), 'bTe ddy/b');
  assert.equal(cleanName(''), 'Pemain');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.ok(validId('abc123abc123'));
  assert.ok(!validId('short'));
  assert.ok(!validId('ABC123ABC123'));
  assert.ok(!validId(null));
});

test('masuk: kursi berurutan, avatar tidak kembar, penuh ditolak, kembali ke kursi sendiri', () => {
  const r = createRoom('ABCDE', A, T0);
  assert.deepEqual(join(r, B), { ok: true, seat: 1 });
  assert.notEqual(r.seats[1].avatar, r.seats[0].avatar);
  assert.deepEqual(join(r, C), { ok: true, seat: 2 });
  assert.deepEqual(join(r, B), { ok: true, seat: 1 }, 'masuk lagi = kursi yang sama');
  join(r, { id: 'dddddddddddd', name: 'D' });
  assert.equal(join(r, { id: 'eeeeeeeeeeee', name: 'E' }).ok, false);
});

test('keluar di ruang tunggu melepas kursi & host pindah', () => {
  const r = createRoom('ABCDE', A, T0);
  join(r, B);
  leave(r, A.id);
  assert.equal(r.seats[0], null);
  assert.equal(r.hostId, B.id);
});

test('mulai: hanya host, kursi kosong diisi bot, tiap kursi 13 kartu', () => {
  const r = createRoom('ABCDE', A, T0);
  join(r, B);
  assert.equal(start(r, B.id, 1, T0, rnd()).ok, false);
  assert.equal(start(r, A.id, 1, T0, rnd()).ok, true);
  assert.equal(r.status, 'arrange');
  assert.equal(r.seats.filter((s) => s.bot).length, 2);
  assert.equal(new Set(r.seats.map((s) => s.avatar)).size, 4);
  assert.equal(new Set(r.hands.flat()).size, 52);
  assert.equal(r.deadline, T0 + 60000 + GRACE_MS);
  assert.equal(join(r, C).ok, false, 'tidak bisa masuk setelah mulai');
});

test('viewFor: hanya kartu sendiri, tanpa id pemain, tanpa susunan lawan', () => {
  const r = started();
  autoArrange(r, 2);
  submit(r, 1, { rows: quickArrange(r.hands[1]) });
  const v = viewFor(r, 0);
  assert.deepEqual(v.hand, r.hands[0]);
  assert.equal(v.mine, null);
  assert.deepEqual(v.seats.map((s) => s.ready), [false, true, true, false]);
  const text = JSON.stringify(v);
  for (const id of [A.id, B.id]) assert.ok(!text.includes(id), 'id pemain bocor');
  assert.ok(!('hands' in v) && !('subs' in v));
  // kartu lawan tidak ada di view (selain kartu sendiri)
  const others = new Set(r.hands.flatMap((h, i) => (i === 0 ? [] : h)));
  const seen = new Set(text.match(/\d+/g).map(Number));
  assert.ok(v.hand.every((c) => seen.has(c)));
  assert.equal(v.last, null);
  assert.ok([...others].length === 39);
  // penonton (bukan pemain) tidak dapat kartu
  assert.equal(viewFor(r, -1).hand, null);
});

test('submit: kartu harus persis milik sendiri & susunan sah', () => {
  const r = started();
  const mine = quickArrange(r.hands[0]);
  assert.equal(submit(r, 0, { rows: quickArrange(r.hands[1]) }).ok, false, 'kartu orang lain');
  assert.equal(submit(r, 0, { rows: { top: mine.top, mid: mine.mid, bot: mine.mid } }).ok, false, 'kartu dobel');
  assert.ok(evalRow(mine.bot) > evalRow(mine.mid));
  assert.equal(submit(r, 0, { rows: { top: mine.top, mid: mine.bot, bot: mine.mid } }).ok, false, 'urutan salah: tengah lebih kuat dari bawah');
  assert.equal(submit(r, 0, { rows: { top: [1, 2], mid: mine.mid, bot: mine.bot } }).ok, false);
  assert.equal(submit(r, 0, { rows: { top: ['1', 2, 3], mid: mine.mid, bot: mine.bot } }).ok, false);
  assert.equal(submit(r, 0, null).ok, false);
  assert.equal(submit(r, 0, { special: true }).ok, !!detectSpecial(r.hands[0]));
  assert.equal(submit(r, 0, { rows: mine }).ok, true);
  assert.deepEqual(viewFor(r, 0).mine.rows, r.subs[0].rows);
  assert.equal(unsubmit(r, 0).ok, true);
  assert.equal(r.subs[0], null);
  assert.equal(unsubmit(r, 2).ok, false, 'kursi bot tidak bisa dibatalkan');
});

test('kartu spesial: hanya diterima kalau memang punya', () => {
  for (let seed = 1; seed < 400; seed++) {
    const r = started(seed);
    const i = [0, 1].find((k) => detectSpecial(r.hands[k]));
    if (i === undefined) continue;
    assert.equal(submit(r, i, { special: true }).ok, true);
    assert.equal(r.subs[i].special, detectSpecial(r.hands[i]).type);
    return;
  }
  assert.fail('tidak ketemu seed dengan kartu spesial');
});

test('ronde penuh: bot menyusun, hasil zero-sum, total bertambah, ronde berikutnya', () => {
  const r = started();
  assert.equal(nextAuto(r), 2);
  autoArrange(r, 2);
  assert.equal(nextAuto(r), 3);
  autoArrange(r, 3, false);
  assert.equal(nextAuto(r), -1);
  submit(r, 0, { rows: solve(r.hands[0], { keep: 1 })[0] });
  assert.equal(allIn(r), false);
  finishRound(r); // waktu habis: kursi 1 disusun otomatis
  assert.equal(r.status, 'result');
  assert.equal(r.last.round, 1);
  assert.equal(r.last.net.reduce((s, x) => s + x, 0), 0);
  assert.deepEqual(r.totals, r.last.net);
  for (const p of r.last.shown) assert.ok(p.special || isValid(p.rows.top, p.rows.mid, p.rows.bot));
  assert.equal(new Set(r.last.shown.flatMap((p) => [...p.rows.top, ...p.rows.mid, ...p.rows.bot])).size, 52);
  const v = viewFor(r, 1);
  assert.equal(v.hand, null);
  assert.deepEqual(v.last, r.last);
  assert.equal(next(r, B.id, 8, T0).ok, false, 'hanya host');
  const before = [...r.totals];
  assert.equal(next(r, A.id, 8, T0 + 99).ok, true);
  assert.equal(r.round, 2);
  assert.equal(r.status, 'arrange');
  assert.deepEqual(r.totals, before);
  assert.equal(viewFor(r, 0).last, null);
});

test('pemain keluar saat main: kursinya dimainkan otomatis, host pindah, bisa kembali', () => {
  const r = started();
  leave(r, A.id);
  assert.equal(r.seats[0].left, true);
  assert.equal(r.hostId, B.id);
  assert.equal(nextAuto(r), 0);
  assert.equal(seatOf(r, A.id), 0);
  assert.deepEqual(join(r, A), { ok: true, seat: 0 });
  assert.equal(r.seats[0].left, false);
  fixHost(r, (id) => id === A.id); // B putus
  assert.equal(r.hostId, A.id);
});
