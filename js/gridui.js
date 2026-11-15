// 動く系統の画面（1.5.0。1.5.1 で配置を変えた）：上の帯・地図・下のボタン5つ（建設・運転・需給・一覧・経営）とせり上がるパネル、
// 地図の上で建てる建設モード、電気の流れ（黄色い点線）、事故の問題、経営再建、新しい島、開発者モード
// 計算は grid.js。ここは表示と操作、保存（kv「grid」。開発者モードでは kv「gridDev」）、学習通貨の支出（ガチャと同じ台帳）
import * as Gm from './grid.js';
import * as L from './logic.js';
import * as Dv from './griddev.js';
import { GRID_IMAGES } from './gridimg.js';

let A = null; // app.js から渡される部品（S・db・show・on・esc・toast など）
let lcCache = null;
let summary = null; // 開いたときのまとめ（閉じるまでパネルに出す）
let gridSession = null; // 事故の問題の回答をまとめるセッション（mode「系統」）
let panel = null; // 開いているパネル：build・run・supply・list・manage・summary・node:ID・line:ID（null＝閉じている）
let buildFor = null; // 建設のパネルを地点から開いたとき：{ site } または { from }
let B = null; // 建設モード：{ kind: 'plant'|'line'|'sub', ... }
let whyOpen = null; // 建設のパネルで、理由を開いている種類
// 開発者モード（1.5.1）：本番とは別の系統（kv「gridDev」）。入っているかどうかは保存しない（開き直すと本番に戻る）
const DEV = { on: false, state: null, taps: 0, tapAt: 0, savedAt: 0, running: false };
let store = null;

export function init(api) {
  A = api;
  store = Dv.makeStore(A.db, A.S, DEV);
  setInterval(tick, 15000);
  setInterval(devTick, 1000);
}

const G = () => store.grid();
const yen = (v) => `${Math.round(v).toLocaleString('ja-JP')} 円`;
const pct = (v) => `${Math.round(v * 100)}%`;
const kw = Gm.fmtKw;
// 上の帯の短い金額（1万円以上は「万円」、1億円以上は「億円」）
function yenShort(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a < 1e4) return `${s}${Math.round(a).toLocaleString('ja-JP')}円`;
  if (a < 1e8) return `${s}${(a / 1e4).toFixed(a < 1e5 ? 1 : 0)}万円`;
  return `${s}${(a / 1e8).toFixed(a < 1e9 ? 1 : 0)}億円`;
}

// 学習の状況（記録が変わったときだけ計算し直す）。本番の系統の分
function learningReal() {
  const { S } = A;
  const key = `${S.logs.length}|${S.data?.importedAt}|${S.data?.questions.length}`;
  if (!lcCache || lcCache.key !== key) lcCache = { key, lc: Gm.learning(S.logs, S.data, S.grid?.perfMax || {}) };
  return lcCache.lc;
}
// いま出している系統の学習の状況（開発者モードでは差し替える）
export function learningNow() {
  return DEV.on ? Dv.devLearning(learningReal(), DEV.state.opts) : learningReal();
}

// 現実の時刻まで本番の系統を進めて保存する（開発者モードの間も、本番の系統は現実の時刻で回る）。戻り値：進めた刻みの数
export async function sync(now = Date.now()) {
  const { S } = A;
  if (!S.data) return 0;
  let fresh = false;
  if (!S.grid) {
    S.grid = Gm.newGrid((now % 2147483647) | 0, now);
    S.grid.era = learningReal().era; // 最初から、いまのレベルの時代で始まる（「時代が進んだ」は出さない）
    fresh = true;
  }
  const era = S.grid.era;
  const steps = Gm.catchUp(S.grid, learningReal(), now);
  if (steps > 0 || fresh || S.grid.era !== era) await A.db.putKV('grid', S.grid);
  return steps;
}
// いま出している系統を保存する（開発者モードでは kv「gridDev」）
const save = () => store.save();
const onGrid = () => A.S.view === 'grid' && !!document.querySelector('.gscreen');
const idle = () => onGrid() && !document.querySelector('.modal, .goverlay');

async function tick() {
  if (!A?.S.grid || document.hidden) return;
  const steps = await sync();
  if (steps > 0 && !DEV.on && idle()) live();
}
export async function onVisible() {
  if (!A?.S.grid) return;
  await sync();
  if (DEV.on) DEV.state.grid.realAt = Date.now(); // 開発者の系統は、開いている間だけ進む
  if (idle()) screen(undefined, !DEV.on);
}

// 学習通貨の支出は、ガチャと同じ台帳に記録する（開発者モードでは書かない）
const spend = (coins, what) => store.spend(coins, what, { gachaId: A.uid(), at: new Date().toISOString() });
const balance = () => store.balance(A.walletNow().balance);
const coinText = (v) => (v === Infinity ? '∞' : A.num(v));

export function timeLabel(g = G()) {
  const day = Math.floor(g.t / 24);
  return `${Gm.yearOf(g.t) + 1}年目 ${Gm.SEASONS[Gm.seasonOf(g.t)]} ${(day % Gm.SEASON_DAYS) + 1}日 ${g.t % 24}時`;
}
const timeShort = (g) => `${Gm.yearOf(g.t) + 1}年目 ${Gm.SEASONS[Gm.seasonOf(g.t)]}${(Math.floor(g.t / 24) % Gm.SEASON_DAYS) + 1}日 ${g.t % 24}時`;
const eraName = (n) => Gm.ERAS[n - 1].name;

// ---- 絵（本人が Gemini で作った画像があれば使い、なければ仮の絵）。番号は 試作/系統ゲーム_画像プロンプト.md ----
const PIC = { era1: 'G01', era2: 'G02', era3: 'G03', era4: 'G04', dcCoal: 'G05', acCoal: 'G06', bigCoal: 'G07', ror: 'G08', pond: 'G09', sub: 'G10', line: 'G11', heat: 'G12', cold: 'G13', typhoon: 'G14', snowstorm: 'G15', coalSpike: 'G16', priceWar: 'G17', drought: 'G18', blackout: 'G19', recover: 'G20', rebuild: 'G21', island: 'G22' };
const PH = {
  coal: '<path d="M8 30V16h6v-5h5v5h6v14z M30 30V20l8 4v-4l8 4v6z" fill="currentColor"/><path d="M16 9c0-3 3-3 3-6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  hydro: '<path d="M4 30L18 8l8 12 5-7 13 17z" fill="currentColor" opacity=".5"/><path d="M20 30c2-6 2-9 0-14M26 30c2-6 2-9 0-12" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  sub: '<rect x="12" y="12" width="24" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="28" cy="20" r="5" fill="none" stroke="currentColor" stroke-width="2"/>',
  line: '<path d="M10 30L16 8h4l6 22M14 16h8M12 23h12M30 30l4-14h3l4 14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M18 9c6 4 12 5 17 7" fill="none" stroke="currentColor" stroke-width="1"/>',
  town: '<path d="M6 30V18l7-6 7 6v12z M24 30V14h8v16z M34 30V20h8v10z" fill="currentColor"/>',
  storm: '<path d="M12 18a7 7 0 0 1 13-3 6 6 0 0 1 9 5 5 5 0 0 1-1 10H14a6 6 0 0 1-2-12z" fill="currentColor" opacity=".6"/><path d="M22 22l-4 7h5l-3 7" fill="none" stroke="currentColor" stroke-width="2"/>',
  dark: '<circle cx="24" cy="20" r="11" fill="currentColor" opacity=".25"/><path d="M19 15l10 10M29 15L19 25" stroke="currentColor" stroke-width="2.5"/>',
  light: '<circle cx="24" cy="18" r="8" fill="currentColor" opacity=".7"/><path d="M24 4v4M24 28v4M10 18h4M34 18h4M14 8l3 3M34 8l-3 3" stroke="currentColor" stroke-width="2"/>',
};
const PH_OF = { dcCoal: 'coal', acCoal: 'coal', bigCoal: 'coal', ror: 'hydro', pond: 'hydro', sub: 'sub', line: 'line', era1: 'town', era2: 'town', era3: 'town', era4: 'town', heat: 'light', cold: 'storm', typhoon: 'storm', snowstorm: 'storm', coalSpike: 'coal', priceWar: 'town', drought: 'hydro', blackout: 'dark', recover: 'light', rebuild: 'town', island: 'hydro' };
function pic(key, cls = '') {
  const src = GRID_IMAGES[PIC[key]];
  if (src) return `<span class="gpic ${cls}"><img src="${src}" alt=""></span>`;
  return `<span class="gpic ph ${cls}"><svg viewBox="0 0 48 36" aria-hidden="true">${PH[PH_OF[key]] || ''}</svg></span>`;
}

// ---- ホームのカード（いつも本番の系統） ----
export function homeCard() {
  const g = A.S.grid;
  if (!g) return '';
  const o = Gm.overview(g, learningReal());
  const chips = [g.rebuild ? '<span class="tag gng">経営再建</span>' : '', g.incidents.length ? `<span class="tag gng">事故の対処待ち ${g.incidents.length}件</span>` : '', g.apps.length ? `<span class="tag">申し込み ${g.apps.length}件</span>` : ''].join('');
  return `<button class="mapcard gridcard" data-go="grid">
      <span class="spread"><b>動く系統</b><span class="go">開く ›</span></span>
      <span class="spread small"><span>${eraName(g.era)} ・ ${timeLabel(g)}</span><span>収益 ${yen(g.yen)}</span></span>
      <span class="small">受けている需要 ${kw(o.accepted)} ／ 上限 ${kw(o.dmax)}</span>
      ${chips ? `<span class="gchips">${chips}</span>` : ''}
    </button>`;
}

// ---- 系統の画面：上の帯・地図・パネル・下のボタン ----
// p：開くパネル（'map' や null なら閉じたまま、undefined なら今のまま）。entering：外から入ったとき（前回からの結果を出す）
export async function screen(p, entering = false) {
  const { S } = A;
  if (!S.grid) await sync();
  if (!S.grid) return A.toast('問題データを読み込むと使えるようになります');
  if (p !== undefined) panel = p === 'map' ? null : p;
  if (entering) {
    B = null;
    await sync();
    const g0 = G();
    if (!DEV.on && (g0.acc.hours >= 12 || g0.acc.notes.length)) {
      summary = Gm.takeSummary(g0);
      await save();
    }
    if (summary) panel = 'summary';
  }
  if (panel && panel !== 'summary' && !panelOk(panel)) panel = null;
  const g = G();
  A.show(
    `<div class="gscreen${B ? ' building' : ''}">
      <header class="gbar"><button class="back" data-back>‹ ホーム</button><button class="ghud" data-hud aria-label="需給を開く">${hudHtml(g)}</button></header>
      ${devBand()}
      ${g.rebuild ? '<button class="btn primary gwide gwarn grebuild" data-rebuild>経営再建：手放すか、借入れを選ぶ</button>' : ''}
      <div class="gmid" data-mid>
        <div class="gmapbox" data-mapbox>${mapSvg(g)}</div>
        <div class="gbuildbar" data-bbar>${buildBarHtml(g)}</div>
        <div class="gbcard" data-bcard></div>
        <section class="gpanel${panel ? ' open' : ''}" data-panel aria-hidden="${panel ? 'false' : 'true'}"><div class="gpin" data-pin></div></section>
      </div>
      <nav class="gdock" data-dock>${dockHtml(g)}</nav>
    </div>`,
    () => {
      S.view = 'grid';
      A.on('[data-back]', 'click', () => {
        summary = null;
        B = null;
        panel = null;
        A.home();
      });
      A.on('[data-hud]', 'click', () => togglePanel('supply'));
      A.on('[data-rebuild]', 'click', rebuildDialog);
      bindDock();
      bindDevBand();
      bindMap();
      syncFlows();
      bindBuildBar();
      drawPanel();
      drawBuildCard();
      effects(g);
    },
  );
}
const panelOk = (p) => {
  const [k, id] = p.split(':');
  if (k === 'node') return !!Gm.nodeOf(G(), id);
  if (k === 'line') return G().lines.some((l) => l.id === id);
  return ['build', 'run', 'supply', 'list', 'manage'].includes(k);
};

// 時間が進んだときの描き直し：帯・地図・下のボタンの数・パネル（入力中でなければ）。パネルの位置（スクロール）は残す
function live() {
  if (!onGrid()) return;
  const g = G();
  const q = (s) => document.querySelector(s);
  q('[data-hud]').innerHTML = hudHtml(g);
  drawMap();
  q('[data-dock]').innerHTML = dockHtml(g);
  bindDock();
  const band = q('.gdevband [data-devops]');
  if (band) band.textContent = devSpeedText();
  const pin = q('[data-pin]');
  const busy = pin?.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  // パネルは入力中でなければ描き直す。早送り（1秒ごと）のときは4秒に1回まで（押した瞬間にボタンが入れ替わらないように）
  if (panel && panel !== 'summary' && panel !== 'build' && !busy && Date.now() - drawnAt > 4000) drawPanel(true);
  if (!!g.rebuild !== !!q('[data-rebuild]')) screen();
}

// ---- 上の帯：日付と時代・コイン・収益・需要と届いた量・周波数・状態（375px で2行まで） ----
function gridState(g) {
  const l = g.last;
  if (!l) return { text: 'まだ動いていない', cls: '' };
  if (Object.values(g.black).some((u) => u > g.t)) return { text: '全域停電', cls: 'bad' };
  if (l.shed) return { text: '負荷遮断', cls: 'bad' };
  if (l.demand - l.served > 0.01 * l.demand) return { text: '一部に届いていない', cls: 'bad' };
  if (g.hz && Math.abs(l.x) > Gm.FREQ.ok) return { text: '周波数の乱れ', cls: 'warn' };
  return { text: '正常', cls: 'ok' };
}
function hudHtml(g) {
  const l = g.last;
  const st = gridState(g);
  return `<span class="hr"><span class="hcell grow1">${eraName(g.era)} ${timeShort(g)}</span><span class="hcell">コイン <b>${coinText(balance())}</b></span></span>
    <span class="hr"><span class="hcell">収益 <b class="${g.yen < 0 ? 'gneg' : ''}">${yenShort(g.yen)}</b></span><span class="hcell grow1">需要 <b>${kw(l?.demand || 0)}</b> 届 <b>${kw(l?.served || 0)}</b></span>${g.hz ? `<span class="hcell">${(g.hz + (l?.x || 0)).toFixed(2)}Hz</span>` : ''}<span class="hstate ${st.cls}">${st.text}</span></span>`;
}

// ---- 下のボタン5つ ----
const DOCK = [
  ['build', '建設', '<path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'],
  ['run', '運転', '<circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 13l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 3v2" stroke="currentColor" stroke-width="1.8"/>'],
  ['supply', '需給', '<path d="M3 20h18M5 17l4-5 4 3 6-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>'],
  ['list', '一覧', '<path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/>'],
  ['manage', '経営', '<path d="M5 20V8l7-4 7 4v12M9 20v-6h6v6M3 20h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 9h4" stroke="currentColor" stroke-width="1.8"/>'],
];
function dockHtml(g) {
  const badge = { list: g.incidents.length + g.apps.length, manage: g.rebuild ? 1 : 0 };
  const urgent = { list: g.incidents.length > 0, manage: !!g.rebuild };
  const cur = panel?.split(':')[0];
  return DOCK.map(([k, name, icon]) => `<button class="gdbtn${cur === k ? ' on' : ''}" data-dockp="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${name}</span>${badge[k] ? `<i class="gbadge${urgent[k] ? ' ng' : ''}">${k === 'manage' ? '!' : badge[k]}</i>` : ''}</button>`).join('');
}
function bindDock() {
  document.querySelectorAll('[data-dockp]').forEach((el) => (el.onclick = () => togglePanel(el.dataset.dockp)));
}
// 同じボタンを押すと閉じる。建設モードの途中で別のパネルを開くと、建設モードはやめる
function togglePanel(p) {
  if (panel === p || (p !== 'build' && panel?.split(':')[0] === p)) return setPanel(null);
  if (p !== 'build') buildFor = null;
  setPanel(p);
}
function setPanel(p) {
  if (p && B) {
    B = null;
    return screen(p);
  }
  if (p !== 'summary' && panel === 'summary') summary = null;
  panel = p;
  if (p !== 'build') whyOpen = null;
  const el = document.querySelector('[data-panel]');
  if (!el) return screen(p);
  el.classList.toggle('open', !!p);
  el.setAttribute('aria-hidden', p ? 'false' : 'true');
  document.querySelector('[data-dock]').innerHTML = dockHtml(G());
  bindDock();
  if (p) drawPanel();
  else fitMap();
  if (p === null || p.startsWith('node') || p.startsWith('line')) drawMap(); // 選んでいる地点の印
}
// パネル（建設モードではカード）が開いているときは、地図をその上の空いたところに縮めて、島の全体が見えるようにする
function fitMap() {
  const box = document.querySelector('[data-mapbox]');
  const el = document.querySelector('[data-panel]');
  if (!box || !el) return;
  const card = document.querySelector('[data-bcard].open');
  const h = panel ? el.getBoundingClientRect().height : card ? card.getBoundingClientRect().height + 12 : 0;
  box.style.bottom = `${Math.round(h)}px`;
  const bar = B && document.querySelector('[data-bbar]');
  box.style.top = bar ? `${Math.round(bar.getBoundingClientRect().height + 8)}px` : '0px'; // 建設モードの帯の下から
}
// パネルの中身を描く（keep：スクロールの位置を残す）
let drawnAt = 0;
function drawPanel(keep = false) {
  drawnAt = Date.now();
  const pin = document.querySelector('[data-pin]');
  if (!pin) return;
  if (!panel) {
    pin.innerHTML = '';
    return;
  }
  const top = keep ? pin.scrollTop : 0;
  const g = G(), lc = learningNow();
  const [k, id] = panel.split(':');
  const body = { build: buildPanel, run: runPanel, supply: supplyPanel, list: listPanel, manage: managePanel, summary: summaryPanel, node: nodePanel, line: linePanel }[k](g, lc, id);
  pin.innerHTML = `<div class="gphead"><h2>${body.title}</h2><button class="btn small" data-pclose aria-label="閉じる">閉じる</button></div>${body.html}`;
  pin.scrollTop = top;
  const $ = (s) => pin.querySelector(s);
  const onAll = (s, ev, fn) => pin.querySelectorAll(s).forEach((el) => el.addEventListener(ev, fn));
  onAll('[data-pclose]', 'click', () => setPanel(null));
  onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
  body.bind?.({ $, onAll, g, lc });
  fitMap();
}

// 時代が進んだとき・全域停電からの復旧（演出ありでは少し派手に）
function effects(g) {
  if (g.eraUp) {
    const E = Gm.ERAS[g.eraUp - 1];
    overlay(`era${g.eraUp}`, `時代が進んだ：${E.name}`, `${E.year}　新しい設備と需要が登場する。${g.eraUp === 2 && !g.hz ? '交流の発電機を建てるとき、周波数（50 Hz／60 Hz）を選ぶ。' : ''}`, [523.3, 659.3, 784, 1046.5]);
    delete g.eraUp;
    save();
  } else if (g.blackoutFx && !Object.values(g.black).some((u) => u > g.t)) {
    overlay('recover', '全域停電から復旧した', '町に明かりが戻った。予備力の目標と、最大の発電機1台分を見比べてみよう。', [392, 523.3, 659.3]);
    delete g.blackoutFx;
    save();
  }
}
function overlay(picKey, title, text, notes) {
  const ov = document.createElement('div');
  ov.className = 'goverlay';
  ov.innerHTML = `<div class="gov">${pic(picKey, 'wide')}<h2>${A.esc(title)}</h2><p>${A.esc(text)}</p><button class="btn primary" data-close>閉じる</button></div>`;
  document.body.append(ov);
  if (A.fx()) A.playNotes(notes.map((f, i) => [f, i * 0.12]));
  ov.querySelector('[data-close]').onclick = () => ov.remove();
}

// ---- 前回からの結果（開いたとき） ----
function summaryPanel() {
  const s = summary;
  if (!s) return { title: '前回からの結果', html: '<p class="note">ありません</p>' };
  const days = s.hours / 24;
  const span = days >= 1 ? `ゲームの ${Math.round(days)}日` : `${s.hours}時間`;
  const bad = [s.blackH ? `全域停電 ${s.blackH}時間` : '', s.shedH ? `負荷遮断 ${s.shedH}時間` : '', s.badH ? `周波数・電圧の乱れ ${s.badH}時間` : ''].filter(Boolean);
  return {
    title: `前回からの結果（${span}）`,
    html: `<div class="gsum">
      <p class="spread"><span>利益</span><b class="${s.profit < 0 ? 'gneg' : ''}">${s.profit >= 0 ? '+' : ''}${yen(s.profit)}</b></p>
      <p class="small">売電 ${yen(s.rev)} − 燃料 ${yen(s.fuel)} − 保守 ${yen(s.maint)} − 修理 ${yen(s.repair)}${s.loan ? ` − 返済 ${yen(s.loan)}` : ''}</p>
      <p class="small">届かなかった電力量 ${Math.round(s.unserved).toLocaleString('ja-JP')} kWh${bad.length ? ` ・ ${bad.join(' ・ ')}` : s.unserved < 1 ? ' ・ 停電なし' : ''}${s.apps ? ` ・ 新しい申し込み ${s.apps}件` : ''}</p>
      ${s.notes.length ? `<ul class="gnotes">${s.notes.map((n) => `<li>${A.esc(n)}</li>`).join('')}</ul>` : ''}
    </div>`,
  };
}

// ---- 地図 ----
// 座標の変換はここだけ：地点の (x, y) → 地図の座標。拡大・移動（1.6.0）は VIEW（viewBox）を変えるだけでできる
const MAP_W = 360, MAP_H = 400;
const VIEW = { x: 0, y: 0, w: MAP_W, h: MAP_H };
const at = (n) => ({ x: n.x, y: n.y });
const ISLAND = 'M38,78 C70,22 170,6 252,36 C312,58 348,150 338,244 C332,322 300,372 232,386 C150,398 62,366 34,296 C8,226 10,128 38,78Z';
const utilColor = (u) => (u > 1.2 ? 'var(--ng)' : u > 1 ? 'var(--idk)' : 'var(--gline)');
// 線の形（2次ベジェ）。回り道はふくらませ、直流は少しずらす（同じ2地点の交流と重ならないように）
function linePath(a, b, route, dc) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bend = route === 'detour' ? 26 : dc ? -8 : 0;
  const cx = mx + (dy / len) * bend, cy = my - (dx / len) * bend;
  return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, back: `M${b.x},${b.y} Q${cx},${cy} ${a.x},${a.y}`, lx: (mx + cx) / 2, ly: (my + cy) / 2 };
}
const hoursText = (h) => (h >= 48 ? `${Math.ceil(h / 24)}日` : `${h}時間`);
function mapSvg(g) {
  const nodes = Gm.nodesOf(g);
  const N = (id) => at(nodes.find((n) => n.id === id));
  const t = g.t;
  const cand = B ? candidates(g, learningNow()) : null;
  const selId = panel?.startsWith('node:') ? panel.slice(5) : null;
  const selLine = panel?.startsWith('line:') ? panel.slice(5) : null;
  let s = `<path d="${ISLAND}" fill="var(--land)" stroke="var(--coast)" stroke-width="1.5"/>`;
  // 地形：雪の地域（北西）・山・川・海岸
  s += '<path d="M40,84 C60,46 110,26 150,22 C150,60 120,110 70,140 C40,140 26,116 40,84Z" fill="var(--gsnow)" opacity=".7"/>';
  s += [[150, 60], [176, 46], [205, 62], [232, 52], [262, 70], [118, 86], [278, 104], [196, 96]].map(([x, y]) => `<path d="M${x - 11},${y + 9} L${x},${y - 9} L${x + 11},${y + 9}Z" fill="var(--gmount)"/>`).join('');
  s += '<path d="M130,44 C150,90 190,120 210,180 C218,214 196,238 186,262 C196,300 208,320 214,338 C218,356 224,370 228,386" fill="none" stroke="var(--griver)" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M246,96 C236,130 222,156 210,180" fill="none" stroke="var(--griver)" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>';
  s += '<text x="74" y="72" class="gland">雪の地域</text><text x="222" y="78" class="gland">山</text><text x="302" y="312" class="gland">海岸</text><text x="118" y="236" class="gland">平野</text>';
  // 線（下の色は使用率・直流・止まっている）
  let flows = '';
  for (const l of g.lines) {
    const a = N(l.a), b = N(l.b);
    const K = Gm.LINES[l.kind];
    const P = linePath(a, b, l.route, K.dc);
    const building = l.readyAt > t;
    const down = !building && Gm.lineCircuits(l, t) <= 0;
    const u = g.last?.lines[l.id]?.util || 0;
    const col = building ? 'var(--muted)' : down ? 'var(--ng)' : K.dc ? 'var(--gdc)' : utilColor(u);
    const wdt = K.dc ? 2 : K.kv >= 66 ? 3.6 : K.kv >= 11 ? 2.8 : 2;
    const label = building ? `${K.short} 工事 あと${hoursText(l.readyAt - t)}` : `${K.short}${l.n > 1 ? `×${l.n}` : ''}`;
    s += `<g class="gline${selLine === l.id ? ' sel' : ''}${B ? ' gdim' : ''}" data-line="${l.id}"><path d="${P.d}" fill="none" stroke="transparent" stroke-width="22"/>${selLine === l.id ? `<path d="${P.d}" fill="none" stroke="var(--primary)" stroke-width="${wdt + 5}" stroke-linecap="round" opacity=".3"/>` : ''}<path d="${P.d}" fill="none" stroke="${col}" stroke-width="${wdt}" stroke-linecap="round" ${building ? 'stroke-dasharray="2 5"' : down ? 'stroke-dasharray="7 5"' : ''}/>
      <text x="${P.lx}" y="${P.ly - 4}" class="glabel${building ? ' gwork' : ''}">${label}</text></g>`;
    flows += flowPath(g, l, a, b, P);
  }
  s += `<g class="gflows${B ? ' gdim' : ''}" aria-hidden="true">${flows}</g>`;
  // 建設モードの仮の線（点線）
  if (B?.kind === 'line' && B.from && B.to) {
    const P = linePath(N(B.from), N(B.to), B.route, Gm.LINES[B.lk].dc);
    s += `<path d="${P.d}" class="gtemp" fill="none"/>`;
  }
  // 地点
  for (const n of nodes) {
    const { x, y } = at(n);
    const plants = g.plants.filter((p) => p.site === n.id);
    const subs = g.subs.filter((v) => v.town === n.id);
    const inc = g.incidents.some((i) => i.town === n.id || plants.some((p) => p.id === i.plant) || subs.some((v) => v.id === i.sub));
    let body = '';
    if (n.town) {
      const open = n.era <= g.era;
      const st = g.last?.towns[n.id];
      const has = g.loads.some((l) => l.town === n.id);
      const fill = !has ? 'var(--card)' : !st || st.d <= 0 ? 'var(--gidle)' : st.r >= 0.999 ? 'var(--glit)' : st.r > 0 ? 'var(--idk-bg)' : 'var(--gdark)';
      body = `<circle cx="${x}" cy="${y}" r="11" fill="${fill}" stroke="${has ? 'var(--text)' : 'var(--muted)'}" stroke-width="1.6" ${open ? '' : 'stroke-dasharray="2 3" opacity=".5"'}/>
        <path d="M${x - 5},${y + 4} v-5 l3,-3 l3,3 v5z M${x + 1},${y + 4} v-8 h4 v8z" fill="${has ? 'var(--text)' : 'var(--muted)'}" opacity="${open ? 0.8 : 0.4}"/>`;
      if (subs.length) body += `<rect x="${x + 9}" y="${y - 15}" width="10" height="10" rx="2" fill="var(--card)" stroke="${subs.some((v) => v.readyAt <= t && v.downUntil <= t) ? 'var(--gline)' : subs.every((v) => v.readyAt > t) ? 'var(--muted)' : 'var(--ng)'}" stroke-width="1.5" ${subs.every((v) => v.readyAt > t) ? 'stroke-dasharray="2 2"' : ''}/><text x="${x + 14}" y="${y - 7}" class="gmark">変</text>`;
    } else {
      body = `<path d="M${x},${y - 9} L${x + 9},${y} L${x},${y + 9} L${x - 9},${y}Z" fill="var(--card)" stroke="var(--muted)" stroke-width="1.3" ${plants.length ? '' : 'stroke-dasharray="2 3"'}/>`;
    }
    plants.forEach((p, i) => {
      const D = Gm.PLANTS[p.type];
      const px = x - 14 - (i % 2) * 11, py = y - 14 + Math.floor(i / 2) * 11;
      const out = g.last?.plants[p.id] || 0;
      const col = p.readyAt > t ? 'var(--muted)' : p.downUntil > t ? 'var(--ng)' : out > 0 ? (D.coal ? 'var(--gcoal)' : 'var(--ghydro)') : 'var(--gidleplant)';
      body += D.coal ? `<rect x="${px - 4.5}" y="${py - 4.5}" width="9" height="9" rx="1.5" fill="${col}" ${p.readyAt > t ? 'opacity=".5"' : ''}/>` : `<path d="M${px - 5},${py + 4.5} L${px},${py - 5} L${px + 5},${py + 4.5}Z" fill="${col}" ${p.readyAt > t ? 'opacity=".5"' : ''}/>`;
    });
    // 工事中の発電所・変圧器：残りの時間を小さく添える
    const work = [...plants, ...subs].filter((v) => v.readyAt > t).map((v) => v.readyAt - t);
    if (work.length) body += `<text x="${x}" y="${y - 25}" class="glabel gwork">工事 あと${hoursText(Math.min(...work))}</text>`;
    const name = n.name.length > 6 ? [n.name.slice(0, Math.ceil(n.name.length / 2)), n.name.slice(Math.ceil(n.name.length / 2))] : [n.name];
    const c = cand?.get(n.id);
    const mode = !B ? (selId === n.id ? ' sel' : '') : c === 'sel' ? ' sel' : c ? ' gcan' : ' gdim';
    const ring = !B ? (selId === n.id ? `<circle cx="${x}" cy="${y}" r="17" class="gselring"/>` : '') : c === 'sel' ? `<circle cx="${x}" cy="${y}" r="17" class="gselring"/>` : c ? `<circle cx="${x}" cy="${y}" r="16" class="gpulse"/><circle cx="${x}" cy="${y}" r="16" class="gring"/>` : '';
    s += `<g class="gnode${mode}" data-node="${n.id}"><circle cx="${x}" cy="${y}" r="23" fill="transparent"/>${ring}${body}
      <text y="${y + 23}" class="gname">${name.map((v, i) => `<tspan x="${x}" dy="${i ? 9.5 : 0}">${A.esc(v)}</tspan>`).join('')}</text>
      ${inc ? `<circle cx="${x + 12}" cy="${y + 8}" r="6" fill="var(--ng)"/><text x="${x + 12}" y="${y + 11}" class="gbang">!</text>` : ''}</g>`;
  }
  return `<svg class="gmap" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="島の地図">${s}</svg>`;
}
// 電気の流れ（黄色い点線）：流れている線にだけ重ね、流れる向き（last.lines の to）に動かす。速さは使用率で3段階
// 描き直しても動きが途切れないよう、描いたあとに syncFlows で動きの起点を文書の時計の0にそろえる（同じ段なら位相が同じになる）
const FLOW_SEC = [0, 2.4, 1.4, 0.8];
function flowPath(g, l, a, b, P) {
  const f = g.last?.lines[l.id];
  if (!f || !(f.p > 1e-3) || l.readyAt > g.t || Gm.lineCircuits(l, g.t) <= 0) return '';
  const tier = f.util < 0.3 ? 1 : f.util < 0.8 ? 2 : 3;
  const sec = FLOW_SEC[tier];
  const K = Gm.LINES[l.kind];
  const w = (K.dc ? 2 : K.kv >= 66 ? 3.6 : K.kv >= 11 ? 2.8 : 2) + 0.8; // 下の線より少し太く。暗い縁（gflowe）を下に敷いて、明るい地図でも見えるように
  const d = f.to === l.a ? P.back : P.d;
  return `<path d="${d}" class="gflowe s${tier}" stroke-width="${w + 1.6}" data-sec="${sec}"/><path d="${d}" class="gflow s${tier}" stroke-width="${w}" data-sec="${sec}"/>`;
}
function syncFlows() {
  for (const el of document.querySelectorAll('.gmap [data-sec]')) {
    const a = el.getAnimations?.()[0];
    if (a && 'startTime' in a) a.startTime = 0;
    else el.style.animationDelay = `${(-((Date.now() / 1000) % Number(el.dataset.sec))).toFixed(3)}s`; // 古いブラウザ：現在時刻から決める
  }
}
function drawMap() {
  const box = document.querySelector('[data-mapbox]');
  if (!box) return;
  box.innerHTML = mapSvg(G());
  syncFlows();
}

// 地図を押す：描き直しで要素が入れ替わっても取りこぼさないよう、押した場所（pointerdown）の地点・線を覚えて、離したときに動かす
let press = null;
function bindMap() {
  const mid = document.querySelector('[data-mid]');
  const box = document.querySelector('[data-mapbox]');
  box.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-node],[data-line]');
    press = { x: e.clientX, y: e.clientY, node: el?.dataset.node || null, line: el?.dataset.line || null, id: e.pointerId };
  });
  box.addEventListener('pointerup', (e) => {
    const p = press;
    press = null;
    if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
    mapTap(p.node, p.line);
  });
  box.addEventListener('pointercancel', () => (press = null));
  mid.addEventListener('contextmenu', (e) => e.target.closest('[data-mapbox]') && e.preventDefault());
}
function mapTap(node, line) {
  // パネルが開いているときは、地図を押すと閉じる（地点・線は動かさない）
  if (panel) return setPanel(null);
  if (B) return node ? buildTap(node) : null;
  if (node) return setPanel(`node:${node}`);
  if (line) return setPanel(`line:${line}`);
}

// ---- 建設のパネル：発電所の種類・線の種類（電圧の階級ごと）・変圧器。まだ建てられない種類は灰色 ----
const gateText = (keys) => `「${keys.map((k) => Gm.GATE_NAMES[k]).join('」「')}」の単元で、まだ1問も正解していない`;
const eraFrom = (era, level) => `まだ先の時代の設備（${eraName(Math.min(era, Gm.ERAS.length))}${level ? `・Lv${level}` : ''}から）`;
// 種類ごとの「建てられるか」（場所によらない条件：時代・学習の単元・設計図）
function typeStatus(lc, kind, key) {
  const D = kind === 'plant' ? Gm.PLANTS[key] : kind === 'line' ? Gm.LINES[key] : Gm.TR;
  const st = Gm.eraStatus(lc, D.era, kind === 'line' ? D.level : 0);
  if (st === 'no') return { ok: false, why: eraFrom(D.era, kind === 'line' ? D.level : 0) };
  const miss = (D.gates || []).filter((k) => !lc.gate[k]);
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  if (D.blueprint && !lc.blueprint[D.blueprint]) return { ok: false, why: `設計図「${Gm.BLUEPRINTS[D.blueprint].name}」がない（試験レベルに正解するか、関係する外部試験で満点の3割以上）`, blueprint: D.blueprint };
  return { ok: true, proto: st === 'proto' };
}
function buildPanel(g, lc) {
  const from = buildFor?.site || buildFor?.from;
  const item = (kind, key, name, sub, picKey) => {
    const s = typeStatus(lc, kind, key);
    const id = `${kind}:${key}`;
    const here = buildFor?.site && kind === 'plant' && !Gm.siteAllows(g, key, buildFor.site);
    return `<button class="gbitem${s.ok && !here ? '' : ' locked'}" data-bitem="${id}">${picKey ? pic(picKey, 'mini') : '<span class="gpic ph mini gline-ic"><svg viewBox="0 0 48 36" aria-hidden="true">' + PH.line + '</svg></span>'}<span class="gbtx"><b>${name}${s.ok && s.proto ? ' <span class="tag">試作</span>' : ''}</b><small>${here ? 'この場所には建てられない' : s.ok ? sub : A.esc(s.why)}</small></span><span class="go">${s.ok && !here ? '›' : ''}</span></button>
      ${whyOpen === id && !s.ok ? `<div class="gwhy">${whyHtml(s)}</div>` : ''}`;
  };
  const range = (D) => {
    const ok = D.sizes.filter((z) => Gm.eraStatus(lc, Math.max(D.era, z[2]?.era || 0)) !== 'no');
    if (!ok.length) return '';
    return `${kw(ok[0][0])}〜${kw(ok[ok.length - 1][0])} ・ ${A.num(ok[0][1])} コイン〜`;
  };
  const plants = Object.entries(Gm.PLANTS).map(([k, D]) => item('plant', k, D.name, range(D), k)).join('');
  const lines = Object.entries(Gm.LINES).map(([k, K]) => item('line', k, K.name, `1回線で ${kw(K.cap)} まで ・ ${A.num(K.cost)} コイン/km`, null)).join('');
  const subs = item('sub', 'tr', '変圧器（変電所）', `0.1〜100 MVA ・ ${A.num(Gm.subCost(Gm.SUB_SIZES[0]))} コイン〜 ・ 1つの町に2台まで`, 'sub');
  const head = buildFor?.site ? `<p class="small">${A.esc(Gm.nodeOf(g, buildFor.site).name)}に建てる種類を選ぶ</p>` : buildFor?.from ? `<p class="small">${A.esc(Gm.nodeOf(g, buildFor.from).name)}から引く線の種類を選ぶ</p>` : '<p class="small">種類を選ぶと、地図の上で場所を選べます。灰色の種類は、押すと理由がわかります。</p>';
  return {
    title: '建設',
    html: `${head}
      ${buildFor?.from ? '' : `<h3>発電所</h3>${plants}`}
      ${buildFor?.site ? '' : `<h3>線（電圧の階級）</h3>${lines}`}
      ${buildFor || from ? '' : `<h3>変圧器</h3>${subs}`}`,
    bind: ({ onAll }) =>
      onAll('[data-bitem]', 'click', (e) => {
        const [kind, key] = e.currentTarget.dataset.bitem.split(':');
        const s = typeStatus(learningNow(), kind, key);
        if (!s.ok) {
          whyOpen = whyOpen === `${kind}:${key}` ? null : `${kind}:${key}`;
          return drawPanel(true);
        }
        if (buildFor?.site && kind === 'plant' && !Gm.siteAllows(G(), key, buildFor.site)) return A.toast('この場所には建てられない種類です');
        enterBuild(kind, key, buildFor?.site || buildFor?.from || null);
      }),
  };
}
// 建設できない理由に「この単元を解く」を付ける
function whyHtml(q) {
  const units = (q.gates || []).flatMap((k) => Gm.GATES[k]).concat(q.blueprint ? Gm.BLUEPRINTS[q.blueprint].units : []);
  return `<p class="warn small">${A.esc(q.why)}</p>${unitButtons(units)}`;
}
function unitButtons(units) {
  const has = new Set(L.activeQuestions(A.S.data).map((x) => x.unitId));
  const list = [...new Set(units)].filter((u) => has.has(u));
  if (!list.length) return units.length ? '<p class="small">（関係する単元の問題が、まだ問題データにありません）</p>' : '';
  return `<p class="gunits">${list.map((u) => `<button class="btn small" data-unitgo="${u}">${A.esc(A.subjectOf(A.unitSubjectId(u))?.name || '')}「${A.esc(A.shortName(A.unitName(u)))}」を解く</button>`).join('')}</p>`;
}
function goUnit(unitId) {
  document.querySelector('.modal.gsheet')?.remove();
  summary = null;
  B = null;
  panel = null;
  A.startUnit(A.unitSubjectId(unitId), unitId);
}

// ---- 建設モード：地図の上で場所を選ぶ。建てられる地点は光らせ、建てられない地点は薄くする ----
function enterBuild(kind, key, preset = null) {
  const g = G(), lc = learningNow();
  if (kind === 'plant') B = { kind, type: key, site: null, size: null };
  else if (kind === 'line') B = { kind, lk: key, from: null, to: null, route: 'direct', opts: {} };
  else B = { kind: 'sub', town: null, mva: Gm.SUB_SIZES[0] };
  buildFor = null;
  panel = null;
  const c = candidates(g, lc);
  if (preset && c.get(preset)) pick(preset);
  else if (preset) A.toast(kind === 'line' ? 'この地点から引ける相手がありません' : 'この地点には建てられません');
  screen();
}
function exitBuild() {
  B = null;
  screen();
}
// 地点 → 'can'（選べる）／'sel'（選んでいる）。どれにもならない地点は薄くする
function candidates(g, lc) {
  const m = new Map();
  const nodes = Gm.nodesOf(g);
  if (B.kind === 'plant') {
    const D = Gm.PLANTS[B.type];
    for (const n of nodes) {
      if (!Gm.siteAllows(g, B.type, n.id)) continue;
      const any = D.sizes.some((z) => {
        const q = Gm.quotePlant(g, lc, { type: B.type, kw: z[0], site: n.id });
        return q.ok || q.hz;
      });
      if (any) m.set(n.id, 'can');
    }
    if (B.site) m.set(B.site, 'sel');
  } else if (B.kind === 'line') {
    const ok = (a, b) => Gm.quoteLine(g, lc, { a, b, kind: B.lk }).ok;
    if (!B.from) {
      for (const n of nodes) if (nodes.some((o) => o.id !== n.id && ok(n.id, o.id))) m.set(n.id, 'can');
    } else {
      for (const n of nodes) if (n.id !== B.from && ok(B.from, n.id)) m.set(n.id, 'can');
      m.set(B.from, 'sel');
      if (B.to) m.set(B.to, 'sel');
    }
  } else {
    for (const n of nodes) if (n.town && Gm.quoteSub(g, lc, { town: n.id, mva: Gm.SUB_SIZES[0] }).ok) m.set(n.id, 'can');
    if (B.town) m.set(B.town, 'sel');
  }
  return m;
}
// 選んだ地点を建設の状態に入れる
function pick(id) {
  const g = G(), lc = learningNow();
  if (B.kind === 'plant') {
    B.site = id;
    const D = Gm.PLANTS[B.type];
    const sizes = D.sizes.filter((z) => Gm.eraStatus(lc, Math.max(D.era, z[2]?.era || 0)) !== 'no');
    const fit = sizes.find((z) => Gm.quotePlant(g, lc, { type: B.type, kw: z[0], site: id }).ok) || sizes[0];
    if (!B.size || !sizes.some((z) => z[0] === B.size)) B.size = fit[0];
  } else if (B.kind === 'line') {
    if (!B.from) B.from = id;
    else B.to = id;
  } else B.town = id;
}
function buildTap(id) {
  const g = G(), lc = learningNow();
  const c = candidates(g, lc).get(id);
  if (B.kind === 'line' && B.from && id === B.from) {
    B.from = null; // 始点を押し直すと、始点から選び直す
    B.to = null;
  } else if (c === 'can') pick(id);
  else if (c === 'sel') return;
  else return A.toast(whyNot(g, lc, id));
  refreshBuild();
}
// 光っていない地点を押したときの理由
function whyNot(g, lc, id) {
  const n = Gm.nodeOf(g, id);
  if (B.kind === 'plant') {
    if (!Gm.siteAllows(g, B.type, id)) return `${n.name}には${Gm.PLANTS[B.type].short}を建てられません`;
    return Gm.quotePlant(g, lc, { type: B.type, kw: Gm.PLANTS[B.type].sizes[0][0], site: id }).why || 'ここには建てられません';
  }
  if (B.kind === 'line') {
    if (!B.from) return `${n.name}から引ける相手がありません`;
    return Gm.quoteLine(g, lc, { a: B.from, b: id, kind: B.lk }).why || 'ここには引けません';
  }
  if (!n.town) return '変圧器は町に置きます';
  return Gm.quoteSub(g, lc, { town: id, mva: Gm.SUB_SIZES[0] }).why || 'ここには置けません';
}
// 建設モードの描き直し（地図・帯・カードだけ）
function refreshBuild() {
  if (!onGrid()) return;
  drawMap();
  document.querySelector('[data-bbar]').innerHTML = buildBarHtml(G());
  bindBuildBar();
  drawBuildCard();
}
function buildBarHtml(g) {
  if (!B) return '';
  const name = B.kind === 'plant' ? Gm.PLANTS[B.type].name : B.kind === 'line' ? Gm.LINES[B.lk].name : '変圧器';
  const what = B.kind === 'plant' ? `${name}を建てる場所を選ぶ` : B.kind === 'sub' ? '変圧器を置く町を選ぶ' : !B.from ? `${name}：始点を選ぶ` : !B.to ? `${name}：終点を選ぶ（始点 ${Gm.nodeOf(g, B.from).name}）` : `${name}：${Gm.nodeOf(g, B.from).name} 〜 ${Gm.nodeOf(g, B.to).name}`;
  const hint = B.kind === 'line' && B.to ? '別の光っている地点を押すと終点を変える。始点を押すと選び直し' : '光っている地点を押す';
  return `<p><b>${A.esc(what)}</b><small>${hint}</small></p><button class="btn small" data-bquit>やめる</button>`;
}
function bindBuildBar() {
  document.querySelector('[data-bquit]')?.addEventListener('click', exitBuild);
}
const quoteHtml = (q) =>
  q.ok
    ? `<p class="gquote"><b>${A.num(q.cost)} コイン</b>（残高 ${coinText(balance())}）・ 工期 ${q.hours != null ? `ゲームの ${q.hours}時間` : 'すぐ'}${q.proto ? '<br><span class="warn">試作：次の時代の設備を先取り。建設費3倍・故障率3倍・効率は下限から</span>' : ''}</p>`
    : whyHtml(q);
const hazardText = (hs) => (hs.length ? hs.map((h) => Gm.HAZARD[h].name).join('・') : 'なし');
// 地図の下に出す小さなカード（地点名・大きさ・費用・工期・試作の注意・「建設する」）
function drawBuildCard() {
  const el = document.querySelector('[data-bcard]');
  if (!el) return;
  const g = G(), lc = learningNow();
  const ready = B && (B.kind === 'plant' ? B.site : B.kind === 'line' ? B.from && B.to : B.town);
  el.classList.toggle('open', !!ready);
  if (!ready) {
    el.innerHTML = '';
    return fitMap();
  }
  let h = '';
  let q = null, what = '', doBuild = null;
  if (B.kind === 'plant') {
    const D = Gm.PLANTS[B.type];
    const sizes = D.sizes.filter((z) => Gm.eraStatus(lc, Math.max(D.era, z[2]?.era || 0)) !== 'no');
    q = Gm.quotePlant(g, lc, { type: B.type, kw: B.size, site: B.site });
    const eff = D.coal ? `熱効率 ${(D.eff[0] * 100).toFixed(0)}〜${(D.eff[1] * 100).toFixed(0)}%（いま ${(Gm.plantEff({ type: B.type, proto: q.proto }, lc) * 100).toFixed(1)}%）・起動 ${D.start}時間・最低出力 ${pct(D.min)}` : B.type === 'ror' ? '燃料なし。出力は川の流量しだい（春 1.3・夏 1.0・秋 0.9・冬 0.6）' : '燃料なし。1日分の水をためて、時間をずらして使う（池＝出力の6時間分）';
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.site).name)}</b>：${D.name}</p>
      <div class="gseg gsizes">${sizes.map((z) => `<button class="btn small ${z[0] === B.size ? 'on' : ''}" data-bsize="${z[0]}">${kw(z[0])}</button>`).join('')}</div>
      <p class="small">${eff} ・ ${D.bs ? 'ブラックスタートできる' : 'ブラックスタートできない'}</p>
      ${q.hz ? '<p class="small">交流の発電機を初めて建てるので、先に周波数を決めます。</p><button class="btn primary gwide" data-hz>周波数を選ぶ</button>' : quoteHtml(q)}`;
    what = `${D.short} ${kw(B.size)}`;
    doBuild = () => Gm.buildPlant(g, lc, { type: B.type, kw: B.size, site: B.site });
  } else if (B.kind === 'line') {
    const K = Gm.LINES[B.lk];
    q = Gm.quoteLine(g, lc, { a: B.from, b: B.to, kind: B.lk, route: B.route, opts: B.opts });
    const r = { direct: Gm.routeInfo(g, B.from, B.to, 'direct'), detour: Gm.routeInfo(g, B.from, B.to, 'detour') };
    const lossFull = Gm.lineLoss(B.lk, r[B.route].km, 1, K.cap) / K.cap; // 送れる量いっぱいを流したときの損失の目安
    const opts = K.dc ? '' : Object.entries(Gm.LINE_OPTS).filter(([, O]) => !O.era || Gm.eraStatus(lc, O.era) === 'ok').map(([k, O]) => `<label class="row"><input type="checkbox" data-bopt="${k}" ${B.opts[k] ? 'checked' : ''}><span>${O.name}<small>${O.hazard ? `${Gm.HAZARD[O.hazard].name}の事故を減らす` : '地絡の事故で止まる時間が短くなる'}（費用 +20%）</small></span></label>`).join('');
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.from).name)} 〜 ${A.esc(Gm.nodeOf(g, B.to).name)}</b>：${K.name}</p>
      <div class="gseg groute">${['direct', 'detour'].map((k) => `<button class="btn small ${B.route === k ? 'on' : ''}" data-broute="${k}">${k === 'direct' ? 'まっすぐ' : '回り道'}<small>${r[k].km.toFixed(1)} km ・ 危険：${hazardText(r[k].hazards)}</small></button>`).join('')}</div>
      <p class="small">1回線で送れる量 ${kw(K.cap)} ・ いっぱいに流すと損失 ${(lossFull * 100).toFixed(1)}%${lossFull > 0.1 ? '（<b class="gneg">大きい</b>）' : ''}</p>
      ${opts ? `<details class="gopts"><summary>対策（${Object.values(B.opts).filter(Boolean).length}）</summary>${opts}</details>` : ''}
      ${q.ok && q.needSub.length ? `<p class="warn small">${q.needSub.map((x) => Gm.nodeOf(g, x).name).join('・')}に変電所がないと、この線はつながりません（建設 → 変圧器）。</p>` : ''}
      ${quoteHtml(q)}`;
    what = `${K.short}（${(q.km || 0).toFixed(1)} km）`;
    doBuild = () => Gm.buildLine(g, lc, { a: B.from, b: B.to, kind: B.lk, route: B.route, opts: { ...B.opts } });
  } else {
    q = Gm.quoteSub(g, lc, { town: B.town, mva: B.mva });
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.town).name)}</b>：変圧器</p>
      <div class="gseg gsizes">${Gm.SUB_SIZES.map((m) => `<button class="btn small ${m === B.mva ? 'on' : ''}" data-bmva="${m}">${m} MVA</button>`).join('')}</div>
      <p class="small">鉄損は容量の 0.5%（いつも）、銅損は全負荷で 1.5%（負荷率の2乗）。効率がいちばん高いのは負荷率 58% のあたり。120% を超えると故障しやすい。</p>
      ${quoteHtml(q)}`;
    what = `変圧器 ${B.mva} MVA`;
    doBuild = () => Gm.buildSub(g, lc, { town: B.town, mva: B.mva });
  }
  el.innerHTML = `${h}${q.ok ? '<button class="btn primary gwide" data-bgo>建設する</button>' : ''}`;
  const on = (s, ev, fn) => el.querySelectorAll(s).forEach((x) => x.addEventListener(ev, fn));
  on('[data-bsize]', 'click', (e) => ((B.size = Number(e.currentTarget.dataset.bsize)), drawBuildCard()));
  on('[data-bmva]', 'click', (e) => ((B.mva = Number(e.currentTarget.dataset.bmva)), drawBuildCard()));
  on('[data-broute]', 'click', (e) => ((B.route = e.currentTarget.dataset.broute), refreshBuild()));
  on('[data-bopt]', 'change', (e) => {
    B.opts[e.target.dataset.bopt] = e.target.checked;
    drawBuildCard();
    el.querySelector('.gopts')?.setAttribute('open', '');
  });
  on('[data-hz]', 'click', () => hzDialog(drawBuildCard));
  on('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
  on('[data-bgo]', 'click', () => pay(q, what, doBuild, () => (B = null)));
  fitMap();
}

// 建設の確認：コインが足りるかを見て、建て、台帳に書く
async function pay(q, what, doBuild, after) {
  if (balance() < q.cost) return A.toast(`コインが足りません（あと ${A.num(q.cost - balance())}）`);
  const r = doBuild();
  if (!r.ok) return A.toast(r.why);
  await spend(r.cost, what);
  A.toast(`${what}の工事を始めた（${DEV.on && balance() === Infinity ? '開発者モード：コインは減らない' : `${A.num(r.cost)} コイン`}）`);
  if (A.fx()) A.playNotes([[440, 0], [554.4, 0.08], [659.3, 0.16]]);
  after?.();
  await save();
  document.querySelector('.modal.gsheet')?.remove();
  await screen();
}

// ---- モーダルのシート（確認・選択が要るもの：周波数・撤去・進相コンデンサ・新しい島・経営再建・開発者モード） ----
function sheet(html, bind) {
  document.querySelector('.modal.gsheet')?.remove();
  const dlg = document.createElement('div');
  dlg.className = 'modal gsheet';
  dlg.innerHTML = `<div class="sheet">${html}<div class="actions"><button class="btn" data-close>閉じる</button></div></div>`;
  document.body.append(dlg);
  const close = () => dlg.remove();
  dlg.querySelector('[data-close]').onclick = close;
  dlg.addEventListener('click', (e) => e.target === dlg && close());
  const q = (sel) => dlg.querySelector(sel);
  const onAll = (sel, ev, fn) => dlg.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
  bind?.({ dlg, q, onAll, close });
  return dlg;
}
const stateOf = (x, t) => (x.readyAt > t ? `工事中（あと ${x.readyAt - t}時間）` : x.downUntil > t ? `修理中（あと ${x.downUntil - t}時間）` : null);
function plantState(g, p) {
  const t = g.t;
  const out = g.last?.plants[p.id] || 0;
  return stateOf(p, t) || (p.idle ? '休止' : p.hold > t ? '停電からの復旧待ち' : p.on ? `運転中 ${kw(out)}` : p.onAt != null ? `起動中（あと ${Math.max(1, p.onAt - t)}時間）` : '待機');
}

// ---- 地点のパネル（建設モードでないとき）：状態・需要・変電所・発電所、ここから建てる ----
function nodePanel(g, lc, id) {
  const t = g.t;
  const n = Gm.nodeOf(g, id);
  const plants = g.plants.filter((p) => p.site === id);
  const subs = g.subs.filter((x) => x.town === id);
  const loads = g.loads.filter((l) => l.town === id);
  const st = g.last?.towns[id];
  const incs = g.incidents.filter((i) => i.town === id || plants.some((p) => p.id === i.plant) || subs.some((x) => x.id === i.sub));
  let h = `<p class="small">${n.town ? '町' : n.hydro ? `水力の地点（使える水 ${kw(n.hydro)}${n.pond ? '・調整池を作れる' : ''}）` : '石炭火力の用地'} ・ 中央の町から ${Gm.distKm(g, 'T1', id) < 0.5 ? '0' : Gm.distKm(g, 'T1', id).toFixed(1)} km ・ この場所の危険：${hazardText(n.tags)}</p>`;
  if (incs.length) h += `<p class="warn small">事故の対処待ちがあります <button class="btn small" data-golist>一覧へ</button></p>`;
  if (n.town) {
    const rep = g.rep[id] ?? 1;
    h += `<h3>需要</h3>${loads.length ? loads.map((l) => `<p class="spread grow"><span>${Gm.LOADS[l.type].name} ${kw(l.kw)}${Gm.LOADS[l.type].pfFixed ? `（力率 ${l.cap ? Gm.LOADS[l.type].pfFixed : Gm.LOADS[l.type].pf}）` : ''}</span>${Gm.LOADS[l.type].pfFixed && !l.cap ? `<button class="btn small" data-cap="${l.id}">進相コンデンサ</button>` : ''}</p>`).join('') : '<p class="small">まだありません</p>'}
      ${st ? `<p class="small">いま ${kw(st.d)} ・ 届いている割合 ${pct(st.r)} ・ 町の信用 ${pct(rep)}${rep < 1 ? '（停電があると下がり、1か月で戻る）' : ''}</p>` : ''}
      <h3>変電所</h3>${subs.length ? subs.map((x) => `<p class="spread grow"><span>変圧器 ${x.mva} MVA ・ ${stateOf(x, t) || `使用率 ${pct(g.last?.subs[id] || 0)}`}</span><button class="btn small" data-rm="sub:${x.id}">撤去</button></p>`).join('') : '<p class="small">なし（11 kV 以上の送電線をつなぐには変電所が要る）</p>'}`;
  }
  h += `<h3>発電所</h3>${plants.length ? plants.map((p) => `<p class="spread grow"><span>${Gm.PLANTS[p.type].short} ${kw(p.kw)}${p.proto ? '（試作）' : ''} ・ ${plantState(g, p)}</span><button class="btn small" data-rm="plant:${p.id}">撤去</button></p>`).join('') : '<p class="small">なし</p>'}
    <div class="gbtns2">
      <button class="btn" data-bplant>発電所を建てる</button>
      <button class="btn" data-bline>ここから線を引く</button>
      ${n.town ? '<button class="btn" data-bsub>変圧器を置く</button>' : ''}
    </div>`;
  return {
    title: `${A.esc(n.name)}${n.town && n.era > g.era ? ' <span class="tag">まだ先の時代の町</span>' : ''}`,
    html: h,
    bind: ({ onAll }) => {
      onAll('[data-golist]', 'click', () => setPanel('list'));
      onAll('[data-bplant]', 'click', () => ((buildFor = { site: id }), setPanel('build')));
      onAll('[data-bline]', 'click', () => ((buildFor = { from: id }), setPanel('build')));
      onAll('[data-bsub]', 'click', () => {
        const s = typeStatus(learningNow(), 'sub', 'tr');
        if (!s.ok) return sheet(`<h2>変圧器はまだ置けません</h2>${whyHtml(s)}`, ({ onAll: on2 }) => on2('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo)));
        enterBuild('sub', 'tr', id);
      });
      onAll('[data-cap]', 'click', (e) => capDialog(e.currentTarget.dataset.cap));
      onAll('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':')));
    },
  };
}

// E2 の出来事：周波数の選択（以後その島の周波数になる）
function hzDialog(after) {
  sheet(
    `<h2>周波数を選ぶ</h2>
    <p>交流の発電機を、どこから買うか。<b>一度決めると、この島の周波数は変えられません</b>。</p>
    <div class="gbtns2">
      <button class="btn big" data-hz="50">ドイツ製<small>50 Hz</small></button>
      <button class="btn big" data-hz="60">アメリカ製<small>60 Hz</small></button>
    </div>
    <p class="small">明治の日本でも、東京はドイツ製（50 Hz）、大阪はアメリカ製（60 Hz）の発電機を入れたことが、今の東西の周波数の違いの始まり。1.5.0 ではどちらを選んでも性能は同じ（島どうしをつなぐときに効いてくる）。</p>`,
    ({ onAll, close }) =>
      onAll('[data-hz]', 'click', async (e) => {
        Gm.setHz(G(), Number(e.currentTarget.dataset.hz));
        Gm.addReport(G(), { title: `周波数を ${G().hz} Hz に決めた`, what: 'この島の交流の系統は、これからこの周波数で動く。', units: [] });
        await save();
        close();
        after();
      }),
  );
}

function capDialog(loadId) {
  const g = G(), lc = learningNow();
  const q = Gm.quoteCap(g, lc, loadId);
  sheet(
    `<h2>進相コンデンサ</h2>
    <p class="small">工場の力率を 0.75 から 0.95 に直す。同じ電力でも線を流れる電流が減り、損失と使用率が下がる。</p>
    ${q.ok ? `<p class="gquote"><b>${A.num(q.cost)} コイン</b>（残高 ${coinText(balance())}）</p><button class="btn primary gwide" data-build>付ける</button>` : whyHtml(q)}`,
    ({ onAll }) => {
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      onAll('[data-build]', 'click', () => pay(q, '進相コンデンサ', () => Gm.addCap(g, lc, loadId)));
    },
  );
}

function removeDialog(kind, id) {
  const g = G();
  const x = { plant: g.plants, line: g.lines, sub: g.subs }[kind].find((v) => v.id === id);
  if (!x) return;
  const name = kind === 'plant' ? `${Gm.PLANTS[x.type].short} ${kw(x.kw)}` : kind === 'line' ? Gm.lineName(g, x) : `変圧器 ${x.mva} MVA`;
  sheet(
    `<h2>撤去する</h2>
    <p>${A.esc(name)} を手放しますか。建設費の 30%（${yen(x.cost * 0.3)}）が<b>収益</b>に戻ります（コインは戻りません）。</p>
    <button class="btn gwide gwarn" data-ok>撤去する</button>`,
    ({ onAll, close }) =>
      onAll('[data-ok]', 'click', async () => {
        Gm.removeAsset(g, kind, id);
        await save();
        close();
        if (kind === 'line' && panel === `line:${id}`) panel = null;
        screen();
      }),
  );
}

// ---- 線のパネル：状態・増設・撤去 ----
function linePanel(g, lc, id) {
  const t = g.t;
  const l = g.lines.find((x) => x.id === id);
  const K = Gm.LINES[l.kind];
  const f = g.last?.lines[id];
  const hz = Gm.lineHazard(g, l, t, lc);
  const qc = Gm.quoteCircuit(g, lc, id);
  const optNames = Object.keys(l.opts).filter((k) => l.opts[k]).map((k) => Gm.LINE_OPTS[k].name);
  const dir = f?.p > 0 && f.to ? ` ・ 向き：${A.esc(Gm.nodeOf(g, f.to === l.a ? l.b : l.a).name)} → ${A.esc(Gm.nodeOf(g, f.to).name)}` : '';
  return {
    title: A.esc(Gm.lineName(g, l)),
    html: `<p class="small">${K.name} ・ ${l.km.toFixed(1)} km（${l.route === 'detour' ? '回り道' : 'まっすぐ'}）・ ${l.n}回線${l.proto ? ' ・ 試作' : ''}</p>
    <p class="small">状態：${stateOf(l, t) || (l.c1Until > t ? `1回線が修理中（あと ${l.c1Until - t}時間）` : '送電中')}${f ? ` ・ 流れ ${kw(f.p)} ・ 使用率 <b class="${f.util > 1 ? 'gneg' : ''}">${pct(f.util)}</b> ・ 損失 ${kw(f.loss)}${dir}` : ''}</p>
    <p class="small">危険：${hazardText(l.hazards)} ・ 対策：${optNames.length ? optNames.join('・') : 'なし'} ・ 故障の目安 1日あたり ${(hz.perDay * 100).toFixed(2)}%</p>
    <p class="small">送れる量を超えて 120% までは温度が上がるだけ（故障しやすくなる）。120% を2時間超えると保護装置で切れる。</p>
    <div class="gbtns2">
      <button class="btn" data-circ ${qc.ok ? '' : 'disabled'}>回線を増やす<small>${qc.ok ? `${A.num(qc.cost)} コイン` : A.esc(qc.why)}</small></button>
      <button class="btn" data-rm>撤去</button>
    </div>`,
    bind: ({ onAll }) => {
      onAll('[data-circ]', 'click', () => pay(qc, `${K.short}の回線の増設`, () => Gm.addCircuit(G(), learningNow(), id)));
      onAll('[data-rm]', 'click', () => removeDialog('line', id));
    },
  };
}

// ---- 運転のパネル：給電の優先順位・予備力の目標・点検・燃料 ----
function runPanel(g, lc) {
  const o = Gm.overview(g, lc);
  const order = g.priority.map((id) => g.plants.find((p) => p.id === id)).filter(Boolean);
  const plants = order
    .map((p, i) => {
      const D = Gm.PLANTS[p.type];
      const cost = D.coal ? `${(Gm.fuelPrice(g) / Gm.plantEff(p, lc)).toFixed(1)} 円/kWh` : '燃料なし';
      return `<div class="gitem gplant"><span class="gord"><button class="btn small" data-up="${p.id}" ${i === 0 || !lc.gate.econ ? 'disabled' : ''} aria-label="上へ">▲</button><b>${i + 1}</b><button class="btn small" data-down="${p.id}" ${i === order.length - 1 || !lc.gate.econ ? 'disabled' : ''} aria-label="下へ">▼</button></span>
        <span class="gpl"><b>${D.short} ${kw(p.kw)}${p.proto ? '（試作）' : ''}</b><small>${A.esc(Gm.nodeOf(g, p.site).name)} ・ ${plantState(g, p)} ・ ${cost}</small>
        <span><button class="btn small" data-idle="${p.id}">${p.idle ? '休止をやめる' : '休止する'}</button><button class="btn small" data-rm="plant:${p.id}">撤去</button></span></span></div>`;
    })
    .join('');
  return {
    title: '運転',
    html: `<h3>給電の優先順位</h3>
      <p class="small">番号の小さい順に使います。${lc.gate.econ ? '▲▼で並べ替え（燃料の安い順にすると得）' : '並べ替えは、電力系統工学「等増分燃料費」を1問正解すると使えます'}。直流の火力は、つないだ町の需要だけを先にまかないます。</p>
      ${!lc.gate.econ ? unitButtons(Gm.GATES.econ) : ''}
      ${plants || '<p class="note">発電所がありません</p>'}
      <h3>予備力の目標</h3>
      <label class="row"><input type="range" min="0" max="30" step="1" value="${Math.round(g.reserve * 100)}" data-reserve><b data-rv>${pct(g.reserve)}</b></label>
      <p class="small">需要のこの割合だけ、発電機の出力に余裕を残す（多いほど安全だが、燃料費は上がる）。いまの目標 ${kw(o.reserveKw)}${lc.gate.rel ? ` ・ 最大の発電機1台分 ${kw(o.biggest)}` : ''}</p>
      <h3>点検の方針</h3>
      <label class="row"><input type="radio" name="maint" value="normal" ${g.maint !== 'defer' ? 'checked' : ''}><span>ふつうに点検する<small>保守費：1日に建設費の 0.05%</small></span></label>
      <label class="row"><input type="radio" name="maint" value="defer" ${g.maint === 'defer' ? 'checked' : ''}><span>点検を延ばす<small>保守費は半分。故障は 2〜3 倍に増える</small></span></label>
      <h3>燃料（石炭）の買い方</h3>
      <label class="row"><input type="radio" name="fuel" value="contract" ${g.fuelPlan === 'contract' ? 'checked' : ''}><span>長期契約<small>値段は固定（いま ${g.fuel.contract.toFixed(2)} 円/kWh・熱）。1年ごとに見直し</small></span></label>
      <label class="row"><input type="radio" name="fuel" value="spot" ${g.fuelPlan === 'spot' ? 'checked' : ''}><span>スポット<small>毎日 ±30% で変わる（今日 ${g.fuel.spot.toFixed(2)}）。平均は長期契約の 0.85 倍</small></span></label>
      <p class="small">燃料費（円/kWh）＝値段 ÷ 熱効率。熱効率は、火力発電の単元の定着で上がる</p>`,
    bind: ({ $, onAll, g: gg }) => {
      const move = async (id, d) => {
        const i = gg.priority.indexOf(id);
        if (i < 0 || i + d < 0 || i + d >= gg.priority.length) return;
        [gg.priority[i], gg.priority[i + d]] = [gg.priority[i + d], gg.priority[i]];
        await save();
        drawPanel(true);
      };
      onAll('[data-up]', 'click', (e) => move(e.currentTarget.dataset.up, -1));
      onAll('[data-down]', 'click', (e) => move(e.currentTarget.dataset.down, 1));
      onAll('[data-idle]', 'click', async (e) => {
        const p = gg.plants.find((x) => x.id === e.currentTarget.dataset.idle);
        p.idle = !p.idle;
        await save();
        drawPanel(true);
      });
      onAll('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':')));
      onAll('[data-reserve]', 'input', (e) => ($('[data-rv]').textContent = `${e.target.value}%`));
      onAll('[data-reserve]', 'change', async (e) => {
        gg.reserve = Number(e.target.value) / 100;
        await save();
        drawPanel(true);
      });
      onAll('input[name=fuel]', 'change', async (e) => ((gg.fuelPlan = e.target.value), await save()));
      onAll('input[name=maint]', 'change', async (e) => ((gg.maint = e.target.value), await save()));
    },
  };
}

// ---- 需給のパネル：グラフ・いまの系統（開発者モードでは1日の収益の内訳と発電所ごとの出力・効率も） ----
function supplyPanel(g, lc) {
  const o = Gm.overview(g, lc);
  const hs = g.hist.slice(-72);
  const W = 340, H = 150;
  const ev = g.events.filter((e) => e.until > g.t);
  let chart = '<p class="note">まだ記録がありません</p>';
  if (hs.length > 1) {
    const max = Math.max(1e-9, ...hs.map((h) => Math.max(h[1], h[3] + h[4] + h[5]))) * 1.1;
    const X = (i) => (i / (hs.length - 1)) * W;
    const Y = (v) => H - (v / max) * H;
    const area = (lo, hi) => `M${hs.map((h, i) => `${X(i).toFixed(1)},${Y(hi(h)).toFixed(1)}`).join(' L')} L${hs.map((h, i) => `${X(hs.length - 1 - i).toFixed(1)},${Y(lo(hs[hs.length - 1 - i])).toFixed(1)}`).join(' L')}Z`;
    const line = (f) => `M${hs.map((h, i) => `${X(i).toFixed(1)},${Y(f(h)).toFixed(1)}`).join(' L')}`;
    const days = hs.map((h, i) => (h[0] % 24 === 0 ? `<line x1="${X(i)}" x2="${X(i)}" y1="0" y2="${H}" stroke="var(--line)" stroke-width="1"/>` : '')).join('');
    chart = `<svg class="gchart" viewBox="0 -4 ${W} ${H + 8}" role="img" aria-label="需要と電源ごとの出力">${days}
        <path d="${area(() => 0, (h) => h[5])}" fill="var(--ghydro)" opacity=".85"/>
        <path d="${area((h) => h[5], (h) => h[5] + h[4])}" fill="var(--gcoal)" opacity=".85"/>
        <path d="${area((h) => h[5] + h[4], (h) => h[5] + h[4] + h[3])}" fill="var(--gdc)" opacity=".85"/>
        <path d="${line((h) => h[1])}" fill="none" stroke="var(--text)" stroke-width="1.6"/>
        <path d="${line((h) => h[2])}" fill="none" stroke="var(--ok)" stroke-width="1.2" stroke-dasharray="3 3"/>
      </svg>
      <p class="legend"><span><i class="gl-hydro"></i>水力</span><span><i class="gl-coal"></i>石炭火力（交流）</span><span><i class="gl-dc"></i>直流の火力</span><span><i class="gl-dem"></i>需要</span><span>緑の点線＝届いた分</span><span>縦線＝0時 ・ 上端 ${kw(max)}</span></p>`;
    if (g.hz) {
      const FH = 70, r = 2.2;
      const FY = (x) => FH / 2 - (Math.max(-r, Math.min(r, x)) / r) * (FH / 2);
      const band = (a, b, col) => `<rect x="0" y="${FY(b)}" width="${W}" height="${FY(a) - FY(b)}" fill="${col}"/>`;
      chart += `<h3>周波数（${g.hz} Hz からのずれ）</h3>
        <svg class="gchart" viewBox="0 0 ${W} ${FH}" role="img" aria-label="周波数のずれ">${band(-Gm.FREQ.ok, Gm.FREQ.ok, 'var(--ok-bg)')}
          <line x1="0" x2="${W}" y1="${FY(-Gm.FREQ.shed1)}" y2="${FY(-Gm.FREQ.shed1)}" stroke="var(--idk)" stroke-dasharray="3 3"/>
          <line x1="0" x2="${W}" y1="${FY(-Gm.FREQ.black)}" y2="${FY(-Gm.FREQ.black)}" stroke="var(--ng)" stroke-dasharray="3 3"/>
          <path d="M${hs.map((h, i) => `${X(i).toFixed(1)},${FY(h[6]).toFixed(1)}`).join(' L')}" fill="none" stroke="var(--text)" stroke-width="1.4"/></svg>
        <p class="legend"><span><i class="gl-okband"></i>±0.2 Hz 以内＝正常</span><span>黄の点線＝−0.8 Hz（負荷遮断）</span><span>赤の点線＝−2.0 Hz（全域停電）</span></p>`;
    } else chart += '<p class="note">直流のあいだは周波数がありません。足りないときは電圧が下がり、電灯が暗くなります。</p>';
  }
  const K = g.last?.K || 0;
  const topOut = Math.max(0, ...g.plants.filter((p) => Gm.PLANTS[p.type].ac).map((p) => g.last?.plants[p.id] || 0));
  const l = g.last;
  return {
    title: '需給',
    html: `${ev.length ? `<div class="gev">${ev.map((e) => `<p class="gevrow">${pic(e.key, 'mini')}<span><b>${Gm.EVENTS[e.key].name}</b><small>${Gm.EVENTS[e.key].text}（あと ${Math.ceil((e.until - g.t) / 24)}日）</small></span></p>`).join('')}</div>` : ''}
      ${l ? `<p class="small">いま：需要 ${kw(l.demand)} ・ 届いた ${kw(l.served)} ・ 損失 ${kw(l.loss)}${g.hz ? ` ・ 周波数 ${(g.hz + l.x).toFixed(2)} Hz` : ''} ・ ${gridState(g).text}</p>` : ''}
      <h3>需要と電源（直近 ${hs.length}時間）</h3>
      ${chart}
      ${DEV.on ? devSupplyHtml(g, lc) : ''}
      <h3>いまの系統</h3>
      <p class="spread grow"><span>需要の上限（学習で決まる）</span><b>${kw(o.dmax)}</b></p>
      <p class="small">Lv ${lc.level} ・ 定着 ${lc.mastered}問。お金では増えない。レベルと定着で広がる</p>
      <p class="spread grow"><span>受けている需要（契約）</span><b>${kw(o.accepted)}</b></p>
      <p class="spread grow"><span>これから24時間のピーク（予測）</span><b>${kw(o.peak)}</b></p>
      <p class="spread grow"><span>使える発電機の合計</span><b class="${o.cap < o.peak ? 'gneg' : ''}">${kw(o.cap)}</b></p>
      <p class="spread grow"><span>予備力の目標（${pct(g.reserve)}）</span><b>${kw(o.reserveKw)}</b></p>
      ${lc.gate.rel ? `<p class="small">最大の発電機1台分は ${kw(o.biggest)}。${o.reserveKw >= o.biggest ? '1台止まっても埋められる（N-1）' : '<b class="gneg">1台止まると埋めきれない</b>'}</p>` : `<p class="small">電力系統工学「信頼度指標」を1問正解すると、予備力の目安（最大の発電機1台分との比較）が出ます</p>`}
      ${g.hz && K ? `<p class="spread grow"><span>系統定数 K</span><b>${kw(K)}/Hz</b></p><p class="small">Δf＝−ΔP/K。いまいちばん出力の大きい発電機（${kw(topOut)}）が止まると、余裕が足りていれば ${(topOut / K).toFixed(2)} Hz 下がる</p>` : ''}`,
  };
}
// 開発者モード：数値を確かめやすいように、1日の収益の内訳と発電所ごとの出力・効率
function devSupplyHtml(g, lc) {
  const d = Dv.moneyDay(DEV.state.money);
  const rows = g.plants.map((p) => {
    const D = Gm.PLANTS[p.type];
    const out = g.last?.plants[p.id] || 0;
    return `<p class="spread grow"><span>${D.short} ${kw(p.kw)}（${A.esc(Gm.nodeOf(g, p.site).name)}）<small> ${plantState(g, p)}</small></span><small>出力 ${kw(out)}（${pct(p.kw ? out / p.kw : 0)}）${D.coal ? ` ・ 効率 ${(Gm.plantEff(p, lc) * 100).toFixed(1)}%` : ''}</small></p>`;
  }).join('');
  return `<div class="gdevbox"><h3>開発者モード：直近 ${d.hours}時間の収益の内訳</h3>
    <p class="spread grow"><span>料金（売電）</span><b>${yen(d.rev)}</b></p>
    <p class="spread grow"><span>燃料費</span><b>−${yen(d.fuel)}</b></p>
    <p class="spread grow"><span>保守費</span><b>−${yen(d.maint)}</b></p>
    ${d.repair ? `<p class="spread grow"><span>修理費</span><b>−${yen(d.repair)}</b></p>` : ''}${d.loan ? `<p class="spread grow"><span>返済</span><b>−${yen(d.loan)}</b></p>` : ''}
    <p class="spread grow"><span>利益</span><b class="${d.profit < 0 ? 'gneg' : ''}">${yen(d.profit)}</b></p>
    <h3>発電所ごとの出力・効率</h3>${rows || '<p class="note">発電所がありません</p>'}</div>`;
}

// ---- 一覧のパネル：事故・申し込み・発電所と線の一覧・報告書 ----
function listPanel(g, lc) {
  const t = g.t;
  const incs = g.incidents.map((i) => `<div class="gitem"><p class="spread"><b>${A.esc(Gm.INCIDENTS[i.key].title)}</b><small>あと ${Math.max(0, i.deadline - t)}時間</small></p><p class="small">${A.esc(i.what || '')}</p><button class="btn primary" data-inc="${i.id}">対処を選ぶ</button></div>`).join('');
  const apps = g.apps
    .map((a) => {
      const p = Gm.previewApp(g, lc, a.id);
      const n = Gm.nodeOf(g, a.town);
      const warn = [!p.reach ? 'この町には、まだ電気が届かない' : '', p.reach && p.margin < g.reserve ? `供給の余裕が小さい（${pct(p.margin)}）` : '', p.line > 1 ? `線の使用率 ${pct(p.line)}` : '', p.sub > 1 ? `変圧器の使用率 ${pct(p.sub)}` : ''].filter(Boolean);
      return `<div class="gitem"><p class="spread"><b>${A.esc(n.name)}：${Gm.LOADS[a.type].name} ${kw(a.kw)}</b><small>${Gm.LOADS[a.type].rate} 円/kWh</small></p>
        <p class="small">受けたときの見込み（${p.hour}時ごろのピーク）：供給の余裕 ${pct(p.margin)} ・ 線の使用率 最大 ${pct(p.line)}${p.sub ? ` ・ 変圧器 ${pct(p.sub)}` : ''}${Gm.LOADS[a.type].pf < 1 ? ' ・ 力率 0.75（進相コンデンサで直せる）' : ''}</p>
        ${warn.length ? `<p class="warn small">${warn.join(' ・ ')}</p>` : ''}
        <button class="btn primary" data-accept="${a.id}">受ける</button><span class="small">保留のままでも罰はありません</span></div>`;
    })
    .join('');
  const order = g.priority.map((id) => g.plants.find((p) => p.id === id)).filter(Boolean);
  const plants = order.map((p) => `<button class="gitem grow2" data-gonode="${p.site}"><span><b>${Gm.PLANTS[p.type].short} ${kw(p.kw)}${p.proto ? '（試作）' : ''}</b><small>${A.esc(Gm.nodeOf(g, p.site).name)} ・ ${plantState(g, p)}</small></span><span class="go">›</span></button>`).join('');
  const lines = g.lines.map((l) => `<button class="gitem grow2" data-goline="${l.id}"><span><b>${A.esc(Gm.lineName(g, l))}</b><small>${l.km.toFixed(1)} km・${l.n}回線 ・ ${stateOf(l, t) || `使用率 ${pct(g.last?.lines[l.id]?.util || 0)}`}</small></span><span class="go">›</span></button>`).join('');
  const subs = g.subs.map((x) => `<button class="gitem grow2" data-gonode="${x.town}"><span><b>${A.esc(Gm.nodeOf(g, x.town).name)}の変圧器 ${x.mva} MVA</b><small>${stateOf(x, t) || `使用率 ${pct(g.last?.subs[x.town] || 0)}`}</small></span><span class="go">›</span></button>`).join('');
  const reports = g.reports
    .slice(0, 15)
    .map((r) => `<div class="gitem grep${r.ok === true ? ' ok' : r.ok === false ? ' ng' : ''}"><p class="spread"><b>${A.esc(r.title)}</b><small>${timeLabel({ t: r.t })}</small></p><p class="small">${A.esc(r.what)}${r.why ? `<br>なぜ：${A.esc(r.why)}` : ''}</p>${unitButtons(r.units || [])}</div>`)
    .join('');
  return {
    title: '一覧',
    html: `<h3>事故（対処待ち ${g.incidents.length}／最大 ${Gm.MAX_INCIDENTS}件）</h3>${incs || '<p class="note">いまはありません</p>'}
      <p class="small">正しく対処すると被害が小さく、誤ると大きくなります。ゲームの1日（現実の1時間）答えなければ、標準の被害で片づきます。</p>
      <h3>接続の申し込み（${g.apps.length}件）</h3>${apps || `<p class="note">${Gm.overview(g, lc).accepted >= lc.dmax - 1 ? '需要の上限に達しています。レベルと定着が増えると、また届きます' : 'いまはありません（1日に1件ほど届きます）'}</p>`}
      <h3>発電所（${g.plants.length}）</h3>${plants || '<p class="note">ありません</p>'}
      <h3>送電線・配電線・変電所（${g.lines.length + g.subs.length}）</h3>${lines + subs || '<p class="note">まだありません（建設から建てます）</p>'}
      <h3>報告書</h3>${reports || '<p class="note">まだありません</p>'}`,
    bind: ({ onAll, g: gg }) => {
      onAll('[data-inc]', 'click', (e) => incidentScreen(e.currentTarget.dataset.inc));
      onAll('[data-accept]', 'click', async (e) => {
        Gm.acceptApp(gg, e.currentTarget.dataset.accept);
        await save();
        drawPanel(true);
        live();
      });
      onAll('[data-gonode]', 'click', (e) => setPanel(`node:${e.currentTarget.dataset.gonode}`));
      onAll('[data-goline]', 'click', (e) => setPanel(`line:${e.currentTarget.dataset.goline}`));
    },
  };
}

// ---- 経営のパネル：収益の推移・時代と学習・記録・新しい島・経営再建・そのほか・バージョン番号（開発者モードの入口） ----
function managePanel(g, lc) {
  const gates = Object.keys(Gm.GATES)
    .map((k) => `<p class="spread grow"><span>${lc.gate[k] ? '<span class="tag ok">1問正解</span>' : '<span class="tag">まだ</span>'}${Gm.GATE_NAMES[k]}</span><small>性能 ${pct(lc.perf[k] || 0)}</small></p>`)
    .join('');
  const bps = Object.entries(Gm.BLUEPRINTS).map(([k, b]) => `<span class="tag ${lc.blueprint[k] ? 'ok' : ''}">${b.name}${lc.blueprint[k] ? '' : '（まだ）'}</span>`).join('');
  const yr = g.yr;
  const yrow = (y, label) => `<p class="spread grow"><span>${label}</span><small>利益 ${yen(y.profit)} ・ 停電 ${Math.round(y.unserved).toLocaleString('ja-JP')} kWh ・ 周波数が正常 ${y.hours ? pct(y.okH / y.hours) : '—'}</small></p>`;
  const eras = Gm.ERAS.map((e) => `<span class="tag ${e.n <= g.era ? 'ok' : ''}">${e.name} Lv${e.level}${e.n > Gm.MAX_ERA ? '（これから）' : ''}</span>`).join('');
  // 収益の推移：今年と過去の年の利益（棒）
  const ys = [...g.years.slice(-5), { ...yr, now: true }];
  const maxP = Math.max(1, ...ys.map((y) => Math.abs(y.profit)));
  const bars = ys.map((y) => `<span class="gyb${y.profit < 0 ? ' neg' : ''}${y.now ? ' now' : ''}"><i style="height:${Math.max(2, Math.round((Math.abs(y.profit) / maxP) * 56))}px"></i><small>${y.idx + 1}年目${y.now ? '（途中）' : ''}</small></span>`).join('');
  return {
    title: '経営',
    html: `<p class="spread grow"><span>収益の残高</span><b class="${g.yen < 0 ? 'gneg' : ''}">${yen(g.yen)}</b></p>
      ${g.loanUntil > g.t ? `<p class="small">借入れの返済中（あと ${Math.ceil((g.loanUntil - g.t) / 24)}日。収入の 20%）</p>` : ''}
      ${g.rebuild ? '<button class="btn primary gwide gwarn" data-rebuild2>経営再建：手放すか、借入れを選ぶ</button>' : ''}
      <h3>収益の推移（年ごとの利益）</h3>
      <div class="gyears">${bars}</div>
      ${yrow(yr, `${yr.idx + 1}年目（途中）`)}
      ${[...g.years].reverse().map((y) => yrow(y, `${y.idx + 1}年目`)).join('')}
      ${g.best ? `<p class="small">この島の最高の年間利益：${yen(g.best.profit)}</p>` : ''}
      <h3>時代と学習</h3>
      <p class="gtags">${eras}</p>
      <p class="small">時代はレベルで進む（いま Lv ${lc.level}）。次の時代の設備は「試作」として先取りできる（建設費3倍・故障率3倍）</p>
      ${gates}
      <p class="small">関係する単元で1問正解すると、建設できる（使える）ようになる。性能＝その単元の定着の割合（これまでの最大値。下がらない）。熱効率・故障の少なさ・工期に効く</p>
      <h3>設計図</h3><p class="gtags">${bps}</p>
      <p class="small">その単元の試験レベルに正解するか、関係する外部試験で満点の3割以上</p>
      <h3>島</h3>
      <p class="small">島 ${g.islandNo}（${Gm.TERRAINS[g.terrain].name}）${g.hz ? ` ・ 周波数 ${g.hz} Hz` : ' ・ 周波数はまだ決めていない'} ・ ${Math.floor(g.t / 24)}日目</p>
      ${(g.past || []).length ? `<p class="small">前の島：${g.past.map((p) => `島 ${p.islandNo}（${Gm.TERRAINS[p.terrain]?.name || ''}）${Math.floor(p.hours / 24)}日・最高の年間利益 ${p.best ? yen(p.best.profit) : '—'}`).join(' ／ ')}</p>` : ''}
      <p class="small">いつでも、明治の小さな島からやり直せます。時代（レベル）・設計図・性能の上乗せは引き継ぎ、この島の記録は残ります。この島の設備と収益はなくなり、使ったコインは戻りません。</p>
      <button class="btn" data-newisland>新しい島を選ぶ</button>
      <h3>そのほか</h3>
      <p class="small">テーマ（シンプル／演出あり）は、ホームの「出題対象の設定」で変えられます。演出ありでは、建設・時代が進んだとき・全域停電からの復旧に音と光が付きます。</p>
      ${versionHtml()}`,
    bind: ({ onAll }) => {
      onAll('[data-rebuild2]', 'click', rebuildDialog);
      onAll('[data-newisland]', 'click', islandDialog);
      bindVersion(onAll);
    },
  };
}

// ---- 事故の問題：選択肢4つ。「わからない」は出さない。回答は回答記録（mode「系統」のセッション）に入れる。開発者モードでは残さない ----
function incidentScreen(id) {
  const { S } = A;
  const g = G();
  const inc = g.incidents.find((x) => x.id === id);
  const q = inc && S.data.questions.find((x) => x.questionId === inc.qid);
  if (!q) return screen('list');
  const order = L.shuffle(q.choices);
  A.show(
    `<header class="top"><button class="back" data-back>‹ 系統</button><h1>事故の対処</h1></header>
    ${devBand()}
    <section class="card gincident"><p class="spread"><b>${A.esc(Gm.INCIDENTS[inc.key].title)}</b><span class="lv lv-${q.level}">${q.level}</span></p><p class="small">${A.esc(inc.what || '')}</p></section>
    ${A.figureHtml(q)}
    <div class="stem">${A.rich(q.stem)}</div>
    <div class="choices">
      ${order.map((c, i) => `<button class="choice" data-choice="${A.esc(c.choiceId)}"><span class="mark">${'ABCD'[i]}</span><span>${A.rich(c.text)}</span></button>`).join('')}
    </div>
    <p class="note center">正しく対処すると被害が小さく、誤ると大きくなります（「わからない」はありません）</p>`,
    () => {
      A.bindFigureZoom();
      bindDevBand();
      A.on('[data-back]', 'click', () => screen('list'));
      A.on('[data-choice]', 'click', (e) => {
        A.primeAudio();
        answerIncident(inc, q, order, e.currentTarget.dataset.choice);
      });
    },
  );
}

async function answerIncident(inc, q, order, choiceId) {
  const { S } = A;
  const g = G();
  const now = new Date();
  const correct = choiceId === q.correctChoiceId;
  const result = correct ? '正解' : '不正解';
  // 開発者モードでは回答記録・復習状態・セッションに残さない（正誤だけをゲームに反映する）
  let rec = null;
  if (!DEV.on) {
    if (!gridSession) {
      gridSession = { sessionId: A.uid(), mode: '系統', scope: null, startedAt: now.toISOString(), endedAt: null };
      S.sessions.push(gridSession);
    }
    gridSession.endedAt = now.toISOString();
    const log = { logId: A.uid(), questionId: q.questionId, sessionId: gridSession.sessionId, questionRevision: q.revision, answeredAt: now.toISOString(), result, selectedChoiceId: choiceId };
    rec = { log, state: L.nextReviewState(S.states[q.questionId], q.questionId, result, now, S.settings.intervals), session: gridSession };
  }
  const saved = rec ? store.answer(rec) : null;
  const text = Gm.resolveIncident(g, inc.id, correct);
  if (correct && A.fx()) A.playNotes([[880, 0], [1318.5, 0.08]]);
  A.show(
    `<header class="top"><h1>事故の対処</h1></header>
    ${devBand()}
    <div class="verdict ${correct ? 'ok' : 'ng'}">${correct ? '正しく対処した' : '対処を誤った'}</div>
    <section class="card geffect"><p>${A.esc(text || '')}</p>${DEV.on ? '<p class="small">開発者モード：回答記録には残りません</p>' : correct ? '<p class="small">コイン +100（同じ問題は1日1回まで）</p>' : ''}</section>
    <div class="choices done">
      ${order.map((c, i) => `<div class="choice ${c.choiceId === q.correctChoiceId ? `correct${correct ? ' flash' : ''}` : c.choiceId === choiceId ? 'wrong' : ''}"><span class="mark">${'ABCD'[i]}</span><span>${A.rich(c.text)}</span></div>`).join('')}
    </div>
    <section class="card expl"><h2>解説</h2><p>${A.rich(q.explanation)}</p></section>
    ${q.trivia ? `<section class="card trivia"><h2>豆知識</h2><p>${A.rich(q.trivia)}</p></section>` : ''}
    <section class="info"><p><b>${A.esc(q.title)}</b></p><p class="src">${A.esc(q.questionId)} 第${q.revision}版 ・ 系統の事故（おまかせ・さっと出題には出ません）</p></section>
    ${unitButtons(Gm.INCIDENTS[inc.key].units)}
    <div class="actions sticky"><button class="btn" data-report>疑問がある</button><button class="btn primary big" data-next>${g.incidents.length ? '次の事故へ' : '系統に戻る'}</button></div>`,
    () => {
      bindDevBand();
      A.on('[data-report]', 'click', () => A.reportDialog(q));
      A.on('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      A.on('[data-next]', 'click', () => screen('list'));
    },
  );
  await saved;
  await save();
  if (rec) await A.syncCollection();
}

function islandDialog() {
  sheet(
    `<h2>新しい島</h2>
    ${pic('island', 'wide')}
    <p class="warn small">いまの島の設備と収益はなくなります（記録は残ります）。</p>
    ${Object.entries(Gm.TERRAINS).map(([k, T]) => `<button class="btn gwide" data-terrain="${k}">${T.name}<small>${T.desc}</small></button>`).join('')}`,
    ({ onAll, close }) =>
      onAll('[data-terrain]', 'click', async (e) => {
        const now = Date.now();
        store.setGrid(Gm.newIsland(G(), e.currentTarget.dataset.terrain, now, (now % 2147483647) | 0));
        lcCache = null;
        G().era = learningNow().era;
        summary = null;
        B = null;
        await save();
        close();
        A.toast('新しい島で、明治から始めます');
        screen(null);
      }),
  );
}

// 経営再建：手放す設備を選ぶ（建設費の 30% が収益に戻る）か、借入れ
function rebuildDialog() {
  const g = G();
  const items = [...g.plants.map((p) => ['plant', p.id, `${Gm.PLANTS[p.type].short} ${kw(p.kw)}`, p.cost]), ...g.lines.map((l) => ['line', l.id, Gm.lineName(g, l), l.cost]), ...g.subs.map((x) => ['sub', x.id, `${Gm.nodeOf(g, x.town).name}の変圧器 ${x.mva} MVA`, x.cost])];
  sheet(
    `<h2>経営再建</h2>
    ${pic('rebuild', 'wide')}
    <p>収益の残高がマイナスのまま3日たちました（いま <b class="gneg">${yen(g.yen)}</b>）。どちらかを選びます。時代・設計図・性能の上乗せは残ります。</p>
    <h3>借入れ</h3>
    <p class="small">残高を 0 に戻し、これから30日間、収入の 20% を返済に回す。</p>
    <button class="btn primary gwide" data-loan>借入れをする</button>
    <h3>設備を手放す</h3>
    <p class="small">選んだ設備の建設費の 30% が収益に戻る。残高が 0 以上になれば再建は終わり。</p>
    ${items.map(([k, id, name, cost]) => `<label class="row"><input type="checkbox" data-sell="${k}:${id}"><span>${A.esc(name)}<small>+${yen(cost * 0.3)}</small></span></label>`).join('')}
    <button class="btn gwide" data-sellgo>選んだ設備を手放す</button>`,
    ({ dlg, onAll, close }) => {
      onAll('[data-loan]', 'click', async () => {
        Gm.rebuildLoan(g);
        Gm.addReport(g, { title: '借入れをした', what: '残高を 0 に戻した。30日間、収入の 20% を返済に回す。', units: [] });
        await save();
        close();
        screen();
      });
      onAll('[data-sellgo]', 'click', async () => {
        const sel = [...dlg.querySelectorAll('[data-sell]:checked')].map((x) => x.dataset.sell.split(':'));
        if (!sel.length) return A.toast('手放す設備を選んでください');
        const back = Gm.rebuildSell(g, sel);
        Gm.addReport(g, { title: '設備を手放した', what: `${sel.length}件を手放し、${yen(back)} が収益に戻った。`, units: [] });
        await save();
        close();
        screen();
        if (g.rebuild) A.toast('まだ残高がマイナスです');
      });
    },
  );
}

// ---- 開発者モード（1.5.1）：経営のパネルのバージョン番号を5回押すと入る。本番とは別の系統（kv「gridDev」）で動かす ----
function versionHtml() {
  return `<p class="note center"><button class="link gver" data-ver>版 ${A.esc(window.APP_VERSION || '')}</button></p>`;
}
function bindVersion(onAll) {
  onAll('[data-ver]', 'click', () => {
    if (DEV.on) return devSheet();
    const now = Date.now();
    DEV.taps = now - DEV.tapAt < 1500 ? DEV.taps + 1 : 1;
    DEV.tapAt = now;
    if (DEV.taps >= 5) {
      DEV.taps = 0;
      enterDevDialog();
    } else if (DEV.taps >= 3) A.toast(`あと ${5 - DEV.taps} 回で開発者モード`);
  });
}
function enterDevDialog() {
  sheet(
    `<h2>開発者モードに入る</h2>
    <p>本番とは別の系統で、コイン無制限・学習の条件を無視・早送り・時代やレベルの選択・事故と出来事をすぐ起こす、などを試せます。</p>
    <p class="small">本番の系統・回答記録・コイン・称号・カレンダー・継続日数には一切書きません。バックアップにも入りません。抜けると本番の系統に戻り、開発者の系統は次に入ったときの続きになります。</p>
    <button class="btn primary gwide" data-devin>入る</button>`,
    ({ onAll, close }) => onAll('[data-devin]', 'click', async () => (close(), enterDev())),
  );
}
async function enterDev() {
  const now = Date.now();
  DEV.state = Dv.normalize(DEV.state || (await A.db.getKV(Dv.DEV_KEY)), now);
  DEV.state.grid.realAt = now; // 開発者の系統は、入っている間だけ進む
  DEV.on = true;
  summary = null;
  B = null;
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  await save();
  A.toast('開発者モードに入った');
  screen(null);
}
async function exitDev() {
  if (DEV.running) return A.toast('早送りの途中です');
  await save();
  DEV.on = false;
  summary = null;
  B = null;
  document.querySelector('.modal.gsheet')?.remove();
  await sync();
  A.toast('本番の系統に戻った');
  screen(null);
}
const devSpeedText = () => `${DEV.state.opts.speed ? `×${DEV.state.opts.speed}` : '停止中'} ・ 操作`;
function devBand() {
  if (!DEV.on) return '';
  return `<div class="gdevband"><span><b>開発者モード</b><small>本番の記録には影響しません</small></span>
    <span class="gdevbtns"><button class="btn small" data-devops>${devSpeedText()}</button><button class="btn small" data-devout>抜ける</button></span></div>`;
}
function bindDevBand() {
  A.on('[data-devops]', 'click', devSheet);
  A.on('[data-devout]', 'click', exitDev);
}
// 現実の時刻に合わせて開発者の系統を進める（×10・×100 は1秒ごとに見る）
async function devTick() {
  if (!DEV.on || DEV.running || document.hidden || !A?.S.data) return;
  const g = G();
  const n = Dv.dueSteps(g, Date.now(), DEV.state.opts.speed);
  if (!n) return;
  Dv.advance(g, learningNow(), n, DEV.state.money);
  if (Date.now() - DEV.savedAt > 5000) {
    DEV.savedAt = Date.now();
    save();
  }
  if (idle()) live();
  else devSheetLive();
}
const devSheetLive = () => {
  const el = document.querySelector('.modal.gsheet [data-devclock]');
  if (el) el.textContent = `${timeLabel(G())} ・ 島 ${G().islandNo}（${Gm.TERRAINS[G().terrain].name}）`;
};
function devSheet() {
  const g = G(), o = DEV.state.opts, real = learningReal(), lc = learningNow();
  const perfNow = Math.round((o.perf ?? 0) * 100);
  const incs = Object.entries(Gm.INCIDENTS).map(([k, D]) => `<option value="${k}">${A.esc(D.title)}</option>`).join('');
  const evs = Object.entries(Gm.EVENTS).map(([k, E]) => `<option value="${k}">${A.esc(E.name)}（${A.esc(E.text)}）</option>`).join('');
  sheet(
    `<h2>開発者モードの操作</h2>
    <p class="small" data-devclock>${timeLabel(g)} ・ 島 ${g.islandNo}（${Gm.TERRAINS[g.terrain].name}）</p>
    <h3>時間</h3>
    <div class="gseg">${Dv.SPEEDS.map((v) => `<button class="btn small ${o.speed === v ? 'on' : ''}" data-speed="${v}">${v ? `×${v}` : '一時停止'}</button>`).join('')}</div>
    <div class="gseg"><button class="btn small" data-jump="day">1日進める</button><button class="btn small" data-jump="week">1週間進める</button><button class="btn small" data-jump="year">1年進める</button></div>
    <div class="gprog" data-prog hidden><i></i><span></span></div>
    <h3>コイン</h3>
    <label class="row"><input type="checkbox" data-coins ${o.coins === 'unlimited' ? 'checked' : ''}><span>コイン無制限<small>建てても残高が減らない。外すと、開発者モードだけの残高から引く（本番のコインは使わない）</small></span></label>
    ${o.coins === 'unlimited' ? '' : `<label class="row"><span>開発者モードの残高</span><input type="number" min="0" step="1000" value="${Math.round(o.devCoins)}" data-devcoins class="gnum"></label>`}
    <h3>学習</h3>
    <label class="row"><input type="checkbox" data-gates ${o.ignoreGates ? 'checked' : ''}><span>学習の条件を無視<small>すべての種類が建てられる（建設の条件・設計図をすべて開く）</small></span></label>
    <label class="row"><input type="checkbox" data-perfon ${o.perf != null ? 'checked' : ''}><span>性能の単元の定着の割合を選ぶ<small>外すと本番の記録の値（熱効率・故障・工期などに効く）</small></span></label>
    ${o.perf != null ? `<label class="row"><input type="range" min="0" max="100" step="5" value="${perfNow}" data-perf><b data-perfv>${perfNow}%</b></label>` : ''}
    <h3>時代とレベル</h3>
    <label class="row"><span>レベル</span><input type="number" min="1" max="60" value="${o.level ?? real.level}" data-level class="gnum"></label>
    <label class="row"><span>時代</span><select data-era><option value="">レベルから決める</option>${Gm.ERAS.filter((e) => e.n <= Gm.MAX_ERA).map((e) => `<option value="${e.n}" ${o.era === e.n ? 'selected' : ''}>${e.id} ${e.name}</option>`).join('')}</select></label>
    <label class="row"><span>定着の問題数</span><input type="number" min="0" max="5000" value="${o.mastered ?? real.mastered}" data-mastered class="gnum"></label>
    <p class="small">いま：Lv ${lc.level} ・ ${eraName(lc.era)} ・ 定着 ${lc.mastered}問 ・ 需要の上限 ${kw(lc.dmax)}（本番の記録は Lv ${real.level}・定着 ${real.mastered}問）</p>
    <button class="btn small" data-devreal>本番の記録の値に戻す</button>
    <h3>事故・出来事をすぐ起こす</h3>
    <div class="grow gpick"><select data-inckey>${incs}</select><button class="btn small" data-incgo>起こす</button></div>
    <div class="grow gpick"><select data-evkey>${evs}</select><button class="btn small" data-evgo>起こす</button></div>
    <p class="small">事故の問題も解けます（回答記録には残りません。正誤だけをゲームに反映します）。対象の設備がなければ、対象なしで起きます。</p>
    <h3>系統のリセット</h3>
    <div class="gseg">${Object.entries(Gm.TERRAINS).map(([k, T]) => `<button class="btn small" data-devreset="${k}">${T.name}</button>`).join('')}</div>
    <p class="small">選んだ地形で、開発者の系統を最初からやり直します（本番の系統は変わりません）。</p>`,
    ({ q: $, onAll, close }) => {
      const set = async (patch) => {
        Object.assign(o, patch);
        const l2 = learningNow();
        if (l2.era < G().era) G().era = l2.era;
        else Gm.applyLearning(G(), l2);
        await save();
        close();
        await screen();
        devSheet();
      };
      onAll('[data-speed]', 'click', (e) => {
        G().realAt = Date.now();
        set({ speed: Number(e.currentTarget.dataset.speed) });
      });
      onAll('[data-jump]', 'click', (e) => devJump(e.currentTarget.dataset.jump, $));
      $('[data-coins]').onchange = (e) => set(e.target.checked ? { coins: 'unlimited' } : { coins: 'limited', devCoins: o.devCoins || A.walletNow().balance });
      onAll('[data-devcoins]', 'change', (e) => set({ devCoins: Math.max(0, Number(e.target.value) || 0) }));
      $('[data-gates]').onchange = (e) => set({ ignoreGates: e.target.checked });
      $('[data-perfon]').onchange = (e) => set({ perf: e.target.checked ? o.perf ?? 0.5 : null });
      onAll('[data-perf]', 'input', (e) => ($('[data-perfv]').textContent = `${e.target.value}%`));
      onAll('[data-perf]', 'change', (e) => set({ perf: Number(e.target.value) / 100 }));
      $('[data-level]').onchange = (e) => set({ level: Math.max(1, Math.round(Number(e.target.value) || 1)) });
      $('[data-era]').onchange = (e) => set({ era: e.target.value ? Number(e.target.value) : null });
      $('[data-mastered]').onchange = (e) => set({ mastered: Math.max(0, Math.round(Number(e.target.value) || 0)) });
      onAll('[data-devreal]', 'click', () => set({ level: null, era: null, mastered: null, perf: null }));
      onAll('[data-incgo]', 'click', async () => {
        const r = Dv.triggerIncident(G(), learningNow(), $('[data-inckey]').value);
        await save();
        if (!r.ok) return A.toast(r.why);
        close();
        if (r.inc) return incidentScreen(r.inc.id);
        screen();
      });
      onAll('[data-evgo]', 'click', async () => {
        const r = Dv.triggerEvent(G(), learningNow(), $('[data-evkey]').value);
        await save();
        A.toast(r.ok ? '出来事を起こした' : r.why);
        if (r.ok) (close(), screen());
      });
      onAll('[data-devreset]', 'click', async (e) => {
        const g2 = Dv.freshGrid(Date.now(), e.currentTarget.dataset.devreset);
        g2.era = learningNow().era;
        store.setGrid(g2);
        DEV.state.money = [];
        summary = null;
        B = null;
        await save();
        close();
        A.toast(`開発者の系統を最初から（${Gm.TERRAINS[g2.terrain].name}）`);
        screen(null);
      });
    },
  );
}
// 1日・1週間・1年進める（1年は約1.6万刻みなので、進み具合を出す）
async function devJump(kind, $) {
  if (DEV.running) return;
  DEV.running = true;
  const n = Dv.JUMPS[kind];
  const bar = $('[data-prog]');
  bar.hidden = false;
  const prog = (d) => {
    bar.querySelector('i').style.width = `${(d / n) * 100}%`;
    bar.querySelector('span').textContent = `${d.toLocaleString('ja-JP')} ／ ${n.toLocaleString('ja-JP')} 刻み`;
    devSheetLive();
  };
  prog(0);
  try {
    await Dv.run(G(), learningNow(), n, { money: DEV.state.money, onProgress: prog, chunk: 300 });
    G().realAt = Date.now();
    await save();
  } finally {
    DEV.running = false;
  }
  document.querySelector('.modal.gsheet')?.remove();
  await screen();
  devSheet();
}
