// 動く系統（1.5.0）の計算。画面や保存に依存しない部分
// 仕様：要件定義書 4.11、設計図 1.11。数値の正本は 試作/系統ゲーム_設計_v1.md
// 単位：電力 kW、電力量 kWh（1刻み＝ゲームの1時間）、お金は収益（円）。学習通貨の支出は呼び出し側が台帳に書く
import * as L from './logic.js';
import { JAPAN_NODES } from './japan.js';
import * as J from './gridjapan.js';

// ---- 時間 ----
export const HOUR_MS = 150000; // ゲームの1時間＝現実の2.5分（1日＝1時間）
export const SEASON_DAYS = 168; // 季節＝現実の1週間
export const YEAR_DAYS = 672; // 1年＝現実の4週間
export const MONTH_DAYS = 30; // 「1か月」「30日」の効果の長さ
export const MAX_CATCHUP = 14 * 24 * 24; // 閉じていた分は現実の14日（8,064 刻み）まで
export const SEASONS = ['春', '夏', '秋', '冬'];
export const seasonOf = (t) => Math.floor(t / (24 * SEASON_DAYS)) % 4;
export const yearOf = (t) => Math.floor(t / (24 * YEAR_DAYS));

// ---- 時代（学習のレベルで進む）。1.5.0 は E4 まで。E5・E6 は表だけ ----
export const ERAS = [
  { n: 1, id: 'E1', name: '明治前期', year: '1887〜', level: 1 },
  { n: 2, id: 'E2', name: '明治後期', year: '1891〜', level: 3 },
  { n: 3, id: 'E3', name: '大正', year: '1912〜', level: 7 },
  { n: 4, id: 'E4', name: '昭和前期', year: '1926〜', level: 12 },
  { n: 5, id: 'E5', name: '高度成長', year: '1955〜', level: 20 },
  { n: 6, id: 'E6', name: '現代', year: '', level: 30 },
];
export const MAX_ERA = 4;
export function eraOf(level) {
  let n = 1;
  for (const e of ERAS) if (level >= e.level && e.n <= MAX_ERA) n = e.n;
  return n;
}

// ---- 電源（設計 3章）。sizes：[出力 kW, 建設費（学習通貨）, 追加の条件] ----
export const PLANTS = {
  dcCoal: { name: '直流の石炭火力', short: '直流火力', era: 1, ac: false, coal: true, eff: [0.05, 0.1], start: 4, min: 0.3, bs: true, build: 24, gates: ['dc'], perf: 'dc', at: 'town', sizes: [[25, 3000], [50, 4000], [100, 5500], [200, 8000]] },
  acCoal: { name: '石炭火力（汽力・交流）', short: '石炭火力', era: 2, ac: true, coal: true, eff: [0.08, 0.18], start: 6, min: 0.3, bs: true, build: 72, gates: ['gen', 'coal'], perf: 'coal', at: 'coal', sizes: [[500, 15000], [1000, 18000], [2000, 24000], [5000, 40000]] },
  bigCoal: { name: '大型の石炭火力（高圧ボイラ）', short: '大型火力', era: 4, ac: true, coal: true, eff: [0.15, 0.28], start: 12, min: 0.4, bs: false, build: 240, gates: ['gen', 'coal'], perf: 'coal', at: 'bigcoal', blueprint: 'bigCoal', sizes: [[20000, 80000], [40000, 125000], [75000, 200000]] },
  ror: { name: '流れ込み式の水力', short: '水力（流れ込み）', era: 2, ac: true, coal: false, start: 0, min: 0, bs: true, build: 120, gates: ['gen', 'hydro'], perf: 'hydro', at: 'hydro', sizes: [[200, 20000], [500, 27000], [1000, 38000], [2000, 60000], [5000, 80000, { era: 3 }], [10000, 105000, { era: 3 }], [20000, 150000, { era: 3 }]] },
  pond: { name: '調整池式の水力', short: '水力（調整池）', era: 3, ac: true, coal: false, start: 0, min: 0, bs: true, build: 240, gates: ['gen', 'hydro'], perf: 'hydro', at: 'pond', sizes: [[5000, 60000], [10000, 76000], [20000, 107000], [50000, 200000, { blueprint: 'pond50' }]] },
};
export const POND_HOURS = 6; // 池の大きさ＝出力の6時間分。1日に入る水も同じ量（流量 1.0 のとき）

// ---- 送電・配電（設計 4章）。cap：1回線で送れる量 kW、r：Ω/km、cost：学習通貨/km ----
export const LINES = {
  dc200: { name: '直流の配電 200 V', short: '直流 200 V', kv: 0.2, cap: 50, r: 0.1, cost: 100, era: 1, dc: true, gates: ['dc'], perf: 'dc' },
  // 1.6.0：距離が実寸（日本列島）になったので、km あたりの建設費を下げた（史実の主な線が、その時代の大きな発電所1つ分くらい）
  ac3: { name: '高圧配電 3.3 kV', short: '3.3 kV', kv: 3.3, cap: 1000, r: 0.3, cost: 150, era: 2, gates: ['dist'], perf: 'dist' },
  ac11: { name: '送電 11 kV', short: '11 kV', kv: 11, cap: 3000, r: 0.3, cost: 250, era: 2, hv: true, gates: ['line'], perf: 'line' },
  ac22: { name: '送電 22 kV', short: '22 kV', kv: 22, cap: 6000, r: 0.2, cost: 350, era: 2, hv: true, gates: ['line'], perf: 'line' },
  ac66: { name: '送電 66 kV', short: '66 kV', kv: 66, cap: 30000, r: 0.1, cost: 800, era: 2, level: 5, hv: true, gates: ['line'], perf: 'line' },
  // 1.6.0：大正の 110 kV（猪苗代の 115 kV を表す）。55 kV（駒橋）・77 kV（谷村）は 66 kV で表す
  ac110: { name: '送電 110 kV', short: '110 kV', kv: 110, cap: 70000, r: 0.07, cost: 1000, era: 3, hv: true, gates: ['line'], perf: 'line' },
  ac154: { name: '送電 154 kV', short: '154 kV', kv: 154, cap: 150000, r: 0.05, cost: 1200, era: 4, hv: true, gates: ['line'], perf: 'line', blueprint: 'line154' },
};
export const MAX_CIRCUITS = 4;
// 建設のときに足せる対策（費用 +20% ずつ）
export const LINE_OPTS = {
  gw: { name: '架空地線', hazard: 'thunder', k: 0.5, gates: ['insul'] },
  insul: { name: '耐塩がいし', hazard: 'coast', k: 0.7, gates: ['insul'] },
  spacer: { name: '相間スペーサ', hazard: 'snow', k: 0.5, gates: ['insul'] },
  petersen: { name: '消弧リアクトル', hazard: null, k: 0.6, era: 4, gates: ['prot'], blueprint: 'petersen' },
};
// 1.6.1 後付けの対策：既設の線に後から足す。費用は建設のときに足す場合（線の費用の 20%・回線の数だけ）の RETRO_K 倍（後から工事するぶん割増）。
// 工期は線の建設と同じ式。工事の間も線は止めない（1回線ずつ・短い停止で済む工事とみなす）。効くのは工事が終わってから（l.optAt）
export const OPT_K = 0.2;
export const RETRO_K = 1.3;
export const optOn = (l, o, t) => !!l.opts?.[o] && !(l.optAt?.[o] > t);
export const HAZARD = { thunder: { name: '雷の多い地域', k: 2 }, coast: { name: '海沿い（塩害）', k: 1.5 }, snow: { name: '雪の山（冬）', k: 2 } };
export const SUB_SIZES = [0.1, 0.5, 1, 2, 5, 10, 30, 100]; // MVA
export const subCost = (mva) => Math.max(2000, Math.round(mva * 1000));
export const TR = { iron: 0.005, copper: 0.015, era: 2, build: 24, gates: ['tr'], perf: 'tr' };
export const CAP_COST = (kw) => Math.max(500, Math.round(kw * 3)); // 進相コンデンサ

// ---- 需要（設計 5章） ----
const H24 = (f) => Array.from({ length: 24 }, (_, h) => f(h));
export const LOADS = {
  lamp: { name: '電灯', rate: 30, era: 1, pf: 1, winter: 1.15, shape: H24((h) => (h >= 18 && h <= 22 ? 1 : h === 17 || h === 23 ? 0.6 : h <= 4 ? 0.15 : h === 5 ? 0.1 : 0)) },
  home: { name: '住宅', rate: 25, era: 2, pf: 1, winter: 1.15, shape: H24((h) => (h >= 18 && h <= 21 ? 1 : h === 6 || h === 7 ? 0.7 : h === 17 || h === 22 ? 0.6 : h >= 8 && h <= 16 ? 0.3 : 0.15)) },
  shop: { name: '町の動力', rate: 22, era: 2, pf: 1, winter: 1, shape: H24((h) => (h >= 10 && h <= 15 ? 1 : h === 9 || h === 16 ? 0.7 : h === 8 || h === 17 ? 0.4 : 0.1)) },
  factory: { name: '工場（動力）', rate: 18, era: 3, pf: 0.75, pfFixed: 0.95, winter: 1, shape: H24((h) => (h >= 8 && h <= 16 ? 1 : h === 7 || h === 17 ? 0.5 : 0.15)) },
};
const LOAD_MIX = { 1: { lamp: 1 }, 2: { lamp: 4, home: 3, shop: 3 }, 3: { lamp: 2, home: 3, shop: 2, factory: 3 }, 4: { lamp: 2, home: 3, shop: 2, factory: 3 } };
export const peakHour = (type) => LOADS[type].shape.indexOf(Math.max(...LOADS[type].shape));
const tanOf = (pf) => Math.sqrt(1 / (pf * pf) - 1);

// 需要の上限 D_max（kW）：学習で決まる。お金では増えない
export function dmaxKw(level, mastered) {
  return 30 * Math.pow(1.4, level - 1) * (1 + mastered / 100);
}

// ---- 学習との結びつき（設計 6章） ----
// GATES：建設できる＝どれかの単元で1問正解。PERF：性能の単元（定着の割合の平均、これまでの最大値）
export const GATES = {
  dc: ['denken3-riron-U03', 'circuit-b-U09'],
  gen: ['circuit-b-U01', 'circuit-b-U02', 'circuit-b-U03', 'denken3-riron-U05'],
  tr: ['circuit-b-U14', 'denken3-denryoku-U05'],
  coal: ['denken3-denryoku-U02', 'denken2-denryoku-U02'],
  hydro: ['denken3-denryoku-U01', 'denken2-denryoku-U01'],
  line: ['denken3-denryoku-U06', 'denken2-denryoku-U06'],
  dist: ['denken3-denryoku-U07'],
  freq: ['power-system-U02', 'power-system-U03'],
  econ: ['power-system-U05'],
  prot: ['denken3-denryoku-U09'],
  insul: ['denken3-denryoku-U10', 'denken3-denryoku-U06'],
  pf: ['circuit-b-U11'],
  rel: ['power-system-U12'],
};
export const PERF = {
  dc: ['denken3-riron-U03'],
  gen: ['circuit-b-U13', 'power-system-U03'],
  tr: ['denken3-denryoku-U05', 'denken2-denryoku-U05'],
  coal: ['denken3-denryoku-U02', 'denken2-denryoku-U02'],
  hydro: ['denken3-denryoku-U01', 'denken2-denryoku-U01'],
  line: ['denken3-denryoku-U06', 'power-system-U07'],
  dist: ['denken3-denryoku-U07'],
  freq: ['power-system-U02', 'power-system-U03', 'power-system-U04', 'control-1-U08'],
  econ: ['power-system-U05', 'power-system-U06'],
  prot: ['denken3-denryoku-U09', 'denken2-denryoku-U09'],
  insul: ['denken3-denryoku-U10'],
  pf: ['circuit-b-U11', 'denken3-riron-U04'],
  rel: ['power-system-U12', 'power-system-U13', 'power-system-U14'],
};
export const GATE_NAMES = { dc: '直流の配電・発電所', gen: '交流発電機（三相）', tr: '変圧器・変電所', coal: '石炭火力', hydro: '水力', line: '送電線', dist: '配電（3.3 kV）', freq: '周波数・ガバナ・予備力', econ: '給電の優先順位', prot: '保護', insul: 'がいし・架空地線・相間スペーサ', pf: '進相コンデンサ', rel: '信頼度' };
// 設計図（大型・特殊）：その単元の試験レベルに正解、または関係する外部試験の科目で取れる点が満点の3割以上
export const BLUEPRINTS = {
  bigCoal: { name: '大型の石炭火力', units: ['denken2-denryoku-U02'] },
  pond50: { name: '調整池式 50 MW', units: ['denken2-denryoku-U01'] },
  line154: { name: '送電線 154 kV', units: ['denken2-denryoku-U06'] },
  petersen: { name: '消弧リアクトル', units: ['denken2-denryoku-U09'] },
};

// 学習の状況（レベル・時代・需要の上限・建設できるか・性能・設計図）。saved：性能の「これまでの最大値」（保存してある分）
export function learning(logs, data, saved = {}) {
  const active = L.activeQuestions(data);
  const unitsOf = (q) => [q.unitId, ...(q.subUnitIds || [])];
  const correct = L.correctIdSet(logs);
  const unitCorrect = new Set();
  const examCorrect = new Set();
  const unitTotal = new Map();
  const qUnit = new Map();
  for (const q of active) {
    unitTotal.set(q.unitId, (unitTotal.get(q.unitId) || 0) + 1);
    qUnit.set(q.questionId, q.unitId);
    if (!correct.has(q.questionId)) continue;
    for (const u of unitsOf(q)) {
      unitCorrect.add(u);
      if (q.level === '試験') examCorrect.add(u);
    }
  }
  // 性能：単元ごとの定着の割合の、これまでの最大値（記録を古い順にたどる）
  const cur = new Map();
  const best = new Map();
  let mastered = 0;
  const prog = L.questionProgress(logs, (l, p) => {
    const u = qUnit.get(l.questionId);
    if (!u) return;
    if (!cur.has(u)) cur.set(u, new Set());
    const set = cur.get(u);
    if (p.mastered) set.add(l.questionId);
    else set.delete(l.questionId);
    best.set(u, Math.max(best.get(u) || 0, set.size / unitTotal.get(u)));
  });
  for (const q of active) if (prog.get(q.questionId)?.mastered) mastered++;
  const perf = {};
  for (const [k, units] of Object.entries(PERF)) {
    const p = units.reduce((a, u) => a + (best.get(u) || 0), 0) / units.length; // 問題のない単元は 0
    perf[k] = Math.max(saved[k] || 0, p);
  }
  const gate = {};
  for (const [k, units] of Object.entries(GATES)) gate[k] = units.some((u) => unitCorrect.has(u));
  // 設計図：外部試験の点（その単元の科目の問題が属する年度・科目のどれかで3割以上）
  const scores = new Map(L.examScores(data, logs).map((r) => [r.key, r]));
  const blueprint = {};
  for (const [k, b] of Object.entries(BLUEPRINTS)) {
    const subjects = new Set(b.units.map((u) => u.replace(/-U\d+$/, '')));
    const papers = new Set(active.filter((q) => q.examItem && subjects.has(q.subjectId)).map((q) => L.paperKey(q.examItem)));
    blueprint[k] = b.units.some((u) => examCorrect.has(u)) || [...papers].some((key) => scores.get(key) && scores.get(key).got >= 0.3 * scores.get(key).full);
  }
  const level = L.levelInfo(L.coinTotals(L.coinEvents(logs, data)).total).level;
  const incidentQs = new Set(L.gameQuestions(data).map((q) => q.questionId));
  return { level, era: eraOf(level), mastered, dmax: dmaxKw(level, mastered), gate, perf, blueprint, incidentQs };
}
// テストや仮の表示用：何も学習していない状態
export function blankLearning(over = {}) {
  const f = (o, v) => Object.fromEntries(Object.keys(o).map((k) => [k, v]));
  return { level: 1, era: 1, mastered: 0, dmax: dmaxKw(1, 0), gate: f(GATES, false), perf: f(PERF, 0), blueprint: f(BLUEPRINTS, false), incidentQs: new Set(), ...over };
}

// ---- 乱数（種つき。同じ状態から同じ結果になる） ----
export function rnd(G) {
  const a = (G.rng = (G.rng + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = (G) => Math.sqrt(-2 * Math.log(1 - rnd(G))) * Math.cos(2 * Math.PI * rnd(G));
function pickWeighted(G, entries) {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rnd(G) * total;
  for (const [v, w] of entries) if ((r -= w) < 0) return v;
  return entries[entries.length - 1][0];
}

// ---- 島の地形（設計 12章）。km：距離の計算用、x・y：地図の上の位置（360×400） ----
// 町：era＝申し込みが届くようになる時代。tags＝その場所の危険（coast・snow・thunder）
const STANDARD = {
  name: '標準の島',
  desc: '山と川が北に、海岸が南と東に、雪の地域が北西にある',
  nodes: [
    { id: 'T1', town: true, name: '中央の町', km: [0, 0], x: 180, y: 262, era: 1, tags: [] },
    { id: 'T2', town: true, name: '港町', km: [1.5, -3.5], x: 214, y: 338, era: 1, tags: ['coast'] },
    { id: 'T3', town: true, name: '東浜', km: [11, 2], x: 306, y: 250, era: 2, tags: ['coast'] },
    { id: 'T4', town: true, name: '山のふもとの里', km: [-6, 22], x: 122, y: 172, era: 2, tags: ['thunder'] },
    { id: 'T5', town: true, name: '西の工場町', km: [-9, -3], x: 70, y: 292, era: 3, tags: [] },
    { id: 'T6', town: true, name: '雪国の町', km: [-40, 45], x: 46, y: 112, era: 3, tags: ['snow'] },
    { id: 'H1', name: '近くの川', km: [3, 14], x: 210, y: 180, hydro: 2000, tags: ['thunder'] },
    { id: 'H2', name: '山の渓谷', km: [10, 55], x: 246, y: 96, hydro: 20000, pond: true, tags: ['thunder'] },
    { id: 'H3', name: '奥山のダム地点', km: [-25, 110], x: 130, y: 44, hydro: 50000, pond: true, tags: ['thunder', 'snow'] },
    { id: 'C1', name: '港の埋立地', km: [4, -5], x: 272, y: 346, coal: true, tags: ['coast'] },
  ],
};
const scaleKm = (nodes, f) => nodes.map((n) => ({ ...n, km: f(n) }));
export const TERRAINS = {
  standard: STANDARD,
  mountain: {
    name: '山がちな島',
    desc: '水力の地点が近いが、雷が多く、海辺の町は遠い',
    nodes: scaleKm(STANDARD.nodes, (n) => (n.hydro ? n.km.map((v) => v * 0.6) : n.tags.includes('coast') ? n.km.map((v) => v * 1.8) : n.km)).map((n) => (n.town && !n.tags.includes('thunder') && n.id !== 'T1' ? { ...n, tags: [...n.tags, 'thunder'] } : n)),
  },
  coast: {
    name: '海辺の島',
    desc: '町が海沿いに集まり（塩害）、水力の地点は遠い',
    nodes: scaleKm(STANDARD.nodes, (n) => (n.hydro ? n.km.map((v) => v * 1.5) : n.km)).map((n) => (n.town && !n.tags.includes('coast') && n.id !== 'T4' && n.id !== 'T6' ? { ...n, tags: [...n.tags, 'coast'] } : n)),
  },
};
// 1.6.0 日本列島：実在の地名と史実の地点（app/js/japan.js。ツール/日本列島/ で作る）。地点は緯度・経度を持ち、距離は大円距離
// 古い島（標準・山がち・海辺）は、古い記録を読むためだけに残す（新しく始めるのは日本列島）
TERRAINS.japan = { name: '日本列島', desc: '実在の地名と史実の地点。始めた町のまわりから、時代とともに建てられる範囲が広がる', nodes: JAPAN_NODES, map: 'japan' };
export const OLD_TERRAINS = ['standard', 'mountain', 'coast'];
export const isJapan = (G) => G.terrain === 'japan';
export const nodesOf = (G) => (TERRAINS[G.terrain] || STANDARD).nodes;
const IDX = new Map();
export const nodeOf = (G, id) => {
  const key = G.terrain in TERRAINS ? G.terrain : 'standard';
  if (!IDX.has(key)) IDX.set(key, new Map(nodesOf(G).map((n) => [n.id, n])));
  return IDX.get(key).get(id);
};
// 2点の緯度・経度から大円距離（km）
const R_EARTH = 6371;
export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function distKm(G, a, b) {
  const A = nodeOf(G, a), B = nodeOf(G, b);
  if (A.lat != null && B.lat != null) return Math.max(0.3, greatCircleKm(A.lat, A.lon, B.lat, B.lon));
  return Math.max(0.3, Math.hypot(A.km[0] - B.km[0], A.km[1] - B.km[1]));
}
// 始めた町（古い島は中央の町）
export const startId = (G) => G.start || (isJapan(G) ? J.TOKYO : 'T1');
// 地点が開く時代（1.6.0。日本列島はエリアごと・水力は史実の年まで）。古い島は今までどおり、どの地点にも最初から建てられる
export function openEra(G, n) {
  if (typeof n === 'string') n = nodeOf(G, n);
  if (!n) return 99;
  if (isJapan(G)) return J.nodeOpenEra(startId(G), n);
  return 1;
}
export const nodeOpen = (G, n) => openEra(G, n) <= G.era;
// 申し込みが届く町か（日本列島は開いている町。古い島は町の era）
export function townActive(G, n) {
  if (typeof n === 'string') n = nodeOf(G, n);
  return isJapan(G) ? nodeOpen(G, n) : (n.era || 1) <= G.era;
}
const closedWhy = (G, n) => `${n.name}は、まだ開いていない（${ERAS[openEra(G, n) - 1]?.name || '先の時代'}から）`;
// ルート：まっすぐ（両端の地域の危険をすべて受ける）／回り道（距離 1.3 倍。雷と塩害を避ける。両端が雪なら雪は残る）
export function routeInfo(G, a, b, route) {
  const A = nodeOf(G, a), B = nodeOf(G, b);
  const d = distKm(G, a, b);
  const all = [...new Set([...A.tags, ...B.tags])];
  if (route === 'detour') return { km: d * 1.3, hazards: all.filter((h) => h === 'snow' && A.tags.includes('snow') && B.tags.includes('snow')) };
  return { km: d, hazards: all };
}

// ---- 最初の状態（設計 12章） ----
// terrain：'japan'（1.6.0 から新しく始めるのはこれ。start＝始める町）。古い島（standard など）はテストと古い記録のため
export function newGrid(seed = 1, nowMs = 0, { terrain = 'standard', start = null, islandNo = 1, perfMax = {}, past = [] } = {}) {
  const home = terrain === 'japan' ? start || J.TOKYO : 'T1';
  const G = {
    v: 2, islandNo, terrain, seed, rng: seed | 0,
    ...(terrain === 'japan' ? { start: home } : {}),
    t: 6, realAt: nowMs, era: 1, hz: null,
    yen: 10000, loanUntil: 0, negHours: 0, rebuild: false,
    reserve: 0.1, fuelPlan: 'contract', maint: 'normal',
    fuel: { base: 1, contract: 1, spot: 0.85 },
    priority: ['P1'], nextId: 2,
    plants: [{ id: 'P1', type: 'dcCoal', kw: 25, site: home, cost: 3000, proto: false, builtAt: 0, readyAt: 0, on: false, onAt: null, downUntil: 0, idle: false, store: 0, hold: 0, done: true }],
    lines: [], subs: [],
    loads: [{ id: 'L1', town: home, type: 'lamp', kw: 20, cap: false }],
    apps: [], rep: {}, black: {},
    events: [], incidents: [], reports: [], cool: {}, buffs: {},
    perfMax: { ...perfMax },
    hist: [], last: null, lossRatio: 0.03,
    acc: newAcc(), yr: newYear(0), years: [], best: null, past,
  };
  return G;
}
// 日本列島で新しく始める（1.6.0）
export const newJapan = (seed, nowMs, start = J.TOKYO, o = {}) => newGrid(seed, nowMs, { ...o, terrain: 'japan', start });
// 古い記録を今の形に直す（読み込んだとき）。1.6.0：周波数は系統ごと → 島の周波数（G.hz）を交流の発電機に配る
// 古い島では G.hz を島の決まりとして残す（まだ周波数のない網に建てるときも、その周波数になる）
export function upgrade(G) {
  if (!G) return G;
  if ((G.v || 1) < 2) {
    for (const p of G.plants || []) if (PLANTS[p.type]?.ac && !p.hz && G.hz) p.hz = G.hz;
    G.v = 2;
  }
  return G;
}
const newAcc = () => ({ hours: 0, rev: 0, fuel: 0, maint: 0, repair: 0, loan: 0, unserved: 0, shedH: 0, blackH: 0, badH: 0, fails: 0, apps: 0, notes: [] });
const newYear = (idx) => ({ idx, profit: 0, unserved: 0, okH: 0, hours: 0, served: 0 });

// ---- 設備の状態 ----
const P = (p) => PLANTS[p.type];
export const plantReady = (p, t) => p.readyAt <= t && p.downUntil <= t && !p.idle;
export function plantEff(p, lc) {
  const [lo, hi] = P(p).eff;
  return p.proto ? lo : lo + (hi - lo) * (lc.perf[P(p).perf] || 0);
}
export function flowFactor(G, t) {
  const drought = evOn(G, 'drought', t);
  return [1.3, 1.0, 0.9, 0.6][seasonOf(t)] * (drought ? (drought.eased ? 0.55 : 0.4) : 1);
}
// この1時間に出せる最大（水力は流量しだい。調整池式は池の水まで）
function capNow(G, p, t, forCommit = false) {
  if (!P(p).ac || P(p).coal) return p.kw;
  const f = flowFactor(G, t);
  if (p.type === 'ror') return p.kw * Math.min(1, f);
  const inflow = p.kw * f * (POND_HOURS / 24);
  return Math.min(p.kw, (forCommit ? p.store / 2 : p.store) + inflow);
}
export const evOn = (G, key, t = G.t) => G.events.find((e) => e.key === key && e.until > t) || null;
export function fuelPrice(G, t = G.t) {
  return (G.fuelPlan === 'spot' ? G.fuel.spot : G.fuel.contract) * 1; // 円/kWh（熱）
}
export const lineCircuits = (l, t) => (l.downUntil > t ? 0 : l.n - (l.c1Until > t ? 1 : 0));
const subsAt = (G, town, t) => G.subs.filter((s) => s.town === town && s.readyAt <= t && s.downUntil <= t);
function lineActive(G, l, t) {
  if (l.readyAt > t || lineCircuits(l, t) <= 0) return false;
  if (!LINES[l.kind].hv) return true;
  // 送電線（11 kV 以上）は、町の側に動いている変電所がないとつながらない
  return [l.a, l.b].every((id) => !nodeOf(G, id).town || subsAt(G, id, t).length > 0);
}
export function lineHazard(G, l, t, lc) {
  const K = LINES[l.kind];
  const m = { thunder: 1, coast: 1, snow: 1 };
  for (const h of l.hazards) {
    if (h === 'snow' && seasonOf(t) !== 3) continue;
    let k = HAZARD[h].k;
    for (const [o, d] of Object.entries(LINE_OPTS)) if (d.hazard === h && optOn(l, o, t)) k = 1 + (k - 1) * d.k;
    m[h] = 1 + (k - 1) * (l.fix?.[h] ?? 1) * (h === 'coast' && l.saltUntil > t ? 0.5 : 1);
  }
  if (evOn(G, 'typhoon', t) && l.hazards.includes('coast')) m.coast *= 3;
  if (evOn(G, 'snowstorm', t) && l.hazards.includes('snow')) m.snow *= 3;
  let base = (0.01 * l.km) / 100 * l.n * (1 - 0.5 * (lc.perf[K.perf] || 0)) * (l.proto ? 3 : 1) * (G.maint === 'defer' ? 2.5 : 1);
  if (evOn(G, 'typhoon', t)) base *= 5;
  if (l.overH > 0) base *= 3;
  return { perDay: base * m.thunder * m.coast * m.snow, m };
}

// ---- 需要 ----
function loadKw(G, ld, t) {
  const D = LOADS[ld.type];
  let k = D.shape[t % 24] * (seasonOf(t) === 3 ? D.winter : 1);
  if (evOn(G, 'heat', t) || evOn(G, 'cold', t)) k *= 1.15;
  const dr = evOn(G, 'drought', t);
  if (dr?.eased) k *= 0.9;
  return ld.kw * k;
}
const loadTan = (ld) => tanOf(ld.cap && LOADS[ld.type].pfFixed ? LOADS[ld.type].pfFixed : LOADS[ld.type].pf);
// 町ごとの予測の需要（kW）
function townForecast(G, t) {
  const m = new Map();
  for (const ld of G.loads) m.set(ld.town, (m.get(ld.town) || 0) + loadKw(G, ld, t));
  return m;
}

// ---- 系統の形（つながり）。dc＝直流の網（200 V）、それ以外＝交流の網 ----
function networks(G, t, dc) {
  const edges = G.lines.filter((l) => !!LINES[l.kind].dc === dc && lineActive(G, l, t));
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(x, r);
    return r;
  };
  for (const n of nodesOf(G)) find(n.id);
  for (const e of edges) parent.set(find(e.a), find(e.b));
  const nets = new Map();
  for (const n of nodesOf(G)) {
    const r = find(n.id);
    if (!nets.has(r)) nets.set(r, { dc, nodes: [], edges: [], plants: [] });
    nets.get(r).nodes.push(n.id);
  }
  for (const e of edges) nets.get(find(e.a)).edges.push(e);
  const order = new Map(G.priority.map((id, i) => [id, i]));
  for (const p of G.plants) if (!!P(p).ac !== dc) nets.get(find(p.site)).plants.push(p);
  for (const net of nets.values()) net.plants.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  return [...nets.values()];
}

// 木の形の網の潮流：inj（node → { p, q }。消費が正、発電が負）から、線ごとの流れを求める
function treeFlows(net, inj) {
  const adj = new Map(net.nodes.map((n) => [n, []]));
  for (const e of net.edges) {
    adj.get(e.a).push([e.b, e]);
    adj.get(e.b).push([e.a, e]);
  }
  const flows = new Map();
  const seen = new Set();
  const walk = (n, from) => {
    seen.add(n);
    const s = { p: inj.get(n)?.p || 0, q: inj.get(n)?.q || 0 };
    for (const [m, e] of adj.get(n)) {
      if (e === from || seen.has(m)) continue;
      const c = walk(m, e);
      c.child = m; // 流れは親 → 子（c.p は子の側の消費の合計）
      flows.set(e.id, c);
      s.p += c.p;
      s.q += c.q;
    }
    return s;
  };
  for (const n of net.nodes) if (!seen.has(n)) walk(n, null);
  return flows;
}
// 線の損失（kW）：交流は (P²+Q²)R/V²、直流は I²R（R は往復）。P・Q は kW・kvar、V は kV
export function lineLoss(kind, km, n, p, q = 0) {
  const K = LINES[kind];
  return ((p * p + q * q) * ((K.r * km) / n)) / (K.kv * K.kv) / 1000;
}
// 発電所の構内の線（町はずれ 0.3 km）。直流だけ損失を数える（回線は 50 kW ごとに1つ）
const feederLoss = (p, out) => (P(p).ac ? 0 : lineLoss('dc200', 0.3, Math.ceil(p.kw / LINES.dc200.cap), out));

// 給電：運転中の発電機に、優先順位の順に割り振る。最低出力を先に確保し、余りは捨てる（waste）
function dispatch(units, need) {
  const out = new Map();
  let rest = need;
  for (const u of units) {
    const m = Math.min(u.min, u.cap);
    out.set(u.p.id, m);
    rest -= m;
  }
  const waste = Math.max(0, -rest);
  for (const u of units) {
    if (rest <= 0) break;
    const add = Math.min(u.cap - out.get(u.p.id), rest);
    out.set(u.p.id, out.get(u.p.id) + add);
    rest -= add;
  }
  return { out, waste, short: Math.max(0, rest) };
}

// 周波数の計算（設計 7章）。ガバナ（調定率 5%）は各発電機の余裕までしか効かない。足りない分は負荷の自己制御（2%/Hz）で受ける
export const DROOP = 0.05;
export const KL = 0.02;
// dP（kW。不足が正）に対する周波数の下がり幅 x（Hz）と、各発電機の増加分
export function freqDrop(units, dP, load, f0) {
  if (dP <= 0) return { x: 0, up: units.map(() => 0) };
  const kl = Math.max(KL * load, 1e-9);
  const resp = (x) => units.reduce((a, u) => a + Math.min(u.head, (u.kw * x) / (DROOP * f0)), 0) + kl * x;
  let lo = 0, hi = 0.01;
  while (resp(hi) < dP && hi < 1000) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (resp(mid) < dP) lo = mid;
    else hi = mid;
  }
  return { x: hi, up: units.map((u) => Math.min(u.head, (u.kw * hi) / (DROOP * f0))) };
}
// 系統定数 K（kW/Hz）＝余裕のある発電機の K_G ＋ 負荷の K_L
export function systemK(units, load, f0) {
  return units.filter((u) => u.head > 0).reduce((a, u) => a + u.kw / (DROOP * f0), 0) + KL * load;
}
export const FREQ = { ok: 0.2, quality: 0.5, shed1: 0.8, shed2: 1.2, black: 2.0, over: 1.0 };
// 不足 dP のときの結果：負荷遮断の段（0・1・2）と全域停電
export function freqOutcome(units, dP, load, f0) {
  let shed = 0;
  let r = freqDrop(units, dP, load, f0);
  const x0 = r.x; // 負荷遮断の前の下がり幅
  if (r.x > FREQ.shed1) {
    shed = 0.1; // 第1段：需要の 10% を切り離す
    r = freqDrop(units, dP - load * 0.1, load * 0.9, f0);
    if (r.x > FREQ.shed2) {
      shed = 0.3; // 第2段：さらに 20%
      r = freqDrop(units, dP - load * 0.3, load * 0.7, f0);
    }
  }
  return { x: r.x, x0, up: r.up, shed, black: r.x > FREQ.black };
}

// 1つの網の1時間分。dem：node → { f（予測）, a（実際）, q（実際の無効電力） }。o.dry：状態を変えない（見込みの計算）
function runNet(G, lc, t, net, dem, fc, o) {
  const res = { out: new Map(), served: new Map(), flows: new Map(), loss: 0, waste: 0, x: 0, over: false, shed: 0, black: false, noGen: false, tripped: [], cap: 0, load: 0, f: 0 };
  // 1.6.0：周波数は網ごと（発電機の周波数。古い島は島の周波数）
  const f0 = net.dc ? 0 : net.plants.find((p) => p.hz)?.hz || G.hz || 50;
  res.hz = net.dc ? 0 : f0;
  const towns = net.nodes.filter((n) => dem.has(n));
  const A = towns.reduce((s, n) => s + dem.get(n).a, 0);
  const F = towns.reduce((s, n) => s + dem.get(n).f, 0);
  res.load = A;
  res.f = F;
  const blackout = !net.dc && (towns.some((n) => (G.black[n] || 0) > t) || net.plants.some((p) => p.hold > t));
  const ready = net.plants.filter((p) => plantReady(p, t) && p.hold <= t);

  // 起動・停止：優先順位の順に、先の需要（予備力の目標つき）をまかなえるまで起動する
  const reserve = net.dc ? Math.min(G.reserve, 0.1) : G.reserve;
  const need = (k) => fc(net, t + k) * (1 + G.lossRatio) * (1 + reserve);
  // 先に決めた発電機の出力（at：使えるようになる時刻。起動中のものは、その時刻までは数えない）
  const committed = [];
  const accAt = (k) => committed.reduce((a, c) => a + (c.at <= t + k ? c.cap : 0), 0);
  const online = [];
  for (const p of ready) {
    const D = P(p);
    const cap = capNow(G, p, t, true);
    // want：いま起動すれば間に合う時刻（起動時間のあと）に足りない。keep：これから先のどこかで足りない
    let want = false, keep = false;
    for (let k = 0; k <= D.start + 4; k++) {
      if (need(k) <= accAt(k) + 1e-9) continue;
      keep = true;
      if (k >= D.start && k <= D.start + 1) want = true;
    }
    let on = p.on, onAt = p.onAt;
    if (o.assume) on = true;
    else if (on && !keep) on = false;
    else if (!on && onAt == null && want) {
      if (D.start === 0) on = true;
      else onAt = t + D.start;
    } else if (!on && onAt != null && !keep) onAt = null;
    if (!on && onAt != null && onAt <= t) (on = true), (onAt = null);
    if (!o.dry) (p.on = on), (p.onAt = on ? null : onAt);
    if (on || onAt != null) committed.push({ cap, at: on ? t : onAt });
    if (on) online.push(p);
  }
  for (const p of net.plants) if (!o.dry && !ready.includes(p) && !(p.hold > t)) (p.on = false), (p.onAt = null);
  if (A <= 0 && F <= 0) return res;
  if (blackout) {
    res.black = true;
    for (const n of towns) res.served.set(n, 0);
    return res;
  }

  // 予定の給電（予測の需要＋損失の見込み）。損失は一度流れを解いて見積もる
  const mk = (p) => ({ p, kw: p.kw, cap: capNow(G, p, t), min: P(p).min * p.kw, head: 0 });
  const units = online.map(mk);
  res.cap = units.reduce((s, u) => s + u.cap, 0);
  const flowsFor = (out, served) => {
    const inj = new Map();
    const add = (n, p, q) => {
      const v = inj.get(n) || { p: 0, q: 0 };
      v.p += p;
      v.q += q;
      inj.set(n, v);
    };
    let Q = 0, Pg = 0;
    for (const n of towns) {
      const d = dem.get(n), r = served(n);
      add(n, d.a * r, d.q * r);
      Q += d.q * r;
    }
    for (const u of units) Pg += out.get(u.p.id) || 0;
    let fl = 0;
    for (const u of units) {
      const g = out.get(u.p.id) || 0;
      fl += feederLoss(u.p, g);
      add(u.p.site, -g + feederLoss(u.p, g), Pg > 0 ? (-Q * g) / Pg : 0);
    }
    const flows = treeFlows(net, inj);
    let loss = fl;
    for (const e of net.edges) {
      const f = flows.get(e.id) || { p: 0, q: 0 };
      const n = lineCircuits(e, t);
      f.loss = lineLoss(e.kind, e.km, n, f.p, net.dc ? 0 : f.q);
      f.util = Math.hypot(f.p, net.dc ? 0 : f.q) / (LINES[e.kind].cap * n);
      loss += f.loss;
    }
    // 変電所：鉄損はいつも、銅損は負荷率の2乗。町に出入りする送電線（11 kV 以上）の流れの合計が変圧器を通る
    const subs = new Map();
    if (!net.dc) {
      for (const n of towns) {
        const ss = subsAt(G, n, t);
        if (!ss.length) continue;
        let sp = 0, sq = 0;
        for (const e of net.edges) {
          if (!LINES[e.kind].hv || (e.a !== n && e.b !== n)) continue;
          const f = flows.get(e.id);
          const sign = f.child === n ? 1 : -1; // この町に入ってくる向きを正にする
          sp += sign * f.p;
          sq += sign * f.q;
        }
        const capK = ss.reduce((a, s) => a + s.mva, 0) * 1000;
        const S = Math.hypot(sp, sq);
        const lossK = ss.reduce((a, s) => a + (s.lossK || 1) * s.mva, 0) / (capK / 1000);
        const l = (TR.iron * capK + TR.copper * capK * (S / capK) ** 2) * lossK;
        loss += l;
        subs.set(n, { util: S / capK, loss: l });
      }
    }
    return { flows, loss, subs };
  };
  let plan = dispatch(units, F);
  const scale = F > 0 ? A / F : 1;
  const all1 = () => 1;
  const est = flowsFor(new Map([...plan.out].map(([k, v]) => [k, v * scale])), all1).loss;
  plan = dispatch(units, F + est / Math.max(scale * scale, 1e-9));

  // 実際：この時間に止まった発電機（o.trip）を外し、実際の需要との差をガバナが受ける
  const alive = units.filter((u) => !o.trip?.has(u.p.id));
  res.tripped = units.filter((u) => o.trip?.has(u.p.id)).map((u) => u.p.id);
  const sumOut = alive.reduce((s, u) => s + plan.out.get(u.p.id), 0);
  const R = A + est;
  const dP = R - sumOut; // 不足が正。最低出力のせいで余っている分（plan.waste）は、もともと捨てる予定
  const out = new Map(alive.map((u) => [u.p.id, plan.out.get(u.p.id)]));
  let ratio = 1;
  if (!alive.length) {
    // 動いている発電機がない（起動を待っている・つながっていない）：全域停電ではなく、ただ届かない
    res.noGen = true;
    ratio = 0;
  } else if (net.dc) {
    // 直流：周波数はない。足りない分は電圧の低下（電灯が暗くなる）で表す
    const capSum = alive.reduce((s, u) => s + u.cap, 0);
    const short = Math.max(0, R - capSum);
    const give = dispatch(alive, Math.min(R, capSum));
    for (const u of alive) out.set(u.p.id, give.out.get(u.p.id));
    res.waste = give.waste;
    res.dim = A > 0 ? short / A : 0;
    ratio = Math.max(0, 1 - res.dim); // 足りない分は交流の網が受け持つ。どこからも来なければ、電圧の低下になる（solve）
  } else if (dP > 0) {
    for (const u of alive) u.head = Math.max(0, u.cap - out.get(u.p.id));
    const fo = freqOutcome(alive, dP, A, f0);
    res.x = -fo.x;
    res.x0 = fo.x0;
    res.shed = fo.shed;
    res.K = systemK(alive, A, f0);
    if (fo.black) {
      res.black = true;
      ratio = 0;
      if (!o.dry) {
        // 発電機が保護で外れる → 全域停電。ブラックスタートできる電源があれば6時間、なければ3日で復旧
        const bs = net.plants.some((p) => P(p).bs && plantReady(p, t));
        const until = t + (bs ? 6 : 72);
        for (const p of net.plants) (p.on = false), (p.onAt = until), (p.hold = until);
        for (const n of towns) G.black[n] = until;
        res.bs = bs;
      }
    } else {
      ratio = 1 - fo.shed;
      alive.forEach((u, i) => out.set(u.p.id, out.get(u.p.id) + fo.up[i]));
    }
  } else {
    // 余り：出力を下げる（優先順位の低い順）。下げきれない分は蒸気を逃がす・水を流す。それでも余れば周波数が上がりすぎる
    let sur = -dP;
    const room = alive.reduce((s, u) => s + (out.get(u.p.id) - Math.min(u.min, u.cap)), 0);
    const K = alive.reduce((a, u) => a + u.kw / (DROOP * f0), 0) + KL * A;
    res.x = Math.min(sur, room) / Math.max(K, 1e-9);
    res.K = K;
    for (const u of [...alive].reverse()) {
      const d = Math.min(sur, out.get(u.p.id) - Math.min(u.min, u.cap));
      out.set(u.p.id, out.get(u.p.id) - d);
      sur -= d;
    }
    const dump = alive.reduce((s, u) => s + (P(u.p).coal ? 0.1 * u.kw : u.cap), 0) + plan.waste;
    res.waste = Math.min(sur, dump);
    if (sur > dump + 1e-6 && (sur - dump) / Math.max(KL * A, 1e-9) > FREQ.over) {
      res.over = true;
      res.x = FREQ.over;
      const last = alive[alive.length - 1];
      if (!o.dry) (last.p.on = false), (last.p.onAt = null);
      res.tripped.push(last.p.id);
    }
  }
  for (const n of towns) res.served.set(n, ratio);
  const fin = flowsFor(out, (n) => res.served.get(n));
  res.flows = fin.flows;
  res.subs = fin.subs;
  res.loss = fin.loss;
  res.out = out;
  return res;
}

// 1時間分を解く（直流の網 → 残りを交流の網）。o.dry：状態を変えない。o.assume：使える発電機はすべて運転中とみなす
export function solve(G, lc, t, o = {}) {
  const fcCache = new Map();
  const fcTown = (tt) => {
    if (!fcCache.has(tt)) fcCache.set(tt, townForecast(G, tt));
    return fcCache.get(tt);
  };
  const sigma = o.noNoise ? 0 : 0.03 * (1 - 0.5 * (lc.perf.freq || 0));
  const dem = new Map();
  const f0 = fcTown(t);
  for (const n of nodesOf(G)) {
    if (!n.town) continue;
    const f = f0.get(n.id) || 0;
    const a = Math.max(0, f * (1 + sigma * (sigma ? gauss(G) : 0)));
    if (!(f > 0 || a > 0)) continue;
    const q = G.loads.filter((ld) => ld.town === n.id).reduce((s, ld) => s + loadKw(G, ld, t) * loadTan(ld), 0) * (f > 0 ? a / f : 0);
    dem.set(n.id, { f, a, q });
  }
  const dcNets = networks(G, t, true);
  const acNets = networks(G, t, false);
  const sumTowns = (net, tt) => net.nodes.reduce((s, n) => s + (fcTown(tt).get(n) || 0), 0);
  // 直流の発電所は、つないだ町の需要だけをまかなう。交流の網は、その残りを受け持つ
  const dcCap = (net, tt) => net.plants.filter((p) => plantReady(p, tt)).reduce((s, p) => s + p.kw, 0);
  const dcOf = new Map();
  for (const net of dcNets) for (const n of net.nodes) dcOf.set(n, net);
  const acOf = new Map();
  for (const net of acNets) for (const n of net.nodes) acOf.set(n, net);
  const acCan = (n) => acOf.get(n).plants.some((p) => plantReady(p, t));
  // 直流の電気は、交流が来ていない町に先に回す。戻り値：町 → 直流でまかなえる割合
  const share = (net, total, val) => {
    const m = new Map();
    let left = total;
    for (const group of [net.nodes.filter((n) => val(n) > 0 && !acCan(n)), net.nodes.filter((n) => val(n) > 0 && acCan(n))]) {
      const sum = group.reduce((x, n) => x + val(n), 0);
      const k = sum > 0 ? Math.min(1, left / sum) : 0;
      for (const n of group) m.set(n, k);
      left -= sum * k;
    }
    return m;
  };
  const fcShare = new Map();
  const NONE = new Map();
  const dcShareAt = (d, tt) => {
    if (!d.plants.length) return NONE; // 直流の発電所のない網（1.6.0：地点が多いので、先に省く）
    const key = `${d.nodes[0]}|${tt}`;
    if (!fcShare.has(key)) fcShare.set(key, share(d, dcCap(d, t) * 0.95, (n) => fcTown(tt).get(n) || 0));
    return fcShare.get(key);
  };
  const acFc = (net, tt) => {
    const fc = fcTown(tt);
    let x = 0;
    for (const n of net.nodes) {
      const v = fc.get(n);
      if (v) x += v * (1 - (dcShareAt(dcOf.get(n), tt).get(n) || 0));
    }
    return x;
  };
  const results = [];
  const served = new Map(); // 町 → 届いた割合
  const rest = new Map();
  for (const net of dcNets) {
    if (!net.plants.length) continue;
    const r = runNet(G, lc, t, net, dem, sumTowns, o);
    r.net = net;
    results.push(r);
    const got = [...r.served].reduce((x, [n, ratio]) => x + dem.get(n).a * ratio, 0);
    r.served = share(net, got, (n) => dem.get(n)?.a || 0);
    for (const [n, ratio] of r.served) served.set(n, ratio);
  }
  for (const [n, d] of dem) {
    const k = 1 - (served.get(n) || 0);
    const fk = 1 - (dcShareAt(dcOf.get(n), t).get(n) || 0);
    if (k > 1e-9) rest.set(n, { f: d.f * fk, a: d.a * k, q: d.q * k });
  }
  for (const net of acNets) {
    // 発電機のない網（線だけ・地点1つだけ）は計算しない：交流の電気は届かない（1.6.0。地点が多いので）
    if (!net.plants.length) continue;
    const r = runNet(G, lc, t, net, rest, acFc, o);
    r.net = net;
    results.push(r);
    for (const [n, ratio] of r.served) {
      const d = dem.get(n);
      served.set(n, (served.get(n) || 0) + (d.a > 0 ? (rest.get(n).a * ratio) / d.a : 0));
    }
  }
  // 直流だけの町で少し足りないとき：1 割までは電圧の低下（電灯が暗くなる）で済み、3% を超えると品質の低下。それ以上は停電
  const dim = new Set();
  for (const n of dem.keys()) {
    const r = served.get(n) || 0;
    served.set(n, r);
    if (!dcOf.get(n)?.plants.length || r >= 1 - 1e-9 || r < 0.9) continue;
    if (r < 0.97) dim.add(n);
    served.set(n, 1);
  }
  return { dem, served, results, dim };
}

// ---- 報告書・事故 ----
export function addReport(G, r) {
  G.reports.unshift({ t: G.t, ...r });
  if (G.reports.length > 30) G.reports.length = 30;
}
const note = (G, text) => {
  if (G.acc.notes.length < 12 && !G.acc.notes.includes(text)) G.acc.notes.push(text);
};
// きっかけごとの問題（原稿の「- 事故：」の行に対応）。units：報告書から「この単元を解く」で開く単元
export const INCIDENTS = {
  dcDrop: { q: ['Q01'], title: '町の電灯が暗い', units: ['denken3-riron-U03'] },
  parallelIn: { q: ['Q02', 'Q05'], title: '新しい発電機の並列投入', units: ['circuit-b-U13', 'power-system-U03'] },
  salt: { q: ['Q03'], title: '海沿いの送電線で閃絡', units: ['denken3-denryoku-U10', 'denken3-denryoku-U06'] },
  gallop: { q: ['Q04'], title: '雪の送電線で相間短絡', units: ['denken3-denryoku-U06'] },
  genTrip: { q: ['Q06'], title: '発電機が止まった', units: ['power-system-U03', 'power-system-U02'] },
  genShort: { q: ['Q07'], title: '発電機が止まり、予備力が足りない', units: ['power-system-U03', 'power-system-U04'] },
  reserve: { q: ['Q08'], title: '予備力の目標が小さい', units: ['power-system-U02', 'power-system-U12'] },
  trLoss: { q: ['Q09'], title: '変圧器の損失の報告', units: ['denken3-denryoku-U05'] },
  trParallel: { q: ['Q10'], title: '変圧器の並行運転で循環電流', units: ['denken3-denryoku-U05', 'circuit-b-U14'] },
  trShare: { q: ['Q11'], title: '並行運転の片方が過負荷', units: ['denken3-denryoku-U05'] },
  lineOver: { q: ['Q12'], title: '送電線の過負荷', units: ['denken3-denryoku-U06', 'power-system-U07'] },
  factoryPf: { q: ['Q13'], title: '力率の悪い工場の申し込み', units: ['circuit-b-U11'] },
  motor: { q: ['Q14'], title: '工場のモータで電灯がちらつく', units: ['circuit-b-U11'] },
  lightning: { q: ['Q15'], title: '雷で送電線が切れた', units: ['denken3-denryoku-U09', 'denken3-denryoku-U06'] },
  backFlash: { q: ['Q16'], title: '架空地線があるのに雷事故', units: ['denken3-denryoku-U06', 'denken3-denryoku-U10'] },
  arc: { q: ['Q17'], title: '地絡のアークが消えない', units: ['denken3-denryoku-U09'] },
  drought: { q: ['Q18'], title: '渇水', units: ['denken3-denryoku-U01', 'power-system-U05'] },
};
export const MAX_INCIDENTS = 3;
const qid = (q) => `${L.GRID_SUBJECT}-${q}`;
// 事故を対処待ちに入れる。問題データに問題がなければ入れない（標準の被害のまま）
export function raise(G, lc, key, info = {}) {
  const D = INCIDENTS[key];
  const qs = D.q.map(qid).filter((id) => lc.incidentQs.has(id));
  if (!qs.length || (G.cool[key] || 0) > G.t) return null;
  G.cool[key] = G.t + (info.cool ?? 24);
  const inc = { id: `I${G.nextId++}`, key, qid: qs[Math.floor(rnd(G) * qs.length)], at: G.t, deadline: G.t + 24, ...info };
  G.incidents.push(inc);
  while (G.incidents.length > MAX_INCIDENTS) {
    const old = G.incidents.shift(); // 古いものは標準の被害で片づける
    addReport(G, { title: INCIDENTS[old.key].title, what: `${old.what || ''}対処しないまま、標準の被害で片づいた。`, units: INCIDENTS[old.key].units });
  }
  return inc;
}
const targetOf = (G, inc) => (inc.plant ? G.plants.find((p) => p.id === inc.plant) : inc.line ? G.lines.find((l) => l.id === inc.line) : inc.sub ? G.subs.find((s) => s.id === inc.sub) : null);
const repHit = (G, towns, d) => {
  for (const n of towns) G.rep[n] = Math.max(0.2, (G.rep[n] ?? 1) - d);
};
const allTowns = (G) => nodesOf(G).filter((n) => n.town).map((n) => n.id);
// 止まっている設備の「標準の被害」（inc.dur 時間・inc.cost 円）を k 倍に直す
function scaleOutage(G, inc, kDur, kCost = kDur) {
  const x = targetOf(G, inc);
  if (x && inc.dur != null) {
    const until = inc.at + Math.round(inc.dur * kDur);
    if (inc.circuit) x.c1Until = until;
    else x.downUntil = until;
  }
  if (inc.cost) G.yen += inc.cost * (1 - kCost);
}
// 事故の問題に答えた結果を反映する。correct：true／false。戻り値：結果の文
export function resolveIncident(G, id, correct) {
  const i = G.incidents.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const inc = G.incidents.splice(i, 1)[0];
  const x = targetOf(G, inc);
  const month = 24 * MONTH_DAYS;
  let text;
  const ok = (a, b) => (text = correct ? a : b);
  switch (inc.key) {
    case 'dcDrop':
      if (correct) G.buffs.dcDiscount = true;
      else repHit(G, [inc.town], 0.2);
      ok('電圧の下がる理由がわかったので、次の直流の設備の建設費が 20% 安くなる。', '電灯の苦情が続き、この町からの申し込みが減った。');
      break;
    case 'parallelIn':
      if (!correct && x) {
        x.downUntil = G.t + 72;
        x.on = false;
        G.yen -= x.cost * 0.05;
      }
      ok('問題なく並列できた。', '投入の衝撃で発電機が傷んだ（修理に3日）。');
      break;
    case 'salt':
      scaleOutage(G, inc, correct ? 0.5 : 1.5);
      if (correct && x) x.saltUntil = G.t + month;
      ok('がいしを洗って閃絡が止まった。この送電線の塩害は、30日間 半分になる。', '原因を取り違え、送電線が止まる時間が延びた。');
      break;
    case 'gallop':
      scaleOutage(G, inc, correct ? 0.5 : 1.5);
      if (correct && x) x.fix = { ...(x.fix || {}), snow: 0.5 };
      ok('相間スペーサを付けて送電を再開した。この送電線のギャロッピングは、これから半分になる。', '同じ事故がくり返し、修理が長引いた。');
      break;
    case 'genTrip':
      scaleOutage(G, inc, correct ? 0.5 : 1.5);
      ok('周波数の下がり幅を見積もって落ち着いて対処し、修理が半分で済んだ。', '回復が遅れ、修理が長引いた。');
      break;
    case 'genShort':
      scaleOutage(G, inc, correct ? 0.5 : 1.5);
      repHit(G, allTowns(G), correct ? -0.1 : 0.1);
      ok('一部の負荷遮断で全体を守った。停電の影響が半分で済んだ。', '対処が遅れ、停電が広がった。町の信用が下がった。');
      break;
    case 'reserve':
      if (correct) G.buffs.shieldUntil = G.t + month;
      ok('予備力の考え方を見直した。これから30日のうち、次の故障1回は被害なしで済む。', '見直しはできなかった（被害はなし）。');
      break;
    case 'trLoss':
      if (correct && x) x.lossK = (x.lossK || 1) * 0.9;
      ok('負荷率を見直して、この変電所の損失が 10% 減った。', '損失はそのまま（被害はなし）。');
      break;
    case 'trParallel':
      if (!correct && x) {
        x.downUntil = G.t + 120;
        G.yen -= x.cost * 0.05;
      }
      ok('変圧比をそろえて、並行運転を始められた。', '循環電流で変圧器が1台焼けた（修理に5日）。');
      break;
    case 'trShare':
      if (x) (x.failK = correct ? 0.7 : 3), (x.failUntil = G.t + 24 * (correct ? 30 : 10));
      ok('負荷の偏りを直した。この変電所の故障は、30日間 起きにくくなる。', '過負荷のままで、10日間 故障しやすくなった。');
      break;
    case 'lineOver':
      if (x && correct) (x.graceUntil = G.t + 48), (x.overH = 0);
      if (x && !correct) (x.downUntil = G.t + 12), (x.overH = 0);
      ok('流れを振り替えて、過負荷をしのいだ（2日間は切れない）。', '保護で送電線が切れ、その先が停電した（半日）。');
      break;
    case 'factoryPf':
      if (correct) G.buffs.capDiscount = true;
      ok('必要な容量を見積もれたので、次の進相コンデンサの費用が 30% 安くなる。', '見積もりを誤った（被害はなし）。');
      break;
    case 'motor':
      if (!correct) repHit(G, [inc.town], 0.2);
      ok('始動の方法を直してもらい、ちらつきが止まった。', 'ちらつきが続き、この町からの申し込みが減った。');
      break;
    case 'lightning':
      scaleOutage(G, inc, correct ? 0 : 1.5, correct ? 0.5 : 1.5);
      ok('再閉路ですぐに送電が戻った。', '点検が終わるまで停電が続いた。');
      break;
    case 'backFlash':
      scaleOutage(G, inc, correct ? 0.5 : 1);
      if (correct && x) x.fix = { ...(x.fix || {}), thunder: 0.5 };
      ok('塔脚の接地抵抗を下げた。この送電線の雷事故は、これから半分になる。', '対策は見送り（標準の被害）。');
      break;
    case 'arc':
      scaleOutage(G, inc, correct ? 0 : 1.5, correct ? 0.5 : 1.5);
      ok('アークが消えて、送電を続けられた。', '事故が広がり、送電線が止まる時間が延びた。');
      break;
    case 'drought': {
      const e = evOn(G, 'drought');
      if (correct && e) e.eased = true;
      if (!correct) repHit(G, allTowns(G), 0.1);
      ok('火力を前もって動かし、需要家にも協力してもらった（渇水の間、需要 −10%・水力の落ち込みも小さい）。', '手当てが遅れ、ピークの時間に負荷遮断が出た。町の信用が下がった。');
      break;
    }
    default:
      text = '';
  }
  addReport(G, { title: INCIDENTS[inc.key].title, what: `${inc.what || ''}${correct ? '【正しく対処】' : '【対処を誤った】'}${text}`, units: INCIDENTS[inc.key].units, ok: correct });
  return text;
}

// ---- 出来事（設計 2章） ----
export const EVENTS = {
  heat: { name: '猛暑', days: 10, text: '需要が 15% 増える' },
  cold: { name: '厳冬', days: 10, text: '需要が 15% 増える' },
  typhoon: { name: '台風', days: 5, text: '送電線の事故が増える。海沿いは塩害' },
  snowstorm: { name: '大雪', days: 3, text: '雪の地域の送電線の事故が増える' },
  coalSpike: { name: '石炭価格の高騰', days: 60, text: '石炭が 1.8 倍に値上がり（長期契約は次の見直しまで据え置き）' },
  priceWar: { name: '電力戦', days: 60, text: '競争で料金が 20% 下がる' },
  drought: { name: '渇水', days: 30, text: '水力の出力が 4 割に落ちる' },
};
export function startEvent(G, lc, key) {
  if (evOn(G, key)) return;
  const E = EVENTS[key];
  G.events.push({ key, at: G.t, until: G.t + 24 * E.days });
  note(G, `${E.name}（${E.text}）`);
  addReport(G, { title: E.name, what: `${E.text}。${E.days}日間。`, units: key === 'drought' ? INCIDENTS.drought.units : [] });
  if (key === 'coalSpike') G.fuel.base = 1.8;
  if (key === 'drought' && G.plants.some((p) => !P(p).coal && p.readyAt <= G.t)) raise(G, lc, 'drought', { what: '渇水で水力の出力が 4 割まで落ちた。', cool: 24 * 30 });
}

// ---- 1日に1回（0時）：申し込み・出来事・保守費・燃料の値段・信用の回復 ----
function daily(G, lc) {
  const t = G.t;
  const day = Math.floor(t / 24);
  const s = seasonOf(t);
  G.events = G.events.filter((e) => e.until > t || (e.key === 'coalSpike' && ((G.fuel.base = 1), false)));
  // 季節の出来事・時代の出来事
  const roll = (p) => rnd(G) < p;
  if (s === 1 && roll(0.006)) startEvent(G, lc, 'heat');
  if (s === 3 && roll(0.006)) startEvent(G, lc, 'cold');
  if ((s === 1 || s === 2) && roll(0.01)) startEvent(G, lc, 'typhoon');
  if (s === 3 && roll(0.01)) startEvent(G, lc, 'snowstorm');
  if (G.era >= 3 && roll(0.003)) startEvent(G, lc, 'coalSpike');
  if (G.era >= 3 && roll(0.002)) startEvent(G, lc, 'priceWar');
  if (G.era >= 4 && roll(0.003)) startEvent(G, lc, 'drought');
  // 燃料：スポットは毎日 ±30%（平均は長期契約の 0.85 倍）。長期契約は1年ごとに見直し
  G.fuel.spot = G.fuel.base * 0.85 * (0.7 + 0.6 * rnd(G));
  if (day % YEAR_DAYS === 0) G.fuel.contract = G.fuel.base;
  // 保守費：建設費の 0.05%（点検を延ばすと半分）
  const assets = [...G.plants, ...G.lines, ...G.subs].reduce((a, x) => a + x.cost, 0);
  const m = assets * 0.0005 * (G.maint === 'defer' ? 0.5 : 1);
  G.yen -= m;
  G.acc.maint += m;
  G.yr.profit -= m;
  // 接続の申し込み：受けた需要＋保留中が D_max を下回ると届く。停電の少ない町ほど届きやすい
  const used = G.loads.reduce((a, l) => a + l.kw, 0) + G.apps.reduce((a, l) => a + l.kw, 0);
  const towns = nodesOf(G).filter((n) => n.town && townActive(G, n));
  const repAvg = towns.reduce((a, n) => a + (G.rep[n.id] ?? 1), 0) / towns.length;
  if (used < lc.dmax - 1 && G.apps.length < 5 && roll(0.6 * repAvg)) {
    const town = pickWeighted(G, towns.map((n) => [n.id, (G.rep[n.id] ?? 1) * appWeight(G, n)]));
    const type = pickWeighted(G, Object.entries(LOAD_MIX[Math.min(G.era, 4)]));
    const raw = lc.dmax * (0.05 + 0.15 * rnd(G));
    const kw = Math.max(1, Math.min(raw, lc.dmax - used));
    const r = kw >= 100 ? Math.round(kw / 10) * 10 : Math.round(kw);
    const app = { id: `A${G.nextId++}`, town, type, kw: Math.max(1, r), at: t };
    G.apps.push(app);
    G.acc.apps++;
    if (type === 'factory') raise(G, lc, 'factoryPf', { what: `${nodeOf(G, town).name}の工場（${fmtKw(app.kw)}、力率 0.75）から申し込みが来た。`, cool: 24 * 30 });
  }
  // ときどき起きる相談ごと（故障ではない）
  const month = 24 * MONTH_DAYS;
  const acOn = G.plants.filter((p) => P(p).ac && p.readyAt <= t);
  if (acOn.length >= 2 && roll(0.03)) {
    const biggest = Math.max(...acOn.map((p) => p.kw));
    const peak = Math.max(...Array.from({ length: 24 }, (_, h) => [...townForecast(G, t + h).values()].reduce((a, b) => a + b, 0)));
    if (G.reserve * peak < Math.min(biggest, peak)) raise(G, lc, 'reserve', { what: `予備力の目標（${fmtKw(G.reserve * peak)}）が、最大の発電機1台分（${fmtKw(biggest)}）より小さい。`, cool: month });
  }
  for (const sub of G.subs) {
    if (sub.readyAt > t) continue;
    const pair = G.subs.filter((x) => x.town === sub.town && x.readyAt <= t).length >= 2;
    if (roll(0.02)) raise(G, lc, pair && roll(0.5) ? 'trShare' : 'trLoss', { sub: sub.id, what: `${nodeOf(G, sub.town).name}の変電所から報告が来た。`, cool: month });
  }
  const fac = G.loads.find((l) => l.type === 'factory' && G.loads.some((o) => o.town === l.town && o.type !== 'factory'));
  if (fac && roll(0.02)) raise(G, lc, 'motor', { town: fac.town, what: `${nodeOf(G, fac.town).name}で、工場のモータが回り始めるたびに電灯がちらつく。`, cool: month });
  // 年の変わり目：スコアを残す
  if (day > 0 && day % YEAR_DAYS === 0) closeYear(G);
}
// 申し込みの届きやすさ。古い島：中央の町が2倍。日本列島（1.6.0）：町の大きさ（大・中・小）で 3:2:1、
// まだ線も需要もない町は 0.3 倍（町が多いので、遠い町の申し込みばかりで保留が埋まらないように）
export function appWeight(G, n) {
  if (!isJapan(G)) return n.id === 'T1' ? 2 : 1;
  const reached = n.id === startId(G) || G.loads.some((l) => l.town === n.id) || G.lines.some((l) => l.a === n.id || l.b === n.id);
  return (n.size || 1) * (reached ? 1 : 0.3);
}
function closeYear(G) {
  const y = { ...G.yr, okRate: G.yr.hours ? G.yr.okH / G.yr.hours : 1 };
  G.years.push(y);
  if (G.years.length > 6) G.years.shift();
  if (!G.best || y.profit > G.best.profit) G.best = y;
  note(G, `${y.idx + 1}年目の決算：利益 ${Math.round(y.profit).toLocaleString('ja-JP')} 円`);
  G.yr = newYear(y.idx + 1);
}

export function fmtKw(kw) {
  if (kw >= 1000) return `${(kw / 1000).toFixed(kw >= 10000 ? 0 : 1).replace(/\.0$/, '')} MW`;
  return `${kw >= 100 ? Math.round(kw) : Math.round(kw * 10) / 10} kW`;
}

// ---- 故障（設計 8章）。確率はゲームの1日あたり → 1時間あたりに直して判定 ----
export function plantFailRate(G, p, t, lc) {
  const age = Math.max(0, (t - p.builtAt) / (24 * YEAR_DAYS));
  const perf = P(p).ac ? ((lc.perf[P(p).perf] || 0) + (lc.perf.gen || 0)) / 2 : lc.perf.dc || 0;
  return 0.005 * (1 + 0.1 * age) * (G.maint === 'defer' ? 2.5 : 1) * (p.proto ? 3 : 1) * (1 - 0.5 * perf);
}
function failures(G, lc, prev) {
  const t = G.t;
  const trip = new Set();
  const shielded = () => {
    if ((G.buffs.shieldUntil || 0) > t) {
      G.buffs.shieldUntil = 0;
      note(G, '予備力の見直しのおかげで、故障1回を被害なしでしのいだ');
      return true;
    }
    return false;
  };
  const prot = 1 - 0.3 * (lc.perf.prot || 0); // 保護の単元の定着で、止まる時間が短くなる
  for (const p of G.plants) {
    if (!p.on || p.downUntil > t) continue;
    if (rnd(G) >= plantFailRate(G, p, t, lc) / 24) continue;
    if (shielded()) continue;
    const dur = Math.round((24 + 48 * rnd(G)) * prot);
    const cost = p.cost * 0.05;
    G.yen -= cost;
    G.acc.repair += cost;
    G.yr.profit -= cost;
    G.acc.fails++;
    trip.add(p.id);
    p._fail = { dur, cost };
  }
  for (const l of G.lines) {
    if (l.readyAt > t || lineCircuits(l, t) <= 0) continue;
    const hz = lineHazard(G, l, t, lc);
    if (rnd(G) >= hz.perDay / 24) continue;
    if (shielded()) continue;
    const cause = pickWeighted(G, [['other', 1], ['thunder', hz.m.thunder - 1], ['coast', hz.m.coast - 1], ['snow', hz.m.snow - 1]]);
    const dur = Math.round((12 + 36 * rnd(G)) * prot * (optOn(l, 'petersen', t) && cause === 'other' ? LINE_OPTS.petersen.k : 1));
    const cost = l.cost * 0.05;
    const circuit = l.n - (l.c1Until > t ? 1 : 0) >= 2; // 2回線以上あれば、止まるのは1回線
    if (circuit) l.c1Until = t + dur;
    else l.downUntil = t + dur;
    G.yen -= cost;
    G.acc.repair += cost;
    G.yr.profit -= cost;
    G.acc.fails++;
    const name = lineName(G, l);
    const why = { other: '設備の故障', thunder: '雷', coast: '塩害（がいしの汚れ）', snow: '着雪・ギャロッピング' }[cause];
    const info = { line: l.id, dur, cost, circuit, what: `${name}が${why}で止まった（${circuit ? '1回線' : '全回線'}）。` };
    const key = cause === 'thunder' ? (optOn(l, 'gw', t) ? 'backFlash' : 'lightning') : cause === 'coast' ? 'salt' : cause === 'snow' ? 'gallop' : G.era >= 4 && l.km >= 50 && !optOn(l, 'petersen', t) ? 'arc' : null;
    const inc = key && raise(G, lc, key, { ...info, cool: 6 });
    if (!inc) addReport(G, { title: `${name}の故障`, what: `${info.what}修理に ${dur}時間。`, why, units: INCIDENTS[key || 'lightning'].units });
    note(G, `${name}が${why}で止まった`);
  }
  for (const s of G.subs) {
    if (s.readyAt > t || s.downUntil > t) continue;
    const age = Math.max(0, (t - s.builtAt) / (24 * YEAR_DAYS));
    const util = prev?.subs?.[s.town] || 0;
    const rate = 0.002 * (1 + 0.1 * age) * (util > 1.2 ? 3 : 1) * (s.failUntil > t ? s.failK : 1) * (1 - 0.5 * (lc.perf.tr || 0)) * (G.maint === 'defer' ? 2.5 : 1);
    if (rnd(G) >= rate / 24) continue;
    if (shielded()) continue;
    const dur = Math.round((24 + 48 * rnd(G)) * prot);
    const cost = s.cost * 0.05;
    s.downUntil = t + dur;
    G.yen -= cost;
    G.acc.repair += cost;
    G.yr.profit -= cost;
    G.acc.fails++;
    const name = `${nodeOf(G, s.town).name}の変電所`;
    addReport(G, { title: `${name}の変圧器が故障`, what: `${name}の変圧器（${s.mva} MVA）が止まった。修理に ${dur}時間。${util > 1.2 ? '定格の 120% を超えて使っていた。' : ''}`, why: util > 1.2 ? '過負荷' : '設備の故障', units: INCIDENTS.trLoss.units });
    note(G, `${name}の変圧器が故障`);
  }
  return trip;
}
export function lineName(G, l) {
  return `${nodeOf(G, l.a).name}〜${nodeOf(G, l.b).name}の${LINES[l.kind].short}`;
}

// ---- 1刻み（ゲームの1時間）進める ----
export function step(G, lc) {
  const t = G.t;
  if (t % 24 === 0) daily(G, lc);
  // 運転開始（建設が終わった）：交流の発電機は並列投入、変圧器の2台目は並行運転
  for (const p of G.plants) {
    if (p.done || p.readyAt > t) continue;
    p.done = true;
    note(G, `${nodeOf(G, p.site).name}の${P(p).short}（${fmtKw(p.kw)}）が運転を始めた`);
    if (P(p).ac) raise(G, lc, 'parallelIn', { plant: p.id, what: `${nodeOf(G, p.site).name}の${P(p).short}（${fmtKw(p.kw)}）を、系統に並列投入する。`, cool: 1 });
  }
  for (const s of G.subs) {
    if (s.done || s.readyAt > t) continue;
    s.done = true;
    if (G.subs.filter((x) => x.town === s.town && x.done).length >= 2) raise(G, lc, 'trParallel', { sub: s.id, what: `${nodeOf(G, s.town).name}の変電所で、2台目の変圧器の並行運転を始める。`, cool: 1 });
  }
  for (const l of G.lines) if (!l.done && l.readyAt <= t) (l.done = true), note(G, `${lineName(G, l)}が開通した`);

  const trip = failures(G, lc, G.last);
  const sol = solve(G, lc, t, { trip });
  const tripNet = new Map();
  for (const r of sol.results) for (const id of r.tripped) tripNet.set(id, r);
  for (const p of G.plants) {
    if (!trip.has(p.id)) continue;
    p.on = false;
    p.onAt = null;
    p.downUntil = t + p._fail.dur;
    // 発電機の故障の事故（予備力が足りたかどうかで問題が変わる）
    const r = tripNet.get(p.id);
    const short = !!r && (r.shed > 0 || r.black);
    const what = `${nodeOf(G, p.site).name}の${P(p).short}（${fmtKw(p.kw)}）が故障で止まった。${short ? '予備力が足りず、周波数が大きく下がった。' : ''}`;
    const inc = P(p).ac && raise(G, lc, short ? 'genShort' : 'genTrip', { plant: p.id, dur: p._fail.dur, cost: p._fail.cost, what, cool: 6 });
    if (!inc) addReport(G, { title: `${P(p).short}の故障`, what: `${what}修理に ${p._fail.dur}時間。`, why: '設備の故障', units: P(p).ac ? INCIDENTS.genTrip.units : INCIDENTS.dcDrop.units });
    note(G, `${nodeOf(G, p.site).name}の${P(p).short}が故障`);
    delete p._fail;
  }

  // お金と記録
  const quality = new Map();
  let fuel = 0, loss = 0, worst = 0, anyShed = false, anyBlack = false, anyBad = false, hzLoad = -1;
  const last = { t, plants: {}, lines: {}, subs: {}, towns: {}, x: 0, hz: 0, demand: 0, served: 0, loss: 0, cap: 0, K: 0 };
  const gen = { dc: 0, coal: 0, hydro: 0 };
  const price = fuelPrice(G, t) * (1 - 0.05 * (lc.perf.econ || 0));
  for (const r of sol.results) {
    const net = r.net;
    const bad = !net.dc && Math.abs(r.x) > FREQ.ok;
    for (const n of net.nodes) if (bad) quality.set(n, 0.95);
    if (bad && r.load > 0) anyBad = true;
    if (r.shed > 0) anyShed = true;
    if (r.black) anyBlack = true;
    // 上の帯の周波数：いちばん乱れている網（同じなら需要の大きい網）。網ごとに 50 Hz／60 Hz が違うことがある（1.6.0）
    if (!net.dc && net.plants.length) {
      const ax = Math.abs(r.x), aw = Math.abs(worst);
      if (ax > aw + 1e-12 || (ax >= aw - 1e-12 && r.load > hzLoad)) (worst = r.x), (last.hz = r.hz), (hzLoad = r.load);
    }
    if (!net.dc && r.K) last.K = Math.max(last.K, r.K);
    for (const p of net.plants) {
      const o = r.out.get(p.id) || 0;
      last.plants[p.id] = o;
      if (P(p).coal) fuel += (o / plantEff(p, lc)) * price; // 捨てた分（最低出力のための余り）も燃料は使う
      gen[!P(p).ac ? 'dc' : P(p).coal ? 'coal' : 'hydro'] += o;
      if (p.type === 'pond') p.store = Math.max(0, Math.min(p.kw * POND_HOURS, p.store + p.kw * flowFactor(G, t) * (POND_HOURS / 24) - o));
    }
    loss += r.loss;
    last.cap += r.cap;
    for (const e of net.edges) {
      const f = r.flows.get(e.id);
      if (!f) continue;
      // 向き（1.5.1）：treeFlows の流れは親 → 子。f.p が正なら子の側へ、負なら子の側から流れ出す。to＝電気が流れ込む側の地点
      last.lines[e.id] = { util: f.util, loss: f.loss, p: Math.abs(f.p), to: f.p >= 0 ? f.child : f.child === e.a ? e.b : e.a };
      // 送れる量の 120% を超えると温度が上がる。2時間続くと保護で切れる
      if (f.util > 1.2) {
        if (!e.overH && e.graceUntil <= t) raise(G, lc, 'lineOver', { line: e.id, what: `${lineName(G, e)}の使用率が ${Math.round(f.util * 100)}% になった。`, cool: 48 });
        e.overH = (e.overH || 0) + 1;
        if (e.overH >= 2 && !((e.graceUntil || 0) > t)) {
          e.downUntil = t + 12;
          e.overH = 0;
          addReport(G, { title: `${lineName(G, e)}が過負荷で切れた`, what: `送れる量の 120% を超えたまま2時間たち、保護装置が働いた。半日止まる。`, why: '過負荷', units: INCIDENTS.lineOver.units });
          note(G, `${lineName(G, e)}が過負荷で切れた`);
        }
      } else e.overH = 0;
      // 直流の配電線の末端で電圧が大きく下がった
      if (net.dc && f.p > 0 && f.loss / f.p > 0.1) raise(G, lc, 'dcDrop', { town: nodeOf(G, e.b).town ? e.b : e.a, line: e.id, what: `${lineName(G, e)}の末端で、電圧が 1 割以上 下がっている。`, cool: 24 * 30 });
    }
    if (r.subs) for (const [n, s] of r.subs) last.subs[n] = s.util;
    if (r.black && !r.noGen && r.bs !== undefined) {
      addReport(G, { title: '全域停電', what: `周波数が ${FREQ.black} Hz を超えて下がり、発電機が保護で外れた。${r.bs ? 'ブラックスタートできる電源から、6時間で復旧する。' : 'ブラックスタートできる電源がなく、復旧に3日かかる。'}`, why: '予備力の不足', units: INCIDENTS.genShort.units });
      note(G, '全域停電が起きた');
      G.blackoutFx = true;
    } else if (r.shed > 0) {
      addReport(G, { title: `負荷遮断（第${r.shed > 0.1 ? 2 : 1}段）`, what: `周波数が ${r.x0.toFixed(2)} Hz 下がりそうになり、需要の ${Math.round(r.shed * 100)}% を切り離した。`, why: '予備力の不足', units: INCIDENTS.genShort.units });
    }
    if (r.over) addReport(G, { title: '周波数の上がりすぎ', what: '需要が急に減り、発電機が1台 保護で外れた。', why: '需要の急減', units: INCIDENTS.genTrip.units });
  }
  for (const n of sol.dim) (anyBad = true), quality.set(n, 0.95);
  let rev = 0, demand = 0, served = 0;
  const war = evOn(G, 'priceWar', t) ? 0.8 : 1;
  const f0 = townForecast(G, t);
  for (const [n, d] of sol.dem) {
    const ratio = Math.min(1, sol.served.get(n) || 0);
    demand += d.a;
    served += d.a * ratio;
    last.towns[n] = { d: d.a, r: ratio };
    // 停電のあった町は申し込みが減る（1か月で回復）
    if (ratio < 0.95) G.rep[n] = Math.max(0.2, (G.rep[n] ?? 1) - 0.02);
    const k = (f0.get(n) || 0) > 0 ? d.a / f0.get(n) : 0;
    for (const ld of G.loads) if (ld.town === n) rev += loadKw(G, ld, t) * k * ratio * LOADS[ld.type].rate * war * (quality.get(n) || 1);
  }
  for (const n of Object.keys(G.rep)) G.rep[n] = Math.min(1, G.rep[n] + 1 / (24 * MONTH_DAYS));
  let loan = 0;
  if (G.loanUntil > t) loan = rev * 0.2; // 借入れの返済：収入の 20%
  G.yen += rev - loan - fuel;
  G.negHours = G.yen < 0 ? G.negHours + 1 : 0;
  if (G.negHours >= 72 && !G.rebuild) {
    G.rebuild = true; // 経営再建（設計 10章）
    addReport(G, { title: '経営再建', what: '収益の残高がマイナスのまま3日たった。設備を手放すか、借入れを選ぶ。', why: '燃料費・修理費が収入を上回った', units: ['power-system-U05'] });
    note(G, '経営再建が必要になった');
  }
  const unserved = demand - served;
  const a = G.acc;
  a.hours++;
  a.rev += rev;
  a.fuel += fuel;
  a.loan += loan;
  a.unserved += unserved;
  if (anyShed) a.shedH++;
  if (anyBlack) a.blackH++;
  if (anyBad) a.badH++;
  const y = G.yr;
  y.hours++;
  y.profit += rev - loan - fuel;
  y.unserved += unserved;
  y.served += served;
  if (!anyBad && !anyShed && !anyBlack) y.okH++;
  Object.assign(last, { x: worst, demand, served, loss, rev, fuel, shed: anyShed, black: anyBlack });
  G.last = last;
  if (demand > 0) G.lossRatio = Math.min(0.5, 0.8 * G.lossRatio + 0.2 * (loss / Math.max(served, 1e-9)));
  G.hist.push([t, Math.round(demand * 10) / 10, Math.round(served * 10) / 10, Math.round(gen.dc * 10) / 10, Math.round(gen.coal * 10) / 10, Math.round(gen.hydro * 10) / 10, Math.round(worst * 100) / 100]);
  if (G.hist.length > 168) G.hist.shift();
  G.t = t + 1;
}

// 現実の時刻まで進める（閉じていた分は開いたときに計算。上限は現実の14日）。戻り値：進めた刻みの数
// 学習の状況を系統に映す：性能の上乗せの最大値と、時代が進んだこと
export function applyLearning(G, lc) {
  // 性能の上乗せは、これまでの最大値を残す（下がらない）
  for (const k of Object.keys(lc.perf)) G.perfMax[k] = Math.max(G.perfMax[k] || 0, lc.perf[k]);
  if (lc.era > G.era) {
    const before = G.era;
    G.era = lc.era;
    G.eraUp = lc.era;
    G.eraUpFrom = Math.min(G.eraUpFrom ?? before, before); // 演出を見る前に2つ進んだときも、開いたエリアをまとめて出す
    const E = ERAS[lc.era - 1];
    note(G, `時代が ${E.name} に進んだ`);
    const opened = openedAreas(G, before, lc.era);
    if (opened.length) note(G, `${opened.join('・')}が開いた`);
    const facts = isJapan(G) ? J.ERA_FACTS[lc.era] || [] : [];
    addReport(G, { title: `時代が進んだ：${E.name}（${E.year}）`, what: `新しい設備と需要が登場する。${opened.length ? `建てられる範囲が広がった（${opened.join('・')}）。` : ''}${facts.length ? `史実：${facts.join('。')}（確かめた）。` : ''}`, units: [] });
  }
}
// 時代 from → to で新しく開いたエリア（日本列島。エリアの町か水力の地点のどれかが開いたら）
export function openedAreas(G, from, to) {
  if (!isJapan(G)) return [];
  const out = [];
  for (const area of J.AREAS) {
    const ns = nodesOf(G).filter((n) => n.area === area);
    const was = ns.some((n) => openEra(G, n) <= from), now = ns.some((n) => openEra(G, n) <= to);
    if (now && !was) out.push(area);
  }
  return out;
}
// 開いている間に期限（ゲームの1日）が来た事故を、標準の被害で片づける
export function expireIncidents(G) {
  for (const inc of [...G.incidents]) {
    if (inc.deadline > G.t) continue;
    G.incidents.splice(G.incidents.indexOf(inc), 1);
    addReport(G, { title: INCIDENTS[inc.key].title, what: `${inc.what || ''}ゲームの1日のあいだ対処せず、標準の被害で片づいた。`, units: INCIDENTS[inc.key].units });
  }
}
export function catchUp(G, lc, nowMs) {
  applyLearning(G, lc);
  let steps = Math.floor((nowMs - G.realAt) / HOUR_MS);
  if (steps <= 0) return 0;
  if (steps > MAX_CATCHUP) {
    G.realAt += (steps - MAX_CATCHUP) * HOUR_MS;
    steps = MAX_CATCHUP;
  }
  for (let i = 0; i < steps; i++) step(G, lc);
  G.realAt += steps * HOUR_MS;
  if (steps > 1) {
    // 閉じている間に溜まった事故は、開いてからゲームの1日のあいだ待つ
    for (const inc of G.incidents) inc.deadline = Math.max(inc.deadline, G.t + 24);
  } else expireIncidents(G);
  return steps;
}
// 開いたときのまとめを取り出して、積み上げを空にする
export function takeSummary(G) {
  const a = G.acc;
  G.acc = newAcc();
  return { ...a, profit: a.rev - a.fuel - a.maint - a.repair - a.loan };
}

// ---- 建設（学習通貨。支出の記録は呼び出し側）----
// 時代：今の時代までは 'ok'、次の時代のものは 'proto'（試作：建設費3倍・故障率3倍・効率は下限）、それより先は 'no'
export function eraStatus(lc, era, level = 0) {
  if (era > MAX_ERA) return 'no';
  if (era <= lc.era) return level && lc.level < level ? 'proto' : 'ok';
  return era === lc.era + 1 ? 'proto' : 'no';
}
const missing = (lc, gates) => gates.filter((g) => !lc.gate[g]);
const gateText = (keys) => `「${keys.map((k) => GATE_NAMES[k]).join('」「')}」の単元で、まだ1問も正解していない`;
const buildHours = (base, lc, perf) => Math.max(1, Math.round(base * (1 - 0.3 * (lc.perf[perf] || 0))));
// 建てられる場所か
export function siteAllows(G, type, siteId) {
  const n = nodeOf(G, siteId);
  const at = PLANTS[type].at;
  if (at === 'town') return !!n.town;
  if (at === 'coal') return !!n.town || !!n.coal;
  if (at === 'bigcoal') return !!n.coal || (!!n.town && n.tags.includes('coast'));
  if (at === 'hydro') return !!n.hydro;
  return !!n.hydro && !!n.pond;
}
// 発電所の見積もり。{ ok, cost, hours, proto, why }
// 交流の網（線でつながった地点。工事中・止まっている線も含む）の地点の集まり
export function acComponent(G, id) {
  const adj = new Map();
  for (const l of G.lines) {
    if (LINES[l.kind].dc) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l.b);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l.a);
  }
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) for (const m of adj.get(stack.pop()) || []) if (!seen.has(m)) seen.add(m), stack.push(m);
  return seen;
}
// その地点の交流の網の周波数（1.6.0：系統ごと）。網の中の交流の発電機の周波数。なければ古い島の周波数（G.hz）、それもなければ null
export function netHz(G, id) {
  const c = acComponent(G, id);
  return G.plants.find((p) => PLANTS[p.type].ac && p.hz && c.has(p.site))?.hz || G.hz || null;
}
// 画面に出す周波数：いちばん乱れている網（なければ古い島の周波数）。使っている周波数の一覧
export const freqNow = (G) => G.last?.hz || G.hz || null;
export const hzList = (G) => [...new Set(G.plants.filter((p) => PLANTS[p.type].ac && p.hz).map((p) => p.hz))].sort();
export const HZ_WHY = '周波数が違う網どうしはつなげない（周波数変換所ができるのは 1965 年の佐久間から）';
export const SEA_WHY = '海をこえて島どうしをつなぐ線は、まだ作れない（1945 年の九州と本州の連系から）';
export function quotePlant(G, lc, { type, kw, site, hz = null }) {
  const D = PLANTS[type];
  const size = D.sizes.find((s) => s[0] === kw);
  if (!size) return { ok: false, why: '大きさが選べない' };
  const st = eraStatus(lc, Math.max(D.era, size[2]?.era || 0));
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  if (!siteAllows(G, type, site)) return { ok: false, why: 'この場所には建てられない' };
  if (!nodeOpen(G, site)) return { ok: false, why: closedWhy(G, nodeOf(G, site)), closed: true };
  const miss = missing(lc, D.gates);
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  const bp = D.blueprint || size[2]?.blueprint;
  if (bp && !lc.blueprint[bp]) return { ok: false, why: `設計図「${BLUEPRINTS[bp].name}」がない（試験レベルに正解するか、関係する外部試験で3割以上）`, blueprint: bp };
  const node = nodeOf(G, site);
  if (node.hydro && !node.town) {
    const used = G.plants.filter((p) => p.site === site).reduce((a, p) => a + p.kw, 0);
    if (used + kw > node.hydro) return { ok: false, why: `この川で使える水は ${fmtKw(node.hydro)} まで（いま ${fmtKw(used)}）` };
  }
  // 交流の発電機：まだ周波数のない網に初めて建てるときは、50 Hz／60 Hz を選ぶ（hz）。ある網なら、その周波数になる
  const netF = D.ac ? netHz(G, site) : null;
  if (D.ac && !netF && hz !== 50 && hz !== 60) return { ok: false, why: '先に周波数（50 Hz／60 Hz）を決める', hz: true };
  const proto = st === 'proto';
  let cost = size[1] * (proto ? 3 : 1);
  if (!D.ac && G.buffs.dcDiscount) cost *= 0.8;
  return { ok: true, cost: Math.round(cost), hours: buildHours(D.build, lc, D.perf), proto, ...(D.ac ? { freq: netF || hz, newHz: !netF } : {}) };
}
export function buildPlant(G, lc, spec) {
  const q = quotePlant(G, lc, spec);
  if (!q.ok) return q;
  if (!PLANTS[spec.type].ac) G.buffs.dcDiscount = false;
  const p = { id: `P${G.nextId++}`, type: spec.type, kw: spec.kw, site: spec.site, cost: q.cost, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, on: false, onAt: null, downUntil: 0, idle: false, store: 0, hold: 0, done: false };
  if (q.freq) p.hz = q.freq; // 交流の発電機の周波数（網が分かれたり、つながったりしても変えない）
  if (q.newHz) addReport(G, { title: `周波数を ${q.freq} Hz に決めた`, what: `${nodeOf(G, spec.site).name}の交流の網は、これから ${q.freq} Hz で動く。周波数の違う網とは線でつなげない（網が分かれたり、つながったりしても、発電機の周波数は変わらない）。`, units: [] });
  G.plants.push(p);
  // 燃料のいらない水力は、優先順位の先頭に入れる（あとで並べ替えられる）
  if (PLANTS[spec.type].coal) G.priority.push(p.id);
  else G.priority.unshift(p.id);
  return { ...q, plant: p };
}
// 2つの地点が、同じ種類の網ですでにつながっているか（輪になる線は作れない。1.5.0 の計算は木の形だけ）
function connected(G, a, b, dc) {
  const adj = new Map();
  for (const l of G.lines) {
    if (!!LINES[l.kind].dc !== dc) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l.b);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l.a);
  }
  const seen = new Set([a]);
  const stack = [a];
  while (stack.length) for (const m of adj.get(stack.pop()) || []) if (!seen.has(m)) seen.add(m), stack.push(m);
  return seen.has(b);
}
export function quoteLine(G, lc, { a, b, kind, route = 'direct', opts = {} }) {
  const K = LINES[kind];
  if (!K || a === b) return { ok: false, why: '2つの地点を選ぶ' };
  const st = eraStatus(lc, K.era, K.level);
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  if (K.dc && !(nodeOf(G, a).town && nodeOf(G, b).town)) return { ok: false, why: '直流の配電線は、町と町の間だけ' };
  for (const id of [a, b]) if (!nodeOpen(G, id)) return { ok: false, why: closedWhy(G, nodeOf(G, id)), closed: true };
  if (nodeOf(G, a).island && nodeOf(G, a).island !== nodeOf(G, b).island) return { ok: false, why: SEA_WHY, sea: true };
  if (!K.dc) {
    const ha = netHz(G, a), hb = netHz(G, b);
    if (ha && hb && ha !== hb) return { ok: false, why: `${HZ_WHY}。${nodeOf(G, a).name}は ${ha} Hz、${nodeOf(G, b).name}は ${hb} Hz`, hzDiff: true };
  }
  const gates = [...K.gates, ...Object.keys(opts).filter((o) => opts[o]).flatMap((o) => LINE_OPTS[o].gates)];
  const miss = [...new Set(missing(lc, gates))];
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  for (const o of Object.keys(opts)) {
    if (!opts[o]) continue;
    const no = optBlocked(lc, o);
    if (no) return no;
  }
  if (K.blueprint && !lc.blueprint[K.blueprint]) return { ok: false, why: `設計図「${BLUEPRINTS[K.blueprint].name}」がない（試験レベルに正解するか、関係する外部試験で3割以上）`, blueprint: K.blueprint };
  if (connected(G, a, b, !!K.dc)) return { ok: false, why: 'この2地点は、すでに線でつながっている（回線を増やすなら、今ある線を増設する）' };
  const r = routeInfo(G, a, b, route);
  const proto = st === 'proto';
  const nOpts = Object.values(opts).filter(Boolean).length;
  let cost = K.cost * r.km * (1 + OPT_K * nOpts) * (proto ? 3 : 1);
  if (K.dc && G.buffs.dcDiscount) cost *= 0.8;
  const needSub = K.hv ? [a, b].filter((id) => nodeOf(G, id).town && !G.subs.some((s) => s.town === id)) : [];
  return { ok: true, cost: Math.max(50, Math.round(cost)), km: r.km, hazards: r.hazards, hours: buildHours(12 + Math.min(228, r.km), lc, K.perf), proto, needSub };
}
export function buildLine(G, lc, spec) {
  const q = quoteLine(G, lc, spec);
  if (!q.ok) return q;
  if (LINES[spec.kind].dc) G.buffs.dcDiscount = false;
  const l = { id: `W${G.nextId++}`, a: spec.a, b: spec.b, kind: spec.kind, route: spec.route || 'direct', km: q.km, hazards: q.hazards, opts: { ...(spec.opts || {}) }, n: 1, cost: q.cost, unit: q.cost, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, downUntil: 0, c1Until: 0, graceUntil: 0, overH: 0, saltUntil: 0, done: false };
  G.lines.push(l);
  return { ...q, line: l };
}
// 回線を増やす（同じルートにもう1回線）
export function quoteCircuit(G, lc, id) {
  const l = G.lines.find((x) => x.id === id);
  if (!l) return { ok: false, why: '線がない' };
  if (l.n >= MAX_CIRCUITS) return { ok: false, why: `回線は ${MAX_CIRCUITS} つまで` };
  return { ok: true, cost: l.unit, line: l };
}
export function addCircuit(G, lc, id) {
  const q = quoteCircuit(G, lc, id);
  if (!q.ok) return q;
  q.line.n++;
  q.line.cost += q.cost;
  return q;
}
// 対策の時代・設計図（学習の単元は gates で見る）
function optBlocked(lc, o) {
  const O = LINE_OPTS[o];
  if (O.era && eraStatus(lc, O.era) !== 'ok') return { ok: false, why: `${O.name}はまだ先の時代の設備` };
  if (O.blueprint && !lc.blueprint[O.blueprint]) return { ok: false, why: `設計図「${BLUEPRINTS[O.blueprint].name}」がない`, blueprint: O.blueprint };
  return null;
}
// 1.6.1 既設の線に、後から対策を足す（費用は建設のときに足す場合の RETRO_K 倍。事故の対処の問題で付く効果 l.fix とは別に重なる）
export function optChoices(G, lc, id) {
  const l = G.lines.find((x) => x.id === id);
  if (!l || LINES[l.kind].dc) return [];
  return Object.entries(LINE_OPTS)
    .filter(([o, O]) => !l.opts[o] && (!O.era || eraStatus(lc, O.era) === 'ok'))
    .map(([o, O]) => ({ key: o, name: O.name, q: quoteLineOpt(G, lc, id, o) }));
}
export function quoteLineOpt(G, lc, id, o) {
  const l = G.lines.find((x) => x.id === id);
  const O = LINE_OPTS[o];
  if (!l || !O) return { ok: false, why: '線と対策を選ぶ' };
  const K = LINES[l.kind];
  if (K.dc) return { ok: false, why: '直流の配電線には付けられない' };
  if (l.opts[o]) return { ok: false, why: l.optAt?.[o] > G.t ? `${O.name}は工事中` : `${O.name}はもう付いている` };
  const miss = missing(lc, O.gates);
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  const no = optBlocked(lc, o);
  if (no) return no;
  const proto = eraStatus(lc, K.era, K.level) === 'proto';
  const one = K.cost * l.km * OPT_K * (proto ? 3 : 1); // 建設のときに足す場合の費用（1回線あたり）
  const cost = Math.max(50, Math.round(one * l.n * RETRO_K));
  const hours = buildHours(12 + Math.min(228, l.km), lc, K.perf);
  return { ok: true, cost, hours, line: l, opt: o, readyAt: Math.max(l.readyAt, G.t + hours), unit: Math.round(K.cost * l.km * OPT_K * (l.proto ? 3 : 1)) };
}
export function addLineOpt(G, lc, id, o) {
  const q = quoteLineOpt(G, lc, id, o);
  if (!q.ok) return q;
  const l = q.line;
  l.opts[o] = true;
  l.optAt = { ...(l.optAt || {}), [o]: q.readyAt };
  l.cost += q.cost;
  l.unit += q.unit; // これから増やす回線にも、この対策が付く
  return q;
}
export function quoteSub(G, lc, { town, mva }) {
  if (!nodeOf(G, town)?.town || !SUB_SIZES.includes(mva)) return { ok: false, why: '町と容量を選ぶ' };
  if (!nodeOpen(G, town)) return { ok: false, why: closedWhy(G, nodeOf(G, town)), closed: true };
  const st = eraStatus(lc, TR.era);
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  const miss = missing(lc, TR.gates);
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  if (G.subs.filter((s) => s.town === town).length >= 2) return { ok: false, why: '変圧器は1つの変電所に2台まで' };
  const proto = st === 'proto';
  return { ok: true, cost: subCost(mva) * (proto ? 3 : 1), hours: buildHours(TR.build, lc, TR.perf), proto };
}
export function buildSub(G, lc, spec) {
  const q = quoteSub(G, lc, spec);
  if (!q.ok) return q;
  const s = { id: `S${G.nextId++}`, town: spec.town, mva: spec.mva, cost: q.cost, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, downUntil: 0, lossK: 1, failK: 1, failUntil: 0, done: false };
  G.subs.push(s);
  return { ...q, sub: s };
}
export function quoteCap(G, lc, loadId) {
  const ld = G.loads.find((l) => l.id === loadId);
  if (!ld || !LOADS[ld.type].pfFixed || ld.cap) return { ok: false, why: '進相コンデンサを付けられる需要ではない' };
  const miss = missing(lc, ['pf']);
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  return { ok: true, cost: Math.round(CAP_COST(ld.kw) * (G.buffs.capDiscount ? 0.7 : 1)), load: ld };
}
export function addCap(G, lc, loadId) {
  const q = quoteCap(G, lc, loadId);
  if (!q.ok) return q;
  q.load.cap = true;
  G.buffs.capDiscount = false;
  return q;
}
// 手放す（撤去）：建設費の 30% が収益に戻る
export function removeAsset(G, kind, id) {
  const list = { plant: G.plants, line: G.lines, sub: G.subs }[kind];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return 0;
  const [x] = list.splice(i, 1);
  if (kind === 'plant') G.priority = G.priority.filter((p) => p !== id);
  const back = x.cost * 0.3;
  G.yen += back;
  return back;
}
export function setHz(G, hz) {
  if (!G.hz && (hz === 50 || hz === 60)) G.hz = hz;
  return G.hz;
}

// ---- 申し込み ----
// 受けたときの見込み：その需要のピークの時刻で、使える発電機がすべて動いているとして解く
export function previewApp(G, lc, appId) {
  const app = G.apps.find((a) => a.id === appId);
  if (!app) return null;
  const C = structuredClone(G);
  C.loads.push({ id: 'preview', town: app.town, type: app.type, kw: app.kw, cap: false });
  const day = Math.floor(G.t / 24) * 24;
  const t = day + peakHour(app.type) + (day + peakHour(app.type) < G.t ? 24 : 0);
  const sol = solve(C, lc, t, { dry: true, assume: true, noNoise: true });
  let line = 0, sub = 0, cap = 0, load = 0;
  for (const r of sol.results) {
    for (const f of r.flows.values()) line = Math.max(line, f.util || 0);
    for (const s of (r.subs || new Map()).values()) sub = Math.max(sub, s.util);
    cap += r.cap;
    load += r.load;
  }
  const reach = (sol.served.get(app.town) || 0) > 0.999;
  return { reach, served: sol.served.get(app.town) || 0, line, sub, cap, load, margin: load > 0 ? cap / load - 1 : 0, hour: t % 24 };
}
export function acceptApp(G, appId) {
  const i = G.apps.findIndex((a) => a.id === appId);
  if (i < 0) return null;
  const [app] = G.apps.splice(i, 1);
  const ld = { id: `L${G.nextId++}`, town: app.town, type: app.type, kw: app.kw, cap: false };
  G.loads.push(ld);
  return ld;
}

// ---- 経営再建・新しい島（設計 10章） ----
export function rebuildLoan(G) {
  G.yen = Math.max(G.yen, 0);
  G.loanUntil = G.t + 24 * 30; // 以後30日、収入の 20% を返済に回す
  G.rebuild = false;
  G.negHours = 0;
}
export function rebuildSell(G, items) {
  let back = 0;
  for (const [kind, id] of items) back += removeAsset(G, kind, id);
  if (G.yen >= 0) (G.rebuild = false), (G.negHours = 0);
  return back;
}
// 新しい島：明治の小さな島からやり直す。性能の上乗せ・前の島の記録は残す（時代と設計図は学習の記録から決まる）
// 1.6.0：「別の地方から始める」＝terrain 'japan' と始める町（start）。古い島の地形も選べる（開発者モード）
export function newIsland(G, terrain, nowMs, seed = (G.seed * 31 + 7) | 0, start = null) {
  const past = [...(G.past || []), { islandNo: G.islandNo, terrain: G.terrain, start: G.start || null, hours: G.t, years: G.years, best: G.best, last: G.yr, peak: G.loads.reduce((a, l) => a + l.kw, 0) }].slice(-10);
  return newGrid(seed, nowMs, { terrain, start, islandNo: G.islandNo + 1, perfMax: G.perfMax, past });
}
// 系統の名前（経営のパネル・開発者モード）：日本列島は始めた町、古い島は地形
export function placeName(G) {
  if (isJapan(G)) return `日本列島（${J.startOf(startId(G))?.label || nodeOf(G, startId(G))?.name || ''}から）`;
  return TERRAINS[G.terrain]?.name || '';
}

// 画面用：いまの需給のまとめ
export function overview(G, lc) {
  const t = G.t;
  const ready = G.plants.filter((p) => plantReady(p, t));
  const cap = ready.reduce((a, p) => a + capNow(G, p, t), 0);
  const peak = Math.max(...Array.from({ length: 24 }, (_, h) => [...townForecast(G, t + h).values()].reduce((a, b) => a + b, 0)), 0);
  const biggest = Math.max(0, ...ready.map((p) => p.kw));
  const accepted = G.loads.reduce((a, l) => a + l.kw, 0);
  return { cap, peak, biggest, accepted, pending: G.apps.reduce((a, l) => a + l.kw, 0), dmax: lc.dmax, reserveKw: G.reserve * peak };
}
