// Salin file game ke dist/games/capsa supaya disajikan di sylvaniaharco.com/games/capsa/
// (pola yang sama dengan games-mahjong0hk). File/folder statis baru harus didaftarkan di sini.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'games', 'capsa');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'css', 'src', 'avatars']) cpSync(join(root, item), join(out, item), { recursive: true });
console.log('Build selesai →', out);
