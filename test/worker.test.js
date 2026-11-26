// Tes Durable Object meja & pencari meja (worker/room.js, worker/lobby.js) — bagian yang tidak tertutup test/room.test.js:
// penyimpanan, WebSocket, alarm, penyelesaian koin di server akun, dan pembukuan meja Ranked di CapsaLobby.
//
// Dijalankan di Node biasa: `cloudflare:workers` diganti tiruan lewat loader hook (test/helpers/cfstub.mjs),
// `Date.now` dikendalikan supaya alarm bisa dimajukan tanpa menunggu betulan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { solve } from '../src/engine/arrange.js';

register('./helpers/cfstub.mjs', import.meta.url);

// ---------- tiruan lingkungan Workers ----------
let NOW = 1700000000000;
const realNow = Date.now;
Date.now = () => NOW;
const advance = (ms) => { NOW += ms; };

class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.closed = null; this.att = null; }
  send(s) { if (this.readyState !== 1) throw new Error('soket tertutup'); this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
  msgs(t) { return this.sent.filter((m) => m.t === t); }
  last(t) { return this.msgs(t).at(-1); }
}

class FakeStorage {
  constructor() { this.data = new Map(); this.alarmAt = null; }
  async get(k) { return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined; }
  async put(k, v) { this.data.set(k, structuredClone(v)); } // structuredClone = cek state-nya memang bisa disimpan
  async deleteAll() { this.data.clear(); this.alarmAt = null; }
  async setAlarm(at) { this.alarmAt = at; }
  async sync() {}
}

class FakeCtx {
  constructor() { this.storage = new FakeStorage(); this.sockets = []; }
  blockConcurrencyWhile(f) { this.pending = f(); return this.pending; }
  acceptWebSocket(ws) { this.sockets.push(ws); }
  getWebSockets() { return this.sockets.filter((w) => w.readyState === 1); }
}

globalThis.WebSocketPair = function () { return { 0: new FakeWS(), 1: new FakeWS() }; };
globalThis.Response = class { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket ?? null; } };

const { CapsaRoom, SETTLE_TRIES } = await import('../worker/room.js');
const { CapsaLobby } = await import('../worker/lobby.js');

/** Satu meja + lingkungannya. settle = fungsi yang meniru server akun. */
async function makeRoom({ settle = null, lobby = null } = {}) {
  const ctx = new FakeCtx();
  const noop = { reopen: async () => {}, release: async () => {} };
  const env = {
    MAHJONG: settle ? { settle } : undefined,
    LOBBY: { idFromName: () => 'main', get: () => lobby || noop },
  };
  const room = new CapsaRoom(ctx, env);
  await ctx.pending; // DurableObject asli menahan permintaan sampai blockConcurrencyWhile selesai
  return room;
}

/** Sambungkan satu pemain lewat jalur asli (CapsaRoom.fetch). -> soketnya */
async function connect(ro, user) {
  const req = { headers: new Headers({ Upgrade: 'websocket', 'X-User': JSON.stringify(user) }) };
  await ro.fetch(req);
  return ro.ctx.sockets.at(-1);
}

const say = (ro, ws, m) => ro.webSocketMessage(ws, JSON.stringify(m));
const seatOfKey = (ro, key) => ro.room.seats.findIndex((s) => s && !s.bot && s.id === key);

/** Kirim susunan untuk kursi `key` kalau belum menyusun. */
async function arrange(ro, ws, key) {
  const r = ro.room;
  const i = seatOfKey(ro, key);
  if (r.status !== 'arrange' || i < 0 || r.subs[i]) return;
  await say(ro, ws, { t: 'submit', rows: solve(r.hands[i], { keep: 1 })[0] });
}

/** Majukan waktu ke alarm berikutnya dan jalankan, sampai `stop()` atau kehabisan langkah. */
async function runAlarms(ro, stop, { max = 200, before = null } = {}) {
  for (let i = 0; i < max; i++) {
    if (stop()) return true;
    if (before) await before();
    if (stop()) return true;
    const at = ro.ctx.storage.alarmAt;
    if (at == null) return false;
    if (at > NOW) NOW = at;
    ro.ctx.storage.alarmAt = null;
    await ro.alarm();
    if (!ro.room) return stop();
  }
  return stop();
}

test('meja teman: dibuat, info, pemain gabung lewat WebSocket, host memulai, kartu dibagi per kursi', async () => {
  const ro = await makeRoom();
  assert.deepEqual(await ro.init('ABCDE', { id: 'aaaaaaaaaaaa', name: 'Ani', avatar: 1 }), { ok: true });
  assert.deepEqual(await ro.init('ABCDE', { id: 'bbbbbbbbbbbb', name: 'Budi' }), { ok: false }, 'kode yang sama tidak bisa dipakai dua kali');
  const info = await ro.info('aaaaaaaaaaaa');
  assert.equal(info.status, 'lobby');
  assert.equal(info.mine, true);
  assert.equal((await ro.info('zzzzzzzzzzzz')).mine, false);

  const a = await connect(ro, { id: 'aaaaaaaaaaaa', name: 'Ani', avatar: 1 });
  const b = await connect(ro, { id: 'bbbbbbbbbbbb', name: 'Budi', avatar: 2 });
  assert.ok(a.last('state'), 'pemain langsung dapat state');

  await say(ro, b, { t: 'start' });
  assert.equal(b.last('error').msg, 'Hanya pembuat meja yang bisa memulai');
  await say(ro, a, { t: 'start' });
  const v = a.last('state').view;
  assert.equal(v.status, 'arrange');
  assert.equal(v.seats.filter((s) => s.bot).length, 2, 'kursi kosong diisi bot');
  assert.equal(v.hand.length, 13);
  assert.equal(b.last('state').view.hand.length, 13);
  assert.notDeepEqual(v.hand, b.last('state').view.hand);
  assert.equal(JSON.stringify(v).includes('bbbbbbbbbbbb'), false, 'id pemain tidak keluar ke klien');
  assert.ok(ro.ctx.storage.data.has('room'), 'meja tersimpan');
  assert.ok(ro.ctx.storage.alarmAt > NOW, 'alarm berikutnya dipasang');
});

test('meja teman: ping dibalas pong, pesan rusak diabaikan, "Ronde berikutnya" boleh ditekan siapa pun yang duduk', async () => {
  const ro = await makeRoom();
  await ro.init('ABCDE', { id: 'aaaaaaaaaaaa', name: 'Ani' });
  const a = await connect(ro, { id: 'aaaaaaaaaaaa', name: 'Ani' });
  const b = await connect(ro, { id: 'bbbbbbbbbbbb', name: 'Budi' });
  a.sent.length = 0;
  await ro.webSocketMessage(a, 'bukan json');
  await ro.webSocketMessage(a, 'x'.repeat(2001));
  assert.equal(a.sent.length, 0, 'pesan rusak diabaikan diam-diam');
  await ro.webSocketMessage(a, JSON.stringify({ t: 'ping' }));
  assert.equal(a.sent.at(-1).t, 'pong');

  await say(ro, a, { t: 'start' });
  await runAlarms(ro, () => ro.room.status === 'result', {
    before: async () => { await arrange(ro, a, 'aaaaaaaaaaaa'); await arrange(ro, b, 'bbbbbbbbbbbb'); },
  });
  assert.equal(ro.room.status, 'result');
  assert.equal(ro.room.hostId, 'aaaaaaaaaaaa');
  await say(ro, b, { t: 'next' }); // bukan host
  assert.equal(b.msgs('error').length, 0, 'tidak ditolak');
  assert.equal(ro.room.round, 2);
  assert.equal(ro.room.status, 'arrange');
});

test('meja teman: putus di ruang tunggu melepas kursi', async () => {
  const ro = await makeRoom();
  await ro.init('ABCDE', { id: 'aaaaaaaaaaaa', name: 'Ani' });
  await connect(ro, { id: 'aaaaaaaaaaaa', name: 'Ani' });
  const b = await connect(ro, { id: 'bbbbbbbbbbbb', name: 'Budi' });
  assert.equal(ro.room.seats.filter(Boolean).length, 2);
  b.readyState = 3;
  await ro.webSocketClose(b);
  assert.equal(ro.room.seats.filter(Boolean).length, 1);
});

/** Meja Ranked dengan satu pemain asli, dijalankan sampai ronde pertama selesai & tercatat. */
async function rankedRound(ro, key = 'k1k1k1k1k1k1', stake = 5, coins = 6000) {
  await ro.initRanked('RANK1', stake);
  const res = await ro.reserve({ key, userId: 'u1', name: 'Ani', avatar: 3, coins });
  assert.ok(res.ok, res.error);
  const ws = await connect(ro, { id: key, name: 'Ani', avatar: 3 });
  const done = await runAlarms(ro, () => ro.room?.status === 'result' && ro.room.last?.settled, {
    before: async () => { await arrange(ro, ws, key); },
  });
  return { ws, done };
}

test('Ranked: reserve → mulai sendiri → ronde selesai → koin dari server akun masuk ke pemain', async () => {
  const calls = [];
  const ro = await makeRoom({
    settle: async (p) => {
      calls.push(p);
      return { u1: { delta: -40, coins: 5960 } };
    },
  });
  const { ws, done } = await rankedRound(ro);
  assert.ok(done, 'ronde selesai & tercatat di server akun');
  assert.equal(calls.length, 1, 'server akun dipanggil sekali per ronde');

  const p = calls[0];
  assert.equal(p.gameId, 'RANK1:1');
  assert.equal(p.stake, 5);
  assert.equal(p.players.filter((x) => x.userId).length, 1);
  assert.equal(p.players.find((x) => x.userId).userId, 'u1');

  const v = ws.last('state').view;
  assert.equal(v.last.settled, true);
  assert.equal(v.last.deltas[v.seat], -40);
  assert.equal(v.ranked.coins, 5960);
  assert.equal(JSON.stringify(v).includes('u1'), false, 'userId tidak pernah keluar ke klien');
  assert.equal(await ro.seated('u9'), null);
  assert.deepEqual(await ro.seated('u1'), { key: 'k1k1k1k1k1k1', left: false, stake: 5 });
});

test('Ranked: settle tidak dikirim dua kali walau pump dipanggil barengan', async () => {
  let calls = 0, open = 0, max = 0, done = 0;
  let release;
  const gate = new Promise((res) => { release = res; });
  const ro = await makeRoom({
    settle: async () => {
      calls++;
      open++;
      max = Math.max(max, open);
      try {
        if (calls === 1) throw new Error('coba lagi'); // panggilan pertama gagal → ronde belum selesai dicatat
        await gate; // panggilan kedua menggantung: tiru server akun yang lambat
        done++;
        return {};
      } finally {
        open--;
      }
    },
  });
  await ro.initRanked('RANK2', 5);
  await ro.reserve({ key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', coins: 6000 });
  const ws = await connect(ro, { id: 'k1k1k1k1k1k1', name: 'Ani' });
  await runAlarms(ro, () => ro.room?.status === 'result', {
    before: async () => { await arrange(ro, ws, 'k1k1k1k1k1k1'); },
  });
  assert.equal(ro.room.status, 'result');
  assert.equal(ro.room.last.settled, false);

  // settle kedua masih menunggu server akun; pesan lain yang masuk memicu pump() lagi
  const first = ro.pump();
  await say(ro, ws, { t: 'ping' });
  await ro.pump();
  assert.equal(max, 1, 'hanya satu settle yang jalan sekaligus');
  release();
  await first;
  assert.equal(done, 1);
});

test('Ranked: server akun gagal terus → setelah beberapa percobaan ronde ditutup tanpa koin berpindah', async () => {
  let tries = 0;
  const ro = await makeRoom({ settle: async () => { tries++; throw new Error('mati'); } });
  await ro.initRanked('RANK3', 5);
  await ro.reserve({ key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', coins: 6000 });
  const ws = await connect(ro, { id: 'k1k1k1k1k1k1', name: 'Ani' });
  await runAlarms(ro, () => ro.room?.status === 'result', {
    before: async () => { await arrange(ro, ws, 'k1k1k1k1k1k1'); },
  });
  for (let i = 0; i < SETTLE_TRIES + 2 && !ro.room.last.settled; i++) {
    advance(5000);
    await ro.pump();
  }
  assert.equal(ro.room.last.settled, true);
  assert.equal(ro.room.last.failed, true);
  assert.ok(tries >= SETTLE_TRIES, `dicoba ulang (${tries}x)`);
  assert.deepEqual(ro.room.last.deltas, [0, 0, 0, 0], 'tidak ada koin yang berpindah');
});

test('Ranked: meja tanpa pemain ditutup dan dicabut dari pencari meja', async () => {
  const log = [];
  const lobby = { reopen: async (...a) => log.push(['reopen', ...a]), release: async (...a) => log.push(['release', ...a]) };
  const ro = await makeRoom({ settle: async () => ({}), lobby });
  await ro.initRanked('RANK4', 10, 6);
  advance(70000);
  await ro.alarm();
  assert.equal(ro.room, null, 'meja kosong ditutup');
  assert.deepEqual(log, [['release', 10, 'RANK4', 6]], 'taruhan + jenis meja ikut, supaya slot yang benar yang dicabut');
});

test('CapsaLobby: pemain masuk meja yang sama, meja penuh bikin meja baru, 6 kartu antre sendiri, reopen & release', async () => {
  const rooms = new Map();
  const ctx = new FakeCtx();
  const lobby = new CapsaLobby(ctx, {});
  await ctx.pending;
  // tiruan CapsaRoom: cukup yang dipakai CapsaLobby
  const stub = (code) => {
    if (!rooms.has(code)) rooms.set(code, { code, stake: 0, six: 0, seats: [], closed: false, max: 4 });
    const r = rooms.get(code);
    return {
      initRanked: async (c, stake, six = 0) => (r.stake ? { ok: false } : ((r.stake = stake), (r.six = six), (r.max = six || 4), { ok: true })),
      seated: async (userId) => (r.closed ? null : r.seats.includes(userId) ? { key: 'k', left: false } : null),
      reserve: async (u) => {
        if (r.closed) return { ok: false, error: 'Meja tidak ditemukan', joinable: false };
        if (!r.seats.includes(u.userId)) {
          if (r.seats.length >= r.max) return { ok: false, error: 'Meja penuh', joinable: false };
          r.seats.push(u.userId);
        }
        return { ok: true, key: u.key, joinable: r.seats.length < r.max };
      },
    };
  };
  lobby.env = { ROOMS: { idFromName: (c) => c, get: (c) => stub(c) } };

  const join = (userId, six = 0) => lobby.assign(5, { userId, name: userId, avatar: 0, coins: 6000 }, six);
  const a = await join('u1');
  const b = await join('u2');
  assert.ok(a.ok && b.ok);
  assert.equal(b.code, a.code, 'pemain kedua masuk meja yang sama');
  assert.notEqual(a.key, b.key, 'kunci kursi berbeda tiap pemain');
  const again = await join('u1');
  assert.equal(again.code, a.code, 'satu akun kembali ke mejanya sendiri');
  assert.equal(again.resumed, true);

  // meja 6 kartu punya antrean sendiri
  const six = await join('u9', 5);
  assert.notEqual(six.code, a.code);
  assert.equal(rooms.get(six.code).six, 5);

  await join('u3');
  await join('u4');
  const e = await join('u5');
  assert.notEqual(e.code, a.code, 'meja penuh → meja baru');

  // meja pertama longgar lagi → ditawarkan lagi, bukan bikin meja ketiga
  rooms.get(e.code).seats = ['u5', 'x', 'y', 'z'];
  await lobby.release(5, e.code);
  rooms.get(a.code).seats = ['u1'];
  await lobby.reopen(5, a.code);
  assert.equal((await join('u6')).code, a.code, 'meja yang dibuka lagi dipakai');

  // meja yang sudah tutup tidak nyangkut
  rooms.get(a.code).closed = true;
  await lobby.release(5, a.code);
  const f = await join('u7');
  assert.ok(f.ok);
  assert.notEqual(f.code, a.code);
});

test.after(() => { Date.now = realNow; });
