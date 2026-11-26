// 動く系統（1.5.0）の計算。画面や保存に依存しない部分
// 仕様：要件定義書 4.11、設計図 1.11。数値の正本は 試作/系統ゲーム_設計_v1.md
// 単位：電力 kW、電力量 kWh（1刻み＝ゲームの1時間）、お金は収益（円）。学習通貨の支出は呼び出し側が台帳に書く
import * as L from './logic.js';
import { JAPAN_NODES } from './japan.js';
import * as J from './gridjapan.js';
import * as Ms from './gridmission.js';
import { straitSea } from './gridsea.js';

// ---- 時間 ----
export const HOUR_MS = 150000; // ゲームの1時間＝現実の2.5分（1日＝1時間）
export const SEASON_DAYS = 168; // 季節＝現実の1週間
export const YEAR_DAYS = 672; // 1年＝現実の4週間
export const MONTH_DAYS = 30; // 「1か月」「30日」の効果の長さ
export const MAX_CATCHUP = 14 * 24 * 24; // 閉じていた分は現実の14日（8,064 刻み）まで
export const SEASONS = ['春', '夏', '秋', '冬'];
export const seasonOf = (t) => Math.floor(t / (24 * SEASON_DAYS)) % 4;
export const yearOf = (t) => Math.floor(t / (24 * YEAR_DAYS));

// ---- 時代（学習のレベルで進む）。1.10.0 は E4b（戦後復興）まで。E5・E6 は表だけ ----
// 1.10.0：昭和前期（E4）と高度成長の間に戦後復興（E4b）を入れ、番号を付け直した（高度成長 5 → 6、現代 6 → 7）。
// 1.9.x までは E4（4）までしか開いていなかったので、保存データの時代は 1〜4 だけ（付け直しの影響はない）
export const ERAS = [
  { n: 1, id: 'E1', name: '明治前期', year: '1887〜', level: 1 },
  { n: 2, id: 'E2', name: '明治後期', year: '1891〜', level: 3 },
  { n: 3, id: 'E3', name: '大正', year: '1912〜', level: 7 },
  { n: 4, id: 'E4', name: '昭和前期', year: '1926〜', level: 12 },
  { n: 5, id: 'E4b', name: '戦後復興', year: '1941〜', level: 16 },
  { n: 6, id: 'E5', name: '高度成長', year: '1955〜', level: 20 },
  { n: 7, id: 'E6', name: '現代', year: '', level: 30 },
];
export const MAX_ERA = 6;
export function eraOf(level) {
  let n = 1;
  for (const e of ERAS) if (level >= e.level && e.n <= MAX_ERA) n = e.n;
  return n;
}

// ---- 燃料（1.11.0 種類ごとに値段を分ける。後半の版で lng・nuclear を足せる形） ----
export const FUELS = {
  coal: { name: '石炭', base: 1, haul: true },
  oil: { name: '重油', base: 0.85, haul: false },
};
function initFuel() {
  const f = {};
  for (const [k, F] of Object.entries(FUELS)) f[k] = { base: F.base, contract: F.base, spot: F.base * 0.85 };
  return f;
}

// ---- 電源（設計 3章）。sizes：[出力 kW, 建設費（学習通貨）, 追加の条件] ----
export const PLANTS = {
  dcCoal: { name: '直流の石炭火力', short: '直流火力', era: 1, ac: false, coal: true, fuel: 'coal', eff: [0.05, 0.1], start: 4, min: 0.3, bs: true, build: 24, gates: ['dc'], perf: 'dc', at: 'town', sizes: [[25, 3000], [50, 4000], [100, 5500], [200, 8000]] },
  acCoal: { name: '石炭火力（汽力・交流）', short: '石炭火力', era: 2, ac: true, coal: true, fuel: 'coal', eff: [0.08, 0.18], start: 6, min: 0.3, bs: true, build: 72, gates: ['gen', 'coal'], perf: 'coal', at: 'coal', sizes: [[500, 15000], [1000, 18000], [2000, 24000], [5000, 40000]] },
  bigCoal: { name: '大型の石炭火力（高圧ボイラ）', short: '大型火力', era: 4, ac: true, coal: true, fuel: 'coal', eff: [0.15, 0.28], start: 12, min: 0.4, bs: false, build: 240, gates: ['gen', 'coal'], masteredGate: true, perf: 'coal', at: 'bigcoal', blueprint: 'bigCoal', sizes: [[20000, 80000], [40000, 125000], [75000, 200000], [125000, 300000, { era: 6 }]] },
  oilFire: { name: '重油専焼の火力', short: '重油火力', era: 6, ac: true, coal: true, fuel: 'oil', eff: [0.28, 0.36], start: 8, min: 0.3, bs: false, build: 360, gates: ['gen', 'coal'], masteredGate: true, perf: 'coal', at: 'coast', sizes: [[125000, 250000], [325000, 520000, { blueprint: 'bigOil' }], [600000, 840000, { blueprint: 'bigOil' }]] },
  ror: { name: '流れ込み式の水力', short: '水力（流れ込み）', era: 2, ac: true, coal: false, start: 0, min: 0, bs: true, build: 120, gates: ['gen', 'hydro'], perf: 'hydro', at: 'hydro', sizes: [[200, 20000], [500, 27000], [1000, 38000], [2000, 60000], [5000, 80000, { era: 3 }], [10000, 105000, { era: 3 }], [20000, 150000, { era: 3 }]] },
  pond: { name: '調整池式の水力', short: '水力（調整池）', era: 3, ac: true, coal: false, start: 0, min: 0, bs: true, build: 240, gates: ['gen', 'hydro'], masteredGate: true, perf: 'hydro', at: 'pond', sizes: [[5000, 60000], [10000, 76000], [20000, 107000], [50000, 200000, { blueprint: 'pond50' }]] },
  dam: { name: '貯水池式の水力（ダム）', short: '水力（ダム）', era: 6, ac: true, coal: false, start: 0, min: 0, bs: true, build: 720, gates: ['gen', 'hydro'], masteredGate: true, perf: 'hydro', at: 'dam', sizes: [[100000, 400000], [200000, 700000], [350000, 1050000, { blueprint: 'dam350' }]] },
};
export const POND_HOURS = 6; // 池の大きさ＝出力の6時間分。1日に入る水も同じ量（流量 1.0 のとき）
export const DAM_HOURS = 480; // 1.11.0 貯水池式：池＝出力の20日分（480時間分）。1時間に入る水＝出力×流量×0.4（1日に9.6時間分）

// ---- 送電・配電（設計 4章）。cap：1回線で送れる量 kW、r：Ω/km、cost：学習通貨/km ----
export const LINES = {
  dc200: { name: '直流配電 200 V', short: '直流 200 V', kv: 0.2, cap: 50, r: 0.1, cost: 100, era: 1, dc: true, gates: ['dc'], perf: 'dc' },
  // 1.6.0：距離が実寸（日本列島）になったので、km あたりの建設費を下げた（史実の主な線が、その時代の大きな発電所1つ分くらい）
  ac3: { name: '交流配電 3.3 kV', short: '交流 3.3 kV', kv: 3.3, cap: 1000, r: 0.3, cost: 150, era: 2, gates: ['dist'], perf: 'dist' },
  ac11: { name: '交流送電 11 kV', short: '交流 11 kV', kv: 11, cap: 3000, r: 0.3, cost: 250, era: 2, hv: true, gates: ['line'], perf: 'line' },
  ac22: { name: '交流送電 22 kV', short: '交流 22 kV', kv: 22, cap: 6000, r: 0.2, cost: 350, era: 2, hv: true, gates: ['line'], masteredGate: true, perf: 'line' },
  ac66: { name: '交流送電 66 kV', short: '交流 66 kV', kv: 66, cap: 30000, r: 0.1, cost: 800, era: 2, level: 5, hv: true, gates: ['line'], masteredGate: true, perf: 'line' },
  // 1.6.0：大正の 110 kV（猪苗代の 115 kV を表す）。55 kV（駒橋）・77 kV（谷村）は 66 kV で表す
  ac110: { name: '交流送電 110 kV', short: '交流 110 kV', kv: 110, cap: 70000, r: 0.07, cost: 1000, era: 3, hv: true, gates: ['line'], masteredGate: true, perf: 'line' },
  ac154: { name: '交流送電 154 kV', short: '交流 154 kV', kv: 154, cap: 150000, r: 0.05, cost: 1200, era: 4, hv: true, gates: ['line'], masteredGate: true, perf: 'line', blueprint: 'line154' },
  // 1.10.0 戦後復興の 275 kV（1952年 新北陸幹線）。送れる量は 154 kV の 150 MW を電圧の2乗で伸ばした約 478 MW → 450 MW。抵抗は太い電線・多導体で 0.03 Ω/km
  ac275: { name: '交流送電 275 kV', short: '交流 275 kV', kv: 275, cap: 450000, r: 0.03, cost: 2000, era: 5, hv: true, gates: ['line'], masteredGate: true, perf: 'line', blueprint: 'line275' },
  // 1.11.0 高度成長の 500 kV（房総線など）。275 kV で使い始めて後から 500 kV に上げることもできる（l.runKv = 275）
  ac500: { name: '交流送電 500 kV', short: '交流 500 kV', kv: 500, cap: 1500000, r: 0.015, cost: 3500, era: 6, hv: true, gates: ['line'], masteredGate: true, perf: 'line', blueprint: 'line500' },
};
export const lineKv = (l) => l?.runKv || LINES[l.kind].kv;
export const lineCap = (l) => (l?.runKv === 275 ? LINES.ac275.cap : LINES[l.kind].cap);
export const lineShort = (l) => (l?.kind === 'ac500' && l?.runKv === 275 ? '交流 500 kV（275 kV で使用中）' : LINES[l.kind].short);
export const MAX_CIRCUITS = 4;
// 建設のときに足せる対策（費用 +20% ずつ）
export const LINE_OPTS = {
  gw: { name: '架空地線', hazard: 'thunder', k: 0.5, gates: ['insul'] },
  insul: { name: '耐塩がいし', hazard: 'coast', k: 0.7, gates: ['insul'] },
  spacer: { name: '相間スペーサ', hazard: 'snow', k: 0.5, gates: ['insul'] },
  petersen: { name: '消弧リアクトル', hazard: null, k: 0.6, era: 4, gates: ['prot'], masteredGate: true, blueprint: 'petersen' },
};
// 1.6.1 後付けの対策：既設の線に後から足す。費用は建設のときに足す場合（線の費用の 20%・回線の数だけ）の RETRO_K 倍（後から工事するぶん割増）。
// 工期は線の建設と同じ式。工事の間も線は止めない（1回線ずつ・短い停止で済む工事とみなす）。効くのは工事が終わってから（l.optAt）
export const OPT_K = 0.2;
export const RETRO_K = 1.3;
export const optOn = (l, o, t) => !!l.opts?.[o] && !(l.optAt?.[o] > t);
export const HAZARD = { thunder: { name: '雷の多い地域', k: 2 }, coast: { name: '海沿い（塩害）', k: 1.5 }, snow: { name: '雪の山（冬）', k: 2 } };
export const SUB_SIZES = [0.1, 0.5, 1, 2, 5, 10, 30, 100, 300, 1000]; // MVA（1.11.0 で 300・1000 MVA は E5 から）
export const subSizeEra = (mva) => (mva >= 300 ? 6 : TR.era);
export const subCost = (mva) => Math.max(2000, Math.round(mva * 1000));
export const TR = { iron: 0.005, copper: 0.015, era: 2, build: 24, gates: ['tr'], perf: 'tr' };
// 1.10.4 電鉄用の変換所（交流を直流 600 V に変える。町に 2 台まで。変圧器が必要。値はゲームの値）
export const CONV_SIZES = [300, 1000, 3000]; // kW
export const CONVS = {
  rotary: { name: '回転変流機（電鉄用変換所）', short: '回転変流機', era: 2, eff: [0.9, 0.92], fail: 0.004, build: 18, gates: ['conv'], perf: 'conv', sizes: [[300, 1200], [1000, 3200], [3000, 8000]] },
  mercury: { name: '水銀整流器（電鉄用変換所）', short: '水銀整流器', era: 4, eff: [0.95, 0.97], fail: 0.0012, build: 16, gates: ['conv'], masteredGate: true, perf: 'conv', sizes: [[300, 1500], [1000, 4000], [3000, 10000]] },
};
export const convCost = (type, kw) => CONVS[type]?.sizes?.find((s) => s[0] === kw)?.[1] ?? Math.round(kw * 3);
export const convEff = (c, lc, G = null) => {
  const D = CONVS[c.type];
  if (!D) return 0.9;
  const [lo, hi] = D.eff;
  return c.proto ? lo : lo + (hi - lo) * perfNow(G, lc, D.perf);
};
export const convsAt = (G, town, t = G.t) => (G.convs || []).filter((c) => c.town === town && c.readyAt <= t && c.downUntil <= t);
export const convCapAt = (G, town, t = G.t) => convsAt(G, town, t).reduce((a, c) => a + c.kw, 0);
export const CAP_COST = (kw) => Math.max(500, Math.round(kw * 3)); // 進相コンデンサ
// 1.7.4 コインで払う建設費は、表の値（円の側の基準）の COIN_K 倍。設備の cost（表の値）は変えない。
// 1.10.2 円の側の設備の値打ち＝表の値 × YEN_K（保守費・修理費・撤去で戻る額・経営再建で手放す額・spendBase の下限）。コインは COIN_K のまま
export const COIN_K = 3;
export const YEN_K = 200;
export const MAINT_RATE = 0.0008; // 1日あたりの保守費（円の側の値打ちに対する割合）
export const REPAIR_RATE = 0.08; // 1回あたりの修理費
export const SELL_RATE = 0.3; // 撤去・手放すで戻る割合
export const DEBT_INTEREST = 1.1; // 借入れの利息（借りたときに1回だけ）
export const DEBT_RATE = 0.2; // 借入れ返済（収入に対する割合）
const coinOf = (base) => Math.round(base * COIN_K);
export const yenValue = (baseCost) => (baseCost || 0) * YEN_K;
export function dailyMaint(G, maint = G.maint) {
  const assets = [...G.plants, ...G.lines, ...G.subs, ...(G.convs || [])].reduce((a, x) => a + (x.cost || 0), 0);
  return yenValue(assets) * MAINT_RATE * (maint === 'defer' ? 0.5 : 1);
}
export const repairCost = (x) => yenValue(x?.cost || 0) * REPAIR_RATE;
export const removeBack = (x) => yenValue(x?.cost || 0) * SELL_RATE;

// ---- 需要（設計 5章） ----
const H24 = (f) => Array.from({ length: 24 }, (_, h) => f(h));
export const LOADS = {
  lamp: { name: '電灯', rate: 30, era: 1, pf: 1, winter: 1.15, shape: H24((h) => (h >= 18 && h <= 22 ? 1 : h === 17 || h === 23 ? 0.6 : h <= 4 ? 0.15 : h === 5 ? 0.1 : 0)) },
  home: { name: '住宅', rate: 25, era: 2, pf: 1, winter: 1.15, shape: H24((h) => (h >= 18 && h <= 21 ? 1 : h === 6 || h === 7 ? 0.7 : h === 17 || h === 22 ? 0.6 : h >= 8 && h <= 16 ? 0.3 : 0.15)) },
  shop: { name: '町の動力', rate: 22, era: 2, pf: 1, winter: 1, shape: H24((h) => (h >= 10 && h <= 15 ? 1 : h === 9 || h === 16 ? 0.7 : h === 8 || h === 17 ? 0.4 : 0.1)) },
  factory: { name: '工場（動力）', rate: 18, era: 3, pf: 0.75, pfFixed: 0.95, winter: 1, shape: H24((h) => (h >= 8 && h <= 16 ? 1 : h === 7 || h === 17 ? 0.5 : 0.15)) },
  tram: { name: '電鉄', rate: 20, era: 2, pf: 1, winter: 1, shape: H24((h) => ((h >= 6 && h <= 8) || (h >= 16 && h <= 19) ? 1 : (h >= 9 && h <= 15) || (h >= 20 && h <= 22) ? 0.6 : h === 5 ? 0.3 : h === 23 ? 0.2 : 0)) }, // 1.10.4 朝夕の山は名古屋市電の急行運転（6:30〜8:30・16〜20時、S27）に合わせたゲームの値
};
const LOAD_MIX = { 1: { lamp: 1 }, 2: { lamp: 4, home: 3, shop: 3 }, 3: { lamp: 2, home: 3, shop: 2, factory: 3 }, 4: { lamp: 2, home: 3, shop: 2, factory: 3 } };
LOAD_MIX[5] = LOAD_MIX[4]; // 1.10.0 戦後復興は昭和前期と同じ
LOAD_MIX[6] = LOAD_MIX[5]; // 1.11.0 高度成長・前半も同じ（冷房・家電は後半の版で）
const loadMix = (era) => LOAD_MIX[Math.min(Math.max(era || 1, 1), 6)];
export const peakHour = (type) => LOADS[type].shape.indexOf(Math.max(...LOADS[type].shape));
const tanOf = (pf) => Math.sqrt(1 / (pf * pf) - 1);

// 需要の上限 D_max（kW）：学習で決まる。お金では増えない
export function dmaxKw(level, mastered) {
  return 30 * Math.pow(1.4, level - 1) * (1 + mastered / 100);
}
// 1.10.0 / 1.10.2 / 1.11.0 需要の時代の倍率：D_max × ERA_K[時代]。明治 1、大正 10、昭和前期 12、戦後復興 24、高度成長 24
export const ERA_K = { 1: 1, 2: 1, 3: 10, 4: 12, 5: 24, 6: 24 };
export const eraK = (era) => ERA_K[era] ?? 1;
export const dmaxOf = (level, mastered, era = eraOf(level)) => dmaxKw(level, mastered) * eraK(era);

// ---- 学習との結びつき（設計 6章） ----
// GATES：建設できる＝どれかの単元で1問正解。PERF：性能の単元（科目ごとの定着の割合の平均の最大。これまでの最大値）
// 1.7.4：ここに書くのは 1.7.3 までの分だけ。あとから足す科目の単元は、科目定義.json の単元の grid に書く（gridTables）
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
  hzConv: ['circuit-b-U13', 'power-system-U03'], // 1.10.0 周波数をそろえる工事（三相の回転磁界＝モータの回転は周波数で決まる／周波数と系統定数）
  conv: ['denken3-kikai-U05', 'denken2-kikai-U05', 'denken3-kikai-U03', 'electronic-c-U14'], // 1.10.4 電鉄用の変換所（パワエレ・同期機・整流）
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
  conv: ['denken3-kikai-U05', 'denken2-kikai-U05', 'electronic-c-U14'], // 1.10.4 電鉄用の変換所
};
export const GATE_NAMES = { dc: '直流の配電・発電所', gen: '交流発電機（三相）', tr: '変圧器・変電所', coal: '火力（石炭・重油）', hydro: '水力', line: '送電線', dist: '配電（3.3 kV）', freq: '周波数・ガバナ・予備力', econ: '給電の優先順位', prot: '保護', insul: 'がいし・架空地線・相間スペーサ', pf: '進相コンデンサ', rel: '信頼度', hzConv: '周波数をそろえる工事', conv: '電鉄用の変換所' };
// 設計図（大型・特殊）：その単元の試験レベルに正解、または関係する外部試験の科目で取れる点が満点の3割以上
export const BLUEPRINTS = {
  bigCoal: { name: '大型の石炭火力', units: ['denken2-denryoku-U02'] },
  bigOil: { name: '大型の重油火力（32.5万 kW 以上）', units: ['denken2-denryoku-U02'] }, // 1.11.0
  pond50: { name: '調整池式 50 MW', units: ['denken2-denryoku-U01'] },
  dam350: { name: '大きなダム（35万 kW）', units: ['denken2-denryoku-U01'] }, // 1.11.0
  line154: { name: '送電線 154 kV', units: ['denken2-denryoku-U06'] },
  petersen: { name: '消弧リアクトル', units: ['denken2-denryoku-U09'] },
  line275: { name: '送電線 275 kV（超高圧）', units: ['denken2-denryoku-U06'] }, // 1.10.0
  line500: { name: '送電線 500 kV（超高圧）', units: ['denken2-denryoku-U06'] }, // 1.11.0
};

// 1.7.4 単元と施設の対応表：上の表（GATES・PERF・BLUEPRINTS。古い問題データでも今までどおり動くように残す）に、
// 問題データの単元の grid（科目定義.json の単元に書き、md2json で書き出す）を足す。
// 単元の grid の形：{ gate: ['coal', 'hydro'], perf: ['coal'], blueprint: ['bigCoal'] }（キーは GATES・PERF・BLUEPRINTS のキー。知らないキーは無視）
// 戻り値：{ gate: { キー: [単元] }, perf: {…}, blueprint: {…} }。設計図の「外部試験の点で開く」は上の表の単元の科目だけ（今のまま）
const TABLES = new WeakMap();
const NO_DATA = {};
export function gridTables(data) {
  const key = data || NO_DATA;
  if (TABLES.has(key)) return TABLES.get(key);
  const T = {
    gate: Object.fromEntries(Object.entries(GATES).map(([k, v]) => [k, [...v]])),
    perf: Object.fromEntries(Object.entries(PERF).map(([k, v]) => [k, [...v]])),
    blueprint: Object.fromEntries(Object.entries(BLUEPRINTS).map(([k, b]) => [k, [...b.units]])),
  };
  for (const s of data?.subjects || []) {
    for (const u of s.units || []) {
      for (const [kind, keys] of Object.entries(u.grid || {})) {
        const tab = T[kind];
        if (!tab || !Array.isArray(keys)) continue;
        for (const k of keys) if (tab[k] && !tab[k].includes(u.unitId)) tab[k].push(u.unitId);
      }
    }
  }
  TABLES.set(key, T);
  return T;
}
export const subjectOfUnit = (u) => u.replace(/-U\d+$/, '');
// 性能（1.7.4）：単元ごとの定着の割合（これまでの最大値）を、科目ごとに平均し、そのうちいちばん高い値。
// 問題のない単元は 0。どれか1つの科目で定着させれば上がり、新しい科目の単元を足しても伸びにくくならない
export function perfOf(units, best) {
  const by = new Map();
  for (const u of units) {
    const s = subjectOfUnit(u);
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(best.get(u) || 0);
  }
  let p = 0;
  for (const v of by.values()) p = Math.max(p, v.reduce((a, b) => a + b, 0) / v.length);
  return p;
}

// 学習の状況（レベル・時代・需要の上限・建設できるか・性能・設計図）。saved：性能の「これまでの最大値」（保存してある分）
export function learning(logs, data, saved = {}) {
  const T = gridTables(data);
  const active = L.activeQuestions(data);
  const unitsOf = (q) => [q.unitId, ...(q.subUnitIds || [])];
  const correct = L.correctIdSet(logs);
  const unitCorrect = new Set();
  const examCorrect = new Set();
  const unitTotal = new Map();
  const qUnit = new Map();
  const qUnits = new Map();
  for (const q of active) {
    unitTotal.set(q.unitId, (unitTotal.get(q.unitId) || 0) + 1);
    qUnit.set(q.questionId, q.unitId);
    qUnits.set(q.questionId, unitsOf(q));
    if (!correct.has(q.questionId)) continue;
    for (const u of unitsOf(q)) {
      unitCorrect.add(u);
      if (q.level === '試験') examCorrect.add(u);
    }
  }
  // 性能：単元ごとの定着の割合の、これまでの最大値（記録を古い順にたどる）
  // 1.10.1 gateM：これまでに一度でも、関係する単元のどれかで定着した問題があれば開く（忘れて定着が外れても閉じない）
  const cur = new Map();
  const best = new Map();
  const unitMastered = new Set();
  let mastered = 0;
  const prog = L.questionProgress(logs, (l, p) => {
    const u = qUnit.get(l.questionId);
    if (!u) return;
    if (!cur.has(u)) cur.set(u, new Set());
    const set = cur.get(u);
    if (p.mastered) {
      set.add(l.questionId);
      for (const xu of qUnits.get(l.questionId) || []) unitMastered.add(xu);
    } else set.delete(l.questionId);
    best.set(u, Math.max(best.get(u) || 0, set.size / unitTotal.get(u)));
  });
  for (const q of active) if (prog.get(q.questionId)?.mastered) mastered++;
  const perf = {};
  for (const [k, units] of Object.entries(T.perf)) perf[k] = Math.max(saved[k] || 0, perfOf(units, best));
  const gate = {};
  const gateM = {};
  for (const [k, units] of Object.entries(T.gate)) {
    gate[k] = units.some((u) => unitCorrect.has(u));
    gateM[k] = units.some((u) => unitMastered.has(u));
  }
  // 設計図：外部試験の点（その単元の科目の問題が属する年度・科目のどれかで3割以上）
  const scores = new Map(L.examScores(data, logs).map((r) => [r.key, r]));
  const blueprint = {};
  for (const [k, b] of Object.entries(BLUEPRINTS)) {
    const subjects = new Set(b.units.map((u) => u.replace(/-U\d+$/, '')));
    const papers = new Set(active.filter((q) => q.examItem && subjects.has(q.subjectId)).map((q) => L.paperKey(q.examItem)));
    blueprint[k] = T.blueprint[k].some((u) => examCorrect.has(u)) || [...papers].some((key) => scores.get(key) && scores.get(key).got >= 0.3 * scores.get(key).full);
  }
  const level = L.levelInfo(L.coinTotals(L.coinEvents(logs, data)).total).level;
  const incidentQs = new Set(L.gameQuestions(data).map((q) => q.questionId));
  return { level, era: eraOf(level), mastered, dmax: dmaxOf(level, mastered), gate, gateM, perf, blueprint, incidentQs, tables: T };
}
// テストや仮の表示用：何も学習していない状態
export function blankLearning(over = {}) {
  const f = (o, v) => Object.fromEntries(Object.keys(o).map((k) => [k, v]));
  return { level: 1, era: 1, mastered: 0, dmax: dmaxKw(1, 0), gate: f(GATES, false), gateM: f(GATES, false), perf: f(PERF, 0), blueprint: f(BLUEPRINTS, false), incidentQs: new Set(), tables: gridTables(null), ...over };
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
// 1.8.0 mode：'history'（史実モード。今までの本番の系統）／'free'（自由モード）
export function newGrid(seed = 1, nowMs = 0, { terrain = 'standard', start = null, islandNo = 1, perfMax = {}, past = [], mode = 'history' } = {}) {
  const home = terrain === 'japan' ? start || J.TOKYO : 'T1';
  const G = {
    v: 2, mode: mode === 'free' ? 'free' : 'history', islandNo, terrain, seed, rng: seed | 0,
    ...(terrain === 'japan' ? { start: home } : {}),
    t: 6, realAt: nowMs, era: 1, hz: null,
    yen: 10000, loanUntil: 0, debt: 0, negHours: 0, rebuild: false,
    reserve: 0.1, fuelPlan: 'contract', maint: 'normal',
    fuel: initFuel(),
    priority: ['P1'], nextId: 2,
    plants: [{ id: 'P1', type: 'dcCoal', kw: 25, site: home, cost: 3000, proto: false, builtAt: 0, readyAt: 0, on: false, onAt: null, downUntil: 0, idle: false, store: 0, hold: 0, done: true }],
    lines: [], subs: [], convs: [], // 1.10.4 電鉄用の変換所
    loads: [{ id: 'L1', town: home, type: 'lamp', kw: 20, cap: false }],
    apps: [], rep: {}, black: {}, tramDown: {}, tramStep: 0, tramDone: [], // 1.10.4 架線事故停止・史実の電鉄順
    events: [], incidents: [], reports: [], cool: {}, buffs: {},
    perfMax: { ...perfMax },
    hist: [], last: null, lossRatio: 0.03,
    acc: newAcc(), yr: newYear(0, 20), years: [], best: null, past,
    litTowns: {}, freshLit: [], // 1.10.3 初めて電気が届いた町
    econCur: newEconDay(), econDays: [], deficitAlerted: false,
    haulNotice: true, // 1.10.1 新しく始める系統には移行の報告書を出さない
    eraKNotice: true, // 1.10.2 新しく始める系統には移行の報告書を出さない
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
  if (G.mode !== 'free') G.mode = 'history'; // 1.8.0：mode のない古い保存データは史実モード
  if (G.debt == null) G.debt = 0; // 1.10.2 借入れの残り
  // 1.10.1：石炭の運び代を入れたあと、既存の日本列島の系統を最初に開いたとき報告書を1つ（すでに建てた石炭火力にも効く）
  if (G.terrain === 'japan' && !G.haulNotice) {
    G.haulNotice = true;
    addReport(G, { title: '石炭の運び代を入れた', what: '石炭の運び代を入れた：炭田のそば ×0.70、海沿い ×0.95 まで、内陸は遠いほど高い（最大 ×1.4）。すでに建てた石炭火力にも効く。', units: ['power-system-U05', 'power-system-U06'] });
  }
  // 1.10.2：すでに大正・昭和前期・戦後復興にいる系統は、最初に開いたときに D_max が上がる報告書を1つ
  if (!G.eraKNotice) {
    G.eraKNotice = true;
    if ((G.era || 1) >= 3) {
      addReport(G, { title: '時代の需要の伸びを入れた', what: '時代の需要の伸びを入れた：大正 ×10、昭和前期 ×12、戦後復興 ×24（この時代の町は、電気の使い方が大きく伸びた）。', units: [] });
    }
  }
  // 1.10.3：古い保存データで litTowns がなければ、すでに電気が届いている町を記録して誤爆を防ぐ
  if (!G.litTowns) {
    G.litTowns = {};
    for (const [nid, st] of Object.entries(G.last?.towns || {})) if (st.r > 1e-6 && st.d > 1e-6) G.litTowns[nid] = G.t;
    if (!Object.keys(G.litTowns).length) for (const l of G.loads || []) G.litTowns[l.town] = G.t;
  }
  if (!Array.isArray(G.freshLit)) G.freshLit = [];
  if (!Array.isArray(G.convs)) G.convs = []; // 1.10.4 電鉄用の変換所
  if (!G.tramDown) G.tramDown = {};
  if (!Array.isArray(G.tramDone)) G.tramDone = Array.from({ length: G.tramStep || 0 }, (_, i) => i);
  if (G.tramStep == null) G.tramStep = G.tramDone.length;
  // 1.11.0 燃料を種類ごとに（古い保存データの G.fuel を coal に移す。報告書は要らない）
  if (!G.fuel || typeof G.fuel.coal !== 'object') {
    const old = G.fuel;
    G.fuel = initFuel();
    if (old && typeof old.contract === 'number') {
      G.fuel.coal = { base: old.base ?? FUELS.coal.base, contract: old.contract, spot: old.spot ?? old.contract * 0.85 };
    }
  } else {
    for (const [k, F] of Object.entries(FUELS)) {
      if (!G.fuel[k]) G.fuel[k] = { base: F.base, contract: F.base, spot: F.base * 0.85 };
    }
  }
  return G;
}
// ---- 1.8.0 史実モードと自由モード ----
export const MODES = { history: { name: '史実モード', tag: '史実' }, free: { name: '自由モード', tag: '自由' } };
export const modeOf = (G) => (G?.mode === 'free' ? 'free' : 'history');
// 性能の上乗せの「これまでの最大値」を両モードで共通にする：2つの大きいほう（下がらない）
export function maxPerf(a = {}, b = {}) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
}
const newAcc = () => ({ hours: 0, rev: 0, fuel: 0, maint: 0, repair: 0, loan: 0, unserved: 0, shedH: 0, blackH: 0, badH: 0, fails: 0, apps: 0, notes: [] });
const newYear = (idx, startAcc = 0) => ({ idx, profit: 0, unserved: 0, okH: 0, hours: 0, served: 0, maxD: 0, built: 0, incTotal: 0, incOk: 0, litNew: 0, blackH: 0, shedH: 0, startAcc, gen: { coal: 0, oil: 0, hydro: 0 } });
// 1.10.2 日ごとの電力・収支の記録（30日分）。5.1 の横棒・5.2 の発電所ごと・5.3 の赤字判定・5.4 の再建見込みに使う
const newEconDay = () => ({ h: 0, gen: 0, served: 0, lineLoss: 0, subLoss: 0, waste: 0, rev: 0, fuel: 0, maint: 0, repair: 0, loan: 0, reward: 0, plants: {} });
// 修理費の増減を系統の残高・まとめ・年・日次収支にまとめて反映する（delta が負なら返金）
export function recordRepair(G, delta) {
  if (!delta) return;
  G.yen -= delta;
  G.acc.repair += delta;
  G.yr.profit -= delta;
  const ec = (G.econCur ||= newEconDay());
  ec.repair += delta;
}

// ---- 設備の状態 ----
const P = (p) => PLANTS[p.type];
export const plantReady = (p, t) => p.readyAt <= t && p.downUntil <= t && !p.idle;
// 1.8.2：性能は perfNow（学習で決まる性能 ×（1 ＋ 研究開発の段 × 0.04）。1 を超えない）。G がなければ学習の分だけ
export function plantEff(p, lc, G = null) {
  const [lo, hi] = P(p).eff;
  return p.proto ? lo : lo + (hi - lo) * perfNow(G, lc, P(p).perf);
}
export function flowFactor(G, t) {
  const drought = evOn(G, 'drought', t);
  return [1.3, 1.0, 0.9, 0.6][seasonOf(t)] * (drought ? (drought.eased ? 0.55 : 0.4) : 1);
}
// この1時間に出せる最大（水力は流量しだい。調整池式は池の水まで）。1.10.0 周波数をそろえる工事の間は 8 割まで
function capNow(G, p, t, forCommit = false) {
  return capRaw(G, p, t, forCommit) * (p.convUntil > t ? HZCONV.capK : 1);
}
function capRaw(G, p, t, forCommit) {
  if (!P(p).ac || P(p).coal) return p.kw;
  const f = flowFactor(G, t);
  if (p.type === 'ror') return p.kw * Math.min(1, f);
  if (p.type === 'dam') {
    const inflow = p.kw * f * 0.4;
    return Math.min(p.kw, (forCommit ? p.store / 10 : p.store) + inflow);
  }
  const inflow = p.kw * f * (POND_HOURS / 24);
  return Math.min(p.kw, (forCommit ? p.store / 2 : p.store) + inflow);
}
export const evOn = (G, key, t = G.t) => G.events.find((e) => e.key === key && e.until > t) || null;
// 1.10.1 石炭の運び代（燃料費の倍率。日本列島だけ。古い島は ×1.0 のまま）
// 炭田の地点：×0.70／それ以外：陸送＝min(1.4, 0.75 + 0.002×いちばん近い炭田までの km)。海沿い（coast）は min(陸送, 0.95)
export const FUEL_HAUL = { coal: 0.7, base: 0.75, perKm: 0.002, max: 1.4, coastMax: 0.95 };
const JAPAN_HAUL = (() => {
  const fields = JAPAN_NODES.filter((n) => n.coal);
  const m = new Map();
  for (const n of JAPAN_NODES) {
    if (n.coal) {
      m.set(n.id, { k: FUEL_HAUL.coal, kind: 'coal', km: 0, field: n.name, reason: '炭田のそば' });
      continue;
    }
    let bestD = Infinity, bestF = null;
    for (const f of fields) {
      const d = greatCircleKm(n.lat, n.lon, f.lat, f.lon);
      if (d < bestD) (bestD = d), (bestF = f);
    }
    const land = Math.min(FUEL_HAUL.max, FUEL_HAUL.base + FUEL_HAUL.perKm * bestD);
    const coast = n.tags.includes('coast');
    const km = Math.round(bestD);
    if (coast && land > FUEL_HAUL.coastMax) {
      m.set(n.id, { k: FUEL_HAUL.coastMax, kind: 'coast', km, field: bestF?.name || '', reason: '海沿い：船で運べる' });
    } else if (coast) {
      m.set(n.id, { k: land, kind: 'coast', km, field: bestF?.name || '', reason: `海沿い・${bestF?.name || '炭田'}から ${km} km` });
    } else {
      m.set(n.id, { k: land, kind: 'land', km, field: bestF?.name || '', reason: `内陸：${bestF?.name || '炭田'}から ${km} km${land >= FUEL_HAUL.max - 1e-9 ? '（上限）' : ''}` });
    }
  }
  return m;
})();
export function fuelHaul(G, siteId, fuel = 'coal') {
  if (!FUELS[fuel]?.haul) return { k: 1, kind: 'flat', km: 0, field: '', reason: 'タンカーで直接（海沿い）' };
  if (!isJapan(G) || !siteId) return { k: 1, kind: 'flat', km: 0, field: '', reason: '' };
  return JAPAN_HAUL.get(siteId) || { k: 1, kind: 'flat', km: 0, field: '', reason: '' };
}
export function fuelObj(G, fuel = 'coal') {
  const fk = fuel || 'coal';
  const F = FUELS[fk] || FUELS.coal;
  if (G?.fuel?.[fk] && typeof G.fuel[fk] === 'object') return G.fuel[fk];
  if (fk === 'coal' && typeof G?.fuel?.contract === 'number') return G.fuel;
  return { base: F.base, contract: F.base, spot: F.base * 0.85 };
}
export function fuelPrice(G, t = G.t, siteId = null, fuel = 'coal') {
  const fk = fuel || 'coal';
  const f = fuelObj(G, fk);
  return (G.fuelPlan === 'spot' ? f.spot : f.contract) * (siteId ? fuelHaul(G, siteId, fk).k : 1); // 円/kWh（熱）
}
export const lineCircuits = (l, t) => (l.downUntil > t ? 0 : l.n - (l.c1Until > t ? 1 : 0));
const subsAt = (G, town, t) => G.subs.filter((s) => s.town === town && s.readyAt <= t && s.downUntil <= t);
function lineActive(G, l, t) {
  if (l.hzTrip || l.readyAt > t || lineCircuits(l, t) <= 0) return false; // 1.8.0 周波数違いで切れている線は網に入れない
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
  let base = (0.01 * l.km) / 100 * l.n * (1 - 0.5 * perfNow(G, lc, K.perf)) * (l.proto ? 3 : 1) * (G.maint === 'defer' ? 2.5 : 1);
  if (evOn(G, 'typhoon', t)) base *= 5;
  if (l.overH > 0) base *= 3;
  return { perDay: base * m.thunder * m.coast * m.snow, m };
}

// ---- 需要 ----
// raw：使用制限をかけない、ふだんの需要（1.10.0 使用制限で減らした量を数えるとき）
export function loadKw(G, ld, t, raw = false) {
  const D = LOADS[ld.type];
  const r = raw ? null : restrictOn(G);
  const shape = r && RESTRICT_TYPES.includes(ld.type) ? restrictShape(r, ld.type) : D.shape;
  let k = shape[t % 24] * (seasonOf(t) === 3 ? D.winter : 1);
  if (evOn(G, 'heat', t) || evOn(G, 'cold', t)) k *= 1.15;
  const dr = evOn(G, 'drought', t);
  if (dr?.eased) k *= 0.9;
  return ld.kw * k;
}
// ---- 1.10.0 使用制限（戦後復興 E4b から、両モード）。渇水などで供給が足りないとき、運転のパネルで1つ選ぶ（いつでも変えられる）。
// 効くのは工場・町の動力の需要だけ（電灯・住宅は変えない。史実の「電灯電力の使用時間の指定」は大口の側だけで表す）。
// A 使用時間の指定：昼（8〜17 時）の 3 割を夜（22〜5 時）へ移す（1日の量と料金は同じ）／B 大口の使用量の制限：どの時間も 0.7 倍／
// C 最大電力の指定：ふだんの山の 7 割で頭打ち。減らした・移した需要は停電に数えない（需要そのものが減る）。それでも足りなければ今の負荷遮断の規則
export const RESTRICT_ERA = 5;
export const RESTRICT = {
  A: { name: '使用時間の指定', short: 'A 使用時間の指定', text: '工場・町の動力の昼（8〜17 時）の 3 割を夜（22〜5 時）へ移す。電鉄は朝夕の山を外せないため昼を少し減らすだけで効きが小さい' },
  B: { name: '大口の使用量の制限', short: 'B 大口の使用量の制限', text: '工場・町の動力・電鉄の需要を、どの時間も 0.7 倍（1日の量が 3 割減る。その分の売電はない）' },
  C: { name: '最大電力の指定', short: 'C 最大電力の指定', text: '工場・町の動力・電鉄の需要を、ふだんの山の 7 割で頭打ち（量は少し減る）' },
};
export const RESTRICT_TYPES = ['factory', 'shop', 'tram'];
export const RESTRICT_K = 0.7;
const R_DAY = (h) => h >= 8 && h <= 17, R_NIGHT = (h) => h >= 22 || h <= 5;
const R_SHAPES = new Map();
export function restrictShape(r, type) {
  const key = `${r}|${type}`;
  if (R_SHAPES.has(key)) return R_SHAPES.get(key);
  const s0 = LOADS[type].shape;
  let s;
  if (r === 'A') {
    if (type === 'tram') {
      // 1.10.4 電鉄は朝夕の山を外せず深夜（運休）へも移せないため、昼（10〜15時）のみ 15% 削るだけで制限の効きが小さい
      s = s0.map((v, h) => (h >= 10 && h <= 15 ? v * 0.85 : v));
    } else {
      const moved = s0.reduce((a, v, h) => a + (R_DAY(h) ? v * (1 - RESTRICT_K) : 0), 0);
      const nN = s0.filter((_, h) => R_NIGHT(h)).length;
      s = s0.map((v, h) => (R_DAY(h) ? v * RESTRICT_K : R_NIGHT(h) ? v + moved / nN : v));
    }
  } else if (r === 'B') s = s0.map((v) => v * RESTRICT_K);
  else {
    const cap = RESTRICT_K * Math.max(...s0);
    s = s0.map((v) => Math.min(v, cap));
  }
  R_SHAPES.set(key, s);
  return s;
}
// いま効いている使用制限（時代が戦後復興より前なら効かない。開発者モードで時代を戻したとき）
export const restrictOn = (G) => (G && G.restrict && RESTRICT[G.restrict] && G.era >= RESTRICT_ERA ? G.restrict : null);
export function setRestrict(G, r) {
  if (r && !RESTRICT[r]) return { ok: false, why: '使用制限を選ぶ' };
  if (r && G.era < RESTRICT_ERA) return { ok: false, why: '使用制限は戦後復興から' };
  G.restrict = r || null;
  if (r) G.restrictUsed = true;
  if (r === 'A' && G.loads.some((l) => l.type === 'tram')) {
    addReport(G, { title: '使用制限 A と電鉄', what: '使用時間の指定（A）にした。電鉄は朝夕の山を外せず運休の深夜へも移せないため、工場や町の動力にくらべて制限の効きが小さい。', units: RESTRICT_UNITS });
  }
  return { ok: true };
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
// 線の損失（kW）：交流は (P²+Q²)R/V²、直流は I²R（R は往復）。P・Q は kW・kvar、V は kV（1.11.0 runKv：500 kV 設計を 275 kV で使うとき）
export function lineLoss(kind, km, n, p, q = 0, runKv = null) {
  const K = LINES[kind];
  const kv = runKv || K.kv;
  return ((p * p + q * q) * ((K.r * km) / n)) / (kv * kv) / 1000;
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
  const res = { out: new Map(), served: new Map(), flows: new Map(), loss: 0, waste: 0, x: 0, over: false, shed: 0, black: false, noGen: false, tripped: [], cap: 0, load: 0, f: 0, commit: new Map(), readyCap: 0 };
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
  const needBare = (k) => fc(net, t + k) * (1 + G.lossRatio); // 予備力の目標を除いた分（1.7.4：起動・運転の理由が予備力だけか）
  // 先に決めた発電機の出力（at：使えるようになる時刻。起動中のものは、その時刻までは数えない）
  const committed = [];
  const accAt = (k) => committed.reduce((a, c) => a + (c.at <= t + k ? c.cap : 0), 0);
  const online = [];
  for (const p of ready) {
    const D = P(p);
    const cap = capNow(G, p, t, true);
    // want：いま起動すれば間に合う時刻（起動時間のあと）に足りない。keep：これから先のどこかで足りない
    // 1.7.4 short：予備力の目標を除いても足りない（予備力のためだけの起動・運転かを画面に出す）
    let want = false, keep = false, wantShort = false, keepShort = false;
    for (let k = 0; k <= D.start + 4; k++) {
      if (need(k) <= accAt(k) + 1e-9) continue;
      keep = true;
      const bare = needBare(k) > accAt(k) + 1e-9;
      if (bare) keepShort = true;
      if (k >= D.start && k <= D.start + 1) {
        want = true;
        if (bare) wantShort = true;
      }
    }
    res.commit.set(p.id, { want, keep, wantShort, keepShort });
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
  res.readyCap = ready.reduce((s, p) => s + capNow(G, p, t), 0); // 1.7.4 網ごとの予備力（使える発電機の合計）
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
    let lLoss = fl;
    for (const e of net.edges) {
      const f = flows.get(e.id) || { p: 0, q: 0 };
      const n = lineCircuits(e, t);
      f.loss = lineLoss(e.kind, e.km, n, f.p, net.dc ? 0 : f.q, e.runKv);
      f.util = Math.hypot(f.p, net.dc ? 0 : f.q) / (lineCap(e) * n);
      lLoss += f.loss;
    }
    // 変電所：鉄損はいつも、銅損は負荷率の2乗。町に出入りする送電線（11 kV 以上）の流れの合計が変圧器を通る
    const subs = new Map();
    let subLoss = 0;
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
        subLoss += l;
        subs.set(n, { util: S / capK, loss: l });
      }
    }
    return { flows, loss: lLoss + subLoss, lineLoss: lLoss, subLoss, subs };
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
  res.lineLoss = fin.lineLoss;
  res.subLoss = fin.subLoss;
  res.out = out;
  // 1.10.2 最低出力で捨てた分を、最低出力で運転している発電機に按分（5.2 の発電所ごとの表示）
  res.plantWaste = new Map();
  if (res.waste > 1e-6) {
    const mins = alive.filter((u) => u.min > 0 && (out.get(u.p.id) || 0) <= u.min + 1e-6);
    const sumMin = mins.reduce((a, u) => a + u.min, 0);
    if (sumMin > 0) for (const u of mins) res.plantWaste.set(u.p.id, res.waste * (u.min / sumMin));
  }
  return res;
}

// 1時間分を解く（直流の網 → 残りを交流の網）。o.dry：状態を変えない。o.assume：使える発電機はすべて運転中とみなす
// 1.10.4 電鉄（tram）：交流の網から電鉄用の変換所（G.convs）を通してのみ届く。変換所の容量までしか届かず、損失（電鉄 kW ÷ 効率 − 電鉄 kW）を交流側の需要に足す
function convAvgEff(G, town, t, lc) {
  const cs = convsAt(G, town, t);
  if (!cs.length) return { cap: 0, eff: 0.9 };
  const cap = cs.reduce((a, c) => a + c.kw, 0);
  const w = cs.reduce((a, c) => a + c.kw * convEff(c, lc, G), 0);
  return { cap, eff: cap > 0 ? w / cap : 0.9 };
}
export function solve(G, lc, t, o = {}) {
  const fcCache = new Map();
  const fcTownSplit = (tt) => {
    if (!fcCache.has(tt)) {
      const gen = new Map(), tram = new Map();
      for (const ld of G.loads) {
        const v = loadKw(G, ld, tt);
        if (ld.type === 'tram') tram.set(ld.town, (tram.get(ld.town) || 0) + v);
        else gen.set(ld.town, (gen.get(ld.town) || 0) + v);
      }
      fcCache.set(tt, { gen, tram });
    }
    return fcCache.get(tt);
  };
  const sigma = o.noNoise ? 0 : 0.03 * (1 - 0.5 * perfNow(G, lc, 'freq'));
  const dem = new Map(); // 町全体の需要（表示・合計用）
  const demGen = new Map(); // 一般需要（直流・交流どちらでも届く）
  const tramInfo = new Map(); // 電鉄需要と変換所 { f, a, cap, eff, ok, acA, acF, why }
  const f0 = fcTownSplit(t);
  for (const n of nodesOf(G)) {
    if (!n.town) continue;
    const fg = f0.gen.get(n.id) || 0;
    const ft = f0.tram.get(n.id) || 0;
    if (!(fg > 0 || ft > 0)) continue;
    const noise = 1 + sigma * (sigma ? gauss(G) : 0);
    const ag = Math.max(0, fg * noise);
    const at = Math.max(0, ft * noise);
    if (!(fg + ft > 0 || ag + at > 0)) continue;
    const qg = G.loads.filter((ld) => ld.town === n.id && ld.type !== 'tram').reduce((s, ld) => s + loadKw(G, ld, t) * loadTan(ld), 0) * (fg > 0 ? ag / fg : 0);
    dem.set(n.id, { f: fg + ft, a: ag + at, q: qg, genA: ag, tramA: at });
    if (fg > 0 || ag > 0) demGen.set(n.id, { f: fg, a: ag, q: qg });
    if (ft > 0 || at > 0) {
      const down = (G.tramDown?.[n.id] || 0) > t;
      const { cap, eff } = convAvgEff(G, n.id, t, lc);
      const ok = down ? 0 : Math.min(at, cap);
      const okF = down ? 0 : Math.min(ft, cap);
      const why = down ? { k: 'tramDown', h: G.tramDown[n.id] - t } : cap <= 1e-6 ? { k: 'noConv' } : at > cap + 1e-6 ? { k: 'convCap', need: at - cap } : null;
      tramInfo.set(n.id, { f: ft, a: at, cap, eff, ok, acA: ok > 0 ? ok / eff : 0, acF: okF > 0 ? okF / eff : 0, why });
    }
  }
  const dcNets = networks(G, t, true);
  const acNets = networks(G, t, false);
  const sumTownsDc = (net, tt) => net.nodes.reduce((s, n) => s + (fcTownSplit(tt).gen.get(n) || 0), 0);
  // 直流の発電所は、つないだ町の一般需要だけをまかなう（電鉄には送れない）。交流の網は、一般の残り＋電鉄（変換所の損失込み）を受け持つ
  const dcCap = (net, tt) => net.plants.filter((p) => plantReady(p, tt)).reduce((s, p) => s + p.kw, 0);
  const dcOf = new Map();
  for (const net of dcNets) for (const n of net.nodes) dcOf.set(n, net);
  const acOf = new Map();
  for (const net of acNets) for (const n of net.nodes) acOf.set(n, net);
  const acCan = (n) => acOf.get(n).plants.some((p) => plantReady(p, t));
  // 直流の電気は、交流が来ていない町に先に回す。戻り値：町 → 直流でまかなえる一般需要の割合
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
    if (!d.plants.length) return NONE;
    const key = `${d.nodes[0]}|${tt}`;
    if (!fcShare.has(key)) fcShare.set(key, share(d, dcCap(d, t) * 0.95, (n) => fcTownSplit(tt).gen.get(n) || 0));
    return fcShare.get(key);
  };
  const acFc = (net, tt) => {
    const sp = fcTownSplit(tt);
    let x = 0;
    for (const n of net.nodes) {
      const vg = sp.gen.get(n) || 0;
      if (vg) x += vg * (1 - (dcShareAt(dcOf.get(n), tt).get(n) || 0));
      const vt = sp.tram.get(n) || 0;
      if (vt && !((G.tramDown?.[n] || 0) > tt)) {
        const { cap, eff } = convAvgEff(G, n, tt, lc);
        if (cap > 0) x += Math.min(vt, cap) / eff;
      }
    }
    return x;
  };
  const results = [];
  const genServed = new Map(); // 町 → 一般需要に届いた割合
  const tramServed = new Map(); // 町 → 電鉄需要に届いた割合
  const served = new Map(); // 町 → 全体の届いた割合
  const rest = new Map();
  const src = new Map(); // 1.7.4 町 → { dc, ac }（直流・交流から届いた kW）
  const srcAdd = (n, k, v) => {
    const x = src.get(n) || { dc: 0, ac: 0 };
    x[k] += v;
    src.set(n, x);
  };
  for (const net of dcNets) {
    if (!net.plants.length) continue;
    const r = runNet(G, lc, t, net, demGen, sumTownsDc, o);
    r.net = net;
    results.push(r);
    const got = [...r.served].reduce((x, [n, ratio]) => x + (demGen.get(n)?.a || 0) * ratio, 0);
    r.served = share(net, got, (n) => demGen.get(n)?.a || 0);
    for (const [n, ratio] of r.served) genServed.set(n, ratio), srcAdd(n, 'dc', (demGen.get(n)?.a || 0) * ratio);
  }
  for (const [n, d] of dem) {
    const dg = demGen.get(n);
    const k = dg ? 1 - (genServed.get(n) || 0) : 0;
    const fk = dg ? 1 - (dcShareAt(dcOf.get(n), t).get(n) || 0) : 0;
    const ti = tramInfo.get(n);
    const acNeedA = (dg ? dg.a * k : 0) + (ti ? ti.acA : 0);
    const acNeedF = (dg ? dg.f * fk : 0) + (ti ? ti.acF : 0);
    if (acNeedA > 1e-9 || acNeedF > 1e-9) rest.set(n, { f: acNeedF, a: acNeedA, q: dg ? dg.q * k : 0, genRemA: dg ? dg.a * k : 0, tramAcA: ti ? ti.acA : 0 });
  }
  const convs = new Map(); // 町 → 変換所の使用率
  const tramWhy = new Map(); // 町 → 電鉄が届いていない原因
  let convLoss = 0;
  for (const net of acNets) {
    if (!net.plants.length) continue;
    const r = runNet(G, lc, t, net, rest, acFc, o);
    r.net = net;
    results.push(r);
    for (const [n, ratio] of r.served) {
      const rn = rest.get(n);
      if (!rn) continue;
      const dg = demGen.get(n);
      if (dg && dg.a > 0 && rn.genRemA > 0) {
        genServed.set(n, (genServed.get(n) || 0) + (rn.genRemA * ratio) / dg.a);
        srcAdd(n, 'ac', rn.genRemA * ratio);
      }
      const ti = tramInfo.get(n);
      if (ti && ti.a > 0 && ti.ok > 0) {
        const deliv = ti.ok * ratio;
        tramServed.set(n, deliv / ti.a);
        srcAdd(n, 'ac', deliv);
        convLoss += ti.acA * ratio - deliv;
        if (ti.cap > 0) convs.set(n, deliv / ti.cap);
      }
    }
  }
  for (const [n, ti] of tramInfo) {
    if (ti.why) tramWhy.set(n, ti.why);
    if (!convs.has(n) && ti.cap > 0) convs.set(n, 0);
  }
  // 直流だけの町で少し足りないとき（一般需要のみ）：1 割までは電圧の低下（電灯が暗くなる）で済む
  const dim = new Set();
  for (const [n, d] of dem) {
    const dg = demGen.get(n);
    let gr = dg ? Math.min(1, genServed.get(n) || 0) : 1;
    if (dg && dcOf.get(n)?.plants.length && gr < 1 - 1e-9 && gr >= 0.9) {
      if (gr < 0.97) dim.add(n);
      gr = 1;
      genServed.set(n, 1);
    }
    const ti = tramInfo.get(n);
    const tr = ti ? Math.min(1, tramServed.get(n) || 0) : 1;
    const totGot = (dg ? dg.a * gr : 0) + (ti ? ti.a * tr : 0);
    served.set(n, d.a > 0 ? Math.min(1, totGot / d.a) : 1);
  }
  return { dem, served, genServed, tramServed, results, dim, src, convs, convLoss, tramWhy };
}

// ---- 1.7.4 いま何が起きているか：届いていない原因・発電所が全開でない理由・網ごとの予備 ----
// step で G.last に残す（why：町 → 原因、pw：発電所 → 理由、nets：網ごとのまとめ）。文は whyText・plantWhyText
// 線でつながった地点と線（工事中・止まっている線も含む。dc：直流の線だけ／交流の線だけ）
function compOf(G, id, dc) {
  const adj = new Map();
  for (const l of G.lines) {
    if (!!LINES[l.kind].dc !== dc) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l);
  }
  const seen = new Set([id]);
  const lines = new Set();
  const stack = [id];
  while (stack.length) {
    for (const l of adj.get(stack.pop()) || []) {
      lines.add(l);
      for (const v of [l.a, l.b]) if (!seen.has(v)) seen.add(v), stack.push(v);
    }
  }
  return { nodes: seen, lines: [...lines] };
}
// 発電所1つの今の状態の理由（r：その発電所の網の結果）
function plantWhy(G, p, r, t) {
  if (p.readyAt > t) return { k: 'build', h: p.readyAt - t };
  if (p.downUntil > t) return { k: 'down', h: p.downUntil - t };
  if (p.idle) return { k: 'idle' };
  if (p.hold > t) return { k: 'black', h: p.hold - t };
  const c = r?.commit.get(p.id);
  if (p.onAt != null) return { k: 'start', h: Math.max(1, p.onAt - t), res: !!c && !c.wantShort };
  if (!p.on) return { k: r && (r.noGen || (r.load > 0 && [...r.served.values()].some((v) => v < 0.999))) ? 'late' : 'enough', h: P(p).start };
  const out = r?.out.get(p.id) || 0;
  const cap = capNow(G, p, t);
  if (!r || r.load <= 0) return { k: 'noLoad' };
  if (p.convUntil > t && out >= cap - 1e-6) return { k: 'conv', cap }; // 1.10.0 周波数をそろえる工事の間は 8 割まで
  if (out >= cap - 1e-6 && cap >= p.kw * 0.999) return { k: 'full' };
  if (out >= cap - 1e-6) return { k: 'water', cap };
  const min = Math.min(P(p).min * p.kw, cap);
  if (min > 0 && out <= min + 1e-6 && r.waste > 0) return { k: 'min' };
  if (c && !c.keepShort && out <= min + 1e-6) return { k: 'reserve' };
  return { k: 'demand' };
}
// 発電機が動いていない網の原因（いちばん近いうちに戻るもの）
function netPlantsWhy(G, plants, r, t) {
  const ws = plants.map((p) => plantWhy(G, p, r, t));
  for (const k of ['start', 'late', 'build', 'down', 'black', 'idle']) {
    const hit = ws.filter((w) => w.k === k);
    if (hit.length) return { k: k === 'black' ? 'blackP' : k, h: Math.min(...hit.map((w) => w.h ?? 0)) };
  }
  return { k: 'late', h: 0 };
}
// 発電所につながった網に入っていない町の原因：線がない／つながった網に発電所がない（直流と交流の違い）／途中の線が工事中・止まっている・変電所がない
function linkWhy(G, n, t, only = null) {
  const has = G.lines.filter((l) => l.a === n || l.b === n);
  if (!has.length) return { k: 'noLine' };
  const out = [];
  for (const dc of [false, true]) {
    if (only != null && dc !== only) continue;
    if (!has.some((l) => !!LINES[l.kind].dc === dc)) continue;
    const c = compOf(G, n, dc);
    const gens = G.plants.filter((p) => !!P(p).ac !== dc && c.nodes.has(p.site));
    if (!gens.length) {
      // その網に、種類の違う発電所（直流の網なら交流の発電所）があれば、送れない理由も添える
      const other = G.plants.some((p) => !!P(p).ac === dc && c.nodes.has(p.site));
      out.push({ k: dc ? 'noDcGen' : 'noAcGen', other });
      continue;
    }
    const lack = (id) => nodeOf(G, id).town && !subsAt(G, id, t).length;
    const subLess = c.lines.find((l) => LINES[l.kind].hv && l.readyAt <= t && [l.a, l.b].some(lack));
    if (subLess) {
      out.push({ k: 'noSub', town: [subLess.a, subLess.b].find(lack) });
      continue;
    }
    const hzT = c.lines.find((l) => l.hzTrip); // 1.8.0 周波数違いで切れている線
    if (hzT) {
      out.push({ k: 'lineHz', line: hzT.id });
      continue;
    }
    const down = c.lines.find((l) => l.readyAt <= t && lineCircuits(l, t) <= 0);
    if (down) {
      out.push({ k: 'lineDown', line: down.id, h: Math.max(0, down.downUntil - t) });
      continue;
    }
    const work = c.lines.filter((l) => l.readyAt > t);
    if (work.length) out.push({ k: 'lineWork', line: work[0].id, h: Math.min(...work.map((l) => l.readyAt - t)) });
  }
  // 交流の網に発電所がない、より先に、直す手がかりのある原因（変電所・線）を出す
  return out.find((w) => w.k !== 'noAcGen' && w.k !== 'noDcGen') || out[0] || { k: 'noLine' };
}
// 届いていない町の原因（step の solve の結果から）。byNode：地点 → [網の結果]
function townWhy(G, sol, byNode, n, t) {
  if ((G.black[n] || 0) > t) return { k: 'black', h: G.black[n] - t };
  const rs = byNode.get(n) || [];
  const ac = rs.find((r) => !r.net.dc), dc = rs.find((r) => r.net.dc);
  if (ac?.black) return { k: 'black', h: Math.max(0, (G.black[n] || t) - t) };
  if (ac?.shed > 0) return { k: 'shed', v: ac.shed };
  const d = sol.dem.get(n);
  // 1.10.4 一般需要は足りているが電鉄が届いていない原因（変換所なし・容量不足・架線事故停止）
  const tw = sol.tramWhy?.get(n);
  if (tw && (!d?.genA || (sol.genServed?.get(n) || 0) >= 0.999)) return tw;
  const left = d ? d.a * (1 - Math.min(1, sol.served.get(n) || 0)) : 0;
  if (dc && !dc.noGen && (dc.dim || 0) > 0 && !(ac && !ac.noGen)) return { k: 'dcShort', kw: left };
  const r = (ac?.noGen && ac) || (dc?.noGen && dc);
  // 交流の網に入れていない町で、交流の線があれば、その理由も添える（also。例：直流の火力は休止中で、送電線の先には変電所がない）
  const also = !ac && G.lines.some((l) => !LINES[l.kind].dc && (l.a === n || l.b === n)) ? linkWhy(G, n, t, false) : null;
  const w = r ? netPlantsWhy(G, r.net.plants, r, t) : !ac && !dc ? linkWhy(G, n, t) : !ac ? { k: 'dcShort', kw: left } : { k: 'short', kw: left };
  if (tw && tw.k !== w.k) w.also = tw;
  else if (also && also.k !== w.k && w.k !== 'noAcGen') w.also = also;
  return w;
}
// step のあとに G.last に残す分を作る
function explainStep(G, sol, t) {
  const byNode = new Map();
  for (const r of sol.results) for (const n of r.net.nodes) (byNode.get(n) || byNode.set(n, []).get(n)).push(r);
  const why = {};
  for (const [n, d] of sol.dem) {
    if (!(d.a > 1e-6)) continue;
    const ratio = Math.min(1, sol.served.get(n) || 0);
    if (ratio < 0.999) why[n] = townWhy(G, sol, byNode, n, t);
    else if (sol.dim.has(n)) why[n] = { k: 'dim' };
  }
  const pw = {};
  for (const p of G.plants) {
    const r = (byNode.get(p.site) || []).find((x) => x.net.plants.includes(p));
    const w = plantWhy(G, p, r, t);
    if (r && (w.k === 'demand' || w.k === 'full')) w.towns = r.net.nodes.filter((n) => (sol.dem.get(n)?.a || 0) > 1e-6).sort((a, b) => sol.dem.get(b).a - sol.dem.get(a).a);
    pw[p.id] = w;
  }
  // 網ごと：需要・届いた量・使える発電機（予備）。発電所のある網と、発電所につながっていない町（まとめて1つ）
  const nets = [];
  for (const r of sol.results) {
    const towns = r.net.nodes.filter((n) => (sol.dem.get(n)?.a || 0) > 1e-6);
    if (!towns.length && !r.readyCap) continue;
    const load = towns.reduce((s, n) => s + sol.dem.get(n).a, 0);
    const got = towns.reduce((s, n) => s + (r.net.dc ? sol.src.get(n)?.dc || 0 : sol.src.get(n)?.ac || 0), 0);
    const main = towns.sort((a, b) => sol.dem.get(b).a - sol.dem.get(a).a)[0] || r.net.plants[0]?.site;
    nets.push({ dc: !!r.net.dc, hz: r.hz || 0, main, towns: towns.length, load, got, cap: r.readyCap, plants: r.net.plants.length });
  }
  const loose = [...sol.dem.keys()].filter((n) => (sol.dem.get(n).a > 1e-6) && !(byNode.get(n) || []).length);
  if (loose.length) nets.push({ none: true, main: loose[0], towns: loose.length, load: loose.reduce((s, n) => s + sol.dem.get(n).a, 0), got: 0, cap: 0, plants: 0 });
  return { why, pw, nets };
}
// 原因の文（1行）
const hoursShort = (h) => (h >= 48 ? `${Math.ceil(h / 24)}日` : `${Math.max(1, Math.ceil(h))}時間`);
export function whyText(G, w) {
  if (!w) return '';
  if (w.also) return `${whyText(G, { ...w, also: null })}。また、${whyText(G, w.also)}`;
  const nm = (id) => nodeOf(G, id)?.name || '';
  const ln = (id) => {
    const l = G.lines.find((x) => x.id === id);
    return l ? lineName(G, l) : '線';
  };
  const hh = hoursShort;
  switch (w.k) {
    case 'black': return `全域停電（復旧まで あと${hh(w.h)}）`;
    case 'blackP': return `発電所が全域停電からの復旧待ち（あと${hh(w.h)}）`;
    case 'shed': return `負荷遮断：周波数が下がりすぎないよう、需要の ${Math.round(w.v * 100)}% を切り離した（発電所の出力・予備力が足りない）`;
    case 'start': return `発電所が起動中（あと${hh(w.h)}）`;
    case 'late': return `発電所が待機中（起動に${hh(w.h)}かかり、起動が終わる時刻には足りる見込みなので起動していない）`;
    case 'build': return `発電所が工事中（あと${hh(w.h)}）`;
    case 'down': return `発電所が事故・故障で止まっている（修理 あと${hh(w.h)}）`;
    case 'idle': return '発電所を休止している（運転のパネルで休止をやめる）';
    case 'dcShort': return `直流の発電所の出力が足りない（あと ${fmtKw(w.kw)}）。交流からも届いていない`;
    case 'short': return `発電所の出力が足りない（あと ${fmtKw(w.kw)}）`;
    case 'noLine': return '発電所につながっていない（線がない）';
    case 'noAcGen': return `つながった交流の網に発電所がない${w.other ? '（直流の火力は交流の線に送れない）' : ''}`;
    case 'noDcGen': return `つながった直流の網に発電所がない${w.other ? '（交流の発電所は直流の線に送れない）' : ''}`;
    case 'noSub': return `${nm(w.town)}に変電所がない（11 kV 以上の送電線は、町の側に変電所が要る）`;
    case 'lineDown': return `途中の線が止まっている：${ln(w.line)}（事故・過負荷${w.h ? `。あと${hh(w.h)}` : ''}）`;
    case 'lineWork': return `途中の線が工事中：${ln(w.line)}（あと${hh(w.h)}）`;
    case 'lineHz': return `途中の線が切れている（周波数違い）：${ln(w.line)}（50 Hz と 60 Hz の網を交流の線でつなぐと、脱調して保護装置で切れる）`;
    case 'dim': return '直流の電圧が下がっている（電灯が暗い。品質の低下で料金が少し減る）';
    case 'noConv': return '電鉄用の変換所がない（交流を直流 600 V に変える設備が要る）';
    case 'convCap': return `電鉄用の変換所の容量が足りない（あと ${fmtKw(w.need)}）`;
    case 'tramDown': return `架線の事故で電鉄が止まっている（あと${hh(w.h)}）`;
    default: return '';
  }
}
// 発電所の出力の理由（1行）
export function plantWhyText(G, p, w) {
  if (!w) return '';
  const hh = hoursShort;
  const towns = (w.towns || []).map((id) => nodeOf(G, id)?.name).filter(Boolean);
  const to = towns.length ? `${towns.slice(0, 3).join('・')}${towns.length > 3 ? ` ほか${towns.length - 3}か所` : ''}に送っている` : '';
  switch (w.k) {
    case 'build': return `工事中（あと${hh(w.h)}）`;
    case 'down': return `事故・故障で止まっている（修理 あと${hh(w.h)}）`;
    case 'idle': return '休止している';
    case 'black': return `全域停電からの復旧待ち（あと${hh(w.h)}）`;
    case 'start': return `起動中：あと${hh(w.h)}${w.res ? '（予備力の目標のために起動）' : '（このままでは足りなくなるので起動）'}`;
    case 'late': return `待機：起動に${hh(w.h)}かかる。起動しても間に合う時刻には足りている見込み`;
    case 'enough': return '待機：ほかの発電所で足りている（または需要がない）';
    case 'full': return `全開で運転中${to ? `（${to}）` : ''}`;
    case 'water': return `水が少ない：いま出せるのは ${fmtKw(w.cap)} まで`;
    case 'conv': return `周波数をそろえる工事中：出力は 8 割（${fmtKw(w.cap)}）まで（順に止めて改造している）`;
    case 'noLoad': return 'いまは需要がない時間';
    case 'min': return '最低出力で運転中（需要が少なく、余りは捨てている）';
    case 'reserve': return '予備力の目標のために、最低出力で運転中';
    case 'demand': return `つながった町の需要と損失の分だけ出している${to ? `（${to}）` : ''}`;
    default: return '';
  }
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
  outOfStep: { q: ['Q19', 'Q20'], title: '周波数の違う網をつないだ（脱調）', units: ['denken3-denryoku-U08', 'denken2-denryoku-U08', 'circuit-b-U13'] }, // 1.8.0
  catenary: { q: ['Q21', 'Q22', 'Q23'], title: '電鉄の架線で短絡と火災', units: ['denken3-denryoku-U09', 'denken3-kikai-U01', 'denken3-kikai-U05'] }, // 1.10.4
};
// 1.8.0 脱調の事故報告書の「なぜ」（対処したとき・標準の被害で片づいたとき）
const incWhy = (key) => (key === 'outOfStep' ? { why: OOS_WHY } : {});
export const OOS_WHY = '周波数が違うと、両側の電圧の位相のずれが回り続ける（50 Hz と 60 Hz なら毎秒 10 回転）。ずれが 180° に近づくたびに大きな電流が流れ、同期を保てない';
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
    addReport(G, { title: INCIDENTS[old.key].title, what: `${old.what || ''}対処しないまま、標準の被害で片づいた。`, ...incWhy(old.key), units: INCIDENTS[old.key].units });
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
  if (inc.cost) recordRepair(G, inc.cost * (kCost - 1));
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
        recordRepair(G, repairCost(x));
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
        recordRepair(G, repairCost(x));
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
    case 'outOfStep':
      // 標準の被害（答えずに1日）＝いちばん大きい交流の発電機の修理 1 日。正解＝その被害もなし（線は切れたまま）、誤答＝入れ直して修理 2 日
      scaleOutage(G, inc, correct ? 0 : 2);
      ok('周波数が違うままでは入れ直さず、線は切ったままにした。ほかに被害はない。', '線を入れ直してしまい、また脱調した。いちばん大きい発電機が衝撃で傷んだ（修理 2 日）。線は切れたまま。');
      break;
    case 'drought': {
      const e = evOn(G, 'drought');
      if (correct && e) e.eased = true;
      if (!correct) repHit(G, allTowns(G), 0.1);
      ok('火力を前もって動かし、需要家にも協力してもらった（渇水の間、需要 −10%・水力の落ち込みも小さい）。', '手当てが遅れ、ピークの時間に負荷遮断が出た。町の信用が下がった。');
      break;
    }
    case 'catenary':
      // 1.10.4 桜木町事故（1951年）：正解＝高速度遮断器ですぐ給電を止め被害を小さく（半日）、誤答＝給電が続いて車両が燃え3日停止
      if (inc.town) (G.tramDown ||= {})[inc.town] = inc.at + (correct ? 12 : 72);
      if (!correct && inc.town) repHit(G, [inc.town], 0.15);
      ok('高速度遮断器ですぐ給電を止め、被害を小さく抑えた。この町の電鉄は半日止まる。', '給電を止められず車両が燃え、大きな被害が出た。この町の電鉄は 3 日止まり、町の信用が下がった。');
      break;
    default:
      text = '';
  }
  G.yr.incTotal = (G.yr.incTotal || 0) + 1;
  if (correct) G.yr.incOk = (G.yr.incOk || 0) + 1;
  addReport(G, { title: INCIDENTS[inc.key].title, what: `${inc.what || ''}${correct ? '【正しく対処】' : '【対処を誤った】'}${text}`, ...incWhy(inc.key), units: INCIDENTS[inc.key].units, ok: correct });
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
// o.y1939：史実モードの 1939 年の渇水（5章。報告書に「1939年の渇水に準じる」）。o.y1951：1.10.0 史実モードの 1951 年の渇水
export const Y1951_FACT = '1951年夏、異常渇水。1951〜1953年度は供給力が足りず、渇水・火力事故のときに法的な使用制限（電灯電力の使用時間の指定・大口の使用量の制限・最大電力の指定）';
export const RESTRICT_HINT = '使用制限（運転のパネル）で、負荷遮断を避けられる';
export const RESTRICT_UNITS = ['power-system-U06', 'power-system-U14'];
const DROUGHT_MS = ['M08', 'M12']; // 渇水の間を見張るミッション
export const Y1959_FACT = '1959年9月26日、伊勢湾台風が上陸。中部電力では高潮で火力の全号機が止まり、多くの配電線が傷んで大停電になった';
export const Y1959_HINT = '海沿いの火力だけに頼ると、高潮で一度に止まる。内陸の水力や別の地域の火力があると持ちこたえやすい';
export const Y1959_UNITS = ['power-system-U14', 'power-system-U12'];
export function startEvent(G, lc, key, o = {}) {
  if (evOn(G, key)) return;
  const E = EVENTS[key];
  const ev = { key, at: G.t, until: G.t + 24 * E.days, ...(o.y1939 ? { y1939: true } : {}), ...(o.y1951 ? { y1951: true } : {}), ...(o.y1959 ? { y1959: true } : {}) };
  // 1.8.0 ミッション M08（渇水をしのぐ）・1.10.0 M12（渇水を使用制限でしのぐ）：始まったときにどちらかが出ていれば、渇水の間の負荷遮断・全域停電（と使用制限の時間）を数える
  if (key === 'drought' && missionsOn(G) && DROUGHT_MS.some((id) => G.era >= Ms.missionOf(id).era && !G.missions?.done?.[id])) Object.assign(ev, { mWatch: true, mBad: 0, mServed: 0, mRH: 0 });
  G.events.push(ev);
  if (o.y1959) {
    // 1.11.0 伊勢湾台風の高潮：海沿い（coast）の地点の火力が 2 日止まる（修理費は要らない）
    let stopped = 0;
    for (const p of G.plants) {
      if (P(p).coal && p.readyAt <= G.t && nodeOf(G, p.site)?.tags?.includes('coast')) {
        p.downUntil = Math.max(p.downUntil || 0, G.t + 48);
        p.downWhy = '高潮';
        p.on = false;
        p.onAt = null;
        stopped++;
      }
    }
    note(G, `${E.name}（高潮で海沿いの火力が 2 日停止）・1959年の伊勢湾台風に準じる`);
    addReport(G, {
      title: `${E.name}（1959年の伊勢湾台風に準じる）`,
      what: `${E.text}。${E.days}日間。高潮で海沿いの火力${stopped ? `（${stopped}台）` : ''}が 2 日間止まる（修理費はかからない）。史実：${Y1959_FACT}（S17）。${Y1959_HINT}。`,
      units: Y1959_UNITS,
    });
    return;
  }
  const y = o.y1939 ? '1939' : o.y1951 ? '1951' : '';
  const rHint = key === 'drought' && G.era >= RESTRICT_ERA; // 1.10.0 渇水のとき、使用制限の案内
  note(G, `${E.name}（${E.text}）${y ? `・${y}年の渇水に準じる` : ''}`);
  const tramNote1939 = o.y1939 && G.loads.some((l) => l.type === 'tram') ? '史実：1940年1月からの電力制限で、名古屋市電は約 25% の節電を迫られ、朝夕に急行運転をした（S27・確かめた）。' : '';
  addReport(G, {
    title: y ? `${E.name}（${y}年の渇水に準じる）` : E.name,
    what: `${E.text}。${E.days}日間。${o.y1939 ? '史実モード：昭和前期に入ったあとの夏に、1939年の渇水に準じて決まって起きる。' : ''}${tramNote1939}${o.y1951 ? `史実モード：戦後復興に入ったあとの夏に、1951年の渇水に準じて決まって起きる。史実：${Y1951_FACT}（S17）。` : ''}${rHint ? `${RESTRICT_HINT}。` : ''}`,
    units: key === 'drought' ? [...INCIDENTS.drought.units, ...(rHint ? RESTRICT_UNITS : [])] : [],
  });
  if (key === 'coalSpike') fuelObj(G, 'coal').base = 1.8;
  if (key === 'drought' && G.plants.some((p) => !P(p).coal && p.readyAt <= G.t)) raise(G, lc, 'drought', { what: '渇水で水力の出力が 4 割まで落ちた。', cool: 24 * 30 });
}

// ---- 1日に1回（0時）：申し込み・出来事・保守費・燃料の値段・信用の回復 ----
function daily(G, lc) {
  const t = G.t;
  const day = Math.floor(t / 24);
  // 1.10.2 日ごとの電力・収支の記録（30日分）と、赤字の知らせ（5.3）
  if (G.econCur?.h > 0) {
    G.econDays = [...(G.econDays || []), G.econCur].slice(-30);
    G.econCur = newEconDay();
    checkDeficit(G);
  } else G.econCur ||= newEconDay();
  // 1.8.2 日ごとの利益（収益の使い道の値段の元。直近 30 日）。前の日の 0 時からの G.yr.profit の差（年の変わり目の日は数えない）
  if (G.dayMark && G.dayMark.idx === G.yr.idx) G.profDays = [...(G.profDays || []), Math.round(G.yr.profit - G.dayMark.profit)].slice(-30);
  const s = seasonOf(t);
  missionDaily(G); // 1.8.0 ミッションの判定（前の日の結果で）。終わった渇水の判定があるので、出来事を片づける前に
  G.events = G.events.filter((e) => e.until > t || (e.key === 'coalSpike' && ((fuelObj(G, 'coal').base = FUELS.coal.base), false)));
  // 季節の出来事・時代の出来事
  const roll = (p) => rnd(G) < p;
  if (s === 1 && roll(0.006)) startEvent(G, lc, 'heat');
  if (s === 3 && roll(0.006)) startEvent(G, lc, 'cold');
  if ((s === 1 || s === 2) && roll(0.01)) startEvent(G, lc, 'typhoon');
  if (s === 3 && roll(0.01)) startEvent(G, lc, 'snowstorm');
  if (G.era >= 3 && roll(0.003)) startEvent(G, lc, 'coalSpike');
  if (G.era >= 3 && roll(0.002)) startEvent(G, lc, 'priceWar');
  if (G.era >= 4 && roll(0.003)) startEvent(G, lc, 'drought');
  // 1.8.0 史実モード（日本列島）：E4 に入ったあとの最初の夏に、1939 年の渇水に準じた渇水を1回、決まって起こす（ほかの出来事は今の確率のまま）
  if (G.era >= 4 && s === 1 && isJapan(G) && modeOf(G) === 'history' && G.drought1939 == null && !evOn(G, 'drought')) {
    G.drought1939 = t;
    startEvent(G, lc, 'drought', { y1939: true });
  }
  // 1.10.0 史実モード：E4b に入ったあとの最初の夏に、1951 年の渇水に準じた渇水を1回。1939 年の渇水が先（同じ年の夏には2回起こさない）
  if (G.era >= 5 && s === 1 && isJapan(G) && modeOf(G) === 'history' && G.drought1951 == null && G.drought1939 != null && yearOf(t) > yearOf(G.drought1939) && !evOn(G, 'drought')) {
    G.drought1951 = t;
    startEvent(G, lc, 'drought', { y1951: true });
  }
  // 1.11.0 史実モード：E5 に入ったあとの最初の秋に、1959 年の伊勢湾台風に準じた台風を1回（高潮で海沿いの火力が 2 日止まる）
  if (G.era >= 6 && s === 2 && isJapan(G) && modeOf(G) === 'history' && G.typhoon1959 == null && !evOn(G, 'typhoon')) {
    G.typhoon1959 = t;
    startEvent(G, lc, 'typhoon', { y1959: true });
  }
  // 燃料：スポットは毎日 ±30%（平均は長期契約の 0.85 倍）。長期契約は1年ごとに見直し（1.11.0 燃料ごとに別々に動く）
  for (const [k, F] of Object.entries(FUELS)) {
    const f = G.fuel?.[k] && typeof G.fuel[k] === 'object' ? G.fuel[k] : (G.fuel = initFuel())[k];
    f.spot = f.base * 0.85 * (0.7 + 0.6 * rnd(G));
    if (day % YEAR_DAYS === 0) f.contract = f.base;
  }
  // 保守費：円の側の値打ち（建設費 × YEN_K）の 0.05%（点検を延ばすと半分）
  const m = dailyMaint(G);
  G.yen -= m;
  G.acc.maint += m;
  G.yr.profit -= m;
  (G.econCur ||= newEconDay()).maint += m;
  // 接続の申し込み：受けた需要＋保留中が D_max を下回ると届く。停電の少ない町ほど届きやすい
  let used = G.loads.reduce((a, l) => a + l.kw, 0) + G.apps.reduce((a, l) => a + l.kw, 0);
  const towns = nodesOf(G).filter((n) => n.town && townActive(G, n));
  const repAvg = towns.reduce((a, n) => a + (G.rep[n.id] ?? 1), 0) / towns.length;
  const capN = appCap(G);
  let fits = used < lc.dmax - 1 && G.apps.length < capN;
  // 1.6.4：枠（1.8.1 時代の枠 appCap）か D_max で入らないとき、保留した申し込みがあれば、抽選に当たったら古い保留から取り下げて新しいものを入れる（罰なし）
  // 保留していない（未対応の）申し込みは取り下げない。保留を全部外しても入らないときは取り下げない
  if (!fits && G.apps.some((a) => a.held) && roll(0.6 * repAvg)) {
    const loadKw = G.loads.reduce((a, l) => a + l.kw, 0);
    const keep = G.apps.filter((a) => !a.held);
    if (loadKw + keep.reduce((a, l) => a + l.kw, 0) < lc.dmax - 1 && keep.length < capN) {
      const held = G.apps.filter((a) => a.held).sort((a, b) => a.at - b.at);
      while (held.length && !(used < lc.dmax - 1 && G.apps.length < capN)) {
        const old = held.shift();
        G.apps = G.apps.filter((a) => a !== old);
        used -= old.kw;
        withdrawApp(G, old);
      }
      fits = true;
    }
  } else if (fits) fits = roll(0.6 * repAvg);
  if (fits) {
    // 1.10.4 史実モード（日本列島）：明治後期（E2）から史実の町の順に、開いていて電気が届いている町から電鉄の申し込みが1件ずつ来る
    const tramDone = (G.tramDone ||= []);
    const histTownLit = (tid) => G.litTowns?.[tid] != null || (G.last?.towns?.[tid]?.r || 0) > 0.5;
    let histIdx = -1;
    if (isJapan(G) && modeOf(G) === 'history' && G.era >= 2 && !G.apps.some((a) => a.tramHist != null)) {
      histIdx = J.TRAM_HISTORY.findIndex((x, i) => !tramDone.includes(i) && towns.some((n) => n.id === x.town) && histTownLit(x.town));
    }
    let town, type, tramHist = null;
    if (histIdx >= 0) {
      town = J.TRAM_HISTORY[histIdx].town;
      type = 'tram';
      tramHist = histIdx;
    } else {
      town = pickWeighted(G, towns.map((n) => [n.id, (G.rep[n.id] ?? 1) * appWeight(G, n)]));
      const mix = { ...loadMix(G.era) };
      const tn = nodeOf(G, town);
      const sz = tn?.size || 2;
      const canRandomTram =
        G.era >= 2 &&
        (isJapan(G) && modeOf(G) === 'history'
          ? (tramDone.length >= J.TRAM_HISTORY.length || G.era >= 3) && sz >= 3
          : !isJapan(G) || sz >= 2);
      if (canRandomTram) mix.tram = 1;
      type = pickWeighted(G, Object.entries(mix));
    }
    const raw = type === 'tram' ? lc.dmax * (0.1 + 0.15 * rnd(G)) : lc.dmax * (0.05 + 0.15 * rnd(G));
    const kw = Math.max(1, Math.min(raw, lc.dmax - used));
    const r = kw >= 100 ? Math.round(kw / 10) * 10 : Math.round(kw);
    const app = { id: `A${G.nextId++}`, town, type, kw: Math.max(1, r), at: t, ...(tramHist != null ? { tramHist } : {}) };
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
  // 1.10.4 E4b〜：電鉄の需要があり変換所が動いている町で、まれに架線の短絡と火災（桜木町事故の枠）
  if (G.era >= 5) {
    const tramTowns = [...new Set(G.loads.filter((l) => l.type === 'tram').map((l) => l.town))].filter((tid) => convCapAt(G, tid, t) > 0 && !((G.tramDown?.[tid] || 0) > t));
    if (tramTowns.length && roll(0.008)) {
      const tid = tramTowns[Math.floor(rnd(G) * tramTowns.length)];
      const inc = raise(G, lc, 'catenary', { town: tid, what: `${nodeOf(G, tid).name}の電鉄で、架線が垂れ下がり電車の集電装置と車体の間で短絡してアークが出た。`, cool: month });
      if (inc) (G.tramDown ||= {})[tid] = t + 24;
    }
  }
  // 年の変わり目：スコアを残す
  if (day > 0 && day % YEAR_DAYS === 0) closeYear(G);
  G.dayMark = { idx: G.yr.idx, profit: G.yr.profit };
}
// 1.6.4 保留の取り下げ：評判・収益は変えない。G.withdrawn に残し（画面の「したことの帯」で出す。新しいもの 10 件まで）、前回からの結果にも
export const withdrawText = (G, a) => `${nodeOf(G, a.town).name}の申し込み（${LOADS[a.type].name} ${fmtKw(a.kw)}）は取り下げられた（保留の枠が埋まっていたため）`;
function markTramHist(G, idx) {
  if (idx == null) return;
  const d = (G.tramDone ||= []);
  if (!d.includes(idx)) d.push(idx);
  G.tramStep = d.length;
}
function withdrawApp(G, a) {
  markTramHist(G, a.tramHist);
  G.withdrawn = [...(G.withdrawn || []), { id: a.id, town: a.town, type: a.type, kw: a.kw, t: G.t }].slice(-10);
  note(G, withdrawText(G, a));
}
// 1.8.1 申し込みの枠（未対応＋保留の件数の上限）：明治 5件・大正 8件・昭和前期 10件・戦後復興（E4b。n 5）から 12件。
// 需要の上限（D_max）は変えない（枠が増えても、受けられる需要の合計は増えない）
export const APP_CAP = [5, 5, 8, 10, 12];
export const appCap = (G) => APP_CAP[Math.min(Math.max(G.era || 1, 1), APP_CAP.length) - 1];
// 申し込みの届きやすさ。古い島：中央の町が2倍。日本列島（1.6.0）：町の大きさ（大・中・小）で 3:2:1、
// まだ線も需要もない町は 0.3 倍（町が多いので、遠い町の申し込みばかりで保留が埋まらないように）
export function appWeight(G, n) {
  if (!isJapan(G)) return (n.id === 'T1' ? 2 : 1) * investK(G, n.id, INVEST_APP);
  const reached = n.id === startId(G) || G.loads.some((l) => l.town === n.id) || G.lines.some((l) => l.a === n.id || l.b === n.id);
  return (n.size || 1) * (reached ? 1 : 0.3) * investK(G, n.id, INVEST_APP);
}
// 1.10.3 1年のまとめ（年の変わり目のスナップショットと次の1年のねらい）
export function buildYearSummary(G, y, prevY = null) {
  const accNow = G.loads.reduce((a, l) => a + l.kw, 0);
  const prevAcc = y.startAcc ?? prevY?.accepted ?? 0;
  const totalD = (y.served || 0) + (y.unserved || 0);
  const servedPct = totalD > 1e-6 ? y.served / totalD : 1;
  const prevTot = prevY ? (prevY.served || 0) + (prevY.unserved || 0) : 0;
  const prevServedPct = prevY ? (prevTot > 1e-6 ? prevY.served / prevTot : 1) : null;
  let goal = '需要の伸びに合わせて、次の時代の電源や高圧送電線を計画してみよう。';
  if ((y.blackH || 0) > 0 || (y.shedH || 0) > 0) goal = '予備力の目標と最大の発電機1台分を見比べて、停電や負荷遮断を減らしてみよう。';
  else if ((y.unserved || 0) > 10) goal = '届いていない町の原因を確かめて、送電線や電源を補ってみよう。';
  else if ((y.profit || 0) < 0) goal = '需給の「収支のまとめ」で燃料費・損失・捨てた分を見直して、黒字を目指そう。';
  else if ((G.apps || []).length >= 3) goal = '保留や未対応の申し込みから、余裕のある町の需要を受けてみよう。';
  // 1.11.0 1年の電源の組み合わせ（火力・水力の発電電力量）
  const yg = y.gen || {};
  const yHydro = yg.hydro || 0;
  const yThermal = Object.entries(yg).filter(([k]) => k !== 'hydro').reduce((a, [, v]) => a + (v || 0), 0);
  const yGenTot = yHydro + yThermal;
  const genMix = yGenTot > 1e-6 ? { thermalPct: Math.round((yThermal / yGenTot) * 100), hydroPct: Math.round((yHydro / yGenTot) * 100), coal: Math.round(yg.coal || 0), oil: Math.round(yg.oil || 0), hydro: Math.round(yHydro) } : null;
  return {
    yearNo: y.idx + 1,
    era: G.era,
    maxDemand: Math.round(y.maxD || 0),
    prevMaxDemand: prevY ? Math.round(prevY.maxD || 0) : null,
    accepted: Math.round(accNow),
    prevAccepted: Math.round(prevAcc),
    servedPct,
    prevServedPct,
    unserved: Math.round(y.unserved || 0),
    blackH: y.blackH || 0,
    shedH: y.shedH || 0,
    profit: Math.round(y.profit || 0),
    prevProfit: prevY ? Math.round(prevY.profit || 0) : null,
    built: y.built || 0,
    incTotal: y.incTotal || 0,
    incOk: y.incOk || 0,
    litTowns: y.litNew || 0,
    genMix,
    goal,
  };
}
function closeYear(G) {
  const prevY = G.years[G.years.length - 1] || null;
  const accepted = G.loads.reduce((a, l) => a + l.kw, 0);
  const y = { ...G.yr, okRate: G.yr.hours ? G.yr.okH / G.yr.hours : 1, accepted };
  G.yearSummary = buildYearSummary(G, y, prevY);
  G.years.push(y);
  if (G.years.length > 6) G.years.shift();
  if (!G.best || y.profit > G.best.profit) G.best = y;
  note(G, `${y.idx + 1}年目の決算：利益 ${Math.round(y.profit).toLocaleString('ja-JP')} 円`);
  G.yr = newYear(y.idx + 1, accepted);
  // 1.11.0 M15（火主水従）：年の変わり目の決算で火力の発電電力量が水力を上回ったらすぐ達成
  if (missionsOn(G)) {
    G.missions ||= { done: {} };
    const m15 = Ms.missionOf('M15');
    if (m15 && missionOpen(G, m15) && !missionDone(G, 'M15')) {
      const r = missionCheck(G, m15, null);
      if (r) achieveMission(G, m15, r);
    }
  }
}
// 1.10.3 初めて電気が届いた町へ至る送電線の経路（BFS。演出で光を走らせる線 ID の配列）
export function litPathLines(G, townId, t = G.t) {
  const readyPlants = new Set(G.plants.filter((p) => plantReady(p, t)).map((p) => p.site));
  if (readyPlants.has(townId)) return [];
  const adj = new Map();
  for (const l of G.lines) {
    if (!lineActive(G, l, t)) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push([l.b, l.id]);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push([l.a, l.id]);
  }
  const prev = new Map([[townId, null]]);
  const q = [townId];
  let hit = null;
  while (q.length && !hit) {
    const u = q.shift();
    for (const [v, lid] of adj.get(u) || []) {
      if (prev.has(v)) continue;
      prev.set(v, [u, lid]);
      if (readyPlants.has(v)) { hit = v; break; }
      q.push(v);
    }
  }
  if (!hit) return [];
  const lines = [];
  let cur = hit;
  while (cur !== townId) {
    const [next, lid] = prev.get(cur);
    lines.push(lid);
    cur = next;
  }
  return lines;
}
// 1.10.3 事故・復旧の波及順：起点（事故の地点・発電所など）から送電線のホップ距離順に町を並べる
export function townWaveOrder(G, originIds = [], t = G.t) {
  const starts = originIds.filter(Boolean);
  if (!starts.length) {
    const p = G.plants.find((x) => x.readyAt <= t);
    if (p) starts.push(p.site);
    else starts.push(startId(G));
  }
  const adj = new Map();
  for (const l of G.lines) {
    if (l.readyAt > t) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l.b);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l.a);
  }
  const dist = new Map();
  const q = [];
  for (const s of starts) if (!dist.has(s)) dist.set(s, 0), q.push(s);
  while (q.length) {
    const u = q.shift();
    const d = dist.get(u);
    for (const v of adj.get(u) || []) if (!dist.has(v)) dist.set(v, d + 1), q.push(v);
  }
  const towns = [...new Set(G.loads.map((l) => l.town))];
  return towns.map((id) => ({ id, hop: dist.has(id) ? dist.get(id) : 99 })).sort((a, b) => a.hop - b.hop);
}

export function fmtKw(kw) {
  if (kw >= 1000) return `${(kw / 1000).toFixed(kw >= 10000 ? 0 : 1).replace(/\.0$/, '')} MW`;
  return `${kw >= 100 ? Math.round(kw) : Math.round(kw * 10) / 10} kW`;
}

// ---- 故障（設計 8章）。確率はゲームの1日あたり → 1時間あたりに直して判定 ----
export function plantFailRate(G, p, t, lc) {
  const age = Math.max(0, (t - p.builtAt) / (24 * YEAR_DAYS));
  const perf = P(p).ac ? (perfNow(G, lc, P(p).perf) + perfNow(G, lc, 'gen')) / 2 : perfNow(G, lc, 'dc');
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
  const prot = 1 - 0.3 * perfNow(G, lc, 'prot'); // 保護の単元の定着で、止まる時間が短くなる
  for (const p of G.plants) {
    if (!p.on || p.downUntil > t) continue;
    if (rnd(G) >= plantFailRate(G, p, t, lc) / 24) continue;
    if (shielded()) continue;
    const dur = Math.round((24 + 48 * rnd(G)) * prot);
    const cost = repairCost(p);
    recordRepair(G, cost);
    G.acc.fails++;
    trip.add(p.id);
    p._fail = { dur, cost };
  }
  for (const l of G.lines) {
    if (l.hzTrip || l.readyAt > t || lineCircuits(l, t) <= 0) continue;
    const hz = lineHazard(G, l, t, lc);
    if (rnd(G) >= hz.perDay / 24) continue;
    if (shielded()) continue;
    const cause = pickWeighted(G, [['other', 1], ['thunder', hz.m.thunder - 1], ['coast', hz.m.coast - 1], ['snow', hz.m.snow - 1]]);
    const dur = Math.round((12 + 36 * rnd(G)) * prot * (optOn(l, 'petersen', t) && cause === 'other' ? LINE_OPTS.petersen.k : 1));
    const cost = repairCost(l);
    const circuit = l.n - (l.c1Until > t ? 1 : 0) >= 2; // 2回線以上あれば、止まるのは1回線
    if (circuit) l.c1Until = t + dur;
    else l.downUntil = t + dur;
    l.downCause = cause; // 1.8.2 詳細の見出しの絵（雷・塩害・雪・そのほか）
    recordRepair(G, cost);
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
    const rate = 0.002 * (1 + 0.1 * age) * (util > 1.2 ? 3 : 1) * (s.failUntil > t ? s.failK : 1) * (1 - 0.5 * perfNow(G, lc, 'tr')) * (G.maint === 'defer' ? 2.5 : 1);
    if (rnd(G) >= rate / 24) continue;
    if (shielded()) continue;
    const dur = Math.round((24 + 48 * rnd(G)) * prot);
    const cost = repairCost(s);
    s.downUntil = t + dur;
    recordRepair(G, cost);
    G.acc.fails++;
    const name = `${nodeOf(G, s.town).name}の変電所`;
    addReport(G, { title: `${name}の変圧器が故障`, what: `${name}の変圧器（${s.mva} MVA）が止まった。修理に ${dur}時間。${util > 1.2 ? '定格の 120% を超えて使っていた。' : ''}`, why: util > 1.2 ? '過負荷' : '設備の故障', units: INCIDENTS.trLoss.units });
    note(G, `${name}の変圧器が故障`);
  }
  for (const c of G.convs || []) {
    if (c.readyAt > t || c.downUntil > t) continue;
    const D = CONVS[c.type];
    const age = Math.max(0, (t - c.builtAt) / (24 * YEAR_DAYS));
    const util = prev?.convs?.[c.town] || 0;
    const rate = D.fail * (1 + 0.1 * age) * (util > 1.2 ? 3 : 1) * (c.proto ? 3 : 1) * (1 - 0.5 * perfNow(G, lc, 'conv')) * (G.maint === 'defer' ? 2.5 : 1);
    if (rnd(G) >= rate / 24) continue;
    if (shielded()) continue;
    const dur = Math.round((24 + 48 * rnd(G)) * prot);
    const cost = repairCost(c);
    c.downUntil = t + dur;
    recordRepair(G, cost);
    G.acc.fails++;
    const name = `${nodeOf(G, c.town).name}の${D.short}`;
    addReport(G, { title: `${name}が故障`, what: `${name}（${fmtKw(c.kw)}）が止まった。修理に ${dur}時間。`, why: '設備の故障', units: GATES.conv });
    note(G, `${name}が故障`);
  }
  return trip;
}
export function lineName(G, l) {
  return `${nodeOf(G, l.a).name}〜${nodeOf(G, l.b).name}の${lineShort(l)}`;
}

// ---- 1.8.0 周波数の違う網と脱調（禁止はしない。結果は物理で返す） ----
// 交流の線に電気が入るとき（完成・修理のあと・変電所ができたとき・入れ直し）、その線が「交流の発電機のある網どうしで周波数の違うもの」を
// 結ぶ形になったら、その線は保護装置で切れる（l.hzTrip。網の計算から外す。撤去・入れ直しはできる）。
// 判定の順：前から電気が入っていた線（l.inAt の古い順）を先に、新しく入る線をあとに。発電機は完成したものだけを数える
// （工事中の発電機が完成して網が2つの周波数になったときは、あとからつながる側の線が切れる）。
// 事故 outOfStep は同じ線で 24 時間に1回まで。切れた刻みは、両側の網の周波数の乱れ（±0.5 Hz。品質の低下と同じ扱い。負荷遮断はしない）
export const OOS_X = 0.5;
function hzCheck(G, lc, t) {
  const live = G.lines.filter((l) => !LINES[l.kind].dc && !l.hzTrip && lineActive(G, l, t));
  for (const l of G.lines) if (l.inAt != null && !live.includes(l)) delete l.inAt;
  if (!live.length) return [];
  const up = new Map(), hz = new Map();
  const find = (x) => {
    if (!up.has(x)) up.set(x, x);
    let r = x;
    while (up.get(r) !== r) r = up.get(r);
    while (up.get(x) !== r) {
      const n = up.get(x);
      up.set(x, r);
      x = n;
    }
    return r;
  };
  for (const p of G.plants) if (PLANTS[p.type].ac && p.hz && p.readyAt <= t && !hz.has(find(p.site))) hz.set(find(p.site), p.hz);
  live.sort((a, b) => (a.inAt ?? Infinity) - (b.inAt ?? Infinity) || 0);
  const out = [];
  for (const l of live) {
    const ra = find(l.a), rb = find(l.b);
    if (ra === rb) continue;
    const ha = hz.get(ra), hb = hz.get(rb);
    if (ha && hb && ha !== hb) {
      // つながっていた両側の地点（このときの網。あとの線でつながる分は含めない）
      const side = new Set([...up.keys()].filter((v) => find(v) === ra || find(v) === rb));
      out.push({ l, ha, hb, side });
      continue;
    }
    up.set(ra, rb);
    if (!hb && ha) hz.set(rb, ha);
    if (l.inAt == null) l.inAt = t;
  }
  for (const x of out) tripHz(G, lc, t, x);
  return out;
}
function tripHz(G, lc, t, { l, ha, hb, side }) {
  l.hzTrip = true;
  l.hzAt = t;
  l.hzPair = [nodeOf(G, l.a).name, ha, nodeOf(G, l.b).name, hb];
  delete l.inAt;
  (G._oos ||= []).push({ a: l.a, b: l.b, ha, hb }); // この刻みの周波数の乱れ（oosDisturb）
  const name = lineName(G, l);
  note(G, `${name}が脱調で切れた（${ha} Hz と ${hb} Hz の網をつないだ）`);
  if (l.oosAt != null && t - l.oosAt < 24) return; // 同じ線の事故は 24 時間に1回まで
  l.oosAt = t;
  const what = `${name}に電気が入り、${ha} Hz の網と ${hb} Hz の網がつながった。脱調して、保護装置が線を切った。`;
  // 標準の被害（答えずに1日）：つながっていた両側で、いちばん大きい交流の発電機の修理 1 日
  const big = G.plants.filter((p) => PLANTS[p.type].ac && plantReady(p, t) && side.has(p.site)).sort((a, b) => b.kw - a.kw)[0];
  const inc = raise(G, lc, 'outOfStep', { line: l.id, what, cool: 1 });
  if (inc && big) {
    const cost = repairCost(big);
    Object.assign(inc, { plant: big.id, dur: 24, cost, what: `${what}${nodeOf(G, big.site).name}の${P(big).short}（${fmtKw(big.kw)}）が脱調の衝撃を受け、点検で止まっている。` });
    big.downUntil = t + 24;
    big.on = false;
    big.onAt = null;
    recordRepair(G, cost);
  }
  if (!inc) addReport(G, { title: `${name}が脱調で切れた`, what: `${what}線は切れたまま（線の詳細から入れ直せる）。`, why: OOS_WHY, units: INCIDENTS.outOfStep.units });
}
// 切れた刻み：両側の網（50 Hz・60 Hz）の周波数の乱れ。高い周波数の網は下がり、低い網は上がる向き
function oosDisturb(G, sol) {
  const list = G._oos;
  if (!list?.length) return;
  delete G._oos;
  for (const r of sol.results) {
    if (r.net.dc || !r.net.plants.length) continue;
    const hit = list.find((o) => r.net.nodes.includes(o.a) || r.net.nodes.includes(o.b));
    if (!hit) continue;
    const sign = r.hz === Math.max(hit.ha, hit.hb) ? -1 : 1;
    r.x = sign * Math.max(Math.abs(r.x || 0), OOS_X);
    r.oos = true;
  }
}
// 線の詳細の「入れ直す」：周波数が違うままなら、すぐにまた切れる（事故は同じ線で 24 時間に1回まで）。そろっていれば入る
export function recloseLine(G, lc, id) {
  const l = G.lines.find((x) => x.id === id);
  if (!l || !l.hzTrip) return { ok: false, why: '切れている線ではない' };
  delete l.hzTrip;
  delete l.hzAt;
  delete l.hzPair;
  const out = hzCheck(G, lc, G.t);
  const again = out.some((x) => x.l === l);
  return { ok: true, again, live: !again && lineActive(G, l, G.t) };
}

// ---- 1.10.0 周波数をそろえる工事（九州の 60 Hz 統一 第1期 1949〜1951・第2期 1954〜1960 に準じる。S17） ----
// 交流の網（線でつながった範囲。acComponent）の交流の発電機の周波数を、もう一方（50 Hz ↔ 60 Hz）に変える。戦後復興（E4b）から、昭和前期では試作（費用 3 倍）。
// 費用（円の側の基準。コインは COIN_K 倍）＝網の交流の発電機の建設費の合計 × 0.3 ＋ 網の変電所の建設費の合計 × 0.1（発電機の改造と、変圧器・需要家の機器の取り替え）。
// 工期＝ゲームの 20 日 ＋ 発電機 1 台につき 5 日。工事の間、その発電機の出力の上限は 8 割（順に止めて改造する）。
// 変えるのは工事を始めた時点の網の発電機だけ（工事中に網が分かれた・ほかの網とつながった・発電所を建てた、などは見ない。建てた発電所は元の周波数のまま）。
// 終わったら、周波数違いで切れていた線は 1.8.0 の決まりどおり「入れ直す」で入れられる（自動では入れない）
export const HZCONV = { era: 5, plantK: 0.3, subK: 0.1, days: 20, perPlant: 5, capK: 0.8, gates: ['hzConv'], masteredGate: true, perf: 'freq' };
export const otherHz = (hz) => (hz === 50 ? 60 : hz === 60 ? 50 : null);
export const hzWorkOf = (G, plantId) => (G.hzWork || []).find((w) => w.plants.includes(plantId) && w.until > G.t) || null;
// その地点の交流の網で、変える発電機と、数える変電所
export function hzConvTarget(G, id) {
  const nodes = acComponent(G, id);
  const from = netHz(G, id);
  const plants = from ? G.plants.filter((p) => PLANTS[p.type].ac && p.hz === from && nodes.has(p.site)) : [];
  const subs = G.subs.filter((x) => nodes.has(x.town));
  return { nodes, from, to: otherHz(from), plants, subs };
}
export function quoteHzConv(G, lc, id) {
  const st = eraStatus(lc, HZCONV.era);
  if (st === 'no') return { ok: false, why: 'まだ先の時代の工事（戦後復興から。昭和前期は試作）', era: true };
  const T = hzConvTarget(G, id);
  if (!T.from || !T.plants.length) return { ok: false, why: 'この地点の交流の網に、周波数の決まった交流の発電機がない' };
  if (T.plants.some((p) => hzWorkOf(G, p.id))) return { ok: false, why: 'この網は、周波数をそろえる工事の最中', busy: true };
  const gc = gateCheck(lc, HZCONV.gates, !!HZCONV.masteredGate);
  if (gc) return { ...gc, from: T.from, to: T.to };
  const proto = st === 'proto';
  const base = Math.max(50, Math.round((T.plants.reduce((a, p) => a + p.cost, 0) * HZCONV.plantK + T.subs.reduce((a, x) => a + x.cost, 0) * HZCONV.subK) * (proto ? 3 : 1)));
  const days = HZCONV.days + HZCONV.perPlant * T.plants.length;
  return { ok: true, cost: coinOf(base), base, days, hours: days * 24, proto, from: T.from, to: T.to, plants: T.plants.map((p) => p.id), subs: T.subs.length, node: id, capK: HZCONV.capK };
}
export function startHzConv(G, lc, id) {
  const q = quoteHzConv(G, lc, id);
  if (!q.ok) return q;
  const w = { id: `H${G.nextId++}`, node: id, from: q.from, to: q.to, plants: q.plants, at: G.t, until: G.t + q.hours, cost: q.base, proto: q.proto };
  G.hzWork = [...(G.hzWork || []), w];
  for (const p of G.plants) if (q.plants.includes(p.id)) p.convUntil = w.until;
  note(G, `${nodeOf(G, id).name}の網で、周波数をそろえる工事（${q.from} Hz → ${q.to} Hz）を始めた`);
  addReport(G, { title: `周波数をそろえる工事を始めた（${q.from} Hz → ${q.to} Hz）`, what: `${nodeOf(G, id).name}の網の交流の発電機 ${q.plants.length}台を ${q.to} Hz に改造する。工期 ${q.days}日。工事の間、その発電機の出力は 8 割まで（順に止めて改造するため）。`, units: HZCONV_UNITS });
  return { ...q, work: w };
}
export const HZCONV_UNITS = ['circuit-b-U13', 'power-system-U03'];
// 工事の完成（step の最初）
function hzConvHour(G) {
  const t = G.t;
  const done = (G.hzWork || []).filter((w) => w.until <= t);
  if (!done.length) return;
  G.hzWork = G.hzWork.filter((w) => w.until > t);
  for (const w of done) {
    let n = 0;
    for (const p of G.plants) {
      if (!w.plants.includes(p.id)) continue;
      p.hz = w.to;
      delete p.convUntil;
      n++;
    }
    G.hzConvDone = (G.hzConvDone || 0) + 1;
    G.hzConvLast = { node: w.node, from: w.from, to: w.to, n, t };
    const name = nodeOf(G, w.node)?.name || '';
    note(G, `${name}の網を ${w.to} Hz にそろえた`);
    const tripped = G.lines.some((l) => l.hzTrip);
    addReport(G, { title: `${name}の網を ${w.to} Hz にそろえた`, what: `周波数をそろえる工事が終わった（${w.from} Hz → ${w.to} Hz、発電機 ${n}台）。発電機の出力の上限も元に戻った。${w.to} Hz の網と交流の線でつなげる。${tripped ? '周波数違いで切れていた線は、線の詳細の「入れ直す」で入れ直せる（周波数がそろっていれば入る）。' : ''}`, units: HZCONV_UNITS, ok: true });
  }
}

// ---- 1.8.0 史実モードのミッション（データと答え合わせの文は gridmission.js） ----
// 出すのは史実モードの日本列島の系統だけ（古い島・自由モード・デモ・練習の東京では出さない）。時代が進む条件にはしない
// 判定はゲームの1日（0時）に、前の日の結果（G.day：町ごとの需要・届いた量・直流から届いた量、発電所ごとの発電量、売電）で確かめる
export const missionsOn = (G) => !!G && isJapan(G) && modeOf(G) === 'history' && !G.noMissions;
export const missionOpen = (G, m) => m.era <= G.era;
export const missionDone = (G, id) => !!G?.missions?.done?.[id];
export const newMissions = (G, from, to) => (missionsOn(G) ? Ms.MISSIONS.filter((m) => m.era > from && m.era <= to) : []);
const newDay = () => ({ h: 0, rev: 0, towns: {}, plants: {}, lines: {} });
// 1刻みごとに、その日の結果を積み上げる（step の最後）
function missionHour(G, last, bad) {
  const d = (G.day ||= newDay());
  d.h++;
  d.rev += last.rev || 0;
  for (const [n, x] of Object.entries(last.towns)) {
    const v = (d.towns[n] ||= [0, 0, 0]);
    v[0] += x.d;
    v[1] += x.d * x.r;
    v[2] += x.dc || 0;
  }
  for (const [id, o] of Object.entries(last.plants)) if (o > 0) d.plants[id] = (d.plants[id] || 0) + o;
  // 1.10.0 M10：関門の線（下関〜小倉・八幡の交流の線）に電気が流れたか
  if (!missionDone(G, 'M10')) {
    d.lines ||= {};
    for (const l of G.lines) if (isKanmon(l.a, l.b) && !LINES[l.kind].dc && (last.lines[l.id]?.p || 0) > 1e-3) d.lines[l.id] = (d.lines[l.id] || 0) + last.lines[l.id].p;
  }
  const e = G.events.find((x) => x.key === 'drought' && x.mWatch && x.until > last.t);
  if (e) {
    if (bad) e.mBad++;
    e.mServed += last.served || 0;
    if (restrictOn(G)) e.mRH = (e.mRH || 0) + 1; // 1.10.0 M12：渇水の間に使用制限を使った時間
  }
}
function missionDaily(G) {
  if (!missionsOn(G)) {
    if (G.day) delete G.day;
    return;
  }
  const day = G.day?.h > 0 ? G.day : null;
  G.day = newDay();
  G.missions ||= { done: {} };
  if (day) G.revDays = [...(G.revDays || []), Math.round(day.rev)].slice(-7);
  for (const m of Ms.MISSIONS) {
    if (!missionOpen(G, m) || G.missions.done[m.id]) continue;
    const r = missionCheck(G, m, day);
    if (r) achieveMission(G, m, r);
  }
}
const servedDay = (day, n, k = 0.9) => {
  const v = day?.towns[n];
  return !!v && v[0] > 1e-9 && v[1] >= k * v[0] - 1e-9;
};
// 発電所から、線をたどって町に届く道（木の形なので道は1つ）。その道のうち cond.kv 以上の線の長さの合計（直流は直流の線）。
// live：電気が入っている線だけ・前の日に発電した発電所だけ・前の日の需要の 90% 以上に届いた町だけ（達成の判定）。
// そうでなければ、今ある線（工事中を含む。周波数違いで切れている線は除く）で、いちばん長い道（進み具合）
export function deliverBest(G, cond, { live = false, day = null } = {}) {
  const dc = cond.src === 'dc';
  const t = G.t;
  const adj = new Map();
  for (const l of G.lines) {
    if (!!LINES[l.kind].dc !== dc || l.hzTrip || (live && !lineActive(G, l, t))) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push([l.b, l]);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push([l.a, l]);
  }
  const srcOk = (p) => (dc ? !PLANTS[p.type].ac : PLANTS[p.type].ac && (cond.src === 'dam' ? p.type === 'dam' : cond.src !== 'hydro' || !PLANTS[p.type].coal));
  const best = { km: 0, ok: false, plant: null, town: null };
  for (const p of G.plants) {
    if (!srcOk(p) || (live && !((day?.plants[p.id] || 0) > 0))) continue;
    const seen = new Set([p.site]);
    const stack = [[p.site, 0]];
    while (stack.length) {
      const [v, km] = stack.pop();
      for (const [w, l] of adj.get(v) || []) {
        if (seen.has(w)) continue;
        seen.add(w);
        const lineOk = dc || (lineKv(l) >= cond.kv && (!cond.upgraded || !!l.upgraded500));
        const q = km + (lineOk ? l.km : 0);
        stack.push([w, q]);
        if (!nodeOf(G, w)?.town) continue;
        if (live && !servedDay(day, w)) continue;
        if (q > best.km + 1e-9) Object.assign(best, { km: q, plant: p.id, town: w });
        if (q >= cond.km - 1e-9) best.ok = true;
      }
    }
  }
  return best;
}
export function missionCheck(G, m, day) {
  const c = m.cond;
  switch (c.kind) {
    case 'dcLamp': {
      if (!day) return null;
      const towns = [...new Set(G.loads.filter((l) => l.type === 'lamp').map((l) => l.town))];
      const n = towns.find((x) => {
        const v = day.towns[x];
        return v && v[0] > 1e-9 && v[2] >= 0.9 * v[0] - 1e-9;
      });
      return n ? { info: { town: n } } : null;
    }
    case 'acPlant': {
      const p = G.plants.find((x) => PLANTS[x.type].ac && x.hz);
      return p ? { info: { hz: p.hz, site: p.site } } : null;
    }
    case 'deliver': {
      if (!day) return null;
      const b = deliverBest(G, c, { live: true, day });
      return b.ok ? { info: { plant: b.plant, town: b.town, km: Math.round(b.km) } } : null;
    }
    case 'drought': {
      // 見ていた渇水が終わったら判定する（負荷遮断・全域停電が1時間もなく、電気を届けていたら達成）。
      // 1.10.0 c.restrict（M12）：そのうえ渇水の間に使用制限を 24 時間（1 日）以上使った。判定済みはミッションごと（e.judged。1.8.0 の e.mJudged は M08 の分）
      let hit = null;
      const tk = triesKey(m);
      for (const e of G.events) {
        if (e.key !== 'drought' || !e.mWatch || e.until > G.t) continue;
        const judged = e.judged?.[m.id] || (m.id === 'M08' && e.mJudged);
        if (judged) continue;
        e.judged = { ...(e.judged || {}), [m.id]: true };
        if (m.id === 'M08') e.mJudged = true;
        const rOk = !c.restrict || (e.mRH || 0) >= 24;
        if (!e.mBad && e.mServed > 0 && rOk) hit = { info: { y1939: !!e.y1939, y1951: !!e.y1951, ...(c.restrict ? { rDays: Math.floor((e.mRH || 0) / 24) } : {}) } };
        else {
          G.missions[tk] = (G.missions[tk] || 0) + 1;
          const why = [e.mBad ? `負荷遮断・全域停電が ${e.mBad}時間あった` : '', e.mServed > 0 ? '' : '電気を届けていなかった', rOk ? '' : `使用制限を使ったのが ${e.mRH || 0}時間だった（1日＝24時間以上）`].filter(Boolean).join('。');
          addReport(G, { title: `ミッション「${m.name}」は次の渇水で`, what: `今回の渇水の間に、${why}。次の渇水で、また挑戦できる（${c.restrict ? '渇水が来たら、運転のパネルの使用制限を選ぶ' : '火力の予備を用意しておく'}）。`, units: m.units });
        }
      }
      return hit;
    }
    case 'kanmon': {
      // 1.10.0 M10：下関と小倉・八幡を交流の線で結び、前の日にその線に電気が流れていた（脱調で切れていない）
      if (!day) return null;
      const l = G.lines.find((x) => isKanmon(x.a, x.b) && !LINES[x.kind].dc && !x.hzTrip && (day.lines?.[x.id] || 0) > 0);
      return l ? { info: { line: l.id, kv: LINES[l.kind].kv } } : null;
    }
    case 'hzConv':
      // 1.10.0 M11：周波数をそろえる工事を1つ終える
      return G.hzConvDone > 0 ? { info: { ...(G.hzConvLast || {}) } } : null;
    case 'oilHalf': {
      // 1.11.0 M14：32.5万 kW 以上の重油火力を動かし、1日の発電の半分以上を出す
      if (!day) return null;
      const tot = Object.values(day.plants || {}).reduce((a, b) => a + b, 0);
      if (tot <= 1e-6) return null;
      const bigOil = G.plants.filter((p) => p.type === 'oilFire' && p.kw >= (c.minKw || 325000));
      const got = bigOil.reduce((a, p) => a + (day.plants?.[p.id] || 0), 0);
      return got >= tot * 0.5 - 1e-6 ? { info: { pct: Math.round((got / tot) * 100) } } : null;
    }
    case 'thermalLead': {
      // 1.11.0 M15：1年の記録（年の変わり目の決算）で、火力の発電電力量が水力を上回る
      const hit = (G.years || []).find((y) => {
        const g0 = y.gen || {};
        const hydro = g0.hydro || 0;
        const thermal = Object.entries(g0).filter(([k]) => k !== 'hydro').reduce((a, [, v]) => a + (v || 0), 0);
        return thermal > 1e-6 && thermal > hydro;
      });
      if (!hit) return null;
      const g0 = hit.gen || {};
      const hydro = g0.hydro || 0;
      const thermal = Object.entries(g0).filter(([k]) => k !== 'hydro').reduce((a, [, v]) => a + (v || 0), 0);
      return { info: { yearNo: hit.idx + 1, thermalPct: Math.round((thermal / (thermal + hydro)) * 100) } };
    }
    default:
      return null;
  }
}
// 再挑戦の回数のキー（M08 は 1.8.0 の G.missions.tries）
const triesKey = (m) => (m.id === 'M08' ? 'tries' : `tries${m.id}`);
// ご褒美：収益（円）に「直近 7 日の売電の平均の 5 日分」（収益は学習通貨に換えられないので、学習の釣り合いは変わらない）
export function missionReward(G) {
  const d = G.revDays || [];
  return d.length ? Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 5) : 0;
}
function achieveMission(G, m, r) {
  const reward = missionReward(G);
  G.yen += reward;
  (G.econCur ||= newEconDay()).reward += reward; // 1.10.2 ご褒美は収支の横棒・赤字判定には入れない（別行）
  G.missions.done[m.id] = { t: G.t, era: G.era, info: r.info || {}, reward };
  (G.missions.fresh ||= []).push(m.id); // 画面：したことの帯と答え合わせのカード（見せたら消す）
  const ans = Ms.answerOf(m, G);
  if (ans.year) G.missions.done[m.id].year = ans.year; // 再現した史実の年表に出す年（gridmenu.js の factTimeline。年のない物理のミッションは出さない）
  note(G, `ミッション達成：${m.name}`);
  addReport(G, { title: `ミッション達成：${m.name}`, what: `${m.goal}。ご褒美：収益 +${reward.toLocaleString('ja-JP')} 円（直近 7 日の売電の平均の 5 日分）。答え合わせ：${ans.text}${ans.extra ? `。${ans.extra}` : ''}`, units: m.units, ok: true });
}
// 進み具合の1行（一覧のパネル）
export function missionProgress(G, m) {
  const c = m.cond;
  if (missionDone(G, m.id)) return '達成';
  switch (c.kind) {
    case 'dcLamp': {
      const n = G.plants.filter((p) => !PLANTS[p.type].ac).length;
      const k = new Set(G.loads.filter((l) => l.type === 'lamp').map((l) => l.town)).size;
      return `直流の火力 ${n} ・ 電灯の需要のある町 ${k}`;
    }
    case 'acPlant':
      return `交流の発電機 ${G.plants.filter((p) => PLANTS[p.type].ac).length ? 1 : 0} / 1`;
    case 'deliver': {
      const b = deliverBest(G, c);
      const what = c.src === 'dc' ? '直流 200 V の線' : c.upgraded ? '500 kV に上げた線' : `${c.src === 'dam' ? 'ダムから ' : c.src === 'hydro' ? '水力から ' : ''}${c.kv ? `${c.kv} kV 以上の線` : '線'}`;
      const km = b.km >= 10 ? Math.floor(b.km) : Math.floor(b.km * 10) / 10;
      return `${what} ${km} / ${c.km} km${b.km >= c.km ? '（線は足りている。町に1日の需要の 90% 以上が届けば、次の 0 時に達成）' : ''}`;
    }
    case 'drought': {
      const e = G.events.find((x) => x.key === 'drought' && x.mWatch && x.until > G.t);
      if (e) return `渇水の間：あと${Math.ceil((e.until - G.t) / 24)}日${c.restrict ? ` ・ 使用制限 ${Math.floor((e.mRH || 0) / 24)}日${restrictOn(G) ? `（いま ${RESTRICT[restrictOn(G)].short}）` : '（いまは使っていない）'}` : ''} ・ 負荷遮断と全域停電 ${e.mBad}時間`;
      if (G.missions?.[triesKey(m)]) return `前の渇水では${c.restrict ? '使用制限が足りないか、' : ''}負荷遮断・全域停電があった。次の渇水で、また挑戦できる`;
      if (c.restrict && G.drought1951 == null && G.era >= 5) return '戦後復興に入ったあとの夏に、渇水が起きる（史実モード）';
      if (!c.restrict && G.drought1939 == null && G.era >= 4) return '昭和前期に入ったあとの夏に、渇水が起きる（史実モード）';
      return '渇水が起きるのを待つ';
    }
    case 'kanmon': {
      const ls = G.lines.filter((x) => isKanmon(x.a, x.b) && !LINES[x.kind].dc);
      if (!ls.length) return '下関〜小倉・八幡の交流の線：まだない（66 kV 以上）';
      if (ls.every((x) => x.hzTrip)) return '線は切れている（周波数違い）。両側の周波数をそろえてから入れ直す';
      const work = ls.filter((x) => x.readyAt > G.t);
      if (work.length === ls.length) return `線は工事中（あと${hoursShort(Math.min(...work.map((x) => x.readyAt - G.t)))}）`;
      return '線はある。電気が流れれば、次の 0 時に達成（両端の町に変電所が要る）';
    }
    case 'hzConv': {
      const w = (G.hzWork || [])[0];
      if (w) return `工事中：${nodeOf(G, w.node)?.name || ''}の網 ${w.from} Hz → ${w.to} Hz（あと${hoursShort(w.until - G.t)}）`;
      return '周波数をそろえる工事 0 / 1';
    }
    case 'oilHalf': {
      const n = G.plants.filter((p) => p.type === 'oilFire' && p.kw >= (c.minKw || 325000)).length;
      return n ? `32.5万 kW 以上の重油火力 ${n} 台（1日の発電の半分以上を出せば、次の 0 時に達成）` : '32.5万 kW 以上の重油火力 0 / 1';
    }
    case 'thermalLead': {
      const g0 = G.yr?.gen || {};
      const hydro = g0.hydro || 0;
      const thermal = Object.entries(g0).filter(([k]) => k !== 'hydro').reduce((a, [, v]) => a + (v || 0), 0);
      const tot = hydro + thermal;
      return tot > 1e-6 ? `今年のこれまで：火力 ${Math.round((thermal / tot) * 100)}%・水力 ${Math.round((hydro / tot) * 100)}%（年の変わり目の決算で判定）` : '年の変わり目の決算で判定';
    }
    default:
      return '';
  }
}

// ---- 1刻み（ゲームの1時間）進める ----
export function step(G, lc) {
  const t = G.t;
  if (t % 24 === 0) daily(G, lc);
  researchHour(G); // 1.8.2 研究開発の完成
  hzConvHour(G); // 1.10.0 周波数をそろえる工事の完成（hzCheck より前に）
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
  for (const c of G.convs || []) if (!c.done && c.readyAt <= t) (c.done = true), note(G, `${nodeOf(G, c.town).name}の${CONVS[c.type].short}（${fmtKw(c.kw)}）が使えるようになった`);
  for (const l of G.lines) if (!l.done && l.readyAt <= t) (l.done = true), note(G, `${lineName(G, l)}が開通した`);
  finishCircuits(G, t);
  finishUpgradeLines(G, t);

  hzCheck(G, lc, t); // 1.8.0 電気が入る交流の線が、周波数の違う網どうしを結ぶ形なら、脱調して切れる
  const trip = failures(G, lc, G.last);
  const sol = solve(G, lc, t, { trip });
  oosDisturb(G, sol);
  const tripNet = new Map();
  for (const r of sol.results) for (const id of r.tripped) tripNet.set(id, r);
  for (const p of G.plants) {
    if (!trip.has(p.id)) continue;
    p.on = false;
    p.onAt = null;
    p.downUntil = t + p._fail.dur;
    delete p.downWhy;
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
  let fuel = 0, loss = 0, lineLossSum = 0, subLossSum = 0, wasteSum = 0, worst = 0, anyShed = false, anyBlack = false, anyBad = false, hzLoad = -1;
  const last = { t, plants: {}, lines: {}, subs: {}, convs: {}, towns: {}, x: 0, hz: 0, demand: 0, served: 0, loss: 0, cap: 0, K: 0 };
  const gen = { dc: 0, coal: 0, hydro: 0 };
  const ec = (G.econCur ||= newEconDay());
  const econK = 1 - 0.05 * perfNow(G, lc, 'econ');
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
      const pf = P(p).coal ? (o / plantEff(p, lc, G)) * fuelPrice(G, t, p.site, P(p).fuel || 'coal') * econK : 0; // 捨てた分（最低出力のための余り）も燃料は使う（1.10.1 運び代の倍率・1.11.0 燃料ごと）
      fuel += pf;
      const pw = r.plantWaste?.get(p.id) || 0;
      if (o > 0 || pf > 0 || pw > 0) {
        const ep = (ec.plants[p.id] ||= { gen: 0, fuel: 0, waste: 0 });
        ep.gen += o;
        ep.fuel += pf;
        ep.waste += pw;
      }
      gen[!P(p).ac ? 'dc' : P(p).coal ? 'coal' : 'hydro'] += o;
      const yg = (G.yr.gen ||= { coal: 0, oil: 0, hydro: 0 });
      if (P(p).coal) {
        const fk = P(p).fuel || 'coal';
        yg[fk] = (yg[fk] || 0) + o;
      } else yg.hydro = (yg.hydro || 0) + o;
      if (p.type === 'pond') p.store = Math.max(0, Math.min(p.kw * POND_HOURS, p.store + p.kw * flowFactor(G, t) * (POND_HOURS / 24) - o));
      else if (p.type === 'dam') p.store = Math.max(0, Math.min(p.kw * DAM_HOURS, p.store + p.kw * flowFactor(G, t) * 0.4 - o));
    }
    loss += r.loss;
    lineLossSum += r.lineLoss ?? r.loss;
    subLossSum += r.subLoss ?? 0;
    wasteSum += r.waste || 0;
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
          e.downCause = 'over';
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
  if (sol.convs) for (const [n, u] of sol.convs) last.convs[n] = u;
  if (sol.convLoss > 0) (loss += sol.convLoss), (subLossSum += sol.convLoss);
  let rev = 0, demand = 0, served = 0;
  const war = evOn(G, 'priceWar', t) ? 0.8 : 1;
  for (const [n, d] of sol.dem) {
    const ratio = Math.min(1, sol.served.get(n) || 0);
    const gr = Math.min(1, sol.genServed?.get(n) || 0);
    const tr = Math.min(1, sol.tramServed?.get(n) || 0);
    demand += d.a;
    served += d.a * ratio;
    const sv = sol.src.get(n);
    // 1.7.4 dc・ac：直流・交流から届いた kW（直流の電圧の低下で済んだ分は直流に数える）。1.10.4 tramD・tramR：電鉄分
    last.towns[n] = { d: d.a, r: ratio, dc: Math.max(0, d.a * ratio - Math.min(d.a * ratio, sv?.ac || 0)), ac: Math.min(d.a * ratio, sv?.ac || 0), ...(d.tramA > 1e-6 ? { tramD: d.tramA, tramR: tr } : {}) };
    // 1.10.3 初めて電気が届いた町を記録（同じ町は 1 回だけ。t=0 でも未記録扱いにならないよう == null で判定）
    if (ratio > 1e-6 && d.a > 1e-6 && G.litTowns?.[n] == null) {
      (G.litTowns ||= {})[n] = t;
      G.yr.litNew = (G.yr.litNew || 0) + 1;
      G.freshLit = [...(G.freshLit || []), { town: n, t, path: litPathLines(G, n, t) }].slice(-20);
    }
    // 停電のあった町は申し込みが減る（1か月で回復）
    if (ratio < 0.95) G.rep[n] = Math.max(0.2, (G.rep[n] ?? 1) - 0.02);
    const loadsN = G.loads.filter((ld) => ld.town === n);
    const fg = loadsN.filter((ld) => ld.type !== 'tram').reduce((a, ld) => a + loadKw(G, ld, t), 0);
    const ft = loadsN.filter((ld) => ld.type === 'tram').reduce((a, ld) => a + loadKw(G, ld, t), 0);
    const kg = fg > 0 ? (d.genA ?? d.a) / fg : 0;
    const kt = ft > 0 ? (d.tramA || 0) / ft : 0;
    const qn = quality.get(n) || 1;
    for (const ld of loadsN) {
      const got = ld.type === 'tram' ? loadKw(G, ld, t) * kt * tr : loadKw(G, ld, t) * kg * gr;
      rev += got * LOADS[ld.type].rate * war * qn;
    }
  }
  for (const n of Object.keys(G.rep)) G.rep[n] = Math.min(1, G.rep[n] + investK(G, n, INVEST_REP) / (24 * MONTH_DAYS)); // 1.8.2 町への投資で速く戻る
  // 1.10.0 使用制限で減らした量（kWh。ふだんの需要との差の合計。A は昼に減らして夜に足すので1日でほぼ 0）と移した量（A の昼に減らした分）
  if (restrictOn(G)) {
    let cut = 0, moved = 0;
    for (const ld of G.loads) {
      if (!RESTRICT_TYPES.includes(ld.type)) continue;
      const d = loadKw(G, ld, t, true) - loadKw(G, ld, t);
      cut += d;
      if (d > 0) moved += d;
    }
    G.yr.cut = (G.yr.cut || 0) + cut;
    if (restrictOn(G) === 'A') G.yr.moved = (G.yr.moved || 0) + moved;
    G.acc.cut = (G.acc.cut || 0) + cut;
  }
  let loan = 0;
  // 1.10.2 借入れの返済：残り（G.debt）が 0 になるまで収入の 20%。古い保存データの loanUntil もそのまま終える
  if ((G.debt || 0) > 0) {
    loan = Math.min(G.debt, rev * DEBT_RATE);
    G.debt = Math.max(0, G.debt - loan);
    if (G.debt < 0.5) G.debt = 0;
  } else if (G.loanUntil > t) loan = rev * DEBT_RATE;
  G.yen += rev - loan - fuel;
  // 1.10.2 日ごとの電力・収支に積む
  ec.h++;
  ec.gen += gen.dc + gen.coal + gen.hydro;
  ec.served += served;
  ec.lineLoss += lineLossSum;
  ec.subLoss += subLossSum;
  ec.waste += wasteSum;
  ec.rev += rev;
  ec.fuel += fuel;
  ec.loan += loan;
  G.negHours = G.yen < 0 ? G.negHours + 1 : 0;
  if (G.negHours >= 72 && !G.rebuild) {
    G.rebuild = true; // 経営再建（設計 10章）
    addReport(G, { title: '経営再建', what: '収益の残高がマイナスのまま3日たった。設備を手放すか、借入れを選ぶ。', why: rebuildWhy(G, lc), units: ['power-system-U05'], goSupply: true });
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
  y.maxD = Math.max(y.maxD || 0, demand);
  if (anyBlack) y.blackH = (y.blackH || 0) + 1;
  if (anyShed) y.shedH = (y.shedH || 0) + 1;
  if (!anyBad && !anyShed && !anyBlack) y.okH++;
  Object.assign(last, { x: worst, demand, served, loss, rev, fuel, shed: anyShed, black: anyBlack }, explainStep(G, sol, t));
  G.last = last;
  if (missionsOn(G)) missionHour(G, last, anyShed || anyBlack);
  if (demand > 0) G.lossRatio = Math.min(0.5, 0.8 * G.lossRatio + 0.2 * (loss / Math.max(served, 1e-9)));
  G.hist.push([t, Math.round(demand * 10) / 10, Math.round(served * 10) / 10, Math.round(gen.dc * 10) / 10, Math.round(gen.coal * 10) / 10, Math.round(gen.hydro * 10) / 10, Math.round(worst * 100) / 100]);
  if (G.hist.length > 168) G.hist.shift();
  G.t = t + 1;
  finishCircuits(G, G.t);
  finishUpgradeLines(G, G.t);
}
// 1.10.2 回線の増設の完成（工事の間は l.n に数えず、終わってから増やす）
function finishCircuits(G, t) {
  for (const l of G.lines) {
    if (!l.cAdd?.length) continue;
    const doneN = l.cAdd.filter((x) => (x.readyAt ?? x) <= t).length;
    if (!doneN) continue;
    l.cAdd = l.cAdd.filter((x) => (x.readyAt ?? x) > t);
    if (!l.cAdd.length) delete l.cAdd;
    l.n += doneN;
    note(G, `${lineName(G, l)}の回線の増設が終わった（${l.n}回線）`);
  }
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
    const ms = newMissions(G, before, lc.era); // 1.8.0 新しく出たミッション
    if (ms.length) note(G, `新しいミッション：${ms.map((m) => m.name).join('・')}`);
    addReport(G, { title: `時代が進んだ：${E.name}（${E.year}）`, what: `新しい設備と需要が登場する。${opened.length ? `建てられる範囲が広がった（${opened.join('・')}）。` : ''}${facts.length ? `史実：${facts.join('。')}（確かめた）。` : ''}${ms.length ? `新しいミッション：${ms.map((m) => m.name).join('・')}（一覧の「ミッション」）。` : ''}`, units: [] });
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
    addReport(G, { title: INCIDENTS[inc.key].title, what: `${inc.what || ''}ゲームの1日のあいだ対処せず、標準の被害で片づいた。`, ...incWhy(inc.key), units: INCIDENTS[inc.key].units });
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
// 1.10.1 開放条件の2段：小さな設備は1問正解（lc.gate）、大きな設備・新しい方式は1問以上定着（lc.gateM。一度定着すれば下がらない）
export function gateCheck(lc, gates, needMaster = false) {
  if (!gates?.length) return null;
  if (!needMaster) {
    const miss = gates.filter((g) => !lc.gate?.[g]);
    if (!miss.length) return null;
    return { ok: false, why: `「${miss.map((k) => GATE_NAMES[k]).join('」「')}」の単元で、まだ1問も正解していない`, gates: miss };
  }
  const miss = gates.filter((g) => !lc.gateM?.[g]);
  if (!miss.length) return null;
  const hasCorrect = miss.every((g) => lc.gate?.[g]);
  const names = `「${miss.map((k) => GATE_NAMES[k]).join('」「')}」`;
  return { ok: false, why: `${names}の単元の問題を 1 問、定着させると開く（定着：日をあけて続けて正解）${hasCorrect ? '。正解はある。あと少しで定着' : ''}`, gates: miss, needMaster: true };
}
const buildHours = (base, lc, perf, G = null) => Math.max(1, Math.round(base * (1 - 0.3 * perfNow(G, lc, perf))));
// 建てられる場所か
export function siteAllows(G, type, siteId) {
  const n = nodeOf(G, siteId);
  const at = PLANTS[type].at;
  if (at === 'town') return !!n.town;
  if (at === 'coal') return !!n.town || !!n.coal;
  if (at === 'bigcoal') return !!n.coal || (!!n.town && n.tags.includes('coast'));
  if (at === 'coast') return !!n.town && n.tags.includes('coast');
  if (at === 'hydro') return !!n.hydro;
  if (at === 'dam') return !!n.hydro && !!n.dam;
  return !!n.hydro && !!n.pond;
}
// 発電所の見積もり。{ ok, cost, hours, proto, why }
// 交流の網（線でつながった地点。工事中・止まっている線も含む）の地点の集まり
// 1.8.0：周波数違いで切れている線は含めない
export function acComponent(G, id) {
  const adj = new Map();
  for (const l of G.lines) {
    if (LINES[l.kind].dc || l.hzTrip) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l.b);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l.a);
  }
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) for (const m of adj.get(stack.pop()) || []) if (!seen.has(m)) seen.add(m), stack.push(m);
  return seen;
}
// その地点の交流の網の周波数（1.6.0：系統ごと）。網の中の交流の発電機の周波数。なければ古い島の周波数（G.hz）、それもなければ null
// 1.8.0：網の中に周波数が2つあるとき（工事中の線が 50 Hz と 60 Hz の網を結んでいるときなど）は、近い地点の発電機の周波数（線の数で数えた近さ）
export function netHz(G, id) {
  const c = acComponent(G, id);
  const hzAt = new Map();
  for (const p of G.plants) if (PLANTS[p.type].ac && p.hz && c.has(p.site) && !hzAt.has(p.site)) hzAt.set(p.site, p.hz);
  if (!hzAt.size) return G.hz || null;
  if (hzAt.has(id)) return hzAt.get(id);
  const adj = new Map();
  for (const l of G.lines) {
    if (LINES[l.kind].dc || l.hzTrip) continue;
    (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l.b);
    (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l.a);
  }
  const seen = new Set([id]);
  let ring = [id];
  while (ring.length) {
    const next = [];
    for (const v of ring) for (const m of adj.get(v) || []) if (!seen.has(m)) seen.add(m), next.push(m);
    const hit = next.filter((v) => hzAt.has(v)).map((v) => hzAt.get(v)).sort();
    if (hit.length) return hit[0];
    ring = next;
  }
  return G.hz || null;
}
// 画面に出す周波数：いちばん乱れている網（なければ古い島の周波数）。使っている周波数の一覧
export const freqNow = (G) => G.last?.hz || G.hz || null;
export const hzList = (G) => [...new Set(G.plants.filter((p) => PLANTS[p.type].ac && p.hz).map((p) => p.hz))].sort();
// 1.8.0：周波数の違う網も交流の線で結べる（禁止はしない）。つないだ瞬間に脱調して、保護装置で切れる（hzCheck）
export const HZ_WARN = 'この線は 50 Hz の網と 60 Hz の網をつなぐ。つないだ瞬間に脱調して、保護装置で切れる（電気は送れない）';
// 海をこえる線は、史実の禁止ではなく、まだ開いていない技術（海峡線が開くのは戦後復興の版から）。史実モードだけ史実の年を添える
export const SEA_WHY = '海をこえる線（海峡を渡る鉄塔・海底ケーブル）の技術は、まだない（この先の時代に開く）';
export const SEA_FACT = '史実では 1945 年に関門で本州と九州がつながった';
export const seaWhy = (G) => (modeOf(G) === 'history' ? `${SEA_WHY}。${SEA_FACT}` : SEA_WHY);
// 1.10.0 海峡を渡る交流の線（戦後復興 E4b から、両モード）：島の違う2地点を交流の線（66 kV 以上）で結べる。
// ただし線の海の上の長さ（gridsea.js）が 3 km 以下のときだけ（狭い海峡を高い鉄塔で渡る）。海の上は 1 km あたり陸の 10 倍の費用、海沿いの危険（塩害）が付く。
// 史実モードは関門（下関〜小倉・八幡）だけ。E4 までは 1.8.0 の seaWhy のまま
export const STRAIT_ERA = 5, STRAIT_KV = 66, STRAIT_K = 10;
export const KANMON = ['shimonoseki', 'kokura'];
export const isKanmon = (a, b) => KANMON.includes(a) && KANMON.includes(b) && a !== b;
export const STRAIT_WIDE = '海の上の長さが 3 km を超える。この海峡は広すぎて、鉄塔では渡れない（海底ケーブルの技術はまだない）';
export const STRAIT_HISTORY = '史実モードでは、海峡を渡る線は関門（1945年）だけ（下関〜小倉・八幡）';
// 島をまたぐ見積もり：{ ok:false, why, sea:true } か { ok:true, seaKm }
function straitCheck(G, lc, a, b, K) {
  if (lc.era < STRAIT_ERA || K.dc) return { ok: false, why: seaWhy(G), sea: true };
  if (K.kv < STRAIT_KV) return { ok: false, why: `海峡を渡る線は ${STRAIT_KV} kV 以上（高い鉄塔で渡る送電線）`, sea: true, strait: true };
  if (modeOf(G) === 'history' && isJapan(G) && !isKanmon(a, b)) return { ok: false, why: STRAIT_HISTORY, sea: true, strait: true };
  const sk = isJapan(G) ? straitSea(a, b) : null; // 3 km を超える組は null（gridsea.js の表）
  if (sk == null) return { ok: false, why: STRAIT_WIDE, sea: true, strait: true };
  return { ok: true, seaKm: sk };
}
export function quotePlant(G, lc, { type, kw, site, hz = null }) {
  const D = PLANTS[type];
  const size = D.sizes.find((s) => s[0] === kw);
  if (!size) return { ok: false, why: '大きさが選べない' };
  const st = eraStatus(lc, Math.max(D.era, size[2]?.era || 0));
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  if (!siteAllows(G, type, site)) return { ok: false, why: D.at === 'coast' ? '重油はタンカーで運ぶので、海沿いだけ' : D.at === 'dam' ? '貯水池式の水力（ダム）はダムの地点だけ' : 'この場所には建てられない' };
  if (!nodeOpen(G, site)) return { ok: false, why: closedWhy(G, nodeOf(G, site)), closed: true };
  const gc = gateCheck(lc, D.gates, !!D.masteredGate);
  if (gc) return gc;
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
  return { ok: true, cost: coinOf(cost), base: Math.round(cost), hours: buildHours(D.build, lc, D.perf, G), proto, ...(D.ac ? { freq: netF || hz, newHz: !netF } : {}) };
}
export function buildPlant(G, lc, spec) {
  const q = quotePlant(G, lc, spec);
  if (!q.ok) return q;
  if (!PLANTS[spec.type].ac) G.buffs.dcDiscount = false;
  const p = { id: `P${G.nextId++}`, type: spec.type, kw: spec.kw, site: spec.site, cost: q.base, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, on: false, onAt: null, downUntil: 0, idle: false, store: 0, hold: 0, done: false };
  if (q.freq) p.hz = q.freq; // 交流の発電機の周波数（網が分かれたり、つながったりしても変えない）
  if (q.newHz) addReport(G, { title: `周波数を ${q.freq} Hz に決めた`, what: `${nodeOf(G, spec.site).name}の交流の網は、これから ${q.freq} Hz で動く。周波数の違う網と交流の線でつなぐと、脱調して切れる（網が分かれたり、つながったりしても、発電機の周波数は変わらない）。`, units: [] });
  G.plants.push(p);
  G.yr.built = (G.yr.built || 0) + 1;
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
export function quoteLine(G, lc, { a, b, kind, route = 'direct', opts = {}, run275 = false }) {
  const K = LINES[kind];
  if (!K || a === b) return { ok: false, why: '2つの地点を選ぶ' };
  const as275 = kind === 'ac500' && !!run275;
  const st = eraStatus(lc, K.era, K.level);
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  if (K.dc && !(nodeOf(G, a).town && nodeOf(G, b).town)) return { ok: false, why: '直流の配電線は、町と町の間だけ' };
  for (const id of [a, b]) if (!nodeOpen(G, id)) return { ok: false, why: closedWhy(G, nodeOf(G, id)), closed: true };
  let strait = null;
  if (nodeOf(G, a).island && nodeOf(G, a).island !== nodeOf(G, b).island) {
    strait = straitCheck(G, lc, a, b, K);
    if (!strait.ok) return strait;
  }
  // 1.8.0：周波数の違う網どうしでも見積もりは ok。警告（hzDiff）を付ける
  let hzw = null;
  if (!K.dc) {
    const ha = netHz(G, a), hb = netHz(G, b);
    if (ha && hb && ha !== hb) hzw = { hzDiff: true, warn: `${HZ_WARN}。${nodeOf(G, a).name}は ${ha} Hz、${nodeOf(G, b).name}は ${hb} Hz`, hzPair: [ha, hb] };
  }
  const gc = gateCheck(lc, K.gates, !!K.masteredGate);
  if (gc) return gc;
  for (const o of Object.keys(opts)) {
    if (!opts[o]) continue;
    const og = gateCheck(lc, LINE_OPTS[o].gates, !!LINE_OPTS[o].masteredGate);
    if (og) return og;
    const no = optBlocked(lc, o);
    if (no) return no;
  }
  const bp = as275 ? 'line275' : K.blueprint;
  if (bp && !lc.blueprint[bp]) return { ok: false, why: `設計図「${BLUEPRINTS[bp].name}」がない（試験レベルに正解するか、関係する外部試験で3割以上）`, blueprint: bp };
  if (connected(G, a, b, !!K.dc)) return { ok: false, why: 'この2地点は、すでに線でつながっている（回線を増やすなら、今ある線を増設する）' };
  const r = routeInfo(G, a, b, route);
  if (strait && !r.hazards.includes('coast')) r.hazards = [...r.hazards, 'coast']; // 1.10.0 海峡を渡る線は、回り道でも海沿いの危険（塩害）が付く
  const proto = st === 'proto';
  const nOpts = Object.values(opts).filter(Boolean).length;
  // 1.10.0 海峡：海の上の部分は 1 km あたり陸の 10 倍（高い鉄塔）
  let cost = K.cost * (r.km + (strait ? (STRAIT_K - 1) * strait.seaKm : 0)) * (1 + OPT_K * nOpts) * (proto ? 3 : 1);
  if (K.dc && G.buffs.dcDiscount) cost *= 0.8;
  const needSub = K.hv ? [a, b].filter((id) => nodeOf(G, id).town && !G.subs.some((s) => s.town === id)) : [];
  const base = Math.max(50, Math.round(cost));
  return { ok: true, cost: coinOf(base), base, km: r.km, hazards: r.hazards, hours: buildHours(12 + Math.min(228, r.km), lc, K.perf, G), proto, needSub, ...(as275 ? { runKv: 275 } : {}), ...(strait ? { seaKm: strait.seaKm } : {}), ...(hzw || {}) };
}
export function buildLine(G, lc, spec) {
  const q = quoteLine(G, lc, spec);
  if (!q.ok) return q;
  if (LINES[spec.kind].dc) G.buffs.dcDiscount = false;
  const l = { id: `W${G.nextId++}`, a: spec.a, b: spec.b, kind: spec.kind, route: spec.route || 'direct', km: q.km, hazards: q.hazards, opts: { ...(spec.opts || {}) }, n: 1, cost: q.base, unit: q.base, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, downUntil: 0, c1Until: 0, graceUntil: 0, overH: 0, saltUntil: 0, done: false };
  if (q.runKv) (l.runKv = q.runKv), (l.builtAs275 = true); // 1.11.0 500 kV 設計・275 kV で使う
  if (q.seaKm != null) l.seaKm = Math.round(q.seaKm * 100) / 100; // 1.10.0 海峡を渡る線（海の上の長さ）
  G.lines.push(l);
  G.yr.built = (G.yr.built || 0) + 1;
  return { ...q, line: l };
}
// 1.11.0 500 kV 設計（275 kV で使用中）の線を 500 kV に上げる工事：設計図 line500 が要る。費用は線の費用の 20%、工期は新設の 4 分の 1。工事の間は 275 kV のまま動く
export function quoteUpgradeLine(G, lc, id) {
  const l = G.lines.find((x) => x.id === id);
  if (!l || l.kind !== 'ac500' || l.runKv !== 275) return { ok: false, why: '500 kV に上げられる線ではない' };
  if (l.up500At > G.t) return { ok: false, why: '500 kV に上げる工事の最中' };
  if (!lc.blueprint?.line500) return { ok: false, why: `設計図「${BLUEPRINTS.line500.name}」がない（試験レベルに正解するか、関係する外部試験で3割以上）`, blueprint: 'line500' };
  const base = Math.max(50, Math.round(l.cost * 0.2));
  const K = LINES.ac500;
  const hours = Math.max(1, Math.round(buildHours(12 + Math.min(228, l.km), lc, K.perf, G) / 4));
  return { ok: true, cost: coinOf(base), base, hours, line: l };
}
export function startUpgradeLine(G, lc, id) {
  const q = quoteUpgradeLine(G, lc, id);
  if (!q.ok) return q;
  const readyAt = Math.max(G.t, q.line.readyAt) + q.hours;
  q.line.up500At = readyAt;
  q.line.cost += q.base;
  note(G, `${lineName(G, q.line)}を 500 kV に上げる工事を始めた`);
  return { ...q, readyAt };
}
function finishUpgradeLines(G, t) {
  for (const l of G.lines) {
    if (!l.up500At || l.up500At > t) continue;
    delete l.up500At;
    delete l.runKv;
    l.upgraded500 = true;
    note(G, `${lineName(G, l)}を 500 kV に上げた`);
  }
}
// 回線を増やす（同じルートにもう1回線）。1.10.2：工期（新しく引くときの半分）を追加。工事中は回線の数に数えず、終わってから効く
export function quoteCircuit(G, lc, id) {
  const l = G.lines.find((x) => x.id === id);
  if (!l) return { ok: false, why: '線がない' };
  const pending = l.cAdd?.length || 0;
  if (l.n + pending >= MAX_CIRCUITS) return { ok: false, why: `回線は ${MAX_CIRCUITS} つまで` };
  // 1.10.1：すでに建てた線はそのまま、回線の追加から開放条件が効く
  const K = LINES[l.kind];
  const gc = gateCheck(lc, K.gates, !!K.masteredGate);
  if (gc) return gc;
  const hours = Math.max(1, Math.round(buildHours(12 + Math.min(228, l.km), lc, K.perf, G) / 2));
  return { ok: true, cost: coinOf(l.unit), base: l.unit, hours, line: l, nextN: l.n + pending + 1 };
}
export function addCircuit(G, lc, id) {
  const q = quoteCircuit(G, lc, id);
  if (!q.ok) return q;
  const readyAt = Math.max(G.t, q.line.readyAt) + q.hours;
  const item = { id: `C${G.nextId++}`, readyAt };
  q.line.cAdd = [...(q.line.cAdd || []), item];
  q.line.cost += q.base;
  return { ...q, readyAt, work: item };
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
  const gc = gateCheck(lc, O.gates, !!O.masteredGate);
  if (gc) return gc;
  const no = optBlocked(lc, o);
  if (no) return no;
  const proto = eraStatus(lc, K.era, K.level) === 'proto';
  const one = K.cost * l.km * OPT_K * (proto ? 3 : 1); // 建設のときに足す場合の費用（1回線あたり）
  const base = Math.max(50, Math.round(one * l.n * RETRO_K));
  const hours = buildHours(12 + Math.min(228, l.km), lc, K.perf, G);
  return { ok: true, cost: coinOf(base), base, hours, line: l, opt: o, readyAt: Math.max(l.readyAt, G.t + hours), unit: Math.round(K.cost * l.km * OPT_K * (l.proto ? 3 : 1)) };
}
export function addLineOpt(G, lc, id, o) {
  const q = quoteLineOpt(G, lc, id, o);
  if (!q.ok) return q;
  const l = q.line;
  l.opts[o] = true;
  l.optAt = { ...(l.optAt || {}), [o]: q.readyAt };
  l.cost += q.base;
  l.unit += q.unit; // これから増やす回線にも、この対策が付く
  return q;
}
export function quoteSub(G, lc, { town, mva }) {
  if (!nodeOf(G, town)?.town || !SUB_SIZES.includes(mva)) return { ok: false, why: '町と容量を選ぶ' };
  if (!nodeOpen(G, town)) return { ok: false, why: closedWhy(G, nodeOf(G, town)), closed: true };
  const st = eraStatus(lc, subSizeEra(mva));
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  const gc = gateCheck(lc, TR.gates, !!TR.masteredGate);
  if (gc) return gc;
  if (G.subs.filter((s) => s.town === town).length >= 2) return { ok: false, why: '変圧器は1つの変電所に2台まで' };
  const proto = st === 'proto';
  const base = subCost(mva) * (proto ? 3 : 1);
  return { ok: true, cost: coinOf(base), base, hours: buildHours(TR.build, lc, TR.perf, G), proto };
}
export function buildSub(G, lc, spec) {
  const q = quoteSub(G, lc, spec);
  if (!q.ok) return q;
  const s = { id: `S${G.nextId++}`, town: spec.town, mva: spec.mva, cost: q.base, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, downUntil: 0, lossK: 1, failK: 1, failUntil: 0, done: false };
  G.subs.push(s);
  G.yr.built = (G.yr.built || 0) + 1;
  return { ...q, sub: s };
}
// 1.10.4 電鉄用の変換所（回転変流機・水銀整流器）：交流の変圧器がある町に2台まで
export function quoteConv(G, lc, { type, kw, town }) {
  const D = CONVS[type];
  if (!D || !nodeOf(G, town)?.town || !CONV_SIZES.includes(kw)) return { ok: false, why: '町と種類・容量を選ぶ' };
  if (!nodeOpen(G, town)) return { ok: false, why: closedWhy(G, nodeOf(G, town)), closed: true };
  const st = eraStatus(lc, D.era);
  if (st === 'no') return { ok: false, why: 'まだ先の時代の設備' };
  const gc = gateCheck(lc, D.gates, !!D.masteredGate);
  if (gc) return gc;
  if (!G.subs.some((s) => s.town === town)) return { ok: false, why: '交流の変圧器がある町に建てられる（先に変圧器を置く）', needSub: true };
  if ((G.convs || []).filter((c) => c.town === town).length >= 2) return { ok: false, why: '電鉄用の変換所は1つの町に2台まで' };
  const proto = st === 'proto';
  const base = convCost(type, kw) * (proto ? 3 : 1);
  return { ok: true, cost: coinOf(base), base, hours: buildHours(D.build, lc, D.perf, G), proto };
}
export function buildConv(G, lc, spec) {
  const q = quoteConv(G, lc, spec);
  if (!q.ok) return q;
  const c = { id: `V${G.nextId++}`, type: spec.type, town: spec.town, kw: spec.kw, cost: q.base, proto: q.proto, builtAt: G.t, readyAt: G.t + q.hours, downUntil: 0, done: false };
  (G.convs ||= []).push(c);
  G.yr.built = (G.yr.built || 0) + 1;
  return { ...q, conv: c };
}
export function quoteCap(G, lc, loadId) {
  const ld = G.loads.find((l) => l.id === loadId);
  if (!ld || !LOADS[ld.type].pfFixed || ld.cap) return { ok: false, why: '進相コンデンサを付けられる需要ではない' };
  const gc = gateCheck(lc, ['pf'], true);
  if (gc) return gc;
  const base = Math.round(CAP_COST(ld.kw) * (G.buffs.capDiscount ? 0.7 : 1));
  return { ok: true, cost: coinOf(base), base, load: ld };
}
export function addCap(G, lc, loadId) {
  const q = quoteCap(G, lc, loadId);
  if (!q.ok) return q;
  q.load.cap = true;
  G.buffs.capDiscount = false;
  return q;
}
// 手放す（撤去）：円の側の値打ち（建設費 × YEN_K）の 30% が収益に戻る
export function removeAsset(G, kind, id) {
  const list = { plant: G.plants, line: G.lines, sub: G.subs, conv: G.convs || [] }[kind];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return 0;
  const [x] = list.splice(i, 1);
  if (kind === 'plant') G.priority = G.priority.filter((p) => p !== id);
  const back = removeBack(x);
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
  // 1.6.4 net：町が発電機のある網（交流・直流）に入っているか。届かないときの文を、道がないのか・設備が足りないのかで分ける
  const net = sol.results.some((r) => r.net?.nodes.includes(app.town));
  const conv = sol.convs?.get(app.town) || 0;
  const tramWhy = sol.tramWhy?.get(app.town) || null;
  return { reach, net, served: sol.served.get(app.town) || 0, line, sub, conv, tramWhy, cap, load, margin: load > 0 ? cap / load - 1 : 0, hour: t % 24 };
}
// 1.8.1 町の次の24時間の需給の見込み（申し込みのカード・町の詳細のグラフ）。previewApp と同じ考え：
// 使える発電機がすべて動いているとして、申し込み（appIds）を足して dry で解く。時刻は今から step 時間おきに 24 時間分。
// 戻り値の hours：{ t, h（時）, base（受けている分の需要）, add（申し込みの分）, got（届く量）, short（届かない量）,
//   line・lineId（その町の網の線の最大の使用率とその線）, sub・subTown（変圧器）, margin（その町の網の供給の余裕）, st（'ok'|'warn'|'ng'）, why }
// 状態は変えない（申し込みは G.loads に一時的に足して、解いたら外す）
export function townOutlook(G, lc, town, appIds = [], step = 2) {
  const apps = appIds.map((id) => G.apps.find((a) => a.id === id)).filter(Boolean);
  const temp = apps.map((a) => ({ id: `preview-${a.id}`, town: a.town, type: a.type, kw: a.kw, cap: false }));
  const n0 = G.loads.length;
  G.loads.push(...temp);
  const hours = [];
  try {
    for (let k = 0; k < 24; k += step) {
      const t = G.t + k;
      const sol = solve(G, lc, t, { dry: true, assume: true, noNoise: true });
      const add = temp.filter((ld) => ld.town === town).reduce((x, ld) => x + loadKw(G, ld, t), 0);
      const d = sol.dem.get(town)?.a || 0;
      const ratio = Math.min(1, sol.served.get(town) || 0);
      const rs = sol.results.filter((r) => r.net.nodes.includes(town));
      let line = 0, lineId = null, sub = 0, subTown = null, cap = 0, load = 0;
      for (const r of rs) {
        for (const [id, f] of r.flows) if ((f.util || 0) > line) (line = f.util), (lineId = id);
        for (const [tn, x] of r.subs || new Map()) if (x.util > sub) (sub = x.util), (subTown = tn);
        cap += r.readyCap || r.cap || 0;
        load += r.load;
      }
      const conv = sol.convs?.get(town) || 0;
      const margin = load > 0 ? cap / load - 1 : 1;
      const short = d * (1 - ratio);
      const ng = short > Math.max(0.5, d * 0.001);
      const warn = !ng && d > 0 && (line > 0.9 || sub > 0.9 || conv > 0.9 || margin < G.reserve);
      let why = null;
      if (ng) {
        const byNode = new Map([[town, rs]]);
        why = townWhy(G, sol, byNode, town, t);
        // 見込みの計算の中で起きた全域停電（いま停電しているのではない）は、出力が足りないこと（その結果の全域停電）と書く
        if (why.k === 'black' && !((G.black[town] || 0) > t)) why = { k: 'short', kw: short, black: true };
        else if (why.k === 'shed') why = { k: 'short', kw: short, shed: true };
      }
      hours.push({ t, h: t % 24, base: Math.max(0, d - add), add, got: d - (ng ? short : 0), short: ng ? short : 0, line, lineId, sub, subTown, margin, st: ng ? 'ng' : warn ? 'warn' : 'ok', why });
    }
  } finally {
    G.loads.length = n0;
  }
  return { town, apps: appIds, step, hours };
}
// 見込みの1行のまとめ：足りる（いちばん苦しい時刻と、その理由）／○〜○時に最大 ○ kW 足りない（原因）
export function outlookText(G, o, withApp) {
  const hs = o.hours;
  const ng = hs.filter((x) => x.st === 'ng');
  if (ng.length) {
    const worst = ng.reduce((a, b) => (b.short > a.short ? b : a));
    // 続いている時間ごとに「18〜21時」。今から先の順（日をまたぐときは「22〜2時」）。3つ以上に分かれるときは最初の2つと「など」
    const runs = [];
    hs.forEach((x, i) => {
      if (x.st !== 'ng') return;
      if (i > 0 && hs[i - 1].st === 'ng') runs[runs.length - 1].to = x.h;
      else runs.push({ from: x.h, to: x.h });
    });
    const span = ng.length === hs.length ? '一日中' : runs.slice(0, 2).map((r) => (r.from === r.to ? `${r.from}時ごろ` : `${r.from}〜${(r.to + o.step) % 24}時`)).join('・') + (runs.length > 2 ? 'など' : '');
    return { ng: true, text: `${span}に最大 ${fmtKw(worst.short)} 足りない${worst.why ? `（原因：${whyText(G, worst.why)}${worst.why.black ? '。網の全体が全域停電になる' : worst.why.shed ? '。負荷遮断で需要の一部を切り離すことになる' : ''}）` : ''}` };
  }
  const head = withApp ? '受けても足りる' : '次の24時間は足りる';
  const any = hs.filter((x) => x.base + x.add > 0);
  if (!any.length) return { ng: false, text: withApp ? '受けても足りる' : 'この町の需要はまだない' };
  const tight = any.filter((x) => x.margin < G.reserve);
  if (tight.length) {
    const w = tight.reduce((a, b) => (b.margin < a.margin ? b : a));
    return { ng: false, warn: true, text: `${head}（いちばん苦しいのは ${w.h}時：供給の余裕 ${Math.round(w.margin * 100)}%。予備力の目標 ${Math.round(G.reserve * 100)}% より小さい）` };
  }
  const w = any.reduce((a, b) => (Math.max(b.line, b.sub) > Math.max(a.line, a.sub) ? b : a));
  const u = Math.max(w.line, w.sub);
  if (u < 0.005) return { ng: false, text: `${head}（線・変圧器を通らない）` };
  const l = w.line >= w.sub ? G.lines.find((x) => x.id === w.lineId) : null;
  const what = l ? lineName(G, l) : `${nodeOf(G, w.subTown)?.name || ''}の変圧器`;
  return { ng: false, warn: u > 0.9, text: `${head}（いちばん苦しいのは ${w.h}時：${what}の使用率 ${Math.round(u * 100)}%）` };
}
export function acceptApp(G, appId) {
  const i = G.apps.findIndex((a) => a.id === appId);
  if (i < 0) return null;
  const [app] = G.apps.splice(i, 1);
  markTramHist(G, app.tramHist);
  const ld = { id: `L${G.nextId++}`, town: app.town, type: app.type, kw: app.kw, cap: false };
  G.loads.push(ld);
  return ld;
}

// ---- 1.8.2 収益（円）の使い道：研究開発・町への投資・記念の建物（収益だけで払う。コインでは払えない。収益をコインに換える道はない） ----
// 値段の元（spendBase）：直近 30 日の1日の利益の平均。系統の規模に合わせて効くように。利益が小さいときは、設備の1日の保守費（建設費の 0.05%）を下限に
// 目安：研究開発の1段＝14日分、町への投資の1段＝10〜21日分（町の大きさ）、記念の建物＝21日分（ゲームの 2〜4 週間分の利益）
export function spendBase(G) {
  const d = G.profDays || [];
  const avg = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
  return Math.max(100, avg, dailyMaint(G, 'normal'));
}
const roundYen = (v) => (v >= 1e5 ? Math.round(v / 1000) * 1000 : v >= 1e3 ? Math.round(v / 10) * 10 : Math.round(v));
// 払えるか：収益がマイナス・経営再建中・借入れ返済中は使えない。払ったあと収益が 0 を下回る額も使えない
export function canSpend(G, cost) {
  if (G.rebuild) return { ok: false, why: '経営再建中は使えない' };
  if ((G.debt || 0) > 0) return { ok: false, why: `借入れを返している間は使えない（残り ${Math.round(G.debt).toLocaleString('ja-JP')} 円）` };
  if (G.loanUntil > G.t) return { ok: false, why: `借入れを返している間は使えない（あと ${Math.ceil((G.loanUntil - G.t) / 24)}日）` };
  if (!(G.yen > 0)) return { ok: false, why: '収益がマイナス（0 以下）のときは使えない' };
  if (G.yen - cost < 0) return { ok: false, why: `収益が足りない（あと ${roundYen(cost - G.yen).toLocaleString('ja-JP')} 円）` };
  return { ok: true };
}
function spend(G, cost, what) {
  G.yen -= cost;
  G.acc.spend = (G.acc.spend || 0) + cost;
  G.spent = (G.spent || 0) + cost;
  G.spends = [...(G.spends || []), { t: G.t, what, cost: Math.round(cost) }].slice(-30);
}
// 研究開発：性能のキーごとに段 0〜5。実際の性能＝学習で決まる性能 ×（1 ＋ 0.04 × 段）（1 を超えない）。学習の定着が 0 なら上がらない
// 1段にゲームの 7 日。同時に1つ。段 n の費用は段 1 の 2^(n−1) 倍。系統ごと（史実と自由は別、新しい島では 0 から）
export const RD_STEP = 0.04, RD_MAX = 5, RD_DAYS = 7;
export const RD_KEYS = {
  dc: { era: 1, what: '直流の発電所の故障・建設の時間' },
  gen: { era: 2, what: '交流発電機の故障' },
  coal: { era: 2, what: '石炭火力の熱効率・故障・建設の時間' },
  hydro: { era: 2, what: '水力の故障・建設の時間' },
  line: { era: 2, what: '送電線の事故・建設の時間' },
  dist: { era: 2, what: '配電線（3.3 kV）の事故・建設の時間' },
  tr: { era: 2, what: '変圧器の故障・建設の時間' },
  conv: { era: 2, what: '電鉄用変換所の効率・故障・建設の時間' },
  freq: { era: 2, what: '需要の読み違い（周波数の乱れ）' },
  econ: { era: 2, what: '燃料の値段' },
  prot: { era: 2, what: '事故で止まる時間' },
};
export const rdLevel = (G, k) => G?.rd?.lv?.[k] || 0;
export function perfNow(G, lc, k) {
  const b = lc.perf[k] || 0;
  return Math.min(1, b * (1 + RD_STEP * rdLevel(G, k)));
}
export const rdKeys = (G) => Object.keys(RD_KEYS).filter((k) => RD_KEYS[k].era <= G.era);
export const rdCost = (G, k) => roundYen(spendBase(G) * 14 * 2 ** rdLevel(G, k));
export function quoteResearch(G, k) {
  if (!RD_KEYS[k] || RD_KEYS[k].era > G.era) return { ok: false, why: 'まだ研究できない' };
  if (rdLevel(G, k) >= RD_MAX) return { ok: false, why: `最高の段（${RD_MAX}）` };
  if (G.rd?.doing) return { ok: false, why: `${GATE_NAMES[G.rd.doing.key]}の研究中（同時に1つ）` };
  const cost = rdCost(G, k);
  const c = canSpend(G, cost);
  return c.ok ? { ok: true, cost, days: RD_DAYS } : { ...c, cost };
}
export function startResearch(G, k) {
  const q = quoteResearch(G, k);
  if (!q.ok) return q;
  spend(G, q.cost, `研究開発：${GATE_NAMES[k]}`);
  G.rd = { lv: { ...(G.rd?.lv || {}) }, doing: { key: k, until: G.t + 24 * RD_DAYS, cost: q.cost } };
  note(G, `${GATE_NAMES[k]}の研究開発を始めた（${RD_DAYS}日。${q.cost.toLocaleString('ja-JP')} 円）`);
  return q;
}
function researchHour(G) {
  const d = G.rd?.doing;
  if (!d || G.t < d.until) return;
  G.rd.lv[d.key] = Math.min(RD_MAX, (G.rd.lv[d.key] || 0) + 1);
  G.rd.doing = null;
  G.rd.done = (G.rd.done || 0) + 1;
  note(G, `${GATE_NAMES[d.key]}の研究開発が終わった（${G.rd.lv[d.key]}段）`);
  addReport(G, { title: `研究開発：${GATE_NAMES[d.key]} ${G.rd.lv[d.key]}段`, what: `${RD_KEYS[d.key].what}に効く。実際の性能は、学習で決まる性能の ${(1 + RD_STEP * G.rd.lv[d.key]).toFixed(2)} 倍（1 を超えない。定着した単元が多いほど効く）。`, ok: true });
}
// 町への投資：町ごとに段 0〜3。1段ごとに、その町の申し込みの届きやすさ ×1.3、停電で下がった町の信用が戻る速さ ×1.5。需要の上限（D_max）は変わらない
export const INVEST_MAX = 3, INVEST_APP = 1.3, INVEST_REP = 1.5;
export const investLevel = (G, id) => G?.invest?.[id] || 0;
export const investK = (G, id, k) => k ** investLevel(G, id);
const INVEST_DAYS = { 1: 10, 2: 14, 3: 21 }; // 町の大きさ（小・中・大）ごとの1段の値段（日分）
export const investCost = (G, id) => roundYen(spendBase(G) * INVEST_DAYS[nodeOf(G, id)?.size || 2] * (investLevel(G, id) + 1));
export function quoteInvest(G, id) {
  const n = nodeOf(G, id);
  if (!n?.town || !townActive(G, n) || !nodeOpen(G, n)) return { ok: false, why: 'まだ開いていない町' };
  if (investLevel(G, id) >= INVEST_MAX) return { ok: false, why: `最高の段（${INVEST_MAX}）` };
  const cost = investCost(G, id);
  const c = canSpend(G, cost);
  return c.ok ? { ok: true, cost } : { ...c, cost };
}
export function invest(G, id) {
  const q = quoteInvest(G, id);
  if (!q.ok) return q;
  spend(G, q.cost, `町への投資：${nodeOf(G, id).name}`);
  G.invest = { ...(G.invest || {}), [id]: investLevel(G, id) + 1 };
  note(G, `${nodeOf(G, id).name}に投資した（${G.invest[id]}段）`);
  return q;
}
// 記念の建物と景色：見た目だけ（性能・需要は変えない）。時代に合うもの。1つの町に3つまで。撤去もできる（収益は戻らない）
export const DECOR = {
  lamps: { name: '電灯の並ぶ通り', era: 1, k: 1 },
  monument: { name: '記念碑', era: 1, k: 0.8 },
  clock: { name: '時計塔', era: 3, k: 1.2 },
  fountain: { name: '公園の噴水', era: 3, k: 1 },
  station: { name: '駅舎', era: 4, k: 1.5 },
  cinema: { name: '電気館（映画館）', era: 4, k: 1.3 },
};
export const DECOR_MAX = 3;
export const decorsOf = (G, id) => G?.decor?.[id] || [];
export const decorCost = (G, kind) => roundYen(spendBase(G) * 21 * DECOR[kind].k);
export function quoteDecor(G, id, kind) {
  const n = nodeOf(G, id);
  if (!DECOR[kind] || DECOR[kind].era > G.era) return { ok: false, why: 'まだ建てられない' };
  if (!n?.town || !townActive(G, n) || !nodeOpen(G, n)) return { ok: false, why: 'まだ開いていない町' };
  if (decorsOf(G, id).length >= DECOR_MAX) return { ok: false, why: `1つの町に${DECOR_MAX}つまで` };
  if (decorsOf(G, id).some((d) => d.kind === kind)) return { ok: false, why: 'もう建っている' };
  const cost = decorCost(G, kind);
  const c = canSpend(G, cost);
  return c.ok ? { ok: true, cost } : { ...c, cost };
}
export function buildDecor(G, id, kind) {
  const q = quoteDecor(G, id, kind);
  if (!q.ok) return q;
  spend(G, q.cost, `記念の建物：${nodeOf(G, id).name}の${DECOR[kind].name}`);
  const d = { id: `D${G.nextId++}`, kind, at: G.t };
  G.decor = { ...(G.decor || {}), [id]: [...decorsOf(G, id), d] };
  G.decorBuilt = (G.decorBuilt || 0) + 1;
  note(G, `${nodeOf(G, id).name}に${DECOR[kind].name}が建った`);
  return { ...q, decor: d };
}
export function removeDecor(G, id, decorId) {
  const before = decorsOf(G, id);
  const left = before.filter((d) => d.id !== decorId);
  if (left.length === before.length) return false;
  G.decor = { ...G.decor, [id]: left };
  if (!left.length) delete G.decor[id];
  return true;
}

// ---- 1.10.2 収支のまとめ・赤字の知らせ・経営再建の見込み（5章） ----
const ECON_SUM_KEYS = ['gen', 'served', 'lineLoss', 'subLoss', 'waste', 'rev', 'fuel', 'maint', 'repair', 'loan', 'reward'];
// 直近 7 日の1日あたり（mode '7d'）または昨日（'1d'）。記録がまだない古い保存データでも安全に返す
export function econSummary(G, mode = '7d') {
  const days = G?.econDays || [];
  let list = mode === '1d' ? days.slice(-1) : days.slice(-7);
  let partial = false;
  if (!list.length && G?.econCur?.h > 0) (list = [G.econCur]), (partial = true);
  const n = list.length;
  const out = { days: partial ? 0 : n, partial, hours: list.reduce((a, d) => a + (d.h || 0), 0), gen: 0, served: 0, lineLoss: 0, subLoss: 0, waste: 0, other: 0, rev: 0, fuel: 0, maint: 0, repair: 0, loan: 0, reward: 0, expense: 0, net: 0, revPerKwh: 0, fuelPerKwh: 0, plants: {} };
  if (!n) return out;
  for (const d of list) {
    for (const k of ECON_SUM_KEYS) out[k] += d[k] || 0;
    for (const [pid, pv] of Object.entries(d.plants || {})) {
      const t = (out.plants[pid] ||= { gen: 0, fuel: 0, waste: 0, sold: 0 });
      t.gen += pv.gen || 0;
      t.fuel += pv.fuel || 0;
      t.waste += pv.waste || 0;
    }
  }
  const div = partial ? 1 : n;
  for (const k of ECON_SUM_KEYS) out[k] /= div;
  out.other = Math.max(0, out.gen - out.served - out.lineLoss - out.waste);
  out.expense = out.fuel + out.maint + out.repair + out.loan;
  out.net = out.rev - out.expense; // ご褒美を除く
  out.revPerKwh = out.served > 1e-6 ? out.rev / out.served : 0;
  out.fuelPerKwh = out.served > 1e-6 ? out.fuel / out.served : 0;
  const soldRatio = out.gen > 1e-6 ? Math.min(1, out.served / out.gen) : 0;
  for (const t of Object.values(out.plants)) {
    t.gen /= div;
    t.fuel /= div;
    t.waste /= div;
    t.sold = t.gen * soldRatio;
  }
  return out;
}
// 記録のない古い保存データ向け：現在の系統の写しを 24 時間回して 1 日の収支を見積もる（元の系統は変えない）
export function econEstimate(G, lc) {
  const s = econSummary(G, '7d');
  if (s.days > 0 || s.hours >= 24) return s;
  if (!lc) return s;
  const c = structuredClone(G);
  c.reports = [];
  c.hist = [];
  c.econCur = newEconDay();
  c.econDays = [];
  for (let i = 0; i < 24; i++) step(c, lc);
  // 24 時間の途中で 0 時をまたぐと econDays と econCur に分かれるので合算して 1 日分にする
  const merged = newEconDay();
  for (const d of [...c.econDays, c.econCur]) {
    if (!d?.h) continue;
    merged.h += d.h;
    for (const k of ECON_SUM_KEYS) merged[k] += d[k] || 0;
    for (const [pid, pv] of Object.entries(d.plants || {})) {
      const t = (merged.plants[pid] ||= { gen: 0, fuel: 0, waste: 0 });
      t.gen += pv.gen || 0;
      t.fuel += pv.fuel || 0;
      t.waste += pv.waste || 0;
    }
  }
  const out = econSummary({ econDays: [merged], econCur: newEconDay() }, '1d');
  out.estimated = true;
  return out;
}
// 5.3 赤字の知らせ：直近7日の差し引き（ご褒美を除く）が初めてマイナスになったとき報告書を1つ
function checkDeficit(G) {
  const days = G.econDays || [];
  if (days.length < 7) return;
  const s = econSummary(G, '7d');
  if (s.net < -0.5) {
    if (G.deficitAlerted) return;
    G.deficitAlerted = true;
    const parts = [['燃料費', s.fuel], ['保守費', s.maint], ['修理費', s.repair], ['借入れの返済', s.loan]].sort((a, b) => b[1] - a[1]);
    const [topName, topVal] = parts[0];
    const pct = s.rev > 1e-6 ? `（売電の ${Math.round((topVal / s.rev) * 100)}%）` : '';
    addReport(G, { title: 'この7日は赤字', what: `この7日は赤字（1日あたり −${Math.round(-s.net).toLocaleString('ja-JP')} 円）。いちばん大きい支出：${topName}${pct}。`, units: [], goSupply: true });
  } else G.deficitAlerted = false;
}
// 5.3 経営再建の報告書の「理由」を、そのときの内訳にする
export function rebuildWhy(G, lc = null) {
  const s = econEstimate(G, lc);
  if (!(s.rev > 0 || s.expense > 0)) return '燃料費・修理費が収入を上回った';
  const items = [];
  if (s.rev > 1e-6 && s.fuel > 0) items.push(`燃料費が売電の ${Math.round((s.fuel / s.rev) * 100)}%`);
  if (s.gen > 1e-6 && s.lineLoss + s.waste > 0) items.push(`損失と捨てた分が発電の ${Math.round(((s.lineLoss + s.waste) / s.gen) * 100)}%`);
  if (s.rev > 1e-6 && s.maint > 0.1 * s.rev) items.push(`保守費が売電の ${Math.round((s.maint / s.rev) * 100)}%`);
  if (s.repair > 0 && s.repair >= 0.1 * Math.max(s.rev, 1)) items.push(`修理費 ${Math.round(s.repair).toLocaleString('ja-JP')}円/日`);
  if (s.loan > 0) items.push(`返済 ${Math.round(s.loan).toLocaleString('ja-JP')}円/日`);
  return items.length ? items.join('・') : '燃料費・修理費が収入を上回った';
}
// 5.4 経営再建の画面の借入れの見込み
export function loanForecast(G, lc = null) {
  const s = econEstimate(G, lc);
  const borrow = Math.max(0, -G.yen);
  const added = Math.round(borrow * DEBT_INTEREST);
  const totalDebt = (G.debt || 0) + added;
  const baseNet = s.rev - s.fuel - s.maint - s.repair; // 返済を除いた1日収支
  const repayDay = s.rev * DEBT_RATE;
  const repayNet = baseNet - repayDay;
  const payDays = repayDay > 1e-6 ? Math.ceil(totalDebt / repayDay) : null;
  const cantFinish = totalDebt > 0 && (repayNet < -0.5 && (payDays == null || payDays > 3 || baseNet < -0.5));
  const againDays = cantFinish ? 3 : null;
  return { summary: s, borrow, added, totalDebt, curNet: s.net, baseNet, repayDay, repayNet, payDays, cantFinish, againDays };
}

// ---- 経営再建・新しい島（設計 10章） ----
// 1.10.2 借入れ：借りる額＝そのときのマイナスの額。残り（G.debt）に 1.1 倍を足し、残りが 0 になるまで収入の 20% を返す
export function rebuildLoan(G) {
  const borrow = Math.max(0, -G.yen);
  const added = Math.round(borrow * DEBT_INTEREST);
  G.yen = Math.max(G.yen, 0);
  G.debt = (G.debt || 0) + added;
  G.rebuild = false;
  G.negHours = 0;
  return { borrow, added, debt: G.debt };
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
  const g = newGrid(seed, nowMs, { terrain, start, islandNo: G.islandNo + 1, perfMax: G.perfMax, past, mode: modeOf(G) }); // 1.8.0：今のモードの系統だけをやり直す
  if (G.noMissions) g.noMissions = true; // デモ・練習の東京はミッションを出さない
  return g;
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
