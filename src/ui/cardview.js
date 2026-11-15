// Elemen kartu (DOM). size: 'big' (layar susun) atau 'mini' (di meja).
import { RANKS, rankOf, suitOf, isRed } from '../engine/cards.js';

const suitSvg = (s) => `<svg class="su" viewBox="0 0 24 24" aria-hidden="true"><use href="#su${s}"/></svg>`;
const SUIT_WORDS = ['wajik', 'keriting', 'hati', 'sekop'];

export function cardEl(c, size = 'big') {
  const el = document.createElement('div');
  const r = rankOf(c), s = suitOf(c);
  el.className = `card ${size} ${isRed(c) ? 'red' : 'blk'}`;
  el.dataset.c = c;
  el.setAttribute('aria-label', `${RANKS[r]} ${SUIT_WORDS[s]}`);
  const ix = `<span class="ix${r === 8 ? ' ten' : ''}"><b>${RANKS[r]}</b>${suitSvg(s)}</span>`;
  // J/Q/K: huruf besar berbingkai; lainnya: lambang besar
  const art = r >= 9 && r <= 11 ? `<span class="court"><b>${RANKS[r]}</b>${suitSvg(s)}</span>` : `<span class="pip">${suitSvg(s)}</span>`;
  el.innerHTML = ix + art;
  return el;
}

export function backEl(size = 'mini') {
  const el = document.createElement('div');
  el.className = `card ${size} back`;
  return el;
}
