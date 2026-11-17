// 動く系統の画面（1.5.0。1.5.1 で配置を変えた）：上の帯・地図・下のボタン5つ（建設・運転・需給・一覧・経営）とせり上がるパネル、
// 地図の上で建てる建設モード、電気の流れ（黄色い点線）、事故の問題、経営再建、新しい島、開発者モード
// 1.5.2：地図は動かさない（パネル・カードは地図に重ねる）、地点のメニュー（SAO 風）、したことの表示、チュートリアル
// 計算は grid.js。ここは表示と操作、保存（kv「grid」。開発者モードでは kv「gridDev」）、学習通貨の支出（ガチャと同じ台帳）
import * as Gm from './grid.js';
import * as L from './logic.js';
import * as Dv from './griddev.js';
import * as Mn from './gridmenu.js';
import { GRID_IMAGES } from './gridimg.js';
import * as Art from './gridart.js';
import { JAPAN_COAST, JAPAN_BOUNDS, JAPAN_HZ_LINE } from './japan.js';
import * as J from './gridjapan.js';

let A = null; // app.js から渡される部品（S・db・show・on・esc・toast など）
// チュートリアル（1.5.2）：練習の島（kv「gridTutorial」）で動かす。DEV と同じ仕組み（tut: true）
const tutOn = () => DEV.on && DEV.tut;
const devMode = () => DEV.on && !DEV.tut;
// 1.5.3 デモ：問題データなしで試す別の系統（kv「gridDemo」）。開発者モードと同じ操作ができる（demo: true）
const demoOn = () => DEV.on && DEV.demo;
let lcCache = null;
let summary = null; // 開いたときのまとめ（閉じるまでパネルに出す）
let gridSession = null; // 事故の問題の回答をまとめるセッション（mode「系統」）
let panel = null; // 開いているパネル：build・run・supply・list・manage・summary・node:ID・line:ID（null＝閉じている）
let buildFor = null; // 建設のパネルを地点から開いたとき：{ site } または { from }
let B = null; // 建設モード：{ kind: 'plant'|'line'|'sub', ... }
let whyOpen = null; // 建設のパネルで、理由を開いている種類
// 1.5.2 地点のメニュー：{ kind: 'node'|'line', id, branch: null|'build'|'line'|'rm', detail: false, anim: 'menu'|'branch'|null }
let sel = null;
// 開発者モード（1.5.1）：本番とは別の系統（kv「gridDev」）。入っているかどうかは保存しない（開き直すと本番に戻る）
// 1.5.2：チュートリアルの練習の島も同じ仕組みで動かす（tut: true、key: 'gridTutorial'）
const DEV = { on: false, tut: false, demo: false, key: Dv.DEV_KEY, state: null, taps: 0, tapAt: 0, savedAt: 0, running: false };
let store = null;

export function init(api) {
  A = api;
  store = Dv.makeStore(A.db, A.S, DEV);
  setInterval(tick, 15000);
  setInterval(devTick, 1000);
  // 画面の大きさが変わったら、メニューとカードの位置だけ直す（地図は動かさない）
  window.addEventListener('resize', () => {
    if (!onGrid()) return;
    drawMenu();
    drawDetail(true);
    if (B) drawBuildCard();
  });
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
// 開発者モード・デモの学習の状況の元（デモは問題データを使わない）
const learningBase = () => (DEV.demo ? Dv.demoBase() : learningReal());
// いま出している系統の学習の状況（開発者モードでは差し替える）
export function learningNow() {
  if (!DEV.on) return learningReal();
  return DEV.tut ? Mn.tutorialLearning(learningReal()) : Dv.devLearning(learningBase(), DEV.state.opts);
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
  const before = Mn.underWork(A.S.grid);
  const steps = await sync();
  if (steps > 0 && !DEV.on && onGrid()) announceDone(A.S.grid, before);
  if (steps > 0 && !DEV.on && idle()) live();
  if (steps > 0 && !DEV.on) collectAlerts();
}
export async function onVisible() {
  if (!A?.S.grid && !DEV.on) return;
  if (A.S.grid) await sync();
  if (DEV.on) DEV.state.grid.realAt = Date.now(); // 開発者の系統・デモは、開いている間だけ進む
  markSeen(); // 閉じていた間に起きたものは演出しない（前回からの結果・状態の札で）
  if (idle()) screen(undefined, !DEV.on);
}

// 学習通貨の支出は、ガチャと同じ台帳に記録する（開発者モードでは書かない）
const spend = (coins, what) => store.spend(coins, what, { gachaId: A.uid(), at: new Date().toISOString() });
const balance = () => store.balance(DEV.on ? 0 : A.walletNow().balance); // 開発者モード・デモでは本番のコインを見ない
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
// 上の帯の背景に、時代の絵を薄く（絵がないときは出さない）
const eraImg = (g) => {
  const src = GRID_IMAGES[PIC[`era${g.era}`]];
  return src ? `--eraimg:url('${src}')` : '';
};
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
  if (!DEV.on) {
    if (!S.grid) await sync();
    if (!S.grid) return A.toast('問題データを読み込むと使えるようになります');
  }
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
      <header class="gbar${eraImg(g) ? ' hasimg' : ''}" style="${eraImg(g)}"><button class="back" data-back>‹ ${DEV.demo ? '戻る' : 'ホーム'}</button><button class="ghud" data-hud aria-label="需給を開く">${hudHtml(g)}</button></header>
      ${devBand()}
      ${g.rebuild ? '<button class="btn primary gwide gwarn grebuild" data-rebuild>経営再建：手放すか、借入れを選ぶ</button>' : ''}
      <div class="gstat" data-chips>${chipsHtml(g)}</div>
      ${miniOn() ? `<button class="gmini" data-mini aria-label="需給を開く">${miniHtml(g)}</button>` : ''}
      <div class="gmid" data-mid>
        <div class="gmapbox" data-mapbox>${mapHtml(g)}</div>
        <div class="gmenu" data-menu></div>
        <div class="gdetail" data-detail></div>
        <div class="gbuildbar" data-bbar>${buildBarHtml(g)}</div>
        <div class="gbcard" data-bcard></div>
        <section class="gpanel${panel ? ' open' : ''}" data-panel aria-hidden="${panel ? 'false' : 'true'}"><div class="gpin" data-pin></div></section>
      </div>
      <nav class="gdock" data-dock>${dockHtml(g)}</nav>
    </div>`,
    () => {
      S.view = 'grid';
      inGrid = true;
      A.on('[data-back]', 'click', () => {
        leaveGrid();
        if (DEV.demo) return exitDemo();
        summary = null;
        B = null;
        panel = null;
        sel = null;
        A.home();
      });
      A.on('[data-hud]', 'click', () => togglePanel('supply'));
      A.on('[data-mini]', 'click', () => togglePanel('supply'));
      bindChips();
      yenShown = g.yen;
      yenSys = g;
      A.on('[data-rebuild]', 'click', rebuildDialog);
      bindDock();
      bindDevBand();
      bindMap();
      drawMap(); // 地図の箱の大きさを測ってから描き直す
      bindBuildBar();
      drawPanel();
      drawBuildCard();
      if (sel && !selOk()) sel = null;
      drawMenu();
      drawDetail();
      effects(g);
      tutPlace();
      if (entering || AL.g !== G()) markSeen(); // 閉じていた間に起きたもの・切り替えた系統のものは、演出ではなく前回からの結果・状態の札で
      if (entering) offerTutorial();
      drainAlerts();
    },
  );
}
const panelOk = (p) => ['build', 'run', 'supply', 'list', 'manage'].includes(p);
const selOk = () => (sel.kind === 'node' ? !!Gm.nodeOf(G(), sel.id) : G().lines.some((l) => l.id === sel.id));

// 時間が進んだときの描き直し：帯・地図・下のボタンの数・パネル（入力中でなければ）。パネルの位置（スクロール）は残す
function live() {
  if (!onGrid()) return;
  const g = G();
  const q = (s) => document.querySelector(s);
  q('[data-hud]').innerHTML = hudHtml(g);
  q('[data-chips]').innerHTML = chipsHtml(g);
  bindChips();
  const mini = q('[data-mini]');
  if (mini) mini.innerHTML = miniHtml(g);
  revenueFx(g);
  drawMap();
  q('[data-dock]').innerHTML = dockHtml(g);
  bindDock();
  const band = q('.gdevband [data-devops]');
  if (band) band.textContent = devSpeedText();
  const pin = q('[data-pin]');
  const busy = pin?.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  // パネルは入力中でなければ描き直す。早送り（1秒ごと）のときは4秒に1回まで（押した瞬間にボタンが入れ替わらないように）
  if (panel && panel !== 'summary' && panel !== 'build' && !busy && Date.now() - drawnAt > 4000) drawPanel(true);
  // 地点のメニューと詳細のカード（地図は動かないので、位置はそのまま。中身だけ新しくする）
  if (sel && !selOk()) sel = null;
  drawMenu();
  const dbusy = q('[data-detail]')?.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (sel?.detail && !dbusy && Date.now() - detailAt > 4000) drawDetail(true);
  if (!!g.rebuild !== !!q('[data-rebuild]')) screen();
}

// ---- 上の帯：日付と時代・コイン・収益・需要と届いた量・周波数・状態（375px で2行まで） ----
function gridState(g) {
  const l = g.last;
  if (!l) return { text: 'まだ動いていない', cls: '' };
  if (Object.values(g.black).some((u) => u > g.t)) return { text: '全域停電', cls: 'bad' };
  if (l.shed) return { text: '負荷遮断', cls: 'bad' };
  if (l.demand - l.served > 0.01 * l.demand) return { text: '一部に届いていない', cls: 'bad' };
  if (Gm.freqNow(g) && Math.abs(l.x) > Gm.FREQ.ok) return { text: '周波数の乱れ', cls: 'warn' };
  return { text: '正常', cls: 'ok' };
}
function hudHtml(g) {
  const l = g.last;
  const st = gridState(g);
  // 需要と届いた量：単位がそろうときは1つにまとめる（例：需要 18.0／届 15.2 MW）
  const [dv, du] = kw(l?.demand || 0).split(' '), [sv, su] = kw(l?.served || 0).split(' ');
  const ds = du === su ? `需要 <b>${dv}</b>／届 <b>${sv}</b> ${du}` : `需要 <b>${dv}</b> ${du}／届 <b>${sv}</b> ${su}`;
  return `<span class="hr"><span class="hcell grow1">${eraName(g.era)} ${timeShort(g)}</span><span class="hstate ${st.cls}">${st.text}</span></span>
    <span class="hr"><span class="hcell"><i class="hcoin" aria-label="コイン"></i><b>${coinText(balance())}</b></span><span class="hcell" data-yencell><i class="hyen" aria-hidden="true">¥</i>収益 <b class="${g.yen < 0 ? 'gneg' : ''}" data-yen>${yenShort(g.yen)}</b></span><span class="hcell grow1">${ds}</span>${Gm.freqNow(g) ? `<span class="hcell">${(Gm.freqNow(g) + (l?.x || 0)).toFixed(2)}Hz</span>` : ''}</span>`;
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
  if (panel === p) return setPanel(null);
  if (p !== 'build') buildFor = null;
  setPanel(p);
}
// 下のボタンのパネル。1.5.2 から地図は縮めない（パネルは地図の上に重ねる）。パネルを開くと地点のメニューは閉じる
function setPanel(p) {
  if (p && B) {
    B = null;
    sel = null;
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
  if (p) {
    if (sel) closeSel();
    drawPanel();
    tutEv(`panel:${p}`);
  }
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
}

// 時代が進んだとき・全域停電からの復旧（演出ありでは少し派手に）
function effects(g) {
  if (g.eraUp) {
    const E = Gm.ERAS[g.eraUp - 1];
    overlay(`era${g.eraUp}`, `時代が進んだ：${E.name}`, `${E.year}　新しい設備と需要が登場する。${g.eraUp === 2 && !Gm.hzList(g).length && !g.hz ? '交流の発電機を、まだ周波数のない網に初めて建てるとき、周波数（50 Hz／60 Hz）を選ぶ。' : ''}`, [523.3, 659.3, 784, 1046.5]);
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
  ov.querySelector('[data-close]').onclick = () => {
    ov.remove();
    drainAlerts();
  };
}

// ---- 1.5.3 事故・出来事が起きたときの演出：暗くする → 絵が下から中央へ → 赤い太字「◯◯発生」→ ボタン ----
// 開いている間に起きたものだけ（閉じていた間の分は前回からの結果と状態の札）。続けて起きたら順に、3つ目からはまとめる。
// チュートリアル・事故の問題の途中には出さず、系統の画面に戻ってから出す。テーマがシンプルでも出し、演出ありでは揺れと音を足す
const AL = { g: null, seen: null, queue: [], busy: false };
let inGrid = false; // 系統の画面（事故の問題の画面を含む）を開いている
function markSeen() {
  AL.g = G();
  AL.seen = AL.g ? Mn.alertSeen(AL.g) : null;
}
function leaveGrid() {
  inGrid = false;
  AL.queue = [];
}
// 時間が進んだあとに呼ぶ：新しく起きたものを待ち行列へ（別の系統に切り替わった・系統を開いていない・チュートリアルの間は印だけ）
function collectAlerts() {
  const g = G();
  if (!g) return;
  if (AL.g !== g || !AL.seen) return markSeen();
  const fresh = Mn.newAlerts(g, AL.seen);
  markSeen();
  if (!fresh.length || !inGrid || tutOn()) return;
  AL.queue.push(...fresh);
  drainAlerts();
}
const alertIdle = () => onGrid() && !tutOn() && !DEV.running && !document.querySelector('.modal, .goverlay, .galert, .gtut');
async function drainAlerts() {
  if (AL.busy || !AL.queue.length || !alertIdle()) return;
  AL.busy = true;
  try {
    const g = G();
    const live = AL.queue.splice(0).filter((a) => a.kind !== 'inc' || g.incidents.some((i) => i.id === a.id)); // もう片づいた事故は出さない
    const { each, rest } = Mn.planAlerts(live);
    for (let k = 0; k < each.length; k++) {
      const a = each[k];
      const r = await showAlert(a);
      if (r === 'go') {
        AL.queue.unshift(...each.slice(k + 1), ...rest); // 残りは系統の画面に戻ってから
        AL.busy = false;
        return incidentScreen(a.id);
      }
      if (r === 'list') setPanel('list');
    }
    if (rest.length) {
      const r = await showAlert({ kind: 'rest', head: `ほかにも ${rest.length}件`, text: rest.map((a) => a.head).join('・'), pic: null });
      if (r === 'list') setPanel('list');
    }
  } finally {
    AL.busy = false;
    if (AL.queue.length) setTimeout(drainAlerts, 0); // 出している間に起きたもの
  }
}
function alertPic(id) {
  const src = id && (GRID_IMAGES[id] || GRID_IMAGES[Mn.PIC_FALLBACK[id]]);
  return src ? `<img src="${src}" alt="">` : `<svg viewBox="0 0 48 36" aria-hidden="true">${PH.storm}</svg>`;
}
// 1枚の演出。戻り値（Promise）：押したボタン（go・list・close）
function showAlert(a) {
  return new Promise((resolve) => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ov = document.createElement('div');
    ov.className = `galert k-${a.kind}${A.fx() ? ' fx' : ''}${still ? ' still' : ''}`;
    ov.setAttribute('role', 'alertdialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', a.head);
    const btns = a.kind === 'inc' ? '<button class="btn primary" data-al="go">対処を選ぶ</button><button class="btn" data-al="list">あとで（一覧へ）</button>' : a.kind === 'rest' ? '<button class="btn primary" data-al="list">一覧へ</button><button class="btn" data-al="close">閉じる</button>' : '<button class="btn primary" data-al="close">閉じる</button>';
    const note = a.kind === 'inc' ? '<p class="galnote">ゲームの1日（現実の1時間）のうちに対処を選ぶ。選ばなければ標準の被害で片づく</p>' : '';
    ov.innerHTML = `<div class="galbox"><div class="galpic${a.pic ? '' : ' ph'}">${alertPic(a.pic)}<p class="galhead">${A.esc(a.head)}</p></div><p class="galtext">${A.esc(a.text)}</p>${note}<div class="galbtns">${btns}</div><p class="galskip" aria-hidden="true">画面を押すと、とばせます</p></div>`;
    document.body.append(ov);
    const timers = [];
    const head = () => {
      if (ov.classList.contains('p2')) return;
      ov.classList.add('p2');
      if (A.fx()) A.playNotes([[740, 0], [554.4, 0.13], [740, 0.26]]); // 短い警告の音（演出ありだけ）
    };
    const all = () => {
      timers.forEach(clearTimeout);
      ov.classList.add('p1');
      head();
      ov.classList.add('p3');
      ov.querySelector('[data-al]')?.focus({ preventScroll: true });
    };
    if (still) all();
    else {
      void ov.offsetWidth;
      ov.classList.add('p1'); // 暗くする・絵が下から中央へ（0.5 秒）
      timers.push(setTimeout(head, 560)); // 赤い太字
      timers.push(setTimeout(all, 1560)); // ボタン
    }
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-al]');
      if (b && ov.classList.contains('p3')) {
        ov.remove();
        return resolve(b.dataset.al);
      }
      if (!ov.classList.contains('p3')) all(); // 画面を押すと、演出をとばしてボタンまで
    });
  });
}

// ---- 1.5.3 状態の札：続いている出来事・待っている事故・負荷遮断や全域停電を、上の帯のすぐ下に（ゲームの状態異常のように） ----
// 小さなアイコン＋名前＋「あと2日」。事故は赤、出来事は黄、悪い状態ほど目立つ色（並べ方と色は gridmenu.js の statusChips）。多いときは横にスクロール
const CHIP_ICON = {
  I01: '<path d="M13 2L5 13h5l-2 9 9-12h-5z"/>',
  I02: '<path d="M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2M3 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2"/><path d="M12 3l-1.5 3.5h3L12 10" />',
  I03: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  I04: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  I05: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="9.5" cy="12" r="3"/><circle cx="14.5" cy="12" r="3"/>',
  I06: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l5-6"/><path d="M4 21h16"/>',
  I07: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  G18: '<path d="M12 3c-3 5-5 7.2-5 9.8a5 5 0 0 0 10 0C17 10.2 15 8 12 3z"/><path d="M4 20L20 4"/>',
  heat: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  cold: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  typhoon: '<path d="M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M14.5 12c0-5-4-8-9-7M9.5 12c0 5 4 8 9 7"/>',
  snowstorm: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/>',
  coalSpike: '<path d="M4 20l5-6 4 3 7-9"/><path d="M15 8h5v5"/>',
  priceWar: '<path d="M6 4l6 8 6-8M12 12v8M7 13h10M7 17h10"/>',
  black: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/><path d="M3 3l18 18"/>',
  shed: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.5L20 18M8.6 15.5L20 6"/>',
};
function chipIcon(c) {
  const k = c.kind === 'inc' ? Mn.INC_PIC[c.key] : c.kind === 'ev' ? c.key : c.kind;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${CHIP_ICON[k] || CHIP_ICON.I06}</svg>`;
}
function chipsHtml(g) {
  return Mn.statusChips(g)
    .map((c, i) => `<button class="gchip ${c.cls}" data-chip="${i}">${chipIcon(c)}<b>${A.esc(c.name)}</b>${c.left ? `<small>${A.esc(c.left)}</small>` : ''}</button>`)
    .join('');
}
function bindChips() {
  const el = document.querySelector('[data-chips]');
  if (!el) return;
  el.classList.toggle('on', !!el.children.length);
  el.querySelectorAll('[data-chip]').forEach((b) => (b.onclick = () => chipTap(Mn.statusChips(G())[Number(b.dataset.chip)])));
}
// 押すと：事故は「対処を選ぶ」、出来事は詳しく、停電・負荷遮断は需給
function chipTap(c) {
  if (!c) return;
  if (c.kind === 'inc') return incidentScreen(c.id);
  if (c.kind !== 'ev') return togglePanel('supply');
  const e = Gm.evOn(G(), c.key);
  if (!e) return;
  const E = Gm.EVENTS[c.key];
  sheet(`<h2>${A.esc(E.name)}（${A.esc(c.left)}）</h2>${pic(c.key, 'wide')}<p>${A.esc(E.text)}。${E.days}日続く。</p><p class="small">出来事は時間がたつと終わります。需給のパネルで、需要と電源の動きを見られます。</p>`);
}

// ---- 1.5.3 小さなグラフ：上の帯の下（札の下）に高さ 40px。直近24時間の需要（線）・届いた量（緑の点線）・電源ごとの出力（積み上げ）、
// いまの時刻の印、予備力の残り。押すと需給。経営のパネルでオン・オフ（初期値はオン。開発者モード・デモではその系統の設定に）
const miniOn = () => (DEV.on ? DEV.state.opts.mini !== false : A.S.settings.gridMini !== false);
async function setMini(on) {
  if (DEV.on) {
    DEV.state.opts.mini = on;
    return save();
  }
  A.S.settings.gridMini = on;
  return A.db.putKV('settings', A.S.settings);
}
function miniHtml(g) {
  const hs = g.hist.slice(-24);
  const l = g.last;
  const W = 230, H = 40;
  if (hs.length < 2 || !l) return '<span class="gmempty">需要と電源の小さなグラフ（1時間ごとに記録がたまると出ます）</span>';
  const o = Gm.overview(g, learningNow());
  // 縦の目盛りは需要と出力に合わせる（使える発電機の合計の点線は、入るときだけ）
  const top = Math.max(1e-9, ...hs.map((h) => Math.max(h[1], h[3] + h[4] + h[5])));
  const max = (o.cap > top && o.cap < top * 1.6 ? o.cap : top) * 1.12;
  const X = (i) => W - (hs.length - 1 - i) * (W / 23);
  const Y = (v) => H - 1 - (v / max) * (H - 3);
  const P = (v) => v.toFixed(1);
  const area = (lo, hi) => `M${hs.map((h, i) => `${P(X(i))},${P(Y(hi(h)))}`).join(' L')} L${hs.map((h, i) => `${P(X(hs.length - 1 - i))},${P(Y(lo(hs[hs.length - 1 - i])))}`).join(' L')}Z`;
  const line = (f) => `M${hs.map((h, i) => `${P(X(i))},${P(Y(f(h)))}`).join(' L')}`;
  const days = hs.map((h, i) => (h[0] % 24 === 0 ? `<line x1="${P(X(i))}" x2="${P(X(i))}" y1="0" y2="${H}" class="gmday"/>` : '')).join('');
  const last = hs[hs.length - 1];
  const margin = l.demand > 1e-6 ? o.cap / l.demand - 1 : null;
  const rcls = margin == null ? '' : margin < 0 ? 'bad' : margin < g.reserve ? 'warn' : 'ok';
  const rtext = margin == null ? '予備 —' : margin < 0 ? '予備 不足' : margin > 1 ? '予備 100%超' : `予備 ${pct(margin)}`;
  return `<svg class="gmsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${days}
      ${o.cap <= max ? `<line x1="0" x2="${W}" y1="${P(Y(o.cap))}" y2="${P(Y(o.cap))}" class="gmcap"/>` : ''}
      <path d="${area(() => 0, (h) => h[5])}" class="gmhy"/>
      <path d="${area((h) => h[5], (h) => h[5] + h[4])}" class="gmco"/>
      <path d="${area((h) => h[5] + h[4], (h) => h[5] + h[4] + h[3])}" class="gmdc"/>
      <path d="${line((h) => h[2])}" class="gmsv"/>
      <path d="${line((h) => h[1])}" class="gmdem"/>
      <line x1="${W - 0.8}" x2="${W - 0.8}" y1="0" y2="${H}" class="gmnow"/>
      <circle cx="${W - 1.5}" cy="${P(Y(last[1]))}" r="2.2" class="gmdot"/>
    </svg><span class="gmlab"><b>${g.t % 24}時</b><small class="${rcls}">${rtext}</small></span>`;
}

// ---- 1.5.3 収益が増えたとき：上の帯の数字が数え上げるように増え、緑の「+◯円」が浮かんで消える。電気を届けている町から「¥」が収益の欄へ飛ぶ ----
// 収益（円）と学習のコインは別物なので、色と印を分ける（収益は緑の「¥」、コインは金色の丸）。¥ は町ごとに 30 秒に1回まで
let yenShown = null, yenSys = null;
const yenAt = new Map();
let yenSound = 0;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function revenueFx(g) {
  const prev = yenShown;
  yenShown = g.yen;
  if (yenSys !== g) return (yenSys = g); // 系統が切り替わった
  if (prev == null || !(g.yen - prev >= 1) || document.hidden || !onGrid()) return;
  const b = document.querySelector('.ghud [data-yen]');
  const cell = document.querySelector('.ghud [data-yencell]');
  if (!b || !cell) return;
  // 数え上げ
  if (!still()) {
    const t0 = performance.now(), d = 700;
    const stepFx = (now) => {
      const k = Math.min(1, (now - t0) / d);
      if (!b.isConnected || yenShown !== g.yen) return;
      b.textContent = yenShort(prev + (g.yen - prev) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(stepFx);
    };
    b.textContent = yenShort(prev);
    requestAnimationFrame(stepFx);
  }
  // 緑の「+◯円」
  const r = cell.getBoundingClientRect();
  const f = document.createElement('span');
  f.className = `gyenfx${A.fx() ? ' fx' : ''}`;
  f.textContent = `+${yenShort(g.yen - prev)}`;
  f.style.left = `${Math.round(r.left + r.width / 2)}px`;
  f.style.top = `${Math.round(r.bottom - 4)}px`;
  document.body.append(f);
  setTimeout(() => f.remove(), 1500);
  if (!still()) flyYen(g, r);
}
function flyYen(g, to) {
  const svg = document.querySelector('[data-top]');
  const m = svg?.getScreenCTM();
  if (!m || document.querySelector('.galert')) return;
  const now = Date.now();
  let k = 0;
  for (const n of Gm.nodesOf(g)) {
    const st = g.last?.towns[n.id];
    if (!n.town || !st || !(st.d > 0) || !(st.r > 0) || !g.loads.some((x) => x.town === n.id)) continue;
    if (now - (yenAt.get(n.id) || 0) < 30000 || k >= 3) continue;
    yenAt.set(n.id, now);
    const p = at(n);
    if (p.x < 0 || p.y < 0 || p.x > VIEW.W || p.y > VIEW.H) continue; // 画面の外の町からは飛ばさない
    const x = m.a * p.x + m.c * p.y + m.e, y = m.b * p.x + m.d * p.y + m.f - 14;
    const el = document.createElement('span');
    el.className = `gyencoin${A.fx() ? ' fx' : ''}`;
    el.textContent = '¥';
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    document.body.append(el);
    const dx = to.left + 8 - x, dy = to.top + to.height / 2 - y;
    const a = el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%, calc(-50% - 12px)) scale(1.1)', opacity: 1, offset: 0.22 },
        { transform: 'translate(-50%, calc(-50% - 12px)) scale(1)', opacity: 1, offset: 0.38 },
        { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${dy.toFixed(0)}px)) scale(.55)`, opacity: 0.9, offset: 0.95 },
        { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${dy.toFixed(0)}px)) scale(.4)`, opacity: 0 },
      ],
      { duration: 1300, delay: k * 160, easing: 'ease-in-out', fill: 'both' },
    );
    a.onfinish = () => {
      el.remove();
      if (A.fx() && Date.now() - yenSound > 10000) {
        yenSound = Date.now();
        A.playNotes([[1568, 0]]);
      }
    };
    k++;
  }
}

// ---- 1.5.2 したことの表示：上の帯のすぐ下（中央）に短い帯を2〜3秒。続けて起きたら順に出す ----
// テーマがシンプルでも出す（何をしたかの情報なので）。演出ありでは光と短い音を足す
const ACTQ = [];
let actBusy = false;
function act(kind, x) {
  const text = Mn.actText(G(), kind, x);
  if (text) band(text);
}
function band(text) {
  ACTQ.push(text);
  if (ACTQ.length > 6) ACTQ.splice(0, ACTQ.length - 6);
  if (!actBusy) nextBand();
}
function bandTop() {
  const els = ['.gscreen .gbar', '.gscreen .gdevband', '.gscreen .grebuild', '.gscreen .gstat', '.gscreen .gmini', 'header.top', '.gdevband'].map((q) => document.querySelector(q)).filter(Boolean);
  return els.length ? Math.max(...els.map((e) => e.getBoundingClientRect().bottom)) + 6 : 8;
}
function nextBand() {
  const text = ACTQ.shift();
  if (!text) return (actBusy = false);
  actBusy = true;
  let el = document.querySelector('.gact');
  if (!el) {
    el = document.createElement('div');
    el.className = 'gact';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.style.top = `${Math.round(bandTop())}px`;
  el.textContent = text;
  el.classList.toggle('fx', !!A.fx());
  void el.offsetWidth; // 出すたびに動きをやり直す
  el.classList.add('show');
  if (A.fx()) A.playNotes([[784, 0], [1046.5, 0.07]]);
  const ms = Math.min(3200, 2000 + text.length * 25);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(nextBand, 240);
  }, ms);
}
// コインを使ったら、上の帯のコインの横に「−12,000」を浮かせて消す
function coinFloat(coins) {
  const c = document.querySelector('.ghud .hcoin');
  if (!c || !(coins > 0) || balance() === Infinity) return;
  const r = (c.parentElement || c).getBoundingClientRect(); // 残高の数字の右に出す
  const el = document.createElement('span');
  el.className = 'gcoinfx';
  el.textContent = `−${A.num(Math.round(coins))}`;
  el.style.left = `${Math.round(r.right + 2)}px`;
  el.style.top = `${Math.round(r.top - 2)}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1500);
}
// 地図の上の印（工事の印がぽんと出る・完成した施設が弾む・開通した線が一度光る）。id → { kind, until }
const marks = new Map();
const MARK_MS = { work: 1400, done: 1600, glow: 1800 };
function mark(id, kind) {
  marks.set(id, { kind, until: Date.now() + MARK_MS[kind] });
}
const markOf = (id) => {
  const m = marks.get(id);
  return m && m.until > Date.now() ? m.kind : null;
};
// 開いている間に完成したものを、帯と地図の印で知らせる（閉じている間の分は、開いたときのまとめに出る）
function announceDone(g, before) {
  const done = Mn.finished(g, before);
  for (const f of done) {
    band(Mn.doneText(g, f));
    if (f.kind === 'line') mark(f.x.id, 'glow');
    else mark(f.kind === 'plant' ? f.x.site : f.x.town, 'done');
  }
  if (done.length && onGrid()) drawMap();
  return done.length;
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
      ${waitingHtml(G())}
    </div>`,
    bind: ({ onAll }) => onAll('[data-golist2]', 'click', () => setPanel('list')),
  };
}
// 1.5.3：閉じていた間に起きた事故・続いている出来事は、演出ではなく前回からの結果に入れる
function waitingHtml(g) {
  const incs = g.incidents.map((i) => `<li class="gng">事故：${A.esc(Gm.INCIDENTS[i.key].title)}（対処待ち。あと ${Math.max(0, i.deadline - g.t)}時間）</li>`);
  const evs = g.events.filter((e) => e.until > g.t).map((e) => `<li>出来事：${A.esc(Gm.EVENTS[e.key].name)}（${A.esc(Gm.EVENTS[e.key].text)}。あと${Mn.hoursText(e.until - g.t)}）</li>`);
  if (!incs.length && !evs.length) return '';
  return `<ul class="gnotes gwait">${incs.join('')}${evs.join('')}</ul>${incs.length ? '<button class="btn primary" data-golist2>一覧で対処を選ぶ</button>' : ''}`;
}

// ---- 地図 ----
// 1.6.0：地図の座標（日本列島は 1 単位＝1 km、古い島は 360×400）を画面の px に直して描く。文字とアイコンは、拡大しても画面の上の大きさが変わらない
// 海岸線は下の層（data-base）に1回だけ描き、拡大・移動では transform だけを変える。線・地点は上の層（data-top）に毎回描く
// 動かしている間は描き直さず、CSS の transform で動かし（data-mapwrap）、指を離したら VIEW を変えて描き直す
const MAP_W = 360, MAP_H = 400;
const ISLAND = 'M38,78 C70,22 170,6 252,36 C312,58 348,150 338,244 C332,322 300,372 232,386 C150,398 62,366 34,296 C8,226 10,128 38,78Z';
// VIEW：画面の左上の地図の座標（x・y）と、画面の幅に入る地図の幅（w）。W・H：地図の箱の大きさ（px）。key：どの系統の地図か
const VIEW = { x: 0, y: 0, w: MAP_W, W: 360, H: 400, key: null, base: null };
const scaleK = () => VIEW.W / VIEW.w;
const viewH = () => (VIEW.w * VIEW.H) / VIEW.W;
const at = (n) => ({ x: (n.x - VIEW.x) * scaleK(), y: (n.y - VIEW.y) * scaleK() });
const utilColor = (u) => (u > 1.2 ? 'var(--ng)' : u > 1 ? 'var(--idk)' : 'var(--gline)');
// 地図の範囲と拡大の限度（幅 4 km〜列島全体。古い島は 90〜島全体）
function mapBounds(g) {
  if (Gm.isJapan(g)) {
    const [x0, y0, x1, y1] = JAPAN_BOUNDS;
    return { x0, y0, x1, y1, minW: 4 };
  }
  return { x0: 0, y0: 0, x1: MAP_W, y1: MAP_H, minW: 90 };
}
function clampView(g) {
  const b = mapBounds(g);
  const maxW = Math.max(b.x1 - b.x0, ((b.y1 - b.y0) * VIEW.W) / VIEW.H) * 1.06;
  VIEW.w = Math.max(b.minW, Math.min(maxW, VIEW.w));
  const h = viewH();
  const cx = Math.max(b.x0, Math.min(b.x1, VIEW.x + VIEW.w / 2)), cy = Math.max(b.y0, Math.min(b.y1, VIEW.y + h / 2));
  VIEW.x = cx - VIEW.w / 2;
  VIEW.y = cy - h / 2;
}
// 長方形 [x0, y0, x1, y1] が入るように（pad：まわりの余白の割合、minW：いちばん狭い幅）
function fitView(g, [x0, y0, x1, y1], pad = 0.15, minW = 0) {
  const w = Math.max(minW, (x1 - x0) * (1 + 2 * pad), (((y1 - y0) * (1 + 2 * pad)) * VIEW.W) / VIEW.H);
  VIEW.w = w;
  VIEW.x = (x0 + x1) / 2 - w / 2;
  VIEW.y = (y0 + y1) / 2 - viewH() / 2;
  clampView(g);
}
const bboxOf = (ns) => [Math.min(...ns.map((n) => n.x)), Math.min(...ns.map((n) => n.y)), Math.max(...ns.map((n) => n.x)), Math.max(...ns.map((n) => n.y))];
// 全体（列島全体・島全体）
function viewAll(g) {
  const b = mapBounds(g);
  fitView(g, [b.x0, b.y0, b.x1, b.y1], 0.02);
}
// 始めた町のまわり（東京は区が入るくらい）
function viewStart(g) {
  if (!Gm.isJapan(g)) return viewAll(g);
  const s = Gm.nodeOf(g, Gm.startId(g));
  const ns = s.area === '東京市内' ? Gm.nodesOf(g).filter((n) => n.area === '東京市内') : [s];
  fitView(g, bboxOf(ns), 0.2, 16);
}
// 開いたとき：開いている地点が入るように
function viewHome(g) {
  if (!Gm.isJapan(g)) return viewAll(g);
  const open = Gm.nodesOf(g).filter((n) => Gm.nodeOpen(g, n));
  if (open.length <= 1) return viewStart(g);
  fitView(g, bboxOf(open), 0.12, 12);
}
const viewKeyOf = (g) => `${DEV.on ? DEV.key : 'grid'}|${g.islandNo}|${g.terrain}|${g.start || ''}`;
// 地図の箱の大きさを測り、系統が変わっていれば最初の見え方にする
function ensureView(g) {
  const box = document.querySelector('[data-mapbox]');
  if (box?.clientWidth) (VIEW.W = box.clientWidth), (VIEW.H = box.clientHeight || VIEW.H);
  const key = viewKeyOf(g);
  if (VIEW.key !== key) {
    VIEW.key = key;
    VIEW.base = null;
    viewHome(g);
  } else clampView(g);
}
// 線の形（2次ベジェ）。回り道はふくらませ、直流は少しずらす（同じ2地点の交流と重ならないように）
function linePath(a, b, route, dc) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bend = route === 'detour' ? Math.min(26, len * 0.18) : dc ? -Math.min(8, len * 0.1) : 0;
  const cx = mx + (dy / len) * bend, cy = my - (dx / len) * bend;
  const f = (v) => v.toFixed(1);
  return { d: `M${f(a.x)},${f(a.y)} Q${f(cx)},${f(cy)} ${f(b.x)},${f(b.y)}`, back: `M${f(b.x)},${f(b.y)} Q${f(cx)},${f(cy)} ${f(a.x)},${f(a.y)}`, lx: (mx + cx) / 2, ly: (my + cy) / 2, len };
}
const hoursText = (h) => (h >= 48 ? `${Math.ceil(h / 24)}日` : `${h}時間`);
// 下の層（海岸線など）の transform：地図の座標 → 画面の px
const baseTf = () => `matrix(${scaleK()} 0 0 ${scaleK()} ${(-VIEW.x * scaleK()).toFixed(2)} ${(-VIEW.y * scaleK()).toFixed(2)})`;
function baseInner(g) {
  if (Gm.isJapan(g)) {
    const hz = g.era >= 2 ? `<path d="M${JAPAN_HZ_LINE.map((p) => p.join(',')).join(' L')}" class="ghzline" vector-effect="non-scaling-stroke"/>` : '';
    return `<path d="${JAPAN_COAST}" class="gcoastl" vector-effect="non-scaling-stroke"/>${hz}`;
  }
  // 古い島：地形（雪の地域（北西）・山・川・海岸）
  let s = `<path d="${ISLAND}" fill="var(--land)" stroke="var(--coast)" stroke-width="1.5"/>`;
  s += '<path d="M40,84 C60,46 110,26 150,22 C150,60 120,110 70,140 C40,140 26,116 40,84Z" fill="var(--gsnow)" opacity=".7"/>';
  s += [[150, 60], [176, 46], [205, 62], [232, 52], [262, 70], [118, 86], [278, 104], [196, 96]].map(([x, y]) => `<path d="M${x - 11},${y + 9} L${x},${y - 9} L${x + 11},${y + 9}Z" fill="var(--gmount)"/>`).join('');
  s += '<path d="M130,44 C150,90 190,120 210,180 C218,214 196,238 186,262 C196,300 208,320 214,338 C218,356 224,370 228,386" fill="none" stroke="var(--griver)" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M246,96 C236,130 222,156 210,180" fill="none" stroke="var(--griver)" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>';
  s += '<text x="74" y="72" class="gland">雪の地域</text><text x="222" y="78" class="gland">山</text><text x="302" y="312" class="gland">海岸</text><text x="118" y="236" class="gland">平野</text>';
  return s;
}
const baseKeyOf = (g) => `${VIEW.key}|${Gm.isJapan(g) && g.era >= 2 ? 'hz' : ''}`;
function baseSvg(g) {
  VIEW.base = baseKeyOf(g);
  return `<svg class="gmap gbase" data-base viewBox="0 0 ${VIEW.W} ${VIEW.H}" aria-hidden="true"><g data-basetf transform="${baseTf()}">${baseInner(g)}</g></svg>`;
}
function mapHtml(g) {
  ensureView(g);
  return `<div class="gmapwrap" data-mapwrap>${baseSvg(g)}<svg class="gmap gtop" data-top viewBox="0 0 ${VIEW.W} ${VIEW.H}" role="img" aria-label="${Gm.isJapan(g) ? '日本列島の地図' : '島の地図'}">${topInner(g)}</svg></div>
    <div class="gzoombtns" data-zoombtns><button class="btn small" data-zoom="all">全体</button><button class="btn small" data-zoom="start">始めた町</button></div>`;
}
// 表示の細かさ（1.6.0）：縮めたときは「大」の町の名前だけ。中・小の町・水力の地点は拡大すると出す。東京の区は町の中まで拡大したときだけ
// （それより縮めたときは、いちばん目立つ区に「東京」とだけ出す）。建設モードで光る地点・選んだ地点はいつも出す
const NAME_W = { 3: Infinity, 2: 1000, 1: 320, hydro: 220, ward: 40 };
const DOT_GAP = 18; // 画面の上でこれより近い地点は、目立つ方だけを絵で描き、ほかは小さな点にする
function topInner(g) {
  const nodes = Gm.nodesOf(g);
  const japan = Gm.isJapan(g);
  const t = g.t;
  const cand = B ? candidates(g, learningNow()) : null;
  const selId = sel?.kind === 'node' ? sel.id : null;
  const selLine = sel?.kind === 'line' ? sel.id : null;
  const P = new Map(nodes.map((n) => [n.id, at(n)]));
  const W = VIEW.W, H = VIEW.H;
  const onScreen = (p, m = 40) => p.x > -m && p.x < W + m && p.y > -m && p.y < H + m;
  let s = Art.MAP_DEFS;
  // 今の 50 Hz と 60 Hz の境目（参考）の文字
  if (japan && g.era >= 2) {
    const mid = at({ x: JAPAN_HZ_LINE[3][0], y: JAPAN_HZ_LINE[3][1] });
    if (onScreen(mid, 0)) s += `<text x="${(mid.x + 6).toFixed(1)}" y="${(mid.y - 6).toFixed(1)}" class="ghzlabel">今の境目（参考）</text>`;
  }
  // 線（下の色は使用率・直流・止まっている）
  let flows = '';
  for (const l of g.lines) {
    const a = P.get(l.a), b = P.get(l.b);
    if (!a || !b) continue;
    if (Math.max(a.x, b.x) < -40 || Math.min(a.x, b.x) > W + 40 || Math.max(a.y, b.y) < -40 || Math.min(a.y, b.y) > H + 40) continue;
    const K = Gm.LINES[l.kind];
    const L2 = linePath(a, b, l.route, K.dc);
    const building = l.readyAt > t;
    const down = !building && Gm.lineCircuits(l, t) <= 0;
    const u = g.last?.lines[l.id]?.util || 0;
    const col = building ? 'var(--muted)' : down ? 'var(--ng)' : K.dc ? 'var(--gdc)' : utilColor(u);
    const wdt = K.dc ? 2 : K.kv >= 66 ? 3.6 : K.kv >= 11 ? 2.8 : 2;
    const label = building ? `${K.short} 工事 あと${hoursText(l.readyAt - t)}` : `${K.short}${l.n > 1 ? `×${l.n}` : ''}`;
    const mk = markOf(l.id);
    const showLabel = L2.len > 70 || selLine === l.id;
    s += `<g class="gline${selLine === l.id ? ' sel' : ''}${B ? ' gdim' : ''}" data-line="${l.id}"><path d="${L2.d}" fill="none" stroke="transparent" stroke-width="22"/>${selLine === l.id ? `<path d="${L2.d}" fill="none" stroke="var(--primary)" stroke-width="${wdt + 5}" stroke-linecap="round" opacity=".3"/>` : ''}${mk === 'glow' ? `<path d="${L2.d}" class="gglow" fill="none" stroke-width="${wdt + 6}" stroke-linecap="round"/>` : ''}<path d="${L2.d}" fill="none" stroke="${col}" stroke-width="${wdt}" stroke-linecap="round" ${building ? 'stroke-dasharray="2 5"' : down ? 'stroke-dasharray="7 5"' : ''}/>
      ${showLabel ? `<text x="${L2.lx.toFixed(1)}" y="${(L2.ly - 4).toFixed(1)}" class="glabel${building ? ' gwork' : ''}">${label}</text>` : ''}${building && showLabel ? cone(L2.lx, L2.ly + 8, mk === 'work') : ''}</g>`;
    flows += flowPath(g, l, a, b, L2, mk === 'glow');
  }
  s += `<g class="gflows${B ? ' gdim' : ''}" aria-hidden="true">${flows}</g>`;
  // 建設モードの仮の線（点線）
  if (B?.kind === 'line' && B.from && B.to) {
    const L2 = linePath(P.get(B.from), P.get(B.to), B.route, Gm.LINES[B.lk].dc);
    s += `<path d="${L2.d}" class="gtemp" fill="none"/>`;
  }
  // 地点：目立つ順に置き、近すぎるものは点にする。文字は重ならないものだけ
  const has = (n) => g.plants.some((p) => p.site === n.id) || g.subs.some((v) => v.town === n.id) || g.loads.some((l) => l.town === n.id);
  const start = Gm.startId(g);
  const prio = (n) => (selId === n.id ? 4000 : 0) + (cand?.get(n.id) ? 2000 : 0) + (has(n) ? 600 : 0) + (n.id === start ? 300 : 0) + (Gm.nodeOpen(g, n) ? 100 : 0) + (n.town ? (n.size || 2) * 30 : 10);
  const vis = nodes.filter((n) => onScreen(P.get(n.id))).sort((a, b) => prio(b) - prio(a));
  const placed = [], labels = [];
  let wardNamed = false;
  const out = [];
  for (const n of vis) {
    const { x, y } = P.get(n.id);
    const c = cand?.get(n.id);
    const force = selId === n.id || !!c;
    const near = placed.some((q) => Math.hypot(q.x - x, q.y - y) < DOT_GAP);
    const full = force || !near;
    if (full) placed.push({ x, y });
    const open = Gm.nodeOpen(g, n);
    // 名前
    let name = null;
    if (full) {
      const ward = japan && n.area === '東京市内';
      const limit = !japan ? Infinity : ward ? NAME_W.ward : n.town ? NAME_W[n.size || 2] : has(n) ? NAME_W.hydro * 3 : NAME_W.hydro;
      if (VIEW.w <= limit || force) name = n.name;
      else if (ward && !wardNamed) name = '東京';
      if (name === '東京') wardNamed = true;
    }
    let lines = name ? Mn.splitName(name) : [];
    let pos = 'b';
    if (lines.length) {
      // 名前の置き場所：下 → 上 → 右 → 左。どれもほかの名前と重なるなら出さない（選んだ地点・候補は下に出す）
      const w = Math.max(...lines.map((v) => v.length)) * 9.4 + 4, h = lines.length * 10.5;
      const rects = { b: [x - w / 2, y + 14], t: [x - w / 2, y - 26 - h], r: [x + 13, y - h / 2], l: [x - 13 - w, y - h / 2] };
      const hit = ([x0, y0]) => labels.some((q) => x0 < q.x1 && x0 + w > q.x0 && y0 < q.y1 && y0 + h > q.y0);
      pos = force ? 'b' : ['b', 't', 'r', 'l'].find((k) => !hit(rects[k])) || null;
      if (!pos) lines = [];
      else labels.push({ x0: rects[pos][0], y0: rects[pos][1], x1: rects[pos][0] + w, y1: rects[pos][1] + h });
    }
    out.push(nodeSvg(g, n, x, y, { full, c, selId, lines, open, pos }));
  }
  // 目立つものを上に重ねる（描く順は逆）
  s += out.reverse().join('');
  return s;
}
// 地点1つの絵。full：絵で描く／点で描く。c：建設モードの候補（'can'・'sel'）。lines：名前（1〜2行）。open：開いている地点か
function nodeSvg(g, n, x, y, { full, c, selId, lines, open, pos = 'b' }) {
  const t = g.t;
  const mode = !B ? (selId === n.id ? ' sel' : '') : c === 'sel' ? ' sel' : c ? ' gcan' : ' gdim';
  const kind = n.town ? 'gtownn' : n.game ? 'gsite ggame' : 'gsite';
  const cls = `gnode ${kind}${mode}${open ? '' : ' gclosed'}${full ? '' : ' gdot'}`;
  const plants = g.plants.filter((p) => p.site === n.id);
  const subs = g.subs.filter((v) => v.town === n.id);
  const inc = g.incidents.some((i) => i.town === n.id || plants.some((p) => p.id === i.plant) || subs.some((v) => v.id === i.sub));
  const f = (v) => v.toFixed(1);
  if (!full) {
    // 点：町は灯り具合の色、用地は小さな菱形
    const look = n.town ? Art.townLook(g, n) : null;
    const dot = n.town ? `<circle cx="${f(x)}" cy="${f(y)}" r="3.6" class="gdotc t-${look.state}"/>` : `<path d="M${f(x)},${f(y - 3.6)} L${f(x + 3.6)},${f(y)} L${f(x)},${f(y + 3.6)} L${f(x - 3.6)},${f(y)}Z" class="gdotc s${plants.length ? ' has' : ''}"/>`;
    return `<g class="${cls}" data-node="${n.id}"><circle cx="${f(x)}" cy="${f(y)}" r="9" fill="transparent"/>${dot}${inc ? `<circle cx="${f(x + 4)}" cy="${f(y - 4)}" r="3" fill="var(--ng)"/>` : ''}</g>`;
  }
  // 1.5.3：町は家並み（灯ると窓が光り、まわりに光の輪）、用地は菱形。発電所・変電所は種類のアイコンを横に出し、短い線でつなぐ（gridart.js）
  let body = n.town ? Art.townSvg(x, y, Art.townLook(g, n)) : `<path d="M${f(x)},${f(y - 9)} L${f(x + 9)},${f(y)} L${f(x)},${f(y + 9)} L${f(x - 9)},${f(y)}Z" class="gsitebody${plants.length ? ' has' : ''}"/>`;
  body += Art.assetsSvg(g, n, x, y, Art.iconSide(Gm.nodesOf(g), n.id));
  // 工事中の発電所・変圧器：残りの時間を小さく添える
  const work = [...plants, ...subs].filter((v) => v.readyAt > t).map((v) => v.readyAt - t);
  if (work.length) body += `<text x="${f(x)}" y="${f(y - 25)}" class="glabel gwork">工事 あと${hoursText(Math.min(...work))}</text>${cone(x + 14, y + 13, markOf(n.id) === 'work')}`;
  if (markOf(n.id) === 'done') body = `<g class="gbounce">${body}</g>`;
  const ring = !B ? (selId === n.id ? `<circle cx="${f(x)}" cy="${f(y)}" r="17" class="gselring"/>` : '') : c === 'sel' ? `<circle cx="${f(x)}" cy="${f(y)}" r="17" class="gselring"/>` : c ? `<circle cx="${f(x)}" cy="${f(y)}" r="16" class="gpulse"/><circle cx="${f(x)}" cy="${f(y)}" r="16" class="gring"/>` : '';
  // 名前（pos：b＝下・t＝上・r＝右・l＝左）
  const nh = lines.length * 10.5;
  const [tx, ty, anc] = { b: [x, y + 23, ''], t: [x, y - 17 - nh, ''], r: [x + 13, y + 3.5 - (nh - 10.5) / 2, ' start'], l: [x - 13, y + 3.5 - (nh - 10.5) / 2, ' end'] }[pos] || [x, y + 23, ''];
  const name = lines.length ? `<text y="${f(ty)}" class="gname${anc ? ` a${anc.trim()}` : ''}">${lines.map((v, i) => `<tspan x="${f(tx)}" dy="${i ? 10.5 : 0}">${A.esc(v)}</tspan>`).join('')}</text>` : '';
  return `<g class="${cls}" data-node="${n.id}"><circle cx="${f(x)}" cy="${f(y)}" r="23" fill="transparent"/>${ring}${body}
      ${name}
      ${inc ? `<circle cx="${f(x + 12)}" cy="${f(y + 8)}" r="6" fill="var(--ng)"/><text x="${f(x + 12)}" y="${f(y + 11)}" class="gbang">!</text>` : ''}</g>`;
}
// 電気の流れ（黄色い点線）：流れている線にだけ重ね、流れる向き（last.lines の to）に動かす。速さは使用率で3段階
// 描き直しても動きが途切れないよう、描いたあとに syncFlows で動きの起点を文書の時計の0にそろえる（同じ段なら位相が同じになる）
const FLOW_SEC = [0, 2.4, 1.4, 0.8];
// 工事の印（三角コーン）。pop：建設を始めた直後（ぽんと出る）
const cone = (x, y, pop) => `<g class="gcone${pop ? ' gpop' : ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><path d="M-5.5,5 L0,-7 L5.5,5Z" fill="#e8812c" stroke="#7a3d0b" stroke-width=".8"/><path d="M-3.2,0 h6.4" stroke="#fff" stroke-width="1.6"/><rect x="-7" y="4.2" width="14" height="2.6" rx="1" fill="#7a3d0b"/></g>`;
function flowPath(g, l, a, b, P, wait = false) {
  const f = g.last?.lines[l.id];
  if (!f || !(f.p > 1e-3) || l.readyAt > g.t || Gm.lineCircuits(l, g.t) <= 0) return '';
  const tier = f.util < 0.3 ? 1 : f.util < 0.8 ? 2 : 3;
  const sec = FLOW_SEC[tier];
  const K = Gm.LINES[l.kind];
  const w = (K.dc ? 2 : K.kv >= 66 ? 3.6 : K.kv >= 11 ? 2.8 : 2) + 0.8; // 下の線より少し太く。暗い縁（gflowe）を下に敷いて、明るい地図でも見えるように
  const d = f.to === l.a ? P.back : P.d;
  const wt = wait ? ' gwait' : ''; // 開通した線：一度光ってから流れ始める
  return `<path d="${d}" class="gflowe s${tier}${wt}" stroke-width="${w + 1.6}" data-sec="${sec}"/><path d="${d}" class="gflow s${tier}${wt}" stroke-width="${w}" data-sec="${sec}"/>`;
}
function syncFlows() {
  for (const el of document.querySelectorAll('.gmap [data-sec]')) {
    const a = el.getAnimations?.()[0];
    if (a && 'startTime' in a) a.startTime = 0;
    else el.style.animationDelay = `${(-((Date.now() / 1000) % Number(el.dataset.sec))).toFixed(3)}s`; // 古いブラウザ：現在時刻から決める
  }
  // 1.5.3：町の灯り・煙・水・水車・点滅も、描き直しで動きがやり直しにならないよう位相をそろえる
  for (const el of document.querySelectorAll('.gmap .gsync')) for (const a of el.getAnimations?.() || []) if ('startTime' in a) a.startTime = 0;
}
// 描き直し：上の層は毎回、下の層は系統・時代が変わったときだけ（拡大・移動は transform だけ）
function drawMap() {
  const wrap = document.querySelector('[data-mapwrap]');
  if (!wrap) return;
  const g = G();
  ensureView(g);
  if (VIEW.base !== baseKeyOf(g)) wrap.querySelector('[data-base]').outerHTML = baseSvg(g);
  const base = wrap.querySelector('[data-base]');
  base.setAttribute('viewBox', `0 0 ${VIEW.W} ${VIEW.H}`);
  base.querySelector('[data-basetf]').setAttribute('transform', baseTf());
  const top = wrap.querySelector('[data-top]');
  top.setAttribute('viewBox', `0 0 ${VIEW.W} ${VIEW.H}`);
  top.innerHTML = topInner(g);
  syncFlows();
}
// 地図が動いたあと：地図・メニュー・カード・建設の帯を描き直す
function afterMove() {
  drawMap();
  drawMenu();
  drawDetail(true);
  if (B) {
    document.querySelector('[data-bbar]').innerHTML = buildBarHtml(G());
    bindBuildBar();
    drawBuildCard();
  }
  tutFollow();
}

// 地図を押す・動かす（1.6.0）：1本指で移動、2本指で拡大・縮小、空いたところを2回押すと拡大（PC はホイールでも）。
// 押すのと動かすのは 8px 動いたかどうかで分ける。押したときは、押した場所（pointerdown）の地点・線を覚えて、離したときに動かす
const MOVE_PX = 8;
const GS = { pts: new Map(), start: null, moved: false, pinch: null, lastTap: null, tf: null };
let mapRO = null;
function bindMap() {
  const mid = document.querySelector('[data-mid]');
  const box = document.querySelector('[data-mapbox]');
  const wrap = () => document.querySelector('[data-mapwrap]');
  const rel = (e) => {
    const r = box.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const setTf = (tx, ty, s) => {
    GS.tf = { tx, ty, s };
    const w = wrap();
    if (w) w.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
  };
  // 動かした分を VIEW に移して描き直す（画面の点 p' ＝ s・p ＋ t）
  const commit = () => {
    const tf = GS.tf;
    GS.tf = null;
    const w = wrap();
    if (w) w.style.transform = '';
    document.querySelector('.gscreen')?.classList.remove('gmoving');
    if (!tf) return;
    const k0 = scaleK();
    VIEW.x += -tf.tx / tf.s / k0;
    VIEW.y += -tf.ty / tf.s / k0;
    VIEW.w /= tf.s;
    clampView(G());
    afterMove();
  };
  box.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    const p = rel(e);
    GS.pts.set(e.pointerId, p);
    if (GS.pts.size === 1) {
      const el = e.target.closest('[data-node],[data-line]');
      GS.start = { ...p, id: e.pointerId, node: el?.dataset.node || null, line: el?.dataset.line || null, at: Date.now(), base: { tx: 0, ty: 0, s: 1 } };
      GS.moved = false;
      GS.pinch = null;
    } else if (GS.pts.size === 2) {
      const [a, b] = [...GS.pts.values()];
      GS.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, base: GS.tf || { tx: 0, ty: 0, s: 1 } };
      GS.moved = true;
    }
    box.setPointerCapture?.(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!GS.pts.has(e.pointerId)) return;
    const p = rel(e);
    GS.pts.set(e.pointerId, p);
    if (GS.pinch && GS.pts.size >= 2) {
      const [a, b] = [...GS.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const P0 = GS.pinch.base, k = d / GS.pinch.d;
      // 指の真ん中の点が、指の下に残るように
      const s = P0.s * k;
      setTf(m.x - k * (GS.pinch.m.x - P0.tx), m.y - k * (GS.pinch.m.y - P0.ty), s);
      document.querySelector('.gscreen')?.classList.add('gmoving');
      return;
    }
    const st = GS.start;
    if (!st || st.id !== e.pointerId || GS.pts.size !== 1) return;
    const dx = p.x - st.x, dy = p.y - st.y;
    if (!GS.moved && Math.hypot(dx, dy) <= MOVE_PX) return;
    GS.moved = true;
    document.querySelector('.gscreen')?.classList.add('gmoving');
    setTf(st.base.tx + dx, st.base.ty + dy, st.base.s);
  });
  const end = (e) => {
    if (!GS.pts.has(e.pointerId)) return;
    GS.pts.delete(e.pointerId);
    if (GS.pts.size > 0) {
      // 2本指の片方を離した：残りの指で続けて動かせるように、いまの形を起点にする
      if (GS.pinch) {
        GS.pinch = null;
        const [q] = [...GS.pts.values()];
        GS.start = { x: q.x, y: q.y, id: [...GS.pts.keys()][0], node: null, line: null, base: GS.tf || { tx: 0, ty: 0, s: 1 } };
      }
      return;
    }
    const st = GS.start;
    GS.start = null;
    if (GS.moved) {
      GS.moved = false;
      GS.pinch = null;
      if (GS.tf && GS.tf.s === 1 && !GS.tf.tx && !GS.tf.ty) GS.tf = null;
      return commit();
    }
    if (!st || e.type === 'pointercancel') return;
    // 押した：空いたところを2回続けて押すと拡大
    const p = rel(e);
    const now = Date.now();
    if (!st.node && !st.line) {
      const lt = GS.lastTap;
      if (lt && now - lt.at < 320 && Math.hypot(p.x - lt.x, p.y - lt.y) < 30) {
        GS.lastTap = null;
        return zoomAt(p.x, p.y, 2);
      }
      GS.lastTap = { ...p, at: now };
    } else GS.lastTap = null;
    mapTap(st.node, st.line);
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = rel(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0018));
  }, { passive: false });
  mid.addEventListener('contextmenu', (e) => e.target.closest('[data-mapbox]') && e.preventDefault());
  // 隅のボタン：全体・始めた町
  box.querySelectorAll('[data-zoom]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerup', (e) => e.stopPropagation());
    b.onclick = () => {
      if (b.dataset.zoom === 'all') viewAll(G());
      else viewStart(G());
      afterMove();
      tutEv(`zoom:${b.dataset.zoom}`);
    };
  });
  // 画面の大きさが変わったら、真ん中と縮尺を残して描き直す
  mapRO?.disconnect();
  if (window.ResizeObserver) {
    mapRO = new ResizeObserver(() => {
      if (!box.isConnected || !box.clientWidth) return;
      if (box.clientWidth === VIEW.W && box.clientHeight === VIEW.H) return;
      const cx = VIEW.x + VIEW.w / 2, cy = VIEW.y + viewH() / 2;
      VIEW.W = box.clientWidth;
      VIEW.H = box.clientHeight;
      VIEW.x = cx - VIEW.w / 2;
      VIEW.y = cy - viewH() / 2;
      clampView(G());
      afterMove();
    });
    mapRO.observe(box);
  }
}
// 画面の点 (px, py) を中心に s 倍
function zoomAt(px, py, s) {
  const g = G();
  const k0 = scaleK();
  const mx = VIEW.x + px / k0, my = VIEW.y + py / k0;
  VIEW.w /= s;
  clampView(g);
  const k1 = scaleK();
  VIEW.x = mx - px / k1;
  VIEW.y = my - py / k1;
  clampView(g);
  afterMove();
  tutEv('zoom');
}
// 地点・線を押すとメニュー。同じものをもう一度押す・空いたところを押すと閉じる。パネルが開いていれば、まず閉じる
// 1.6.0：まだ開いていない地点は「◯◯から」と出す
function mapTap(node, line) {
  if (B) return node ? buildTap(node) : null;
  if (panel) {
    setPanel(null);
    if (!node && !line) return;
  }
  if (node && !Gm.nodeOpen(G(), node)) {
    const n = Gm.nodeOf(G(), node);
    return A.toast(`${n.name}：${eraName(Gm.openEra(G(), n))}から（まだ開いていない）`);
  }
  if (node) return sel?.kind === 'node' && sel.id === node ? closeSel() : openSel('node', node);
  if (line) return sel?.kind === 'line' && sel.id === line ? closeSel() : openSel('line', line);
  if (sel) closeSel();
}

// ---- 1.5.2 地点のメニュー（SAO 風）：地点の横に丸いボタンを縦に並べ、「建設」「線を引く」「撤去」はさらに横へ枝分かれ ----
// 位置の計算は gridmenu.js（画面からはみ出さない）。地図は動かないので、地点の位置は地図の座標から1回で求まる
const SVGI = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const MI_ICON = {
  build: '<path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/>',
  line: '<circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><path d="M7.5 16.5l9-9" stroke-dasharray="2.6 2.4"/>',
  detail: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7.2v.6"/>',
  rm: '<path d="M5 7h14M9.5 7V5h5v2M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6"/>',
  inc: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17v.6"/>',
  circ: '<path d="M3 8h12M3 13h12M3 18h7"/><path d="M18 13v8M14 17h8"/>',
};
const TYPE_ICON = {
  coal: '<path d="M4 20V11l5 3v-3l5 3V7h3v13z"/><path d="M15 5c0-2 2-2 2-3.5"/>',
  hydro: '<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2-1.5 4.5-1.5S19 17 21 17M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2-1.5 4.5-1.5S19 21 21 21"/><path d="M12 3c-2.5 4-4 5.8-4 7.8a4 4 0 0 0 8 0C16 8.8 14.5 7 12 3z"/>',
  sub: '<rect x="3" y="7" width="18" height="11" rx="2"/><circle cx="9.5" cy="12.5" r="3"/><circle cx="14.5" cy="12.5" r="3"/>',
  line: '<path d="M8 21l3-17h2l3 17M9.6 10h4.8M8.8 15h6.4M4 6.5c4 1.8 12 1.8 16 0"/>',
};
const typeIcon = (c) => (c.b.startsWith('rm:') ? MI_ICON.rm : c.kind === 'line' ? TYPE_ICON.line : c.kind === 'sub' ? TYPE_ICON.sub : Gm.PLANTS[c.key].coal ? TYPE_ICON.coal : TYPE_ICON.hydro);
// 地図の座標 → メニューの層（.gmid）の中の座標。地図は動かないので getScreenCTM を1回見るだけ
function toBox(x, y) {
  const svg = document.querySelector('[data-top]');
  const mid = document.querySelector('[data-mid]');
  const m = svg?.getScreenCTM();
  if (!m || !mid) return { x, y };
  const r = mid.getBoundingClientRect();
  return { x: m.a * x + m.c * y + m.e - r.left, y: m.b * x + m.d * y + m.f - r.top };
}
const nodeBox = (n) => {
  const p = at(n);
  return toBox(p.x, p.y);
};
// メニューの起点：地点の中心、線なら線の中ほど（線の名前のあたり）
function selAnchor() {
  const g = G();
  if (sel.kind === 'node') return nodeBox(Gm.nodeOf(g, sel.id));
  const l = g.lines.find((x) => x.id === sel.id);
  const P = linePath(at(Gm.nodeOf(g, l.a)), at(Gm.nodeOf(g, l.b)), l.route, Gm.LINES[l.kind].dc);
  return toBox(P.lx, P.ly);
}
function openSel(kind, id, detail = false) {
  if (B) return;
  sel = { kind, id, branch: null, detail, anim: 'menu' };
  drawMap();
  drawMenu();
  drawDetail();
  if (A.fx()) A.playNotes([[987.8, 0]]);
  tutEv(`menu:${id}`);
}
function closeSel() {
  sel = null;
  drawMap();
  drawMenu();
  drawDetail();
}
const boxSize = () => {
  const mid = document.querySelector('[data-mid]');
  return { w: mid?.clientWidth || 360, h: mid?.clientHeight || 400 };
};
function miBtn(col, i, attr, icon, label, o = {}) {
  const it = col.items[i];
  const cls = ['gmi', col.side, o.sub && 'sub', o.on && 'on', o.locked && 'locked', o.alert && 'alert'].filter(Boolean).join(' ');
  return `<button class="${cls}" ${attr} style="left:${Math.round(it.x)}px;top:${Math.round(it.y)}px;width:${it.w}px;--i:${i}"><span class="gmc">${SVGI(icon)}</span><span class="gml">${A.esc(label)}${o.tag ? `<small>${A.esc(o.tag)}</small>` : ''}</span></button>`;
}
function drawMenu() {
  const el = document.querySelector('[data-menu]');
  if (!el) return;
  if (!sel || B) {
    el.className = 'gmenu';
    el.innerHTML = '';
    return;
  }
  const g = G(), lc = learningNow();
  const box = boxSize();
  const items = sel.kind === 'node' ? Mn.nodeMenu(g, lc, sel.id) : Mn.lineMenu();
  const a = selAnchor();
  const M = Mn.placeMenu(a, items.length, box);
  let lines = M.items.map((it) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${it.cx.toFixed(1)}" y2="${it.cy.toFixed(1)}"/>`).join('');
  let html = items.map((it, i) => miBtn(M, i, `data-mi="${it.k}"`, MI_ICON[it.k], it.label, { on: sel.branch === it.k || (it.k === 'detail' && sel.detail), alert: it.alert })).join('');
  const bi = sel.branch ? items.findIndex((it) => it.k === sel.branch) : -1;
  if (bi < 0) sel.branch = null;
  else {
    const sub = Mn.branchItems(g, lc, sel, sel.branch);
    const Bp = Mn.placeBranch(M, bi, sub.length, box);
    lines += Bp.items.map((it) => `<line class="b" x1="${Bp.from.cx.toFixed(1)}" y1="${Bp.from.cy.toFixed(1)}" x2="${it.cx.toFixed(1)}" y2="${it.cy.toFixed(1)}"/>`).join('');
    html += sub.map((c, i) => miBtn(Bp, i, `data-mb="${c.b}"`, typeIcon(c), c.name, { sub: true, locked: !c.ok, tag: c.ok && c.st?.proto ? '試作' : '' })).join('');
  }
  // 詳細のカードがメニューに重ならないように、メニューの上端・下端を覚えておく
  menuSpan = { top: Math.min(a.y, ...M.items.map((it) => it.y)), bottom: Math.max(a.y, ...M.items.map((it) => it.y + it.h)) };
  el.className = `gmenu${sel.anim === 'menu' ? ' enter' : sel.anim === 'branch' ? ' benter' : ''}`;
  el.innerHTML = `<svg class="gmlines" width="${box.w}" height="${box.h}" aria-hidden="true">${lines}<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="3.5"/></svg>${html}`;
  sel.anim = null;
  el.querySelectorAll('[data-mi]').forEach((b) => (b.onclick = () => menuAct(b.dataset.mi)));
  el.querySelectorAll('[data-mb]').forEach((b) => (b.onclick = () => branchAct(b.dataset.mb)));
}
function menuAct(k) {
  const g = G(), lc = learningNow();
  if (k === 'detail') {
    sel.detail = !sel.detail;
    sel.branch = null;
    drawMenu();
    return drawDetail();
  }
  if (sel.kind === 'node') {
    if (k === 'build' || k === 'line' || k === 'rm') {
      if (k === 'rm') {
        const r = Mn.removables(g, sel.id);
        if (r.length === 1) return removeDialog(r[0].kind, r[0].id);
      }
      sel.branch = sel.branch === k ? null : k;
      sel.anim = 'branch';
      if (sel.branch) sel.detail = false;
      drawMenu();
      drawDetail();
      if (sel.branch) tutEv(`branch:${k}`);
      return;
    }
    if (k === 'inc') {
      const i = Mn.incidentsAt(g, sel.id)[0];
      if (!i) return;
      sel = null;
      return incidentScreen(i.id);
    }
  } else {
    if (k === 'circ') return circuitDialog(sel.id);
    if (k === 'rm') return removeDialog('line', sel.id);
  }
}
function branchAct(b) {
  const [kind, key, id] = b.split(':');
  if (kind === 'rm') return removeDialog(key, id);
  const st = typeStatus(learningNow(), kind, key);
  if (!st.ok) return whySheet(kind, key, st);
  enterBuild(kind, key, sel.id);
}
// まだ建てられない種類：理由と「この単元を解く」
function whySheet(kind, key, st) {
  const name = kind === 'plant' ? Gm.PLANTS[key].name : kind === 'line' ? Gm.LINES[key].name : '変圧器（変電所）';
  sheet(`<h2>${A.esc(name)}は、まだ建てられません</h2>${whyHtml(st)}`, ({ onAll }) => onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo)));
}
// 回線の増設：費用を見せてから（押してすぐコインを使わない）
function circuitDialog(id) {
  const g = G(), lc = learningNow();
  const l = g.lines.find((x) => x.id === id);
  if (!l) return;
  const qc = Gm.quoteCircuit(g, lc, id);
  sheet(
    `<h2>回線を増やす</h2>
    <p class="small">${A.esc(Gm.lineName(g, l))}（いま ${l.n}回線）に、同じルートでもう1回線。送れる量が増え、1回線が止まっても残りで送れる。</p>
    ${qc.ok ? `<p class="gquote"><b>${A.num(qc.cost)} コイン</b>（残高 ${coinText(balance())}）</p><button class="btn primary gwide" data-ok>増設する</button>` : `<p class="warn small">${A.esc(qc.why)}</p>`}`,
    ({ onAll }) => onAll('[data-ok]', 'click', () => pay(qc, `${Gm.LINES[l.kind].short}の回線の増設`, () => Gm.addCircuit(G(), learningNow(), id), null, 'circuit')),
  );
}
// 詳細：今の地点・線のパネルの中身を、地図に重ねる半透明のカードで（地点と反対の側に）
let detailAt = 0;
let menuSpan = null;
function drawDetail(keep = false) {
  const el = document.querySelector('[data-detail]');
  if (!el) return;
  detailAt = Date.now();
  if (!sel?.detail || B) {
    el.classList.remove('open');
    el.innerHTML = '';
    return;
  }
  const g = G(), lc = learningNow();
  const body = (sel.kind === 'node' ? nodePanel : linePanel)(g, lc, sel.id);
  const top = keep ? el.scrollTop : 0;
  el.innerHTML = `<div class="gphead"><h2>${body.title}</h2><button class="btn small" data-dclose>閉じる</button></div>${body.html}`;
  el.classList.add('open');
  const $ = (q) => el.querySelector(q);
  const onAll = (q, ev, fn) => el.querySelectorAll(q).forEach((x) => x.addEventListener(ev, fn));
  onAll('[data-dclose]', 'click', () => {
    sel.detail = false;
    drawMenu();
    drawDetail();
  });
  onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
  body.bind?.({ $, onAll, g, lc });
  const a = selAnchor();
  placeCardAt(el, menuSpan ? [a, { y: menuSpan.top }, { y: menuSpan.bottom }] : [a]);
  el.scrollTop = top;
}

// ---- 建設のパネル：発電所の種類・線の種類（電圧の階級ごと）・変圧器。まだ建てられない種類は灰色 ----
// 種類ごとの「建てられるか」（場所によらない条件：時代・学習の単元・設計図）。1.5.2 から gridmenu.js
const typeStatus = Mn.typeStatus;
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
  if (DEV.demo) return ''; // デモには問題データがないので「この単元を解く」は出さない
  const has = new Set(L.activeQuestions(A.S.data).map((x) => x.unitId));
  const list = [...new Set(units)].filter((u) => has.has(u));
  if (!list.length) return units.length ? '<p class="small">（関係する単元の問題が、まだ問題データにありません）</p>' : '';
  return `<p class="gunits">${list.map((u) => `<button class="btn small" data-unitgo="${u}">${A.esc(A.subjectOf(A.unitSubjectId(u))?.name || '')}「${A.esc(A.shortName(A.unitName(u)))}」を解く</button>`).join('')}</p>`;
}
function goUnit(unitId) {
  leaveGrid();
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
  sel = null;
  const c = candidates(g, lc);
  if (preset && c.get(preset)) pick(preset);
  else if (preset) A.toast(whyNot(g, lc, preset));
  if (tutOn() && B.kind === 'plant' && B.type === 'dcCoal' && B.site) B.size = 50; // チュートリアル：港町にも送れる大きさ
  screen();
  tutEv(`bmode:${kind}`);
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
  if (B.kind === 'line' && B.to) tutEv('line:to');
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
  // 1.6.0：候補の数と、画面の外にある数（拡大していると見えない候補があるので）
  const cand = [...candidates(g, learningNow())].filter(([, v]) => v === 'can').map(([id]) => Gm.nodeOf(g, id));
  const off = cand.filter((n) => {
    const p = at(n);
    return p.x < 0 || p.y < 0 || p.x > VIEW.W || p.y > VIEW.H;
  }).length;
  const cnt = `<small class="gbcount">候補 ${cand.length} か所${off ? `（画面の外 ${off}）` : ''}${off ? ' <button class="link" data-bfit>候補をすべて見る</button>' : ''}</small>`;
  return `<p><b>${A.esc(what)}</b><small>${hint}</small>${cnt}</p><button class="btn small" data-bquit>やめる</button>`;
}
function bindBuildBar() {
  document.querySelector('[data-bquit]')?.addEventListener('click', exitBuild);
  document.querySelector('[data-bfit]')?.addEventListener('click', () => {
    const g = G();
    const ids = [...candidates(g, learningNow()).keys()];
    if (!ids.length) return;
    fitView(g, bboxOf(ids.map((id) => Gm.nodeOf(g, id))), 0.12, Gm.isJapan(g) ? 8 : 90);
    afterMove();
  });
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
    return;
  }
  let h = '';
  let q = null, what = '', doBuild = null;
  if (B.kind === 'plant') {
    const D = Gm.PLANTS[B.type];
    const sizes = D.sizes.filter((z) => Gm.eraStatus(lc, Math.max(D.era, z[2]?.era || 0)) !== 'no');
    q = Gm.quotePlant(g, lc, { type: B.type, kw: B.size, site: B.site, hz: B.hz });
    const eff = D.coal ? `熱効率 ${(D.eff[0] * 100).toFixed(0)}〜${(D.eff[1] * 100).toFixed(0)}%（いま ${(Gm.plantEff({ type: B.type, proto: q.proto }, lc) * 100).toFixed(1)}%）・起動 ${D.start}時間・最低出力 ${pct(D.min)}` : B.type === 'ror' ? '燃料なし。出力は川の流量しだい（春 1.3・夏 1.0・秋 0.9・冬 0.6）' : '燃料なし。1日分の水をためて、時間をずらして使う（池＝出力の6時間分）';
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.site).name)}</b>：${D.name}</p>
      <div class="gseg gsizes">${sizes.map((z) => `<button class="btn small ${z[0] === B.size ? 'on' : ''}" data-bsize="${z[0]}">${kw(z[0])}</button>`).join('')}</div>
      <p class="small">${eff} ・ ${D.bs ? 'ブラックスタートできる' : 'ブラックスタートできない'}</p>
      ${q.hz === true ? '<p class="small">この網には、まだ交流の発電機がありません。先に周波数を決めます（この網の周波数になります）。</p><button class="btn primary gwide" data-hz>周波数を選ぶ</button>' : `${q.freq ? `<p class="small">周波数 <b>${q.freq} Hz</b>（${q.newHz ? 'この網で初めて決める。あとから変えられない' : 'つながっている網の周波数'}）${q.newHz ? ' <button class="btn small" data-hz>選び直す</button>' : ''}</p>` : ''}${quoteHtml(q)}`}`;
    what = `${D.short} ${kw(B.size)}`;
    doBuild = () => Gm.buildPlant(g, lc, { type: B.type, kw: B.size, site: B.site, hz: B.hz });
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
  on('[data-bgo]', 'click', () => pay(q, what, doBuild, () => (B = null), B.kind));
  placeCard(el, B.kind === 'line' ? [B.from, B.to] : [B.site || B.town]);
}
// カードを、選んだ地点と反対の側（上か下）に出す。地点が隠れないように高さも抑える
function placeCard(el, ids) {
  placeCardAt(el, ids.filter(Boolean).map((id) => nodeBox(Gm.nodeOf(G(), id))));
}
function placeCardAt(el, pts) {
  const mid = document.querySelector('[data-mid]');
  if (!el || !mid || !pts.length) return;
  const H = mid.clientHeight;
  const side = Mn.cardSide(pts.map((p) => p.y), H);
  const bar = B ? document.querySelector('[data-bbar]') : null;
  const top = bar ? bar.offsetTop + bar.offsetHeight + 8 : 8;
  el.classList.toggle('top', side === 'top');
  if (side === 'top') {
    const room = Math.min(...pts.map((p) => p.y)) - 30 - top;
    el.style.top = `${top}px`;
    el.style.bottom = 'auto';
    el.style.maxHeight = `${Math.round(Math.max(150, Math.min(H * 0.64, room)))}px`;
  } else {
    const room = H - Math.max(...pts.map((p) => p.y)) - 34 - 8;
    el.style.top = 'auto';
    el.style.bottom = '8px';
    el.style.maxHeight = `${Math.round(Math.max(150, Math.min(H * 0.64, room)))}px`;
  }
}

// 建設の確認：コインが足りるかを見て、建て、台帳に書く
async function pay(q, what, doBuild, after, kind = null) {
  if (balance() < q.cost) return A.toast(`コインが足りません（あと ${A.num(q.cost - balance())}）`);
  const r = doBuild();
  if (!r.ok) return A.toast(r.why);
  await spend(r.cost, what);
  if (kind === 'plant') act('buildPlant', r.plant), mark(r.plant.site, 'work');
  else if (kind === 'line') act('buildLine', r.line), mark(r.line.id, 'work');
  else if (kind === 'sub') act('buildSub', r.sub), mark(r.sub.town, 'work');
  else if (kind === 'circuit') act('circuit', r.line);
  else if (kind === 'cap') act('cap', r.load);
  else band(`${what}（${A.num(r.cost)} コイン）`);
  if (A.fx()) A.playNotes([[440, 0], [554.4, 0.08], [659.3, 0.16]]);
  after?.();
  await save();
  document.querySelector('.modal.gsheet')?.remove();
  await screen();
  coinFloat(r.cost);
  if (kind) tutEv(`built:${kind}`);
}

// ---- モーダルのシート（確認・選択が要るもの：周波数・撤去・進相コンデンサ・新しい島・経営再建・開発者モード） ----
function sheet(html, bind) {
  document.querySelector('.modal.gsheet')?.remove();
  const dlg = document.createElement('div');
  dlg.className = 'modal gsheet';
  dlg.innerHTML = `<div class="sheet">${html}<div class="actions"><button class="btn" data-close>閉じる</button></div></div>`;
  document.body.append(dlg);
  const close = () => {
    dlg.remove();
    setTimeout(drainAlerts, 0); // シートの間に起きたことの演出を、閉じてから出す
  };
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
  const start = Gm.startId(g);
  const dist = start === id ? (Gm.isJapan(g) ? '始めた町' : '中央の町') : `${A.esc(Gm.nodeOf(g, start).name)}から ${Gm.distKm(g, start, id) < 0.5 ? '0' : Gm.distKm(g, start, id).toFixed(1)} km`;
  const where = Gm.isJapan(g) ? `${A.esc(n.pref)}${n.place ? ` ${A.esc(n.place)}` : ''}${n.river ? `・${A.esc(n.river)}` : ''} ・ ` : '';
  let h = `<p class="small">${where}${n.town ? '町' : n.hydro ? `水力の地点（使える水 ${kw(n.hydro)}${n.pond ? '・調整池を作れる' : ''}）` : '石炭火力の用地'} ・ ${dist} ・ この場所の危険：${hazardText(n.tags)}</p>`;
  if (!Gm.nodeOpen(g, n)) h += `<p class="warn small">まだ開いていない地点です（${eraName(Gm.openEra(g, n))}から）。</p>`;
  if (Gm.isJapan(g)) h += historyHtml(n);
  if (incs.length) h += `<p class="warn small">事故の対処待ちがあります <button class="btn small" data-golist>一覧へ</button></p>`;
  if (n.town) {
    const rep = g.rep[id] ?? 1;
    h += `<h3>需要</h3>${loads.length ? loads.map((l) => `<p class="spread grow"><span>${Gm.LOADS[l.type].name} ${kw(l.kw)}${Gm.LOADS[l.type].pfFixed ? `（力率 ${l.cap ? Gm.LOADS[l.type].pfFixed : Gm.LOADS[l.type].pf}）` : ''}</span>${Gm.LOADS[l.type].pfFixed && !l.cap ? `<button class="btn small" data-cap="${l.id}">進相コンデンサ</button>` : ''}</p>`).join('') : '<p class="small">まだありません</p>'}
      ${st ? `<p class="small">いま ${kw(st.d)} ・ 届いている割合 ${pct(st.r)} ・ 町の信用 ${pct(rep)}${rep < 1 ? '（停電があると下がり、1か月で戻る）' : ''}</p>` : ''}
      <h3>変電所</h3>${subs.length ? subs.map((x) => `<p class="spread grow"><span>変圧器 ${x.mva} MVA ・ ${stateOf(x, t) || `使用率 ${pct(g.last?.subs[id] || 0)}`}</span><button class="btn small" data-rm="sub:${x.id}">撤去</button></p>`).join('') : '<p class="small">なし（11 kV 以上の送電線をつなぐには変電所が要る）</p>'}`;
  }
  h += `<h3>発電所</h3>${plants.length ? plants.map((p) => `<p class="spread grow"><span>${Gm.PLANTS[p.type].short} ${kw(p.kw)}${p.proto ? '（試作）' : ''} ・ ${plantState(g, p)}</span><button class="btn small" data-rm="plant:${p.id}">撤去</button></p>`).join('') : '<p class="small">なし</p>'}
`;
  return {
    title: `${A.esc(n.name)}${!Gm.townActive(g, n) || !Gm.nodeOpen(g, n) ? ` <span class="tag">${eraName(Gm.isJapan(g) ? Gm.openEra(g, n) : n.era)}から</span>` : ''}`,
    html: h,
    bind: ({ onAll }) => {
      onAll('[data-sources]', 'click', sourcesSheet);
      onAll('[data-golist]', 'click', () => setPanel('list'));
      onAll('[data-cap]', 'click', (e) => capDialog(e.currentTarget.dataset.cap));
      onAll('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':')));
    },
  };
}

// ---- 1.6.0 史実の表示：地点の史実の年と1行・出典・確かめたかどうか・位置はおおよそ。ゲームの値は「ゲーム」と分ける ----
const confOf = (c) => (/^確認済み/.test(c || '') ? '確かめた' : c === 'ゲームの地点' ? '' : '未確認');
function historyHtml(n) {
  const rows = [];
  if (n.game) rows.push('<p class="small">ゲームの地点（実在の川の名前を使った、史実ではない地点）</p>');
  else if (n.year || n.fact) rows.push(`<p class="small">${n.year && !(n.fact || '').startsWith(String(n.year)) ? `${n.year}年 ` : ''}${A.esc(n.fact || (n.hydro ? '運転開始の年' : ''))}</p>`);
  if (n.hydro) rows.push(`<p class="small">使える水の上限 ${kw(n.hydro)}：${n.limitBy === 'ゲーム' ? 'ゲームの値' : '今の最大出力（運転開始のころの値ではない。その川の力の目安）'}</p>`);
  const conf = confOf(n.conf);
  rows.push(`<p class="small gsrc">${n.src ? `出典 ${A.esc(n.src)}${conf ? `（${conf}）` : ''} ・ ` : ''}位置はおおよそ <button class="link" data-sources>出典の一覧</button></p>`);
  return `<h3>史実</h3>${rows.join('')}`;
}
function sourcesSheet() {
  sheet(
    `<h2>出典の一覧</h2>
    <p class="small">史実の値は、出典で確かめたものだけを「確かめた」としています。Gemini の調査（G1・G2）だけのものは「未確認」です。ゲームのために決めた値（発電所の大きさ・費用・需要など）は史実ではありません。</p>
    <ul class="gsources">${J.SOURCES.map(([k, name, url]) => `<li><b>${k}</b> ${A.esc(name)}${url ? `<br><small>${A.esc(url)}</small>` : ''}</li>`).join('')}</ul>
    <p class="small">地図：Natural Earth（1:10m。パブリックドメイン）。主な島だけを描いています。地点の位置はおおよそです。</p>`,
  );
}

// 周波数の選択（1.6.0：系統ごと）。まだ周波数のない網に、交流の発電機を初めて建てるとき。建てるとその網の周波数になる
function hzDialog(after) {
  sheet(
    `<h2>周波数を選ぶ</h2>
    <p>交流の発電機を、どこから買うか。建てると<b>この網（線でつながった範囲）の周波数</b>になり、あとから変えられません。周波数の違う網とは、線でつなげません。</p>
    <div class="gbtns2">
      <button class="btn big" data-hz="50">ドイツ製<small>50 Hz</small></button>
      <button class="btn big" data-hz="60">アメリカ製<small>60 Hz</small></button>
    </div>
    <p class="small">史実：1895年、東京の浅草の火力がドイツ製の 50 Hz、1897年、大阪の幸町がアメリカ製の 60 Hz の発電機を入れたことが、今の東西の周波数の違いの始まり（S1・S2。確かめた）。どちらを選んでも性能は同じで、違いが効くのは網どうしをつなぐとき。</p>`,
    ({ onAll, close }) =>
      onAll('[data-hz]', 'click', async (e) => {
        if (B?.kind === 'plant') B.hz = Number(e.currentTarget.dataset.hz);
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
      onAll('[data-build]', 'click', () => pay(q, '進相コンデンサ', () => Gm.addCap(g, lc, loadId), null, 'cap'));
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
        const back = Gm.removeAsset(g, kind, id);
        await save();
        close();
        if (sel?.id === id || (sel && kind !== 'line' && !Mn.removables(G(), sel.id).length)) sel = null;
        screen();
        act('remove', { name, back });
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
      <button class="btn" data-circ>回線を増やす<small>${qc.ok ? `${A.num(qc.cost)} コイン` : A.esc(qc.why)}</small></button>
      <button class="btn" data-rm>撤去</button>
    </div>`,
    bind: ({ onAll }) => {
      onAll('[data-circ]', 'click', () => circuitDialog(id));
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
        act('priority', { first: gg.plants.find((p) => p.id === gg.priority[0]) });
      };
      onAll('[data-up]', 'click', (e) => move(e.currentTarget.dataset.up, -1));
      onAll('[data-down]', 'click', (e) => move(e.currentTarget.dataset.down, 1));
      onAll('[data-idle]', 'click', async (e) => {
        const p = gg.plants.find((x) => x.id === e.currentTarget.dataset.idle);
        p.idle = !p.idle;
        await save();
        drawPanel(true);
        act('idle', p);
      });
      onAll('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':')));
      onAll('[data-reserve]', 'input', (e) => ($('[data-rv]').textContent = `${e.target.value}%`));
      onAll('[data-reserve]', 'change', async (e) => {
        gg.reserve = Number(e.target.value) / 100;
        await save();
        drawPanel(true);
        act('reserve', { value: gg.reserve });
      });
      onAll('input[name=fuel]', 'change', async (e) => ((gg.fuelPlan = e.target.value), await save(), act('fuel', { value: gg.fuelPlan })));
      onAll('input[name=maint]', 'change', async (e) => ((gg.maint = e.target.value), await save(), act('maint', { value: gg.maint })));
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
    if (Gm.freqNow(g)) {
      const FH = 70, r = 2.2;
      const FY = (x) => FH / 2 - (Math.max(-r, Math.min(r, x)) / r) * (FH / 2);
      const band = (a, b, col) => `<rect x="0" y="${FY(b)}" width="${W}" height="${FY(a) - FY(b)}" fill="${col}"/>`;
      chart += `<h3>周波数（基準からのずれ${Gm.hzList(g).length > 1 ? '。いちばん乱れている網' : `。${Gm.freqNow(g)} Hz`}）</h3>
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
      ${l ? `<p class="small">いま：需要 ${kw(l.demand)} ・ 届いた ${kw(l.served)} ・ 損失 ${kw(l.loss)}${Gm.freqNow(g) ? ` ・ 周波数 ${(Gm.freqNow(g) + l.x).toFixed(2)} Hz` : ''} ・ ${gridState(g).text}</p>` : ''}
      <h3>需要と電源（直近 ${hs.length}時間）</h3>
      ${chart}
      ${devMode() ? devSupplyHtml(g, lc) : ''}
      <h3>いまの系統</h3>
      <p class="spread grow"><span>需要の上限（学習で決まる）</span><b>${kw(o.dmax)}</b></p>
      <p class="small">Lv ${lc.level} ・ 定着 ${lc.mastered}問。お金では増えない。レベルと定着で広がる</p>
      <p class="spread grow"><span>受けている需要（契約）</span><b>${kw(o.accepted)}</b></p>
      <p class="spread grow"><span>これから24時間のピーク（予測）</span><b>${kw(o.peak)}</b></p>
      <p class="spread grow"><span>使える発電機の合計</span><b class="${o.cap < o.peak ? 'gneg' : ''}">${kw(o.cap)}</b></p>
      <p class="spread grow"><span>予備力の目標（${pct(g.reserve)}）</span><b>${kw(o.reserveKw)}</b></p>
      ${lc.gate.rel ? `<p class="small">最大の発電機1台分は ${kw(o.biggest)}。${o.reserveKw >= o.biggest ? '1台止まっても埋められる（N-1）' : '<b class="gneg">1台止まると埋めきれない</b>'}</p>` : `<p class="small">電力系統工学「信頼度指標」を1問正解すると、予備力の目安（最大の発電機1台分との比較）が出ます</p>`}
      ${Gm.freqNow(g) && K ? `<p class="spread grow"><span>系統定数 K</span><b>${kw(K)}/Hz</b></p><p class="small">Δf＝−ΔP/K。いまいちばん出力の大きい発電機（${kw(topOut)}）が止まると、余裕が足りていれば ${(topOut / K).toFixed(2)} Hz 下がる</p>` : ''}`,
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
  return `<div class="gdevbox"><h3>${DEV.demo ? "デモ" : "開発者モード"}：直近 ${d.hours}時間の収益の内訳</h3>
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
        <button class="btn primary" data-accept="${a.id}">受ける</button>${a.held ? '<span class="tag">保留中</span>' : `<button class="btn" data-hold="${a.id}">保留する</button>`}<span class="small">保留に罰はありません</span></div>`;
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
        const a = gg.apps.find((x) => x.id === e.currentTarget.dataset.accept);
        Gm.acceptApp(gg, a.id);
        await save();
        drawPanel(true);
        live();
        act('accept', a);
        tutEv('app:accept');
      });
      // 保留：申し込みは残す（いつでも受けられる）。印を付けて、下に回すだけ
      onAll('[data-hold]', 'click', async (e) => {
        const a = gg.apps.find((x) => x.id === e.currentTarget.dataset.hold);
        a.held = true;
        gg.apps = [...gg.apps.filter((x) => !x.held), ...gg.apps.filter((x) => x.held)];
        await save();
        drawPanel(true);
        act('hold', a);
      });
      onAll('[data-gonode]', 'click', (e) => (setPanel(null), openSel('node', e.currentTarget.dataset.gonode, true)));
      onAll('[data-goline]', 'click', (e) => (setPanel(null), openSel('line', e.currentTarget.dataset.goline, true)));
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
      <p class="small">島 ${g.islandNo}（${A.esc(Gm.placeName(g))}）${Gm.hzList(g).length ? ` ・ 周波数 ${Gm.hzList(g).join(' Hz と ')} Hz${Gm.hzList(g).length > 1 ? '（網ごと）' : ''}` : g.hz ? ` ・ 周波数 ${g.hz} Hz` : ' ・ 周波数はまだ決めていない'} ・ ${Math.floor(g.t / 24)}日目</p>
      ${(g.past || []).length ? `<p class="small">前の島：${g.past.map((p) => `島 ${p.islandNo}（${Gm.TERRAINS[p.terrain]?.name || ''}）${Math.floor(p.hours / 24)}日・最高の年間利益 ${p.best ? yen(p.best.profit) : '—'}`).join(' ／ ')}</p>` : ''}
      <p class="small">いつでも、明治の小さな島からやり直せます。時代（レベル）・設計図・性能の上乗せは引き継ぎ、この島の記録は残ります。この島の設備と収益はなくなり、使ったコインは戻りません。</p>
      <button class="btn" data-newisland>新しい島を選ぶ</button>
      <h3>そのほか</h3>
      <label class="row"><input type="checkbox" data-minion ${miniOn() ? 'checked' : ''}><span>小さなグラフを出す<small>上の帯の下に、直近24時間の需要と電源の出力・予備力の残り（押すと需給）</small></span></label>
      ${DEV.tut || DEV.demo ? '' : '<button class="btn gwide" data-tutagain>チュートリアルをもう一度</button>'}
      <p class="small">テーマ（シンプル／演出あり）は、ホームの「出題対象の設定」で変えられます。事故・出来事が起きたときの演出と収益の演出は、どちらのテーマでも出ます。演出ありでは、揺れ・光・音が少し強くなります（建設・時代が進んだとき・全域停電からの復旧にも音と光）。</p>
      ${versionHtml()}`,
    bind: ({ onAll }) => {
      onAll('[data-rebuild2]', 'click', rebuildDialog);
      onAll('[data-newisland]', 'click', islandDialog);
      onAll('[data-tutagain]', 'click', startTutorial);
      onAll('[data-minion]', 'change', async (e) => {
        await setMini(e.target.checked);
        screen();
      });
      bindVersion(onAll);
    },
  };
}

// ---- 事故の問題：選択肢4つ。「わからない」は出さない。回答は回答記録（mode「系統」のセッション）に入れる。開発者モードでは残さない ----
function incidentScreen(id) {
  const { S } = A;
  const g = G();
  const inc = g.incidents.find((x) => x.id === id);
  const q = inc && S.data?.questions.find((x) => x.questionId === inc.qid);
  if (inc && !q && DEV.demo) return demoNoQuestion(inc);
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
  tutEv('inc:open');
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
    <section class="card geffect"><p>${A.esc(text || '')}</p>${DEV.on ? `<p class="small">${DEV.tut ? '練習の島' : DEV.demo ? 'デモ' : '開発者モード'}：回答記録には残りません</p>` : correct ? '<p class="small">コイン +100（同じ問題は1日1回まで）</p>' : ''}</section>
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
      A.on('[data-next]', 'click', async () => {
        await screen(g.incidents.length ? 'list' : null);
        act('incident', { title: Gm.INCIDENTS[inc.key].title, correct });
        tutEv('inc:back');
      });
    },
  );
  tutEv('inc:answer');
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
        screen(null);
        act('island', { terrain: G().terrain });
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
        act('loan');
      });
      onAll('[data-sellgo]', 'click', async () => {
        const sel = [...dlg.querySelectorAll('[data-sell]:checked')].map((x) => x.dataset.sell.split(':'));
        if (!sel.length) return A.toast('手放す設備を選んでください');
        const back = Gm.rebuildSell(g, sel);
        Gm.addReport(g, { title: '設備を手放した', what: `${sel.length}件を手放し、${yen(back)} が収益に戻った。`, units: [] });
        await save();
        close();
        screen();
        act('sell', { count: sel.length, back });
        if (g.rebuild) A.toast('まだ残高がマイナスです');
      });
    },
  );
}

// ---- 1.5.2 チュートリアル：案内の文字だけ。押す場所だけを明るくし（スポットライト）、近くに吹き出し ----
// 手順は gridmenu.js の TUTORIAL（対象・文・進む条件の配列）。練習の島は本番とは別の系統（kv「gridTutorial」）で、
// 本番の kv「grid」・回答記録・コイン（gachaLog）・称号などには書かない（書き込みはすべて makeStore を通る）。終わったら消す
const T = { i: 0, hasInc: false, offered: false, until: 0, raf: 0, scrolled: -1 };
async function offerTutorial() {
  if (DEV.on || T.offered) return;
  T.offered = true;
  A.db.delKV(Mn.TUT_KEY); // 途中で閉じたときの練習の島が残っていれば消す
  if (await A.db.getKV(Mn.TUT_SEEN)) return;
  await A.db.putKV(Mn.TUT_SEEN, new Date().toISOString());
  if (Mn.isFreshGrid(A.S.grid)) return startTutorial(); // 動く系統を初めて開いたとき
  // すでに本番の系統がある人には1回だけ聞く
  sheet(
    `<h2>チュートリアル</h2>
    <p>動く系統の動かし方を、練習の島でひととおり試せます（5分ほど）。本番の系統・コイン・記録は変わりません。</p>
    <div class="gbtns2"><button class="btn" data-later>あとで</button><button class="btn primary" data-tutgo>チュートリアルを見る</button></div>
    <p class="small">あとからでも、経営のパネルの「チュートリアルをもう一度」で見られます。</p>`,
    ({ onAll, close }) => {
      onAll('[data-later]', 'click', close);
      onAll('[data-tutgo]', 'click', () => (close(), startTutorial()));
    },
  );
}
async function startTutorial() {
  if (DEV.running) return;
  if (DEV.on && !DEV.tut) {
    await save(); // 開発者モードからは、開発者の系統を保存してから
    DEV.on = false;
  }
  document.querySelector('.modal.gsheet')?.remove();
  DEV.state = Mn.tutorialState(Date.now());
  DEV.key = Mn.TUT_KEY;
  DEV.tut = true;
  DEV.on = true;
  summary = null;
  B = null;
  sel = null;
  panel = null;
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  T.hasInc = false;
  await save();
  await A.db.putKV(Mn.TUT_SEEN, new Date().toISOString());
  await screen(null);
  tutGo(0);
}
async function endTutorial() {
  if (!DEV.tut) return;
  DEV.on = false;
  DEV.tut = false;
  DEV.key = Dv.DEV_KEY;
  DEV.state = DEV.devState || null;
  document.querySelector('.gtut')?.remove();
  document.querySelector('.modal.gsheet')?.remove();
  await A.db.delKV(Mn.TUT_KEY);
  summary = null;
  B = null;
  sel = null;
  panel = null;
  await sync();
  await screen(null);
  band('チュートリアルを終えて、本番の系統に戻った');
}
// 手順の前後にすること（練習の島の時間をとばす・申し込み・事故）
async function tutAction(name) {
  if (name === 'finish') return endTutorial();
  const g = G(), lc = learningNow();
  if (name === 'toEvening' && panel) setPanel(null);
  const before = Mn.underWork(g);
  const r = Mn.tutorialAction(g, lc, name, (n) => Dv.advance(g, lc, n, DEV.state.money));
  if (name === 'raiseInc') T.hasInc = r.ok;
  await save();
  if (onGrid()) {
    if (name === 'spawnApp' || name === 'raiseInc') live();
    else await screen();
    announceDone(g, before);
  }
}
async function tutGo(i) {
  if (!tutOn()) return;
  T.i = i;
  T.scrolled = -1;
  const st = Mn.TUTORIAL[i];
  if (!st) return endTutorial();
  if (st.need === 'incident' && st.before !== 'raiseInc' && !T.hasInc) return tutGo(i + 1);
  if (st.before) await tutAction(st.before);
  if (st.need === 'incident' && !T.hasInc) return tutGo(i + 1);
  DEV.state.step = i;
  tutDraw();
}
// 画面から知らせる出来事（menu:T1・branch:build・bmode:plant・built:plant・line:to・panel:list・app:accept・inc:open など）
function tutEv(name) {
  if (!tutOn()) return;
  const st = Mn.TUTORIAL[T.i];
  if (st?.on === name) setTimeout(() => tutGo(T.i + 1), 60);
}
function tutDraw() {
  const st = Mn.TUTORIAL[T.i];
  let el = document.querySelector('.gtut');
  if (!el) {
    el = document.createElement('div');
    el.className = 'gtut';
    document.body.append(el);
  }
  const nextLabel = st.next ? (typeof st.next === 'string' ? st.next : '次へ') : '';
  el.innerHTML = `<div class="gtsh" data-sh="t"></div><div class="gtsh" data-sh="b"></div><div class="gtsh" data-sh="l"></div><div class="gtsh" data-sh="r"></div><div class="gtring" hidden></div>
    <div class="gtbub" role="dialog" aria-live="polite"><p>${A.esc(st.text)}</p>
      <div class="gtbtns"><button class="btn small" data-tskip>${st.after === 'finish' ? '' : 'とばす'}</button><span class="gtno">${T.i + 1} / ${Mn.TUTORIAL.length}</span>${nextLabel ? `<button class="btn primary small" data-tnext>${A.esc(nextLabel)}</button>` : '<span class="gtwait" data-twait hidden></span>'}</div></div>`;
  el.querySelector('[data-tskip]').onclick = () => (st.after === 'finish' ? null : tutSkipDialog());
  if (st.after === 'finish') el.querySelector('[data-tskip]').hidden = true;
  const nx = el.querySelector('[data-tnext]');
  if (nx)
    nx.onclick = async () => {
      nx.disabled = true;
      if (st.after) await tutAction(st.after);
      if (st.after !== 'finish') tutGo(T.i + 1);
    };
  T.until = Date.now() + 1200;
  tutPlace();
}
function tutSkipDialog() {
  const el = document.querySelector('.gtbub');
  if (!el || el.querySelector('[data-tquit]')) return;
  const box = document.createElement('div');
  box.className = 'gtq';
  box.innerHTML = '<p class="small">チュートリアルをやめて、本番の系統に戻りますか。</p><div class="gtbtns"><button class="btn small" data-tstay>続ける</button><button class="btn small primary" data-tquit>やめる</button></div>';
  el.append(box);
  box.querySelector('[data-tstay]').onclick = () => box.remove();
  box.querySelector('[data-tquit]').onclick = endTutorial;
}
// スポットライトの位置：対象のまわりだけ穴をあけ、ほかは暗くして押せなくする。吹き出しは対象の上か下
function tutPlace() {
  const el = document.querySelector('.gtut');
  if (!el || !tutOn()) return;
  const st = Mn.TUTORIAL[T.i];
  if (!st) return;
  const W = window.innerWidth, H = window.innerHeight;
  let tgt = st.target ? document.querySelector(st.target) : null;
  if (tgt && T.scrolled !== T.i) {
    T.scrolled = T.i;
    if (tgt.closest('.gpin, .gdetail, .gbcard') || !tgt.closest('.gscreen')) tgt.scrollIntoView?.({ block: 'nearest' });
  }
  let r = tgt?.getBoundingClientRect();
  if (r && (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > H)) r = null;
  const R = Math.round;
  const sh = (k, x, y, w, h) => Object.assign(el.querySelector(`[data-sh="${k}"]`).style, { left: `${R(x)}px`, top: `${R(y)}px`, width: `${Math.max(0, R(x + w) - R(x))}px`, height: `${Math.max(0, R(y + h) - R(y))}px` });
  const ring = el.querySelector('.gtring');
  const bub = el.querySelector('.gtbub');
  const wait = el.querySelector('[data-twait]');
  if (!r) {
    // 対象がない（説明だけ・まだ出ていない）：全体を暗くして、吹き出しを真ん中に
    sh('t', 0, 0, W, H);
    sh('b', 0, 0, 0, 0);
    sh('l', 0, 0, 0, 0);
    sh('r', 0, 0, 0, 0);
    ring.hidden = true;
    bub.style.left = `${Math.round((W - bub.offsetWidth) / 2)}px`;
    bub.style.top = `${Math.round((H - bub.offsetHeight) / 2)}px`;
    bub.style.bottom = 'auto';
    // 押す場所が見つからないまま 1.5 秒たったら、「次へ」で進めるようにする（止まらないように）
    if (st.target && wait && !el.querySelector('[data-tnext]')) {
      clearTimeout(T.lost);
      T.lost = setTimeout(() => {
        if (Mn.TUTORIAL[T.i] !== st || document.querySelector(st.target)) return;
        wait.outerHTML = '<button class="btn primary small" data-tnext>次へ</button>';
        el.querySelector('[data-tnext]').onclick = () => tutGo(T.i + 1);
      }, 1500);
    }
  } else {
    const pad = 6;
    const x0 = Math.max(0, r.left - pad), y0 = Math.max(0, r.top - pad), x1 = Math.min(W, r.right + pad), y1 = Math.min(H, r.bottom + pad);
    sh('t', 0, 0, W, y0);
    sh('b', 0, y1, W, H - y1);
    sh('l', 0, y0, x0, y1 - y0);
    sh('r', x1, y0, W - x1, y1 - y0);
    ring.hidden = false;
    Object.assign(ring.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    const bw = bub.offsetWidth, bh = bub.offsetHeight;
    const cx = (x0 + x1) / 2;
    const left = Math.min(Math.max(12, cx - bw / 2), W - 12 - bw);
    bub.style.left = `${Math.round(left)}px`;
    // 吹き出しの縦の位置：対象のすぐ上か下。地点のメニューに重なるなら、画面の上か下の端へ（ほかのボタンを隠さない）
    const avoid = [[x0, y0, x1, y1], ...[...document.querySelectorAll('.gmenu .gmi')].map((b) => {
      const q = b.getBoundingClientRect();
      return [q.left, q.top, q.right, q.bottom];
    })];
    const hits = (t) => avoid.some(([a, b, c, d]) => left < c && left + bw > a && t < d && t + bh > b);
    const ok = (t) => t >= 8 && t + bh <= H - 8;
    const near = (y0 + y1) / 2 > H / 2 ? [y0 - 12 - bh, y1 + 12] : [y1 + 12, y0 - 12 - bh];
    const far = (y0 + y1) / 2 > H / 2 ? [64, H - bh - 72] : [H - bh - 72, 64];
    const top = [...near, ...far].find((t) => ok(t) && !hits(t)) ?? near.find(ok) ?? H - bh - 8;
    bub.style.top = `${Math.round(Math.min(Math.max(8, top), H - bh - 8))}px`;
    bub.style.bottom = 'auto';
  }
}
// 画面が変わったら（描き直し・パネルのせり上がり）、しばらく位置を追いかける
function tutFollow() {
  if (!tutOn()) return;
  T.until = Math.max(T.until, Date.now() + 500);
  if (T.raf) return;
  const loop = () => {
    tutPlace();
    T.raf = Date.now() < T.until && tutOn() ? requestAnimationFrame(loop) : 0;
  };
  T.raf = requestAnimationFrame(loop);
}
new MutationObserver(() => tutOn() && tutFollow()).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', () => tutOn() && tutFollow());

// ---- 開発者モード（1.5.1）：経営のパネルのバージョン番号を5回押すと入る。本番とは別の系統（kv「gridDev」）で動かす ----
function versionHtml() {
  return `<p class="note center"><button class="link gver" data-ver>版 ${A.esc(window.APP_VERSION || '')}</button></p>`;
}
function bindVersion(onAll) {
  onAll('[data-ver]', 'click', () => {
    if (DEV.tut) return;
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
  DEV.state = Dv.normalize(DEV.devState || (await A.db.getKV(Dv.DEV_KEY)), now);
  DEV.devState = DEV.state;
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
// ---- 1.5.3 デモ：問題データなしで試す（データ管理の「動く系統を試す（デモ）」、URL の ?demo）。kv「gridDemo」 ----
// 本番の kv「grid」・回答記録・コイン（gachaLog）などには書かない（書き込みはすべて makeStore を通る）
export const wantsDemo = Dv.wantsDemo;
export async function enterDemo() {
  if (DEV.running) return;
  if (DEV.on) await save();
  const now = Date.now();
  DEV.state = Dv.normalize(await A.db.getKV(Dv.DEMO_KEY), now);
  DEV.state.grid.realAt = now; // デモの系統は、開いている間だけ進む
  Object.assign(DEV, { on: true, tut: false, demo: true, key: Dv.DEMO_KEY });
  summary = null;
  B = null;
  sel = null;
  panel = null;
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  await save();
  await screen(null);
}
async function exitDemo() {
  if (DEV.running) return A.toast('早送りの途中です');
  leaveGrid();
  await save();
  Object.assign(DEV, { on: false, demo: false, key: Dv.DEV_KEY, state: DEV.devState || null });
  summary = null;
  B = null;
  sel = null;
  panel = null;
  document.querySelector('.modal.gsheet')?.remove();
  A.home();
}
// デモで「対処を選ぶ」：問題データがないので問題は出さない（標準の被害で片づける）
function demoNoQuestion(inc) {
  sheet(
    `<h2>${A.esc(Gm.INCIDENTS[inc.key].title)}</h2>
    <p class="small">${A.esc(inc.what || '')}</p>
    <p>デモでは問題が出ません。本番では、ここで4択の対処を選びます（正しいと被害が小さく、誤ると大きくなります）。</p>
    <button class="btn primary gwide" data-settle>標準の被害で片づける</button>
    <p class="small">閉じると、ゲームの1日たったときに標準の被害で片づきます。</p>`,
    ({ onAll, close }) =>
      onAll('[data-settle]', 'click', async () => {
        Dv.settleIncident(G(), inc.id);
        await save();
        close();
        await screen();
        act('incident', { title: Gm.INCIDENTS[inc.key].title, settled: true });
      }),
  );
}
const devSpeedText = () => `${DEV.state.opts.speed ? `×${DEV.state.opts.speed}` : '停止中'} ・ 操作`;
function devBand() {
  if (DEV.demo)
    return `<div class="gdevband gdemoband"><span><b>デモ（記録には残りません）</b><small>問題データなしで試せます</small></span>
    <span class="gdevbtns"><button class="btn small" data-devops>${devSpeedText()}</button><button class="btn small" data-devout>抜ける</button></span></div>`;
  if (DEV.tut) return '<div class="gdevband gtutband"><span><b>チュートリアル（練習の島）</b><small>本番の系統・コイン・記録は変わりません</small></span></div>';
  if (!DEV.on) return '';
  return `<div class="gdevband"><span><b>開発者モード</b><small>本番の記録には影響しません</small></span>
    <span class="gdevbtns"><button class="btn small" data-devops>${devSpeedText()}</button><button class="btn small" data-devout>抜ける</button></span></div>`;
}
function bindDevBand() {
  A.on('[data-devops]', 'click', devSheet);
  A.on('[data-devout]', 'click', () => (DEV.demo ? exitDemo() : exitDev()));
}
// 現実の時刻に合わせて開発者の系統を進める（×10・×100 は1秒ごとに見る）
async function devTick() {
  if (!DEV.on || DEV.tut || DEV.running || document.hidden || (!A?.S.data && !DEV.demo)) return;
  const g = G();
  const n = Dv.dueSteps(g, Date.now(), DEV.state.opts.speed);
  if (!n) return;
  const before = Mn.underWork(g);
  Dv.advance(g, learningNow(), n, DEV.state.money);
  if (onGrid()) announceDone(g, before);
  collectAlerts();
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
  const g = G(), o = DEV.state.opts, real = learningBase(), lc = learningNow();
  const perfNow = Math.round((o.perf ?? 0) * 100);
  const incs = Object.entries(Gm.INCIDENTS).map(([k, D]) => `<option value="${k}">${A.esc(D.title)}</option>`).join('');
  const evs = Object.entries(Gm.EVENTS).map(([k, E]) => `<option value="${k}">${A.esc(E.name)}（${A.esc(E.text)}）</option>`).join('');
  sheet(
    `<h2>${DEV.demo ? 'デモの操作' : '開発者モードの操作'}</h2>
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
    <p class="small">いま：Lv ${lc.level} ・ ${eraName(lc.era)} ・ 定着 ${lc.mastered}問 ・ 需要の上限 ${kw(lc.dmax)}${DEV.demo ? '' : `（本番の記録は Lv ${real.level}・定着 ${real.mastered}問）`}</p>
    <button class="btn small" data-devreal>${DEV.demo ? '最初の値に戻す' : '本番の記録の値に戻す'}</button>
    <h3>事故・出来事をすぐ起こす</h3>
    <div class="grow gpick"><select data-inckey>${incs}</select><button class="btn small" data-incgo>起こす</button></div>
    <div class="grow gpick"><select data-evkey>${evs}</select><button class="btn small" data-evgo>起こす</button></div>
    <p class="small">${DEV.demo ? 'デモでは事故の問題は出ません（標準の被害で片づきます）。' : '事故の問題も解けます（回答記録には残りません。正誤だけをゲームに反映します）。'}対象の設備がなければ、対象なしで起きます。</p>
    <h3>系統のリセット</h3>
    <div class="gseg">${Object.entries(Gm.TERRAINS).map(([k, T]) => `<button class="btn small" data-devreset="${k}">${T.name}</button>`).join('')}</div>
    <p class="small">選んだ地形で、${DEV.demo ? 'デモ' : '開発者'}の系統を最初からやり直します（本番の系統は変わりません）。</p>`,
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
      $('[data-coins]').onchange = (e) => set(e.target.checked ? { coins: 'unlimited' } : { coins: 'limited', devCoins: o.devCoins || (DEV.demo ? 100000 : A.walletNow().balance) });
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
        const r = Dv.triggerIncident(G(), learningNow(), $('[data-inckey]').value, DEV.demo ? 'デモ' : '開発者モード');
        await save();
        if (!r.ok) return A.toast(r.why);
        close();
        await screen();
        collectAlerts(); // 1.5.3：起きたときの演出（暗転 → 絵 → 赤い太字）から「対処を選ぶ」
      });
      onAll('[data-evgo]', 'click', async () => {
        const r = Dv.triggerEvent(G(), learningNow(), $('[data-evkey]').value);
        await save();
        if (!r.ok) return A.toast(r.why);
        close();
        await screen();
        collectAlerts();
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
  const before = Mn.underWork(G());
  try {
    await Dv.run(G(), learningNow(), n, { money: DEV.state.money, onProgress: prog, chunk: 300 });
    G().realAt = Date.now();
    await save();
  } finally {
    DEV.running = false;
  }
  document.querySelector('.modal.gsheet')?.remove();
  await screen();
  announceDone(G(), before);
  collectAlerts();
  if (!AL.busy) devSheet(); // 起きたことの演出があれば、そちらを先に
}
