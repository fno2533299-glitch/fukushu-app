// 1.10.3 町の画面（町を見る：案1）と電鉄の準備部品・物と単元の対応表（画面に依存しない計算と SVG 生成）
// 試作：試作/町の画面_試作_v1.html。左から右へ（入ってくる線 → 変電所 → 電柱・柱上変圧器・接地 → 建物・記念の建物）
import * as Gm from './grid.js';
import * as Mn from './gridmenu.js';
import * as Art from './gridart.js';

// ---- 1.4 物と単元の対応表（すべての単元 ID は ツール/科目定義.json にあること） ----
export const TOWN_OBJECTS = {
  line: {
    name: '送電線・配電線',
    units: ['denken3-denryoku-U06', 'denken2-denryoku-U06', 'transmission-1-U04', 'transmission-1-U05', 'power-system-U06', 'power-system-U07'],
  },
  sub: {
    name: '変電所',
    units: ['denken3-denryoku-U05', 'denken2-denryoku-U05', 'denken3-kikai-U04', 'denken2-kikai-U04', 'generation-U12'],
  },
  pole: {
    name: '柱上変圧器・配電線',
    units: ['denken3-denryoku-U07', 'denken2-denryoku-U07', 'denken3-kikai-U04', 'denken2-kikai-U04'],
  },
  earth: {
    name: '接地（B種接地）',
    units: ['denken3-hoki-U03', 'denken2-hoki-U03'],
  },
  lamp: {
    name: '街灯（電灯）',
    pic: 'load_lamp',
    units: ['denken3-kikai-U07', 'denken2-kikai-U07', 'generation-U01'],
  },
  home: {
    name: '住宅',
    pic: 'load_home',
    units: ['generation-U01', 'power-system-U01', 'denken3-hoki-U05'],
  },
  shop: {
    name: '商店（町の動力）',
    pic: 'load_shop',
    units: ['denken3-kikai-U02', 'denken2-kikai-U02', 'denken3-kikai-U06', 'denken2-kikai-U06'],
  },
  factory: {
    name: '工場（動力・モータ）',
    pic: 'load_factory',
    units: ['denken3-kikai-U02', 'denken2-kikai-U02', 'circuit-b-U11', 'denken3-kikai-U06', 'denken2-kikai-U06'],
  },
  furnace: {
    name: '工場の電気炉（電熱）',
    pic: 'load_factory',
    units: ['denken3-kikai-U07', 'denken2-kikai-U07'],
  },
  tram: {
    name: '電鉄（電車）',
    units: ['denken3-kikai-U01', 'denken2-kikai-U01', 'denken3-kikai-U05'],
  },
  decor: {
    name: '記念の建物',
    units: [],
  },
};

// 建物の最大数と種別ごとの上限（スマホで滑らかに動く上限＝合計 10）
export const MAX_BUILDINGS = 10;
const KIND_MAX = { lamp: 3, home: 3, shop: 2, factory: 2 };
// 需要量（kW）から 1 種類の建物数を決める（少しでもあれば 1、大きいほど増やす）
function countForKind(kind, kw) {
  if (!(kw > 0)) return 0;
  const max = KIND_MAX[kind] || 1;
  if (kind === 'lamp') return Math.min(max, kw >= 500 ? 3 : kw >= 60 ? 2 : 1);
  if (kind === 'home') return Math.min(max, kw >= 1000 ? 3 : kw >= 100 ? 2 : 1);
  if (kind === 'shop') return Math.min(max, kw >= 300 ? 2 : 1);
  if (kind === 'factory') return Math.min(max, kw >= 2000 ? 2 : 1);
  return 1;
}

// 受けている需要の種類ごとの量から建物一覧を決める（テスト対象）
export function townBuildings(g, townId) {
  const by = { lamp: 0, home: 0, shop: 0, factory: 0 };
  for (const l of g.loads || []) if (l.town === townId && l.type in by) by[l.type] += l.kw;
  const out = [];
  for (const kind of ['home', 'shop', 'factory', 'lamp']) {
    const n = countForKind(kind, by[kind]);
    for (let i = 0; i < n; i++) {
      out.push({ id: `${kind}${i + 1}`, kind, idx: i, cut: i === 0 && kind !== 'lamp' });
    }
  }
  if (!out.length) out.push({ id: 'home0', kind: 'home', idx: 0, cut: true, empty: true });
  return out.slice(0, MAX_BUILDINGS);
}

// 届いている割合が下がったとき、暗くなる決まった順番（テスト対象）
// 工場 → 商店 → 住宅（後ろから）→ 街灯（後ろから）の優先順。同じ建物一覧なら毎回同じ
const DARK_PRIO = { factory: 0, shop: 1, home: 2, lamp: 3 };
export function darkOrder(buildings) {
  return [...buildings]
    .sort((a, b) => (DARK_PRIO[a.kind] - DARK_PRIO[b.kind]) || (b.idx - a.idx) || a.id.localeCompare(b.id))
    .map((b) => b.id);
}
export function darkSet(buildings, rate) {
  if (rate >= 0.999) return new Set();
  if (rate <= 0.001) return new Set(buildings.map((b) => b.id));
  const ord = darkOrder(buildings);
  const n = Math.min(ord.length, Math.max(1, Math.round((1 - rate) * ord.length)));
  return new Set(ord.slice(0, n));
}

// その町に入ってくる最も高い電圧の線と、完成済みの変圧器
function incomingLine(g, townId, t) {
  const ls = (g.lines || []).filter((l) => l.readyAt <= t && !l.hzTrip && (l.a === townId || l.b === townId));
  if (!ls.length) return null;
  return ls.reduce((best, l) => (Gm.LINES[l.kind].kv > Gm.LINES[best.kind].kv ? l : best), ls[0]);
}

// 町の画面の現在の状態（計算のみ。SVG の生成にも差分更新にも使う）
export function townSceneState(g, townId) {
  const t = g.t;
  const h = ((t % 24) + 24) % 24;
  const n = Gm.nodeOf(g, townId);
  const nightLvl = Mn.nightOf(t); // 1:夜, 0.5:夕・明け, 0:昼
  const era = g.era || 1;
  const loads = (g.loads || []).filter((l) => l.town === townId);
  const st = g.last?.towns?.[townId] || null;
  const black = (g.black?.[townId] || 0) > t;
  const hasLoad = loads.length > 0;
  const rate = !hasLoad ? 0 : black ? 0 : st ? st.r : 1;

  // 需要の種類ごとの今の大きさ（LOADS.shape と季節・制限を反映した loadKw の合計）
  const demandBy = {};
  let totalNow = 0;
  let totalMax = 0;
  for (const k of ['lamp', 'home', 'shop', 'factory']) {
    const ls = loads.filter((l) => l.type === k);
    if (!ls.length) continue;
    const maxKw = ls.reduce((a, l) => a + l.kw, 0);
    const nowKw = ls.reduce((a, l) => a + Gm.loadKw(g, l, t), 0);
    const shape = Gm.LOADS[k].shape[h];
    demandBy[k] = { key: k, name: Gm.LOADS[k].name, nowKw, maxKw, shape, cap: ls.every((l) => l.cap) };
    totalNow += nowKw;
    totalMax += maxKw;
  }
  const servedNow = st ? st.d * st.r : totalNow * rate;

  const line = incomingLine(g, townId, t);
  const lineK = line ? Gm.LINES[line.kind] : null;
  const subs = (g.subs || []).filter((s) => s.town === townId && s.readyAt <= t);
  const subMva = subs.reduce((a, s) => a + s.mva, 0);
  const dcOnly = (!line || lineK.dc) && !subs.length && (g.plants || []).some((p) => p.site === townId && !Gm.PLANTS[p.type].ac);

  const buildings = townBuildings(g, townId);
  const darks = darkSet(buildings, hasLoad ? rate : 0);
  const decors = Gm.decorsOf(g, townId);

  // 出来事と事故
  const weather = Gm.evOn(g, 'snowstorm', t)
    ? 'snow'
    : Gm.evOn(g, 'typhoon', t)
      ? 'storm'
      : Gm.evOn(g, 'heat', t)
        ? 'heat'
        : Gm.evOn(g, 'cold', t)
          ? 'cold'
          : 'clear';
  const lineAlert = !!line && (line.downUntil > t || line.c1Until > t || (g.incidents || []).some((i) => i.line === line.id));
  const subAlert = subs.some((s) => s.downUntil > t || (g.incidents || []).some((i) => i.sub === s.id));

  // 流れの速さ（その町へ入る量に応じて 0.5〜1.8s）
  const flowKw = servedNow;
  const fs = flowKw > 0.1 ? `${Math.max(0.5, 1.7 - Math.min(1.2, Math.log10(1 + flowKw) * 0.28)).toFixed(2)}s` : '0s';

  const structKey = [
    townId,
    era,
    line ? line.kind : dcOnly ? 'dc' : 'none',
    subs.length ? subMva : 0,
    buildings.map((b) => b.id).join(','),
    decors.map((d) => d.kind).join(','),
  ].join('|');

  return {
    townId,
    name: n?.name || townId,
    t,
    h,
    era,
    nightLvl,
    weather,
    line,
    lineK,
    dcOnly,
    subs,
    subMva,
    buildings,
    darks,
    decors,
    demandBy,
    totalNow,
    totalMax,
    servedNow,
    rate,
    black,
    hasLoad,
    lineAlert,
    subAlert,
    fs,
    hasTram: false, // 4章：電鉄の需要はこの版では未追加
    structKey,
  };
}

// 1.4 物を押したときの説明（ゲームの値を入れる）
export function townObjectInfo(g, townId, key) {
  const st = townSceneState(g, townId);
  const base = TOWN_OBJECTS[key];
  if (!base) return null;
  const kw = Gm.fmtKw;
  let title = base.name;
  let text = '';
  switch (key) {
    case 'line':
      title = st.lineK ? `送電線・配電線（${st.lineK.short}）` : '直流配電 200 V';
      text = st.lineK
        ? `この町に入る最も高い電圧の線（${st.lineK.name}・${st.line.km.toFixed(1)} km・${st.line.n}回線）。同じ電力なら電圧が高いほど電流が小さくなり、送電損失（I²R）と電圧降下が減る。`
        : '直流 200 V の配電線で直接届けている。電圧が低いため遠くへ送るほど損失が大きくなる。';
      break;
    case 'sub':
      title = `変電所（合計 ${st.subMva} MVA）`;
      text = `変圧器で ${st.lineK ? `${st.lineK.kv} kV` : '高圧'} を配電の 3.3 kV に下げる。鉄損（容量の 0.5% が常時）と銅損（負荷率の 2 乗）があり、負荷率 58% 前後で効率が最大になる。`;
      break;
    case 'pole':
      text = st.dcOnly
        ? '直流配電の電柱。発電所から 200 V のまま家や街灯へ配っている。'
        : '配電線の 3.3 kV を、家や商店で使う 100 V・200 V に下げる電柱の上の小さな変圧器。';
      break;
    case 'earth':
      text = '柱上変圧器の低圧側の 1 線を地面につなぐ（B種接地）。高圧と低圧の線が混触しても、家側の電圧が上がりすぎないようにする。';
      break;
    case 'lamp':
      text = `電灯の需要（いま ${kw(st.demandBy.lamp?.nowKw || 0)}／契約 ${kw(st.demandBy.lamp?.maxKw || 0)}）。夕方 18〜22 時が山で、夜の町の明るさは届いている電気の量そのもの。`;
      break;
    case 'home':
      text = `住宅の需要（いま ${kw(st.demandBy.home?.nowKw || 0)}／契約 ${kw(st.demandBy.home?.maxKw || 0)}）。朝と夕方〜夜に山がある。一軒ごとの電球や家電が町全体で大きな負荷になる。`;
      break;
    case 'shop':
      text = `町の動力（いま ${kw(st.demandBy.shop?.nowKw || 0)}／契約 ${kw(st.demandBy.shop?.maxKw || 0)}）。昼の 10〜15 時に小さなモータで精米機や工作機械を回し、看板の灯りは夜も使う。`;
      break;
    case 'factory': {
      const f = st.demandBy.factory;
      const pf = f?.cap ? '0.95（進相コンデンサあり）' : '0.75（進相コンデンサで 0.95 に改善可）';
      text = `工場の動力（いま ${kw(f?.nowKw || 0)}／契約 ${kw(f?.maxKw || 0)}、力率 ${pf}）。大きな誘導電動機で軸とベルトを回す。力率が悪いと同じ電力でも線の電流が増えて損失が大きくなる。`;
      break;
    }
    case 'furnace':
      text = '昭和前期ごろから増えた工場の電気炉（電熱）。電気抵抗やアークの熱で金属を溶かし、大きな電力を消費する。';
      break;
    case 'tram':
      text = '架線から直流の電気をとって走る電車（電鉄の版で需要に追加予定）。交流を直流に変える変電所が要る。';
      break;
    case 'decor': {
      const names = st.decors.map((d) => Gm.DECOR[d.kind]?.name).filter(Boolean).join('・');
      title = names ? `記念の建物（${names}）` : '記念の建物';
      text = '収益で建てた町の飾り。性能や需要は変えず、町の景色をにぎやかにする。';
      break;
    }
  }
  return { key, title, text, units: base.units, pic: base.pic || null };
}

// ---- 空の色（時刻＋出来事） ----
export function skyColors(nightLvl, weather) {
  if (weather === 'storm') return nightLvl >= 1 ? ['#0c1222', '#1d283f'] : ['#2d3c52', '#5b6d82'];
  if (weather === 'snow') return nightLvl >= 1 ? ['#121b33', '#2a3754'] : ['#7a94b0', '#c8d6e6'];
  if (weather === 'heat' && nightLvl < 1) return nightLvl === 0.5 ? ['#5e3552', '#f09454'] : ['#4e8fd6', '#f2d9b3'];
  if (weather === 'cold' && nightLvl < 1) return nightLvl === 0.5 ? ['#28365c', '#8ea8cf'] : ['#5688bf', '#d4e9fa'];
  if (nightLvl >= 1) return ['#0b1430', '#1b2550'];
  if (nightLvl === 0.5) return ['#3b3a6e', '#e79a6b'];
  return ['#6fa8dc', '#cfe6f5'];
}

// 4章：電鉄の準備部品（架線・電車・線路）。hasTram が真のときだけ描く
export function tramSvg({ running = false, night = false } = {}) {
  const wins = [22, 48, 74, 100]
    .map((x) => `<rect x="${x}" y="302" width="20" height="12" rx="1.5" fill="${running ? '#ffd36b' : '#25304d'}"/>`)
    .join('');
  return `<g class="ttram" data-k="tram">
    <path d="M0 262 H900" stroke="#c9cfdb" stroke-width="1"/>
    <g class="${running ? 'ttram-run' : ''}" style="${running ? '' : 'transform:translateX(360px)'}">
      <path d="M70 296 L92 263" stroke="#2a2f3a" stroke-width="2.5"/>
      ${running ? '<circle cx="92" cy="263" r="4.5" fill="#bfe3ff" class="tspark"/>' : ''}
      <rect x="12" y="296" width="126" height="34" rx="7" fill="#2f7a5f"/>
      <rect x="12" y="320" width="126" height="10" fill="#235c48"/>
      ${wins}
      <circle cx="38" cy="334" r="6" fill="#222"/><circle cx="112" cy="334" r="6" fill="#222"/>
    </g>
    <path d="M0 340 H900" stroke="#6b5a42" stroke-width="3"/>
  </g>`;
}

// 建物の稼働判定（明暗・速度）
function buildingStatus(st, b) {
  if (b.empty || !st.hasLoad) return { lit: false, run: false, gs: '0s' };
  const isDark = st.darks.has(b.id);
  const N = st.nightLvl > 0;
  const f = st.demandBy[b.kind]?.shape ?? 0;
  if (b.kind === 'lamp') return { lit: !isDark && f > 0, run: false, gs: '0s' };
  if (b.kind === 'home') return { lit: !isDark && (N || st.h <= 7) && f >= 0.15, run: false, gs: '0s' };
  if (b.kind === 'shop') {
    const run = !isDark && f >= 0.4;
    const lit = !isDark && (run || N);
    return { lit, run, gs: run ? (f >= 1 ? '1.3s' : '2.2s') : '0s' };
  }
  if (b.kind === 'factory') {
    const run = !isDark && f >= 0.5;
    const slow = !isDark && f > 0;
    return { lit: slow, run, gs: f >= 1 ? '1.8s' : f >= 0.5 ? '3.4s' : slow ? '7s' : '0s' };
  }
  return { lit: false, run: false, gs: '0s' };
}

// 建物の配置 X 座標を左から右に並べる（電柱 255 以降〜880 の間に収める）
function layoutBuildings(buildings) {
  const widths = { home: 76, shop: 92, factory: 168, lamp: 26 };
  const main = buildings.filter((b) => b.kind !== 'lamp');
  const lamps = buildings.filter((b) => b.kind === 'lamp');
  const out = [];
  const startX = 248, endX = 880;
  const totalW = main.reduce((a, b) => a + widths[b.kind], 0);
  const gap = main.length > 1 ? Math.max(4, Math.min(18, (endX - startX - totalW) / (main.length - 1))) : 0;
  let x = startX;
  for (const b of main) {
    const w = widths[b.kind];
    if (x + w > endX) x = Math.max(startX, endX - w);
    out.push({ ...b, x: Math.round(x), w });
    x += w + gap;
  }
  // 街灯は通り沿いに等間隔
  const lampXs = lamps.length === 1 ? [540] : lamps.length === 2 ? [340, 740] : [265, 550, 845];
  lamps.forEach((b, i) => out.push({ ...b, x: lampXs[i] ?? 845, w: 26 }));
  return out;
}

const winRect = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" class="twin"/>`;

// ---- 案1 の SVG 生成 ----
export function townSvgHtml(st) {
  const [s0, s1] = skyColors(st.nightLvl, st.weather);
  const N = st.nightLvl > 0;
  const snow = st.weather === 'snow';
  const storm = st.weather === 'storm';
  const flowing = st.fs !== '0s' && st.rate > 0;
  const placed = layoutBuildings(st.buildings);

  let s = `<defs>
    <linearGradient id="tsk" x2="0" y2="1"><stop data-sk0 offset="0" stop-color="${s0}"/><stop data-sk1 offset="1" stop-color="${s1}"/></linearGradient>
    <radialGradient id="thalo"><stop offset="0" stop-color="#ffd36b" stop-opacity=".5"/><stop offset="1" stop-color="#ffd36b" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="900" height="380" fill="url(#tsk)"/>
  <g data-stars style="display:${N && !storm ? '' : 'none'}">${Array.from({ length: 24 }, (_, i) => `<circle cx="${(i * 137 + 19) % 900}" cy="${(i * 53 + 11) % 115 + 8}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff" opacity=".7"/>`).join('')}</g>
  <path data-hills d="M0 212 L120 154 L230 202 L360 146 L520 206 L660 152 L780 192 L900 162 V300 H0Z" fill="${N ? '#1a2242' : '#8fb3c9'}" opacity=".8"/>
  <rect data-ground y="300" width="900" height="80" fill="${N ? '#2a2418' : '#7a6448'}"/>
  <rect data-road y="300" width="900" height="6" fill="${snow ? '#dde7f2' : N ? '#3b3322' : '#9b8462'}"/>
  <text x="890" y="372" text-anchor="end" font-size="11" fill="#fff" opacity=".6">地面の下（接地）</text>`;

  // 記念の建物（版B）があれば遠景の丘の前に並べる
  if (st.decors.length) {
    s += `<g data-k="decor">${st.decors
      .map((d, i) => `<g transform="translate(${295 + i * 110},200) scale(2.1)">${Art.DECOR_SHAPE[d.kind] || ''}</g>`)
      .join('')}</g>`;
  }

  // 入ってくる線（あれば）
  const lineEndX = st.subs.length ? 150 : 252;
  const lineEndY = st.subs.length ? 180 : 196;
  if (st.line || st.dcOnly) {
    const isHv = st.lineK && st.lineK.kv >= 66;
    const label = st.lineK ? st.lineK.short : '直流 200 V';
    s += `<g data-k="line" class="tobj"><rect x="8" y="56" width="112" height="248" fill="transparent"/>
      ${isHv
        ? '<path d="M44 300 L62 68 L80 300 M49 230 H75 M54 170 H70 M57 120 H67 M44 300 L75 230 M80 300 L49 230 M49 230 L70 170 M75 230 L54 170" stroke="#9aa4bd" stroke-width="2.4" fill="none"/><path d="M38 92 H86 M42 114 H82" stroke="#9aa4bd" stroke-width="2.4"/>'
        : '<rect x="58" y="100" width="8" height="200" fill="#6b5138"/><path d="M38 112 H86 M42 132 H82" stroke="#6b5138" stroke-width="4"/>'}
      ${[isHv ? 92 : 112, isHv ? 114 : 132]
        .map(
          (y) =>
            `<path d="M0 ${y + 6} Q28 ${y + 14} 42 ${y}" stroke="#c9cfdb" stroke-width="1.3" fill="none"/>
             <path d="M84 ${y} Q116 ${y + 24} ${lineEndX} ${lineEndY + (y - 100) * 0.25}" stroke="#c9cfdb" stroke-width="1.3" fill="none"/>
             <path data-flow d="M84 ${y} Q116 ${y + 24} ${lineEndX} ${lineEndY + (y - 100) * 0.25}" stroke="#ffd36b" stroke-width="2" fill="none" class="tflow" style="--fs:${st.fs};display:${flowing ? '' : 'none'}"/>`,
        )
        .join('')}
      <text x="62" y="52" text-anchor="middle" font-size="12" fill="#fff">${label}</text>
      <g data-lalert style="display:${st.lineAlert ? '' : 'none'}"><circle cx="96" cy="78" r="11" fill="#e8452c"/><text x="96" y="83" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">!</text></g>
    </g>`;
  }

  // 変電所（あれば）
  if (st.subs.length) {
    const vText = st.lineK && st.lineK.kv >= 11 ? `${st.lineK.kv}→3.3 kV` : '変圧器';
    s += `<g data-k="sub" class="tobj"><rect x="128" y="168" width="108" height="136" fill="transparent"/>
      <path d="M134 300 V214 M228 300 V214 M134 214 H228" stroke="#6b7793" stroke-width="2" stroke-dasharray="3 3"/>
      <rect x="148" y="232" width="34" height="56" rx="3" fill="#5c6680"/>
      <rect x="188" y="242" width="28" height="46" rx="3" fill="#56607a"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${150 + i * 8}" y="236" width="4" height="48" fill="#46506a"/>`).join('')}
      <path d="M156 232 V196 M168 232 V196 M195 242 V212 M208 242 V212" stroke="#c9cfdb" stroke-width="2"/>
      <text x="181" y="320" text-anchor="middle" font-size="11.5" fill="#fff">変電所 ${st.subMva} MVA</text>
      <text x="181" y="334" text-anchor="middle" font-size="10.5" fill="#cfd6e8">${vText}</text>
      <g data-salert style="display:${st.subAlert ? '' : 'none'}"><circle cx="222" cy="192" r="11" fill="#e8452c"/><text x="222" y="197" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">!</text></g>
    </g>`;
  }

  // 電柱・配電線・柱上変圧器・接地
  const poles = [255, 465, 680, 875];
  const wireStart = st.subs.length ? 'M208 212 Q232 198 255 196' : 'M255 196';
  const wireD = `${wireStart} ${poles.slice(1).map((x) => `L${x} 196`).join(' ')}`;
  s += `<path d="${wireD}" stroke="#c9cfdb" stroke-width="1.4" fill="none"/>
    <path data-flow d="${wireD}" stroke="#ffd36b" stroke-width="2" fill="none" class="tflow" style="--fs:${st.fs};display:${flowing ? '' : 'none'}"/>`;
  poles.forEach((px, i) => {
    const isTr = i === 1;
    s += `<g ${isTr ? 'data-k="pole" class="tobj"' : ''}>
      <rect x="${px - 3}" y="190" width="6" height="112" fill="#5a4630"/>
      <path d="M${px - 15} 196 H${px + 15}" stroke="#5a4630" stroke-width="3.6"/>
      ${isTr
        ? `<rect x="${px - 26}" y="186" width="58" height="72" fill="transparent"/>
           ${st.dcOnly ? '' : `<rect x="${px + 5}" y="210" width="16" height="24" rx="4" fill="#7f8aa3"/><path d="M${px + 13} 210 V197" stroke="#c9cfdb" stroke-width="1.5"/>`}
           <path d="M${px} 300 V346 M${px - 8} 346 H${px + 8}" stroke="#7fd18b" stroke-width="2" stroke-dasharray="4 3"/>
           <text x="${px + 24}" y="184" font-size="11" fill="#fff">${st.dcOnly ? '直流配電' : '柱上変圧器'}</text>`
        : ''}
    </g>`;
  });
  s += '<g data-k="earth" class="tobj"><rect x="438" y="300" width="56" height="62" fill="transparent"/></g>';

  // 建物（時代で形を少し変える：E4 以上は平屋根ビルや大きな工場）
  const modern = st.era >= 4;
  for (const b of placed) {
    const bs = buildingStatus(st, b);
    const cls = `tobj tb ${bs.lit ? 'tlit' : 'tdark'}${bs.run ? ' trun' : ''}`;
    if (b.kind === 'home') {
      const flat = modern && !b.cut;
      const x = b.x;
      s += `<g data-k="home" data-bid="${b.id}" class="${cls}">
        <rect x="${x}" y="218" width="76" height="84" fill="transparent"/>
        <circle cx="${x + 38}" cy="262" r="42" fill="url(#thalo)" class="thalo"/>
        ${flat
          ? `<rect x="${x + 4}" y="224" width="68" height="78" fill="#596378"/><rect data-snowroof x="${x + 4}" y="220" width="68" height="5" fill="#e5eef8" style="display:${snow ? '' : 'none'}"/>`
          : `<path d="M${x - 5} 252 L${x + 38} 222 L${x + 81} 252Z" fill="${snow ? '#dce7f2' : '#6b4a36'}" data-roof/><rect x="${x}" y="252" width="76" height="50" fill="#8b6b4d"/>`}
        ${b.cut
          ? `<rect x="${x + 6}" y="258" width="40" height="40" class="troom"/><path d="M${x + 26} 258 V268" stroke="#999" stroke-width="1"/><circle cx="${x + 26}" cy="271" r="4" class="tbulb"/><rect x="${x + 13}" y="286" width="26" height="5" fill="#2a2018"/>${winRect(x + 52, 262, 16, 16)}`
          : flat
            ? `${winRect(x + 12, 236, 14, 14)}${winRect(x + 31, 236, 14, 14)}${winRect(x + 50, 236, 14, 14)}${winRect(x + 12, 260, 14, 14)}${winRect(x + 31, 260, 14, 14)}${winRect(x + 50, 260, 14, 14)}`
            : `${winRect(x + 10, 262, 18, 16)}${winRect(x + 48, 262, 18, 16)}`}
      </g>`;
    } else if (b.kind === 'shop') {
      const x = b.x;
      s += `<g data-k="shop" data-bid="${b.id}" class="${cls}" style="--gs:${bs.gs}">
        <rect x="${x}" y="212" width="92" height="90" fill="transparent"/>
        <rect x="${x + 2}" y="224" width="88" height="78" fill="${modern ? '#687082' : '#8a765c'}"/>
        <rect x="${x - 1}" y="216" width="94" height="9" fill="${snow ? '#dce7f2' : '#2b2433'}" data-roof/>
        <rect x="${x + 12}" y="232" width="68" height="13" rx="3" class="tsign"/>
        ${b.cut
          ? `<rect x="${x + 8}" y="252" width="48" height="46" class="troom"/>
             <g transform="translate(${x + 32} 276)"><circle r="11" fill="#6b7793"/><g class="tgear"><path d="M0 -9 V9 M-9 0 H9 M-6 -6 L6 6 M-6 6 L6 -6" stroke="#d7dce8" stroke-width="2.2"/></g></g>
             ${winRect(x + 62, 256, 20, 18)}`
          : `${winRect(x + 12, 256, 22, 18)}${winRect(x + 56, 256, 22, 18)}`}
      </g>`;
    } else if (b.kind === 'factory') {
      const x = b.x;
      const big = modern;
      s += `<g data-k="factory" data-bid="${b.id}" class="${cls}" style="--gs:${bs.gs}">
        <rect x="${x}" y="146" width="168" height="156" fill="transparent"/>
        <rect x="${x + 138}" y="154" width="16" height="96" fill="#5b4a46"/>
        ${big ? `<rect x="${x + 118}" y="164" width="14" height="86" fill="#524340"/>` : ''}
        <g class="tsmokes">${[0, 1, 2].map((i) => `<circle cx="${x + 146}" cy="150" r="8" fill="#cfd3dc" class="tsmoke" style="animation-delay:${(i * 1.05).toFixed(2)}s"/>`).join('')}</g>
        <path d="M${x + 2} 226 L${x + 34} 204 V226 L${x + 66} 204 V226 L${x + 98} 204 V226 L${x + 130} 204 V226 L${x + 164} 226 V302 H${x + 2}Z" fill="${snow ? '#c8d4e0' : '#706862'}" data-roof/>
        <rect x="${x + 10}" y="236" width="114" height="62" class="troom"/>
        <path d="M${x + 18} 246 H${x + 116}" stroke="#8a8f9c" stroke-width="2.8"/>
        ${[34, 72, 106]
          .map(
            (dx) =>
              `<g transform="translate(${x + dx} 246)"><g class="tgear"><circle r="6.5" fill="none" stroke="#c9cfdb" stroke-width="2.8" stroke-dasharray="3 2"/></g></g>
               <path d="M${x + dx - 5} 246 L${x + dx - 5} 284 M${x + dx + 5} 246 L${x + dx + 5} 284" stroke="#6d5b45" stroke-width="1.8"/>
               <rect x="${x + dx - 10}" y="282" width="20" height="12" fill="#596276"/>`,
          )
          .join('')}
        <g transform="translate(${x + 42} 290)"><rect x="-12" y="-10" width="24" height="12" rx="3" fill="#2f6d8f"/><g class="tgear"><circle cx="0" cy="-4" r="3.6" fill="none" stroke="#e8ecf6" stroke-width="1.5" stroke-dasharray="2 1.5"/></g></g>
        ${big ? `<g data-k="furnace" class="tobj"><rect x="${x + 88}" y="264" width="24" height="24" rx="4" fill="#7a3222"/><circle cx="${x + 100}" cy="276" r="5" class="tbulb"/></g>` : ''}
        <rect x="${x + 126}" y="282" width="38" height="20" fill="#2b2b30"/>
        <g class="tboxes">${[0, 1].map((i) => `<rect x="${x + 128}" y="286" width="9" height="8" fill="#c08a4a" class="tbox" style="animation-delay:${i * 2}s"/>`).join('')}</g>
        <text x="${x + 84}" y="322" text-anchor="middle" font-size="11" fill="#fff">工場</text>
      </g>`;
    } else if (b.kind === 'lamp') {
      const x = b.x;
      s += `<g data-k="lamp" data-bid="${b.id}" class="${cls}">
        <rect x="${x - 12}" y="232" width="26" height="72" fill="transparent"/>
        <circle cx="${x + 6}" cy="246" r="28" fill="url(#thalo)" class="thalo"/>
        <path d="M${x} 302 V244 H${x + 8}" stroke="#3a3f4d" stroke-width="3" fill="none"/>
        <circle cx="${x + 9}" cy="246" r="4.5" class="tbulb"/>
      </g>`;
    }
  }

  // 電鉄（4章：今は hasTram = false のため描かない）
  if (st.hasTram) s += tramSvg({ running: st.rate >= 0.5, night: N });

  // 天気の層（大雪・台風）
  s += `<g data-snow style="display:${snow ? '' : 'none'}" pointer-events="none">${Array.from(
    { length: 22 },
    (_, i) => `<circle cx="${(i * 43 + 17) % 900}" cy="${(i * 29) % 260}" r="${i % 2 ? 2 : 3}" fill="#fff" opacity=".8" class="tsnowf" style="animation-delay:-${(i * 0.37).toFixed(2)}s"/>`,
  ).join('')}</g>`;
  s += `<g data-storm style="display:${storm ? '' : 'none'}" pointer-events="none">${Array.from(
    { length: 24 },
    (_, i) => `<line x1="${(i * 41 + 11) % 900}" y1="${(i * 23) % 220}" x2="${((i * 41 + 11) % 900) - 12}" y2="${((i * 23) % 220) + 26}" stroke="#b8d0ec" stroke-width="1.4" opacity=".7" class="trainf" style="animation-delay:-${(i * 0.19).toFixed(2)}s"/>`,
  ).join('')}</g>`;

  // 停電バナー
  const msg = !st.hasLoad ? '' : st.black || st.rate <= 0.001 ? '全域停電：町じゅうが止まっている' : st.rate < 0.999 ? '一部が停電：暗い建物・止まった機械がある' : '';
  s += `<text data-banner x="450" y="28" text-anchor="middle" font-size="14" font-weight="700" fill="#ff8a7a" style="display:${msg ? '' : 'none'}">${msg}</text>`;
  return s;
}

// 1.3 差分更新：構成（structKey）が同じなら SVG を作り直さず属性だけ変えて動きを途切れさせない
export function patchTownSvg(svg, st) {
  if (!svg) return false;
  if (svg.dataset.sk !== st.structKey) {
    svg.dataset.sk = st.structKey;
    svg.innerHTML = townSvgHtml(st);
    return true;
  }
  const [s0, s1] = skyColors(st.nightLvl, st.weather);
  const N = st.nightLvl > 0;
  const snow = st.weather === 'snow';
  const storm = st.weather === 'storm';
  const flowing = st.fs !== '0s' && st.rate > 0;
  svg.querySelector('[data-sk0]')?.setAttribute('stop-color', s0);
  svg.querySelector('[data-sk1]')?.setAttribute('stop-color', s1);
  const stars = svg.querySelector('[data-stars]');
  if (stars) stars.style.display = N && !storm ? '' : 'none';
  svg.querySelector('[data-hills]')?.setAttribute('fill', N ? '#1a2242' : '#8fb3c9');
  svg.querySelector('[data-ground]')?.setAttribute('fill', N ? '#2a2418' : '#7a6448');
  svg.querySelector('[data-road]')?.setAttribute('fill', snow ? '#dde7f2' : N ? '#3b3322' : '#9b8462');
  svg.querySelectorAll('[data-flow]').forEach((el) => {
    el.style.setProperty('--fs', st.fs);
    el.style.display = flowing ? '' : 'none';
  });
  const la = svg.querySelector('[data-lalert]');
  if (la) la.style.display = st.lineAlert ? '' : 'none';
  const sa = svg.querySelector('[data-salert]');
  if (sa) sa.style.display = st.subAlert ? '' : 'none';
  const sn = svg.querySelector('[data-snow]');
  if (sn) sn.style.display = snow ? '' : 'none';
  const sr = svg.querySelector('[data-storm]');
  if (sr) sr.style.display = storm ? '' : 'none';
  for (const b of st.buildings) {
    const el = svg.querySelector(`[data-bid="${b.id}"]`);
    if (!el) continue;
    const bs = buildingStatus(st, b);
    el.classList.toggle('tlit', bs.lit);
    el.classList.toggle('tdark', !bs.lit);
    el.classList.toggle('trun', bs.run);
    if (bs.gs) el.style.setProperty('--gs', bs.gs);
  }
  const bn = svg.querySelector('[data-banner]');
  if (bn) {
    const msg = !st.hasLoad ? '' : st.black || st.rate <= 0.001 ? '全域停電：町じゅうが止まっている' : st.rate < 0.999 ? '一部が停電：暗い建物・止まった機械がある' : '';
    bn.textContent = msg;
    bn.style.display = msg ? '' : 'none';
  }
  return false;
}
