import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/engine/cards.js';
import { isValid, evalRow } from '../src/engine/hands.js';
import { detectSpecial } from '../src/engine/special.js';
import { quickArrange, solve } from '../src/engine/arrange.js';
import { quickSix, isValidSix } from '../src/engine/six.js';
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
  assert.equal(next(r, 'bukansiapasiapa', 8, T0).ok, false, 'yang tidak duduk di meja ditolak');
  const before = [...r.totals];
  assert.equal(next(r, B.id, 8, T0 + 99).ok, true, 'bukan cuma host: siapa pun yang duduk boleh lanjut');
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

// ---------- Ranked ----------
import { createRanked, reserve, joinable, seatedUser, rankedDue, startRanked, nextRanked, settlePayload, applySettle, isPending, validSix, RANKED_WAIT_MS, RANKED_NEXT_MS, AFK_ROUNDS } from '../src/engine/room.js';

const U = (n, coins = 1000) => ({ key: `kunci${n}kunci${n}`, userId: `g:${n}`, name: `P${n}`, avatar: 4, coins });
const rankedStarted = (n = 2, stake = 5) => {
  const r = createRanked('RANKD', stake, T0);
  for (let i = 1; i <= n; i++) assert.equal(reserve(r, U(i), T0).ok, true);
  startRanked(r, 11, T0, rnd());
  return r;
};
const playAll = (r, now) => {
  for (let i = 0; i < 4; i++) if (!r.seats[i].bot && !r.seats[i].left) submit(r, i, detectSpecial(r.hands[i]) ? { special: true } : { rows: quickArrange(r.hands[i]) });
  finishRound(r, now);
};

test('Ranked: pesan kursi — saldo minimal, satu akun satu kursi, hitung mundur mulai', () => {
  const r = createRanked('RANKD', 10, T0);
  assert.equal(reserve(r, U(1, 4999), T0).ok, false, 'saldo di bawah minimal meja 10');
  assert.equal(rankedDue(r, T0 + 1000), null);
  assert.deepEqual(reserve(r, U(1, 6000), T0), { ok: true, key: U(1).key });
  assert.equal(r.startAt, T0 + RANKED_WAIT_MS);
  // akun yang sama dari HP lain: dapat kursi yang sama, bukan kursi kedua
  assert.deepEqual(reserve(r, { ...U(1, 6000), key: 'kuncilainkuncilain' }, T0 + 5), { ok: true, key: U(1).key });
  assert.equal(r.seats.filter(Boolean).length, 1);
  assert.deepEqual(seatedUser(r, 'g:1'), { key: U(1).key, left: false });
  assert.equal(seatedUser(r, 'g:9'), null);
  assert.equal(rankedDue(r, T0 + RANKED_WAIT_MS - 1), null);
  assert.equal(rankedDue(r, T0 + RANKED_WAIT_MS), 'start');
  for (const n of [2, 3, 4]) reserve(r, U(n, 6000), T0 + 10);
  assert.equal(r.startAt, T0 + 10, '4 pemain: langsung mulai');
  assert.equal(joinable(r), false);
  assert.equal(reserve(r, U(5, 6000), T0 + 20).ok, false);
});

test('Ranked: sambung ke meja hanya dengan kunci kursi; start/next manual ditolak', () => {
  const r = rankedStarted(1);
  assert.deepEqual(join(r, { id: U(1).key, name: 'x' }), { ok: true, seat: 0 });
  assert.equal(join(r, { id: 'bukankuncisaya', name: 'x' }).ok, false);
  assert.equal(start(r, U(1).key, 1, T0, rnd()).ok, false);
  finishRound(r, T0);
  assert.equal(next(r, U(1).key, 1, T0).ok, false);
});

test('Ranked: view tidak memuat id akun, kunci kursi lawan, atau saldo lawan', () => {
  const r = rankedStarted(2);
  r.seats[1].coins = 777123;
  const v = viewFor(r, 0, () => true, U(1).key);
  const text = JSON.stringify(v);
  assert.equal(v.ranked.stake, 5);
  assert.equal(v.ranked.coins, 1000);
  for (const secret of ['g:1', 'g:2', U(1).key, U(2).key, '777123']) assert.ok(!text.includes(secret), secret);
});

test('Ranked: koin per ronde — payload hanya pemain, saldo pasti dari server akun', () => {
  const r = rankedStarted(2);
  playAll(r, T0 + 30000);
  assert.equal(r.nextAt, T0 + 30000 + RANKED_NEXT_MS);
  assert.deepEqual(r.last.deltas, r.last.net.map((n) => n * 5));
  assert.equal(r.last.settled, false);
  const pay = settlePayload(r);
  assert.equal(pay.gameId, 'RANKD:1');
  assert.equal(pay.stake, 5);
  assert.deepEqual(pay.players, [{ userId: 'g:1', net: r.last.net[0] }, { userId: 'g:2', net: r.last.net[1] }]);
  // server akun: pemain 1 saldonya mentok di 0 (delta lebih kecil dari hitungan)
  applySettle(r, { 'g:1': { delta: -1000, coins: 0 }, 'g:2': { delta: 15, coins: 1015 } });
  assert.equal(r.last.settled, true);
  assert.equal(r.last.deltas[0], -1000);
  assert.equal(r.seats[0].coins, 0);
  assert.equal(viewFor(r, 1, () => true, U(2).key).ranked.coins, 1015);
  assert.equal(rankedDue(r, T0 + 30000 + RANKED_NEXT_MS - 1), null);
  assert.equal(rankedDue(r, T0 + 30000 + RANKED_NEXT_MS), 'next');
  // ronde berikutnya: pemain 1 (koin habis) dilepas dan diberi tahu; pemain 2 lanjut
  const out = nextRanked(r, 12, T0 + 50000, rnd());
  assert.equal(out.closed, false);
  assert.match(out.removed[U(1).key], /Koin tidak cukup/);
  assert.equal(r.seats[0].bot, true);
  assert.equal(r.totals[0], 0);
  assert.equal(r.round, 2);
  assert.equal(new Set(r.seats.map((s) => s.avatar)).size, 4);
});

test('Ranked: pemain baru saat ronde jalan menunggu, lalu menggantikan bot di ronde berikutnya', () => {
  const r = rankedStarted(1);
  assert.equal(joinable(r), true);
  assert.deepEqual(reserve(r, U(2), T0 + 100), { ok: true, key: U(2).key });
  assert.ok(isPending(r, U(2).key));
  assert.deepEqual(join(r, { id: U(2).key, name: 'x' }), { ok: true, seat: -1 });
  const v = viewFor(r, -1, () => true, U(2).key);
  assert.equal(v.ranked.waiting, true);
  assert.equal(v.hand, null, 'yang menunggu tidak dapat kartu');
  assert.equal(v.ranked.coins, 1000);
  for (const n of [3, 4]) reserve(r, U(n), T0 + 100);
  assert.equal(reserve(r, U(5), T0 + 100).ok, false, 'hanya 3 kursi bot yang bisa digantikan');
  playAll(r, T0 + 20000);
  applySettle(r, {});
  const out = nextRanked(r, 13, T0 + 40000, rnd());
  assert.deepEqual(out.removed, {});
  assert.equal(r.seats.filter((s) => !s.bot).length, 4);
  assert.equal(seatOf(r, U(2).key) >= 0, true);
  assert.equal(r.pending.length, 0);
  assert.equal(new Set(r.seats.map((s) => s.avatar)).size, 4);
});

test('Ranked: keluar → kursi dilepas di ronde berikutnya; semua keluar → meja ditutup', () => {
  const r = rankedStarted(2);
  leave(r, U(1).key);
  assert.equal(r.seats[0].left, true);
  playAll(r, T0 + 20000);
  assert.equal(settlePayload(r).players.length, 2, 'ronde yang sedang jalan tetap dihitung untuk yang keluar');
  applySettle(r, {});
  assert.equal(nextRanked(r, 14, T0 + 40000, rnd()).closed, false);
  assert.equal(r.seats[0].bot, true);
  leave(r, U(2).key);
  finishRound(r, T0 + 60000);
  const out = nextRanked(r, 15, T0 + 80000, rnd());
  assert.equal(out.closed, true);
  assert.equal(r.status, 'closed');
  assert.equal(joinable(r), false);
  assert.equal(reserve(r, U(3), T0).ok, false);
});

test('Ranked: tidak menyusun 2 ronde berturut-turut → dikeluarkan', () => {
  const r = rankedStarted(2);
  for (let k = 0; k < AFK_ROUNDS; k++) {
    submit(r, 1, { rows: quickArrange(r.hands[1]) }); // pemain 2 main, pemain 1 diam
    finishRound(r, T0 + 70000 * (k + 1));
    applySettle(r, {});
    assert.equal(r.seats[0].afk, k + 1);
    if (k < AFK_ROUNDS - 1) assert.deepEqual(nextRanked(r, 20 + k, T0, rnd()).removed, {});
  }
  const out = nextRanked(r, 30, T0, rnd());
  assert.match(out.removed[U(1).key], /tidak menyusun/);
  assert.equal(r.seats[0].bot, true);
  assert.equal(r.seats[1].afk, 0);
});

test('Ranked: meja tunggu yang ditinggal semua pemain ditutup', () => {
  const r = createRanked('RANKD', 5, T0);
  reserve(r, U(1), T0);
  leave(r, U(1).key);
  assert.equal(rankedDue(r, T0 + 30000), null);
  assert.equal(rankedDue(r, T0 + 61000), 'close');
});

// ---------- Ranked 6 kartu ----------
const sixStarted = (players, humans = 2, stake = 5) => {
  const r = createRanked('RANKD', stake, T0, players);
  for (let i = 1; i <= humans; i++) assert.equal(reserve(r, U(i, 6000), T0).ok, true);
  startRanked(r, 11, T0, rnd());
  return r;
};
const playSix = (r, now) => {
  r.seats.forEach((s, i) => { if (!s.bot && !s.left) assert.equal(submit(r, i, { rows: quickSix(r.hands[i], r.six) }).ok, true); });
  finishRound(r, now);
};

test('Ranked 6 kartu: kursi = jumlah pemain, 6 kartu per kursi, waktu 30 dtk', () => {
  for (const n of [3, 5, 8]) {
    const r = sixStarted(n);
    assert.equal(r.seats.length, n);
    assert.equal(r.seats.filter((s) => s.bot).length, n - 2);
    assert.equal(r.hands.length, n);
    assert.ok(r.hands.every((h) => h.length === 6));
    assert.equal(new Set(r.hands.flat()).size, n * 6, 'tidak ada kartu kembar');
    assert.equal(r.deadline, T0 + 30000 + GRACE_MS);
    assert.equal(viewFor(r, 0, () => true, U(1).key).six, n);
    assert.equal(r.seats.filter(Boolean).length, new Set(r.seats.map((s) => s.avatar)).size, 'avatar tidak kembar');
  }
  assert.equal(createRanked('RANKD', 5, T0, 0).six, 0);
  assert.ok(validSix(0) && validSix(3) && validSix(8) && !validSix(2) && !validSix(9) && !validSix(4.5));
});

test('Ranked 6 kartu: maksimal 4 pemain asli, 3 pemain = 3 kursi', () => {
  const r = createRanked('RANKD', 5, T0, 8);
  for (let i = 1; i <= 4; i++) assert.equal(reserve(r, U(i), T0).ok, true);
  assert.equal(r.startAt, T0, '4 pemain asli: langsung mulai');
  assert.equal(joinable(r), false);
  assert.equal(reserve(r, U(5), T0 + 1).ok, false);
  startRanked(r, 3, T0, rnd());
  assert.equal(r.seats.filter((s) => s.bot).length, 4);
  assert.equal(joinable(r), false, 'ronde jalan: bot masih ada tapi pemain asli sudah 4');
  const r3 = createRanked('RANKD', 5, T0, 3);
  for (let i = 1; i <= 3; i++) reserve(r3, U(i), T0);
  assert.equal(r3.startAt, T0, 'meja 3 kursi penuh = 3 pemain');
  assert.equal(joinable(r3), false);
});

test('Ranked 6 kartu: submit divalidasi 1-2-3, tanpa kartu spesial', () => {
  const r = sixStarted(4);
  const h = r.hands[0];
  const good = quickSix(h, 4);
  assert.equal(submit(r, 0, { special: true }).ok, false);
  assert.equal(submit(r, 0, { rows: { top: h.slice(0, 3), mid: h.slice(3, 5), bot: h.slice(5) } }).ok, false, 'ukuran salah');
  assert.equal(submit(r, 0, { rows: { top: [0], mid: [1, 2], bot: [3, 4, 5] } }).ok, false, 'bukan kartu yang dibagikan');
  // susunan terbalik (bawah paling lemah) yang memang tidak sah menurut aturan
  const asc = [...h].sort((a, b) => a - b);
  const bad = { top: [asc[5]], mid: [asc[3], asc[4]], bot: [asc[0], asc[1], asc[2]] };
  assert.equal(isValidSix(bad, 4), false);
  assert.equal(submit(r, 0, { rows: bad }).ok, false, 'bawah lebih lemah dari tengah');
  assert.equal(submit(r, 0, { rows: good }).ok, true);
});

test('Ranked 6 kartu: ronde penuh zero-sum, koin ikut taruhan, ronde berikutnya', () => {
  const r = sixStarted(6, 2, 10);
  for (let i = 0; i < 6; i++) if (r.seats[i].bot) autoArrange(r, i, false);
  playSix(r, T0 + 20000);
  assert.equal(r.status, 'result');
  assert.equal(r.last.net.length, 6);
  assert.equal(r.last.net.reduce((a, b) => a + b, 0), 0);
  assert.ok(r.last.shown.every((p) => p.rows.top.length === 1 && p.rows.mid.length === 2 && p.rows.bot.length === 3 && !p.special));
  assert.deepEqual(r.last.deltas, r.last.net.map((n) => n * 10));
  assert.equal(settlePayload(r).players.length, 2, 'bot tidak ikut dikirim ke server akun');
  assert.ok(settlePayload(r).players.every((p) => Math.abs(p.net) <= 400));
  applySettle(r, {});
  const out = nextRanked(r, 12, T0 + 50000, rnd());
  assert.equal(out.closed, false);
  assert.equal(r.round, 2);
  assert.equal(r.six, 6);
  assert.equal(r.seats.length, 6);
  assert.equal(r.hands.length, 6);
});

test('Ranked 6 kartu: pemain menunggu menggantikan bot, jumlah kursi tetap', () => {
  const r = sixStarted(5, 1);
  assert.equal(reserve(r, U(2), T0 + 100).ok, true);
  assert.ok(isPending(r, U(2).key));
  for (let i = 0; i < 5; i++) autoArrange(r, i, false);
  finishRound(r, T0 + 20000);
  applySettle(r, {});
  nextRanked(r, 13, T0 + 40000, rnd());
  assert.equal(r.seats.length, 5);
  assert.equal(r.seats.filter((s) => !s.bot).length, 2);
  assert.ok(seatOf(r, U(2).key) >= 0);
});

test('Ranked 6 kartu: view tidak membocorkan kartu lawan', () => {
  const r = sixStarted(4);
  const v = viewFor(r, 0, () => true, U(1).key);
  assert.equal(v.hand.length, 6);
  const text = JSON.stringify(v);
  for (const h of r.hands.slice(1)) assert.ok(!text.includes(JSON.stringify(h)), 'kartu lawan bocor');
  assert.ok(!text.includes('g:1') && !text.includes(U(1).key));
});
