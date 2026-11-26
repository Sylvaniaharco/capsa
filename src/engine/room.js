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
import { SIX, dealSix, evalSix, isValidSix, orderSix, quickSix, solveSix, sixRules, validPlayers } from './six.js';
import { minEntry } from './wallet.js';
import { botPick, DEFAULT_LEVEL } from './bot.js';

export const GRACE_MS = 2500; // kelonggaran jaringan setelah waktu susun habis
export const RANKED_WAIT_MS = 8000; // Ranked: tunggu pemain lain segini setelah pemain pertama duduk, lalu kursi kosong diisi bot
export const RANKED_NEXT_MS = 18000; // Ranked: jeda setelah ronde selesai (animasi buka kartu ±8 dtk + waktu baca hasil) sebelum ronde berikutnya
export const AFK_ROUNDS = 2; // Ranked: kehabisan waktu segini kali berturut-turut = dikeluarkan
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
  if (room.ranked) {
    // kursi Ranked dipesan server lewat reserve() setelah akun diverifikasi; di sini hanya menyambung ke kursi itu
    return isPending(room, user.id) ? { ok: true, seat: -1 } : { ok: false, error: 'Kursi tidak ditemukan' };
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
  if (room.pending) room.pending = room.pending.filter((p) => p.id !== id);
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

const noSubs = (room) => room.seats.map(() => null);

function dealRound(room, seed, now) {
  room.round += 1;
  room.nextAt = 0;
  room.status = 'arrange';
  // Ranked 6 kartu: room.six = jumlah pemain (3–8, = jumlah kursi); selain itu capsa 13 kartu, 4 kursi
  room.hands = room.six ? dealSix(mulberry32(seed >>> 0), room.six).hands : deal(mulberry32(seed >>> 0));
  room.subs = noSubs(room);
  room.tried = room.seats.map(() => false);
  room.offlineAt = 0;
  room.deadline = now + (room.six ? SIX.seconds : ARRANGE_SECONDS) * 1000 + GRACE_MS;
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

/**
 * Ronde berikutnya (dari layar hasil). Siapa pun yang masih duduk boleh menekannya — kalau hanya pembuat meja,
 * meja nyangkut waktu dia diam saja.
 */
export function next(room, id, seed, now) {
  if (room.status !== 'result') return { ok: false, error: 'Ronde belum selesai' };
  if (room.ranked) return { ok: false, error: 'Ronde berikutnya jalan sendiri' }; // Ranked: dijadwalkan server, bukan ditekan pemain
  const seat = seatOf(room, id);
  if (seat < 0 || room.seats[seat].left) return { ok: false, error: 'Kamu tidak duduk di meja ini' };
  if (!humans(room).length) return { ok: false, error: 'Tidak ada pemain' };
  dealRound(room, seed, now);
  return { ok: true };
}

const sameCards = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

/** Pemain mengirim susunan. Server tidak percaya klien: kartunya harus persis kartu yang dibagikan dan susunannya sah. */
export function submit(room, seat, payload) {
  if (room.status !== 'arrange' || seat < 0) return { ok: false, error: 'Bukan waktunya menyusun' };
  const hand = room.hands[seat];
  if (room.six) {
    const r = payload?.rows;
    const isRow = (x, n) => Array.isArray(x) && x.length === n && x.every((c) => Number.isInteger(c) && c >= 0 && c < 52);
    if (!r || !isRow(r.top, 1) || !isRow(r.mid, 2) || !isRow(r.bot, 3)) return { ok: false, error: 'Susunan tidak lengkap' };
    if (!sameCards([...r.top, ...r.mid, ...r.bot], hand)) return { ok: false, error: 'Kartu tidak cocok' };
    if (!isValidSix(r, room.six)) return { ok: false, error: 'Urutan baris salah' };
    room.subs[seat] = { rows: { top: orderSix(r.top), mid: orderSix(r.mid), bot: orderSix(r.bot) } };
    return { ok: true };
  }
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
  // bot memakai level Sedang (acak berseed dari ronde + kursi); pemain yang keluar/habis waktu disusun sebaik mungkin
  const rnd = mulberry32((room.round * 7919 + seat * 104729 + 17) >>> 0);
  const pickFor = (opts, quick) => (room.seats[seat]?.bot ? botPick(opts, quick, DEFAULT_LEVEL, rnd) : opts[0]);
  if (room.six) {
    const q = () => quickSix(hand, room.six);
    const rows = smart ? pickFor(solveSix(hand, room.six, { keep: 3 }), q) : q();
    room.subs[seat] = { rows: { top: rows.top, mid: rows.mid, bot: rows.bot } };
    return;
  }
  const sp = detectSpecial(hand);
  if (sp) { room.subs[seat] = { special: sp.type }; return; }
  const { top, mid, bot } = smart ? pickFor(solve(hand, { keep: 3 }), () => quickArrange(hand)) : quickArrange(hand);
  room.subs[seat] = { rows: { top, mid, bot } };
}

/** Semua sudah menyusun (atau waktu habis dan sisanya disusun otomatis): hitung poin & buka kartu. */
export function finishRound(room, now = 0) {
  if (room.status !== 'arrange') return;
  // Ranked: pemain yang masih di meja tapi tidak menyusun sampai waktu habis dihitung tidak aktif
  room.seats.forEach((s, i) => { if (!s.bot) s.afk = !room.subs[i] && !s.left ? (s.afk || 0) + 1 : 0; });
  for (let i = 0; i < room.seats.length; i++) autoArrange(room, i, false);
  const players = room.subs.map((sub, i) => {
    if (!sub.special) return { rows: sub.rows };
    const sp = detectSpecial(room.hands[i]);
    return { special: { type: sp.type, pts: sp.pts }, rows: sp.rows };
  });
  const res = scoreRound(players, room.six ? sixRules(room.six) : undefined);
  res.net.forEach((n, i) => { room.totals[i] += n; });
  room.last = { round: room.round, net: res.net, shown: players.map((p) => (p.special ? { special: p.special.type, rows: p.rows } : { rows: p.rows })) };
  room.status = 'result';
  room.hands = null;
  room.subs = noSubs(room);
  room.deadline = 0;
  if (room.ranked) {
    // koin sementara = poin x taruhan; angka pasti (saldo tidak bisa minus) diisi applySettle() setelah server akun menjawab
    room.last.deltas = res.net.map((n) => n * room.ranked.stake);
    room.last.settled = false;
    room.nextAt = now + RANKED_NEXT_MS;
  }
}

// ---------- Ranked (koin akun) ----------
// Kursi dipesan server setelah akun diverifikasi (reserve). seat.id = kunci rahasia kursi (dipakai klien untuk menyambung),
// seat.userId = id akun (TIDAK PERNAH keluar ke klien), seat.coins = saldo akun terakhir yang diketahui.
// Ronde berjalan sendiri (tanpa host): mulai RANKED_WAIT_MS setelah pemain pertama, lanjut RANKED_NEXT_MS setelah hasil.
// Pemain baru boleh masuk kapan saja: kalau ronde sedang jalan, dia menunggu dan menggantikan bot di ronde berikutnya.

/** six = jumlah pemain capsa 6 kartu (3–8), 0 = capsa 13 kartu (4 kursi). */
export function createRanked(code, stake, now, six = 0) {
  const n = six ? six : 4;
  const empty = () => Array.from({ length: n }, () => null);
  return {
    code, status: 'lobby', ranked: { stake }, six: six || 0, hostId: null, createdAt: now,
    seats: empty(), pending: [],
    round: 0, hands: null, subs: empty(), deadline: 0, totals: Array.from({ length: n }, () => 0), last: null, startAt: 0, nextAt: 0,
  };
}

export const validSix = (n) => n === 0 || validPlayers(n);
/** Pemain asli maksimal 4 per meja (batas penyelesaian koin di server akun); kursi sisanya bot. */
const maxHumans = (room) => Math.min(room.seats.length, 4);

const rankedHumans = (room) => room.seats.filter((s) => s && !s.bot && !s.left);
export const isPending = (room, id) => !!room.pending?.some((p) => p.id === id);
/** Kursi yang bisa diambil pemain baru di ronde berikutnya: bot, atau pemain yang sudah keluar. */
const replaceable = (room) => room.seats.filter((s) => s && (s.bot || s.left)).length;

/** Masih bisa menerima pemain baru? (dipakai pencari meja) */
export function joinable(room) {
  if (!room.ranked || room.status === 'closed') return false;
  const humans = rankedHumans(room).length;
  if (room.status === 'lobby') return humans < maxHumans(room);
  return room.pending.length < replaceable(room) && humans + room.pending.length < maxHumans(room);
}

/** Akun ini sedang duduk (atau menunggu) di meja ini? -> { key, left } | null */
export function seatedUser(room, userId) {
  const s = room.seats.find((x) => x && !x.bot && x.userId === userId) || room.pending?.find((p) => p.userId === userId);
  return s ? { key: s.id, left: !!s.left } : null;
}

/**
 * Pesan kursi Ranked. user = { key, userId, name, avatar, coins } (sudah diverifikasi server akun).
 * Satu akun satu kursi: kalau akun itu sudah di meja ini, kursi lamanya yang dipakai. -> { ok, key } | { ok:false, error }
 */
export function reserve(room, user, now) {
  if (!room.ranked || room.status === 'closed') return { ok: false, error: 'Meja sudah ditutup' };
  const mine = room.seats.find((s) => s && !s.bot && s.userId === user.userId) || room.pending.find((p) => p.userId === user.userId);
  if (mine) {
    mine.left = false;
    mine.afk = 0;
    mine.coins = user.coins;
    return { ok: true, key: mine.id };
  }
  if (!(user.coins >= minEntry(room.ranked.stake))) return { ok: false, error: 'Koin tidak cukup untuk meja ini' };
  if (!joinable(room)) return { ok: false, error: 'Meja penuh' };
  const seat = { id: user.key, userId: user.userId, name: cleanName(user.name), avatar: clampAvatar(user.avatar) ?? 0, coins: user.coins };
  if (room.status !== 'lobby') {
    room.pending.push(seat); // ronde sedang jalan: masuk di ronde berikutnya
    return { ok: true, key: seat.id };
  }
  const taken = new Set(room.seats.filter(Boolean).map((s) => s.avatar));
  for (let i = 0; i < 12 && taken.has(seat.avatar); i++) seat.avatar = (seat.avatar + 1) % 12;
  room.seats[room.seats.findIndex((s) => !s)] = seat;
  const n = rankedHumans(room).length;
  if (n === 1) room.startAt = now + RANKED_WAIT_MS;
  if (n >= maxHumans(room)) room.startAt = now;
  return { ok: true, key: seat.id };
}

/** Yang harus dikerjakan meja Ranked sekarang: 'start' | 'next' | 'close' | null. */
export function rankedDue(room, now) {
  if (!room.ranked) return null;
  if (room.status === 'lobby') {
    if (!rankedHumans(room).length) return now - room.createdAt > 60000 ? 'close' : null;
    return now >= room.startAt ? 'start' : null;
  }
  if (room.status === 'result') return now >= room.nextAt ? 'next' : null;
  return null;
}

export function startRanked(room, seed, now, rnd) {
  const bots = pickBots(room.seats.filter((s) => !s).length, room.seats.filter(Boolean).map((s) => s.avatar), rnd);
  room.seats = room.seats.map((s) => s || { ...bots.shift(), bot: true });
  dealRound(room, seed, now);
}

/**
 * Ronde Ranked berikutnya. Kursi pemain yang keluar / tidak aktif / koinnya kurang dilepas, pemain yang menunggu masuk
 * (menggantikan kursi lepas atau bot), sisanya diisi bot. Tidak ada pemain lagi -> meja ditutup.
 * -> { closed, removed: { [kunci kursi]: alasan } } (removed dipakai server untuk memberi tahu & memutus pemain itu)
 */
export function nextRanked(room, seed, now, rnd) {
  const min = minEntry(room.ranked.stake);
  const removed = {};
  const free = []; // indeks kursi yang bisa diisi pemain baru: kursi lepas dulu, baru kursi bot
  room.seats.forEach((s, i) => {
    if (s.bot) return;
    const why = s.left ? 'keluar' : (s.afk || 0) >= AFK_ROUNDS ? 'Kamu dikeluarkan dari meja karena tidak menyusun 2 ronde berturut-turut' : !(s.coins >= min) ? 'Koin tidak cukup untuk lanjut di meja ini' : '';
    if (!why) return;
    if (!s.left) removed[s.id] = why;
    room.seats[i] = null;
    free.push(i);
  });
  room.seats.forEach((s, i) => { if (s && s.bot) free.push(i); });
  for (const p of room.pending) {
    if (!free.length) { removed[p.id] = 'Meja penuh, coba cari meja lagi'; continue; }
    const i = free.shift();
    const taken = new Set(room.seats.filter((s, k) => s && k !== i && !s.bot).map((s) => s.avatar));
    for (let k = 0; k < 12 && taken.has(p.avatar); k++) p.avatar = (p.avatar + 1) % 12;
    room.seats[i] = p;
    room.totals[i] = 0;
  }
  room.pending = [];
  if (!rankedHumans(room).length) {
    room.status = 'closed';
    return { closed: true, removed };
  }
  // kursi yang masih kosong diisi bot baru (bot lama yang tidak tergantikan tetap duduk, kecuali avatarnya bentrok dengan pemain baru)
  const humanAv = new Set(room.seats.filter((s) => s && !s.bot).map((s) => s.avatar));
  room.seats.forEach((s, i) => { if (s && s.bot && humanAv.has(s.avatar)) room.seats[i] = null; });
  room.seats.forEach((s, i) => {
    if (s) return;
    room.seats[i] = { ...pickBots(1, room.seats.filter(Boolean).map((x) => x.avatar), rnd)[0], bot: true };
    room.totals[i] = 0;
  });
  dealRound(room, seed, now);
  return { closed: false, removed };
}

/** Permintaan penyelesaian koin ronde terakhir untuk server akun: hanya pemain (bot tidak punya koin). */
export function settlePayload(room) {
  const players = room.seats.map((s, i) => (s.bot ? null : { userId: s.userId, net: room.last.net[i] })).filter(Boolean);
  return { gameId: `${room.code}:${room.last.round}`, stake: room.ranked.stake, players };
}

/** Jawaban server akun: { [userId]: { delta, coins } }. Mengisi koin pasti tiap kursi & saldo terbaru pemain. */
export function applySettle(room, result) {
  room.seats.forEach((s, i) => {
    const r = !s.bot && result ? result[s.userId] : null;
    if (!r) return;
    room.last.deltas[i] = r.delta;
    s.coins = r.coins;
  });
  room.last.settled = true;
}

/**
 * Yang boleh dilihat pemain di kursi `seat`. Tidak pernah memuat kartu/susunan lawan sebelum ronde dibuka, dan tidak memuat id pemain.
 * connected(id) -> boolean (dari Durable Object).
 */
export function viewFor(room, seat, connected = () => true, viewerId = '') {
  const arranging = room.status === 'arrange';
  const me = seat >= 0 ? room.seats[seat] : room.pending?.find((p) => p.id === viewerId);
  return {
    code: room.code, status: room.status, round: room.round, seat, six: room.six || 0,
    // Ranked: taruhan, saldo koin SENDIRI (saldo lawan tidak dikirim), dan jadwal mulai / ronde berikutnya (jam server)
    ranked: room.ranked ? { stake: room.ranked.stake, coins: me?.coins ?? null, waiting: seat < 0 && !!me, startAt: room.startAt, nextAt: room.nextAt } : null,
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
