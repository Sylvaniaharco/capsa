// Bikin PNG ikon dari icons/icon.svg (jalankan hanya kalau desain ikon berubah; butuh Playwright):
//   node scripts/icons.cjs
// "any" = kotak sudut bulat dengan bingkai kayu; "maskable" = latar penuh, gambar diperkecil ke zona aman.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = join(__dirname, '..', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const inner = svg.slice(svg.indexOf('<defs>'), svg.lastIndexOf('</svg>'));
const defs = inner.slice(0, inner.indexOf('<g id="art">'));
const art = inner.slice(inner.indexOf('<g id="art">'));

const page = (maskable) => `<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" style="display:block">
  ${defs}
  ${maskable
    ? `<rect width="512" height="512" fill="url(#felt)"/><g transform="translate(256 256) scale(.95) translate(-256 -282)">${art}</g>`
    : `<rect x="6" y="6" width="500" height="500" rx="112" fill="#5a3418"/><rect x="18" y="18" width="476" height="476" rx="100" fill="#96642f"/>
       <rect x="24" y="24" width="464" height="464" rx="95" fill="url(#felt)"/><clipPath id="in"><rect x="24" y="24" width="464" height="464" rx="95"/></clipPath>
       <g clip-path="url(#in)"><g transform="translate(256 256) scale(1.12) translate(-256 -284)">${art}</g></g>`}
</svg></body>`;

(async () => {
  const b = await chromium.launch();
  for (const [name, size, maskable] of [
    ['icon-512.png', 512, false], ['icon-192.png', 192, false], ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, true], ['favicon-32.png', 32, false],
  ]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(page(maskable));
    await p.screenshot({ path: join(dir, name), omitBackground: !maskable });
    await p.close();
  }
  await b.close();
  console.log('Ikon dibuat di', dir);
})();
