// 1.7.3 日本列島の地図の押さない層を、1枚の canvas に描く
// 下の層（海岸線・地形の塗り分け・田畑の模様・湖・川・県境・周波数の境目）と景色の層（市街地の広がり・林・岩・家）。
// 上の層（線・地点・名前・流れる点線）は SVG のまま（gridui.js の topInner）。古い島（日本列島より前）は SVG のまま（gridui.js の baseSvg）
// 色・太さ・模様は 1.7.2 までの SVG（style.css の .gcoastf などのクラス）と同じにする。色は CSS 変数を実際の色に読み替えて使う
// 線の太さは画面の上の px（SVG の vector-effect: non-scaling-stroke と同じ）なので、地図の座標では 拡大率 k で割る

// iPhone の 3 倍だと 1 枚が大きくなりすぎる（Safari は canvas の合計のメモリに上限がある）ので、2 倍まで
export const MAX_DPR = 2;
export const dprOf = (d) => Math.min(MAX_DPR, Math.max(1, d || 1));

// 色を canvas に渡せる形に：color(srgb r g b / a)（color-mix の計算結果）は rgb()・rgba() に直す。ほかはそのまま
export function toRgba(s) {
  const t = String(s || '').trim();
  const m = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+%?))?\s*\)$/i.exec(t);
  if (!m) return t;
  const c = (v) => Math.round(Math.min(1, Math.max(0, +v)) * 255);
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  return a >= 1 ? `rgb(${c(m[1])}, ${c(m[2])}, ${c(m[3])})` : `rgba(${c(m[1])}, ${c(m[2])}, ${c(m[3])}, ${+a.toFixed(3)})`;
}
// 使う CSS 変数（style.css）
export const COLOR_VARS = ['land', 'coast', 'gt1', 'gt2', 'gt3', 'glake', 'griver', 'muted', 'gfa', 'gfb', 'gfc', 'gtree', 'gtreed', 'grock', 'gsnowc', 'gurban', 'ghouse'];
// CSS 変数を実際の色に（小さな見えない要素の color に入れて、計算された色を読む。まとめて1回の計算で）
export function readColors(parent) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  box.innerHTML = COLOR_VARS.map((v) => `<i style="color:var(--${v})"></i>`).join('');
  parent.appendChild(box);
  const out = {};
  [...box.children].forEach((el, i) => (out[COLOR_VARS[i]] = toRgba(getComputedStyle(el).color)));
  box.remove();
  return out;
}

// 線の太さ（画面の px。style.css の 1.7.2 までの値）と、点線・薄さ
export const STYLE = {
  coast: 1.2, // .gcoasts・.gcoastl
  lake: 0.7, // .glake の縁
  river: [1.4, 1.1, 0.85, 0.65], // .griverl.r0〜r3（それより細い段は 1.3）
  riverDefault: 1.3,
  pref: { w: 1, dash: [1, 3], alpha: 0.5 }, // .gprefl
  hz: { w: 1.4, dash: [5, 5], alpha: 0.55 }, // .ghzline
  field: 0.7, // .gfield
  urban: 0.55, // .gurban
  marks: 0.85, // .gsmarks
};

// 同じ文字列の path は1回だけ読む（Path2D）。区域が変わるたびに増えるので、たまったら捨てる
const P2 = new Map();
const path2 = (d) => {
  let p = P2.get(d);
  if (!p) {
    if (P2.size > 80) P2.clear();
    P2.set(d, (p = new Path2D(d)));
  }
  return p;
};

// 景色の印（gridui.js 1.6.3 の SCENE_SYM と同じ形）。画面の px で、真ん中が (0, 0)
const SYM = {
  tree: (x, c) => (line(x, 'M0,1.2 v2.6', c.gtreed), x.beginPath(), x.arc(0, -0.6, 2.7, 0, Math.PI * 2), (x.fillStyle = c.gtree), x.fill()),
  pine: (x, c) => (fill(x, 'M0,-4.4 L3,1.6 H-3Z', c.gtreed), line(x, 'M0,1.6 v1.8', c.gtreed)),
  rock: (x, c) => fill(x, 'M-3.6,2 L-0.8,-2.6 L0.8,-0.6 L1.8,-1.6 L3.8,2Z', c.grock),
  snow: (x, c) => (fill(x, 'M-4,2.2 L0,-3.4 L4,2.2Z', c.grock), fill(x, 'M-1.5,-1.3 L0,-3.4 L1.5,-1.3 L0.5,-0.7 L-0.4,-1.1Z', c.gsnowc)),
  house: (x, c) => fill(x, 'M-2.6,2.2 V-0.4 L0,-2.6 L2.6,-0.4 V2.2Z', c.ghouse),
};
function fill(x, d, c) {
  x.fillStyle = c;
  x.fill(path2(d));
}
function line(x, d, c) {
  x.strokeStyle = c;
  x.lineWidth = 1;
  x.stroke(path2(d));
}
export const SPRITE = 12; // 印の絵の大きさ（画面の px。いちばん大きい印が ±4.4）
const sprites = new Map();
function spriteOf(kind, colors, ck, dpr, mk) {
  const key = `${kind}|${ck}|${dpr}`;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size > 40) sprites.clear();
  s = mk(Math.ceil(SPRITE * dpr), Math.ceil(SPRITE * dpr));
  const x = s.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, (SPRITE / 2) * dpr, (SPRITE / 2) * dpr);
  (SYM[kind] || SYM.tree)(x, colors);
  sprites.set(key, s);
  return s;
}
// 田畑の模様（gridui.js 1.6.3 の fieldPattern と同じ並び）：1枚の幅 t km を n px の小さな絵に描いて並べ、-14° 傾ける
const tiles = new Map();
export function fieldTile(t) {
  // [x, y, w, h, 色] を 1 枚の幅を 1 とした割合で
  const r = [];
  const strips = (x0, y0, across, cs) => cs.forEach((c, i) => r.push(across ? [x0 + 0.02, y0 + 0.02 + i * 0.16, 0.44, 0.13, c] : [x0 + 0.02 + i * 0.16, y0 + 0.02, 0.13, 0.44, c]));
  strips(0, 0, true, ['gfa', 'gfb', 'gfa']);
  strips(0.5, 0, false, ['gfc', 'gfa', 'gfc']);
  strips(0, 0.5, false, ['gfb', 'gfc', 'gfb']);
  strips(0.5, 0.5, true, ['gfc', 'gfb', 'gfa']);
  return r;
}
function fieldPatternOf(ctx, t, px, colors, ck, mk) {
  const n = Math.max(4, Math.min(256, Math.round(t * px)));
  const key = `${n}|${ck}`;
  let tile = tiles.get(key);
  if (!tile) {
    if (tiles.size > 12) tiles.clear();
    tile = mk(n, n);
    const x = tile.getContext('2d');
    for (const [a, b, w, h, c] of fieldTile(t)) {
      x.fillStyle = colors[c];
      x.fillRect(a * n, b * n, w * n, h * n);
    }
    tiles.set(key, tile);
  }
  const p = ctx.createPattern(tile, 'repeat');
  // 模様の 1 px → 地図の t／n km、それを -14° 回す（SVG の patternTransform="rotate(-14)" と同じ向き）
  p.setTransform?.(new DOMMatrix().rotateSelf(-14).scaleSelf(t / n));
  return p;
}

// canvas の大きさ（px）：画面より上下左右に pad ずつ大きく（gridui.js の MAP_PAD）、dpr 倍
export function canvasSize(W, H, pad, dpr) {
  const cw = W * (1 + 2 * pad), ch = H * (1 + 2 * pad);
  return { cw, ch, pw: Math.max(1, Math.round(cw * dpr)), ph: Math.max(1, Math.round(ch * dpr)) };
}

// 描く。s：{ W, H, pad, dpr, view: { x, y, k }, colors, ck（色の鍵）, terrain, coast, lakes: [d], rivers: [d], pref, ter: [d, d, d], hz, fieldKm, scene: { blobs, marks } }
// mk(w, h)：小さな canvas を作る（印の絵・田畑の模様）
export function paint(cv, s, mk) {
  const { cw, ch, pw, ph } = canvasSize(s.W, s.H, s.pad, s.dpr);
  if (cv.width !== pw) cv.width = pw;
  if (cv.height !== ph) cv.height = ph;
  const ctx = cv.getContext('2d');
  const sx = pw / cw, sy = ph / ch;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.clearRect(0, 0, pw, ph); // 海の色は canvas の背景（style.css の .gmap）
  const { k } = s.view;
  const ox = s.W * s.pad - s.view.x * k, oy = s.H * s.pad - s.view.y * k;
  ctx.setTransform(k * sx, 0, 0, k * sy, ox * sx, oy * sy); // 地図の座標 → canvas の px
  const C = s.colors;
  ctx.lineJoin = 'round';
  const stroke = (p, color, w, dash = null, alpha = 1, cap = 'butt') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w / k;
    ctx.lineCap = cap;
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dash ? dash.map((v) => v / k) : []);
    ctx.stroke(p);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };
  const coast = path2(s.coast);
  // 陸
  ctx.fillStyle = C.land;
  ctx.fill(coast);
  if (!s.terrain) stroke(coast, C.coast, STYLE.coast);
  else {
    // 田畑の模様（拡大したとき）→ 丘陵・山地・高い山の面（海岸線の形で切り抜く）
    if (s.fieldKm) {
      ctx.globalAlpha = STYLE.field;
      ctx.fillStyle = fieldPatternOf(ctx, s.fieldKm, k * sx, C, s.ck, mk);
      ctx.fill(coast);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.clip(coast);
    (s.ter || []).forEach((d, i) => {
      ctx.fillStyle = C[`gt${i + 1}`];
      ctx.fill(path2(d), 'evenodd');
    });
    ctx.restore();
  }
  // 湖・幅の広い川の面
  for (const d of s.lakes || []) {
    if (!d) continue;
    const p = path2(d);
    ctx.fillStyle = C.glake;
    ctx.fill(p);
    stroke(p, C.griver, STYLE.lake);
  }
  if (s.terrain) {
    stroke(coast, C.coast, STYLE.coast);
    if (s.pref) stroke(path2(s.pref), C.muted, STYLE.pref.w, STYLE.pref.dash, STYLE.pref.alpha, 'round');
  }
  (s.rivers || []).forEach((d, i) => d && stroke(path2(d), C.griver, STYLE.river[i] ?? STYLE.riverDefault, null, 1, 'round'));
  if (s.hz) stroke(path2(s.hz), C.muted, STYLE.hz.w, STYLE.hz.dash, STYLE.hz.alpha);
  // 景色：市街地の淡い広がり（海岸線で切り抜く。重なっても濃くならないよう1回で塗る）→ 林・岩・家の印（画面の px の大きさ）
  const sc = s.scene;
  if (sc) {
    if (sc.blobs.length) {
      ctx.save();
      ctx.clip(coast);
      ctx.beginPath();
      for (const b of sc.blobs) ctx.moveTo(b.x + b.r, b.y), ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = C.gurban;
      ctx.globalAlpha = STYLE.urban;
      ctx.fill();
      ctx.restore();
    }
    if (sc.marks.length) {
      ctx.setTransform(sx, 0, 0, sy, s.W * s.pad * sx, s.H * s.pad * sy); // 画面の px
      ctx.globalAlpha = STYLE.marks;
      const h = SPRITE / 2;
      for (const m of sc.marks) ctx.drawImage(spriteOf(m.kind, C, s.ck, s.dpr, mk), (m.x - s.view.x) * k - h, (m.y - s.view.y) * k - h, SPRITE, SPRITE);
      ctx.globalAlpha = 1;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
// 使い終わった canvas のメモリを手放す（iPhone の Safari は canvas の合計に上限がある）
export function release(cv) {
  if (!cv) return;
  cv.width = 0;
  cv.height = 0;
}
