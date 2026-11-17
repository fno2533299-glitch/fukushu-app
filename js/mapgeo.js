// 1.6.3 地図の水系と景色：japan_water.js の詰めた形を SVG の path に戻す（拡大の度合いで描く量を変える）・
// 拡大したときの景色（田畑・林・岩と雪・市街地）を決める。見た目だけで、grid.js の規則には使わない（grid.js はこのファイルを読まない）
import { WATER_COAST, WATER_COAST_NEAR_W, WATER_RIVERS, WATER_RIVER_W, WATER_LAKES, WATER_RIVER_AREAS } from './japan_water.js';
import { JAPAN_TERRAIN } from './japan_terrain.js';

// ---- 詰めた形を戻す（ツール/日本列島/shape.mjs の encLines の逆） ----
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VAL = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) VAL[ABC.charCodeAt(i)] = i;
// 文字列 → 線の配列。線は [x0, y0, x1, y1, …]（0.1 km の整数。絶対座標）
export function decInts(s) {
  const out = [];
  for (const part of s.split(' ')) {
    if (!part) continue;
    const nums = [];
    let z = 0, sh = 0, n = 0, x = 0, y = 0;
    for (let i = 0; i < part.length; i++) {
      const c = VAL[part.charCodeAt(i)];
      if (c < 0) throw new Error('形の文字列が壊れている');
      z |= (c & 31) << sh;
      if (c & 32) sh += 5;
      else {
        const v = z & 1 ? -(z + 1) / 2 : z / 2;
        if (n++ & 1) nums.push(x, (y += v));
        else x += v;
        (z = 0), (sh = 0);
      }
    }
    out.push(Int32Array.from(nums));
  }
  return out;
}
// 線の配列（km の点 [x, y]）に（テストと景色の計算用）
export const decLines = (s) => decInts(s).map((L) => Array.from({ length: L.length / 2 }, (_, i) => [L[2 * i] / 10, L[2 * i + 1] / 10]));
// 線の配列（0.1 km の整数）→ SVG の path（相対座標。整数を 10 で割った数はそのまま短い小数になる）。closed なら z
export function intsToPath(lines, closed) {
  let d = '';
  for (const L of lines) {
    if (L.length < 4) continue;
    let px = L[0], py = L[1];
    d += 'M' + px / 10 + ' ' + py / 10;
    for (let i = 2; i < L.length; i += 2) {
      const x = L[i], y = L[i + 1];
      d += 'l' + (x - px) / 10 + ' ' + (y - py) / 10;
      (px = x), (py = y);
    }
    if (closed) d += 'z';
  }
  return d;
}
// SVG の path（M・l・z だけ。japan_terrain.js の形）→ 輪の配列（km の点）
export function pathToRings(d) {
  const rings = [];
  let cur = null, x = 0, y = 0;
  const re = /([MlLz])([^MlLz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
    if (m[1] === 'M') {
      (x = nums[0]), (y = nums[1]);
      cur = [[x, y]];
      rings.push(cur);
    } else if (m[1] === 'l') {
      for (let i = 0; i + 1 < nums.length; i += 2) (x += nums[i]), (y += nums[i + 1]), cur.push([x, y]);
    } else if (m[1] === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) (x = nums[i]), (y = nums[i + 1]), cur.push([x, y]);
    } else if (cur) (x = cur[0][0]), (y = cur[0][1]);
  }
  return rings;
}
const memo = new Map();
const once = (k, f) => (memo.has(k) ? memo.get(k) : memo.set(k, f()).get(k));
// 線と、その囲む長方形（0.1 km の整数）
const withBox = (L) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < L.length; i += 2) (x0 = Math.min(x0, L[i])), (x1 = Math.max(x1, L[i])), (y0 = Math.min(y0, L[i + 1])), (y1 = Math.max(y1, L[i + 1]));
  return { L, b: [x0, y0, x1, y1] };
};
const ringAreaKm2 = (L) => {
  let a = 0;
  for (let i = 0; i < L.length; i += 2) {
    const j = (i + 2) % L.length;
    a += L[i] * L[j + 1] - L[j] * L[i + 1];
  }
  return Math.abs(a / 2) / 100;
};
const DATA = () =>
  once('data', () => ({
    far: decInts(WATER_COAST.far).map(withBox),
    near: decInts(WATER_COAST.near).map(withBox),
    rivers: WATER_RIVERS.map((s) => decInts(s).map(withBox)),
    lakes: decInts(WATER_LAKES).map(withBox),
    areas: decInts(WATER_RIVER_AREAS).map(withBox),
  }));

// ---- 拡大したときは、画面のまわり（画面の4倍ほどの範囲）だけを切り出して描く（下の層を軽くする） ----
// 範囲は2のべき乗の大きさで、その4分の1の格子にそろえる（少し動かしても同じ範囲＝描き直さない）
export function regionOf(x, y, w, h) {
  if (w > WATER_COAST_NEAR_W) return null;
  const S = 2 ** Math.ceil(Math.log2(4 * Math.max(w, h)));
  const q = S / 4;
  const x0 = Math.floor((x + w / 2 - S / 2) / q) * q, y0 = Math.floor((y + h / 2 - S / 2) / q) * q;
  return { x0, y0, x1: x0 + S, y1: y0 + S, key: `${S}:${x0}:${y0}` };
}
const hitBox = (b, r) => b[2] >= r[0] && b[0] <= r[2] && b[3] >= r[1] && b[1] <= r[3];
// 輪を長方形で切る（Sutherland–Hodgman）。r は 0.1 km の整数 [x0, y0, x1, y1]
function clipRing(L, r) {
  let P = Array.from(L);
  const sides = [
    [(x) => x >= r[0], (ax, ay, bx, by) => [r[0], ay + ((by - ay) * (r[0] - ax)) / (bx - ax)], 0],
    [(x) => x <= r[2], (ax, ay, bx, by) => [r[2], ay + ((by - ay) * (r[2] - ax)) / (bx - ax)], 0],
    [(y) => y >= r[1], (ax, ay, bx, by) => [ax + ((bx - ax) * (r[1] - ay)) / (by - ay), r[1]], 1],
    [(y) => y <= r[3], (ax, ay, bx, by) => [ax + ((bx - ax) * (r[3] - ay)) / (by - ay), r[3]], 1],
  ];
  for (const [inside, cut, k] of sides) {
    if (P.length < 6) return null;
    const out = [];
    for (let i = 0; i < P.length; i += 2) {
      const j = (i - 2 + P.length) % P.length;
      const ax = P[j], ay = P[j + 1], bx = P[i], by = P[i + 1];
      const ain = inside(k ? ay : ax), bin = inside(k ? by : bx);
      if (bin) {
        if (!ain) out.push(...cut(ax, ay, bx, by).map(Math.round));
        out.push(bx, by);
      } else if (ain) out.push(...cut(ax, ay, bx, by).map(Math.round));
    }
    P = out;
  }
  return P.length >= 6 ? P : null;
}
// 折れ線を長方形の近くの部分だけに（長方形と重なる線分のつながりを残す）
function clipLine(L, r) {
  const out = [];
  let cur = null;
  for (let i = 0; i + 2 < L.length; i += 2) {
    const b = [Math.min(L[i], L[i + 2]), Math.min(L[i + 1], L[i + 3]), Math.max(L[i], L[i + 2]), Math.max(L[i + 1], L[i + 3])];
    if (hitBox(b, r)) {
      if (!cur) (cur = [L[i], L[i + 1]]), out.push(cur);
      cur.push(L[i + 2], L[i + 3]);
    } else cur = null;
  }
  return out;
}
// 区域で切り出した線（区域がなければ全部）。区域ごとに覚える（24 まで）
const regionMemo = new Map();
function inRegion(kind, items, reg, closed) {
  if (!reg) return items.map((x) => x.L);
  const key = `${kind}|${reg.key}`;
  if (regionMemo.has(key)) return regionMemo.get(key);
  const r = [reg.x0 * 10, reg.y0 * 10, reg.x1 * 10, reg.y1 * 10];
  const out = [];
  for (const { L, b } of items) {
    if (!hitBox(b, r)) continue;
    if (b[0] >= r[0] && b[2] <= r[2] && b[1] >= r[1] && b[3] <= r[3]) out.push(L);
    else if (closed) {
      const c = clipRing(L, r);
      if (c) out.push(c);
    } else out.push(...clipLine(L, r));
  }
  regionMemo.set(key, out);
  if (regionMemo.size > 24) regionMemo.delete(regionMemo.keys().next().value);
  return out;
}
const pathMemo = new Map();
const pathOf = (key, f) => {
  if (pathMemo.has(key)) return pathMemo.get(key);
  const d = f();
  pathMemo.set(key, d);
  if (pathMemo.size > 24) pathMemo.delete(pathMemo.keys().next().value);
  return d;
};

// ---- 水系の細かさ ----
// 海岸線：画面の幅が WATER_COAST_NEAR_W km 以下なら細かい形（reg：regionOf の区域。null なら全体）
export const coastLevel = (w) => (w <= WATER_COAST_NEAR_W ? 'near' : 'far');
export const coastPath = (lv, reg = null) => pathOf(`c${lv}|${lv === 'near' ? reg?.key : ''}`, () => intsToPath(inRegion(`c${lv}`, DATA()[lv], lv === 'near' ? reg : null, true), true));
// 川：画面の幅で描く段の数（本流からの長さの長い段から）
export const riverCount = (w) => WATER_RIVER_W.filter((x) => w <= x).length;
export const RIVER_TIERS = WATER_RIVERS.length;
export const riverPath = (i, reg = null) => pathOf(`r${i}|${reg?.key}`, () => intsToPath(inRegion(`r${i}`, DATA().rivers[i], reg, false), false));
// 湖：引いて見たとき（区域なし）は 4 km² 以上の湖だけ
const LAKE_FAR_MIN = 4;
export const lakePath = (reg = null) => pathOf(`lk|${reg?.key}`, () => intsToPath(reg ? inRegion('lk', DATA().lakes, reg, true) : DATA().lakes.filter((x) => ringAreaKm2(x.L) >= LAKE_FAR_MIN).map((x) => x.L), true));
export const riverAreaPath = (reg = null) => pathOf(`ra|${reg?.key}`, () => intsToPath(inRegion('ra', DATA().areas, reg, true), true));

// ---- 点が面の中か（輪の辺を横の帯に分けて、近い辺だけを数える。偶奇）。輪は km の点の配列 ----
export function polyIndex(rings, band = 2) {
  const B = new Map();
  for (const R of rings)
    for (let i = 0; i < R.length; i++) {
      const a = R[i], b = R[(i + 1) % R.length];
      if (a[1] === b[1]) continue;
      for (let k = Math.floor(Math.min(a[1], b[1]) / band); k <= Math.floor(Math.max(a[1], b[1]) / band); k++) (B.get(k) || B.set(k, []).get(k)).push(a[0], a[1], b[0], b[1]);
    }
  return (x, y) => {
    const E = B.get(Math.floor(y / band));
    if (!E) return false;
    let c = false;
    for (let i = 0; i < E.length; i += 4) {
      const x1 = E[i], y1 = E[i + 1], x2 = E[i + 2], y2 = E[i + 3];
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) c = !c;
    }
    return c;
  };
}
// 長方形 view（km）のまわりの川の線分だけで、点から川までが r km 以内かを調べる関数を作る（景色を作るたびに作る。軽い）
export function riverNearIn(view, r) {
  const R = [(view.x0 - r) * 10, (view.y0 - r) * 10, (view.x1 + r) * 10, (view.y1 + r) * 10];
  const cell = Math.max(0.5, (view.x1 - view.x0) / 30);
  const G = new Map();
  const nx = Math.ceil((view.x1 - view.x0 + 2 * r) / cell) + 2;
  const cxOf = (x) => Math.floor((x - view.x0 + r) / cell), cyOf = (y) => Math.floor((y - view.y0 + r) / cell);
  for (const tier of DATA().rivers)
    for (const { L, b } of tier) {
      if (!hitBox(b, R)) continue;
      for (let i = 0; i + 2 < L.length; i += 2) {
        const sb = [Math.min(L[i], L[i + 2]), Math.min(L[i + 1], L[i + 3]), Math.max(L[i], L[i + 2]), Math.max(L[i + 1], L[i + 3])];
        if (!hitBox(sb, R)) continue;
        const x1 = L[i] / 10, y1 = L[i + 1] / 10, x2 = L[i + 2] / 10, y2 = L[i + 3] / 10;
        for (let cx = Math.max(0, cxOf(Math.min(x1, x2))); cx <= Math.min(nx - 1, cxOf(Math.max(x1, x2))); cx++)
          for (let cy = Math.max(0, cyOf(Math.min(y1, y2))); cy <= cyOf(Math.max(y1, y2)); cy++) {
            const k = cy * nx + cx;
            (G.get(k) || G.set(k, []).get(k)).push(x1, y1, x2, y2);
          }
      }
    }
  return (x, y, rr = r) => {
    for (let cx = cxOf(x - rr); cx <= cxOf(x + rr); cx++)
      for (let cy = cyOf(y - rr); cy <= cyOf(y + rr); cy++) {
        const E = G.get(cy * nx + cx);
        if (!E) continue;
        for (let i = 0; i < E.length; i += 4) {
          const x1 = E[i], y1 = E[i + 1], dx = E[i + 2] - x1, dy = E[i + 3] - y1;
          const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= rr) return true;
        }
      }
    return false;
  };
}
const kmRings = (items) => items.map(({ L }) => Array.from({ length: L.length / 2 }, (_, i) => [L[2 * i] / 10, L[2 * i + 1] / 10]));
// 景色のための調べ方（初めて拡大したときに1回だけ作る）
const geo = () =>
  once('geo', () => ({
    land: polyIndex(kmRings(DATA().near)),
    water: polyIndex(kmRings([...DATA().lakes, ...DATA().areas])),
    t1: polyIndex(pathToRings(JAPAN_TERRAIN.hill)),
    t2: polyIndex(pathToRings(JAPAN_TERRAIN.mount)),
    t3: polyIndex(pathToRings(JAPAN_TERRAIN.high)),
  }));
// 地点の性格：'sea'（海）・'water'（湖・幅の広い川）・0〜3（平野・丘陵・山地・高い山）
export function placeOf(x, y) {
  const G = geo();
  if (!G.land(x, y)) return 'sea';
  if (G.water(x, y)) return 'water';
  return G.t3(x, y) ? 3 : G.t2(x, y) ? 2 : G.t1(x, y) ? 1 : 0;
}

// ---- 拡大したときの景色 ----
export const SCENE_W = 60; // 画面の幅がこれ以下（km）のときだけ景色を描く
export const SCENE_MAX = 200; // 印（木・岩・家）の数の上限
// 景色の段（0＝出さない）。田畑の模様の大きさを段ごとに変える（下の層を描き直すのは段が変わったときだけ）
export const sceneLevel = (w) => (w > SCENE_W ? 0 : w > 24 ? 1 : w > 10 ? 2 : 3);
export const FIELD_KM = [0, 1.6, 0.64, 0.26]; // 田畑の模様の1枚の幅（km）

// 場所から決まる乱数（同じ場所・同じ細かさならいつも同じ）。0〜1
export function hash01(a, b, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const strHash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
};

// 市街地の広がり（半径 km）：その町に届いている需要（kW）で広がる。届いていなければ時代と町の大きさの基本の大きさ。見た目だけ
const SPRAWL_ERA = [0, 0.25, 0.4, 0.65, 0.95, 1.3, 1.7];
const SPRAWL_SIZE = [0, 0.7, 1, 1.4];
export function sprawlKm(kw, era, size) {
  const base = (SPRAWL_ERA[Math.min(era, 6)] || 0.25) * (SPRAWL_SIZE[size] || 1);
  const byLoad = kw > 0 ? 0.3 * Math.sqrt(kw / 10) : 0;
  return Math.min(5, Math.max(base, byLoad));
}
// 市街地の形：町ごとに4つの円（真ん中と、まわりに3つ。町の id から決まる向き）
export function sprawlBlobs(t) {
  const h = strHash(t.id);
  const out = [{ x: t.x, y: t.y, r: t.r }];
  for (let i = 0; i < 3; i++) {
    const a = (hash01(h, i, 1) + i / 3) * Math.PI * 2, d = t.r * (0.45 + 0.35 * hash01(h, i, 2));
    out.push({ x: t.x + Math.cos(a) * d, y: t.y + Math.sin(a) * d, r: t.r * (0.45 + 0.25 * hash01(h, i, 3)) });
  }
  return out;
}

// 印を決める。view：画面に見えている地図の範囲 {x0, y0, x1, y1}（km）、k：1 km が何 px か、
// towns：[{ id, x, y, r }]（市街地。r は km）、avoid：[{ x, y }]（地点の絵。まわり 20px には置かない）
// 返す印：{ kind: 'tree' | 'pine' | 'rock' | 'snow' | 'house', x, y }（地図の座標）。数は max まで
export function sceneMarks({ view, k, towns = [], avoid = [], max = SCENE_MAX }) {
  const marks = [];
  const inTown = (x, y, pad = 0) => towns.some((t) => sprawlBlobs(t).some((b) => Math.hypot(x - b.x, y - b.y) < b.r + pad));
  const clear = (x, y, px) => !avoid.some((p) => Math.hypot(x - p.x, y - p.y) * k < px);
  const riverR = 5 / k; // 川の線から 5px は空ける
  const nearRiver = riverNearIn(view, riverR);
  // 家：市街地の円の中に、画面の上の面積に合わせた数（町ごとに40まで、全体で max の6割まで）
  const houseMax = Math.floor(max * 0.6);
  for (const t of towns) {
    const h = strHash(t.id);
    const R = t.r * k;
    const n = Math.min(40, Math.round((R * R) / 55));
    for (let i = 0; i < n && marks.length < houseMax; i++) {
      const a = hash01(h, i, 11) * Math.PI * 2, d = Math.sqrt(hash01(h, i, 12)) * t.r;
      const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      if (!clear(x, y, 14)) continue;
      const p = placeOf(x, y);
      if (p === 'sea' || p === 'water' || nearRiver(x, y)) continue;
      marks.push({ kind: 'house', x, y });
    }
  }
  // 木・岩・雪：格子（画面の上で 21〜42px。2のべき乗の km）ごとに1つの候補を、場所から決まる位置に
  const step = 2 ** Math.round(Math.log2(30 / k));
  const lv = Math.round(Math.log2(step)) + 20;
  const cand = [];
  for (let i = Math.floor(view.x0 / step); i <= Math.floor(view.x1 / step); i++)
    for (let j = Math.floor(view.y0 / step); j <= Math.floor(view.y1 / step); j++) {
      const x = (i + 0.15 + 0.7 * hash01(i, j, lv)) * step, y = (j + 0.15 + 0.7 * hash01(j, i, lv + 50)) * step;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      cand.push({ x, y, r: hash01(i, j, lv + 99) });
    }
  const room = max - marks.length;
  // 多すぎるときは、場所から決まる値の小さいものから（同じ画面ならいつも同じ）
  const keep = cand.length > room * 1.6 ? cand.sort((a, b) => a.r - b.r).slice(0, Math.ceil(room * 1.6)) : cand;
  for (const c of keep) {
    if (marks.length >= max) break;
    const p = placeOf(c.x, c.y);
    if (typeof p !== 'number' || p === 0) continue; // 海・湖・平野（平野は田畑の模様）
    // 丘陵は 6 割・山地は 8 割に林、高い山は 3 割に岩か雪（少なめ）
    const P = [0, 0.6, 0.8, 0.3][p];
    if (c.r > P) continue;
    if (!clear(c.x, c.y, 18) || inTown(c.x, c.y, 2 / k) || nearRiver(c.x, c.y)) continue;
    const kind = p === 3 ? (c.r < 0.12 ? 'snow' : 'rock') : p === 2 ? (c.r < 0.5 ? 'pine' : 'tree') : c.r < 0.12 ? 'pine' : 'tree';
    marks.push({ kind, x: c.x, y: c.y });
  }
  return marks;
}
