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
