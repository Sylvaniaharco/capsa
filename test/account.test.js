import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFrom, loginUrl, accountEnabled } from '../src/ui/account.js';

const google = { google: true };

test('akun Google: nama + koin dari dompet server', () => {
  const a = accountFrom({ user: { id: 'g:1', name: 'Teddy', email: 'x@y.z', guest: false }, wallet: { coins: 12340 }, stats: {}, perks: {} }, google);
  assert.deepEqual(a, { state: 'in', name: 'Teddy', coins: 12340 });
  // id & email tidak ikut keluar dari ringkasan
  assert.deepEqual(Object.keys(a).sort(), ['coins', 'name', 'state']);
});

test('belum login / tamu Mahjong = belum masuk', () => {
  assert.deepEqual(accountFrom({ user: null }, google), { state: 'out' });
  assert.deepEqual(accountFrom({ user: { id: 'guest:1', name: 'Bambu Senyap 27', guest: true }, stats: null }, google), { state: 'out' });
});

test('login Google belum diatur / jawaban aneh = fitur akun mati', () => {
  assert.deepEqual(accountFrom({ user: null }, { google: false }), { state: 'off' });
  assert.deepEqual(accountFrom({ user: null }, null), { state: 'off' });
  assert.deepEqual(accountFrom(null, google), { state: 'off' });
  assert.deepEqual(accountFrom({ error: 'Server error' }, google), { state: 'off' });
});

test('koin rusak tidak membuat lobi error', () => {
  assert.equal(accountFrom({ user: { name: 'A', guest: false } }, google).coins, null);
  assert.equal(accountFrom({ user: { name: 'A', guest: false }, wallet: { coins: 'x' } }, google).coins, null);
  assert.equal(accountFrom({ user: { name: 'A', guest: false }, wallet: { coins: -5 } }, google).coins, 0);
});

test('login kembali ke Capsa; di Node (bukan browser) fitur akun mati', () => {
  assert.equal(loginUrl, '/games/mahjonghk/api/auth/google?next=capsa');
  assert.equal(accountEnabled(), false);
});
