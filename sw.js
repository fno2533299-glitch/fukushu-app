// オフライン用：アプリ本体をすべて端末に保存し、以後は保存したものから表示する
// アプリを更新したら CACHE の番号を上げる（index.html の APP_VERSION も合わせる）
const CACHE = 'fukushu-1.10.0';
const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/db.js',
  './js/logic.js',
  './js/grid.js',
  './js/gridui.js',
  './js/griddev.js',
  './js/gridmenu.js',
  './js/gridimg.js',
  './js/gridart.js',
  './js/japan.js',
  './js/japan_terrain.js',
  './js/japan_water.js',
  './js/mapgeo.js',
  './js/mapcanvas.js',
  './js/gridjapan.js',
  './js/gridmission.js',
  './js/gridsea.js',
  './js/gridrec.js',
  // GRID_IMAGES_BEGIN（ツール/系統画像/make_grid_images.py が書き換える）
  './img/grid/G01.webp',
  './img/grid/G02.webp',
  './img/grid/G03.webp',
  './img/grid/G04.webp',
  './img/grid/G05.webp',
  './img/grid/G06.webp',
  './img/grid/G07.webp',
  './img/grid/G08.webp',
  './img/grid/G09.webp',
  './img/grid/G10.webp',
  './img/grid/G11.webp',
  './img/grid/G12.webp',
  './img/grid/G13.webp',
  './img/grid/G14.webp',
  './img/grid/G15.webp',
  './img/grid/G16.webp',
  './img/grid/G17.webp',
  './img/grid/G18.webp',
  './img/grid/G19.webp',
  './img/grid/G20.webp',
  './img/grid/G21.webp',
  './img/grid/G22.webp',
  './img/grid/G23.webp',
  './img/grid/I01.webp',
  './img/grid/I02.webp',
  './img/grid/I03.webp',
  './img/grid/I04.webp',
  './img/grid/I05.webp',
  './img/grid/I06.webp',
  './img/grid/I07.webp',
  './img/grid/L01.webp',
  './img/grid/L02.webp',
  './img/grid/L03.webp',
  // GRID_IMAGES_END
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/katex/katex.min.css',
  './vendor/katex/katex.min.js',
  './vendor/katex/auto-render.min.js',
  './vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
];

self.addEventListener('install', (e) => {
  // 1.5.2：ブラウザの HTTP キャッシュに残った古いファイルを入れないよう、ネットワークから取り直す
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
