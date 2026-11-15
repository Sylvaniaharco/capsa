import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mulberry32 } from '../src/engine/cards.js';
import { BOT_NAMES, BOT_AVATAR, AVATAR_COUNT, pickBots, clampAvatar } from '../src/engine/roster.js';

test('tiap bot punya avatar & file gambarnya ada', () => {
  for (const name of BOT_NAMES) {
    assert.ok(Number.isInteger(BOT_AVATAR[name]) && BOT_AVATAR[name] < AVATAR_COUNT, name);
  }
  for (let i = 1; i <= AVATAR_COUNT; i++) assert.ok(existsSync(new URL(`../avatars/${i}.webp`, import.meta.url)), `avatars/${i}.webp`);
});

test('pickBots: 3 bot, nama & avatar tidak kembar, tidak sama dengan avatar pemain', () => {
  const rnd = mulberry32(3);
  for (let i = 0; i < 300; i++) {
    const mine = i % AVATAR_COUNT;
    const bots = pickBots(3, [mine], rnd);
    assert.equal(bots.length, 3);
    assert.equal(new Set(bots.map((b) => b.name)).size, 3);
    assert.equal(new Set([mine, ...bots.map((b) => b.avatar)]).size, 4);
    for (const b of bots) assert.equal(b.avatar, BOT_AVATAR[b.name]);
  }
});

test('clampAvatar', () => {
  assert.equal(clampAvatar(5), 5);
  assert.equal(clampAvatar('x'), null);
  assert.equal(clampAvatar(12), null);
});
