// Satu meja online = satu Durable Object. Logika mejanya murni di src/engine/room.js; di sini hanya penyimpanan,
// WebSocket, dan alarm (giliran bot menyusun, batas waktu ronde, bersih-bersih meja kosong).
import { DurableObject } from 'cloudflare:workers';
import * as R from '../src/engine/room.js';

const BOT_FIRST_MS = 2500; // bot pertama "siap" segini setelah kartu dibagi
const BOT_GAP_MS = 1800; // jeda antar bot (satu bot per alarm, supaya hitungan susunan tidak menumpuk di satu panggilan)
const IDLE_MS = 10 * 60 * 1000; // meja tanpa koneksi dihapus setelah segini

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
    if (!r) return { status: 'none', free: 0, mine: false };
    return { status: r.status, free: r.seats.filter((s) => !s).length, mine: R.seatOf(r, id) >= 0 };
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
        ws.send(JSON.stringify({ t: 'state', now, view: R.viewFor(r, R.seatOf(r, id), connected) }));
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
    if (R.allIn(r)) R.finishRound(r);
    R.fixHost(r, (id) => this.isConnected(id, closing));
    await this.save();
    this.broadcast();
    const now = Date.now();
    if (r.status === 'arrange') {
      const at = R.nextAuto(r) >= 0 ? Math.min(r.deadline, Math.max(now + 50, r.autoAt || 0)) : r.deadline;
      await this.ctx.storage.setAlarm(at);
    } else await this.ctx.storage.setAlarm(now + IDLE_MS);
  }

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if (r.status === 'arrange') {
      if (now >= r.deadline) R.finishRound(r); // yang belum menyusun disusun otomatis (cara cepat)
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
