// Worker capsa: file statis game + API meja online di /games/capsa/api/*
//
// Meja bareng teman TANPA koin, jadi tidak perlu login: pemain dikenali dari id acak buatan HP-nya (kunci kursinya) + nama.
// Fitur yang memakai koin akun (Ranked) WAJIB memverifikasi akun lewat server Mahjong — jangan memakai id dari klien untuk itu.
import { CapsaRoom } from './room.js';
import { validId, cleanName, ROOM_CODE } from '../src/engine/room.js';
import { clampAvatar } from '../src/engine/roster.js';

export { CapsaRoom };

const BASE = '/games/capsa';
const API = BASE + '/api';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function randomCode() {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

/** Tolak permintaan dari situs lain: POST & WebSocket wajib dari origin game sendiri. */
function badOrigin(req, url) {
  const ws = req.headers.get('Upgrade') === 'websocket';
  if (!ws && (req.method === 'GET' || req.method === 'HEAD')) return false;
  const origin = req.headers.get('Origin');
  if (!origin) return ws;
  return origin !== url.origin;
}

const userFrom = (id, name, avatar) => (validId(id) ? { id, name: cleanName(name), avatar: clampAvatar(avatar) ?? 0 } : null);

async function handleApi(req, env, url) {
  const path = url.pathname.slice(API.length);
  if (badOrigin(req, url)) return json({ error: 'Origin tidak diizinkan' }, 403);

  if (path === '/config') return json({ online: true });

  if (path === '/rooms' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse((await req.text()).slice(0, 500)); } catch { /* badan rusak = ditolak di bawah */ }
    const user = userFrom(b.id, b.name, b.avatar);
    if (!user) return json({ error: 'Data pemain tidak lengkap' }, 400);
    for (let i = 0; i < 5; i++) {
      const code = randomCode();
      const r = await env.ROOMS.get(env.ROOMS.idFromName(code)).init(code, user);
      if (r.ok) return json({ code });
    }
    return json({ error: 'Gagal membuat meja' }, 500);
  }

  const m = path.match(/^\/rooms\/([A-Z0-9]{5})(\/ws)?$/);
  if (m && ROOM_CODE.test(m[1])) {
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    const id = url.searchParams.get('id');
    if (!m[2]) {
      if (req.method !== 'GET') return json({ error: 'Tidak ditemukan' }, 404);
      return json(await stub.info(validId(id) ? id : ''));
    }
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'Butuh WebSocket' }, 426);
    const user = userFrom(id, url.searchParams.get('name'), url.searchParams.get('av'));
    if (!user) return json({ error: 'Data pemain tidak lengkap' }, 400);
    if ((await stub.info(user.id)).status === 'none') return json({ error: 'Meja tidak ditemukan' }, 404);
    const h = new Headers(req.headers);
    h.set('X-User', JSON.stringify(user));
    return stub.fetch(new Request(req.url, { headers: h }));
  }
  return json({ error: 'Tidak ditemukan' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith(API + '/')) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        console.error(e);
        return json({ error: 'Server error' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
