// Bikin PNG ikon dari icons/icon.svg (jalankan hanya kalau desain ikon berubah; butuh Playwright):
//   node scripts/icons.cjs
// "any" = kotak sudut bulat dengan bingkai emas (sudut transparan);
// "maskable" / apple-touch = latar penuh tanpa bingkai, gambar diperkecil ke zona aman (OS yang memotong sudutnya).
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = join(__dirname, '..', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const inner = svg.slice(svg.indexOf('<defs>'), svg.lastIndexOf('</svg>'));
const defs = inner.slice(0, inner.indexOf('<g id="frame">'));
const frame = inner.slice(inner.indexOf('<g id="frame">'), inner.indexOf('<g id="art">'));
const art = inner.slice(inner.indexOf('<g id="art">'));

// pusat gambar (kartu + tulisan) kira-kira di y=268
const page = (mode) => `<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" style="display:block">
  ${defs}
  ${mode === 'any'
    ? `${frame}${art}`
    : `<rect width="512" height="512" fill="url(#felt)"/><g transform="translate(256 256) scale(${mode === 'maskable' ? 0.72 : 0.9}) translate(-256 -262)">${art}</g>`}
</svg></body>`;

(async () => {
  const b = await chromium.launch();
  for (const [name, size, mode] of [
    ['icon-512.png', 512, 'any'], ['icon-192.png', 192, 'any'], ['icon-maskable-512.png', 512, 'maskable'],
    ['apple-touch-icon.png', 180, 'apple'], ['favicon-32.png', 32, 'any'],
  ]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(page(mode));
    await p.screenshot({ path: join(dir, name), omitBackground: mode === 'any' });
    await p.close();
  }
  await b.close();
  console.log('Ikon dibuat di', dir);
})();
