// Semua angka aturan ada di sini supaya gampang diubah.
import { CAT } from './hands.js';

/** Bonus poin kalau baris itu MENANG dengan kombinasi ini (ditambah ke 1 poin menang baris). */
export const BONUS = {
  top: { [CAT.TRIPS]: 3 },
  mid: { [CAT.FULL_HOUSE]: 3, [CAT.QUADS]: 5, [CAT.STRAIGHT_FLUSH]: 7, [CAT.ROYAL]: 11 },
  bot: { [CAT.QUADS]: 5, [CAT.STRAIGHT_FLUSH]: 7, [CAT.ROYAL]: 11 },
};
export const ROWS = ['top', 'mid', 'bot'];
export const ROW_NAMES = { top: 'Atas', mid: 'Tengah', bot: 'Bawah' };

/** Kartu spesial 13 kartu: langsung menang, dapat poin ini dari tiap lawan. */
export const SPECIAL = { straight: 4, flush: 3, pairs: 3 };
export const SPECIAL_NAMES = { straight: 'All Straight', flush: 'All Flush', pairs: '6 Pair' };

export const SCOOP_MULT = 2; // tembus: menang 3 baris dari satu lawan
export const SWEEP_MULT = 2; // tembus keliling: tembus ke 3 lawan sekaligus (dikali lagi)

export const ARRANGE_SECONDS = 60;

// ---------- Capsa 6 kartu (susun 1-2-3, 3–8 pemain) ----------
/** Kategori 6 kartu: baris paling banyak 3 kartu, jadi urutannya ikut peluang di dek pendek (flush lebih jarang dari straight). */
export const SIX_CAT = { HIGH: 0, PAIR: 1, STRAIGHT: 2, FLUSH: 3, TRIPS: 4, STRAIGHT_FLUSH: 5, ROYAL: 6 };
export const SIX = {
  sizes: [1, 2, 3], // atas, tengah, bawah
  minPlayers: 3,
  maxPlayers: 8,
  seconds: 30,
  // bonus kalau baris itu MENANG (ditambah ke 1 poin menang baris); tengah: hanya pair As
  bonus: { top: {}, mid: { pairAce: 1 }, bot: { [SIX_CAT.TRIPS]: 3, [SIX_CAT.STRAIGHT_FLUSH]: 5, [SIX_CAT.ROYAL]: 7 } },
  scoopMult: 2, // tembus: menang 3 baris dari satu lawan
  sweepMult: 2, // tembus keliling (×2 lagi) — hanya meja 3–4 pemain
  sweepMaxPlayers: 4,
};
