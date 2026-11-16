// 動く系統の地図の絵（1.5.3）：町の家並みと、発電所・変電所の種類のアイコン（SVG）。画面に依存しない（テストできるように分けた）
// 地点の種類ごとの部品にしてあるので、1.6.0（日本列島）では地点の座標を差し替えるだけで使える
// 色は CSS の変数（--ghouse など。ライト・ダーク）、動き（煙・水・水車・点滅・灯りの脈打ち）は CSS のクラス（gsync を付けたものは描き直しても位相をそろえる）
import * as Gm from './grid.js';

const f1 = (v) => (Math.round(v * 10) / 10).toString();

// ---- 町 ----
// 家並みの段（需要が大きいほど家が増える）：受けている需要の合計で決める
export const TOWN_TIERS = [50, 500]; // kW：50 未満＝1段（家2軒）、500 未満＝2段（3軒）、それ以上＝3段（4軒とビル）
export function townTier(kw) {
  return kw < TOWN_TIERS[0] ? 1 : kw < TOWN_TIERS[1] ? 2 : 3;
}
// 町の見た目：tier（家並みの段）・state（none＝需要なし／off＝いまは使っていない／lit＝灯っている／part＝一部だけ／dark＝停電）・
// lit（灯っている窓の割合）・open（その時代の町か）
export function townLook(g, n) {
  const loads = g.loads.filter((l) => l.town === n.id);
  const kw = loads.reduce((a, l) => a + l.kw, 0);
  const tier = townTier(kw);
  const open = n.era <= g.era;
  if (!loads.length) return { tier, state: 'none', lit: 0, open, kw };
  const st = g.last?.towns[n.id];
  if (!st || st.d <= 0) return { tier, state: 'off', lit: 0, open, kw };
  if (st.r >= 0.999) return { tier, state: 'lit', lit: 1, open, kw };
  if (st.r <= 0.001) return { tier, state: 'dark', lit: 0, open, kw };
  return { tier, state: 'part', lit: st.r, open, kw };
}
// 家の形（地点の中心からの位置。下端は y+9）。flat：屋根の平らなビル（窓は2段）
const HOUSES = {
  1: [{ x: -13, w: 12, h: 8 }, { x: 1, w: 12, h: 10 }],
  2: [{ x: -16, w: 10, h: 8 }, { x: -5, w: 10, h: 11 }, { x: 6, w: 10, h: 8 }],
  3: [{ x: -19, w: 9, h: 7 }, { x: -9, w: 8, h: 15, flat: true }, { x: 0, w: 9, h: 9 }, { x: 10, w: 9, h: 7 }],
};
// 窓の数（一部だけ灯るときに、何個を光らせるかの元）
export const windowCount = (tier) => HOUSES[tier].reduce((a, h) => a + (h.flat ? 4 : 2), 0);
// 灯す窓の数：一部だけ届いているときは、少なくとも1つ灯し、少なくとも1つ消す
export function litWindows(look) {
  const n = windowCount(look.tier);
  if (look.state === 'lit') return n;
  if (look.state !== 'part') return 0;
  return Math.min(n - 1, Math.max(1, Math.round(look.lit * n)));
}
export function townSvg(x, y, look) {
  const base = y + 9;
  const lit = litWindows(look);
  let k = 0;
  let houses = '', wins = '';
  for (const h of HOUSES[look.tier]) {
    const X = x + h.x, top = base - h.h;
    const roof = h.flat ? '' : `M${f1(X - 1)},${f1(top)} L${f1(X + h.w / 2)},${f1(top - h.w * 0.45)} L${f1(X + h.w + 1)},${f1(top)}Z`;
    houses += `<rect x="${f1(X)}" y="${f1(top)}" width="${h.w}" height="${h.h}" class="gwall"/>${roof ? `<path d="${roof}" class="groof"/>` : ''}`;
    const rows = h.flat ? [top + 3, top + 8.5] : [top + Math.max(2, h.h * 0.32)];
    for (const wy of rows)
      for (const wx of [X + h.w * 0.22, X + h.w * 0.78 - 2.6]) {
        wins += `<rect x="${f1(wx)}" y="${f1(wy)}" width="2.6" height="2.6" class="${k < lit ? 'gwin on' : 'gwin'}"/>`;
        k++;
      }
  }
  const glow = look.state === 'lit' || look.state === 'part' ? `<circle cx="${x}" cy="${y}" r="25" class="gtglow gsync" fill="url(#gtownglow)" style="opacity:${f1(0.35 + 0.65 * look.lit)}"/>` : '';
  const cls = ['gtown', `t-${look.state}`, look.open ? '' : 'gfuture'].filter(Boolean).join(' ');
  return `${glow}<g class="${cls}">${houses}${wins}</g>`;
}
// 灯りの輪（放射状のグラデーション）。地図の svg の先頭に1回だけ入れる
export const MAP_DEFS = `<defs><radialGradient id="gtownglow"><stop offset="0" stop-color="var(--gglow)" stop-opacity=".95"/><stop offset=".55" stop-color="var(--gglow)" stop-opacity=".35"/><stop offset="1" stop-color="var(--gglow)" stop-opacity="0"/></radialGradient></defs>`;

// ---- 発電所・変電所のアイコン ----
// 種類 → 絵の形。石炭火力（直流・交流・大型）は建物と煙突、流れ込み式は水車小屋、調整池式はダム、変電所は鉄の骨組みと変圧器
export const ICON_OF = { dcCoal: 'coal', acCoal: 'coal', bigCoal: 'bigcoal', ror: 'wheel', pond: 'dam', sub: 'sub' };
const ORDER = ['dcCoal', 'acCoal', 'bigCoal', 'ror', 'pond', 'sub'];
// 大きさの段（1〜3）：その種類の大きさの一覧のどのあたりか（同じ種類が複数あれば合計の出力で）
export function sizeTier(type, kw) {
  const list = type === 'sub' ? Gm.SUB_SIZES.map((m) => m * 1000) : Gm.PLANTS[type].sizes.map((z) => z[0]);
  let r = 0;
  for (let i = 0; i < list.length; i++) if (kw >= list[i] - 1e-9) r = i;
  return 1 + Math.min(2, Math.floor((3 * r) / list.length));
}
// その地点の設備を種類ごとにまとめる。state：work（すべて工事中＝足場）／down（故障・修理中＝赤く点滅）／run（動いている）／stop（止まっている・休止＝灰色）
// building：工事中のものが混じっている（三角コーンは別に出す）
export function assetGroups(g, nodeId) {
  const t = g.t;
  const by = new Map();
  for (const p of g.plants.filter((x) => x.site === nodeId)) {
    if (!by.has(p.type)) by.set(p.type, []);
    by.get(p.type).push({ x: p, kw: p.kw });
  }
  for (const s of g.subs.filter((x) => x.town === nodeId)) {
    if (!by.has('sub')) by.set('sub', []);
    by.get('sub').push({ x: s, kw: s.mva * 1000 });
  }
  const out = [];
  for (const type of ORDER) {
    const items = by.get(type);
    if (!items) continue;
    const built = items.filter((i) => i.x.readyAt <= t);
    const kw = items.reduce((a, i) => a + i.kw, 0);
    let state;
    if (!built.length) state = 'work';
    else if (built.some((i) => i.x.downUntil > t)) state = 'down';
    else if (type === 'sub') state = 'run';
    else state = built.some((i) => !i.x.idle && (g.last?.plants[i.x.id] || 0) > 0) ? 'run' : 'stop';
    out.push({ type, icon: ICON_OF[type], count: items.length, kw, tier: sizeTier(type, kw), state, building: built.length < items.length, ids: items.map((i) => i.x.id) });
  }
  return out;
}
// アイコンを置く場所（地点の中心からのずれ）。左上 → 右上 → 左 → 右 → 左下 → 右下
export const SLOTS = [[-27, -15], [27, -15], [-31, 7], [31, 7], [-25, 26], [25, 26]];
export const ICON_SCALE = { 1: 0.72, 2: 0.9, 3: 1.1 };
// 絵の形（-10〜10 の箱。下端は y=8）
const SHAPE = {
  coal: '<path class="gi-b" d="M-8 8V0l4-3v3l4-3v3h2V-6h3.5V8z"/><path class="gi-w" d="M-6 3h2M-2 3h2"/><g class="gsmoke gsync"><path d="M3.8-7c-1.6-2 1.6-3 0-5.4"/></g>',
  bigcoal: '<path class="gi-b" d="M-9 8V-1l4-3v3l4-3v3h1V-7h3V0h1.4V-7h3V8z"/><path class="gi-w" d="M-7 3h2M-3 3h2"/><g class="gsmoke gsync"><path d="M1.5-8c-1.6-2 1.6-3 0-5.4"/><path d="M5.9-8c-1.6-2 1.6-3 0-5.4"/></g>',
  wheel: '<path class="gi-b" d="M-9 8V-1l5-4 5 4V8z"/><g class="gwheel gsync"><circle cx="4.5" cy="2.5" r="4.6" class="gi-r"/><path class="gi-s" d="M4.5-2.1v9.2M-.1 2.5h9.2M1.2-.8l6.6 6.6M7.8-.8L1.2 5.8"/></g><path class="gwater gsync" d="M-9.5 9.4q1.6-1.6 3.2 0t3.2 0 3.2 0 3.2 0 3.2 0 3.2 0"/>',
  dam: '<path class="gi-lake" d="M-10-4h7V8h-7z"/><path class="gi-b" d="M-3-8h3.4L7 8H-3z"/><path class="gspray gsync" d="M7.4 3.6q2 1.6 2.4 4.4M5.6 1q3 1.2 4.2 2.6"/>',
  sub: '<path class="gi-f" d="M-8 8V-7M8 8V-7M-9.5-7h19M-8-3h16M-8-3l3.4-4M8-3L4.6-7M-5-7v-2.6M0-7v-2.6M5-7v-2.6"/><rect class="gi-b" x="-4.8" y="0" width="9.6" height="8" rx="1.2"/><circle class="gi-c" cx="-1.7" cy="4" r="2"/><circle class="gi-c" cx="1.7" cy="4" r="2"/>',
};
// 足場（工事中）
const SCAFFOLD = '<path class="gi-sc" d="M-8 9V-8M0 9V-8M8 9V-8M-8-5h16M-8 1h16M-8 7h16M-8-5l8 6M0 1l8 6"/>';
export function assetIcon(grp, x, y, slot) {
  const [dx, dy] = SLOTS[slot % SLOTS.length];
  const cx = x + dx, cy = y + dy;
  const s = ICON_SCALE[grp.tier];
  const r = 11.5;
  const len = Math.hypot(dx, dy) || 1;
  // 地点と短い線でつなぐ（地点の絵とアイコンの丸の間だけ）
  const conn = `<line class="gi-link" x1="${f1(x + (dx / len) * 13)}" y1="${f1(y + (dy / len) * 13)}" x2="${f1(cx - (dx / len) * r * s)}" y2="${f1(cy - (dy / len) * r * s)}"/>`;
  const body = grp.state === 'work' ? `<g opacity=".35">${SHAPE[grp.icon]}</g>${SCAFFOLD}` : SHAPE[grp.icon];
  const count = grp.count > 1 ? `<g class="gi-n"><rect x="5" y="5.5" width="13" height="9" rx="4.5"/><text x="11.5" y="12.4">×${grp.count}</text></g>` : '';
  return `${conn}<g class="gasset k-${grp.icon} s-${grp.state}" data-asset="${grp.type}" transform="translate(${f1(cx)},${f1(cy)}) scale(${s})"><circle r="${r}" class="gi-bg${grp.state === 'down' ? ' gblink gsync' : ''}"/>${body}${count}</g>`;
}
// 地点のアイコンをまとめて（町はアイコンが家並みの左右に、用地は菱形の左右に並ぶ）
export function assetsSvg(g, n, x, y) {
  return assetGroups(g, n.id).map((grp, i) => assetIcon(grp, x, y, i)).join('');
}
