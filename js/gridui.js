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
import { JAPAN_BOUNDS, JAPAN_HZ_LINE } from './japan.js';
import { JAPAN_TERRAIN, JAPAN_PREF_LINES, JAPAN_PREFS } from './japan_terrain.js';
import * as Mg from './mapgeo.js';
import * as Mc from './mapcanvas.js';
import * as Rc from './gridrec.js';
import * as J from './gridjapan.js';
import * as Ms from './gridmission.js';
import * as Tw from './gridtown.js';

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
let listTab = 'list'; // 1.8.0 一覧のパネルのタブ：list（一覧）／mission（ミッション。史実モードだけ）
let econTab = '7d'; // 1.10.2 収支のまとめのタブ：7d（直近7日の1日あたり）／1d（昨日）
let townView = null; // 1.10.3 「町を見る」画面を開いている町の ID（null＝地図）
let townNeedMapSync = false; // 町を見る画面を開いている間に時間が進んだ印（戻ったときに地図を最新化）
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
  const key = `${S.logs.length}|${S.data?.importedAt}|${S.data?.questions.length}|${S.gridMode}`;
  // 1.8.0：性能の上乗せの最大値は両モードで共通（2つの系統の大きいほう）
  if (!lcCache || lcCache.key !== key) lcCache = { key, lc: Gm.learning(S.logs, S.data, Gm.maxPerf(S.grid?.perfMax, S.gridOther?.perfMax)) };
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
    S.grid = Gm.newJapan((now % 2147483647) | 0, now); // 1.6.0：新しく始める人は日本列島の東京（日本橋）から
    S.grid.era = learningReal().era; // 最初から、いまのレベルの時代で始まる（「時代が進んだ」は出さない）
    fresh = true;
  }
  const era = S.grid.era;
  const steps = Gm.catchUp(S.grid, learningReal(), now);
  if (steps > 0 || fresh || S.grid.era !== era) await A.db.putKV(Dv.gridKey(S.gridMode), S.grid); // 1.8.0：いまのモードの系統だけ進める（もう一方は止めておく）
  await recordNow();
  return steps;
}
// 1.8.0 バックアップに入れる系統（史実 grid・自由 gridFree・いまのモード gridMode）。1.8.2 系統の記録 gridRecord も
export const backupGrids = () => ({ ...Dv.backupGrids(A.S), ...(A.S.gridRec ? { gridRecord: A.S.gridRec } : {}) });

// ---- 1.8.2 系統の記録（kv「gridRecord」）：絵のアルバムと、系統で初めて起きたこと（称号の種類 grid）----
// 本番の系統だけ（チュートリアル・デモ・開発者モードで出た絵・起きたことは数えない）。初めて作るときは、今までの系統からわかるものを取り込む
const todayStr = () => L.localDate(new Date());
function rec() {
  const S = A.S;
  if (!S.gridRec || S.gridRec.v !== 1 || !S.gridRec.album) S.gridRec = Rc.normalizeRec(S.gridRec);
  return S.gridRec;
}
let recBusy = false;
async function recordNow() {
  const S = A.S;
  if (!S.grid || recBusy) return;
  recBusy = true;
  try {
    const r = rec();
    const imp = Rc.importPast(r, [S.grid, S.gridOther], todayStr());
    const fresh = Rc.recordGrid(r, S.grid, todayStr());
    // 建てた設備の種類の絵（詳細の見出し・建設で出る）と、いまの時代までの時代の絵（時代の演出・上の帯）
    const t = S.grid.t;
    const ids = [...S.grid.plants.filter((p) => p.readyAt <= t).map((p) => PIC[p.type]), ...S.grid.lines.filter((l) => l.readyAt <= t).map((l) => Mn.LINE_PIC[l.kind]), ...(S.grid.subs.some((x) => x.readyAt <= t) || (S.grid.convs || []).some((x) => x.readyAt <= t) ? ['G10'] : []), ...Array.from({ length: Math.min(S.grid.era, Gm.MAX_ERA) }, (_, i) => PIC[`era${i + 1}`])];
    const pics = ids.filter((id) => Rc.seePic(r, id, todayStr())).length;
    if (imp || fresh.length || pics) await recSaved();
  } finally {
    recBusy = false;
  }
}
// 保存して、新しく手に入った称号を知らせる
async function recSaved() {
  await A.db.putKV('gridRecord', rec());
  const got = await A.syncCollection();
  for (const t of got?.titles || []) {
    if (onGrid()) band(`称号「${t.name}」を手に入れた`);
    else A.toast(`称号「${t.name}」を手に入れた`);
  }
}
// 絵に出会った（演出・見出しで実際に出たとき）。本番の系統のときだけ
function seen(id) {
  if (DEV.on || !id || !A.S.grid) return;
  if (Rc.seePic(rec(), id, todayStr())) recSaved();
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
const PIC = { era1: 'G01', era2: 'G02', era3: 'G03', era4: 'G04', era5: 'G23', era6: 'G24', dcCoal: 'G05', acCoal: 'G06', bigCoal: 'G07', oilFire: 'G07', ror: 'G08', pond: 'G09', dam: 'G09', sub: 'G10', rotary: 'G10', mercury: 'G10', line: 'G11', heat: 'G12', cold: 'G13', typhoon: 'G14', snowstorm: 'G15', coalSpike: 'G16', priceWar: 'G17', drought: 'G18', blackout: 'G19', recover: 'G20', rebuild: 'G21', island: 'G22', load_lamp: 'G25', load_home: 'G26', load_cool: 'G26', load_shop: 'G27', load_factory: 'G28', load_tram: 'G27', M01: 'G29', M02: 'G30', M03: 'G31', M04: 'G32', M05: 'G33', M06: 'G34', M07: 'G35', M08: 'G36' };
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
const PH_OF = { dcCoal: 'coal', acCoal: 'coal', bigCoal: 'coal', oilFire: 'coal', ror: 'hydro', pond: 'hydro', dam: 'hydro', sub: 'sub', rotary: 'sub', mercury: 'sub', line: 'line', era1: 'town', era2: 'town', era3: 'town', era4: 'town', era5: 'town', era6: 'town', heat: 'light', cold: 'storm', typhoon: 'storm', snowstorm: 'storm', coalSpike: 'coal', priceWar: 'town', drought: 'hydro', blackout: 'dark', recover: 'light', rebuild: 'town', island: 'hydro', load_lamp: 'light', load_home: 'town', load_cool: 'town', load_shop: 'town', load_factory: 'coal', load_tram: 'town' };
// 上の帯の背景に、時代の絵を薄く（絵がないときは出さない）
const eraImg = (g) => {
  const src = picSrc(PIC[`era${g.era}`]);
  return src ? `--eraimg:url('${src}')` : '';
};
// 1.8.2 番号 → 画像（なければ代わりの絵の番号の画像）
const picSrc = (id) => GRID_IMAGES[id] || GRID_IMAGES[Mn.PIC_FALLBACK[id]] || '';
// 1.8.2 詳細の見出しの絵：町はいまの時代の町の絵、発電所がある地点はいちばん大きい発電所の種類の絵、水力の地点・石炭の用地で発電所がないときは G08・G06。
// 線は線の階級の絵。切れている・事故中なら、その事故の絵
const LINE_DOWN_PIC = { thunder: 'I01', coast: 'I02', snow: 'I03', other: 'I06', over: 'I06' };
function headPic(g, kind, id) {
  let k = null;
  if (kind === 'node') {
    const n = Gm.nodeOf(g, id);
    if (!n) return null;
    const plants = g.plants.filter((p) => p.site === id);
    if (plants.length) k = PIC[plants.reduce((a, b) => (b.kw > a.kw ? b : a)).type];
    else if (n.town) k = PIC[`era${Math.min(g.era, Gm.MAX_ERA)}`];
    else k = n.hydro ? 'G08' : 'G06';
  } else {
    const l = g.lines.find((x) => x.id === id);
    if (!l) return null;
    const inc = g.incidents.find((i) => i.line === l.id);
    const down = l.readyAt <= g.t && Gm.lineCircuits(l, g.t) < l.n;
    k = inc ? Mn.INC_PIC[inc.key] : l.hzTrip ? 'I04' : down ? LINE_DOWN_PIC[l.downCause] || 'I06' : Mn.LINE_PIC[l.kind];
  }
  return k && picSrc(k) ? k : null;
}
// 1.8.2 絵を大きく見る（見出しの帯・絵のアルバム）。何の絵か・初めて出会った日
function picViewer(id) {
  const d = rec().album[id];
  const ov = document.createElement('div');
  ov.className = 'goverlay gview';
  ov.innerHTML = `<div class="gviewin"><img src="${picSrc(id)}" alt="${A.esc(Rc.albumName(id))}"><p><b>${id}</b> ${A.esc(Rc.albumName(id))}</p>${d ? `<p class="small">初めて出会った日：${d.split('-').map(Number).join('/')}</p>` : ''}<button class="btn primary" data-close>閉じる</button></div>`;
  document.body.append(ov);
  const close = () => ov.remove();
  ov.querySelector('[data-close]').onclick = close;
  ov.addEventListener('click', (e) => e.target === ov && close());
}
// 1.8.2 絵のアルバム（G・I・L の 32 枚）：出会った絵は表示、まだの絵は影と「？」。押すと大きく見られる
function albumSheet() {
  const r = rec();
  const n = Rc.albumCount(r);
  const cells = Rc.ALBUM.map(([id, name]) => (r.album[id] ? `<button class="galb" data-alb="${id}" aria-label="${A.esc(name)}"><img src="${picSrc(id)}" alt="" loading="lazy"><small>${id}</small></button>` : `<span class="galb no" aria-label="まだ出会っていない絵"><img src="${picSrc(id)}" alt="" loading="lazy"><b>？</b><small>${id}</small></span>`)).join('');
  sheet(
    `<h2>絵のアルバム（${n}／${Rc.ALBUM.length}）</h2>
    <p class="small">時代に入ったとき・出来事や事故が起きたとき・その種類の設備を建てたときなど、演出や詳細の見出しで出た絵が集まる（史実モード・自由モード共通。チュートリアル・デモ・開発者モードの分は数えない）。押すと大きく見られる。</p>
    <div class="galbum">${cells}</div>`,
    ({ onAll }) => onAll('[data-alb]', 'click', (e) => picViewer(e.currentTarget.dataset.alb)),
  );
}
function pic(key, cls = '') {
  const src = GRID_IMAGES[PIC[key]];
  if (src) return `<span class="gpic ${cls}"><img src="${src}" alt=""></span>`;
  return `<span class="gpic ph ${cls}"><svg viewBox="0 0 48 36" aria-hidden="true">${PH[PH_OF[key]] || ''}</svg></span>`;
}
// 1.6.1 線の階級ごとの絵（L01〜L03・G11。L の絵がない間は G11、それもなければ仮の絵）
function linePic(kind, cls = 'mini') {
  const id = Mn.LINE_PIC[kind];
  const src = GRID_IMAGES[id] || GRID_IMAGES[Mn.PIC_FALLBACK[id]];
  if (src) return `<span class="gpic ${cls}"><img src="${src}" alt=""></span>`;
  return `<span class="gpic ph ${cls} gline-ic"><svg viewBox="0 0 48 36" aria-hidden="true">${PH.line}</svg></span>`;
}

// ---- ホームのカード（いつも本番の系統） ----
export function homeCard() {
  const g = A.S.grid;
  if (!g) return '';
  const o = Gm.overview(g, learningReal());
  const chips = [g.rebuild ? '<span class="tag gng">経営再建</span>' : '', g.incidents.length ? `<span class="tag gng">事故の対処待ち ${g.incidents.length}件</span>` : '', g.apps.length ? `<span class="tag">申し込み ${g.apps.length}件</span>` : ''].join('');
  const bg = eraImg(g); // 1.8.2 いまの時代の絵を薄く（上の帯と同じ絵）
  return `<button class="mapcard gridcard${bg ? ' hasimg' : ''}" data-go="grid" style="${bg}">
      <span class="spread"><b>動く系統<i class="gmodetag m-${Gm.modeOf(g)}">${Gm.MODES[Gm.modeOf(g)].tag}</i></b><span class="go">開く ›</span></span>
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
      <div class="gtownview" data-townview hidden></div>
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
        townView = null;
        A.home();
      });
      A.on('[data-hud]', 'click', (e) => (e.target.closest('[data-hstate]') ? nowSheet() : togglePanel('supply')));
      A.on('[data-mini]', 'click', () => togglePanel('supply'));
      bindChips();
      yenFx = Mn.yenFxState(g);
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
      if (townView && Gm.nodeOf(g, townView)?.town) showTownViewDom(true);
      else townView = null;
      syncWaveBaseline(g);
      effects(g);
      drainFreshLit(g);
      tutPlace();
      if (entering || AL.g !== G()) markSeen(); // 閉じていた間に起きたもの・切り替えた系統のものは、演出ではなく前回からの結果・状態の札で
      if (entering) offerTutorial();
      drainAlerts();
      drainMissions(); // 1.8.0 閉じていた間に達成したミッションも、開いたときに答え合わせのカード
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
  checkWave(g);
  drainFreshLit(g);
  if (townView) {
    // 1.10.3 町を見る画面が開いている間は地図を描き直さず、町の画面だけ差分更新する
    townNeedMapSync = true;
    renderTownView(false);
    const bandEl = q('.gdevband [data-devops]');
    if (bandEl) bandEl.textContent = devSpeedText();
    if (!!g.rebuild !== !!q('[data-rebuild]')) screen();
    showYearSummary(g);
    drainMissions();
    return;
  }
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
  showYearSummary(g);
  drainMissions(); // 1.8.0
}

// ---- 上の帯：日付と時代・コイン・収益・需要と届いた量・周波数・状態（375px で2行まで） ----
function gridState(g) {
  const l = g.last;
  // 1.6.1：「まだ動いていない」は、発電所がないのか時間が止まっているのかが紛らわしかった。
  // 動いている発電所がない・まだ送っていないときは「発電なし」。まだ1時間も進んでいなくて時間が止まっている（開発者モードの停止）ときは「時間停止中」
  if (!l && DEV.on && !DEV.state.opts.speed) return { text: '時間停止中', cls: '' };
  if (!l || !g.plants.some((p) => p.readyAt <= g.t)) return { text: '発電なし', cls: l?.demand > 0 ? 'bad' : '' };
  if (Object.values(g.black).some((u) => u > g.t)) return { text: '全域停電', cls: 'bad' };
  if (l.shed) return { text: '負荷遮断', cls: 'bad' };
  if (l.demand - l.served > 0.01 * l.demand) return { text: '一部に届いていない', cls: 'bad' };
  if (Gm.freqNow(g) && Math.abs(l.x) > Gm.FREQ.ok) return { text: '周波数の乱れ', cls: 'warn' };
  return { text: '正常', cls: 'ok' };
}
// 1.8.0 上の帯の時代の横に、小さく「史実」「自由」（練習の東京では出さない）
const modeTag = (g) => (DEV.tut ? '' : `<i class="gmodetag m-${Gm.modeOf(g)}">${Gm.MODES[Gm.modeOf(g)].tag}</i>`);
function hudHtml(g) {
  const l = g.last;
  const st = gridState(g);
  // 需要と届いた量：単位がそろうときは1つにまとめる（例：需要 18.0／届 15.2 MW）
  const [dv, du] = kw(l?.demand || 0).split(' '), [sv, su] = kw(l?.served || 0).split(' ');
  const ds = du === su ? `需要 <b>${dv}</b>／届 <b>${sv}</b> ${du}` : `需要 <b>${dv}</b> ${du}／届 <b>${sv}</b> ${su}`;
  // 1.7.4：札（正常以外）を押すと「いま起きていること」（届いていない町と原因）。帯のほかの所は今までどおり需給
  const tap = st.cls === 'bad' || st.cls === 'warn';
  return `<span class="hr"><span class="hcell grow1">${eraName(g.era)}${modeTag(g)} ${timeShort(g)}</span><span class="hstate ${st.cls}"${tap ? ' data-hstate' : ''}>${st.text}${tap ? ' ›' : ''}</span></span>
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
  bindOutlook(pin);
}

// 時代が進んだとき・全域停電からの復旧・1年のまとめ（演出ありでは少し派手に）
function effects(g) {
  if (g.eraUp) {
    const E = Gm.ERAS[g.eraUp - 1];
    // 1.6.0：開いたエリアと、その時代の史実（確かめたものだけ。自分の選び方と比べられるように）
    const opened = Gm.openedAreas(g, g.eraUpFrom ?? g.eraUp - 1, g.eraUp);
    const ms = Gm.newMissions(g, g.eraUpFrom ?? g.eraUp - 1, g.eraUp); // 1.8.0 新しく出たミッション（史実モード）
    const lines = Gm.isJapan(g) ? [...(opened.length ? [`${opened.join('・')}が開いた（建てられる範囲が広がった）`] : []), ...(J.ERA_FACTS[g.eraUp] || []).map((f) => `史実：${f}`), ...ms.map((m) => `新しいミッション：${m.name}（一覧の「ミッション」）`)] : [];
    overlay(`era${g.eraUp}`, `時代が進んだ：${E.name}`, `新しい設備と需要が登場する。${g.eraUp === 2 && !Gm.hzList(g).length && !g.hz ? '交流の発電機を、まだ周波数のない網に初めて建てるとき、周波数（50 Hz／60 Hz）を選ぶ。' : ''}`, [523.3, 659.3, 784, 1046.5], lines);
    document.querySelector('.goverlay.gbig .gbigcap small')?.replaceChildren(E.year.replace('〜', '年〜'));
    delete g.eraUp;
    delete g.eraUpFrom;
    save();
  } else if (g.blackoutFx && !Object.values(g.black).some((u) => u > g.t)) {
    overlay('recover', '全域停電から復旧した', '町に明かりが戻った。予備力の目標と、最大の発電機1台分を見比べてみよう。', [392, 523.3, 659.3], [], () => triggerWave(g, 'lit'));
    delete g.blackoutFx;
    save();
  } else {
    showYearSummary(g);
  }
}
// lines：本文の下に出す短い行（1.6.0：開いたエリア・その時代の史実）
// 1.8.2：絵を画面いっぱいに大きく。絵の上に名前と年、少しずつ寄っていく動き（演出あり。動きを減らす設定・シンプルでは止めた絵）。そのあと文と行
function overlay(picKey, title, text, notes, lines = [], onClose = null) {
  const ov = document.createElement('div');
  const src = picSrc(PIC[picKey]);
  ov.className = `goverlay${src ? ' gbig' : ''}`;
  const body = `<h2>${A.esc(title)}</h2><p>${A.esc(text)}</p>${lines.length ? `<ul class="govlines">${lines.map((v) => `<li>${A.esc(v)}</li>`).join('')}</ul>` : ''}<button class="btn primary" data-close>閉じる</button>`;
  ov.innerHTML = src
    ? `<div class="gbigpic"><img src="${src}" alt=""><div class="gbigcap"><small></small><b>${A.esc(title.replace(/^.*：/, ''))}</b></div></div><div class="gov">${body}</div>`
    : `<div class="gov">${pic(picKey, 'wide')}${body}</div>`;
  document.body.append(ov);
  seen(PIC[picKey]);
  if (A.fx()) A.playNotes(notes.map((f, i) => [f, i * 0.12]));
  ov.querySelector('[data-close]').onclick = () => {
    ov.remove();
    onClose?.();
    showYearSummary(G());
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
  townView = null;
  AL.queue = [];
  // 1.7.3：地図の canvas のメモリを手放す。別の画面に入れ替わってから（保存を待つ間に地図が消えて見えないように）
  const cv = liveCv;
  liveCv = null;
  let n = 0;
  const gone = () => (!cv || cv === liveCv ? null : !cv.isConnected ? Mc.release(cv) : ++n < 20 && setTimeout(gone, 250));
  gone();
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
    else setTimeout(drainMissions, 0); // 1.8.0 演出のあとに、達成したミッションの答え合わせ
  }
}
function alertPic(id) {
  const src = id && (GRID_IMAGES[id] || GRID_IMAGES[Mn.PIC_FALLBACK[id]]);
  if (src) seen(GRID_IMAGES[id] ? id : Mn.PIC_FALLBACK[id]);
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
    // 1.6.1：報告の形の事故（「変圧器の損失報告」など）は、上に小さく「事故発生」を足して「◯◯発生」とそろえる
    const kicker = a.kind === 'inc' && Mn.isReport(a.key) ? '<small class="galkick">事故発生</small>' : '';
    ov.innerHTML = `<div class="galbox"><div class="galpic${a.pic ? '' : ' ph'}">${alertPic(a.pic)}<p class="galhead">${kicker}${A.esc(a.head)}</p></div><p class="galtext">${A.esc(a.text)}</p>${note}<div class="galbtns">${btns}</div><p class="galskip" aria-hidden="true">画面を押すと演出をとばします</p></div>`;
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
  restrict: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l-4-5"/><path d="M15 5h4M17 3v4"/>', // 1.10.0 使用制限
  hzwork: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/><path d="M19 4l3 3-3 3"/>', // 1.10.0 周波数をそろえる工事
  debt: '<path d="M6 4l6 8 6-8M12 12v8M7 13h10M7 17h10"/>', // 1.10.2 借入れ返済中
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
  if (c.kind === 'restrict') return togglePanel('run'); // 1.10.0 使用制限は運転のパネル
  if (c.kind === 'hzwork') return openSel('node', c.node, true); // 1.10.0 周波数をそろえる工事：その地点の詳細
  if (c.kind === 'debt') return togglePanel('manage'); // 1.10.2 借入れの返済中は経営のパネル
  if (c.kind !== 'ev') return togglePanel('supply');
  const e = Gm.evOn(G(), c.key);
  if (!e) return;
  const E = Gm.EVENTS[c.key];
  const rHint = c.key === 'drought' && G().era >= Gm.RESTRICT_ERA; // 1.10.0 渇水のとき、使用制限の案内
  sheet(
    `<h2>${A.esc(E.name)}（${A.esc(c.left)}）</h2>${pic(c.key, 'wide')}<p>${A.esc(E.text)}。${E.days}日続く。</p>${rHint ? `<p class="small"><b>${A.esc(Gm.RESTRICT_HINT)}</b>${Gm.restrictOn(G()) ? `（いま ${A.esc(Gm.RESTRICT[Gm.restrictOn(G())].short)}）` : ''}</p><button class="btn gwide" data-gorun>運転のパネル（使用制限）</button>${unitButtons(Gm.RESTRICT_UNITS)}` : ''}<p class="small">出来事は時間がたつと終わります。需給のパネルで、需要と電源の動きを見られます。</p>`,
    ({ onAll, close }) => {
      onAll('[data-gorun]', 'click', () => (close(), setPanel('run')));
      onAll('[data-unitgo]', 'click', (e2) => goUnit(e2.currentTarget.dataset.unitgo));
    },
  );
}

// ---- 1.5.3 小さなグラフ：上の帯の下（札の下）に高さ 40px。直近24時間の需要（線）・届いた量（緑の点線）・電源ごとの出力（積み上げ）、
// いまの時刻の印、予備力の残り。押すと需給。経営のパネルでオン・オフ（初期値はオン。開発者モード・デモではその系統の設定に）
const miniOn = () => (DEV.on ? DEV.state.opts.mini !== false : A.S.settings.gridMini !== false);
// 1.6.2 地形（山地・平野の塗り分け・川・県境）を出すか。経営のパネルでオン・オフ（初期値はオン。開発者モード・デモ・チュートリアルはその系統の設定）
const terrainOn = () => (DEV.on ? DEV.state.opts.terrain !== false : A.S.settings.gridTerrain !== false);
// 1.10.3 地図の使い手側の動き（工場・商店・石炭船）を出すか。経営のパネルでオン・オフ（初期値はオン）
const mapAnimOn = () => (DEV.on ? DEV.state.opts.mapAnim !== false : A.S.settings.gridMapAnim !== false);
async function setMapAnim(on) {
  if (DEV.on) {
    DEV.state.opts.mapAnim = on;
    return save();
  }
  A.S.settings.gridMapAnim = on;
  return A.db.putKV('settings', A.S.settings);
}
async function setTerrain(on) {
  if (DEV.on) {
    DEV.state.opts.terrain = on;
    return save();
  }
  A.S.settings.gridTerrain = on;
  return A.db.putKV('settings', A.S.settings);
}
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
  // 1.7.4：予備は網ごと。届いていない網があればそれを先に（「予備 100%超」と「一部に届いていない」が同時に出て矛盾して見えないように）。網が2つ以上なら最も少ない網
  const nr = netReserve(g);
  const margin = nr ? nr.margin : l.demand > 1e-6 ? o.cap / l.demand - 1 : null;
  const rcls = nr?.miss ? 'bad' : margin == null ? '' : margin < 0 ? 'bad' : margin < g.reserve ? 'warn' : 'ok';
  const rtext = nr?.miss ? `届かない<br>${kw(nr.miss)}` : margin == null ? '予備 —' : `予備 ${nr?.many ? '最小' : ''}${margin < 0 ? '不足' : margin > 1 ? '100%超' : pct(margin)}`;
  // 1.6.1 色見本（1行）：需要・届いた量と、いま建っている電源の種類だけ（色は需給のパネルと同じ）
  const has = (f) => g.plants.some((p) => f(Gm.PLANTS[p.type]));
  const key = ['<span><i class="gk-dem"></i>需要</span>', '<span><i class="gk-sv"></i>届いた量</span>', has((D) => !D.coal) ? '<span><i class="gk-hy"></i>水力</span>' : '', has((D) => D.coal && D.ac) ? '<span><i class="gk-co"></i>火力</span>' : '', has((D) => !D.ac) ? '<span><i class="gk-dc"></i>直流火力</span>' : ''].join('');
  return `<span class="gmplot"><svg class="gmsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${days}
      ${o.cap <= max ? `<line x1="0" x2="${W}" y1="${P(Y(o.cap))}" y2="${P(Y(o.cap))}" class="gmcap"/>` : ''}
      <path d="${area(() => 0, (h) => h[5])}" class="gmhy"/>
      <path d="${area((h) => h[5], (h) => h[5] + h[4])}" class="gmco"/>
      <path d="${area((h) => h[5] + h[4], (h) => h[5] + h[4] + h[3])}" class="gmdc"/>
      <path d="${line((h) => h[2])}" class="gmsv"/>
      <path d="${line((h) => h[1])}" class="gmdem"/>
      <line x1="${W - 0.8}" x2="${W - 0.8}" y1="0" y2="${H}" class="gmnow"/>
      <circle cx="${W - 1.5}" cy="${P(Y(last[1]))}" r="2.2" class="gmdot"/>
    </svg><span class="gmkey">${key}</span></span><span class="gmlab"><b>${g.t % 24}時</b><small class="${rcls}">${rtext}</small></span>`;
}

// 1.7.4 網ごとの予備（g.last.nets）：miss＝届いていない量（kW）。なければ、需要のある網のうち予備のいちばん少ない網
function netReserve(g) {
  const l = g.last;
  if (!l?.nets) return null;
  const miss = l.demand - l.served;
  if (miss > 0.01 * l.demand && miss > 0.05) return { miss };
  const ns = l.nets.filter((n) => !n.none && n.load > 1e-6);
  if (!ns.length) return null;
  const m = ns.map((n) => ({ ...n, margin: n.cap / n.load - 1 })).sort((a, b) => a.margin - b.margin)[0];
  return { margin: m.margin, main: m.main, many: ns.length > 1 };
}
// 網ごとの一覧（需給のパネル・いま起きていること）
function netsHtml(g) {
  const ns = g.last?.nets || [];
  if (!ns.length) return '';
  const name = (n) => A.esc(Gm.nodeOf(g, n.main)?.name || '');
  const rows = [...ns]
    .sort((a, b) => (b.none ? 1 : 0) - (a.none ? 1 : 0) || (a.got < a.load - 0.05 ? -1 : 0) - (b.got < b.load - 0.05 ? -1 : 0) || b.load - a.load)
    .map((n) => {
      if (n.none) return `<p class="gnetrow"><b class="gneg">発電所につながっていない町 ${n.towns}か所</b>（${name(n)}${n.towns > 1 ? 'など' : ''}）<small>需要 ${kw(n.load)} ・ 届いていない</small></p>`;
      const m = n.load > 1e-6 ? n.cap / n.load - 1 : null;
      const short = n.got < n.load - Math.max(0.05, 0.01 * n.load);
      const mt = m == null ? '需要なし' : m < 0 ? '<b class="gneg">予備 不足</b>' : m > 1 ? '予備 100%超' : `予備 ${pct(m)}`;
      return `<p class="gnetrow"><b>${n.dc ? '直流' : `交流 ${n.hz} Hz`}の網</b>：${name(n)}${n.towns > 1 ? ` ほか${n.towns - 1}か所` : ''}<small>需要 ${kw(n.load)} ・ 届 ${short ? `<b class="gneg">${kw(n.got)}</b>` : kw(n.got)} ・ 使える発電機 ${kw(n.cap)} ・ ${mt}</small></p>`;
    })
    .join('');
  return `<h3>網ごと（いま）</h3><p class="small">直流の網と交流の網は別々に動きます（直流の発電所は直流の線にだけ、交流の発電所は交流の線にだけ送れる）。</p>${rows}`;
}
// ---- 1.7.4 いま起きていること：届いていない町と原因（1行ずつ）・電圧の低下・使用率 100% 超の線・網ごとの予備。行を押すとその場所へ地図が寄る ----
function nowSheet() {
  const g = G(), l = g.last;
  if (!l) return A.toast('まだ1時間も進んでいません');
  const rows = Object.entries(l.why || {})
    .map(([n, w]) => ({ n, w, st: l.towns[n], miss: (l.towns[n]?.d || 0) * (1 - (l.towns[n]?.r ?? 1)) }))
    .sort((a, b) => b.miss - a.miss);
  const bad = rows.filter((r) => r.w.k !== 'dim');
  const dim = rows.filter((r) => r.w.k === 'dim');
  const over = g.lines.filter((x) => (l.lines[x.id]?.util || 0) > 1).sort((a, b) => l.lines[b.id].util - l.lines[a.id].util);
  const trips = g.lines.filter((x) => x.hzTrip); // 1.8.0
  const row = (focus, head, sub, text) => `<button class="gwhyrow" data-focus="${focus}"><span class="spread"><b>${head}</b><small>${sub}</small></span><small>${text}</small></button>`;
  const name = (id) => A.esc(Gm.nodeOf(g, id)?.name || '');
  const MAX = 30;
  sheet(
    `<h2>いま起きていること</h2>
    <p class="small">${timeLabel(g)} の1時間。行を押すと、その場所へ地図が寄ります。</p>
    ${bad.length ? `<h3>届いていない町（${bad.length}）</h3>${bad.slice(0, MAX).map((r) => row(`node:${r.n}`, name(r.n), `届いていない ${kw(r.miss)}（${pct(1 - r.st.r)}）`, A.esc(Gm.whyText(g, r.w)))).join('')}${bad.length > MAX ? `<p class="small">ほか ${bad.length - MAX}か所</p>` : ''}` : '<p>いまは、需要のある町すべてに届いています。</p>'}
    ${dim.length ? `<h3>電圧の低下（${dim.length}）</h3>${dim.slice(0, MAX).map((r) => row(`node:${r.n}`, name(r.n), '届いている', A.esc(Gm.whyText(g, r.w)))).join('')}` : ''}
    ${trips.length ? `<h3>周波数違いで切れている線（${trips.length}）</h3>${trips.slice(0, MAX).map((x) => row(`line:${x.id}`, A.esc(Gm.lineName(g, x)), '切れている', `${x.hzPair ? `${A.esc(x.hzPair[0])} ${x.hzPair[1]} Hz と ${A.esc(x.hzPair[2])} ${x.hzPair[3]} Hz。` : ''}つないだ瞬間に脱調して、保護装置で切れた`)).join('')}` : ''}
    ${over.length ? `<h3>使用率が 100% を超えている線（${over.length}）</h3>${over.slice(0, MAX).map((x) => row(`line:${x.id}`, A.esc(Gm.lineName(g, x)), `使用率 ${pct(l.lines[x.id].util)}`, '120% を2時間超えると保護装置で切れる。回線を増やすか、別の道を作る')).join('')}` : ''}
    ${netsHtml(g)}`,
    ({ onAll, close }) =>
      onAll('[data-focus]', 'click', (e) => {
        const [kind, id] = e.currentTarget.dataset.focus.split(':');
        close();
        focusOn(kind, id);
      }),
  );
}
// その地点・線へ地図を寄せ、詳しいカードを開く（今より引いて見ているときは、まわりが分かるくらいまで拡大）
function focusOn(kind, id) {
  const g = G();
  const l = kind === 'line' ? g.lines.find((x) => x.id === id) : null;
  const pts = kind === 'node' ? [Gm.nodeOf(g, id)] : l ? [Gm.nodeOf(g, l.a), Gm.nodeOf(g, l.b)] : [];
  if (!pts.length || pts.some((n) => !n)) return;
  if (B) B = null;
  if (panel) setPanel(null);
  fitView(g, bboxOf(pts), 0.3, Math.min(VIEW.w, Gm.isJapan(g) ? 24 : 200));
  afterMove();
  openSel(kind, id, true);
}

// ---- 1.5.3 / 1.10.1 収益が増えたとき：上の帯の数字は毎回演出なしで更新し、演出（数え上げ・+◯円・町の ¥）は画面全体で 7 秒に 1 回まで ----
// 収益（円）と学習のコインは別物なので、色と印を分ける（収益は緑の「¥」、コインは金色の丸）。¥ は1回の演出で1つだけ（前回と違う町）
let yenFx = Mn.yenFxState();
let yenSound = 0;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function revenueFx(g) {
  if (yenFx.sys !== g) return (yenFx = Mn.yenFxState(g)); // 系統が切り替わった
  if (document.hidden || !onGrid()) return;
  const visTowns = Gm.nodesOf(g)
    .filter((n) => {
      const st = g.last?.towns[n.id];
      if (!n.town || !st || !(st.d > 0) || !(st.r > 0) || !g.loads.some((x) => x.town === n.id)) return false;
      const p = at(n);
      return p.x >= 0 && p.y >= 0 && p.x <= VIEW.W && p.y <= VIEW.H;
    })
    .map((n) => n.id);
  const plan = Mn.planRevenueFx(yenFx, g, Date.now(), visTowns);
  if (!plan) return;
  const b = document.querySelector('.ghud [data-yen]');
  const cell = document.querySelector('.ghud [data-yencell]');
  if (!b || !cell) return;
  // 数え上げ（前の演出のときの値から）
  if (!still()) {
    const t0 = performance.now(), d = 700;
    const stepFx = (now) => {
      const k = Math.min(1, (now - t0) / d);
      if (!b.isConnected || yenFx.fxYen !== plan.to) return;
      b.textContent = yenShort(plan.from + plan.delta * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(stepFx);
    };
    b.textContent = yenShort(plan.from);
    requestAnimationFrame(stepFx);
  }
  // 緑の「+◯円」（前の演出からの増えた分をまとめて）
  const r = cell.getBoundingClientRect();
  const f = document.createElement('span');
  f.className = `gyenfx${A.fx() ? ' fx' : ''}`;
  f.textContent = `+${yenShort(plan.delta)}`;
  f.style.left = `${Math.round(r.left + r.width / 2)}px`;
  f.style.top = `${Math.round(r.bottom - 4)}px`;
  document.body.append(f);
  setTimeout(() => f.remove(), 1500);
  if (!still() && plan.town) flyYen(g, plan.town, r);
}
function flyYen(g, townId, to) {
  const svg = document.querySelector('[data-top]');
  const m = svg?.getScreenCTM();
  if (!m || document.querySelector('.galert')) return;
  const n = Gm.nodeOf(g, townId);
  if (!n) return;
  const p = at(n);
  if (p.x < 0 || p.y < 0 || p.x > VIEW.W || p.y > VIEW.H) return; // 画面の外の町からは飛ばさない
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
    { duration: 1300, easing: 'ease-in-out', fill: 'both' },
  );
  a.onfinish = () => {
    el.remove();
    if (A.fx() && Date.now() - yenSound > 10000) {
      yenSound = Date.now();
      A.playNotes([[1568, 0]]);
    }
  };
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
// 地図の上の印（工事の印がぽんと出る・完成した施設が弾む・開通した線が一度光る・1.10.3 豪華演出）。id → { kind, until }
const marks = new Map();
const MARK_MS = { work: 1400, done: 1600, glow: 1800, doneplant: 2200, doneline: 2200, donesub: 1900, firstline: 2500, firsttown: 2700 };
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
  const rich = !tutOn() && !demoOn() && !still();
  for (const f of done) {
    band(Mn.doneText(g, f));
    if (f.kind === 'withdraw') continue; // 1.6.4 保留の取り下げ：帯だけ
    if (f.kind === 'line') mark(f.x.id, rich ? 'doneline' : 'glow');
    else if (f.kind === 'opt' || f.kind === 'circ') mark(f.x.line.id, rich ? 'doneline' : 'glow');
    else if (f.kind === 'plant') mark(f.x.site, rich ? 'doneplant' : 'done');
    else if (f.kind === 'sub' || f.kind === 'conv') mark(f.x.town, rich ? 'donesub' : 'done');
    else mark(f.x.node, 'done');
  }
  if (done.length && onGrid() && !townView) drawMap();
  return done.length;
}

// ---- 1.10.3 演出（初めて電気が届いた・1年のまとめ・事故と復旧の波及） ----
function drainFreshLit(g) {
  if (!g?.freshLit?.length) return;
  const items = g.freshLit.splice(0);
  if (demoOn()) return; // デモでは出さない（チュートリアルでは出してよい）
  let changed = false;
  for (const it of items) {
    const townId = typeof it === 'string' ? it : it?.town;
    const n = townId && Gm.nodeOf(g, townId);
    if (!n) continue;
    changed = true;
    const path = typeof it === 'object' && it?.path?.length ? it.path : Gm.litPathLines(g, townId, g.t);
    for (const lid of path) mark(lid, 'firstline');
    mark(townId, 'firsttown');
    const yr = Gm.isJapan(g) && n.year && !n.campus && confOf(n.conf) === '確かめた' ? `（史実 ${n.year}年）` : '';
    band(`${n.name}に初めて電気が届いた${yr}`);
  }
  if (changed) {
    if (A.fx()) A.playNotes([[523.3, 0], [659.3, 0.09], [784, 0.18], [1046.5, 0.28]]);
    if (onGrid() && !townView) drawMap();
    if (!DEV.on) recordNow();
    save();
  }
}

// 事故と復旧の波及演出（全域停電・負荷遮断の発生と復旧を距離順に波及させる）
const WAVE = { g: null, black: false, shed: false, marks: new Map(), until: 0 };
const isBlackNow = (g) => !!g && Object.values(g.black || {}).some((u) => u > g.t);
const isShedNow = (g) => !!g?.last?.shed;
function syncWaveBaseline(g) {
  WAVE.g = g;
  WAVE.black = isBlackNow(g);
  WAVE.shed = isShedNow(g);
}
function triggerWave(g, kind) {
  if (!g || tutOn() || demoOn()) return;
  let origins = [];
  if (kind === 'dark') {
    for (const i of g.incidents || []) {
      if (i.town) origins.push(i.town);
      const p = i.plant && g.plants.find((x) => x.id === i.plant);
      if (p) origins.push(p.site);
      const l = i.line && g.lines.find((x) => x.id === i.line);
      if (l) origins.push(l.a, l.b);
      const s = i.sub && g.subs.find((x) => x.id === i.sub);
      if (s) origins.push(s.town);
    }
  }
  if (!origins.length) origins = (g.plants || []).filter((p) => p.readyAt <= g.t).map((p) => p.site);
  if (!origins.length) origins = [Gm.startId(g)];
  const order = Gm.townWaveOrder(g, origins, g.t);
  WAVE.marks = new Map();
  const stepMs = still() ? 0 : 120;
  for (const o of order) WAVE.marks.set(o.id, { kind, delay: Math.min(1200, o.hop * stepMs) });
  WAVE.until = Date.now() + 2600;
  if (townView) {
    const svg = document.querySelector('[data-townsvg]');
    if (svg) {
      svg.classList.remove('twave-dark', 'twave-lit');
      void svg.offsetWidth;
      svg.classList.add(kind === 'dark' ? 'twave-dark' : 'twave-lit');
      setTimeout(() => svg.classList.remove('twave-dark', 'twave-lit'), 1800);
    }
  } else if (onGrid()) {
    drawMap();
  }
}
function checkWave(g) {
  if (WAVE.g !== g) return syncWaveBaseline(g);
  const b = isBlackNow(g), sh = isShedNow(g);
  const prevBad = WAVE.black || WAVE.shed;
  const nowBad = b || sh;
  WAVE.black = b;
  WAVE.shed = sh;
  if (!prevBad && nowBad) triggerWave(g, 'dark');
  else if (prevBad && !nowBad) triggerWave(g, 'lit');
}
const waveOf = (id) => (WAVE.until > Date.now() ? WAVE.marks.get(id) || null : null);

// 1年のまとめ（年の変わり目のあと、次に系統を開いたときに1回。時代の絵背景・カウントアップ・前年比矢印・次の1年のねらい）
function showYearSummary(g) {
  if (!g?.yearSummary || tutOn() || demoOn() || DEV.running) return;
  if (!onGrid() || document.querySelector('.modal, .goverlay, .galert, .gtut, .gmcard')) return;
  const ys = g.yearSummary;
  const src = picSrc(PIC[`era${Math.min(g.era, Gm.MAX_ERA)}`]);
  const arr = (d, invert = false) => {
    if (d == null) return '';
    if (Math.abs(d) < 1e-6) return '<span class="gyarr same">→</span>';
    const up = d > 0;
    const good = invert ? !up : up;
    return `<span class="gyarr ${good ? 'up' : 'dn'}">${up ? '↑' : '↓'}</span>`;
  };
  const diff = (cur, prev) => (prev == null ? null : cur - prev);
  const accGain = (ys.accepted || 0) - (ys.prevAccepted || 0);
  const items = [
    { label: '最大の需要', val: ys.maxDemand || 0, fmt: (v) => kw(v), arrow: arr(diff(ys.maxDemand, ys.prevMaxDemand)) },
    { label: '受けた需要の増え方', val: accGain, fmt: (v) => `${v >= 0 ? '+' : '−'}${kw(Math.abs(v))}`, arrow: '' },
    { label: '届いた割合', val: (ys.servedPct ?? 1) * 100, fmt: (v) => `${v.toFixed(1)}%`, sub: ys.blackH || ys.shedH ? `全域停電 ${ys.blackH}h・負荷遮断 ${ys.shedH}h` : '停電なし', arrow: arr(diff(ys.servedPct, ys.prevServedPct)) },
    { label: '1年の利益', val: ys.profit || 0, fmt: (v) => `${v >= 0 ? '+' : '−'}${yen(Math.abs(v))}`, arrow: arr(diff(ys.profit, ys.prevProfit)) },
    { label: '建てた設備', val: ys.built || 0, fmt: (v) => `${Math.round(v)} 件`, arrow: '' },
    { label: '事故の対処', val: ys.incOk || 0, fmt: (v) => (ys.incTotal ? `${Math.round(v)}／${ys.incTotal} 件正解` : '事故なし'), arrow: '' },
    { label: '初めて電気が届いた町', val: ys.litTowns || 0, fmt: (v) => `${Math.round(v)} か所`, arrow: '' },
    ...(ys.genMix ? [{ label: '電源の組み合わせ', val: ys.genMix.thermalPct, fmt: (v) => `火力 ${Math.round(v)}%・水力 ${100 - Math.round(v)}%`, arrow: '' }] : []),
  ];
  const ov = document.createElement('div');
  ov.className = `goverlay gyrsum${src ? ' hasimg' : ''}${A.fx() ? ' fx' : ''}`;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="gyrbox" style="${src ? `--eraimg:url('${src}')` : ''}">
    <p class="gyrkick">1年のまとめ</p>
    <h2>${ys.yearNo}年目のふり返り</h2>
    <div class="gyrgrid">${items
      .map((it, i) => `<div class="gyrcell"><small>${it.label}</small><b data-yv="${i}">${it.fmt(0)}</b>${it.arrow}${it.sub ? `<span class="gyrsub">${A.esc(it.sub)}</span>` : ''}</div>`)
      .join('')}</div>
    <p class="gyraim"><b>次の1年のねらい：</b>${A.esc(ys.goal || '')}</p>
    <p class="small gyrsnote" data-yskip>画面を押すと演出をとばします</p>
    <button class="btn primary gwide" data-yclose>閉じる</button>
  </div>`;
  document.body.append(ov);
  if (A.fx()) A.playNotes([[523.3, 0], [659.3, 0.1], [784, 0.2], [1046.5, 0.34]]);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    items.forEach((it, i) => {
      const b = ov.querySelector(`[data-yv="${i}"]`);
      if (b) b.textContent = it.fmt(it.val);
    });
    const sk = ov.querySelector('[data-yskip]');
    if (sk) sk.hidden = true;
  };
  if (still() || !A.fx()) finish();
  else {
    const t0 = performance.now(), dur = 1100;
    const step = (now) => {
      if (done || !ov.isConnected) return;
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      items.forEach((it, i) => {
        const b = ov.querySelector(`[data-yv="${i}"]`);
        if (b) b.textContent = it.fmt(it.val * e);
      });
      if (k < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }
  const close = () => {
    done = true;
    ov.remove();
    delete g.yearSummary;
    save();
    drainAlerts();
    drainMissions();
  };
  ov.addEventListener('click', (e) => {
    if (e.target.closest('[data-yclose]')) return close();
    if (!done) finish();
  });
}

// ---- 1.10.3 町を見る（案1）：地図を描き直さずに隠して切り替え、SVG は差分更新 ----
function openTownView(id) {
  const g = G();
  if (!Gm.nodeOf(g, id)?.town) return;
  townView = id;
  townNeedMapSync = false;
  sel = null;
  panel = null;
  B = null;
  showTownViewDom(true);
}
function closeTownView() {
  if (!townView) return;
  townView = null;
  const tv = document.querySelector('[data-townview]');
  const mid = document.querySelector('[data-mid]');
  const dock = document.querySelector('[data-dock]');
  if (tv) (tv.hidden = true), (tv.innerHTML = '');
  if (mid) mid.hidden = false;
  if (dock) dock.hidden = false;
  if (townNeedMapSync) {
    townNeedMapSync = false;
    drawMap();
    if (dock) (dock.innerHTML = dockHtml(G())), bindDock();
  }
  drawMenu();
  drawDetail();
}
function showTownViewDom(first) {
  const mid = document.querySelector('[data-mid]');
  const dock = document.querySelector('[data-dock]');
  const tv = document.querySelector('[data-townview]');
  if (!tv) return;
  if (mid) mid.hidden = true;
  if (dock) dock.hidden = true;
  tv.hidden = false;
  renderTownView(first);
}
const LOAD_BAR_COL = { lamp: '#f5b83d', home: '#6ba8e5', cool: '#4dc2d9', shop: '#5bc28c', factory: '#d97652', tram: '#2f9e76' };
function townStatsHtml(g, st) {
  const rows = ['lamp', 'home', 'cool', 'shop', 'factory', 'tram']
    .filter((k) => st.demandBy[k])
    .map((k) => {
      const d = st.demandBy[k];
      const w = st.totalMax > 1e-6 ? Math.max(2, Math.min(100, Math.round((d.nowKw / st.totalMax) * 100))) : 0;
      const extra = k === 'tram' ? '（直流 600 V・変換所が要る）' : '';
      return `<div class="gtrow"><span class="gtlbl">${pic(`load_${k}`, 'mini gloadpic')}${A.esc(d.name)}${extra}</span><span class="gtbar"><i style="width:${w}%;background:${LOAD_BAR_COL[k]}"></i></span><b class="gtval">${kw(d.nowKw)}</b></div>`;
    })
    .join('');
  const townSt = g.last?.towns?.[st.townId];
  const sup = townSt && townSt.d > 1e-6 ? `<p class="small">${townSupplyText(g, st.townId, townSt)}</p>` : '';
  return `<div class="gtstats">
    <p class="spread"><b>いま ${st.h}時のこの町</b><small>合計 ${kw(st.totalNow)} ・ 届いている ${kw(st.servedNow)}（${pct(st.rate)}）</small></p>
    ${rows || '<p class="small">まだ接続している需要はありません</p>'}
    ${sup}
  </div>`;
}
function renderTownView(first) {
  const tv = document.querySelector('[data-townview]');
  if (!tv || !townView) return;
  const g = G(), lc = learningNow();
  const st = Tw.townSceneState(g, townView);
  const held = g.apps.filter((a) => a.town === townView && a.held).map((a) => a.id);
  const existingSvg = tv.querySelector('[data-townsvg]');
  if (first || !existingSvg) {
    tv.innerHTML = `<div class="gtownhead">
        <button class="btn small" data-tback>‹ 地図に戻る</button>
        <div class="gtowntitle"><b>${A.esc(st.name)}</b><small data-tmeta>${st.h}時 ・ 届いている ${pct(st.rate)}</small></div>
      </div>
      <div class="gtownscroll" data-tscroll>
        <svg class="gtownsvg" viewBox="0 0 900 380" role="img" aria-label="${A.esc(st.name)}の町の電気の流れ" data-townsvg></svg>
      </div>
      <p class="small gtownhint">横にスクロールできます。設備や建物を押すと説明と関係する単元が出ます。</p>
      <div class="gtowninfo" data-towninfo>
        <div data-tstats>${townStatsHtml(g, st)}</div>
        <div data-toutlook>${st.hasLoad || held.length ? outlookHtml(g, lc, townView, held, false) : ''}</div>
      </div>`;
    const svg = tv.querySelector('[data-townsvg]');
    Tw.patchTownSvg(svg, st);
    tv.querySelector('[data-tback]').onclick = closeTownView;
    svg.addEventListener('click', (e) => {
      const obj = e.target.closest('[data-k]');
      if (!obj) return;
      townObjectSheet(townView, obj.dataset.k);
    });
    const info = tv.querySelector('[data-towninfo]');
    bindOutlook(info);
    tv.dataset.th = String(g.t);
    return;
  }
  // 差分更新：SVG の動きを止めず、数値と属性だけ変える
  const meta = tv.querySelector('[data-tmeta]');
  if (meta) meta.textContent = `${st.h}時 ・ 届いている ${pct(st.rate)}`;
  Tw.patchTownSvg(existingSvg, st);
  const stats = tv.querySelector('[data-tstats]');
  if (stats) stats.innerHTML = townStatsHtml(g, st);
  if (tv.dataset.th !== String(g.t)) {
    tv.dataset.th = String(g.t);
    const out = tv.querySelector('[data-toutlook]');
    if (out && (st.hasLoad || held.length)) {
      out.innerHTML = outlookHtml(g, lc, townView, held, false);
      bindOutlook(out);
    }
  }
}
function townObjectSheet(townId, key) {
  const g = G();
  const info = Tw.townObjectInfo(g, townId, key);
  if (!info) return;
  if (info.pic) seen(PIC[info.pic]);
  sheet(
    `<h2>${A.esc(info.title)}</h2>
    ${info.pic ? pic(info.pic, 'wide') : ''}
    <p>${A.esc(info.text)}</p>
    ${info.units.length ? `<h3>関係する単元</h3>${unitButtons(info.units)}` : ''}`,
    ({ onAll }) => onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo)),
  );
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
// 1.6.4：地図の層は画面より上下左右に MAP_PAD（画面の幅・高さの割合）ずつ大きく描く。指で動かしている間（CSS の transform だけ）も、まわりが空にならないように
const MAP_PAD = 0.4;
const mapVB = () => `${(-VIEW.W * MAP_PAD).toFixed(1)} ${(-VIEW.H * MAP_PAD).toFixed(1)} ${(VIEW.W * (1 + 2 * MAP_PAD)).toFixed(1)} ${(VIEW.H * (1 + 2 * MAP_PAD)).toFixed(1)}`;
const viewH = () => (VIEW.w * VIEW.H) / VIEW.W;
const at = (n) => ({ x: (n.x - VIEW.x) * scaleK(), y: (n.y - VIEW.y) * scaleK() });
// 線の太さ（電圧で）。1.10.0：275 kV は 154 kV の次の太さ
const lineWidth = (K) => (K.dc ? 2 : K.kv >= 500 ? 5.6 : K.kv >= 275 ? 4.6 : K.kv >= 66 ? 3.6 : K.kv >= 11 ? 2.8 : 2);
const utilColor = (u) => ['var(--gline)', 'var(--gwarn)', 'var(--idk)', 'var(--ng)'][Mn.utilTier(u)]; // 1.6.4：90% 超で注意（オレンジ）
// 地図の範囲と拡大の限度（幅 4 km〜列島全体。古い島は 90〜島全体）
function mapBounds(g) {
  if (Gm.isJapan(g)) {
    const [x0, y0, x1, y1] = JAPAN_BOUNDS;
    return { x0, y0, x1, y1, minW: 4 };
  }
  return { x0: 0, y0: 0, x1: MAP_W, y1: MAP_H, minW: 90 };
}
// v：{ x, y, w }（省くと VIEW）。1.6.4：指で動かしている途中の形（clampTf）にも使う
function clampView(g, v = VIEW) {
  const b = mapBounds(g);
  const maxW = Math.max(b.x1 - b.x0, ((b.y1 - b.y0) * VIEW.W) / VIEW.H) * 1.06;
  v.w = Math.max(b.minW, Math.min(maxW, v.w));
  const h = (v.w * VIEW.H) / VIEW.W;
  const cx = Math.max(b.x0, Math.min(b.x1, v.x + v.w / 2)), cy = Math.max(b.y0, Math.min(b.y1, v.y + h / 2));
  v.x = cx - v.w / 2;
  v.y = cy - h / 2;
  return v;
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
  // 東京は区が入るくらい。ほかの町は、まわりの（まだ開いていない）町や海岸も見える 60 km ほど
  const tokyo = s.area === '東京市内';
  const ns = tokyo ? Gm.nodesOf(g).filter((n) => n.area === '東京市内') : [s];
  fitView(g, bboxOf(ns), 0.2, tokyo ? 16 : 60);
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
// 1.7.3 日本列島の下の層と景色の層は 1 枚の canvas（mapcanvas.js）。描くものをここで決める
// 1.6.3 水系（地球地図日本）：海岸線は引いて見たときは簡単な形、拡大すると細かい形。川は本流からの長さの段ごとに、拡大すると支流まで。湖（拡大すると幅の広い川の面も）
// 拡大したとき（細かい海岸線）は、画面のまわりの区域だけを切り出して描く（区域を出たら作り直す。baseKeyOf）
// 1.6.2 地形：陸の色 →（1.6.3 拡大したときは田畑の模様）→ 丘陵・山地・高い山の面を重ねて塗る（海岸線の形で切り抜く）→ 湖 → 海岸線 → 県境 → 川 → 周波数の境目
// → 景色（市街地の広がり・林・岩・家）。線・地点は上の層（SVG）
function japanSpec(g, scene) {
  const lv = Mg.coastLevel(VIEW.w);
  const reg = Mg.regionOf(VIEW.x, VIEW.y, VIEW.w, viewH());
  const ter = terrainOn();
  const sl = ter ? Mg.sceneLevel(VIEW.w) : 0;
  return {
    terrain: ter,
    coast: Mg.coastPath(lv, reg),
    lakes: [Mg.lakePath(reg), reg ? Mg.riverAreaPath(reg) : ''],
    rivers: Array.from({ length: Mg.riverCount(VIEW.w) }, (_, i) => Mg.riverPath(i, reg)),
    pref: ter ? Mg.prefPath(JAPAN_PREF_LINES, reg) : '',
    ter: ter ? [JAPAN_TERRAIN.hill, JAPAN_TERRAIN.mount, JAPAN_TERRAIN.high] : null,
    hz: g.era >= 2 ? HZ_D : '',
    fieldKm: sl ? Mg.FIELD_KM[sl] : 0,
    scene,
  };
}
const HZ_D = `M${JAPAN_HZ_LINE.map((p) => p.join(',')).join(' L')}`;
// 色：CSS 変数を読み替えたもの。テーマ（シンプル／演出あり）・ライト／ダークが変わったら読み直す（鍵 colorKey）
const darkMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const colorKey = () => `${document.documentElement.dataset.theme || ''}|${darkMQ?.matches ? 'dark' : 'light'}`;
let colorCache = { key: null, colors: null };
const colorsNow = (parent) => {
  const ck = colorKey();
  if (colorCache.key !== ck) colorCache = { key: ck, colors: Mc.readColors(parent) };
  return colorCache;
};
// 端末の設定でライト／ダークが変わったら、地図を描き直す（SVG のときは CSS 変数で自然に変わっていた）
darkMQ?.addEventListener?.('change', () => onGrid() && drawMap());
const mkCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
let liveCv = null; // いま出している canvas（画面を作り直したら、古いほうのメモリを手放す）
// canvas に描く。同じ見え方・同じ景色・同じ色なら描き直さない（時間が進んだときの描き直しなど）
function paintBase(g, cv) {
  if (liveCv && liveCv !== cv) Mc.release(liveCv);
  liveCv = cv;
  const scene = sceneData(g);
  const dpr = Mc.dprOf(window.devicePixelRatio);
  const { key: ck, colors } = colorsNow(cv.parentNode);
  const key = `${baseKeyOf(g)}|${VIEW.x.toFixed(4)},${VIEW.y.toFixed(4)},${VIEW.w.toFixed(5)},${VIEW.W}x${VIEW.H}@${dpr}|${scene ? scene.key : ''}|${ck}`;
  if (cv.dataset.k === key) return false;
  cv.dataset.k = key;
  Mc.paint(cv, { W: VIEW.W, H: VIEW.H, pad: MAP_PAD, dpr, view: { x: VIEW.x, y: VIEW.y, k: scaleK() }, colors, ck, ...japanSpec(g, scene) }, mkCanvas);
  return true;
}
const CANVAS_HTML = '<canvas class="gmap gbase" data-base data-cv aria-hidden="true"></canvas>';
// 古い島（日本列島より前）は SVG のまま
function baseInner(g) {
  // 古い島：地形（雪の地域（北西）・山・川・海岸）
  let s = `<path d="${ISLAND}" fill="var(--land)" stroke="var(--coast)" stroke-width="1.5"/>`;
  s += '<path d="M40,84 C60,46 110,26 150,22 C150,60 120,110 70,140 C40,140 26,116 40,84Z" fill="var(--gsnow)" opacity=".7"/>';
  s += [[150, 60], [176, 46], [205, 62], [232, 52], [262, 70], [118, 86], [278, 104], [196, 96]].map(([x, y]) => `<path d="M${x - 11},${y + 9} L${x},${y - 9} L${x + 11},${y + 9}Z" fill="var(--gmount)"/>`).join('');
  s += '<path d="M130,44 C150,90 190,120 210,180 C218,214 196,238 186,262 C196,300 208,320 214,338 C218,356 224,370 228,386" fill="none" stroke="var(--griver)" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M246,96 C236,130 222,156 210,180" fill="none" stroke="var(--griver)" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>';
  s += '<text x="74" y="72" class="gland">雪の地域</text><text x="222" y="78" class="gland">山</text><text x="302" y="312" class="gland">海岸</text><text x="118" y="236" class="gland">平野</text>';
  return s;
}
// 1.6.3 田畑の模様（1枚の幅 t km）：4つの区画に、細い田を縦・横の向きを変えて並べる（淡い緑〜黄土）。すき間（あぜ）は陸の色。少し傾ける（1.7.3 から mapcanvas.js の fieldTile）
// 下の層を描き直すかどうかの鍵：系統・周波数の境目・地形のオン・オフ・（1.6.3）海岸線の細かさ・川の段の数・景色の段・切り出す区域
const baseKeyOf = (g) => {
  const jp = Gm.isJapan(g);
  return `${VIEW.key}|${jp && g.era >= 2 ? 'hz' : ''}|${jp && terrainOn() ? `ter${Mg.sceneLevel(VIEW.w)}` : ''}|${jp ? `${Mg.coastLevel(VIEW.w)}${Mg.riverCount(VIEW.w)}|${Mg.regionOf(VIEW.x, VIEW.y, VIEW.w, viewH())?.key || ''}` : ''}`;
};
function baseSvg(g) {
  VIEW.base = baseKeyOf(g);
  return `<svg class="gmap gbase" data-base viewBox="${mapVB()}" aria-hidden="true"><g data-basetf transform="${baseTf()}">${baseInner(g)}</g></svg>`;
}
// 1.6.4 昼と夜：夕方〜夜は海と陸（下の層・景色の層）に暗い幕を重ねる（上の層の町の灯り・線・地点は暗くしない）。
// 暗さは時刻（gridmenu.js の nightOf）× 最大の濃さ（CSS の --gnight-a）。変わるときは CSS の transition で少しずつ
const nightLevel = (g) => Mn.nightOf(g.t).toFixed(2);
// 1.6.3 地球地図日本の出典：日本列島の地図を出している間は右上にいつも小さく出す（凡例・全体・始めた町のボタンと重ならない所）
const ATTR_HTML = '<div class="gattr" aria-hidden="true">地球地図日本（国土地理院）を加工</div>';
// 1.7.3：日本列島の下の層と景色の層は 1 枚の canvas（中身は drawMap で描く）。古い島は SVG
function mapHtml(g) {
  ensureView(g);
  const jp = Gm.isJapan(g);
  return `<div class="gmapwrap" data-mapwrap>${jp ? CANVAS_HTML : baseSvg(g)}<div class="gnight" data-night style="opacity:${nightLevel(g)}" aria-hidden="true"></div><svg class="gmap gtop" data-top viewBox="${mapVB()}" role="img" aria-label="${jp ? '日本列島の地図' : '島の地図'}">${topInner(g)}</svg></div>
    <div class="gzoombtns" data-zoombtns><button class="btn small" data-zoom="all">全体</button><button class="btn small" data-zoom="start">始めた町</button></div>${jp && terrainOn() ? terrainKeyHtml() : ''}${jp ? ATTR_HTML : ''}`;
}
// ---- 1.6.3 拡大したときの景色（画面の幅 60 km 以下）：林・岩と雪・市街地（家の小さな印と淡い広がり）。田畑は下の層の模様 ----
// 画面に見えている範囲だけを描き、印は 200 まで（mapgeo.js）。指を離したあとの描き直しで作る（同じ画面・同じ町の大きさなら前のものを使う）
// 市街地の広がりは、その町に届いている需要（なければ時代と町の大きさの基本）で決める。見た目だけで、需要や申し込みの計算には使わない
// 1.7.3：印の形は mapcanvas.js の SYM（1.6.3 の SVG の symbol と同じ形）。canvas に描く
// 指で動かしている間（途中の描き直し）は印を決め直さず、前に決めた印を今の見え方で描く（1.7.1 と同じく、指を離したときに決め直す）
let sceneCache = { key: null, blobs: [], marks: [] };
function sceneData(g) {
  if (!Gm.isJapan(g) || !terrainOn() || !Mg.sceneLevel(VIEW.w)) return null;
  if (GS.pts.size && sceneCache.key) return sceneCache;
  const k = scaleK();
  const px = VIEW.w * MAP_PAD, py = viewH() * MAP_PAD; // 1.6.4：画面のまわり（MAP_PAD）まで
  const view = { x0: VIEW.x - px, y0: VIEW.y - py, x1: VIEW.x + VIEW.w + px, y1: VIEW.y + viewH() + py };
  const cx = VIEW.x + VIEW.w / 2, cy = VIEW.y + viewH() / 2;
  const nodes = Gm.nodesOf(g).filter((n) => Gm.openEra(g, n) <= Gm.MAX_ERA);
  const towns = nodes
    .filter((n) => n.town)
    .map((n) => ({ id: n.id, x: n.x, y: n.y, r: Mg.sprawlKm(Art.townLook(g, n).kw, g.era, n.size) }))
    .filter((t) => t.x + t.r * 2 > view.x0 && t.x - t.r * 2 < view.x1 && t.y + t.r * 2 > view.y0 && t.y - t.r * 2 < view.y1)
    .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)); // 1.6.4：家の印の上限は、画面の真ん中に近い町から使う
  const key = `${VIEW.x.toFixed(3)},${VIEW.y.toFixed(3)},${VIEW.w.toFixed(4)},${VIEW.W}x${VIEW.H}|${towns.map((t) => `${t.id}:${t.r.toFixed(3)}`).join(',')}`;
  if (sceneCache.key === key) return sceneCache;
  const avoid = nodes.filter((n) => n.x > view.x0 - 5 && n.x < view.x1 + 5 && n.y > view.y0 - 5 && n.y < view.y1 + 5);
  const marks = Mg.sceneMarks({ view, k, towns, avoid, max: Mg.SCENE_MAX * 2 }); // 1.6.4：描く範囲が広がったぶん上限も
  sceneCache = { key, blobs: towns.flatMap(Mg.sprawlBlobs), marks }; // 印・広がりは地図の座標
  return sceneCache;
}
// 1.6.2 地形の凡例：地図の左下の小さなボタン。押すと色見本が開く（開いたかどうかは画面を開いている間だけ覚える）
let keyOpen = false;
function terrainKeyHtml() {
  const sw = (cls, name) => `<span><i class="${cls}"></i>${name}</span>`;
  const coalKey = '<span><svg class="gtercoal" viewBox="-10 -7 20 14" aria-hidden="true"><path d="M-8.5,6 L-4,-2 L0,-5.5 L4,-1.5 L8.5,6Z" class="gcoalbody"/></svg>炭田</span>';
  return `<div class="gterkey${keyOpen ? ' open' : ''}" data-terkey><button class="btn small" data-terkeybtn aria-expanded="${keyOpen}">凡例</button>${keyOpen ? `<div class="gterbox">${sw('k0', '平野')}${sw('k1', '丘陵 100 m〜')}${sw('k2', '山地 500 m〜')}${sw('k3', '高い山 1,500 m〜')}${sw('kl', '湖')}${sw('kr', '川')}${sw('kp', '県境')}${coalKey}<small>拡大すると</small>${sw('kf', '田畑')}${sw('kt', '林')}${sw('ku', '市街地')}<small>線の使用率</small>${sw('ku0', '〜90%')}${sw('ku1', '90% 超で注意')}${sw('ku2', '100% 超')}${sw('ku3', '120% 超')}${sw('kht', '切れている（周波数違い）')}<small>線の太さ（電圧）</small>${sw('kw1', '配電 3.3 kV・直流')}${sw('kw2', '11〜22 kV')}${sw('kw3', '66〜154 kV')}${sw('kw4', '275 kV')}${sw('kw5', '500 kV')}<small>網の周波数</small>${sw('kh50', '50 Hz')}${sw('kh60', '60 Hz')}<small>線の対策の印</small>${Object.keys(OPT_HAZ).map((o) => `<span>${optKey(o)}</span>`).join('')}</div>` : ''}</div>`;
}
// 表示の細かさ（1.6.0）：縮めたときは「大」の町の名前だけ。中・小の町・水力の地点は拡大すると出す。東京の区は町の中まで拡大したときだけ
// （それより縮めたときは、いちばん目立つ区に「東京」とだけ出す）。建設モードで光る地点・選んだ地点はいつも出す
const NAME_W = { 3: Infinity, 2: 1000, 1: 320, hydro: 220, coal: 500, ward: 40 };
const DOT_GAP = 28; // 画面の上でこれより近い地点は、目立つ方だけを絵で描き、ほかは小さな点にする
function topInner(g) {
  const nodes = Gm.nodesOf(g).filter((n) => Gm.openEra(g, n) <= Gm.MAX_ERA);
  const japan = Gm.isJapan(g);
  const t = g.t;
  const cand = B ? candidates(g, learningNow()) : null;
  const selId = sel?.kind === 'node' ? sel.id : null;
  const selLine = sel?.kind === 'line' ? sel.id : null;
  const P = new Map(nodes.map((n) => [n.id, at(n)]));
  const W = VIEW.W, H = VIEW.H;
  // 1.6.4：画面のまわり（MAP_PAD）まで描く。inView：画面の中（名前の重なりは、画面の中の地点を先に決める）
  const PX = W * MAP_PAD, PY = H * MAP_PAD;
  const onScreen = (p, m = 40) => p.x > -PX - m && p.x < W + PX + m && p.y > -PY - m && p.y < H + PY + m;
  const inView = (p) => p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20;
  let s = Art.MAP_DEFS;
  // 今の 50 Hz と 60 Hz の境目（参考）の文字
  if (japan && g.era >= 2) {
    const mid = at({ x: JAPAN_HZ_LINE[3][0], y: JAPAN_HZ_LINE[3][1] });
    if (onScreen(mid, 0)) s += `<text x="${(mid.x + 6).toFixed(1)}" y="${(mid.y - 6).toFixed(1)}" class="ghzlabel">今の境目（参考）</text>`;
  }
  // 線（下の色は使用率・直流・止まっている）
  const hzN = hzOfNodes(g); // 1.6.4 周波数の色
  let flows = '';
  const lineLabs = [];
  let lineDots = '';
  for (const l of g.lines) {
    const a = P.get(l.a), b = P.get(l.b);
    if (!a || !b) continue;
    if (Math.max(a.x, b.x) < -PX - 40 || Math.min(a.x, b.x) > W + PX + 40 || Math.max(a.y, b.y) < -PY - 40 || Math.min(a.y, b.y) > H + PY + 40) continue;
    const K = Gm.LINES[l.kind];
    const L2 = linePath(a, b, l.route, K.dc);
    const building = l.readyAt > t;
    const hzT = !building && !!l.hzTrip; // 1.8.0 周波数違いで切れている：赤い点線（黄色い点線は流さない）
    const down = !building && (hzT || Gm.lineCircuits(l, t) <= 0);
    const fl = hzT ? null : g.last?.lines[l.id];
    const u = fl?.util || 0;
    const flowing = !building && !down && !!fl && fl.p > 1e-3;
    // 1.7.4：直流の線も、使用率が 90% を超えたら使用率の色
    const col = building ? 'var(--muted)' : down ? 'var(--ng)' : K.dc && Mn.utilTier(u) === 0 ? 'var(--gdc)' : utilColor(u);
    const wdt = lineWidth(K);
    const cAdd = !building && l.cAdd?.length ? l.cAdd : null; // 1.10.2 回線の増設工事中（今の回線は動く）
    const cAddLeft = cAdd ? Math.max(1, Math.min(...cAdd.map((c) => c.readyAt)) - t) : 0;
    // 1.7.4：拡大して線の名前が出るときは、いま送っている量も
    const shortL = Gm.lineShort(l);
    const label = building ? `${shortL} 工事 あと${hoursText(l.readyAt - t)}` : hzT ? `${shortL} 切れている（周波数違い）` : `${shortL}${l.n > 1 ? `×${l.n}` : ''}${flowing ? ` ${kw(fl.p)}` : ''}${cAdd ? ` +${cAdd.length}回線工事 あと${hoursText(cAddLeft)}` : ''}${l.up500At > t ? ` 500kV昇圧 あと${hoursText(l.up500At - t)}` : ''}`;
    const mk = markOf(l.id);
    // 1.8.1：名前を出すか・どこに置くかは、地点の名前を決めたあと（placeLineLabels）。ここでは候補に入れるだけ
    if (L2.len > 70 || selLine === l.id || cAdd) lineLabs.push({ l, K, L2, a, b, label, building, cAdd: !!cAdd, hzT, flowing, mk, sel: selLine === l.id });
    else if (!building) lineDots += optMarks(l, L2.lx, L2.ly, t, true);
    const hz = !K.dc && !hzT && hzN.get(l.a);
    const lineFx = mk === 'doneline' ? `<path d="${L2.d}" class="gdoneline" pathLength="100" fill="none" stroke-width="${wdt + 5}" stroke-linecap="round"/>` : mk === 'firstline' ? `<path d="${L2.d}" class="gfirstline" pathLength="100" fill="none" stroke-width="${wdt + 6}" stroke-linecap="round"/>` : mk === 'glow' ? `<path d="${L2.d}" class="gglow" fill="none" stroke-width="${wdt + 6}" stroke-linecap="round"/>` : '';
    s += `<g class="gline${selLine === l.id ? ' sel' : ''}${B ? ' gdim' : ''}" data-line="${l.id}"><path d="${L2.d}" fill="none" stroke="transparent" stroke-width="22"/>${hz ? `<path d="${L2.d}" class="ghzhalo h${hz}" stroke-width="${wdt + 5}"/>` : ''}${selLine === l.id ? `<path d="${L2.d}" fill="none" stroke="var(--primary)" stroke-width="${wdt + 5}" stroke-linecap="round" opacity=".3"/>` : ''}${lineFx}<path d="${L2.d}" fill="none" stroke="${col}" stroke-width="${wdt}" stroke-linecap="round" ${building ? 'stroke-dasharray="2 5"' : hzT ? 'stroke-dasharray="1.5 4.5" class="ghztrip"' : down ? 'stroke-dasharray="7 5"' : ''}/>${flowing ? flowArrow(L2, a, b, fl.to !== l.a, wdt, u) : ''}</g>`;
    flows += flowPath(g, l, a, b, L2, mk === 'glow' || mk === 'doneline' || mk === 'firstline');
  }
  s += `<g class="gflows${B ? ' gdim' : ''}" aria-hidden="true">${flows}</g>`;
  // 建設モードの仮の線（点線）
  if (B?.kind === 'line' && B.from && B.to) {
    const L2 = linePath(P.get(B.from), P.get(B.to), B.route, Gm.LINES[B.lk].dc);
    s += `<path d="${L2.d}" class="gtemp" fill="none"/>`;
  }
  // 地点：目立つ順に置き、近すぎるものは点にする。文字は重ならないものだけ
  const has = (n) => g.plants.some((p) => p.site === n.id) || g.subs.some((v) => v.town === n.id) || (g.convs || []).some((v) => v.town === n.id) || g.loads.some((l) => l.town === n.id);
  const start = Gm.startId(g);
  const prio = (n) => (selId === n.id ? 4000 : 0) + (cand?.get(n.id) ? 2000 : 0) + (has(n) ? 600 : 0) + (n.id === start ? 300 : 0) + (Gm.nodeOpen(g, n) ? 100 : 0) + (n.town ? (n.size || 2) * 30 : 10);
  const prio2 = (n) => prio(n) + (inView(P.get(n.id)) ? 10000 : 0);
  const vis = nodes.filter((n) => onScreen(P.get(n.id))).sort((a, b) => prio2(b) - prio2(a));
  const placed = [], labels = [];
  const iconBoxes = []; // 1.8.1 町・用地の横の発電所・変電所のアイコン（線の名前を重ねない）
  const animOk = mapAnimOn() && (!japan || Mg.sceneLevel(VIEW.w) > 0); // 1.10.3 案2：幅 60 km 以下・画面の中の町だけ
  let motions = '', motionCnt = 0;
  let wardNamed = false;
  const out = [];
  for (const n of vis) {
    const { x, y } = P.get(n.id);
    const c = cand?.get(n.id);
    const force = selId === n.id || !!c;
    const near = placed.some((q) => Math.hypot(q.x - x, q.y - y) < DOT_GAP);
    const full = force || !near;
    if (full) {
      placed.push({ x, y });
      if (animOk && motionCnt < 14 && inView({ x, y })) {
        const ms = Art.mapTownMotionSvg(g, n, x, y, t);
        if (ms) (motions += ms), motionCnt++;
      }
      const ng = Art.assetGroups(g, n.id).length;
      if (ng) {
        const S = Art.slotsFor(Art.iconSide(nodes, n.id));
        for (let i = 0; i < ng; i++) {
          const [dx, dy] = S[i % S.length];
          iconBoxes.push({ x0: x + dx - 12, y0: y + dy - 12, x1: x + dx + 12, y1: y + dy + 12 });
        }
      }
    }
    const open = Gm.nodeOpen(g, n);
    // 名前
    let name = null;
    if (full) {
      const ward = japan && n.area === '東京市内';
      const limit = !japan ? Infinity : ward ? NAME_W.ward : n.town ? NAME_W[n.size || 2] : n.coal ? (has(n) ? NAME_W.coal * 2 : NAME_W.coal) : has(n) ? NAME_W.hydro * 3 : NAME_W.hydro;
      if (VIEW.w <= limit || force) name = n.name; // 候補・選んだ地点は、縮めていても名前を出してみる（重なれば出さない）
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
      // 選んだ地点の名前はいつも下に。建設モードの候補は、絵はいつも出すが、名前は重ならないときだけ
      const must = selId === n.id || c === 'sel';
      pos = must ? 'b' : ['b', 't', 'r', 'l'].find((k) => !hit(rects[k])) || null;
      if (!pos) lines = [];
      else labels.push({ x0: rects[pos][0], y0: rects[pos][1], x1: rects[pos][0] + w, y1: rects[pos][1] + h });
    }
    out.push(nodeSvg(g, n, x, y, { full, c, selId, lines, open, pos, hz: hzN.get(n.id), hzNo: !!cand?.hz?.has(n.id) }));
  }
  // 1.6.2 県名：引いて見たとき（幅 300 km 以上）だけ、県の真ん中あたりに小さく薄く。地点の名前・絵と重なるときは省く
  if (japan && terrainOn() && VIEW.w >= 300) {
    for (const p of JAPAN_PREFS) {
      const q = at(p);
      if (!onScreen(q, -10)) continue;
      const w = p.name.length * 8 + 4, h = 10;
      const x0 = q.x - w / 2, y0 = q.y - h / 2;
      if (labels.some((r) => x0 < r.x1 && x0 + w > r.x0 && y0 < r.y1 && y0 + h > r.y0)) continue;
      if (placed.some((r) => r.x > x0 - 10 && r.x < x0 + w + 10 && r.y > y0 - 10 && r.y < y0 + h + 10)) continue;
      labels.push({ x0, y0, x1: x0 + w, y1: y0 + h });
      s += `<text x="${q.x.toFixed(1)}" y="${(q.y + 3.5).toFixed(1)}" class="gpref">${A.esc(p.name)}</text>`;
    }
  }
  // 1.8.1 線の名前：地点の名前・絵とぶつからない位置に（placeLineLabels）。地点より下に描く
  s += `<g class="${B ? 'gdim' : ''}">${lineDots}${placeLineLabels(lineLabs, labels, placed, iconBoxes, inView, t)}</g>`;
  // 目立つものを上に重ねる（描く順は逆）
  s += out.reverse().join('');
  if (motions) s += `<g class="gmotions${B ? ' gdim' : ''}" aria-hidden="true">${motions}</g>`;
  return s;
}
// 1.8.1 線の名前の置き方：選んでいる線 → 画面の中の線 → 電圧の高い線 → 長い線 の順に、
// 線の中点、線に沿って 35%・65%・25%・75% の点（それぞれ線の上側・下側）の候補から、すでに決めた名前（地点・線）の箱と地点の絵に
// ぶつからない最初の位置に置く。どこにも置けなければ名前は出さず、対策の印は小さな点で。選んでいる線はいつも出す（置けなければ中点）。
// 名前の箱は、右に並べる対策の印・左に置く工事の三角コーンの幅も含める。labels：地点の名前の箱（線の名前の箱も足していく）
const LAB_T = [0.5, 0.35, 0.65, 0.25, 0.75];
function lineLabelSpots(L2, a, b) {
  // linePath と同じ2次ベジェの上の点（t は線の長さの割合の近似）
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const cx = 2 * L2.lx - mx, cy = 2 * L2.ly - my; // lx = (mx + cx) / 2
  const out = [];
  for (const u of LAB_T) {
    const v = 1 - u;
    const x = v * v * a.x + 2 * v * u * cx + u * u * b.x, y = v * v * a.y + 2 * v * u * cy + u * u * b.y;
    out.push({ x, y, side: 'up' }, { x, y, side: 'down' });
  }
  return out;
}
function placeLineLabels(labs, labels, placed, iconBoxes, inView, t) {
  if (!labs.length) return '';
  const icon = [...placed.map((q) => ({ x0: q.x - 12, y0: q.y - 12, x1: q.x + 12, y1: q.y + 12 })), ...iconBoxes];
  const kv = (o) => (o.K.dc ? 0 : o.K.kv);
  labs.sort((p, q) => (q.sel - p.sel) || (inView({ x: q.L2.lx, y: q.L2.ly }) - inView({ x: p.L2.lx, y: p.L2.ly })) || kv(q) - kv(p) || q.L2.len - p.L2.len);
  const hit = (r) => labels.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0) || icon.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
  let s = '';
  for (const o of labs) {
    const { l, L2, label, building, cAdd } = o;
    const work = building || cAdd;
    const nOpt = building ? 0 : Object.keys(Gm.LINE_OPTS).filter((k) => Gm.optOn(l, k, t)).length;
    const tw = textW7(label);
    const left = work ? 16 : 0, right = nOpt ? nOpt * 12 + 3 : 0;
    // 名前の文字の基準線（y）と、そこからの箱
    const boxOf = (x, y) => ({ x0: x - tw / 2 - left - 1, y0: y - 8, x1: x + tw / 2 + right + 1, y1: y + 3 });
    const spots = lineLabelSpots(L2, o.a, o.b).map((p) => {
      const up = p.side === 'up';
      const y = up ? p.y - (o.flowing ? 9 : 4) : p.y + (o.flowing ? 14 : 10);
      return { x: p.x, y };
    });
    let pick = spots.find((p) => !hit(boxOf(p.x, p.y)));
    if (!pick && o.sel) pick = spots[0];
    if (!pick) {
      if (!building) s += optMarks(l, L2.lx, L2.ly, t, true);
      continue;
    }
    const { x, y } = pick;
    labels.push(boxOf(x, y));
    const cls = building ? ' gwork' : o.hzT ? ' gtrip' : '';
    s += `<g class="gline glab${o.sel ? ' sel' : ''}" data-line="${l.id}"><text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="glabel${cls}">${label}</text>${work ? cone(x - tw / 2 - 8, y - 3, o.mk === 'work') : ''}${building ? '' : optMarks(l, x + tw / 2 + 9, y - 2.5, t, false, true)}</g>`;
  }
  return s;
}
// 1.6.4 50 Hz 網と 60 Hz 網の色分け（日本列島・交流の時代）：交流の線でつながった地点の集まりごとに、その中の交流の発電機の周波数。
// 地点 → 50 | 60（交流の発電機か交流の線のある地点だけ）。見た目だけ（つなげるかどうかは grid.js の netHz）
function hzOfNodes(g) {
  const m = new Map();
  if (!Gm.isJapan(g) || g.era < 2) return m;
  const up = new Map();
  const find = (x) => {
    while (up.has(x) && up.get(x) !== x) x = up.get(x);
    return x;
  };
  const join = (a, b) => {
    for (const v of [a, b]) if (!up.has(v)) up.set(v, v);
    const ra = find(a), rb = find(b);
    if (ra !== rb) up.set(ra, rb);
  };
  for (const l of g.lines) if (!Gm.LINES[l.kind].dc && !l.hzTrip) join(l.a, l.b); // 1.8.0 周波数違いで切れている線は網に入れない
  const acPlants = g.plants.filter((p) => Gm.PLANTS[p.type].ac && p.hz);
  for (const p of acPlants) if (!up.has(p.site)) up.set(p.site, p.site);
  const hzRoot = new Map();
  for (const p of acPlants) if (!hzRoot.has(find(p.site))) hzRoot.set(find(p.site), p.hz);
  for (const v of up.keys()) {
    const hz = hzRoot.get(find(v));
    if (hz) m.set(v, hz);
  }
  return m;
}
// 1.6.5 危険の絵（中心 0・おおよそ ±5）：雷＝稲妻、塩害＝波、雪＝雪の結晶、地絡＝接地の記号 ⏚。地図の対策の印と、危険・対策の文字の前に添える
const HAZ_ICON = {
  thunder: '<path d="M1.2,-5 L-3.2,0.8 H-0.3 L-1.4,5 L3.2,-1 H0.3Z"/>',
  coast: '<path d="M-4.6,-1.6 C-3.4,-3.2 -2.2,-3.2 -1.1,-1.6 S1.2,0 2.3,-1.6 S4.4,-3.2 5,-2.2 M-4.6,2.4 C-3.4,0.8 -2.2,0.8 -1.1,2.4 S1.2,4 2.3,2.4 S4.4,0.8 5,1.8"/>',
  snow: '<path d="M0,-4.8 V4.8 M-4.2,-2.4 L4.2,2.4 M-4.2,2.4 L4.2,-2.4 M-1.3,-3.9 L0,-2.6 L1.3,-3.9 M-1.3,3.9 L0,2.6 L1.3,3.9"/>',
  ground: '<path d="M0,-4.8 V-0.6 M-4.2,-0.6 H4.2 M-2.7,1.7 H2.7 M-1.2,4 H1.2"/>',
};
const HAZ_WORD = { thunder: '雷', coast: '塩害', snow: '雪', ground: '地絡' };
// 1.6.5 送電線の対策の印：その対策で防ぐ危険の絵に、右下の小さな ✓（緑）。架空地線＝雷・耐塩がいし＝塩害・相間スペーサ＝雪・消弧リアクトル＝地絡
const OPT_HAZ = { gw: 'thunder', insul: 'coast', spacer: 'snow', petersen: 'ground' };
const CHECK = '<path class="gchkb" d="M1.2,3.4 L2.7,4.9 L5.6,1.6"/><path class="gchk" d="M1.2,3.4 L2.7,4.9 L5.6,1.6"/>';
const optGlyph = (o) => `<g class="gh-${OPT_HAZ[o]}" transform="translate(-1.1,-1.1) scale(.78)">${HAZ_ICON[OPT_HAZ[o]]}</g>${CHECK}`;
// 文字の前に添える小さな絵（HTML）
const hazIcon = (h) => (HAZ_ICON[h] ? `<svg class="ghazi" viewBox="-6 -6 12 12" aria-hidden="true"><g class="gh-${h}">${HAZ_ICON[h]}</g></svg>` : '');
const optIcon = (o) => `<svg class="ghazi" viewBox="-6.5 -6.5 13 13" aria-hidden="true">${optGlyph(o)}</svg>`;
const optKey = (o) => `${optIcon(o)}＝${HAZ_WORD[OPT_HAZ[o]]}の対策（${Gm.LINE_OPTS[o].name}）`;
// 7px の文字の幅（おおよそ。半角 4px・全角 7px）
const textW7 = (str) => [...str].reduce((a, c) => a + (c.charCodeAt(0) < 256 ? 4 : 7), 0);
// x・y：left なら左端の印の中心（線の名前の右に並べる）、そうでなければ真ん中
function optMarks(l, x, y, t, dot, left = false) {
  const os = Object.keys(Gm.LINE_OPTS).filter((o) => Gm.optOn(l, o, t));
  if (!os.length) return '';
  if (dot) return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" class="goptdot"/>`; // 名前の出ない縮尺では点だけ
  const x0 = left ? x : x - ((os.length - 1) * 12) / 2;
  return os.map((o, i) => `<g class="gopt o-${o}" transform="translate(${(x0 + i * 12).toFixed(1)},${y.toFixed(1)})"><circle r="6.2" class="goptbg"/>${optGlyph(o)}</g>`).join('');
}
// 1.8.2 記念の建物：拡大したとき（日本列島は景色を描く幅 60 km 以下。古い島はいつも）、町のまわりの空いたアイコンの場所に小さな絵。見た目だけ
function decorsSvg(g, n, x, y) {
  const ds = Gm.decorsOf(g, n.id);
  if (!ds.length || (Gm.isJapan(g) && !Mg.sceneLevel(VIEW.w))) return '';
  // 町の絵の上（名前は下、発電所・変電所のアイコンは左右なので、上の真ん中を空けてある）
  const POS = [[0, -31], [-19, -29], [19, -29]];
  return ds.map((d, i) => Art.decorSvg(d.kind, x + POS[i][0], y + POS[i][1], 0.85)).join('');
}
// 1.6.4 発電所の稼働の光：引いて見たとき（点になる地点・幅 150 km 以上）も、動いている発電所に出力に応じた光彩。
// 止まっている・休止・待機は光らない。渇水で出力が落ちている水力は薄いオレンジ
function plantGlow(g, n, x, y, plants) {
  const ready = plants.filter((p) => p.readyAt <= g.t);
  const out = ready.reduce((a, p) => a + (g.last?.plants[p.id] || 0), 0);
  const cap = ready.reduce((a, p) => a + p.kw, 0);
  if (!(out > 0.5) || !cap) return '';
  const k = Math.min(1, out / cap);
  const dry = Gm.evOn(g, 'drought') && ready.some((p) => !Gm.PLANTS[p.type].coal && (g.last?.plants[p.id] || 0) > 0);
  const r = Math.min(15, 6 + 2.2 * Math.log10(1 + out));
  const c = (rr) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}"/>`;
  return `<g class="gglowp${dry ? ' dry' : ''}" style="opacity:${(0.4 + 0.6 * k).toFixed(2)}">${c(r)}${c(r * 0.55)}</g>`;
}
// 1.7.4 届いていない町の赤い枠：全部届いていなければ一周、一部だけなら届いていない割合の弧（最低 1/4。上から時計回り）
function missRing(g, id, x, y, r) {
  const tw = g.last?.towns[id];
  if (!tw || !(tw.d > 1e-6) || tw.r >= 0.99) return '';
  const C = 2 * Math.PI * r;
  const k = tw.r <= 0.01 ? 1 : Math.max(0.25, 1 - tw.r);
  const dash = k >= 1 ? '' : ` stroke-dasharray="${(C * k).toFixed(1)} ${C.toFixed(1)}"`;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="gmiss${r < 10 ? ' sm' : ''}" transform="rotate(-90 ${x.toFixed(1)} ${y.toFixed(1)})"${dash}/>`;
}
// 地点1つの絵。full：絵で描く／点で描く。c：建設モードの候補（'can'・'sel'）。lines：名前（1〜2行）。open：開いている地点か
function nodeSvg(g, n, x, y, { full, c, selId, lines, open, pos = 'b', hz = null, hzNo = false }) {
  const t = g.t;
  const mode = !B ? (selId === n.id ? ' sel' : '') : c === 'sel' ? ' sel' : c ? ' gcan' : hzNo && full ? ' ghzno' : ' gdim'; // 1.6.4 周波数違い：絵は薄く、札は読めるように
  const kind = n.town ? 'gtownn' : n.coal ? 'gsite gcoaln' : n.game ? 'gsite ggame' : 'gsite';
  const cls = `gnode ${kind}${mode}${open ? '' : ' gclosed'}${full ? '' : ' gdot'}`;
  const plants = g.plants.filter((p) => p.site === n.id);
  const subs = g.subs.filter((v) => v.town === n.id);
  const convs = (g.convs || []).filter((v) => v.town === n.id);
  const inc = g.incidents.some((i) => i.town === n.id || plants.some((p) => p.id === i.plant) || subs.some((v) => v.id === i.sub));
  const f = (v) => v.toFixed(1);
  // 1.6.4：稼働の光（点の地点はいつも。絵の地点は引いて見たときだけ）・周波数の色（網に入っている地点にほのかな円）
  const glow = plants.length && (!full || (Gm.isJapan(g) && VIEW.w >= 150)) ? plantGlow(g, n, x, y, plants) : '';
  const miss = n.town ? missRing(g, n.id, x, y, full ? 19 : 6.8) : '';
  const tint = hz ? `<circle cx="${f(x)}" cy="${f(y)}" r="${full ? 13 : 7}" class="ghztint h${hz}"/>` : '';
  if (!full) {
    // 点：町は灯り具合の色、炭田は小さな黒い山、水力の用地は小さな菱形
    const look = n.town ? Art.townLook(g, n) : null;
    const dot = n.town
      ? `<circle cx="${f(x)}" cy="${f(y)}" r="3.6" class="gdotc t-${look.state}"/>`
      : n.coal
        ? `<path d="M${f(x - 4.4)},${f(y + 3.2)} L${f(x)},${f(y - 3.6)} L${f(x + 4.4)},${f(y + 3.2)}Z" class="gdotc c${plants.length ? ' has' : ''}"/>`
        : `<path d="M${f(x)},${f(y - 3.6)} L${f(x + 3.6)},${f(y)} L${f(x)},${f(y + 3.6)} L${f(x - 3.6)},${f(y)}Z" class="gdotc s${plants.length ? ' has' : ''}"/>`;
    return `<g class="${cls}" data-node="${n.id}"><circle cx="${f(x)}" cy="${f(y)}" r="9" fill="transparent"/>${glow}${tint}${miss}${dot}${inc ? `<circle cx="${f(x + 4)}" cy="${f(y - 4)}" r="3" fill="var(--ng)"/>` : ''}</g>`;
  }
  // 1.5.3：町は家並み（灯ると窓が光り、まわりに光の輪）、1.10.1 炭田は小さな黒い石炭の山、水力の用地は菱形。発電所・変電所は種類のアイコンを横に出し、短い線でつなぐ（gridart.js）
  let body = n.town
    ? Art.townSvg(x, y, Art.townLook(g, n))
    : n.coal
      ? `<g class="gcoal${plants.length ? ' has' : ''}" transform="translate(${f(x)},${f(y)})"><path d="M-9.5,6.5 L-4.5,-2.5 L0,-6.5 L4.5,-2 L9.5,6.5Z" class="gcoalbody"/><path d="M-4.5,-2.5 L-1,1.2 L3.5,-2" class="gcoalhi"/></g>`
      : `<path d="M${f(x)},${f(y - 9)} L${f(x + 9)},${f(y)} L${f(x)},${f(y + 9)} L${f(x - 9)},${f(y)}Z" class="gsitebody${plants.length ? ' has' : ''}"/>`;
  body += Art.assetsSvg(g, n, x, y, Art.iconSide(Gm.nodesOf(g), n.id));
  if (n.town && full) body += decorsSvg(g, n, x, y);
  // 工事中の発電所・変圧器・変換所：残りの時間を小さく添える
  const work = [...plants, ...subs, ...convs].filter((v) => v.readyAt > t).map((v) => v.readyAt - t);
  if (work.length) body += `<text x="${f(x)}" y="${f(y - 25)}" class="glabel gwork">工事 あと${hoursText(Math.min(...work))}</text>${cone(x + 14, y + 13, markOf(n.id) === 'work')}`;
  const mk = markOf(n.id);
  if (mk === 'done') body = `<g class="gbounce">${body}</g>`;
  else if (mk === 'doneplant') body = `<g class="gdoneplant" style="transform-origin:${f(x)}px ${f(y)}px">${body}<circle cx="${f(x)}" cy="${f(y)}" r="22" class="gdoneburst"/></g>`;
  else if (mk === 'donesub') body = `<g class="gdonesub">${body}<circle cx="${f(x)}" cy="${f(y)}" r="18" class="gdonesubring"/></g>`;
  else if (mk === 'firsttown') body = `<g class="gfirsttown" style="transform-origin:${f(x)}px ${f(y)}px">${body}<circle cx="${f(x)}" cy="${f(y)}" r="26" class="gfirstburst"/></g>`;
  const wv = n.town ? waveOf(n.id) : null;
  if (wv) body = `<g class="gwave-${wv.kind}" style="--wdelay:${wv.delay}ms">${body}</g>`;
  const ring = !B ? (selId === n.id ? `<circle cx="${f(x)}" cy="${f(y)}" r="17" class="gselring"/>` : '') : c === 'sel' ? `<circle cx="${f(x)}" cy="${f(y)}" r="17" class="gselring"/>` : c ? `<circle cx="${f(x)}" cy="${f(y)}" r="16" class="gpulse"/><circle cx="${f(x)}" cy="${f(y)}" r="16" class="gring"/>` : '';
  // 名前（pos：b＝下・t＝上・r＝右・l＝左）
  const nh = lines.length * 10.5;
  const [tx, ty, anc] = { b: [x, y + 23, ''], t: [x, y - 17 - nh, ''], r: [x + 13, y + 3.5 - (nh - 10.5) / 2, ' start'], l: [x - 13, y + 3.5 - (nh - 10.5) / 2, ' end'] }[pos] || [x, y + 23, ''];
  const name = lines.length ? `<text y="${f(ty)}" class="gname${anc ? ` a${anc.trim()}` : ''}">${lines.map((v, i) => `<tspan x="${f(tx)}" dy="${i ? 10.5 : 0}">${A.esc(v)}</tspan>`).join('')}</text>` : '';
  // 1.6.4 建設モード：周波数が違うためにつなげない地点に短い札（押すと理由。buildTap → whyNot）
  const hzTag = hzNo ? `<g class="ghztag"><rect x="${f(x - 27)}" y="${f(y - 36)}" width="54" height="13" rx="6.5"/><text x="${f(x)}" y="${f(y - 26.5)}">周波数違い</text></g>` : '';
  return `<g class="${cls}" data-node="${n.id}"><circle cx="${f(x)}" cy="${f(y)}" r="23" fill="transparent"/>${glow}${tint}${ring}${miss}${body}
      ${name}${hzTag}
      ${inc ? `<circle cx="${f(x + 12)}" cy="${f(y + 8)}" r="6" fill="var(--ng)"/><text x="${f(x + 12)}" y="${f(y + 11)}" class="gbang">!</text>` : ''}</g>`;
}
// 1.7.4 流れの向きの矢印（線の中ほど。縮小しても出す）。色は使用率（〜90% は文字の色、90% 超はオレンジ、100% 超・120% 超は赤の濃さ）。
// 黄色い点線（送電の演出）と見分けがつくよう、塗りの三角に地図の色の縁
function flowArrow(P, a, b, toB, w, u) {
  if (P.len < 22) return '';
  let dx = b.x - a.x, dy = b.y - a.y;
  if (!toB) (dx = -dx), (dy = -dy);
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const s = 3.2 + w * 0.9;
  const x = P.lx - ux * s * 0.2, y = P.ly - uy * s * 0.2;
  const f = (v) => v.toFixed(1);
  const col = Mn.utilTier(u) === 0 ? 'var(--text)' : utilColor(u);
  return `<path d="M${f(x + ux * s)},${f(y + uy * s)} L${f(x - ux * s * 0.7 + uy * s * 0.75)},${f(y - uy * s * 0.7 - ux * s * 0.75)} L${f(x - ux * s * 0.7 - uy * s * 0.75)},${f(y - uy * s * 0.7 + ux * s * 0.75)}Z" class="garrow" fill="${col}"/>`;
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
  const w = lineWidth(K) + 0.8; // 下の線より少し太く。暗い縁（gflowe）を下に敷いて、明るい地図でも見えるように
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
  // 1.7.3 日本列島：下の層と景色の層は 1 枚の canvas に描く（見え方・景色・色が変わったときだけ。paintBase）。古い島は SVG
  const jp = Gm.isJapan(g);
  let base = wrap.querySelector('[data-base]');
  if (jp !== ('cv' in base.dataset)) {
    if (!jp) Mc.release(base);
    base.outerHTML = jp ? CANVAS_HTML : baseSvg(g);
    base = wrap.querySelector('[data-base]');
  }
  if (jp) paintBase(g, base);
  else {
    if (VIEW.base !== baseKeyOf(g)) (base.outerHTML = baseSvg(g)), (base = wrap.querySelector('[data-base]'));
    base.setAttribute('viewBox', mapVB());
    base.querySelector('[data-basetf]').setAttribute('transform', baseTf());
  }
  const top = wrap.querySelector('[data-top]');
  top.setAttribute('viewBox', mapVB());
  top.innerHTML = topInner(g);
  const night = wrap.querySelector('[data-night]');
  if (night) night.style.opacity = nightLevel(g);
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
// 1.7.2：地図は指が触れた最初の move から指について動かす（8px を超えた瞬間にまとめて跳ばない）。
// 8px を超えずに離したら「押した」として、ついてきた分を元に戻してから押したときの処理をする
const MOVE_PX = 8;
const GS = { pts: new Map(), start: null, moved: false, pinch: null, lastTap: null, tf: null, dirty: false, lastFill: 0, raf: 0, hid: false, rect: null };
let mapRO = null;
function bindMap() {
  const mid = document.querySelector('[data-mid]');
  const box = document.querySelector('[data-mapbox]');
  const wrap = () => document.querySelector('[data-mapwrap]');
  GS.rect = null; // 画面を作り直したら、測り直し・隠したメニューの印もやり直し
  GS.hid = false;
  // 1.7.2：地図の枠の位置は、最初の指が触れたときに1回だけ測って使い回す（move のたびに配置の計算をさせない）
  const rel = (e, fresh = false) => {
    if (fresh || !GS.rect) GS.rect = box.getBoundingClientRect();
    return { x: e.clientX - GS.rect.left, y: e.clientY - GS.rect.top };
  };
  // 1.7.2：動かしている間はメニュー・線のメニューを隠す（祖先クラスは変えない）。1.10.3：使い手側の動き層だけ止める
  const hideMenu = (h) => {
    if (GS.hid === h) return;
    GS.hid = h;
    const m = document.querySelector('[data-menu]');
    if (m) m.style.visibility = h ? 'hidden' : '';
    const gm = document.querySelector('[data-top] .gmotions');
    if (gm) gm.classList.toggle('paused', h);
  };
  // 1.6.4：動かしている途中の形も、地図の範囲と拡大の限度に収める（離したとき・途中の描き直しで、地図が跳ね戻らないように）
  // 画面の点 p' ＝ s・p ＋ t のとき、新しい見え方は x' ＝ x − t／(s・k)、w' ＝ w／s
  const clampTf = (tx, ty, s) => {
    const k0 = scaleK();
    const v = clampView(G(), { x: VIEW.x - tx / s / k0, y: VIEW.y - ty / s / k0, w: VIEW.w / s });
    const s2 = VIEW.w / v.w;
    return [s2 * k0 * (VIEW.x - v.x), s2 * k0 * (VIEW.y - v.y), s2];
  };
  const setTf = (tx0, ty0, s0) => {
    const [tx, ty, s] = clampTf(tx0, ty0, s0);
    GS.tf = { tx, ty, s };
    const w = wrap();
    if (w) w.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
  };
  // 動かした分を VIEW に移して描き直す（画面の点 p' ＝ s・p ＋ t）
  const apply = (tf) => {
    const k0 = scaleK();
    VIEW.x += -tf.tx / tf.s / k0;
    VIEW.y += -tf.ty / tf.s / k0;
    VIEW.w /= tf.s;
    clampView(G());
  };
  const commit = () => {
    const tf = GS.tf;
    GS.tf = null;
    if (GS.raf) cancelAnimationFrame(GS.raf), (GS.raf = 0);
    const w = wrap();
    if (w) w.style.transform = '';
    hideMenu(false);
    const dirty = GS.dirty;
    GS.dirty = false;
    if (!tf && !dirty) return;
    if (tf) apply(tf);
    afterMove();
  };
  // 1.6.4 動かしている途中の描き直し：まわりに描いておいた分（MAP_PAD）を使い切りそうなとき・大きく拡大したときだけ、
  // 指を離す前に地図を描き直す（メニュー・カードは離したときに）。続けて描き直すのは 0.2 秒に1回まで
  const needFill = (tf) => {
    const W = VIEW.W, H = VIEW.H, m = 0.35 * MAP_PAD;
    const x0 = -tf.tx / tf.s, x1 = (W - tf.tx) / tf.s, y0 = -tf.ty / tf.s, y1 = (H - tf.ty) / tf.s;
    return tf.s > 1.7 || x0 < -W * (MAP_PAD - m) || x1 > W * (1 + MAP_PAD - m) || y0 < -H * (MAP_PAD - m) || y1 > H * (1 + MAP_PAD - m);
  };
  const fill = () => {
    GS.raf = 0;
    const tf = GS.tf;
    if (!tf || !GS.pts.size) return;
    GS.lastFill = Date.now();
    GS.tf = null;
    apply(tf);
    const w = wrap();
    if (w) w.style.transform = '';
    drawMap();
    GS.dirty = true;
    // 指の今の位置を、新しい起点にする
    const one = { tx: 0, ty: 0, s: 1 };
    if (GS.pinch && GS.pts.size >= 2) {
      const [a, b] = [...GS.pts.values()];
      GS.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, base: one };
    } else if (GS.start) {
      const q = GS.pts.get(GS.start.id);
      if (q) GS.start = { ...GS.start, x: q.x, y: q.y, base: one };
    }
  };
  const maybeFill = () => {
    if (GS.raf || !GS.tf || !needFill(GS.tf) || Date.now() - GS.lastFill < 200) return;
    GS.raf = requestAnimationFrame(fill);
  };
  box.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    const p = rel(e, GS.pts.size === 0);
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
      hideMenu(true);
      maybeFill();
      return;
    }
    const st = GS.start;
    if (!st || st.id !== e.pointerId || GS.pts.size !== 1) return;
    const dx = p.x - st.x, dy = p.y - st.y;
    // 一度でも 8px を超えたら「動かした」（戻ってきても押したにはしない）
    if (!GS.moved && Math.hypot(dx, dy) > MOVE_PX) GS.moved = true, hideMenu(true);
    setTf(st.base.tx + dx, st.base.ty + dy, st.base.s);
    if (GS.moved) maybeFill();
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
    // 1.7.2 押した（8px を超えなかった）：指についてきた分を元に戻す（VIEW は変えない）
    if (GS.tf) {
      GS.tf = null;
      const w = wrap();
      if (w) w.style.transform = '';
    }
    hideMenu(false);
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
    const p = rel(e, true);
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
  // 1.6.2 地形の凡例（押すと開く・閉じる）
  const bindKey = () => {
    const k = box.querySelector('[data-terkey]');
    if (!k) return;
    k.addEventListener('pointerdown', (e) => e.stopPropagation());
    k.addEventListener('pointerup', (e) => e.stopPropagation());
    k.querySelector('[data-terkeybtn]').onclick = () => {
      keyOpen = !keyOpen;
      k.outerHTML = terrainKeyHtml();
      bindKey();
    };
  };
  bindKey();
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
  town: '<path d="M3 20h18M5 20V11l4-3 4 3v9M13 20V7h6v13M7.5 14h2M7.5 17h2M15.5 11h2M15.5 15h2"/>',
  detail: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7.2v.6"/>',
  rm: '<path d="M5 7h14M9.5 7V5h5v2M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6"/>',
  inc: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17v.6"/>',
  circ: '<path d="M3 8h12M3 13h12M3 18h7"/><path d="M18 13v8M14 17h8"/>',
  opt: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 9v6M9 12h6"/>',
};
const TYPE_ICON = {
  coal: '<path d="M4 20V11l5 3v-3l5 3V7h3v13z"/><path d="M15 5c0-2 2-2 2-3.5"/>',
  hydro: '<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2-1.5 4.5-1.5S19 17 21 17M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2-1.5 4.5-1.5S19 21 21 21"/><path d="M12 3c-2.5 4-4 5.8-4 7.8a4 4 0 0 0 8 0C16 8.8 14.5 7 12 3z"/>',
  sub: '<rect x="3" y="7" width="18" height="11" rx="2"/><circle cx="9.5" cy="12.5" r="3"/><circle cx="14.5" cy="12.5" r="3"/>',
  conv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 11c1.2-2.2 2.4-2.2 3.6 0s2.4 2.2 3.6 0M6 15h12"/>',
  line: '<path d="M8 21l3-17h2l3 17M9.6 10h4.8M8.8 15h6.4M4 6.5c4 1.8 12 1.8 16 0"/>',
  cap: '<path d="M3 12h7M14 12h7M10 5v14M14 5v14"/>',
};
const typeIcon = (c) => (c.b.startsWith('rm:') ? MI_ICON.rm : c.kind === 'line' ? TYPE_ICON.line : c.kind === 'sub' ? TYPE_ICON.sub : c.kind === 'conv' ? TYPE_ICON.conv : c.kind === 'cap' ? TYPE_ICON.cap : Gm.PLANTS[c.key].coal ? TYPE_ICON.coal : TYPE_ICON.hydro);
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
  return `<button class="${cls}" ${attr} style="left:${Math.round(it.x)}px;top:${Math.round(it.y)}px;width:${it.w}px;--i:${i}"><span class="gmc">${SVGI(icon)}</span><span class="gml">${A.esc(label).replace(/\n/g, '<br>')}${o.tag ? `<small>${A.esc(o.tag)}</small>` : ''}</span></button>`;
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
  const items = sel.kind === 'node' ? Mn.nodeMenu(g, lc, sel.id) : Mn.lineMenu(g, lc, sel.id);
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
    html += sub.map((c, i) => miBtn(Bp, i, `data-mb="${c.b}"`, typeIcon(c), c.kind === 'cap' ? '進相\nコンデンサ' : c.name, { sub: true, locked: !c.ok, tag: c.tag || (c.ok && c.st?.proto ? '試作' : '') })).join('');
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
  if (k === 'town' && sel?.kind === 'node') return openTownView(sel.id);
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
    if (k === 'opt') return optDialog(sel.id);
    if (k === 'rm') return removeDialog('line', sel.id);
  }
}
function branchAct(b) {
  const [kind, key, id] = b.split(':');
  if (kind === 'rm') return removeDialog(key, id);
  if (kind === 'cap') return capDialog(key); // 1.6.1：建設の枝から進相コンデンサ（まだ付けられないときも、シートに理由と単元）
  const st = typeStatus(learningNow(), kind, key);
  if (!st.ok) return whySheet(kind, key, st);
  enterBuild(kind, key, sel.id);
}
// まだ建てられない種類：理由と「この単元を解く」
function whySheet(kind, key, st) {
  const name = kind === 'plant' ? Gm.PLANTS[key].name : kind === 'line' ? Gm.LINES[key].name : kind === 'conv' ? Gm.CONVS[key].name : '変圧器（変電所）';
  sheet(`<h2>${A.esc(name)}は、まだ建てられません</h2>${whyHtml(st)}`, ({ onAll }) => onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo)));
}
// 回線の増設：費用を見せてから（押してすぐコインを使わない）
function circuitDialog(id) {
  const g = G(), lc = learningNow();
  const l = g.lines.find((x) => x.id === id);
  if (!l) return;
  const qc = Gm.quoteCircuit(g, lc, id);
  const adding = l.cAdd?.length ? `・増設工事中 +${l.cAdd.length}` : '';
  sheet(
    `<h2>回線を増やす</h2>
    <p class="small">${A.esc(Gm.lineName(g, l))}（いま ${l.n}回線${adding}）に、同じルートでもう1回線。送れる量が増え、1回線が止まっても残りで送れる。</p>
    ${qc.ok ? `<p class="gquote"><b>${A.num(qc.cost)} コイン</b>（残高 ${coinText(balance())}）・ 工期 ゲームの ${qc.hours}時間（工事の間も今の回線は動く）</p><button class="btn primary gwide" data-ok>増設する</button>` : whyHtml(qc)}`,
    ({ onAll }) => {
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      onAll('[data-ok]', 'click', () => pay(qc, `${Gm.LINES[l.kind].short}の回線の増設`, () => Gm.addCircuit(G(), learningNow(), id), null, 'circuit'));
    },
  );
}
// 1.11.0 500 kV 設計（275 kV で使用中）の線を 500 kV に上げる工事
function up500Dialog(id) {
  const g = G(), lc = learningNow();
  const l = g.lines.find((x) => x.id === id);
  if (!l) return;
  const qu = Gm.quoteUpgradeLine(g, lc, id);
  sheet(
    `<h2>500 kV に上げる</h2>
    <p class="small">${A.esc(Gm.lineName(g, l))}を 500 kV に上げる。工事の間も 275 kV のまま動き、終わると送れる量が 1回線 ${kw(Gm.LINES.ac500.cap)} になり、損失もさらに小さくなる。</p>
    ${qu.ok ? `<p class="gquote"><b>${A.num(qu.cost)} コイン</b>（残高 ${coinText(balance())}）・ 工期 ゲームの ${qu.hours}時間（新設の 4 分の 1）</p><button class="btn primary gwide" data-ok>工事を始める</button>` : whyHtml(qu)}`,
    ({ onAll }) => {
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      onAll('[data-ok]', 'click', () => pay(qu, `${Gm.lineName(g, l)}の 500 kV 昇圧`, () => Gm.startUpgradeLine(G(), learningNow(), id), null, 'up500'));
    },
  );
}
// 1.6.1 既設の線に後から対策を足す：まだ付けていない対策（解放済みは押せる、まだのものは灰色で理由）。費用は建設のときの 1.3 倍
// どの対策が正解かは目立たせない（並びは LINE_OPTS の順のまま。この線の危険は事実として書く）
function optDialog(id) {
  const g = G(), lc = learningNow();
  const l = g.lines.find((x) => x.id === id);
  if (!l) return;
  const list = Gm.optChoices(g, lc, id);
  const rows = list
    .map(({ key, name, q }) => {
      const O = Gm.LINE_OPTS[key];
      const what = O.hazard ? `${Gm.HAZARD[O.hazard].name}の事故を減らす` : '地絡の事故で止まる時間が短くなる';
      return `<div class="gitem gopt"><p class="spread grow"><span><b>${optIcon(key)}${A.esc(name)}</b><small>${what}</small></span>${q.ok ? `<button class="btn small" data-addopt="${key}">${A.num(q.cost)} コイン</button>` : ''}</p>${q.ok ? '' : whyHtml(q)}</div>`;
    })
    .join('');
  const hours = list.find((x) => x.q.ok)?.q.hours;
  sheet(
    `<h2>対策を足す</h2>
    <p class="small">${A.esc(Gm.lineName(g, l))}（${l.n}回線）・ この線の危険：${hazardText(l.hazards)}</p>
    ${rows || '<p class="small">足せる対策はありません</p>'}
    <p class="small">後から工事するぶん、建設のときに足す費用の ${Gm.RETRO_K} 倍（回線の数だけ）。${hours ? `工期 ゲームの ${hours}時間。` : ''}工事の間も線は止めず、効くのは工事が終わってから。残高 ${coinText(balance())}</p>`,
    ({ onAll }) => {
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      onAll('[data-addopt]', 'click', (e) => {
        const o = e.currentTarget.dataset.addopt;
        const q = Gm.quoteLineOpt(G(), learningNow(), id, o);
        if (!q.ok) return A.toast(q.why);
        pay(q, `${Gm.LINE_OPTS[o].name}（後から）`, () => Gm.addLineOpt(G(), learningNow(), id, o), null, 'opt');
      });
    },
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
  const hp = headPic(g, sel.kind, sel.id);
  el.innerHTML = `${hp ? `<button class="gdband" data-gdband="${hp}" aria-label="絵を大きく見る"><img src="${picSrc(hp)}" alt=""></button>` : ''}<div class="gphead"><h2>${body.title}</h2><button class="btn small" data-dclose>閉じる</button></div>${body.html}`;
  el.classList.toggle('hasband', !!hp);
  if (hp) seen(hp);
  el.classList.add('open');
  const $ = (q) => el.querySelector(q);
  const onAll = (q, ev, fn) => el.querySelectorAll(q).forEach((x) => x.addEventListener(ev, fn));
  onAll('[data-gdband]', 'click', (e) => picViewer(e.currentTarget.dataset.gdband));
  onAll('[data-dclose]', 'click', () => {
    sel.detail = false;
    drawMenu();
    drawDetail();
  });
  onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
  body.bind?.({ $, onAll, g, lc });
  bindOutlook(el);
  const a = selAnchor();
  placeCardAt(el, menuSpan ? [a, { y: menuSpan.top }, { y: menuSpan.bottom }] : [a]);
  el.scrollTop = top;
}

// ---- 建設のパネル：発電所の種類・線の種類（電圧の階級ごと）・変圧器。まだ建てられない種類は灰色 ----
// 種類ごとの「建てられるか」（場所によらない条件：時代・学習の単元・設計図）。1.5.2 から gridmenu.js
const typeStatus = Mn.typeStatus;
function buildPanel(g, lc) {
  const from = buildFor?.site || buildFor?.from;
  const item = (kind, key, name, sub, picHtml) => {
    const s = typeStatus(lc, kind, key);
    const id = `${kind}:${key}`;
    const here = buildFor?.site && kind === 'plant' && !Gm.siteAllows(g, key, buildFor.site);
    return `<button class="gbitem${s.ok && !here ? '' : ' locked'}" data-bitem="${id}">${picHtml}<span class="gbtx"><b>${name}${s.ok && s.proto ? ' <span class="tag">試作</span>' : ''}</b><small>${here ? 'この場所には建てられない' : s.ok ? sub : A.esc(s.why)}</small></span><span class="go">${s.ok && !here ? '›' : ''}</span></button>
      ${whyOpen === id && !s.ok ? `<div class="gwhy">${whyHtml(s)}</div>` : ''}`;
  };
  const range = (D) => {
    const ok = D.sizes.filter((z) => Gm.eraStatus(lc, Math.max(D.era, z[2]?.era || 0)) !== 'no');
    if (!ok.length) return '';
    return `${kw(ok[0][0])}〜${kw(ok[ok.length - 1][0])} ・ ${A.num(ok[0][1] * Gm.COIN_K)} コイン〜`;
  };
  const plants = Object.entries(Gm.PLANTS).map(([k, D]) => item('plant', k, D.name, range(D), pic(k, 'mini'))).join('');
  const lines = Object.entries(Gm.LINES).map(([k, K]) => item('line', k, K.name, `1回線で ${kw(K.cap)} まで ・ ${A.num(K.cost * Gm.COIN_K)} コイン/km`, linePic(k))).join('');
  const maxSub = Gm.SUB_SIZES.filter((m) => Gm.eraStatus(lc, Gm.subSizeEra(m)) !== 'no').slice(-1)[0] || 100;
  const subs = item('sub', 'tr', '変圧器（変電所）', `0.1〜${maxSub} MVA ・ ${A.num(Gm.subCost(Gm.SUB_SIZES[0]) * Gm.COIN_K)} コイン〜 ・ 1つの町に2台まで`, pic('sub', 'mini'));
  const convs = Object.entries(Gm.CONVS)
    .map(([k, D]) => item('conv', k, D.name, `300 kW〜3 MW ・ 効率 ${Math.round(D.eff[0] * 100)}〜${Math.round(D.eff[1] * 100)}% ・ ${A.num(Gm.convCost(k, Gm.CONV_SIZES[0]) * Gm.COIN_K)} コイン〜 ・ 変圧器のある町に2台まで`, pic(k, 'mini')))
    .join('');
  const head = buildFor?.site ? `<p class="small">${A.esc(Gm.nodeOf(g, buildFor.site).name)}に建てる種類を選ぶ</p>` : buildFor?.from ? `<p class="small">${A.esc(Gm.nodeOf(g, buildFor.from).name)}から引く線の種類を選ぶ</p>` : '<p class="small">種類を選ぶと、地図の上で場所を選べます。灰色の種類は、押すと理由がわかります。</p>';
  return {
    title: '建設',
    html: `${head}
      ${buildFor?.from ? '' : `<h3>発電所</h3>${plants}`}
      ${buildFor?.site ? '' : `<h3>線（電圧の階級）</h3>${lines}`}
      ${buildFor || from ? '' : `<h3>変圧器</h3>${subs}<h3>電鉄用の変換所</h3>${convs}`}`,
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
  const T = learningNow().tables || Gm.gridTables(null); // 1.7.4：問題データの単元の対応も含めた表
  const units = (q.gates || []).flatMap((k) => T.gate[k]).concat(q.blueprint ? T.blueprint[q.blueprint] : []);
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
  else if (kind === 'conv') B = { kind: 'conv', type: key, town: null, kw: Gm.CONV_SIZES[0] };
  else B = { kind: 'sub', town: null, mva: Gm.SUB_SIZES[0] };
  buildFor = null;
  panel = null;
  sel = null;
  const c = candidates(g, lc);
  if (preset && c.get(preset)) pick(preset);
  else if (preset) A.toast(whyNot(g, lc, preset));
  if (tutOn() && B.kind === 'plant' && B.type === 'dcCoal' && B.site) B.size = 50; // チュートリアル：京橋・銀座にも送れる大きさ
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
  const nodes = Gm.nodesOf(g).filter((n) => Gm.openEra(g, n) <= Gm.MAX_ERA);
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
    const r275 = B.lk === 'ac500' && (B.run275 ?? (!lc.blueprint?.line500 && !!lc.blueprint?.line275));
    const ok = (a, b) => Gm.quoteLine(g, lc, { a, b, kind: B.lk, run275: r275 }).ok;
    if (!B.from) {
      for (const n of nodes) if (nodes.some((o) => o.id !== n.id && ok(n.id, o.id))) m.set(n.id, 'can');
    } else {
      m.hz = new Set(); // 1.6.4：周波数が違う地点（札「周波数違い」）。1.8.0：引けるが、つなぐと脱調して切れる（警告）
      for (const n of nodes) {
        if (n.id === B.from) continue;
        const q = Gm.quoteLine(g, lc, { a: B.from, b: n.id, kind: B.lk, run275: r275 });
        if (q.ok) m.set(n.id, 'can');
        if (q.hzDiff) m.hz.add(n.id);
      }
      m.set(B.from, 'sel');
      if (B.to) m.set(B.to, 'sel');
    }
  } else if (B.kind === 'conv') {
    for (const n of nodes) if (n.town && Gm.quoteConv(g, lc, { type: B.type, kw: Gm.CONV_SIZES[0], town: n.id }).ok) m.set(n.id, 'can');
    if (B.town) m.set(B.town, 'sel');
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
    if (!Gm.siteAllows(g, B.type, id)) return Gm.PLANTS[B.type].at === 'coast' ? '重油はタンカーで運ぶので、海沿いだけ' : `${n.name}には${Gm.PLANTS[B.type].short}を建てられません`;
    return Gm.quotePlant(g, lc, { type: B.type, kw: Gm.PLANTS[B.type].sizes[0][0], site: id }).why || 'ここには建てられません';
  }
  if (B.kind === 'line') {
    if (!B.from) return `${n.name}から引ける相手がありません`;
    return Gm.quoteLine(g, lc, { a: B.from, b: id, kind: B.lk }).why || 'ここには引けません';
  }
  if (B.kind === 'conv') {
    if (!n.town) return '電鉄用の変換所は町に置きます';
    return Gm.quoteConv(g, lc, { type: B.type, kw: Gm.CONV_SIZES[0], town: id }).why || 'ここには置けません';
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
  const name = B.kind === 'plant' ? Gm.PLANTS[B.type].name : B.kind === 'line' ? Gm.LINES[B.lk].name : B.kind === 'conv' ? Gm.CONVS[B.type].name : '変圧器';
  const what = B.kind === 'plant' ? `${name}を建てる場所を選ぶ` : B.kind === 'sub' ? '変圧器を置く町を選ぶ' : B.kind === 'conv' ? `${name}を置く町を選ぶ（変圧器がある町）` : !B.from ? `${name}：始点を選ぶ` : !B.to ? `${name}：終点を選ぶ（始点 ${Gm.nodeOf(g, B.from).name}）` : `${name}：${Gm.nodeOf(g, B.from).name} 〜 ${Gm.nodeOf(g, B.to).name}`;
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
const hazardText = (hs, short = false) => (hs.length ? hs.map((h) => `${hazIcon(h)}${short ? HAZ_SHORT[h] : Gm.HAZARD[h].name}`).join('・') : 'なし'); // 1.6.5：地図の対策の印と同じ絵を添える
const HAZ_SHORT = { thunder: '雷', coast: '塩害', snow: '雪' };
// 1.10.1 石炭の運び代（燃料費の倍率。日本列島だけ）
const haulText = (g, siteId) => {
  if (!Gm.isJapan(g)) return '';
  const h = Gm.fuelHaul(g, siteId);
  return `燃料費 ×${h.k.toFixed(2)}${h.reason ? `（${h.reason}）` : ''}`;
};
const haulShort = (g, siteId) => (Gm.isJapan(g) ? `×${Gm.fuelHaul(g, siteId).k.toFixed(2)}` : '');
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
    const eff = D.coal ? `熱効率 ${(D.eff[0] * 100).toFixed(0)}〜${(D.eff[1] * 100).toFixed(0)}%（いま ${(Gm.plantEff({ type: B.type, proto: q.proto }, lc, g) * 100).toFixed(1)}%）・起動 ${D.start}時間・最低出力 ${pct(D.min)}` : B.type === 'ror' ? '燃料なし。出力は川の流量しだい（春 1.3・夏 1.0・秋 0.9・冬 0.6）' : B.type === 'dam' ? '燃料なし。大きなダムに 20 日分の水をためて使う（池＝出力の 480 時間分）' : '燃料なし。1日分の水をためて、時間をずらして使う（池＝出力の6時間分）';
    const haul = D.coal ? (Gm.FUELS[D.fuel || 'coal']?.haul ? haulText(g, B.site) : '重油：タンカーで直接（海沿い・運び代 ×1.0）') : '';
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.site).name)}</b>：${D.name}</p>
      <div class="gseg gsizes">${sizes.map((z) => `<button class="btn small ${z[0] === B.size ? 'on' : ''}" data-bsize="${z[0]}">${kw(z[0])}</button>`).join('')}</div>
      <p class="small">${eff} ・ ${D.bs ? 'ブラックスタートできる' : 'ブラックスタートできない'}</p>
      ${haul ? `<p class="small">${A.esc(haul)}</p>` : ''}
      ${q.hz === true ? '<p class="small">この網には、まだ交流の発電機がありません。先に周波数を決めます（この網の周波数になります）。</p><button class="btn primary gwide" data-hz>周波数を選ぶ</button>' : `${q.freq ? `<p class="small">周波数 <b>${q.freq} Hz</b>（${q.newHz ? 'この網で初めて決める。あとから変えられない' : 'つながっている網の周波数'}）${q.newHz ? ' <button class="btn small" data-hz>選び直す</button>' : ''}</p>` : ''}${quoteHtml(q)}`}`;
    what = `${D.short} ${kw(B.size)}`;
    doBuild = () => Gm.buildPlant(g, lc, { type: B.type, kw: B.size, site: B.site, hz: B.hz });
  } else if (B.kind === 'line') {
    const K = Gm.LINES[B.lk];
    if (B.lk === 'ac500' && B.run275 == null) B.run275 = !lc.blueprint?.line500 && !!lc.blueprint?.line275;
    const run275 = B.lk === 'ac500' && !!B.run275;
    q = Gm.quoteLine(g, lc, { a: B.from, b: B.to, kind: B.lk, route: B.route, opts: B.opts, run275 });
    const r = { direct: Gm.routeInfo(g, B.from, B.to, 'direct'), detour: Gm.routeInfo(g, B.from, B.to, 'detour') };
    if (q.seaKm != null) for (const k of ['direct', 'detour']) if (!r[k].hazards.includes('coast')) r[k].hazards = [...r[k].hazards, 'coast']; // 1.10.0 海峡を渡る線は、回り道でも塩害
    const capNow = run275 ? Gm.LINES.ac275.cap : K.cap;
    const lossFull = Gm.lineLoss(B.lk, r[B.route].km, 1, capNow, 0, run275 ? 275 : null) / capNow; // 送れる量いっぱいを流したときの損失の目安
    const opts = K.dc ? '' : Object.entries(Gm.LINE_OPTS).filter(([, O]) => !O.era || Gm.eraStatus(lc, O.era) === 'ok').map(([k, O]) => `<label class="row"><input type="checkbox" data-bopt="${k}" ${B.opts[k] ? 'checked' : ''}><span>${optIcon(k)}${O.name}<small>${O.hazard ? `${Gm.HAZARD[O.hazard].name}の事故を減らす` : '地絡の事故で止まる時間が短くなる'}（費用 +20%）</small></span></label>`).join('');
    const mode500 = B.lk === 'ac500' ? `<div class="gseg">${[[false, '500 kV で使う'], [true, '500 kV 設計・275 kV で使う']].map(([v, lb]) => `<button class="btn small ${run275 === v ? 'on' : ''}" data-brun275="${v ? '1' : '0'}">${lb}</button>`).join('')}</div>` : '';
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.from).name)} 〜 ${A.esc(Gm.nodeOf(g, B.to).name)}</b>：${run275 ? '交流 500 kV（275 kV で使用中）' : K.name}</p>
      ${mode500}
      <div class="gseg groute">${['direct', 'detour'].map((k) => `<button class="btn small ${B.route === k ? 'on' : ''}" data-broute="${k}">${k === 'direct' ? 'まっすぐ' : '回り道'}<small>${r[k].km.toFixed(1)} km ・ 危険：${hazardText(r[k].hazards)}</small></button>`).join('')}</div>
      <p class="small">1回線で送れる量 ${kw(capNow)} ・ いっぱいに流すと損失 ${(lossFull * 100).toFixed(1)}%${lossFull > 0.1 ? '（<b class="gneg">大きい</b>）' : ''}${run275 ? '（太い電線なのでふつうの 275 kV より損失が小さい。あとから 500 kV に上げられる）' : ''}</p>
      ${opts ? `<details class="gopts"><summary>対策（${Object.values(B.opts).filter(Boolean).length}）${r[B.route].hazards.length ? `<span class="ghaz">この区間：${hazardText(r[B.route].hazards, true)}</span>` : ''}</summary>${opts}</details>` : ''}
      ${q.ok && q.hzDiff ? `<p class="gwarnhz">${A.esc(q.warn)}</p>` : ''}
      ${q.ok && q.seaKm != null ? `<p class="small gstrait">海峡を渡る線：海の上 <b>${q.seaKm.toFixed(1)} km</b>（高い鉄塔で渡る。海の上は 1 km あたり陸の ${Gm.STRAIT_K} 倍の費用）・海沿いの危険（塩害）が付く。周波数が違えば、つないだ瞬間に脱調して切れる</p>` : ''}
      ${q.ok && q.needSub.length ? `<p class="warn small">建設はできますが、${q.needSub.map((x) => Gm.nodeOf(g, x).name).join('・')}に変電所（建設 → 変圧器）を建てるまで電気は流れません。</p>` : ''}
      ${quoteHtml(q)}`;
    what = `${run275 ? '交流 500 kV（275 kV で使用）' : K.short}（${(q.km || 0).toFixed(1)} km）`;
    doBuild = () => Gm.buildLine(g, lc, { a: B.from, b: B.to, kind: B.lk, route: B.route, opts: { ...B.opts }, run275 });
  } else if (B.kind === 'conv') {
    const D = Gm.CONVS[B.type];
    q = Gm.quoteConv(g, lc, { type: B.type, kw: B.kw, town: B.town });
    const effNow = (Gm.convEff({ type: B.type, proto: q.proto }, lc, g) * 100).toFixed(1);
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.town).name)}</b>：${D.name}</p>
      <div class="gseg gsizes">${Gm.CONV_SIZES.map((v) => `<button class="btn small ${v === B.kw ? 'on' : ''}" data-bckw="${v}">${kw(v)}</button>`).join('')}</div>
      <p class="small">交流を電鉄用の直流 600 V に変える。効率 ${(D.eff[0] * 100).toFixed(0)}〜${(D.eff[1] * 100).toFixed(0)}%（いま ${effNow}%）。電鉄の需要は変換所の容量までしか届かず、変換の損失が交流側に足される。${B.type === 'mercury' ? '回転部分がなく保守が楽。' : '回る機械なので故障がある。'}</p>
      ${quoteHtml(q)}`;
    what = `${D.short} ${kw(B.kw)}`;
    doBuild = () => Gm.buildConv(g, lc, { type: B.type, kw: B.kw, town: B.town });
  } else {
    const subSizes = Gm.SUB_SIZES.filter((m) => Gm.eraStatus(lc, Gm.subSizeEra(m)) !== 'no');
    if (!subSizes.includes(B.mva)) B.mva = subSizes[0];
    q = Gm.quoteSub(g, lc, { town: B.town, mva: B.mva });
    h = `<p class="gbch"><b>${A.esc(Gm.nodeOf(g, B.town).name)}</b>：変圧器</p>
      <div class="gseg gsizes">${subSizes.map((m) => `<button class="btn small ${m === B.mva ? 'on' : ''}" data-bmva="${m}">${m} MVA</button>`).join('')}</div>
      <p class="small">鉄損は容量の 0.5%（いつも）、銅損は全負荷で 1.5%（負荷率の2乗）。効率がいちばん高いのは負荷率 58% のあたり。120% を超えると故障しやすい。</p>
      ${quoteHtml(q)}`;
    what = `変圧器 ${B.mva} MVA`;
    doBuild = () => Gm.buildSub(g, lc, { town: B.town, mva: B.mva });
  }
  el.innerHTML = `${h}${q.ok ? '<button class="btn primary gwide" data-bgo>建設する</button>' : ''}`;
  const on = (s, ev, fn) => el.querySelectorAll(s).forEach((x) => x.addEventListener(ev, fn));
  on('[data-bsize]', 'click', (e) => ((B.size = Number(e.currentTarget.dataset.bsize)), drawBuildCard()));
  on('[data-bmva]', 'click', (e) => ((B.mva = Number(e.currentTarget.dataset.bmva)), drawBuildCard()));
  on('[data-bckw]', 'click', (e) => ((B.kw = Number(e.currentTarget.dataset.bckw)), drawBuildCard()));
  on('[data-broute]', 'click', (e) => ((B.route = e.currentTarget.dataset.broute), refreshBuild()));
  on('[data-brun275]', 'click', (e) => ((B.run275 = e.currentTarget.dataset.brun275 === '1'), drawBuildCard()));
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
  else if (kind === 'line') {
    act('buildLine', r.line);
    mark(r.line.id, 'work');
    // 1.6.0：史実と同じ2地点を結んだら、史実の1行を出す（答え合わせ）
    const fact = Gm.isJapan(G()) && J.lineFact(r.line.a, r.line.b);
    if (fact) band(`史実：${fact.text}（${J.confText(fact.conf)}）`);
    if (fact && !DEV.tut && !DEV.demo) Mn.recordFact(G(), fact); // 1.6.4 再現した史実の年表に残す（チュートリアル・デモでは残さない）
  }
  else if (kind === 'sub') act('buildSub', r.sub), mark(r.sub.town, 'work');
  else if (kind === 'conv') act('buildConv', r.conv), mark(r.conv.town, 'work');
  else if (kind === 'circuit') act('circuit', r), mark(r.line.id, 'work');
  else if (kind === 'cap') act('cap', r.load);
  else if (kind === 'opt') act('lineOpt', r), mark(r.line.id, 'work');
  else if (kind === 'up500') act('up500', r), mark(r.line.id, 'work');
  else if (kind === 'hzConv') act('hzConv', r), mark(r.node, 'work'); // 1.10.0
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
  const conv = p.convUntil > t ? `・周波数の工事中（出力 8 割まで・あと${Mn.hoursText(p.convUntil - t)}）` : ''; // 1.10.0
  const st = p.downUntil > t && p.downWhy ? `${p.downWhy}で停止（あと ${Math.max(1, p.downUntil - t)}時間）` : stateOf(p, t);
  return (st || (p.idle ? '休止' : p.hold > t ? '停電からの復旧待ち' : p.on ? `運転中 ${kw(out)}／${kw(p.kw)}` : p.onAt != null ? `起動中（あと ${Math.max(1, p.onAt - t)}時間）` : '待機')) + conv;
}
// 1.7.4 発電所が全開でない理由・待機や起動の理由（直近の1時間の判断。grid.js plantWhyText）
function plantWhy(g, p) {
  const w = g.last?.pw?.[p.id];
  if (!w || p.readyAt > g.t || p.downUntil > g.t) return '';
  return Gm.plantWhyText(g, p, w);
}
// 1.7.4 町に、どこから届いているか（直流・交流・届いていない）
// ---- 1.8.1 町の次の24時間の需給（申し込みのカード・町の詳細）----
// 計算（Gm.townOutlook）はカードが見えたときに。ゲームの時刻と設備が変わるまで覚えておく（fcCache）。
// 2 時間おき（12 回）：1 時間おきは CPU 4 倍遅くで 1 枚 98〜134 ms（関東の系統。ツール/測る_需給の見込み.mjs）、2 時間おきは 35〜39 ms
const fcCache = new Map();
const FC_STEP = 2;
const fcKey = (g, lc, town, ids) =>
  `${Gm.modeOf(g)}|${g.islandNo}|${g.t}|${g.nextId}|${g.plants.length},${g.lines.length},${g.subs.length},${(g.convs || []).length},${g.loads.length}|${g.plants.map((p) => (p.idle ? 1 : 0)).join('')}|${g.reserve}|${lc.dmax}|${g.era}|${town}|${ids.join(',')}`;
function outlookOf(g, lc, town, ids) {
  const k = fcKey(g, lc, town, ids);
  let o = fcCache.get(k);
  if (!o) {
    o = Gm.townOutlook(g, lc, town, ids, FC_STEP);
    if (fcCache.size > 60) fcCache.clear();
    fcCache.set(k, o);
  }
  return o;
}
// 棒グラフ（SVG）：棒＝その時刻の需要（受けている分＋申し込みの分。申し込みの分は斜線）。届く分は緑、余裕が小さい（使用率 90% 超・予備力の目標より小さい）は黄、
// 届かない分は赤（上に「足りない」の文字）。いちばん左がいま（下に印）
function outlookSvg(o) {
  const hs = o.hours, n = hs.length;
  const W = 240, H = 64, top = 11, bot = 13, ch = H - top - bot;
  const max = Math.max(1e-6, ...hs.map((x) => x.base + x.add));
  const bw = W / n;
  const f = (v) => v.toFixed(1);
  const yv = (v) => top + ch - (v / max) * ch;
  let s = `<defs><pattern id="gfch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.7" height="4" fill="var(--card)" opacity=".8"/></pattern></defs>`;
  s += `<line x1="0" y1="${top + ch + 0.5}" x2="${W}" y2="${top + ch + 0.5}" stroke="var(--line)"/>`;
  hs.forEach((x, i) => {
    const x0 = i * bw + bw * 0.12, w = bw * 0.76;
    const tot = x.base + x.add, got = tot - x.short;
    if (got > 1e-9) s += `<rect x="${f(x0)}" y="${f(yv(got))}" width="${f(w)}" height="${f(Math.max(0.6, (got / max) * ch))}" class="gfb ${x.st === 'warn' ? 'warn' : 'ok'}"/>`;
    if (x.short > 0) s += `<rect x="${f(x0)}" y="${f(yv(tot))}" width="${f(w)}" height="${f(Math.max(0.6, (x.short / max) * ch))}" class="gfb ng"/>`;
    if (x.add > 0) s += `<rect x="${f(x0)}" y="${f(yv(tot))}" width="${f(w)}" height="${f(Math.max(0.6, (x.add / max) * ch))}" fill="url(#gfch)"/>`;
    if (x.st === 'ng' && (i === 0 || hs[i - 1].st !== 'ng')) s += `<text x="${f(Math.min(W - 16, Math.max(16, x0 + w / 2)))}" y="${f(Math.max(8, yv(tot) - 2.5))}" class="gfng">足りない</text>`;
    if (x.h % 6 === 0 || i === 0) s += `<text x="${f(Math.max(8, x0 + w / 2))}" y="${H - 2}" class="gfh${i === 0 ? ' now' : ''}">${i === 0 ? 'いま' : `${x.h}時`}</text>`;
  });
  return s;
}
// app：申し込みのカード（「受けても足りる」）か、町の詳細か
function outlookBody(g, o, app) {
  const sum = Gm.outlookText(g, o, app);
  const has = o.hours.some((x) => x.add > 0);
  const label = `次の24時間の需給：${sum.text}`;
  return `<svg class="gfchart" viewBox="0 0 240 64" role="img" aria-label="${A.esc(label)}">${outlookSvg(o)}</svg>
    <p class="small gfkey"><span><i class="ok"></i>届く</span><span><i class="warn"></i>余裕が小さい</span><span><i class="ng"></i>足りない</span>${has ? `<span><i class="hatch"></i>${app ? 'この申し込み' : '保留中の申し込み（受けた場合）'}</span>` : ''}</p>
    <p class="small gfsum${sum.ng ? ' bad' : sum.warn ? ' warn' : ''}">${A.esc(sum.text)}</p>`;
}
// 計算済みならすぐ描き、まだなら「計算中」を置いて、見えたときに計算する（bindOutlook）
function outlookHtml(g, lc, town, ids, app) {
  const o = fcCache.get(fcKey(g, lc, town, ids));
  return `<div class="gfc" data-fc="${town}|${ids.join(',')}"${app ? ' data-fcapp="1"' : ''}>${o ? outlookBody(g, o, app) : '<p class="small note">次の24時間の需給を計算中…</p>'}</div>`;
}
function bindOutlook(root) {
  const els = [...root.querySelectorAll('[data-fc]')].filter((el) => el.querySelector('.note'));
  if (!els.length) return;
  const run = (el) => {
    if (!el.isConnected || !el.querySelector('.note')) return;
    const [town, ids] = el.dataset.fc.split('|');
    const g = G(), lc = learningNow();
    const o = outlookOf(g, lc, town, ids ? ids.split(',') : []);
    el.innerHTML = outlookBody(g, o, !!el.dataset.fcapp);
  };
  if (typeof IntersectionObserver === 'undefined') return els.forEach((el) => setTimeout(() => run(el), 0));
  // 見えたものから順に（1枚ずつ、間に描画をはさむ）
  const obs = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        setTimeout(() => run(e.target), 0);
      }
    },
    { root, rootMargin: '80px' },
  );
  els.forEach((el) => obs.observe(el));
}
// 1.8.1 町への供給の内訳：町の発電所の出力と、線で送られてくる量（ほかの町へ送っているときは、その分）。損失は省いたおおよそ
function townSupplyText(g, id, st) {
  const got = st.d * st.r;
  const own = g.plants.filter((p) => p.site === id).reduce((a, p) => a + (g.last?.plants[p.id] || 0), 0);
  if (!(got > 0.05) && !(own > 0.05)) return '';
  if (own >= got) return `この町への供給：町の発電所 ${kw(own)}${own - got > 0.05 ? `（うち ${kw(own - got)} をほかの町へ）` : ''}`;
  return `この町への供給：${own > 0.05 ? `町の発電所 ${kw(own)} ＋ ` : ''}線で送られてくる ${kw(got - own)}`;
}
function townSrcText(st) {
  const miss = st.d * (1 - st.r);
  const parts = [st.dc > 0.05 ? `直流から ${kw(st.dc)}` : '', st.ac > 0.05 ? `交流から ${kw(st.ac)}` : '', miss > 0.05 ? `<b class="gneg">届いていない ${kw(miss)}</b>` : ''].filter(Boolean);
  return parts.join(' ・ ');
}

// ---- 地点のパネル（建設モードでないとき）：状態・需要・変電所・発電所、ここから建てる ----
function nodePanel(g, lc, id) {
  const t = g.t;
  const n = Gm.nodeOf(g, id);
  const plants = g.plants.filter((p) => p.site === id);
  const subs = g.subs.filter((x) => x.town === id);
  const convs = (g.convs || []).filter((x) => x.town === id);
  const loads = g.loads.filter((l) => l.town === id);
  const st = g.last?.towns[id];
  const why = g.last?.why?.[id];
  const incs = g.incidents.filter((i) => i.town === id || plants.some((p) => p.id === i.plant) || subs.some((x) => x.id === i.sub));
  const start = Gm.startId(g);
  const dist = start === id ? (Gm.isJapan(g) ? '始めた町' : '中央の町') : `${A.esc(Gm.nodeOf(g, start).name)}から ${Gm.distKm(g, start, id) < 0.5 ? '0' : Gm.distKm(g, start, id).toFixed(1)} km`;
  const where = Gm.isJapan(g) ? `${A.esc(n.pref)}${n.place ? ` ${A.esc(n.place)}` : ''}${n.river ? `・${A.esc(n.river)}` : ''} ・ ` : '';
  let h = `<p class="small">${where}${n.town ? '町' : n.hydro ? `水力の地点（使える水 ${kw(n.hydro)}${n.dam ? '・ダムを作れる' : n.pond ? '・調整池を作れる' : ''}）` : n.coal && Gm.isJapan(g) ? '炭田' : '石炭火力の用地'} ・ ${dist} ・ この場所の危険：${hazardText(n.tags)}</p>`;
  if (n.coal && Gm.isJapan(g)) h += `<p class="small">炭田：石炭火力の燃料が安い（運び代がほとんどかからない・燃料費 ×${Gm.FUEL_HAUL.coal.toFixed(2)}）</p>`;
  if (!Gm.nodeOpen(g, n)) h += `<p class="warn small">まだ開いていない地点です（${eraName(Gm.openEra(g, n))}から）。</p>`;
  if (Gm.isJapan(g)) h += historyHtml(n);
  if (incs.length) h += `<p class="warn small">事故の対処待ちがあります <button class="btn small" data-golist>一覧へ</button></p>`;
  if (n.town) {
    const rep = g.rep[id] ?? 1;
    const total = loads.reduce((x, l) => x + l.kw, 0);
    const pend = g.apps.filter((a) => a.town === id);
    const held = pend.filter((a) => a.held).map((a) => a.id);
    for (const l of loads) if (PIC[`load_${l.type}`]) seen(PIC[`load_${l.type}`]);
    h += `<p><button class="btn primary gwide" data-opentown="${id}">町を見る（電気の使われ方）</button></p>
      <h3>需要</h3><p class="small"><b>需要の合計 ${kw(total)}</b>（受けている分）${st ? ` ・ いま ${kw(st.d)}` : ''}</p>${st && st.d > 1e-6 ? `<p class="small">${townSupplyText(g, id, st)}</p>` : ''}
      ${loads.length || held.length ? outlookHtml(g, lc, id, held, false) : ''}${pend.length ? `<p><button class="btn small" data-goapp="${pend[0].id}">この町の申し込み（${pend.length}件）を見る</button></p>` : ''}
      ${loads.length ? loads.map((l) => `<p class="spread grow gloadrow"><span>${pic(`load_${l.type}`, 'mini gloadpic')}<span>${Gm.LOADS[l.type].name} ${kw(l.kw)}${Gm.LOADS[l.type].pfFixed ? `（力率 ${l.cap ? Gm.LOADS[l.type].pfFixed : Gm.LOADS[l.type].pf}）` : l.type === 'tram' ? '（直流 600 V・変換所が要る）' : ''}</span></span>${Gm.LOADS[l.type].pfFixed && !l.cap ? `<button class="btn small" data-cap="${l.id}">進相コンデンサ</button>` : ''}</p>`).join('') : '<p class="small">まだありません</p>'}
      ${st ? `<p class="small">届いている割合 ${pct(st.r)} ・ 町の信用 ${pct(rep)}${rep < 1 ? '（停電があると下がり、1か月で戻る）' : ''}</p>` : ''}
      ${st && st.d > 1e-6 && st.dc != null ? `<p class="small">${townSrcText(st)}</p>` : ''}
      ${why ? `<p class="small gwhy1${why.k === 'dim' ? '' : ' bad'}">${why.k === 'dim' ? '' : '届いていない原因：'}${A.esc(Gm.whyText(g, why))}</p>` : ''}
      ${spendTownHtml(g, id)}
      <h3>変電所</h3>${subs.length ? subs.map((x) => `<p class="spread grow"><span>変圧器 ${x.mva} MVA ・ ${stateOf(x, t) || `使用率 ${pct(g.last?.subs[id] || 0)}`}</span><button class="btn small" data-rm="sub:${x.id}">撤去</button></p>`).join('') : '<p class="small">なし（11 kV 以上の送電線をつなぐには変電所が要る）</p>'}
      <h3>電鉄用の変換所</h3>${convs.length ? convs.map((x) => `<p class="spread grow"><span>${Gm.CONVS[x.type].short} ${kw(x.kw)}${x.proto ? '（試作）' : ''} ・ ${stateOf(x, t) || `使用率 ${pct(g.last?.convs?.[id] || 0)}`}</span><button class="btn small" data-rm="conv:${x.id}">撤去</button></p>`).join('') : loads.some((l) => l.type === 'tram') ? '<p class="small warn">なし（電鉄を動かすには交流の変圧器と電鉄用の変換所が要る）</p>' : '<p class="small">なし（電鉄の直流 600 V に変換する設備）</p>'}`;
  }
  h += hzConvHtml(g, lc, id);
  const ecNode = Gm.econSummary(g, '7d');
  h += `<h3>発電所</h3>${plants.length ? plants.map((p) => {
    const D = Gm.PLANTS[p.type];
    const ps = ecNode.plants?.[p.id];
    const fuelLine = D.coal ? `<p class="small">${plantFuelText(g, lc, p)}</p>${unitButtons(perfUnitsOf(lc, D.perf))}` : '';
    const wasteLine = ps && ps.waste > 0.5 ? `<p class="small gneg">最低出力で捨てた分 ${kwh(ps.waste)}/日</p>` : '';
    return `<div class="gnodeplant"><p class="spread grow"><span>${D.short} ${kw(p.kw)}${p.proto ? '（試作）' : ''} ・ ${plantState(g, p)}${plantWhy(g, p) ? `<small class="gpw">${A.esc(plantWhy(g, p))}</small>` : ''}</span><button class="btn small" data-rm="plant:${p.id}">撤去</button></p>${fuelLine}${wasteLine}</div>`;
  }).join('') : '<p class="small">なし</p>'}
`;
  return {
    title: `${A.esc(n.name)}${!Gm.townActive(g, n) || !Gm.nodeOpen(g, n) ? ` <span class="tag">${eraName(Gm.isJapan(g) ? Gm.openEra(g, n) : n.era)}から</span>` : ''}`,
    html: h,
    bind: ({ onAll }) => {
      onAll('[data-opentown]', 'click', (e) => {
        const tid = e.currentTarget.dataset.opentown;
        setPanel(null);
        openTownView(tid);
      });
      onAll('[data-sources]', 'click', sourcesSheet);
      onAll('[data-golist]', 'click', () => setPanel('list'));
      onAll('[data-goapp]', 'click', (e) => goApp(e.currentTarget.dataset.goapp));
      bindSpend(onAll);
      onAll('[data-cap]', 'click', (e) => capDialog(e.currentTarget.dataset.cap));
      onAll('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':')));
      onAll('[data-hzconv]', 'click', () => hzConvDialog(id));
    },
  };
}
// ---- 1.10.0 周波数をそろえる工事：地点の詳細（その地点の交流の網に、周波数の決まった交流の発電機があるとき） ----
function hzConvHtml(g, lc, id) {
  const T = Gm.hzConvTarget(g, id);
  if (!T.from || !T.plants.length) return '';
  const w = T.plants.map((p) => Gm.hzWorkOf(g, p.id)).find(Boolean);
  const head = `<h3>周波数</h3><p class="small">この地点の交流の網：<b>${T.from} Hz</b>（交流の発電機 ${T.plants.length}台${T.nodes.size > 1 ? `・地点 ${T.nodes.size}` : ''}）</p>`;
  if (w) return `${head}<p class="small gconv">周波数をそろえる工事中：${w.from} Hz → ${w.to} Hz（あと${Mn.hoursText(w.until - g.t)}）。工事の間、発電機の出力は 8 割まで</p>`;
  const q = Gm.quoteHzConv(g, lc, id);
  if (q.era) return head;
  return `${head}<button class="btn gwide" data-hzconv>周波数をそろえる工事（${T.from} Hz → ${T.to} Hz）<small>${q.ok ? `${A.num(q.cost)} コイン ・ ${q.days}日${q.proto ? ' ・ 試作' : ''}` : A.esc(q.why)}</small></button>`;
}
function hzConvDialog(id) {
  const g = G(), lc = learningNow();
  const q = Gm.quoteHzConv(g, lc, id);
  const T = Gm.hzConvTarget(g, id);
  const to = q.to || T.to;
  sheet(
    `<h2>周波数をそろえる工事</h2>
    <p>${A.esc(Gm.nodeOf(g, id).name)}の交流の網（線でつながった範囲）の発電機を、<b>${T.from} Hz → ${to} Hz</b> に改造する。発電機の回転の速さ（極数）を変え、変圧器や需要家の機器も取り替える。</p>
    ${q.ok ? `<p class="small">変える発電機 ${q.plants.length}台 ・ 網の変電所 ${q.subs}か所</p>
    <p class="gquote"><b>${A.num(q.cost)} コイン</b>（残高 ${coinText(balance())}）・ 工期 ゲームの ${q.days}日（20日 ＋ 発電機 1台につき 5日）${q.proto ? '<br><span class="warn">試作：次の時代の工事を先取り。費用3倍</span>' : ''}</p>
    <p class="small">費用＝網の交流の発電機の建設費の合計 × 0.3 ＋ 網の変電所の建設費の合計 × 0.1。工事の間、その発電機の<b>出力の上限は 8 割</b>（順に止めて改造するため）。変えるのは今この網にある発電機だけ（工事中に建てた発電所は元の周波数のまま）。</p>
    <p class="gwarnhz">周波数の違う網と交流の線でつなぐと脱調する。工事が終われば、${to} Hz の網とつなげる（切れていた線は「入れ直す」）。</p>
    <p class="small">史実：九州では 50 Hz と 60 Hz が混ざっていたため、60 Hz にそろえる工事を第1期（1949〜1951）・第2期（1954〜1960）に行った（S17）。</p>
    <button class="btn primary gwide" data-build>工事を始める</button>` : whyHtml(q)}`,
    ({ onAll }) => {
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      onAll('[data-build]', 'click', () => pay(q, `周波数をそろえる工事（${q.from} Hz → ${q.to} Hz）`, () => Gm.startHzConv(g, lc, id), null, 'hzConv'));
    },
  );
}

// ---- 1.6.0 史実の表示：地点の史実の年と1行・出典・確かめたかどうか・位置はおおよそ。ゲームの値は「ゲーム」と分ける ----
const confOf = (c) => (/^確認済み/.test(c || '') ? '確かめた' : c === 'ゲームの地点' ? '' : '未確認');
function historyHtml(n) {
  const rows = [];
  if (n.game) rows.push('<p class="small">ゲームの地点（実在の川の名前を使った、史実ではない地点）</p>');
  else if (n.fact) rows.push(`<p class="small">${n.year && !n.fact.startsWith(String(n.year)) ? `${n.year}年 ` : ''}${A.esc(n.fact)}</p>`);
  else if (n.year) rows.push(`<p class="small">${n.hydro ? `運転開始 ${n.year}年` : `${n.year}年`}</p>`);
  if (n.hydro) rows.push(`<p class="small">使える水の上限 ${kw(n.hydro)}：${n.limitBy === 'ゲーム' ? 'ゲームの値' : '今の最大出力（運転開始のころの値ではない。その川の力の目安）'}</p>`);
  const conf = confOf(n.conf);
  rows.push(`<p class="small gsrc">${n.src ? `出典 ${A.esc(n.src)}${conf ? `（${conf}）` : ''} ・ ` : ''}位置はおおよそ <button class="link" data-sources>出典の一覧</button></p>`);
  return `<h3>${n.campus || n.id === 'tk-kanda' ? '史実（大学）' : '史実'}</h3>${rows.join('')}`;
}
function sourcesSheet() {
  sheet(
    `<h2>出典の一覧</h2>
    <p class="small">史実の値は、出典で確かめたものだけを「確かめた」としています。Gemini の調査（G1・G2）だけのものは「未確認」です。ゲームのために決めた値（発電所の大きさ・費用・需要など）は史実ではありません。</p>
    <ul class="gsources">${J.SOURCES.map(([k, name, url]) => `<li><b>${k}</b> ${A.esc(name)}${url ? `<br><small>${A.esc(url)}</small>` : ''}</li>`).join('')}</ul>
    <p class="small">地図：海岸線・川・湖は「地球地図日本」（国土地理院、第2.2版ベクタ・1:100万）を加工して作成（国土地理院コンテンツ利用規約）。ダム湖は今のものなので描いていません。県境は Natural Earth（1:10m。パブリックドメイン）で、今のもの（明治の細かな違いは描き分けていません）。主な島だけを描いています。標高の塗り分け：NOAA ETOPO 2022（米国政府のデータ）。地形・景色（田畑・林・市街地）は見た目だけで、建てられる場所や費用には使っていません。市街地の広がりは、その町に届いている需要から決めた絵です。地点の位置はおおよそです。</p>
    <p class="small"><small>出典：国土地理院ウェブサイト（https://www.gsi.go.jp/kankyochiri/gm_jpn.html）</small></p>`,
  );
}

// 周波数の選択（1.6.0：系統ごと）。まだ周波数のない網に、交流の発電機を初めて建てるとき。建てるとその網の周波数になる
function hzDialog(after) {
  sheet(
    `<h2>周波数を選ぶ</h2>
    <p>交流の発電機を、どこから買うか。建てると<b>この網（線でつながった範囲）の周波数</b>になり、あとから変えられません。周波数の違う網と交流の線でつなぐと、脱調して保護装置で切れます（電気は送れません）。</p>
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
  const x = { plant: g.plants, line: g.lines, sub: g.subs, conv: g.convs || [] }[kind].find((v) => v.id === id);
  if (!x) return;
  const name = kind === 'plant' ? `${Gm.PLANTS[x.type].short} ${kw(x.kw)}` : kind === 'line' ? Gm.lineName(g, x) : kind === 'conv' ? `${Gm.CONVS[x.type].short} ${kw(x.kw)}` : `変圧器 ${x.mva} MVA`;
  sheet(
    `<h2>撤去する</h2>
    <p>${A.esc(name)} を手放しますか。建設費の 30%（${yen(Gm.removeBack(x))}）が<b>収益</b>に戻ります（コインは戻りません）。</p>
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
  const optNames = Object.keys(l.opts).filter((k) => l.opts[k]).map((k) => `${optIcon(k)}${Gm.LINE_OPTS[k].name}${l.optAt?.[k] > t ? `（工事中 あと${Mn.hoursText(l.optAt[k] - t)}）` : ''}`);
  const optOnKeys = Object.keys(Gm.LINE_OPTS).filter((o) => Gm.optOn(l, o, t)); // 1.6.5 地図の印の説明
  const canOpt = Gm.optChoices(g, lc, id).length > 0;
  const fact = Gm.isJapan(g) ? J.lineFact(l.a, l.b) : null;
  const dir = f?.p > 0 && f.to ? ` ・ 向き：${A.esc(Gm.nodeOf(g, f.to === l.a ? l.b : l.a).name)} → ${A.esc(Gm.nodeOf(g, f.to).name)}` : '';
  const cAdd = l.cAdd?.length ? `（+${l.cAdd.length}回線 増設工事中 あと${Mn.hoursText(Math.max(1, Math.min(...l.cAdd.map((c) => c.readyAt)) - t))}）` : '';
  const up500Work = l.up500At > t ? `（500 kV に上げる工事中 あと${Mn.hoursText(l.up500At - t)}・工事中は 275 kV のまま動く）` : '';
  const canUp500 = l.kind === 'ac500' && l.runKv === 275 && !(l.up500At > t);
  const qu = canUp500 ? Gm.quoteUpgradeLine(g, lc, id) : null;
  return {
    title: A.esc(Gm.lineName(g, l)),
    html: `<p class="small glinehead">${linePic(l.kind)}<span>${Gm.lineShort(l)} ・ ${l.km.toFixed(1)} km（${l.route === 'detour' ? '回り道' : 'まっすぐ'}）・ ${l.n}回線${cAdd}${up500Work}${l.proto ? ' ・ 試作' : ''}</span></p>
    ${l.seaKm != null ? `<p class="small gstrait">海峡を渡る線（海の上 ${l.seaKm.toFixed(1)} km。高い鉄塔）</p>` : ''}
    ${fact ? `<p class="small gfact">史実：${A.esc(fact.text)}（出典 ${A.esc(fact.src)}・${J.confText(fact.conf)}） <button class="link" data-sources>出典の一覧</button></p>` : ''}
    ${l.hzTrip ? `<div class="gwarnhz"><b>切れている（周波数違い）</b><br>${l.hzPair ? `${A.esc(l.hzPair[0])}側は ${l.hzPair[1]} Hz、${A.esc(l.hzPair[2])}側は ${l.hzPair[3]} Hz の網。` : ''}周波数が違うと、両側の電圧の位相のずれが回り続け（50 Hz と 60 Hz なら毎秒 10 回転）、ずれが 180° に近づくたびに大きな電流が流れる。同期を保てないので、保護装置が線を切った（電気は送れない）。<br><small>入れ直しても、周波数が違うままなら、すぐにまた切れる。どちらかの網から交流の発電機がなくなるなど、周波数がそろえば入る。</small></div>` : ''}
    <p class="small">状態：${l.hzTrip && !stateOf(l, t) ? '切れている（周波数違い）' : stateOf(l, t) || (l.c1Until > t ? `1回線が修理中（あと ${l.c1Until - t}時間）` : '送電中')}${f && !l.hzTrip ? ` ・ 流れ ${kw(f.p)}（送れる量 ${kw(Gm.lineCap(l) * Math.max(1, Gm.lineCircuits(l, t)))}）・ 使用率 <b class="${f.util > 1 ? 'gneg' : f.util > 0.9 ? 'gcaut' : ''}">${pct(f.util)}</b>${f.util > 0.9 && f.util <= 1 ? '（90% 超で注意）' : ''} ・ 損失 ${kw(f.loss)}${dir}` : ''}</p>
    <p class="small">危険：${hazardText(l.hazards)} ・ 対策：${optNames.length ? optNames.join('・') : 'なし'} ・ 故障の目安 1日あたり ${(hz.perDay * 100).toFixed(2)}%</p>
    ${optOnKeys.length ? `<p class="small">地図の印：${optOnKeys.map(optKey).join(' ／ ')}</p>` : ''}
    <p class="small">送れる量を超えて 120% までは温度が上がるだけ（故障しやすくなる）。120% を2時間超えると保護装置で切れる。</p>
    <div class="gbtns2">
      ${l.hzTrip ? '<button class="btn" data-reclose>入れ直す<small>周波数が違うままなら、また切れる</small></button>' : ''}
      ${canUp500 ? `<button class="btn" data-up500>500 kV に上げる<small>${qu.ok ? `${A.num(qu.cost)} コイン・${qu.hours}時間` : A.esc(qu.why)}</small></button>` : ''}
      <button class="btn" data-circ>回線を増やす<small>${qc.ok ? `${A.num(qc.cost)} コイン・${qc.hours}時間` : A.esc(qc.why)}</small></button>
      ${canOpt ? '<button class="btn" data-addopts>対策を足す<small>後から（費用は割増）</small></button>' : ''}
      <button class="btn" data-rm>撤去</button>
    </div>`,
    bind: ({ onAll }) => {
      onAll('[data-circ]', 'click', () => circuitDialog(id));
      onAll('[data-up500]', 'click', () => up500Dialog(id));
      onAll('[data-reclose]', 'click', async () => {
        const g2 = G();
        const r = Gm.recloseLine(g2, learningNow(), id);
        if (!r.ok) return A.toast(r.why);
        await save();
        await screen();
        act('reclose', { line: g2.lines.find((x) => x.id === id), again: r.again, live: r.live });
        collectAlerts();
      });
      onAll('[data-addopts]', 'click', () => optDialog(id));
      onAll('[data-sources]', 'click', sourcesSheet);
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
      const fk = D.fuel || 'coal';
      const fName = Gm.FUELS[fk]?.name || '石炭';
      const haul = Gm.isJapan(g) && Gm.FUELS[fk]?.haul ? `（運び代 ${haulShort(g, p.site)}）` : '';
      const cost = D.coal ? `${fName} ${(Gm.fuelPrice(g, g.t, p.site, fk) / Gm.plantEff(p, lc, g)).toFixed(1)} 円/kWh${haul}` : '燃料なし';
      return `<div class="gitem gplant"><span class="gord"><button class="btn small" data-up="${p.id}" ${i === 0 || !lc.gate.econ ? 'disabled' : ''} aria-label="上へ">▲</button><b>${i + 1}</b><button class="btn small" data-down="${p.id}" ${i === order.length - 1 || !lc.gate.econ ? 'disabled' : ''} aria-label="下へ">▼</button></span>
        <span class="gpl"><b>${D.short} ${kw(p.kw)}${p.proto ? '（試作）' : ''}</b><small>${A.esc(Gm.nodeOf(g, p.site).name)} ・ ${plantState(g, p)} ・ ${cost}${plantWhy(g, p) ? `<br>${A.esc(plantWhy(g, p))}` : ''}</small>
        <span><button class="btn small" data-idle="${p.id}">${p.idle ? '休止をやめる' : '休止する'}</button><button class="btn small" data-rm="plant:${p.id}">撤去</button></span></span></div>`;
    })
    .join('');
  const ecRun = Gm.econSummary(g, '7d');
  const wasteByNet = new Map();
  for (const p of g.plants) {
    const w = ecRun.plants?.[p.id]?.waste || 0;
    if (w <= 0.5) continue;
    const netName = !Gm.PLANTS[p.type].ac ? '直流の網' : p.hz ? `${p.hz} Hz の網` : '交流の網';
    wasteByNet.set(netName, (wasteByNet.get(netName) || 0) + w);
  }
  const wasteLine = wasteByNet.size ? `<p class="small gneg">最低出力で捨てた分（直近7日の1日あたり）：${[...wasteByNet].map(([nm, v]) => `${nm} ${kwh(v)}/日`).join(' ・ ')}</p>` : '';
  const mNorm = Gm.dailyMaint(g, 'normal');
  const mDef = Gm.dailyMaint(g, 'defer');
  return {
    title: '運転',
    html: `<h3>給電の優先順位</h3>
      <p class="small">番号の小さい順に使います。${lc.gate.econ ? '▲▼で並べ替え（燃料の安い順にすると得）' : '並べ替えは、電力系統工学「等増分燃料費」を1問正解すると使えます'}。直流の火力は、つないだ町の需要だけを先にまかないます。</p>
      ${!lc.gate.econ ? unitButtons((lc.tables || Gm.gridTables(null)).gate.econ) : ''}
      ${wasteLine}
      ${plants || '<p class="note">発電所がありません</p>'}
      ${restrictHtml(g)}
      <h3>予備力の目標</h3>
      <label class="row"><input type="range" min="0" max="30" step="1" value="${Math.round(g.reserve * 100)}" data-reserve><b data-rv>${pct(g.reserve)}</b></label>
      <p class="small">需要のこの割合だけ、発電機の出力に余裕を残す（多いほど安全だが、燃料費は上がる）。いまの目標 ${kw(o.reserveKw)}${lc.gate.rel ? ` ・ 最大の発電機1台分 ${kw(o.biggest)}` : ''}</p>
      <h3>点検の方針</h3>
      <label class="row"><input type="radio" name="maint" value="normal" ${g.maint !== 'defer' ? 'checked' : ''}><span>ふつうに点検する<small>ふつう：保守費 ${yen(mNorm)}/日（設備の値打ちの ${(Gm.MAINT_RATE * 100).toFixed(2)}%/日）</small></span></label>
      <label class="row"><input type="radio" name="maint" value="defer" ${g.maint === 'defer' ? 'checked' : ''}><span>点検を延ばす<small>延ばす：保守費 ${yen(mDef)}/日・故障 2.5 倍</small></span></label>
      <h3>燃料の買い方</h3>
      <label class="row"><input type="radio" name="fuel" value="contract" ${g.fuelPlan === 'contract' ? 'checked' : ''}><span>長期契約<small>値段は固定（いま ${Object.entries(Gm.FUELS).map(([k, F]) => `${F.name} ${Gm.fuelObj(g, k).contract.toFixed(2)}`).join('・')} 円/kWh・熱）。1年ごとに見直し</small></span></label>
      <label class="row"><input type="radio" name="fuel" value="spot" ${g.fuelPlan === 'spot' ? 'checked' : ''}><span>スポット<small>毎日 ±30% で変わる（今日 ${Object.entries(Gm.FUELS).map(([k, F]) => `${F.name} ${Gm.fuelObj(g, k).spot.toFixed(2)}`).join('・')}）。平均は長期契約の 0.85 倍</small></span></label>
      <p class="small">燃料費（円/kWh）＝値段 ÷ 熱効率。熱効率は、火力発電の単元の定着で上がる</p>
      <p class="small">石炭の運び代（日本列島）：炭田のそば ×0.70、海沿い ×0.95 まで、内陸は遠いほど高い（最大 ×1.4）。重油はタンカーで直接（×1.0）</p>
      ${unitButtons(['power-system-U05', 'power-system-U06'])}`,
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
      onAll('input[name=restrict]', 'change', async (e) => {
        const r = Gm.setRestrict(gg, e.target.value || null);
        if (!r.ok) return A.toast(r.why);
        await save();
        drawPanel(true);
        const ch = document.querySelector('[data-chips]');
        if (ch) (ch.innerHTML = chipsHtml(gg)), bindChips();
        act('restrict', { value: gg.restrict });
      });
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
    },
  };
}
// ---- 1.10.0 使用制限（戦後復興から）：なし／A 使用時間の指定／B 大口の使用量の制限／C 最大電力の指定。どれか1つ、いつでも変えられる ----
function restrictHtml(g) {
  if (g.era < Gm.RESTRICT_ERA) return '';
  const r = g.restrict && Gm.RESTRICT[g.restrict] ? g.restrict : '';
  const dr = Gm.evOn(g, 'drought');
  const opt = (v, name, text) => `<label class="row"><input type="radio" name="restrict" value="${v}" ${r === v ? 'checked' : ''}><span>${name}<small>${text}</small></span></label>`;
  return `<h3>使用制限</h3>
    ${dr ? `<p class="small gconv"><b>渇水の最中（あと${Mn.hoursText(dr.until - g.t)}）。${A.esc(Gm.RESTRICT_HINT)}</b></p>${unitButtons(Gm.RESTRICT_UNITS)}` : ''}
    <p class="small">供給が足りないとき、工場・町の動力・電鉄の需要に制限をかける（電灯・住宅は変えない）。電鉄は朝夕の山を外せないため、A の時間指定は効きが小さい。制限で減らした・移した需要は停電に数えない（町の信用・申し込みは下がらない）。それでも足りなければ、今までどおり負荷遮断になる。</p>
    ${opt('', 'なし（今のまま）', '制限をかけない')}
    ${Object.entries(Gm.RESTRICT).map(([k, R]) => opt(k, R.short, R.text)).join('')}
    ${g.yr.cut || g.yr.moved ? `<p class="small">今年、使用制限で減らした量 ${kwh(Math.max(0, g.yr.cut || 0))}${g.yr.moved ? ` ・ 夜へ移した量 ${kwh(g.yr.moved)}` : ''}</p>` : ''}`;
}
const kwh = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} GWh` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)} MWh` : `${Math.round(v)} kWh`);

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
      ${l?.why && Object.keys(l.why).length ? `<button class="btn small" data-nowsheet>届いていない町と原因（${Object.values(l.why).filter((w) => w.k !== 'dim').length}か所）</button>` : ''}
      ${netsHtml(g)}
      <h3>需要と電源（直近 ${hs.length}時間）</h3>
      ${chart}
      ${econSummaryHtml(g, lc)}
      ${devMode() ? devSupplyHtml(g, lc) : ''}
      <h3>いまの系統</h3>
      <p class="spread grow"><span>需要の上限（学習で決まる）</span><b>${kw(o.dmax)}</b></p>
      <p class="small">Lv ${lc.level} ・ 定着 ${lc.mastered}問。お金では増えない。レベルと定着で広がる</p>
      <p class="spread grow"><span>受けている需要（契約）</span><b>${kw(o.accepted)}</b></p>
      <p class="spread grow"><span>これから24時間のピーク（予測）</span><b>${kw(o.peak)}</b></p>
      <p class="spread grow"><span>使える発電機の合計（すべての網）</span><b class="${o.cap < o.peak ? 'gneg' : ''}">${kw(o.cap)}</b></p>
      <p class="spread grow"><span>予備力の目標（${pct(g.reserve)}）</span><b>${kw(o.reserveKw)}</b></p>
      ${lc.gate.rel ? `<p class="small">最大の発電機1台分は ${kw(o.biggest)}。${o.reserveKw >= o.biggest ? '1台止まっても埋められる（N-1）' : '<b class="gneg">1台止まると埋めきれない</b>'}</p>` : `<p class="small">電力系統工学「信頼度指標」を1問正解すると、予備力の目安（最大の発電機1台分との比較）が出ます</p>`}
      ${Gm.freqNow(g) && K ? `<p class="spread grow"><span>系統定数 K</span><b>${kw(K)}/Hz</b></p><p class="small">Δf＝−ΔP/K。いまいちばん出力の大きい発電機（${kw(topOut)}）が止まると、余裕が足りていれば ${(topOut / K).toFixed(2)} Hz 下がる</p>` : ''}`,
    bind: ({ onAll }) => {
      onAll('[data-nowsheet]', 'click', nowSheet);
      onAll('[data-econtab]', 'click', (e) => {
        econTab = e.currentTarget.dataset.econtab;
        drawPanel(true);
      });
    },
  };
}
// 1.10.2 5.2：発電所の性能の単元と、石炭火力の燃料費・効率の1行（運び代倍率込み）
function perfUnitsOf(lc, key) {
  return (lc.tables || Gm.gridTables(null)).perf[key] || Gm.PERF[key] || [];
}
function perfUnitLabel(lc, key) {
  const units = perfUnitsOf(lc, key);
  if (!DEV.demo && A.S.data) {
    const names = [...new Set(units.map((u) => A.shortName(A.unitName(u))).filter(Boolean))];
    if (names.length) return names.slice(0, 2).join('・');
  }
  return Gm.GATE_NAMES[key] || key;
}
function plantFuelText(g, lc, p) {
  const D = Gm.PLANTS[p.type];
  if (!D.coal) return '燃料なし';
  const fk = D.fuel || 'coal';
  const fName = Gm.FUELS[fk]?.name || '石炭';
  const eff = Gm.plantEff(p, lc, g);
  const cost = Gm.fuelPrice(g, g.t, p.site, fk) / eff;
  const haul = Gm.isJapan(g) && Gm.FUELS[fk]?.haul ? `・運び代 ${haulShort(g, p.site)}` : '';
  return `燃料費（${fName}） ${cost.toFixed(1)} 円/kWh（効率 ${(eff * 100).toFixed(1)}%${haul}。${A.esc(perfUnitLabel(lc, D.perf))}の定着で最大 ${(D.eff[1] * 100).toFixed(0)}%）`;
}
// 1.10.2 5.1・5.2：収支のまとめ（電力の横棒・お金の横棒・売れた 1 kWh あたり・発電所ごとの燃料費と捨てた分）
function econSummaryHtml(g, lc) {
  const raw = Gm.econSummary(g, econTab);
  const s = raw.days > 0 || raw.hours > 0 ? raw : Gm.econEstimate(g, lc);
  const tabs = `<div class="gseg gecontabs">${[['7d', '直近 7日の1日あたり'], ['1d', '昨日']].map(([k, lb]) => `<button class="btn small ${econTab === k ? 'on' : ''}" data-econtab="${k}">${lb}</button>`).join('')}</div>`;
  const span = s.estimated ? '記録がまだないため、いまの系統の1日の見込み' : s.partial ? `今日のこれまで（${s.hours}時間分）` : econTab === '1d' ? '昨日の1日分' : `直近 ${s.days}日の1日あたり`;
  if (!(s.gen > 0 || s.rev > 0 || s.expense > 0)) {
    return `<div class="gecon"><h3>収支のまとめ</h3>${tabs}<p class="note">まだ記録がありません</p></div>`;
  }
  // 電力の横棒：発電＝売れた分＋送電の損失＋最低出力で捨てた分＋そのほか
  const gTot = Math.max(s.gen, 1e-6);
  const pw = (v) => `${Math.max(0, (v / gTot) * 100).toFixed(1)}%`;
  const pPct = (v) => `${Math.round((v / gTot) * 100)}%`;
  const pBar = `<div class="gebar" role="img" aria-label="発電 ${kwh(s.gen)}：売れた分 ${pPct(s.served)}、送電の損失 ${pPct(s.lineLoss)}、最低出力で捨てた分 ${pPct(s.waste)}、そのほか ${pPct(s.other)}">
    <i class="gs-sold" style="width:${pw(s.served)}"></i><i class="gs-loss" style="width:${pw(s.lineLoss)}"></i><i class="gs-waste" style="width:${pw(s.waste)}"></i><i class="gs-oth" style="width:${pw(s.other)}"></i>
  </div>
  <p class="small gekey"><span><i class="gs-sold"></i>売れた ${kwh(s.served)}（${pPct(s.served)}）</span><span><i class="gs-loss"></i>送電の損失 ${kwh(s.lineLoss)}（${pPct(s.lineLoss)}）</span><span><i class="gs-waste"></i>捨てた分 ${kwh(s.waste)}（${pPct(s.waste)}）</span><span><i class="gs-oth"></i>そのほか ${kwh(s.other)}（${pPct(s.other)}）</span></p>`;
  // お金の横棒：収入（売電）と支出（燃料・保守・修理・返済）を同じ縮尺で 2 本並べる
  const mMax = Math.max(s.rev, s.expense, 1);
  const mw = (v) => `${Math.max(0, (v / mMax) * 100).toFixed(1)}%`;
  const netCls = s.net < -0.5 ? 'gneg' : '';
  const netText = s.net < -0.5 ? `−${yen(-s.net)}（赤字）` : `${s.net >= 0.5 ? '+' : ''}${yen(s.net)}`;
  const mBars = `<div class="gebar2">
    <div class="gebarrow"><span class="geblab">収入</span><div class="gebar"><i class="gs-rev" style="width:${mw(s.rev)}"></i></div><b class="gebval">${yenShort(s.rev)}</b></div>
    <div class="gebarrow"><span class="geblab">支出</span><div class="gebar"><i class="gs-fuel" style="width:${mw(s.fuel)}"></i><i class="gs-maint" style="width:${mw(s.maint)}"></i><i class="gs-rep" style="width:${mw(s.repair)}"></i><i class="gs-loan" style="width:${mw(s.loan)}"></i></div><b class="gebval">${yenShort(s.expense)}</b></div>
  </div>
  <p class="spread grow"><span>差し引き（1日あたり）</span><b class="${netCls}">${netText}</b></p>
  <p class="small gekey"><span><i class="gs-rev"></i>売電 ${yen(s.rev)}</span><span><i class="gs-fuel"></i>燃料 ${yen(s.fuel)}</span><span><i class="gs-maint"></i>保守 ${yen(s.maint)}</span><span><i class="gs-rep"></i>修理 ${yen(s.repair)}</span><span><i class="gs-loan"></i>返済 ${yen(s.loan)}</span></p>
  ${s.reward > 0.5 ? `<p class="small">ミッションのご褒美（棒には含めない）：+${yen(s.reward)}/日</p>` : ''}`;
  const perKwh = `<p class="small geunit">売れた 1 kWh あたり：売電 <b>${s.revPerKwh.toFixed(1)} 円</b>・燃料費 <b>${s.fuelPerKwh.toFixed(1)} 円</b>（損失と捨てた分を含む）</p>`;
  // 5.2 発電所ごとの行
  const pRows = g.plants
    .map((p) => {
      const D = Gm.PLANTS[p.type];
      const ps = s.plants?.[p.id];
      const wasteStr = ps && ps.waste > 0.5 ? `<span class="gneg">最低出力で捨てた分 ${kwh(ps.waste)}/日</span>` : '';
      const genStr = ps && ps.gen > 0.5 ? `発電 ${kwh(ps.gen)}/日` : '発電 0 kWh/日';
      return `<div class="geplant"><p class="spread grow"><b>${D.short} ${kw(p.kw)}（${A.esc(Gm.nodeOf(g, p.site).name)}）</b><small>${genStr}</small></p>
        <p class="small">${D.coal ? plantFuelText(g, lc, p) : '燃料なし'}${wasteStr ? `<br>${wasteStr}` : ''}</p>
        ${D.coal ? unitButtons(perfUnitsOf(lc, D.perf)) : ''}</div>`;
    })
    .join('');
  return `<div class="gecon">
    <h3>収支のまとめ</h3>
    ${tabs}
    <p class="small">${span} ・ 発電 ${kwh(s.gen)}</p>
    ${pBar}
    ${mBars}
    ${perKwh}
    ${pRows ? `<h4>発電所ごとの燃料費・捨てた分</h4>${pRows}` : ''}
  </div>`;
}
// 開発者モード：数値を確かめやすいように、1日の収益の内訳と発電所ごとの出力・効率
function devSupplyHtml(g, lc) {
  const d = Dv.moneyDay(DEV.state.money);
  const rows = g.plants.map((p) => {
    const D = Gm.PLANTS[p.type];
    const out = g.last?.plants[p.id] || 0;
    return `<p class="spread grow"><span>${D.short} ${kw(p.kw)}（${A.esc(Gm.nodeOf(g, p.site).name)}）<small> ${plantState(g, p)}</small></span><small>出力 ${kw(out)}（${pct(p.kw ? out / p.kw : 0)}）${D.coal ? ` ・ 効率 ${(Gm.plantEff(p, lc, g) * 100).toFixed(1)}%${Gm.isJapan(g) ? ` ・ 燃料費 ${haulShort(g, p.site)}` : ''}` : ''}</small></p>`;
  }).join('');
  return `<div class="gdevbox"><h3>${DEV.demo ? "デモ" : "開発者モード"}：直近 ${d.hours}時間の収益の内訳</h3>
    <p class="spread grow"><span>料金（売電）</span><b>${yen(d.rev)}</b></p>
    <p class="spread grow"><span>燃料費</span><b>−${yen(d.fuel)}</b></p>
    <p class="spread grow"><span>保守費</span><b>−${yen(d.maint)}</b></p>
    <p class="spread grow"><span>修理費</span><b>−${yen(d.repair)}</b></p>
    <p class="spread grow"><span>返済</span><b>−${yen(d.loan)}</b></p>
    <p class="spread grow"><span>利益</span><b class="${d.profit < 0 ? 'gneg' : ''}">${yen(d.profit)}</b></p>
    <h3>発電所ごとの出力・効率</h3>${rows || '<p class="note">発電所がありません</p>'}</div>`;
}

// 1.8.1 町の詳細から、その町の申し込みのカードへ
function goApp(appId) {
  listTab = 'list';
  setPanel('list');
  const el = document.querySelector(`[data-pin] [data-appcard="${appId}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  el.classList.add('gflash');
  setTimeout(() => el.classList.remove('gflash'), 1600);
}
// ---- 一覧のパネル：事故・申し込み・発電所と線の一覧・報告書 ----
function listPanel(g, lc) {
  const t = g.t;
  // 1.8.0 史実モード：一覧のパネルに「ミッション」のタブ
  const mOn = Gm.missionsOn(g);
  if (!mOn) listTab = 'list';
  const left = mOn ? Ms.MISSIONS.filter((m) => Gm.missionOpen(g, m) && !Gm.missionDone(g, m.id)).length : 0;
  const tabs = mOn ? `<div class="gseg gltabs">${[['list', '一覧'], ['mission', `ミッション${left ? `（${left}）` : ''}`]].map(([k, n]) => `<button class="btn small ${listTab === k ? 'on' : ''}" data-ltab="${k}">${n}</button>`).join('')}</div>` : '';
  const bindTabs = (onAll) => onAll('[data-ltab]', 'click', (e) => {
    listTab = e.currentTarget.dataset.ltab;
    drawPanel();
  });
  if (listTab === 'mission') {
    const body = missionsHtml(g);
    return {
      title: '一覧',
      html: `${tabs}${body}`,
      bind: ({ onAll }) => {
        bindTabs(onAll);
        onAll('[data-mcard]', 'click', (e) => missionCard(e.currentTarget.dataset.mcard));
        onAll('[data-sources]', 'click', sourcesSheet);
      },
    };
  }
  const incs = g.incidents.map((i) => `<div class="gitem"><p class="spread"><b>${A.esc(Gm.INCIDENTS[i.key].title)}</b><small>あと ${Math.max(0, i.deadline - t)}時間</small></p><p class="small">${A.esc(i.what || '')}</p><button class="btn primary" data-inc="${i.id}">対処を選ぶ</button></div>`).join('');
  const ecList = Gm.econSummary(g, '7d');
  const fuelPerKwhNow = ecList.served > 1e-6 ? `${ecList.fuelPerKwh.toFixed(1)} 円` : '—';
  const apps = g.apps
    .map((a) => {
      const p = Gm.previewApp(g, lc, a.id);
      const n = Gm.nodeOf(g, a.town);
      if (PIC[`load_${a.type}`]) seen(PIC[`load_${a.type}`]);
      const warn = [!p.reach ? (p.tramWhy ? Gm.whyText(g, p.tramWhy) : p.net ? '今の設備では電気が足りない（受けると停電する）' : '電気が届く道がない（線・変電所がつながっていない）') : '', p.reach && p.margin < g.reserve ? `供給の余裕が小さい（${pct(p.margin)}）` : '', p.line > 1 ? `線の使用率 ${pct(p.line)}` : '', p.sub > 1 ? `変圧器の使用率 ${pct(p.sub)}` : '', p.conv > 1 ? `変換所の使用率 ${pct(p.conv)}` : ''].filter(Boolean);
      return `<div class="gitem" data-appcard="${a.id}"><p class="spread gapphead"><span class="gappname">${pic(`load_${a.type}`, 'mini gapppic')}<b>${A.esc(n.name)}：${Gm.LOADS[a.type].name} ${kw(a.kw)}</b></span><small>${Gm.LOADS[a.type].rate} 円/kWh</small></p>
        <p class="small">売値 ${Gm.LOADS[a.type].rate} 円/kWh（${Gm.LOADS[a.type].name}）${a.type === 'tram' ? ' ・ 直流 600 V（変換所が要る）' : ''}・いまの燃料費は売れた 1 kWh あたり ${fuelPerKwhNow}</p>
        <p class="small">受けたときの見込み（${p.hour}時ごろのピーク）：供給の余裕 ${pct(p.margin)} ・ 線の使用率 最大 ${pct(p.line)}${p.sub ? ` ・ 変圧器 ${pct(p.sub)}` : ''}${p.conv ? ` ・ 変換所 ${pct(p.conv)}` : ''}${Gm.LOADS[a.type].pf < 1 ? ' ・ 力率 0.75（受けたあと、町の建設から進相コンデンサで直せる）' : ''}</p>
        ${warn.length ? `<p class="warn small">${warn.join(' ・ ')}</p>` : ''}
        ${outlookHtml(g, lc, a.town, [a.id], true)}
        <button class="btn primary" data-accept="${a.id}">受ける</button>${a.held ? '<span class="tag">保留中</span>' : `<button class="btn" data-hold="${a.id}">保留する</button>`}<span class="small">保留に罰はありません（保留が多いと、古いものから取り下げられます）</span></div>`;
    })
    .join('');
  const order = g.priority.map((id) => g.plants.find((p) => p.id === id)).filter(Boolean);
  const plants = order.map((p) => `<button class="gitem grow2" data-gonode="${p.site}"><span><b>${Gm.PLANTS[p.type].short} ${kw(p.kw)}${p.proto ? '（試作）' : ''}</b><small>${A.esc(Gm.nodeOf(g, p.site).name)} ・ ${plantState(g, p)}${Gm.isJapan(g) && Gm.PLANTS[p.type].coal ? ` ・ 燃料費 ${haulShort(g, p.site)}` : ''}</small></span><span class="go">›</span></button>`).join('');
  const lines = g.lines.map((l) => `<button class="gitem grow2" data-goline="${l.id}"><span><b>${A.esc(Gm.lineName(g, l))}</b><small>${l.km.toFixed(1)} km・${l.n}回線${l.cAdd?.length ? `（+${l.cAdd.length}増設工事中）` : ''} ・ ${stateOf(l, t) || `使用率 ${pct(g.last?.lines[l.id]?.util || 0)}`}</small></span><span class="go">›</span></button>`).join('');
  const subs = g.subs.map((x) => `<button class="gitem grow2" data-gonode="${x.town}"><span><b>${A.esc(Gm.nodeOf(g, x.town).name)}の変圧器 ${x.mva} MVA</b><small>${stateOf(x, t) || `使用率 ${pct(g.last?.subs[x.town] || 0)}`}</small></span><span class="go">›</span></button>`).join('');
  const convs = (g.convs || []).map((x) => `<button class="gitem grow2" data-gonode="${x.town}"><span><b>${A.esc(Gm.nodeOf(g, x.town).name)}の${Gm.CONVS[x.type].short} ${kw(x.kw)}</b><small>${stateOf(x, t) || `使用率 ${pct(g.last?.convs?.[x.town] || 0)}`}</small></span><span class="go">›</span></button>`).join('');
  const reports = g.reports
    .slice(0, 15)
    .map((r) => `<div class="gitem grep${r.ok === true ? ' ok' : r.ok === false ? ' ng' : ''}"><p class="spread"><b>${A.esc(r.title)}</b><small>${timeLabel({ t: r.t })}</small></p><p class="small">${A.esc(r.what)}${r.why ? `<br>なぜ：${A.esc(r.why)}` : ''}</p>${r.goSupply ? '<p><button class="btn small" data-gosupply>需給を見る</button></p>' : ''}${unitButtons(r.units || [])}</div>`)
    .join('');
  return {
    title: '一覧',
    html: `${tabs}<h3>事故（対処待ち ${g.incidents.length}／最大 ${Gm.MAX_INCIDENTS}件）</h3>${incs || '<p class="note">いまはありません</p>'}
      <p class="small">正しく対処すると被害が小さく、誤ると大きくなります。ゲームの1日（現実の1時間）答えなければ、標準の被害で片づきます。</p>
      <h3>接続の申し込み（${g.apps.length}／${Gm.appCap(g)}件）</h3>${apps || `<p class="note">${Gm.overview(g, lc).accepted >= lc.dmax - 1 ? '需要の上限に達しています。レベルと定着が増えると、また届きます' : 'いまはありません（1日に1件ほど届きます）'}</p>`}
      <h3>発電所（${g.plants.length}）</h3>${plants || '<p class="note">ありません</p>'}
      <h3>送電線・配電線・変電所・変換所（${g.lines.length + g.subs.length + (g.convs || []).length}）</h3>${lines + subs + convs || '<p class="note">まだありません（建設から建てます）</p>'}
      <h3>報告書</h3>${reports || '<p class="note">まだありません</p>'}`,
    bind: ({ onAll, g: gg }) => {
      bindTabs(onAll);
      onAll('[data-inc]', 'click', (e) => incidentScreen(e.currentTarget.dataset.inc));
      onAll('[data-accept]', 'click', async (e) => {
        const a = gg.apps.find((x) => x.id === e.currentTarget.dataset.accept);
        Gm.acceptApp(gg, a.id);
        const tf = a.type === 'tram' && Gm.isJapan(gg) ? J.tramFactOf(a.town) : null;
        if (tf && !DEV.tut && !DEV.demo) Mn.recordFact(gg, tf);
        await save();
        drawPanel(true);
        live();
        act('accept', a);
        if (tf) band(`史実：${tf.text}（${J.confText(tf.conf)}）`);
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
      onAll('[data-gosupply]', 'click', () => setPanel('supply'));
    },
  };
}

// ---- 1.8.0 史実モードのミッション：一覧のタブ・答え合わせのカード ----
function missionsHtml(g) {
  const open = Ms.MISSIONS.filter((m) => Gm.missionOpen(g, m));
  const todo = open.filter((m) => !Gm.missionDone(g, m.id));
  const done = open.filter((m) => Gm.missionDone(g, m.id));
  const later = Ms.MISSIONS.filter((m) => !Gm.missionOpen(g, m));
  const row = (m) => `<div class="gitem gmission"><p class="spread gmheadrow"><span class="gappname">${PIC[m.id] ? pic(m.id, 'mini gmpic') : ''}<b>${A.esc(m.name)}</b></span><small>${eraName(m.era)}${m.level ? `（Lv${m.level}）` : ''}</small></p>
    <p class="small">${A.esc(m.goal)}</p>
    <p class="small gmprog">進み具合：${A.esc(Gm.missionProgress(g, m))}</p>
    <p class="small gmhint">ヒント：${A.esc(m.hint)}</p>
    ${unitButtons(m.units)}</div>`;
  const drow = (m) => `<button class="gitem grow2 gmdone" data-mcard="${m.id}"><span class="gappname">${PIC[m.id] ? pic(m.id, 'mini gmpic') : ''}<span><b>✓ ${A.esc(m.name)}</b><small>${A.esc(doneWhen(g, m.id))} ・ 答え合わせを見る</small></span></span><span class="go">›</span></button>`;
  return `<p class="small">史実モードのミッション：日本の電気の歴史の大事なところを、自分の系統でたどる。時代が進む条件ではない（いつでも続きができる）。判定はゲームの1日（0時）に、前の日の結果で。達成すると答え合わせ（史実）と、ご褒美の収益（直近 7 日の売電の平均の 5 日分）。</p>
    <h3>ミッション（${todo.length}）</h3>${todo.map(row).join('') || '<p class="note">いま出ているミッションは、すべて達成した</p>'}
    ${later.length ? `<p class="small">これからの時代に出るミッション：${later.length}</p>` : ''}
    ${done.length ? `<h3>達成した（${done.length}）</h3>${done.map(drow).join('')}` : ''}
    <p class="small"><button class="link" data-sources>出典の一覧</button></p>`;
}
const doneWhen = (g, id) => {
  const d = g.missions?.done?.[id];
  return d ? `ゲームの ${Gm.yearOf(d.t) + 1}年目・${eraName(d.era || 1)}に達成` : '';
};
// 答え合わせのカード（地図に重ねる半透明のカード）：史実の年・内容・出典・確かめたかどうか・物理の説明
function missionCard(id) {
  const g = G(), m = Ms.missionOf(id);
  const mid = document.querySelector('[data-mid]');
  if (!m || !mid) return;
  const a = Ms.answerOf(m, g);
  const d = g.missions?.done?.[id];
  mid.querySelector('.gmcard')?.remove();
  const el = document.createElement('div');
  el.className = 'gmcard';
  el.setAttribute('role', 'dialog');
  const mpic = PIC[m.id] && picSrc(PIC[m.id]) ? `<div class="gmcardpic">${pic(m.id, 'wide')}</div>` : '';
  if (PIC[m.id]) seen(PIC[m.id]);
  el.innerHTML = `<div class="gmcardin">
    ${mpic}
    <p class="gmhead">${d ? 'ミッション達成 ・ 答え合わせ' : '答え合わせ'}</p>
    <h2>${A.esc(m.name)}</h2>
    ${a.year ? `<p class="gmyear">史実 ${a.year}年</p>` : a.physics ? '<p class="gmyear">物理</p>' : ''}
    <p>${A.esc(a.text)}</p>
    ${a.extra ? `<p class="gmextra">${A.esc(a.extra)}</p>` : ''}
    <p class="small">出典 ${A.esc(a.src)}（${J.confText(a.conf)}）${a.physics ? ' ・ 物理の説明つき' : ''} <button class="link" data-sources>出典の一覧</button></p>
    ${d ? `<p class="small">${A.esc(doneWhen(g, id))}${d.reward ? ` ・ ご褒美 収益 +${yen(d.reward)}` : ''}</p>` : ''}
    ${unitButtons(m.units)}
    <button class="btn primary gwide" data-mclose>閉じる</button></div>`;
  mid.append(el);
  el.querySelector('[data-mclose]').onclick = () => {
    el.remove();
    drainMissions();
    drainAlerts();
  };
  el.querySelector('[data-sources]').onclick = sourcesSheet;
  el.querySelectorAll('[data-unitgo]').forEach((b) => (b.onclick = () => goUnit(b.dataset.unitgo)));
  if (A.fx() && d) A.playNotes([[659.3, 0], [784, 0.1], [1046.5, 0.2]]);
}
// 新しく達成したミッション：したことの帯「ミッション達成：◯◯」と答え合わせのカード（1つずつ。演出・ほかのカードがあれば待つ）
function drainMissions() {
  const g = G();
  const fresh = g?.missions?.fresh;
  if (!fresh?.length || !onGrid() || tutOn() || DEV.running || document.querySelector('.modal, .goverlay, .galert, .gtut, .gmcard')) return;
  const id = fresh.shift();
  if (!fresh.length) delete g.missions.fresh;
  const m = Ms.missionOf(id);
  if (m) {
    band(`ミッション達成：${m.name}`);
    missionCard(id);
  }
  save();
  if (panel?.startsWith('list')) drawPanel(true);
}

// 1.6.4 この系統で再現した史実（史実と同じ区間を結んだもの）。まだ再現していないものは出さない（答えを先に見せない）
function factsHtml(g) {
  const rows = Mn.factTimeline(g);
  return `<h3>この系統で再現した史実</h3>${rows.length ? `<ul class="gnotes gfacts">${rows.map((r) => `<li><b>${r.year}年</b> ${A.esc(r.text)}<small>（ゲームの ${A.esc(r.game)}${r.conf === true ? '' : `・史実は${J.confText(r.conf)}`}）</small></li>`).join('')}</ul>` : '<p class="small">まだありません。史実と同じ区間を線で結ぶと、ここに残ります。</p>'}
    <p class="small"><button class="link" data-sources>出典の一覧</button></p>`;
}
// ---- 1.8.2 収益（円）の使い道：研究開発・町への投資・記念の建物（経営のパネルの節。町の詳細にも投資と記念の建物）----
let spendTab = 'rd';
const yenQ = (q) => (q.cost != null ? yen(q.cost) : '');
function spendRow(name, sub, q, data, label) {
  return `<div class="gspend"><p class="spread grow"><span><b>${name}</b><small>${sub}</small></span><button class="btn small${q.ok ? ' primary' : ''}" ${data} ${q.ok ? '' : 'disabled'}>${label}${q.cost != null ? `<small>${yenQ(q)}</small>` : ''}</button></p>${q.ok || q.cost == null ? '' : `<p class="small gwhy">${A.esc(q.why)}</p>`}</div>`;
}
function rdHtml(g, lc) {
  const d = g.rd?.doing;
  const rows = Gm.rdKeys(g)
    .map((k) => {
      const lv = Gm.rdLevel(g, k);
      const q = Gm.quoteResearch(g, k);
      const units = lc.tables?.perf?.[k] || Gm.PERF[k] || [];
      const zero = !(lc.perf[k] > 0);
      const sub = `${A.esc(Gm.RD_KEYS[k].what)} ・ ${lv}／${Gm.RD_MAX}段 ・ 性能 ${pct(lc.perf[k] || 0)}${lv ? ` → ${pct(Gm.perfNow(g, lc, k))}` : ''}${zero ? '<br><span class="gneg">学習の定着が 0 なので、研究しても上がらない</span>' : ''}`;
      const btn = lv >= Gm.RD_MAX ? { ok: false, why: `最高の段（${Gm.RD_MAX}）` } : q;
      return `${spendRow(Gm.GATE_NAMES[k], sub, btn, `data-rd="${k}"`, d?.key === k ? '研究中' : `${lv + 1}段目を研究`)}<details class="gunitsd"><summary>この項目の単元を解く</summary>${unitButtons(units)}</details>`;
    })
    .join('');
  return `<p class="small">実際の性能＝学習で決まる性能 ×（1 ＋ 0.04 × 段）（1 を超えない）。<b>定着した単元が多いほど、研究が効く</b>（上限は学習で決まる）。1段にゲームの ${Gm.RD_DAYS} 日、同時に1つ。次の段は前の段の2倍の費用。</p>
    ${d ? `<p class="small gdoing">研究中：${Gm.GATE_NAMES[d.key]}（あと ${Math.max(1, Math.ceil((d.until - g.t) / 24))}日）</p>` : ''}${rows}`;
}
// 投資できる町：線か需要のある町（大きい順）と、投資した町
const spendTowns = (g) =>
  Gm.nodesOf(g)
    .filter((n) => n.town && Gm.townActive(g, n) && Gm.nodeOpen(g, n) && (Gm.investLevel(g, n.id) || Gm.decorsOf(g, n.id).length || g.loads.some((l) => l.town === n.id) || g.lines.some((l) => l.a === n.id || l.b === n.id)))
    .sort((a, b) => (b.size || 2) - (a.size || 2) || Gm.investLevel(g, b.id) - Gm.investLevel(g, a.id));
function investRow(g, id) {
  const lv = Gm.investLevel(g, id);
  const q = lv >= Gm.INVEST_MAX ? { ok: false, why: `最高の段（${Gm.INVEST_MAX}）` } : Gm.quoteInvest(g, id);
  return spendRow(A.esc(Gm.nodeOf(g, id).name), `${lv}／${Gm.INVEST_MAX}段 ・ 申し込みの届きやすさ ×${(Gm.INVEST_APP ** lv).toFixed(2)} ・ 信用の戻り ×${(Gm.INVEST_REP ** lv).toFixed(2)}`, q, `data-invest="${id}"`, `${lv + 1}段目に投資`);
}
function investHtml(g) {
  const ts = spendTowns(g);
  return `<p class="small">1段ごとに、その町の接続の申し込みの届きやすさ ×${Gm.INVEST_APP}、停電で下がった町の信用が戻る速さ ×${Gm.INVEST_REP}（3段まで）。<b>需要の上限（D_max）は変わらない</b>（どの町から申し込みが来やすいかを選べるだけ）。遠い町の申し込みばかり来るときの手当てにも。</p>
    ${ts.length ? ts.map((n) => investRow(g, n.id)).join('') : '<p class="note">線か需要のある町が、まだありません</p>'}`;
}
function decorRowHtml(g, id) {
  const ds = Gm.decorsOf(g, id);
  return `${ds.map((d) => `<p class="spread grow gdecrow"><span>${Art.decorIcon(d.kind)}${Gm.DECOR[d.kind].name}<small>ゲームの ${Gm.yearOf(d.at) + 1}年目に建てた</small></span><button class="btn small" data-decrm="${id}:${d.id}">撤去</button></p>`).join('')}
    ${ds.length < Gm.DECOR_MAX ? `<button class="btn small" data-decor="${id}">記念の建物を建てる（${ds.length}／${Gm.DECOR_MAX}）</button>` : `<p class="small">1つの町に${Gm.DECOR_MAX}つまで</p>`}`;
}
function decorHtml(g) {
  const ts = spendTowns(g);
  return `<p class="small">町に記念の建物を建てる（見た目だけ。性能・需要は変わらない）。地図を拡大すると、町のまわりに見える。時代に合うものが建てられる。撤去もできる（収益は戻らない）。</p>
    ${ts.length ? ts.map((n) => `<div class="gspend"><p><b>${A.esc(n.name)}</b></p>${decorRowHtml(g, n.id)}</div>`).join('') : '<p class="note">線か需要のある町が、まだありません</p>'}`;
}
function spendHtml(g, lc) {
  const tabs = [['rd', '研究開発'], ['invest', '町への投資'], ['decor', '記念の建物']];
  const body = spendTab === 'invest' ? investHtml(g) : spendTab === 'decor' ? decorHtml(g) : rdHtml(g, lc);
  return `<h3>収益の使い道</h3>
    <p class="small">収益（円）だけで払う（コインでは払えない）。値段は系統の規模に合わせて、直近 30 日の1日の利益の平均（いま ${yen(Gm.spendBase(g))}）から決まる。収益がマイナス・経営再建中は使えず、払ったあと収益が 0 を下回る額も使えない。</p>
    <div class="gseg gspendtabs">${tabs.map(([k, n]) => `<button class="btn small ${spendTab === k ? 'on' : ''}" data-spendtab="${k}">${n}</button>`).join('')}</div>
    ${body}`;
}
// 町の詳細の「町への投資」「この町の記念の建物」
function spendTownHtml(g, id) {
  const n = Gm.nodeOf(g, id);
  if (!Gm.townActive(g, n) || !Gm.nodeOpen(g, n)) return '';
  return `<h3>町への投資</h3>${investRow(g, id)}<h3>この町の記念の建物</h3>${decorRowHtml(g, id)}`;
}
function redrawSpend() {
  if (panel) drawPanel(true);
  if (sel?.detail) drawDetail(true);
  live();
}
function bindSpend(onAll) {
  onAll('[data-spendtab]', 'click', (e) => {
    spendTab = e.currentTarget.dataset.spendtab;
    drawPanel(true);
  });
  onAll('[data-rd]', 'click', async (e) => {
    const k = e.currentTarget.dataset.rd;
    const r = Gm.startResearch(G(), k);
    if (!r.ok) return;
    await save();
    band(`${Gm.GATE_NAMES[k]}の研究開発を始めた（${Gm.RD_DAYS}日）`);
    redrawSpend();
  });
  onAll('[data-invest]', 'click', async (e) => {
    const id = e.currentTarget.dataset.invest;
    const r = Gm.invest(G(), id);
    if (!r.ok) return;
    await save();
    band(`${Gm.nodeOf(G(), id).name}に投資した（${Gm.investLevel(G(), id)}段）`);
    redrawSpend();
  });
  onAll('[data-decor]', 'click', (e) => decorSheet(e.currentTarget.dataset.decor));
  onAll('[data-decrm]', 'click', (e) => {
    const [id, did] = e.currentTarget.dataset.decrm.split(':');
    const d = Gm.decorsOf(G(), id).find((x) => x.id === did);
    if (!d) return;
    sheet(`<h2>${A.esc(Gm.DECOR[d.kind].name)}を撤去する</h2><p>${A.esc(Gm.nodeOf(G(), id).name)}の${A.esc(Gm.DECOR[d.kind].name)}を撤去します。払った収益は戻りません。</p><button class="btn primary gwide" data-ok>撤去する</button>`, ({ q, close }) => {
      q('[data-ok]').onclick = async () => {
        Gm.removeDecor(G(), id, did);
        await save();
        close();
        redrawSpend();
      };
    });
  });
}
function decorSheet(id) {
  const g = G();
  const n = Gm.nodeOf(g, id);
  const kinds = Object.keys(Gm.DECOR);
  const rows = kinds
    .map((k) => {
      const D = Gm.DECOR[k];
      const q = Gm.quoteDecor(g, id, k);
      const why = D.era > g.era ? `${eraName(D.era)}から` : q.ok ? '' : q.why;
      return `<button class="gbitem${q.ok ? '' : ' locked'}" data-dk="${k}" ${q.ok ? '' : 'disabled'}>${Art.decorIcon(k)}<span class="gbtx"><b>${D.name}</b><small>${eraName(D.era)}${q.cost != null ? ` ・ ${yen(q.cost)}` : ''}${why ? ` ・ ${A.esc(why)}` : ''}</small></span></button>`;
    })
    .join('');
  sheet(`<h2>${A.esc(n.name)}に記念の建物を建てる</h2><p class="small">見た目だけ（性能・需要は変わらない）。収益で払う。地図を拡大すると、町のまわりに見える。</p>${rows}`, ({ onAll, close }) =>
    onAll('[data-dk]', 'click', async (e) => {
      const k = e.currentTarget.dataset.dk;
      const r = Gm.buildDecor(G(), id, k);
      if (!r.ok) return;
      await save();
      close();
      band(`${n.name}に${Gm.DECOR[k].name}が建った`);
      decorFx(id);
      redrawSpend();
    }),
  );
}
// 建てたときの短い演出：その町に寄って、建物の絵を少し弾ませる（動きを減らす設定では出さない）
function decorFx(id) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  setTimeout(() => {
    const el = document.querySelector(`[data-node="${id}"] .gdecor:last-of-type`);
    el?.classList.add('gpopd');
  }, 50);
}
// ---- 経営のパネル：収益の推移・時代と学習・記録・新しい島・経営再建・そのほか・バージョン番号（開発者モードの入口） ----
function managePanel(g, lc) {
  const gates = Object.keys(Gm.GATES)
    .map((k) => `<p class="spread grow"><span>${lc.gateM?.[k] ? '<span class="tag ok">定着あり</span>' : lc.gate[k] ? '<span class="tag ok">1問正解</span>' : '<span class="tag">まだ</span>'}${Gm.GATE_NAMES[k]}</span><small>性能 ${pct(lc.perf[k] || 0)}${Gm.rdLevel(g, k) ? `（研究 ${Gm.rdLevel(g, k)}段で ${pct(Gm.perfNow(g, lc, k))}）` : ''}</small></p>`)
    .join('');
  const bps = Object.entries(Gm.BLUEPRINTS).map(([k, b]) => `<span class="tag ${lc.blueprint[k] ? 'ok' : ''}">${b.name}${lc.blueprint[k] ? '' : '（まだ）'}</span>`).join('');
  const yr = g.yr;
  const yrow = (y, label) => `<p class="spread grow"><span>${label}</span><small>利益 ${yen(y.profit)} ・ 停電 ${Math.round(y.unserved).toLocaleString('ja-JP')} kWh ・ 周波数が正常 ${y.hours ? pct(y.okH / y.hours) : '—'}${y.cut > 0.5 || y.moved > 0.5 ? ` ・ 使用制限で減らした量 ${Math.round(Math.max(0, y.cut || 0)).toLocaleString('ja-JP')} kWh${y.moved > 0.5 ? `（夜へ移した量 ${Math.round(y.moved).toLocaleString('ja-JP')} kWh）` : ''}` : ''}</small></p>`;
  const eras = Gm.ERAS.map((e) => `<span class="tag ${e.n <= g.era ? 'ok' : ''}">${e.name} Lv${e.level}${e.n > Gm.MAX_ERA ? '（これから）' : ''}</span>`).join('');
  // 収益の推移：今年と過去の年の利益（棒）
  const ys = [...g.years.slice(-5), { ...yr, now: true }];
  const maxP = Math.max(1, ...ys.map((y) => Math.abs(y.profit)));
  const bars = ys.map((y) => `<span class="gyb${y.profit < 0 ? ' neg' : ''}${y.now ? ' now' : ''}"><i style="height:${Math.max(2, Math.round((Math.abs(y.profit) / maxP) * 56))}px"></i><small>${y.idx + 1}年目${y.now ? '（途中）' : ''}</small></span>`).join('');
  return {
    title: '経営',
    html: `<p class="spread grow"><span>収益の残高</span><b class="${g.yen < 0 ? 'gneg' : ''}">${yen(g.yen)}</b></p>
      ${g.debt > 0.5 ? `<p class="small">借入れの残り <b>${yen(g.debt)}</b>（収入の ${Math.round(Gm.DEBT_RATE * 100)}% を返済中）</p>` : ''}
      ${g.loanUntil > g.t ? `<p class="small">借入れの返済中（あと ${Math.ceil((g.loanUntil - g.t) / 24)}日。収入の 20%）</p>` : ''}
      ${g.rebuild ? '<button class="btn primary gwide gwarn" data-rebuild2>経営再建：手放すか、借入れを選ぶ</button>' : ''}
      ${modeHtml(g)}
      <h3>収益の推移（年ごとの利益）</h3>
      <div class="gyears">${bars}</div>
      ${yrow(yr, `${yr.idx + 1}年目（途中）`)}
      ${[...g.years].reverse().map((y) => yrow(y, `${y.idx + 1}年目`)).join('')}
      ${g.best ? `<p class="small">この島の最高の年間利益：${yen(g.best.profit)}</p>` : ''}
      ${spendHtml(g, lc)}
      ${DEV.on ? '' : `<h3>絵のアルバム</h3><button class="btn gwide" data-album>絵のアルバム（${Rc.albumCount(rec())}／${Rc.ALBUM.length}）</button>`}
      <h3>時代と学習</h3>
      <p class="gtags">${eras}</p>
      <p class="small">時代はレベルで進む（いま Lv ${lc.level}）。次の時代の設備は「試作」として先取りできる（建設費3倍・故障率3倍）</p>
      ${gates}
      <p class="small">関係する単元で1問正解すると小さな設備が、1問以上定着（日をあけて続けて正解）すると大きな設備・新しい方式が開く（一度定着すれば、忘れても閉じない）。性能＝その単元の定着の割合（これまでの最大値。下がらない）。熱効率・故障の少なさ・工期に効く</p>
      <h3>設計図</h3><p class="gtags">${bps}</p>
      <p class="small">その単元の試験レベルに正解するか、関係する外部試験で満点の3割以上</p>
      ${Gm.isJapan(g) && !DEV.tut && !DEV.demo ? factsHtml(g) : ''}
      <h3>${Gm.isJapan(g) ? '始めた町' : '島'}</h3>
      <p class="small">島 ${g.islandNo}（${A.esc(Gm.placeName(g))}）${Gm.hzList(g).length ? ` ・ 周波数 ${Gm.hzList(g).join(' Hz と ')} Hz${Gm.hzList(g).length > 1 ? '（網ごと）' : ''}` : g.hz ? ` ・ 周波数 ${g.hz} Hz` : ' ・ 周波数はまだ決めていない'} ・ ${Math.floor(g.t / 24)}日目</p>
      ${(g.past || []).length ? `<p class="small">前の系統：${g.past.map((p) => `${p.islandNo}（${p.terrain === 'japan' ? `日本列島・${A.esc(J.startOf(p.start)?.label || '')}から` : Gm.TERRAINS[p.terrain]?.name || ''}）${Math.floor(p.hours / 24)}日・最高の年間利益 ${p.best ? yen(p.best.profit) : '—'}`).join(' ／ ')}</p>` : ''}
      <p class="small">いつでも、日本列島の別の地方（始める町）から、明治の小さな発電所でやり直せます。時代（レベル）・設計図・性能の上乗せは引き継ぎ、今の記録は残ります。今の設備と収益はなくなり、使ったコインは戻りません。</p>
      <button class="btn" data-newisland>別の地方から始める</button>
      <h3>そのほか</h3>
      <label class="row"><input type="checkbox" data-minion ${miniOn() ? 'checked' : ''}><span>小さなグラフを出す<small>上の帯の下に、直近24時間の需要と電源の出力・予備力の残り（押すと需給）</small></span></label>
      <label class="row"><input type="checkbox" data-terrainon ${terrainOn() ? 'checked' : ''}><span>地形と景色を出す<small>日本列島の地図に、山地・平野の塗り分けと県境、拡大したときの田畑・林・市街地（見た目だけ。建てられる場所や費用は変わらない）。川・湖・海岸線は外しても出ます</small></span></label>
      <label class="row"><input type="checkbox" data-mapanimon ${mapAnimOn() ? 'checked' : ''}><span>地図の動きを出す<small>拡大した地図（幅 60 km 以下）に、工場の歯車と煙・商店の看板・海沿い石炭火力の運搬船・電鉄の電車を描く（地図を動かしている間は止まります）</small></span></label>
      ${DEV.tut || DEV.demo ? '' : '<button class="btn gwide" data-tutagain>チュートリアルをもう一度</button>'}
      <p class="small">テーマ（シンプル／演出あり）は、ホームの「出題対象の設定」で変えられます。事故・出来事が起きたときの演出と収益の演出は、どちらのテーマでも出ます。演出ありでは、揺れ・光・音が少し強くなります（建設・時代が進んだとき・全域停電からの復旧にも音と光）。</p>
      ${versionHtml()}`,
    bind: ({ onAll }) => {
      onAll('[data-rebuild2]', 'click', rebuildDialog);
      onAll('[data-newisland]', 'click', islandDialog);
      onAll('[data-gmode]', 'click', (e) => switchMode(e.currentTarget.dataset.gmode));
      onAll('[data-album]', 'click', albumSheet);
      bindSpend(onAll);
      onAll('[data-tutagain]', 'click', startTutorial);
      onAll('[data-minion]', 'change', async (e) => {
        await setMini(e.target.checked);
        screen();
      });
      onAll('[data-terrainon]', 'change', async (e) => {
        await setTerrain(e.target.checked);
        screen();
      });
      onAll('[data-mapanimon]', 'change', async (e) => {
        await setMapAnim(e.target.checked);
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
    <div class="stem">${A.rich(q.stem, { order })}</div>
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
    <section class="card geffect"><p>${A.esc(text || '')}</p>${DEV.on ? `<p class="small">${DEV.tut ? '練習の東京' : DEV.demo ? 'デモ' : '開発者モード'}：回答記録には残りません</p>` : correct ? '<p class="small">コイン +100（同じ問題は1日1回まで）</p>' : ''}</section>
    <div class="choices done">
      ${order.map((c, i) => `<div class="choice ${c.choiceId === q.correctChoiceId ? `correct${correct ? ' flash' : ''}` : c.choiceId === choiceId ? 'wrong' : ''}"><span class="mark">${'ABCD'[i]}</span><span>${A.rich(c.text)}</span></div>`).join('')}
    </div>
    <section class="card expl"><h2>解説</h2><p>${A.rich(q.explanation, { order })}</p></section>
    ${q.trivia ? `<section class="card trivia"><h2>豆知識</h2><p>${A.rich(q.trivia, { order })}</p></section>` : ''}
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

// ---- 1.8.0 史実モードと自由モード：経営のパネルで切り替える。時代・学習で開くもの・コインの財布は共通 ----
function modeHtml(g) {
  if (DEV.tut || DEV.demo) return '';
  const m = Gm.modeOf(g);
  const btn = (k) => `<button class="btn small ${m === k ? 'on' : ''}" data-gmode="${k}">${Gm.MODES[k].name}</button>`;
  const other = DEV.on ? true : !!A.S.gridOther;
  return `<h3>モード</h3>
    <div class="gseg gmodeseg">${btn('history')}${btn('free')}</div>
    <p class="small">${m === 'history' ? '史実モード：日本の電気の歴史をたどるミッションがある（一覧の「ミッション」）。' : '自由モード：ミッションはなく、開いた設備をどこに・どうつないでもよい。'}時代・学習で開く設備・コインの財布は両方で共通。${DEV.on ? '開発者の系統のモードを切り替える（系統はそのまま）。' : other ? '切り替えると、今の系統を保存してから、もう一方の系統を開く（開いていない側は進まない）。' : '自由モードは、まだ始めていない（史実モードの系統はそのまま残る）。'}</p>`;
}
async function switchMode(mode) {
  const { S } = A;
  if (DEV.running) return A.toast('早送りの途中です');
  if (DEV.on) {
    // 開発者モード：開発者の系統のモードだけを変える
    if (Gm.modeOf(G()) === mode) return;
    G().mode = mode;
    await save();
    await screen();
    return band(`開発者の系統を${Gm.MODES[mode].name}にした`);
  }
  if ((S.gridMode || 'history') === mode) return;
  if (mode === 'free' && !S.gridOther) return freeStartDialog();
  await save();
  Dv.swapMode(S, mode);
  await openMode();
  band(`${Gm.MODES[mode].name}に切り替えた`);
}
// 切り替えたあと：保存して、開いた系統を前に閉じたときから進める（閉じていた分の計算。上限は現実の14日）
async function openMode() {
  lcCache = null;
  summary = null;
  B = null;
  sel = null;
  panel = null;
  townView = null;
  await Dv.saveModes(A.db, A.S);
  await screen(null, true);
}
// 自由モードを新しく始める：確認の文のあと、始める町を選ぶ（「別の地方から始める」と同じ画面）
function freeStartDialog() {
  sheet(
    `<h2>自由モードを始める</h2>
    ${pic('island', 'wide')}
    <p>自由モードを新しく始める。史実モードの系統はそのまま残る（いつでも経営のパネルから戻れる）。</p>
    <p class="small">時代（レベル）・学習で開いた設備・設計図・性能の上乗せ・コインの財布は共通。ミッションはない。建てられるのは、今までどおり学習で開いたものだけ。始める町を選ぶ：</p>
    ${startButtons('data-fstart')}`,
    ({ onAll, close }) =>
      onAll('[data-fstart]', 'click', async (e) => {
        const { S } = A;
        const now = Date.now();
        const start = e.currentTarget.dataset.fstart; // await の前に読む（await のあとは currentTarget が null）
        await save();
        Dv.swapMode(S, 'free', () => Gm.newJapan((now % 2147483647) | 0, now, start, { mode: 'free', perfMax: Gm.maxPerf(S.grid?.perfMax) }));
        S.grid.era = learningReal().era; // 今のレベルの時代から（「時代が進んだ」は出さない）
        close();
        await openMode();
        band(`自由モードを始めた（日本列島の${J.startOf(start)?.label || ''}から）`);
      }),
  );
}

// 1.6.0：始める町を選ぶボタン（史実の1行と「確かめた／未確認」。未確認の町は「年は未確認」とだけ出す）
function startButtons(attr) {
  return J.START_TOWNS.map((s) => `<button class="btn gwide gstartbtn" ${attr}="${s.id}"><b>${A.esc(s.label)}</b><small>${s.conf ? `${A.esc(s.fact)}（${A.esc(s.src)}・確かめた）` : '年は未確認（史実の調べが出典で確かめられていない）'}</small></button>`).join('');
}
// 別の地方から始める（1.6.0。今の「新しい島」の代わり）：日本列島の始める町を選ぶ。時代・設計図・性能の上乗せは引き継ぐ
function islandDialog() {
  sheet(
    `<h2>別の地方から始める</h2>
    ${pic('island', 'wide')}
    <p class="small">日本列島の、始める町を選びます。明治の小さな発電所から、時代とともに建てられる範囲が広がります。時代（レベル）・設計図・性能の上乗せは引き継ぎます。</p>
    <p class="warn small">いまの${Gm.isJapan(G()) ? '系統' : '島'}の設備と収益はなくなります（記録は残ります。使ったコインは戻りません）。</p>
    ${!DEV.on && A.S.gridOther ? `<p class="small">やり直すのは${Gm.MODES[Gm.modeOf(G())].name}の系統だけです（もう一方のモードの系統は変わりません）。</p>` : ''}
    ${startButtons('data-start')}`,
    ({ onAll, close }) =>
      onAll('[data-start]', 'click', async (e) => {
        const now = Date.now();
        store.setGrid(Gm.newIsland(G(), 'japan', now, (now % 2147483647) | 0, e.currentTarget.dataset.start));
        lcCache = null;
        G().era = learningNow().era;
        summary = null;
        B = null;
        sel = null;
        townView = null;
        await save();
        close();
        screen(null);
        act('island', { terrain: 'japan', start: G().start });
        overlay('island', '別の地方から始めた', `${Gm.placeName(G())}。明治の小さな発電所から、もう一度。時代・設計図・性能の上乗せは引き継いだ。`, [392, 523.3, 659.3]);
      }),
  );
}

// 経営再建：手放す設備を選ぶ（建設費の 30% が収益に戻る）か、借入れ
function rebuildDialog() {
  const g = G(), lc = learningNow();
  seen('G21');
  const fc = Gm.loanForecast(g, lc);
  const fmtSigned = (v) => (v < -0.5 ? `<b class="gneg">−${yen(-v)}（赤字）</b>` : `<b>${v >= 0.5 ? '+' : ''}${yen(v)}</b>`);
  const items = [
    ...g.plants.map((p) => {
      const ps = fc.summary.plants?.[p.id];
      const info = ps ? ` ・ 直近7日の1日あたり：燃料費 ${yen(ps.fuel)}・売れた量 ${kwh(ps.sold)}` : '';
      return ['plant', p.id, `${Gm.PLANTS[p.type].short} ${kw(p.kw)}（${Gm.nodeOf(g, p.site).name}）`, Gm.removeBack(p), info];
    }),
    ...g.lines.map((l) => ['line', l.id, Gm.lineName(g, l), Gm.removeBack(l), '']),
    ...g.subs.map((x) => ['sub', x.id, `${Gm.nodeOf(g, x.town).name}の変圧器 ${x.mva} MVA`, Gm.removeBack(x), '']),
    ...(g.convs || []).map((x) => ['conv', x.id, `${Gm.nodeOf(g, x.town).name}の${Gm.CONVS[x.type].short} ${kw(x.kw)}`, Gm.removeBack(x), '']),
  ];
  const forecastHtml =
    fc.summary.rev > 0 || fc.summary.expense > 0
      ? `<p class="small">いまの1日の収支（${fc.summary.estimated ? '1日の見込み' : '直近7日'}）：${fmtSigned(fc.curNet)} → 返済中は ${fmtSigned(fc.repayNet)}</p>
        ${fc.cantFinish ? `<p class="warn small"><b>今のままでは返し終わらず、約 ${fc.againDays}日でまた経営再建になる</b></p>` : fc.payDays ? `<p class="small">返し終える見込み：約 <b>${fc.payDays}日</b></p>` : ''}`
      : '';
  sheet(
    `<h2>経営再建</h2>
    ${pic('rebuild', 'wide')}
    <p>収益の残高がマイナスのまま3日たちました（いま <b class="gneg">${yen(g.yen)}</b>）。どちらかを選びます。時代・設計図・性能の上乗せは残ります。</p>
    <h3>借入れ</h3>
    <p class="small">いまのマイナス（${yen(fc.borrow)}）を借りて残高を 0 に戻す。借入れの残りに <b>${yen(fc.added)}</b>（×${Gm.DEBT_INTEREST}）を足し（合計 ${yen(fc.totalDebt)}）、残りが 0 になるまで収入の ${Math.round(Gm.DEBT_RATE * 100)}% を返済する（返済中は収益の使い道を使えない）。</p>
    ${forecastHtml}
    <button class="btn primary gwide" data-loan>借入れをする</button>
    <h3>設備を手放す</h3>
    <p class="small">選んだ設備の値打ちの 30% が収益に戻る。残高が 0 以上になれば再建は終わり。</p>
    ${items.map(([k, id, name, back, info]) => `<label class="row"><input type="checkbox" data-sell="${k}:${id}"><span>${A.esc(name)}<small>+${yen(back)}${A.esc(info)}</small></span></label>`).join('')}
    <button class="btn gwide" data-sellgo>選んだ設備を手放す</button>`,
    ({ dlg, onAll, close }) => {
      onAll('[data-loan]', 'click', async () => {
        const r = Gm.rebuildLoan(g);
        Gm.addReport(g, { title: '借入れをした', what: `残高を 0 に戻した。借入れの残り ${yen(r.debt)}（収入の ${Math.round(Gm.DEBT_RATE * 100)}% を残りが 0 になるまで返済）。`, units: [] });
        await save();
        close();
        screen();
        act('loan', r);
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
    <p>動く系統の動かし方を、練習の東京でひととおり試せます（5分ほど）。本番の系統・コイン・記録は変わりません。</p>
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
  townView = null;
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  delete G().eraUpFrom;
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
  if ((name === 'toEvening' || name === 'closePanel') && panel) setPanel(null);
  if (name === 'closePanel') return;
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
// 画面から知らせる出来事（menu:tk-nihonbashi・branch:build・bmode:plant・built:plant・line:to・panel:list・app:accept・inc:open など）
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
// 1.6.4：地図は画面のまわりまで描くので、地図の中の対象は、画面の地図の枠（.gmid）に入っているものを選び、枠で切った範囲を照らす
function mapClip(el, r) {
  const mid = el.closest('[data-mid]');
  if (!mid || !el.closest('[data-mapwrap]')) return r;
  const m = mid.getBoundingClientRect();
  const x0 = Math.max(r.left, m.left), y0 = Math.max(r.top, m.top), x1 = Math.min(r.right, m.right), y1 = Math.min(r.bottom, m.bottom);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 };
}
function tutTarget(q) {
  const els = [...document.querySelectorAll(q)];
  return els.find((e) => mapClip(e, e.getBoundingClientRect())) || els[0] || null;
}
// スポットライトの位置：対象のまわりだけ穴をあけ、ほかは暗くして押せなくする。吹き出しは対象の上か下
function tutPlace() {
  const el = document.querySelector('.gtut');
  if (!el || !tutOn()) return;
  const st = Mn.TUTORIAL[T.i];
  if (!st) return;
  const W = window.innerWidth, H = window.innerHeight;
  let tgt = st.target ? tutTarget(st.target) : null;
  if (tgt && T.scrolled !== T.i) {
    T.scrolled = T.i;
    if (tgt.closest('.gpin, .gdetail, .gbcard') || !tgt.closest('.gscreen')) tgt.scrollIntoView?.({ block: 'nearest' });
  }
  let r = tgt ? mapClip(tgt, tgt.getBoundingClientRect()) : null;
  if (r && (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W)) r = null;
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
        const e = tutTarget(st.target);
        if (Mn.TUTORIAL[T.i] !== st || (e && mapClip(e, e.getBoundingClientRect()))) return; // 1.6.4：地図のまわり（画面の外）にあるだけなら、見つからない扱い
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
  return `<p class="note center">地図：地球地図日本（国土地理院。海岸線・川・湖）を加工して作成、県境は Natural Earth（1:10m）、標高は NOAA ETOPO 2022。主な島だけを描いています（沖縄・小笠原・北方の島々は描いていません）。県境は今のもの。<button class="link" data-sources>出典の一覧</button></p>
    <p class="note center"><button class="link gver" data-ver>版 ${A.esc(window.APP_VERSION || '')}</button></p>`;
}
function bindVersion(onAll) {
  onAll('[data-sources]', 'click', sourcesSheet);
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
  townView = null;
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  delete G().eraUpFrom;
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
  townView = null;
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
  Object.assign(DEV.state.grid, { mode: 'history', noMissions: true }); // 1.8.0：デモは史実モード（ミッションは出さない）
  Object.assign(DEV, { on: true, tut: false, demo: true, key: Dv.DEMO_KEY });
  summary = null;
  B = null;
  sel = null;
  panel = null;
  townView = null;
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  delete G().eraUpFrom;
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
  townView = null;
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
  if (DEV.tut) return '<div class="gdevband gtutband"><span><b>チュートリアル（練習の東京）</b><small>本番の系統・コイン・記録は変わりません</small></span></div>';
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
  if (el) el.textContent = `${timeLabel(G())} ・ 島 ${G().islandNo}（${Gm.placeName(G())}）`;
};
function devSheet() {
  const g = G(), o = DEV.state.opts, real = learningBase(), lc = learningNow();
  const perfNow = Math.round((o.perf ?? 0) * 100);
  const incs = Object.entries(Gm.INCIDENTS).map(([k, D]) => `<option value="${k}">${A.esc(D.title)}</option>`).join('');
  const evs = Object.entries(Gm.EVENTS).map(([k, E]) => `<option value="${k}">${A.esc(E.name)}（${A.esc(E.text)}）</option>`).join('');
  sheet(
    `<h2>${DEV.demo ? 'デモの操作' : '開発者モードの操作'}</h2>
    <p class="small" data-devclock>${timeLabel(g)} ・ 島 ${g.islandNo}（${A.esc(Gm.placeName(g))}）</p>
    ${DEV.demo ? '' : `<h3>モード</h3><div class="gseg">${['history', 'free'].map((k) => `<button class="btn small ${Gm.modeOf(g) === k ? 'on' : ''}" data-devmode="${k}">${Gm.MODES[k].name}</button>`).join('')}</div><p class="small">開発者の系統のモード（史実モードではミッションと 1939 年の渇水が出る）。系統はそのまま。</p>`}
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
    <h3>始める町を選んでリセット</h3>
    <div class="gseg gwrap">${J.START_TOWNS.map((s) => `<button class="btn small" data-devreset="japan:${s.id}">${A.esc(s.label)}</button>`).join('')}</div>
    <div class="gseg gwrap">${Gm.OLD_TERRAINS.map((k) => `<button class="btn small" data-devreset="${k}:">${Gm.TERRAINS[k].name}（古い島）</button>`).join('')}</div>
    <p class="small">選んだ町（または古い島）で、${DEV.demo ? 'デモ' : '開発者'}の系統を最初からやり直します（本番の系統は変わりません）。地図は2本指・ホイールで拡大・移動できます。</p>`,
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
      onAll('[data-devmode]', 'click', async (e) => {
        G().mode = e.currentTarget.dataset.devmode === 'free' ? 'free' : 'history';
        await save();
        close();
        await screen();
        devSheet();
      });
      $('[data-coins]').onchange = (e) => set(e.target.checked ? { coins: 'unlimited' } : { coins: 'limited', devCoins: o.devCoins || (DEV.demo ? 300000 : A.walletNow().balance) });
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
        const r = Dv.triggerIncident(G(), learningNow(), $('[data-inckey]').value, DEV.demo ? 'デモ' : '開発者モード', DEV.state.money);
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
        const [terrain, start] = e.currentTarget.dataset.devreset.split(':');
        const g2 = Dv.freshGrid(Date.now(), terrain, undefined, start || null);
        g2.era = learningNow().era;
        g2.mode = DEV.demo ? 'history' : Gm.modeOf(G()); // 1.8.0：開発者の系統はモードを引き継ぐ。デモは史実モード（ミッションなし）
        if (DEV.demo) g2.noMissions = true;
        store.setGrid(g2);
        DEV.state.money = [];
        summary = null;
        B = null;
        townView = null;
        await save();
        close();
        A.toast(`${DEV.demo ? 'デモ' : '開発者'}の系統を最初から（${Gm.placeName(g2)}）`);
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
  if (!AL.busy && !document.querySelector('.gmcard')) devSheet(); // 起きたことの演出・ミッションの答え合わせがあれば、そちらを先に
}
