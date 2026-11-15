import test from 'node:test';
import assert from 'node:assert/strict';
import { STAKES, minEntry, START_COINS, normalizeWallet, coinDelta, applyDelta, allowedStakes, isBroke, wibDay, nextResetAt } from '../src/engine/wallet.js';

const T = Date.UTC(2026, 10, 15, 5, 0); // 15 Nov 2026 12.00 WIB

test('meja & saldo minimal sama dengan Mahjong Kung2', () => {
  assert.deepEqual(STAKES, [5, 10, 20]);
  assert.deepEqual(STAKES.map(minEntry), [100, 5000, 10000]);
  assert.equal(START_COINS, 1000);
  assert.deepEqual(allowedStakes(1000), [5]);
  assert.deepEqual(allowedStakes(5000), [5, 10]);
  assert.deepEqual(allowedStakes(99), []);
});

test('koin = poin x taruhan, saldo tidak bisa minus', () => {
  assert.equal(coinDelta(6, 5), 30);
  assert.equal(coinDelta(-12, 20), -240);
  assert.equal(applyDelta(100, -240), 0);
  assert.equal(applyDelta(100, 30), 130);
});

test('dompet baru / rusak -> saldo awal', () => {
  assert.deepEqual(normalizeWallet(null, T), { coins: 1000, day: wibDay(T) });
  assert.deepEqual(normalizeWallet({ coins: 'x' }, T), { coins: 1000, day: wibDay(T) });
});

test('bangkrut: reset ke 1000 mulai 00.01 WIB hari berikutnya', () => {
  const w = { coins: 40, day: wibDay(T) };
  assert.ok(isBroke(40));
  assert.deepEqual(normalizeWallet(w, T + 3600e3), w, 'masih hari yang sama');
  assert.deepEqual(normalizeWallet(w, nextResetAt(T) - 1000), w, '00.00 WIB belum reset');
  assert.equal(normalizeWallet(w, nextResetAt(T)).coins, 1000);
  assert.equal(normalizeWallet({ coins: 250, day: wibDay(T) }, nextResetAt(T)).coins, 250, 'tidak bangkrut -> tidak direset');
});
