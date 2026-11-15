// Logika meja online (bareng teman), murni: dipakai Durable Object CapsaRoom (worker/room.js) dan dites di Node.
// Server yang membagi kartu; klien hanya menerima viewFor(room, seat): kartu sendiri saja sampai ronde dibuka.
// Meja bareng teman TANPA koin (hanya poin), jadi identitas pemain cukup id acak dari HP + nama.
import { deal, mulberry32 } from './cards.js';
import { isValid, orderRow } from './hands.js';
import { detectSpecial } from './special.js';
import { scoreRound } from './scoring.js';
import { solve, quickArrange } from './arrange.js';
import { pickBots, clampAvatar } from './roster.js';
import { ARRANGE_SECONDS } from './rules.js';

export const GRACE_MS = 2500; // kelonggaran jaringan setelah waktu susun habis
export const ROOM_CODE = /^[A-Z0-9]{5}$/;
export const validId = (s) => typeof s === 'string' && /^[a-z0-9]{12,40}$/.test(s);
export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Pemain';

export function createRoom(code, host, now) {
  return {
    code, status: 'lobby', hostId: host.id, createdAt: now,
    seats: [{ id: host.id, name: cleanName(host.name), avatar: clampAvatar(host.avatar) ?? 0 }, null, null, null],
    round: 0, hands: null, subs: [null, null, null, null], deadline: 0, totals: [0, 0, 0, 0], last: null,
  };
}

export const seatOf = (room, id) => room.seats.findIndex((s) => s && !s.bot && s.id === id);
const humans = (room) => room.seats.filter((s) => s && !s.bot && !s.left);

/** Masuk meja (atau kembali ke kursi sendiri). -> { ok, seat } | { ok:false, error } */
export function join(room, user) {
  let seat = seatOf(room, user.id);
  if (seat >= 0) {
    room.seats[seat].left = false;
    return { ok: true, seat };
  }
  if (room.status !== 'lobby') return { ok: false, error: 'Permainan sudah mulai' };
  seat = room.seats.findIndex((s) => !s);
  if (seat < 0) return { ok: false, error: 'Meja penuh' };
  const taken = new Set(room.seats.filter(Boolean).map((s) => s.avatar));
  let avatar = clampAvatar(user.avatar) ?? 0;
  for (let i = 0; i < 12 && taken.has(avatar); i++) avatar = (avatar + 1) % 12; // avatar tidak kembar semeja
  room.seats[seat] = { id: user.id, name: cleanName(user.name), avatar };
  return { ok: true, seat };
}

/** Keluar: di ruang tunggu kursinya dilepas; saat permainan jalan kursinya dimainkan otomatis. */
export function leave(room, id) {
  const seat = seatOf(room, id);
  if (seat < 0) return;
  if (room.status === 'lobby') room.seats[seat] = null;
  else room.seats[seat].left = true;
  fixHost(room);
}

/** Host harus pemain yang masih ada; `connected(id)` opsional (host pindah kalau yang lama putus). */
export function fixHost(room, connected = () => true) {
  const ok = (s) => s && !s.bot && !s.left && connected(s.id);
  if (room.seats.some((s) => ok(s) && s.id === room.hostId)) return;
  const nextHost = room.seats.find(ok);
  if (nextHost) room.hostId = nextHost.id;
}

function dealRound(room, seed, now) {
  room.round += 1;
  room.status = 'arrange';
  room.hands = deal(mulberry32(seed >>> 0));
  room.subs = [null, null, null, null];
  room.tried = [false, false, false, false];
  room.deadline = now + ARRANGE_SECONDS * 1000 + GRACE_MS;
}

/** Host memulai: kursi kosong diisi bot (karakter Mahjong Kung2). rnd = sumber acak untuk memilih bot. */
export function start(room, id, seed, now, rnd) {
  if (room.status !== 'lobby') return { ok: false, error: 'Permainan sudah mulai' };
  if (id !== room.hostId) return { ok: false, error: 'Hanya pembuat meja yang bisa memulai' };
  const empty = room.seats.filter((s) => !s).length;
  const bots = pickBots(empty, room.seats.filter(Boolean).map((s) => s.avatar), rnd);
  room.seats = room.seats.map((s) => s || { ...bots.shift(), bot: true });
  dealRound(room, seed, now);
  return { ok: true };
}

/** Ronde berikutnya (host, dari layar hasil). */
export function next(room, id, seed, now) {
  if (room.status !== 'result') return { ok: false, error: 'Ronde belum selesai' };
  if (id !== room.hostId) return { ok: false, error: 'Hanya pembuat meja yang bisa melanjutkan' };
  if (!humans(room).length) return { ok: false, error: 'Tidak ada pemain' };
  dealRound(room, seed, now);
  return { ok: true };
}

const sameCards = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

/** Pemain mengirim susunan. Server tidak percaya klien: kartunya harus persis kartu yang dibagikan dan susunannya sah. */
export function submit(room, seat, payload) {
  if (room.status !== 'arrange' || seat < 0) return { ok: false, error: 'Bukan waktunya menyusun' };
  const hand = room.hands[seat];
  if (payload?.special) {
    const sp = detectSpecial(hand);
    if (!sp) return { ok: false, error: 'Tidak punya kartu spesial' };
    room.subs[seat] = { special: sp.type };
    return { ok: true };
  }
  const r = payload?.rows;
  const isRow = (x, n) => Array.isArray(x) && x.length === n && x.every((c) => Number.isInteger(c) && c >= 0 && c < 52);
  if (!r || !isRow(r.top, 3) || !isRow(r.mid, 5) || !isRow(r.bot, 5)) return { ok: false, error: 'Susunan tidak lengkap' };
  if (!sameCards([...r.top, ...r.mid, ...r.bot], hand)) return { ok: false, error: 'Kartu tidak cocok' };
  if (!isValid(r.top, r.mid, r.bot)) return { ok: false, error: 'Urutan baris salah' };
  room.subs[seat] = { rows: { top: orderRow(r.top), mid: orderRow(r.mid), bot: orderRow(r.bot) } };
  return { ok: true };
}

/** "Susun ulang" selama ronde belum dibuka. */
export function unsubmit(room, seat) {
  if (room.status !== 'arrange' || seat < 0 || isAuto(room, seat)) return { ok: false };
  room.subs[seat] = null;
  return { ok: true };
}

/** Kursi yang dimainkan server: bot, atau pemain yang sudah keluar. */
export const isAuto = (room, seat) => !!room.seats[seat] && (!!room.seats[seat].bot || !!room.seats[seat].left);
export const allIn = (room) => room.status === 'arrange' && room.subs.every(Boolean);
/** Kursi otomatis berikutnya yang belum menyusun, atau -1. */
export const nextAuto = (room) => (room.status === 'arrange' ? room.seats.findIndex((s, i) => isAuto(room, i) && !room.subs[i]) : -1);

/**
 * Susun otomatis satu kursi. smart = pakai solve() (mahal); kalau false pakai quickArrange (murah, pasti sah).
 * Kartu spesial selalu dipakai.
 */
export function autoArrange(room, seat, smart = true) {
  if (room.status !== 'arrange' || room.subs[seat]) return;
  const hand = room.hands[seat];
  const sp = detectSpecial(hand);
  if (sp) { room.subs[seat] = { special: sp.type }; return; }
  const { top, mid, bot } = smart ? solve(hand, { keep: 1 })[0] : quickArrange(hand);
  room.subs[seat] = { rows: { top, mid, bot } };
}

/** Semua sudah menyusun (atau waktu habis dan sisanya disusun otomatis): hitung poin & buka kartu. */
export function finishRound(room) {
  if (room.status !== 'arrange') return;
  for (let i = 0; i < 4; i++) autoArrange(room, i, false);
  const players = room.subs.map((sub, i) => {
    if (!sub.special) return { rows: sub.rows };
    const sp = detectSpecial(room.hands[i]);
    return { special: { type: sp.type, pts: sp.pts }, rows: sp.rows };
  });
  const res = scoreRound(players);
  res.net.forEach((n, i) => { room.totals[i] += n; });
  room.last = { round: room.round, net: res.net, shown: players.map((p) => (p.special ? { special: p.special.type, rows: p.rows } : { rows: p.rows })) };
  room.status = 'result';
  room.hands = null;
  room.subs = [null, null, null, null];
  room.deadline = 0;
}

/**
 * Yang boleh dilihat pemain di kursi `seat`. Tidak pernah memuat kartu/susunan lawan sebelum ronde dibuka, dan tidak memuat id pemain.
 * connected(id) -> boolean (dari Durable Object).
 */
export function viewFor(room, seat, connected = () => true) {
  const arranging = room.status === 'arrange';
  return {
    code: room.code, status: room.status, round: room.round, seat,
    host: room.seats.findIndex((s) => s && !s.bot && s.id === room.hostId),
    seats: room.seats.map((s, i) => s && {
      name: s.name, avatar: s.avatar, bot: !!s.bot, left: !!s.left,
      online: !!s.bot || connected(s.id), ready: arranging && !!room.subs[i],
    }),
    totals: room.totals,
    deadline: arranging ? room.deadline : 0,
    hand: arranging && seat >= 0 ? room.hands[seat] : null,
    mine: arranging && seat >= 0 ? room.subs[seat] : null,
    last: room.status === 'result' ? room.last : null,
  };
}
