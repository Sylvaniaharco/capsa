// Kartu = angka 0..51. rank = c >> 2 (0 = "2" … 12 = "A"), suit = c & 3 (0 ♦, 1 ♣, 2 ♥, 3 ♠).
// Murni (tanpa DOM) — dipakai browser, Node (tes/simulasi), dan nanti Worker.
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_CHARS = ['♦', '♣', '♥', '♠'];
const SUIT_KEYS = 'dchs';

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const card = (rank, suit) => rank * 4 + suit;
export const isRed = (c) => (c & 3) === 0 || (c & 3) === 2;
export const cardName = (c) => RANKS[c >> 2] + SUIT_CHARS[c & 3];

/** 'As Kd 10h 2c' -> [kartu]. Untuk tes. */
export function parseCards(str) {
  return str.trim().split(/\s+/).map((t) => {
    const rank = RANKS.indexOf(t.slice(0, -1).toUpperCase());
    const suit = SUIT_KEYS.indexOf(t.slice(-1).toLowerCase());
    if (rank < 0 || suit < 0) throw new Error('Kartu tidak dikenal: ' + t);
    return card(rank, suit);
  });
}

/** RNG berseed (mulberry32). Jangan pakai Math.random() di engine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledDeck(rng) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Bagi 13 kartu ke 4 pemain. */
export function deal(rng) {
  const d = shuffledDeck(rng);
  return [0, 1, 2, 3].map((p) => d.slice(p * 13, p * 13 + 13));
}
