// Satu meja online = satu Durable Object. Logika mejanya murni di src/engine/room.js; di sini hanya penyimpanan,
// WebSocket, dan alarm (giliran bot menyusun, batas waktu ronde, bersih-bersih meja kosong).
import { DurableObject } from 'cloudflare:workers';
import * as R from '../src/engine/room.js';

const BOT_FIRST_MS = 2500; // bot pertama "siap" segini setelah kartu dibagi
const BOT_GAP_MS = 1800; // jeda antar bot (satu bot per alarm, supaya hitungan susunan tidak menumpuk di satu panggilan)
const IDLE_MS = 10 * 60 * 1000; // meja tanpa koneksi dihapus setelah segini
const SETTLE_RETRY_MS = 3000; // server akun tidak menjawab: coba lagi segini kemudian
const SETTLE_TRIES = 8;
const OFFLINE_MS = 8000; // semua yang masih tersambung sudah menyusun & sisanya putus: ronde ditutup segini kemudian (tidak menunggu 60 dtk)

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class CapsaRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || null;
    });
  }

  async save() {
    await this.ctx.storage.put('room', this.room);
  }

  /** Dipanggil Worker saat meja dibuat. */
  async init(code, host) {
    if (this.room) return { ok: false };
    this.room = R.createRoom(code, host, Date.now());
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return { ok: true };
  }

  /** Status ringkas: dipakai klien sebelum gabung dan untuk masuk lagi setelah app ditutup. */
  async info(id) {
    const r = this.room;
    if (!r) return { status: 'none', free: 0, mine: false, ranked: false };
    return { status: r.status, free: r.seats.filter((s) => !s).length, mine: R.seatOf(r, id) >= 0 || R.isPending(r, id), ranked: !!r.ranked };
  }

  // ---------- Ranked: dipanggil CapsaLobby (worker/lobby.js) setelah akun diverifikasi ----------
  async initRanked(code, stake) {
    if (this.room) return { ok: false };
    this.room = R.createRanked(code, stake, Date.now());
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + 65000);
    return { ok: true };
  }

  /** Akun ini masih duduk di meja ini? -> { key, left, stake } | null */
  async seated(userId) {
    const r = this.room;
    const s = r?.ranked && r.status !== 'closed' ? R.seatedUser(r, userId) : null;
    return s ? { ...s, stake: r.ranked.stake } : null;
  }

  async reserve(user) {
    const r = this.room;
    if (!r) return { ok: false, error: 'Meja tidak ditemukan' };
    const res = R.reserve(r, user, Date.now());
    if (res.ok) await this.pump();
    return { ...res, joinable: R.joinable(r) };
  }

  // ---------- koneksi ----------
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket saja', { status: 426 });
    const user = JSON.parse(request.headers.get('X-User') || 'null');
    if (!user || !this.room) return new Response('Meja tidak ditemukan', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: user.id });
    const j = R.join(this.room, user);
    if (!j.ok) {
      server.send(JSON.stringify({ t: 'error', msg: j.error, fatal: true }));
      server.close(4000, 'ditolak');
      return new Response(null, { status: 101, webSocket: client });
    }
    await this.pump();
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() {
    return this.ctx.getWebSockets().map((ws) => ({ ws, ...(ws.deserializeAttachment() || {}) }));
  }

  isConnected(id, except = null) {
    return this.sockets().some((s) => s.id === id && s.ws !== except && s.ws.readyState === 1);
  }

  broadcast() {
    const r = this.room;
    const connected = (id) => this.isConnected(id);
    const now = Date.now();
    for (const { ws, id } of this.sockets()) {
      try {
        ws.send(JSON.stringify({ t: 'state', now, view: R.viewFor(r, R.seatOf(r, id), connected, id) }));
      } catch { /* soket sudah mati: dibersihkan saat close */ }
    }
  }

  async webSocketMessage(ws, data) {
    const r = this.room;
    if (!r || typeof data !== 'string' || data.length > 2000) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const { id } = ws.deserializeAttachment() || {};
    const seat = R.seatOf(r, id);
    const now = Date.now();
    let res = null;
    if (m.t === 'ping') return ws.send('{"t":"pong"}');
    if (m.t === 'start') {
      res = R.start(r, id, seed(), now, Math.random);
      if (res.ok) r.autoAt = now + BOT_FIRST_MS;
    } else if (m.t === 'next') {
      res = R.next(r, id, seed(), now);
      if (res.ok) r.autoAt = now + BOT_FIRST_MS;
    } else if (m.t === 'submit') res = R.submit(r, seat, m);
    else if (m.t === 'redo') res = R.unsubmit(r, seat);
    else if (m.t === 'leave') {
      R.leave(r, id);
      try { ws.close(1000, 'keluar'); } catch { /* sudah tertutup */ }
    } else return;
    if (res && !res.ok && res.error) ws.send(JSON.stringify({ t: 'error', msg: res.error }));
    await this.pump(m.t === 'leave' ? ws : null);
  }

  async webSocketClose(ws) {
    const r = this.room;
    if (!r) return;
    const { id } = ws.deserializeAttachment() || {};
    // di ruang tunggu, kursi dilepas kalau tidak ada koneksi lain dari pemain itu
    if (r.status === 'lobby' && id && !this.isConnected(id, ws)) R.leave(r, id);
    await this.pump(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  /** Simpan, kirim tampilan ke semua, dan pasang alarm berikutnya. `closing` = soket yang sedang ditutup (tidak dihitung tersambung). */
  async pump(closing = null) {
    const r = this.room;
    if (R.allIn(r)) R.finishRound(r, Date.now());
    if (r.ranked && r.status === 'result' && r.last && !r.last.settled) await this.settle();
    R.fixHost(r, (id) => this.isConnected(id, closing));
    await this.save();
    this.broadcast();
    const now = Date.now();
    let at = now + IDLE_MS;
    if (r.status === 'arrange') {
      if (R.nextAuto(r) >= 0) at = Math.min(r.deadline, Math.max(now + 50, r.autoAt || 0));
      else {
        // tinggal menunggu pemain yang koneksinya putus? beri waktu OFFLINE_MS untuk kembali, lalu tutup ronde
        r.offlineAt = this.waitingOnOnline(closing) ? 0 : r.offlineAt || now + OFFLINE_MS;
        at = r.offlineAt ? Math.min(r.deadline, r.offlineAt) : r.deadline;
      }
    }
    else if (r.ranked && r.status === 'lobby') at = r.seats.some(Boolean) ? Math.max(now + 50, r.startAt) : r.createdAt + 65000;
    else if (r.ranked && r.status === 'result') at = r.last.settled ? Math.max(now + 50, r.nextAt) : now + SETTLE_RETRY_MS;
    await this.ctx.storage.setAlarm(at);
  }

  /** Masih ada pemain tersambung yang belum menyusun? */
  waitingOnOnline(closing = null) {
    const r = this.room;
    return r.seats.some((s, i) => s && !s.bot && !s.left && !r.subs[i] && this.isConnected(s.id, closing));
  }

  /**
   * Ranked: selesaikan koin ronde terakhir di server akun (Worker Mahjong, lewat service binding).
   * Aman diulang (server akun mencatat tiap ronde). Kalau server akun tidak menjawab, dicoba lagi lewat alarm;
   * setelah SETTLE_TRIES kali ronde dianggap selesai tanpa perubahan koin, supaya meja tidak macet.
   */
  async settle() {
    const r = this.room;
    r.last.tries = (r.last.tries || 0) + 1;
    try {
      const res = await this.env.MAHJONG.settle(R.settlePayload(r));
      if (res) return R.applySettle(r, res);
      console.error('settle ditolak server akun', r.code, r.last.round);
    } catch (e) {
      console.error('settle gagal', r.code, r.last.round, String(e?.message || e));
      if (r.last.tries < SETTLE_TRIES) return;
    }
    // ditolak atau gagal terus: tidak ada koin yang berpindah di ronde ini
    r.last.deltas = [0, 0, 0, 0];
    r.last.settled = true;
    r.last.failed = true;
  }

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if (r.ranked && r.status !== 'arrange') {
      if (r.status === 'result' && r.last && !r.last.settled) return this.pump(); // koin ronde ini belum selesai: jangan lanjut dulu
      const due = R.rankedDue(r, now);
      if (due === 'start') {
        R.startRanked(r, seed(), now, Math.random);
        r.autoAt = now + BOT_FIRST_MS;
      } else if (due === 'next') {
        const out = R.nextRanked(r, seed(), now, Math.random);
        r.autoAt = now + BOT_FIRST_MS;
        // pemain yang dilepas (koin kurang / tidak aktif / meja penuh): beri tahu lalu putuskan
        for (const { ws, id } of this.sockets()) {
          if (!out.removed[id]) continue;
          try {
            ws.send(JSON.stringify({ t: 'error', msg: out.removed[id], fatal: true }));
            ws.close(4000, 'dilepas');
          } catch { /* sudah tertutup */ }
        }
      }
      if (due === 'close' || r.status === 'closed') {
        for (const { ws } of this.sockets()) {
          try { ws.close(4000, 'tutup'); } catch { /* sudah tertutup */ }
        }
        await this.ctx.storage.deleteAll();
        this.room = null;
        return;
      }
      return this.pump(); // juga mengulang penyelesaian koin yang belum berhasil
    }
    if (r.status === 'arrange') {
      const allOffline = R.nextAuto(r) < 0 && r.offlineAt && now >= r.offlineAt && !this.waitingOnOnline();
      if (now >= r.deadline || allOffline) R.finishRound(r, now); // yang belum menyusun disusun otomatis (cara cepat)
      else {
        const i = R.nextAuto(r);
        if (i >= 0) {
          // Percobaan pertama pakai pencari susunan penuh (berat). Kalau panggilan itu dihentikan karena batas CPU,
          // alarm diulang dan kursi ini memakai cara cepat — ronde tidak pernah macet.
          const smart = !r.tried[i];
          r.tried[i] = true;
          await this.save();
          await this.ctx.storage.sync(); // tanda "sudah dicoba" harus benar-benar tersimpan sebelum hitungan berat dimulai
          R.autoArrange(r, i, smart);
          r.autoAt = now + BOT_GAP_MS;
        }
      }
      return this.pump();
    }
    // ruang tunggu / layar hasil: hapus meja yang sudah tidak ada orangnya
    if (!this.sockets().length) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.ctx.storage.setAlarm(now + IDLE_MS);
  }
}
