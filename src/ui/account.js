// Akun & koin bersama Mahjong Kung2. Capsa belum punya server sendiri: halaman ini memanggil API Mahjong
// (/games/mahjonghk/api/*) yang satu origin, jadi cookie login Mahjong ikut terkirim dan satu login berlaku di dua game.
// Di luar alamat produksi (server lokal statis, pratinjau) fitur akun dimatikan (state 'off').
const API = '/games/mahjonghk/api';

/** Fitur akun hanya aktif kalau game dibuka dari /games/capsa/ (satu origin dengan API Mahjong). */
export const accountEnabled = () => typeof location !== 'undefined' && location.pathname.startsWith('/games/capsa/');
/** Setelah login Google, server Mahjong mengembalikan pemain ke /games/capsa/?login=ok. */
export const loginUrl = `${API}/auth/google?next=capsa`;

/**
 * Ringkas jawaban /me + /config jadi yang dipakai lobi. Murni (bisa dites).
 * -> { state: 'off' } | { state: 'out' } | { state: 'in', name, coins }
 * Tamu Mahjong dihitung belum masuk: koin & akun hanya untuk login Google.
 */
export function accountFrom(me, cfg) {
  if (!me || typeof me !== 'object' || !('user' in me)) return { state: 'off' };
  const u = me.user;
  if (u && !u.guest && typeof u.name === 'string') {
    const coins = Number(me.wallet?.coins);
    return { state: 'in', name: u.name.slice(0, 24) || 'Pemain', coins: Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : null };
  }
  return cfg && cfg.google ? { state: 'out' } : { state: 'off' };
}

async function getJson(path) {
  const r = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bukan JSON');
  return r.json();
}

export async function fetchAccount() {
  if (!accountEnabled()) return { state: 'off' };
  try {
    const [me, cfg] = await Promise.all([getJson('/me'), getJson('/config').catch(() => null)]);
    return accountFrom(me, cfg);
  } catch {
    return { state: 'off' }; // offline / server tidak menjawab: game tetap jalan tanpa akun
  }
}

/** Keluar dari akun (berlaku juga di Mahjong Kung2: sesinya sama). */
export async function logout() {
  try {
    const r = await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    return r.ok;
  } catch {
    return false;
  }
}

/** Kirim error JS ke dashboard admin Mahjong (bagian "Error 7 hari terakhir", mode capsa). Maks 10 per sesi, tanpa data pribadi. */
export function installErrorLog(version) {
  if (!accountEnabled()) return;
  const sent = new Set();
  let count = 0;
  const report = (msg, src, stack) => {
    try {
      msg = String(msg || '').slice(0, 300);
      if (!msg || count >= 10) return;
      const key = `${msg}|${src}`;
      if (sent.has(key)) return;
      sent.add(key);
      count++;
      const body = JSON.stringify({ msg, src: String(src || '').slice(0, 200), stack: String(stack || '').slice(0, 800), ver: version() || '', mode: 'capsa' });
      fetch(`${API}/errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
    } catch { /* pelaporan tidak boleh mengganggu game */ }
  };
  window.addEventListener('error', (e) => {
    if (!e.error && !e.message) return; // gagal muat gambar/script (bukan error JS)
    report(e.message || e.error?.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r?.name === 'AbortError') return;
    report(r?.message || (typeof r === 'string' ? r : ''), '', r?.stack);
  });
}
