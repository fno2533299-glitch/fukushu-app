// 動く系統（1.5.0）の画面：地図・需給・一覧・設定、事故の問題、経営再建、新しい島
// 計算は grid.js。ここは表示と操作、保存（kv「grid」）、学習通貨の支出（ガチャと同じ台帳）
import * as Gm from './grid.js';
import * as L from './logic.js';
import * as Dv from './griddev.js';
import { GRID_IMAGES } from './gridimg.js';

let A = null; // app.js から渡される部品（S・db・show・on・esc・toast など）
let lcCache = null;
let summary = null; // 開いたときのまとめ（閉じるまで地図の上に出す）
let gridSession = null; // 事故の問題の回答をまとめるセッション（mode「系統」）
let view = 'map';
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

// 現実の時刻まで系統を進めて保存する。戻り値：進めた刻みの数
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
  if (steps > 0 || fresh || S.grid.era !== era) await A.db.putKV('grid', S.grid); // 本番の系統（開発者モードの間も現実の時刻で回る）
  return steps;
}
// いま出している系統を保存する（開発者モードでは kv「gridDev」）
const save = () => store.save();
const idle = () => A.S.view === 'grid' && !document.querySelector('.modal, .goverlay');

async function tick() {
  if (!A?.S.grid || document.hidden) return;
  const steps = await sync();
  if (steps > 0 && !DEV.on && idle()) screen(view);
}
export async function onVisible() {
  if (!A?.S.grid) return;
  await sync();
  if (DEV.on) DEV.state.grid.realAt = Date.now(); // 開発者の系統は、開いている間だけ進む
  if (idle()) screen(view, !DEV.on);
}

// 学習通貨の支出は、ガチャと同じ台帳に記録する（開発者モードでは書かない）
const spend = (coins, what) => store.spend(coins, what, { gachaId: A.uid(), at: new Date().toISOString() });
const balance = () => store.balance(A.walletNow().balance);
const coinText = (v) => (v === Infinity ? '∞' : A.num(v));

export function timeLabel(g = G()) {
  const day = Math.floor(g.t / 24);
  return `${Gm.yearOf(g.t) + 1}年目 ${Gm.SEASONS[Gm.seasonOf(g.t)]} ${(day % Gm.SEASON_DAYS) + 1}日 ${g.t % 24}時`;
}
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

// ---- ホームのカード ----
export function homeCard() {
  const g = A.S.grid; // ホームはいつも本番の系統
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

// ---- 系統の画面 ----
export async function screen(v = 'map', entering = false) {
  const { S } = A;
  if (!S.grid) await sync();
  if (!S.grid) return A.toast('問題データを読み込むと使えるようになります');
  view = v;
  const g = G();
  const lc = learningNow();
  if (entering) {
    await sync();
    if (g.acc.hours >= 12 || g.acc.notes.length) {
      summary = Gm.takeSummary(g);
      await save();
    }
  }
  const body = { map: mapView, supply: supplyView, list: listView, set: settingView }[v](g, lc);
  const tabs = [['map', '地図'], ['supply', '需給'], ['list', `一覧${g.incidents.length + g.apps.length ? `（${g.incidents.length + g.apps.length}）` : ''}`], ['set', '設定']];
  A.show(
    `<header class="top"><button class="back" data-back>‹ ホーム</button><h1>動く系統</h1><span class="streak">${eraName(g.era)}</span></header>
    ${devBand()}
    <section class="ghead">
      ${pic(`era${g.era}`, 'band')}
      <p class="spread small"><span>${timeLabel(g)}${g.hz ? ` ・ ${g.hz} Hz` : ''}</span><span>島 ${g.islandNo}（${Gm.TERRAINS[g.terrain].name}）</span></p>
      <p class="spread"><span>収益 <b class="${g.yen < 0 ? 'gneg' : ''}">${yen(g.yen)}</b></span><span>コイン <b>${coinText(balance())}</b></span></p>
    </section>
    ${g.rebuild ? '<button class="btn primary gwide gwarn" data-rebuild>経営再建：手放すか、借入れを選ぶ</button>' : ''}
    <nav class="tabs gtabs">${tabs.map(([k, n]) => `<button data-gtab="${k}" class="${k === v ? 'on' : ''}">${n}</button>`).join('')}</nav>
    ${body.html}`,
    () => {
      S.view = 'grid';
      A.on('[data-back]', 'click', () => {
        summary = null;
        A.home();
      });
      A.on('[data-gtab]', 'click', (e) => screen(e.currentTarget.dataset.gtab));
      A.on('[data-rebuild]', 'click', rebuildDialog);
      A.on('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      bindDevBand();
      body.bind?.();
      effects(g);
    },
  );
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

function summaryHtml() {
  if (!summary) return '';
  const s = summary;
  const days = s.hours / 24;
  const span = days >= 1 ? `ゲームの ${Math.round(days)}日` : `${s.hours}時間`;
  const bad = [s.blackH ? `全域停電 ${s.blackH}時間` : '', s.shedH ? `負荷遮断 ${s.shedH}時間` : '', s.badH ? `周波数・電圧の乱れ ${s.badH}時間` : ''].filter(Boolean);
  return `<section class="card gsum">
      <h2>前回からの結果（${span}）</h2>
      <p class="spread"><span>利益</span><b class="${s.profit < 0 ? 'gneg' : ''}">${s.profit >= 0 ? '+' : ''}${yen(s.profit)}</b></p>
      <p class="small">売電 ${yen(s.rev)} − 燃料 ${yen(s.fuel)} − 保守 ${yen(s.maint)} − 修理 ${yen(s.repair)}${s.loan ? ` − 返済 ${yen(s.loan)}` : ''}</p>
      <p class="small">届かなかった電力量 ${Math.round(s.unserved).toLocaleString('ja-JP')} kWh${bad.length ? ` ・ ${bad.join(' ・ ')}` : s.unserved < 1 ? ' ・ 停電なし' : ''}${s.apps ? ` ・ 新しい申し込み ${s.apps}件` : ''}</p>
      ${s.notes.length ? `<ul class="gnotes">${s.notes.map((n) => `<li>${A.esc(n)}</li>`).join('')}</ul>` : ''}
      <button class="btn small" data-sumclose>閉じる</button>
    </section>`;
}

// ---- 地図 ----
const ISLAND = 'M38,78 C70,22 170,6 252,36 C312,58 348,150 338,244 C332,322 300,372 232,386 C150,398 62,366 34,296 C8,226 10,128 38,78Z';
const utilColor = (u) => (u > 1.2 ? 'var(--ng)' : u > 1 ? 'var(--idk)' : 'var(--gline)');
function mapSvg(g, lc) {
  const nodes = Gm.nodesOf(g);
  const N = (id) => nodes.find((n) => n.id === id);
  const t = g.t;
  let s = `<path d="${ISLAND}" fill="var(--land)" stroke="var(--coast)" stroke-width="1.5"/>`;
  // 地形：雪の地域（北西）・山・川・海岸
  s += '<path d="M40,84 C60,46 110,26 150,22 C150,60 120,110 70,140 C40,140 26,116 40,84Z" fill="var(--gsnow)" opacity=".7"/>';
  s += [[150, 60], [176, 46], [205, 62], [232, 52], [262, 70], [118, 86], [278, 104], [196, 96]].map(([x, y]) => `<path d="M${x - 11},${y + 9} L${x},${y - 9} L${x + 11},${y + 9}Z" fill="var(--gmount)"/>`).join('');
  s += '<path d="M130,44 C150,90 190,120 210,180 C218,214 196,238 186,262 C196,300 208,320 214,338 C218,356 224,370 228,386" fill="none" stroke="var(--griver)" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M246,96 C236,130 222,156 210,180" fill="none" stroke="var(--griver)" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>';
  s += '<text x="74" y="72" class="gland">雪の地域</text><text x="222" y="78" class="gland">山</text><text x="302" y="312" class="gland">海岸</text><text x="118" y="236" class="gland">平野</text>';
  // 線
  for (const l of g.lines) {
    const a = N(l.a), b = N(l.b);
    const K = Gm.LINES[l.kind];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = l.route === 'detour' ? 26 : K.dc ? -8 : 0;
    const cx = mx + (dy / len) * bend, cy = my - (dx / len) * bend;
    const d = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
    const building = l.readyAt > t;
    const down = !building && Gm.lineCircuits(l, t) <= 0;
    const u = g.last?.lines[l.id]?.util || 0;
    const col = building ? 'var(--muted)' : down ? 'var(--ng)' : K.dc ? 'var(--gdc)' : utilColor(u);
    const wdt = K.dc ? 2 : K.kv >= 66 ? 3.6 : K.kv >= 11 ? 2.8 : 2;
    s += `<g class="gline" data-line="${l.id}"><path d="${d}" fill="none" stroke="transparent" stroke-width="22"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${wdt}" stroke-linecap="round" ${building ? 'stroke-dasharray="2 5"' : down ? 'stroke-dasharray="7 5"' : ''}/>
      <text x="${(mx + cx) / 2}" y="${(my + cy) / 2 - 4}" class="glabel">${K.short}${l.n > 1 ? `×${l.n}` : ''}</text></g>`;
  }
  // 地点
  for (const n of nodes) {
    const plants = g.plants.filter((p) => p.site === n.id);
    const subs = g.subs.filter((x) => x.town === n.id);
    const inc = g.incidents.some((i) => i.town === n.id || plants.some((p) => p.id === i.plant) || subs.some((x) => x.id === i.sub));
    let body = '';
    if (n.town) {
      const open = n.era <= g.era;
      const st = g.last?.towns[n.id];
      const has = g.loads.some((l) => l.town === n.id);
      const fill = !has ? 'var(--card)' : !st || st.d <= 0 ? 'var(--gidle)' : st.r >= 0.999 ? 'var(--glit)' : st.r > 0 ? 'var(--idk-bg)' : 'var(--gdark)';
      body = `<circle cx="${n.x}" cy="${n.y}" r="11" fill="${fill}" stroke="${has ? 'var(--text)' : 'var(--muted)'}" stroke-width="1.6" ${open ? '' : 'stroke-dasharray="2 3" opacity=".5"'}/>
        <path d="M${n.x - 5},${n.y + 4} v-5 l3,-3 l3,3 v5z M${n.x + 1},${n.y + 4} v-8 h4 v8z" fill="${has ? 'var(--text)' : 'var(--muted)'}" opacity="${open ? 0.8 : 0.4}"/>`;
      if (subs.length) body += `<rect x="${n.x + 9}" y="${n.y - 15}" width="10" height="10" rx="2" fill="var(--card)" stroke="${subs.some((x) => x.readyAt <= t && x.downUntil <= t) ? 'var(--gline)' : 'var(--ng)'}" stroke-width="1.5"/><text x="${n.x + 14}" y="${n.y - 7}" class="gmark">変</text>`;
    } else {
      body = `<path d="M${n.x},${n.y - 9} L${n.x + 9},${n.y} L${n.x},${n.y + 9} L${n.x - 9},${n.y}Z" fill="var(--card)" stroke="var(--muted)" stroke-width="1.3" ${plants.length ? '' : 'stroke-dasharray="2 3"'}/>`;
    }
    plants.forEach((p, i) => {
      const D = Gm.PLANTS[p.type];
      const px = n.x - 14 - (i % 2) * 11, py = n.y - 14 + Math.floor(i / 2) * 11;
      const out = g.last?.plants[p.id] || 0;
      const col = p.readyAt > t ? 'var(--muted)' : p.downUntil > t ? 'var(--ng)' : out > 0 ? (D.coal ? 'var(--gcoal)' : 'var(--ghydro)') : 'var(--gidleplant)';
      body += D.coal ? `<rect x="${px - 4.5}" y="${py - 4.5}" width="9" height="9" rx="1.5" fill="${col}" ${p.readyAt > t ? 'opacity=".5"' : ''}/>` : `<path d="M${px - 5},${py + 4.5} L${px},${py - 5} L${px + 5},${py + 4.5}Z" fill="${col}" ${p.readyAt > t ? 'opacity=".5"' : ''}/>`;
    });
    const name = n.name.length > 6 ? [n.name.slice(0, Math.ceil(n.name.length / 2)), n.name.slice(Math.ceil(n.name.length / 2))] : [n.name];
    s += `<g class="gnode" data-node="${n.id}"><circle cx="${n.x}" cy="${n.y}" r="23" fill="transparent"/>${body}
      <text y="${n.y + 23}" class="gname">${name.map((x, i) => `<tspan x="${n.x}" dy="${i ? 9.5 : 0}">${A.esc(x)}</tspan>`).join('')}</text>
      ${inc ? `<circle cx="${n.x + 12}" cy="${n.y + 8}" r="6" fill="var(--ng)"/><text x="${n.x + 12}" y="${n.y + 11}" class="gbang">!</text>` : ''}</g>`;
  }
  return `<svg class="gmap" viewBox="0 0 360 400" role="img" aria-label="島の地図">${s}</svg>`;
}

function statusLine(g) {
  const l = g.last;
  if (!l) return '';
  const black = Object.values(g.black).some((u) => u > g.t);
  const state = black ? '<b class="gneg">全域停電</b>' : l.shed ? '<b class="gneg">負荷遮断</b>' : l.demand - l.served > 0.01 * l.demand ? '<b class="gneg">一部に届いていない</b>' : Math.abs(l.x) > Gm.FREQ.ok ? '<b class="gwarnc">周波数の乱れ</b>' : '<b class="gok">正常</b>';
  const f = g.hz ? ` ・ 周波数 ${(g.hz + l.x).toFixed(2)} Hz` : '';
  return `<p class="small gstatus">いま：需要 ${kw(l.demand)} ・ 届いた ${kw(l.served)} ・ 損失 ${kw(l.loss)}${f} ・ ${state}</p>`;
}

function mapView(g, lc) {
  const ev = g.events.filter((e) => e.until > g.t);
  return {
    html: `${summaryHtml()}
    <section class="card map">
      ${mapSvg(g, lc)}
      ${statusLine(g)}
      <p class="legend"><span><i class="gl-lit"></i>届いている</span><span><i class="gl-dark"></i>停電</span><span><i class="gl-coal"></i>火力</span><span><i class="gl-hydro tri"></i>水力</span><span>点線＝工事中・止まっている</span></p>
    </section>
    ${ev.length ? `<section class="card gev">${ev.map((e) => `<p class="gevrow">${pic(e.key, 'mini')}<span><b>${Gm.EVENTS[e.key].name}</b><small>${Gm.EVENTS[e.key].text}（あと ${Math.ceil((e.until - g.t) / 24)}日）</small></span></p>`).join('')}</section>` : ''}
    <p class="note center">町や地点を押すと、建設や状態の確認ができます。線を押すと、増設や撤去ができます。</p>`,
    bind: () => {
      A.on('[data-sumclose]', 'click', () => {
        summary = null;
        screen('map');
      });
      A.on('[data-node]', 'click', (e) => nodeSheet(e.currentTarget.dataset.node));
      A.on('[data-line]', 'click', (e) => lineSheet(e.currentTarget.dataset.line));
    },
  };
}

// ---- 下から出るパネル ----
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
const refresh = async (again) => {
  await save();
  document.querySelector('.modal.gsheet')?.remove();
  await screen(view);
  again?.();
};
const stateOf = (x, t) => (x.readyAt > t ? `工事中（あと ${x.readyAt - t}時間）` : x.downUntil > t ? `修理中（あと ${x.downUntil - t}時間）` : null);
function plantState(g, p) {
  const t = g.t;
  const out = g.last?.plants[p.id] || 0;
  return stateOf(p, t) || (p.idle ? '休止' : p.hold > t ? '停電からの復旧待ち' : p.on ? `運転中 ${kw(out)}` : p.onAt != null ? `起動中（あと ${Math.max(1, p.onAt - t)}時間）` : '待機');
}
const hazardText = (hs) => (hs.length ? hs.map((h) => Gm.HAZARD[h].name).join('・') : 'なし');
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
  A.startUnit(A.unitSubjectId(unitId), unitId);
}

function nodeSheet(id) {
  const g = G(), lc = learningNow(), t = g.t;
  const n = Gm.nodeOf(g, id);
  const plants = g.plants.filter((p) => p.site === id);
  const subs = g.subs.filter((x) => x.town === id);
  const loads = g.loads.filter((l) => l.town === id);
  const st = g.last?.towns[id];
  const incs = g.incidents.filter((i) => i.town === id || plants.some((p) => p.id === i.plant) || subs.some((x) => x.id === i.sub));
  let h = `<h2>${A.esc(n.name)}${n.town && n.era > g.era ? ' <span class="tag">まだ先の時代の町</span>' : ''}</h2>
    <p class="small">${n.town ? '町' : n.hydro ? `水力の地点（使える水 ${kw(n.hydro)}${n.pond ? '・調整池を作れる' : ''}）` : '石炭火力の用地'} ・ 中央の町から ${Gm.distKm(g, 'T1', id) < 0.5 ? '0' : Gm.distKm(g, 'T1', id).toFixed(1)} km ・ この場所の危険：${hazardText(n.tags)}</p>`;
  if (incs.length) h += `<p class="warn small">事故の対処待ちがあります → <button class="link" data-golist>一覧へ</button></p>`;
  if (n.town) {
    const rep = g.rep[id] ?? 1;
    h += `<h3>需要</h3>${loads.length ? loads.map((l) => `<p class="spread grow"><span>${Gm.LOADS[l.type].name} ${kw(l.kw)}${Gm.LOADS[l.type].pfFixed ? `（力率 ${l.cap ? Gm.LOADS[l.type].pfFixed : Gm.LOADS[l.type].pf}）` : ''}</span>${Gm.LOADS[l.type].pfFixed && !l.cap ? `<button class="btn small" data-cap="${l.id}">進相コンデンサ</button>` : ''}</p>`).join('') : '<p class="small">まだありません</p>'}
      ${st ? `<p class="small">いま ${kw(st.d)} ・ 届いている割合 ${pct(st.r)} ・ 町の信用 ${pct(rep)}${rep < 1 ? '（停電があると下がり、1か月で戻る）' : ''}</p>` : ''}
      <h3>変電所</h3>${subs.length ? subs.map((x) => `<p class="spread grow"><span>変圧器 ${x.mva} MVA ・ ${stateOf(x, t) || `使用率 ${pct(g.last?.subs[id] || 0)}`}</span><button class="btn small" data-rm="sub:${x.id}">撤去</button></p>`).join('') : '<p class="small">なし（11 kV 以上の送電線をつなぐには変電所が要る）</p>'}`;
  }
  h += `<h3>発電所</h3>${plants.length ? plants.map((p) => `<p class="spread grow"><span>${Gm.PLANTS[p.type].short} ${kw(p.kw)}${p.proto ? '（試作）' : ''} ・ ${plantState(g, p)}</span></p>`).join('') : '<p class="small">なし</p>'}
    <div class="gbtns2">
      <button class="btn" data-bplant>発電所を建てる</button>
      <button class="btn" data-bline>ここから線を引く</button>
      ${n.town ? '<button class="btn" data-bsub>変圧器を置く</button>' : ''}
    </div>`;
  sheet(h, ({ onAll, close }) => {
    onAll('[data-golist]', 'click', () => (close(), screen('list')));
    onAll('[data-bplant]', 'click', () => plantDialog(id));
    onAll('[data-bline]', 'click', () => lineDialog(id));
    onAll('[data-bsub]', 'click', () => subDialog(id));
    onAll('[data-cap]', 'click', (e) => capDialog(e.currentTarget.dataset.cap, id));
    onAll('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':'), () => nodeSheet(id)));
  });
}

// 建設の確認：コインが足りるかを見て、建て、台帳に書く
async function pay(q, what, doBuild, after) {
  if (balance() < q.cost) return A.toast(`コインが足りません（あと ${A.num(q.cost - balance())}）`);
  const r = doBuild();
  if (!r.ok) return A.toast(r.why);
  await spend(r.cost, what);
  A.toast(`${what}の工事を始めた（${DEV.on && balance() === Infinity ? '開発者モード：コインは減らない' : `${A.num(r.cost)} コイン`}）`);
  if (A.fx()) A.playNotes([[440, 0], [554.4, 0.08], [659.3, 0.16]]);
  await refresh(after);
}
const quoteHtml = (q) =>
  q.ok
    ? `<p class="gquote"><b>${A.num(q.cost)} コイン</b>（残高 ${coinText(balance())}）・ 工期 ${q.hours != null ? `ゲームの ${q.hours}時間` : 'すぐ'}${q.proto ? '<br><span class="warn">試作：次の時代の設備を先取り。建設費3倍・故障率3倍・効率は下限から</span>' : ''}</p>`
    : whyHtml(q);

function plantDialog(site) {
  const g = G(), lc = learningNow();
  const types = Object.keys(Gm.PLANTS).filter((k) => Gm.siteAllows(g, k, site) && Gm.eraStatus(lc, Gm.PLANTS[k].era) !== 'no');
  if (!types.length) return A.toast('この場所に建てられる発電所は、まだありません');
  let type = types[0], size = Gm.PLANTS[type].sizes[0][0];
  const draw = () => {
    const D = Gm.PLANTS[type];
    const q = Gm.quotePlant(g, lc, { type, kw: size, site });
    const eff = D.coal ? `熱効率 ${(D.eff[0] * 100).toFixed(0)}% → ${(D.eff[1] * 100).toFixed(0)}%（いま ${(Gm.plantEff({ type, proto: q.proto }, lc) * 100).toFixed(1)}%）・起動 ${D.start}時間・最低出力 ${pct(D.min)}` : type === 'ror' ? '燃料なし。出力は川の流量しだい（春 1.3・夏 1.0・秋 0.9・冬 0.6）' : '燃料なし。1日分の水をためて、時間をずらして使う（池＝出力の6時間分）';
    sheet(
      `<h2>発電所を建てる：${A.esc(Gm.nodeOf(g, site).name)}</h2>
      ${pic(type, 'wide')}
      <label class="row"><span>種類</span><select data-type>${types.map((k) => `<option value="${k}" ${k === type ? 'selected' : ''}>${Gm.PLANTS[k].name}${Gm.eraStatus(lc, Gm.PLANTS[k].era) === 'proto' ? '（試作）' : ''}</option>`).join('')}</select></label>
      <label class="row"><span>出力</span><select data-size>${D.sizes.map((s) => `<option value="${s[0]}" ${s[0] === size ? 'selected' : ''}>${kw(s[0])}</option>`).join('')}</select></label>
      <p class="small">${eff} ・ ${D.bs ? 'ブラックスタートできる' : 'ブラックスタートできない'}</p>
      ${q.hz ? '<p class="small">交流の発電機を初めて建てるので、先に周波数を決めます。</p><button class="btn primary gwide" data-hz>周波数を選ぶ</button>' : quoteHtml(q)}
      ${q.ok ? '<button class="btn primary gwide" data-build>建設する</button>' : ''}`,
      ({ q: $, onAll }) => {
        $('[data-type]').onchange = (e) => {
          type = e.target.value;
          size = Gm.PLANTS[type].sizes[0][0];
          draw();
        };
        $('[data-size]').onchange = (e) => {
          size = Number(e.target.value);
          draw();
        };
        onAll('[data-hz]', 'click', () => hzDialog(draw));
        onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
        onAll('[data-build]', 'click', () => pay(q, `${Gm.PLANTS[type].short} ${kw(size)}`, () => Gm.buildPlant(g, lc, { type, kw: size, site })));
      },
    );
  };
  draw();
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
    ({ onAll }) =>
      onAll('[data-hz]', 'click', async (e) => {
        Gm.setHz(G(), Number(e.currentTarget.dataset.hz));
        Gm.addReport(G(), { title: `周波数を ${G().hz} Hz に決めた`, what: 'この島の交流の系統は、これからこの周波数で動く。', units: [] });
        await save();
        after();
      }),
  );
}

function lineDialog(from) {
  const g = G(), lc = learningNow();
  const others = Gm.nodesOf(g).filter((n) => n.id !== from);
  let to = others[0].id, kind = Object.keys(Gm.LINES).find((k) => Gm.eraStatus(lc, Gm.LINES[k].era, Gm.LINES[k].level) === 'ok' && !Gm.LINES[k].dc) || 'dc200', route = 'direct';
  const opts = {};
  const draw = () => {
    const K = Gm.LINES[kind];
    const kinds = Object.keys(Gm.LINES).filter((k) => Gm.eraStatus(lc, Gm.LINES[k].era, Gm.LINES[k].level) !== 'no');
    const q = Gm.quoteLine(g, lc, { a: from, b: to, kind, route, opts });
    const r = { direct: Gm.routeInfo(g, from, to, 'direct'), detour: Gm.routeInfo(g, from, to, 'detour') };
    const cap = K.cap;
    // 送れる量いっぱいを流したときの損失の目安
    const lossFull = Gm.lineLoss(kind, r[route].km, 1, cap) / cap;
    sheet(
      `<h2>線を引く：${A.esc(Gm.nodeOf(g, from).name)} から</h2>
      <label class="row"><span>相手</span><select data-to>${others.map((n) => `<option value="${n.id}" ${n.id === to ? 'selected' : ''}>${A.esc(n.name)}（${Gm.distKm(g, from, n.id).toFixed(1)} km）</option>`).join('')}</select></label>
      <label class="row"><span>種類</span><select data-kind>${kinds.map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${Gm.LINES[k].name}${Gm.eraStatus(lc, Gm.LINES[k].era, Gm.LINES[k].level) === 'proto' ? '（試作）' : ''}</option>`).join('')}</select></label>
      <p class="small">1回線で送れる量 ${kw(cap)} ・ ${A.num(K.cost)} コイン/km ・ いっぱいに流すと損失 ${(lossFull * 100).toFixed(1)}%${lossFull > 0.1 ? '（<b class="gneg">大きい</b>）' : ''}</p>
      ${['direct', 'detour'].map((k) => `<label class="row"><input type="radio" name="route" value="${k}" ${k === route ? 'checked' : ''}><span>${k === 'direct' ? 'まっすぐ' : '回り道（平野まわり）'}<small>${r[k].km.toFixed(1)} km ・ 危険：${hazardText(r[k].hazards)}</small></span></label>`).join('')}
      ${K.dc ? '' : Object.entries(Gm.LINE_OPTS).filter(([, O]) => !O.era || Gm.eraStatus(lc, O.era) === 'ok').map(([k, O]) => `<label class="row"><input type="checkbox" data-opt="${k}" ${opts[k] ? 'checked' : ''}><span>${O.name}<small>${O.hazard ? `${Gm.HAZARD[O.hazard].name}の事故を減らす` : '地絡の事故で止まる時間が短くなる'}（費用 +20%）</small></span></label>`).join('')}
      ${q.ok && q.needSub.length ? `<p class="warn small">${q.needSub.map((x) => Gm.nodeOf(g, x).name).join('・')}に変電所がないと、この線はつながりません（町を押して「変圧器を置く」）。</p>` : ''}
      ${quoteHtml(q)}
      ${q.ok ? '<button class="btn primary gwide" data-build>建設する</button>' : ''}`,
      ({ q: $, onAll }) => {
        $('[data-to]').onchange = (e) => ((to = e.target.value), draw());
        $('[data-kind]').onchange = (e) => ((kind = e.target.value), draw());
        onAll('input[name=route]', 'change', (e) => ((route = e.target.value), draw()));
        onAll('[data-opt]', 'change', (e) => ((opts[e.target.dataset.opt] = e.target.checked), draw()));
        onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
        onAll('[data-build]', 'click', () => pay(q, `${Gm.LINES[kind].short}（${q.km.toFixed(1)} km）`, () => Gm.buildLine(g, lc, { a: from, b: to, kind, route, opts: { ...opts } })));
      },
    );
  };
  draw();
}

function subDialog(town) {
  const g = G(), lc = learningNow();
  let mva = Gm.SUB_SIZES[0];
  const draw = () => {
    const q = Gm.quoteSub(g, lc, { town, mva });
    sheet(
      `<h2>変圧器を置く：${A.esc(Gm.nodeOf(g, town).name)}</h2>
      ${pic('sub', 'wide')}
      <label class="row"><span>容量</span><select data-mva>${Gm.SUB_SIZES.map((m) => `<option value="${m}" ${m === mva ? 'selected' : ''}>${m} MVA（${kw(m * 1000)}）</option>`).join('')}</select></label>
      <p class="small">鉄損は容量の 0.5%（いつも）、銅損は全負荷で 1.5%（負荷率の2乗）。効率がいちばん高いのは負荷率 58% のあたり。120% を超えると故障しやすい。2台まで並べられる（並行運転）。</p>
      ${quoteHtml(q)}
      ${q.ok ? '<button class="btn primary gwide" data-build>建設する</button>' : ''}`,
      ({ q: $, onAll }) => {
        $('[data-mva]').onchange = (e) => ((mva = Number(e.target.value)), draw());
        onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
        onAll('[data-build]', 'click', () => pay(q, `変圧器 ${mva} MVA`, () => Gm.buildSub(g, lc, { town, mva })));
      },
    );
  };
  draw();
}

function capDialog(loadId, back) {
  const g = G(), lc = learningNow();
  const q = Gm.quoteCap(g, lc, loadId);
  sheet(
    `<h2>進相コンデンサ</h2>
    <p class="small">工場の力率を 0.75 から 0.95 に直す。同じ電力でも線を流れる電流が減り、損失と使用率が下がる。</p>
    ${q.ok ? `<p class="gquote"><b>${A.num(q.cost)} コイン</b>（残高 ${coinText(balance())}）</p><button class="btn primary gwide" data-build>付ける</button>` : whyHtml(q)}`,
    ({ onAll }) => {
      onAll('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      onAll('[data-build]', 'click', () => pay(q, '進相コンデンサ', () => Gm.addCap(g, lc, loadId), () => nodeSheet(back)));
    },
  );
}

function removeDialog(kind, id, after) {
  const g = G();
  const x = { plant: g.plants, line: g.lines, sub: g.subs }[kind].find((v) => v.id === id);
  if (!x) return;
  const name = kind === 'plant' ? `${Gm.PLANTS[x.type].short} ${kw(x.kw)}` : kind === 'line' ? Gm.lineName(g, x) : `変圧器 ${x.mva} MVA`;
  sheet(
    `<h2>撤去する</h2>
    <p>${A.esc(name)} を手放しますか。建設費の 30%（${yen(x.cost * 0.3)}）が<b>収益</b>に戻ります（コインは戻りません）。</p>
    <button class="btn gwide gwarn" data-ok>撤去する</button>`,
    ({ onAll }) =>
      onAll('[data-ok]', 'click', async () => {
        Gm.removeAsset(g, kind, id);
        await refresh(after);
      }),
  );
}

function lineSheet(id) {
  const g = G(), lc = learningNow(), t = g.t;
  const l = g.lines.find((x) => x.id === id);
  if (!l) return;
  const K = Gm.LINES[l.kind];
  const f = g.last?.lines[id];
  const hz = Gm.lineHazard(g, l, t, lc);
  const qc = Gm.quoteCircuit(g, lc, id);
  const optNames = Object.keys(l.opts).filter((k) => l.opts[k]).map((k) => Gm.LINE_OPTS[k].name);
  sheet(
    `<h2>${A.esc(Gm.lineName(g, l))}</h2>
    ${pic('line', 'wide')}
    <p class="small">${K.name} ・ ${l.km.toFixed(1)} km（${l.route === 'detour' ? '回り道' : 'まっすぐ'}）・ ${l.n}回線${l.proto ? ' ・ 試作' : ''}</p>
    <p class="small">状態：${stateOf(l, t) || (l.c1Until > t ? `1回線が修理中（あと ${l.c1Until - t}時間）` : '送電中')}${f ? ` ・ 流れ ${kw(f.p)} ・ 使用率 <b class="${f.util > 1 ? 'gneg' : ''}">${pct(f.util)}</b> ・ 損失 ${kw(f.loss)}` : ''}</p>
    <p class="small">危険：${hazardText(l.hazards)} ・ 対策：${optNames.length ? optNames.join('・') : 'なし'} ・ 故障の目安 1日あたり ${(hz.perDay * 100).toFixed(2)}%</p>
    <p class="small">送れる量を超えて 120% までは温度が上がるだけ（故障しやすくなる）。120% を2時間超えると保護装置で切れる。</p>
    <div class="gbtns2">
      <button class="btn" data-circ ${qc.ok ? '' : 'disabled'}>回線を増やす<small>${qc.ok ? `${A.num(qc.cost)} コイン` : A.esc(qc.why)}</small></button>
      <button class="btn" data-rm>撤去</button>
    </div>`,
    ({ onAll }) => {
      onAll('[data-circ]', 'click', () => pay(qc, `${K.short}の回線の増設`, () => Gm.addCircuit(g, lc, id), () => lineSheet(id)));
      onAll('[data-rm]', 'click', () => removeDialog('line', id));
    },
  );
}

// ---- 需給 ----
function supplyView(g, lc) {
  const o = Gm.overview(g, lc);
  const hs = g.hist.slice(-72);
  const W = 340, H = 150;
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
      chart += `<h2 class="gh2">周波数（${g.hz} Hz からのずれ）</h2>
        <svg class="gchart" viewBox="0 0 ${W} ${FH}" role="img" aria-label="周波数のずれ">${band(-Gm.FREQ.ok, Gm.FREQ.ok, 'var(--ok-bg)')}
          <line x1="0" x2="${W}" y1="${FY(-Gm.FREQ.shed1)}" y2="${FY(-Gm.FREQ.shed1)}" stroke="var(--idk)" stroke-dasharray="3 3"/>
          <line x1="0" x2="${W}" y1="${FY(-Gm.FREQ.black)}" y2="${FY(-Gm.FREQ.black)}" stroke="var(--ng)" stroke-dasharray="3 3"/>
          <path d="M${hs.map((h, i) => `${X(i).toFixed(1)},${FY(h[6]).toFixed(1)}`).join(' L')}" fill="none" stroke="var(--text)" stroke-width="1.4"/></svg>
        <p class="legend"><span><i class="gl-okband"></i>±0.2 Hz 以内＝正常</span><span>黄の点線＝−0.8 Hz（負荷遮断）</span><span>赤の点線＝−2.0 Hz（全域停電）</span></p>`;
    } else chart += '<p class="note">直流のあいだは周波数がありません。足りないときは電圧が下がり、電灯が暗くなります。</p>';
  }
  const K = g.last?.K || 0;
  const topOut = Math.max(0, ...g.plants.filter((p) => Gm.PLANTS[p.type].ac).map((p) => g.last?.plants[p.id] || 0));
  return {
    html: `<section class="card">
      <h2>需要と電源（直近 ${hs.length}時間）</h2>
      ${chart}
    </section>
    <section class="card">
      <h2>いまの系統</h2>
      <p class="spread grow"><span>需要の上限（学習で決まる）</span><b>${kw(o.dmax)}</b></p>
      <p class="small">Lv ${lc.level} ・ 定着 ${lc.mastered}問。お金では増えない。レベルと定着で広がる</p>
      <p class="spread grow"><span>受けている需要（契約）</span><b>${kw(o.accepted)}</b></p>
      <p class="spread grow"><span>これから24時間のピーク（予測）</span><b>${kw(o.peak)}</b></p>
      <p class="spread grow"><span>使える発電機の合計</span><b class="${o.cap < o.peak ? 'gneg' : ''}">${kw(o.cap)}</b></p>
      <p class="spread grow"><span>予備力の目標（${pct(g.reserve)}）</span><b>${kw(o.reserveKw)}</b></p>
      ${lc.gate.rel ? `<p class="small">最大の発電機1台分は ${kw(o.biggest)}。${o.reserveKw >= o.biggest ? '1台止まっても埋められる（N-1）' : '<b class="gneg">1台止まると埋めきれない</b>'}</p>` : `<p class="small">電力系統工学「信頼度指標」を1問正解すると、予備力の目安（最大の発電機1台分との比較）が出ます</p>`}
      ${g.hz && K ? `<p class="spread grow"><span>系統定数 K</span><b>${kw(K)}/Hz</b></p><p class="small">Δf＝−ΔP/K。いまいちばん出力の大きい発電機（${kw(topOut)}）が止まると、余裕が足りていれば ${(topOut / K).toFixed(2)} Hz 下がる</p>` : ''}
    </section>`,
  };
}

// ---- 一覧：事故・申し込み・発電所・線と変電所・報告書 ----
function listView(g, lc) {
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
  const plants = order
    .map((p, i) => {
      const D = Gm.PLANTS[p.type];
      const cost = D.coal ? `${(Gm.fuelPrice(g) / Gm.plantEff(p, lc)).toFixed(1)} 円/kWh` : '燃料なし';
      return `<div class="gitem gplant"><span class="gord"><button class="btn small" data-up="${p.id}" ${i === 0 || !lc.gate.econ ? 'disabled' : ''} aria-label="上へ">▲</button><b>${i + 1}</b><button class="btn small" data-down="${p.id}" ${i === order.length - 1 || !lc.gate.econ ? 'disabled' : ''} aria-label="下へ">▼</button></span>
        <span class="gpl"><b>${D.short} ${kw(p.kw)}${p.proto ? '（試作）' : ''}</b><small>${A.esc(Gm.nodeOf(g, p.site).name)} ・ ${plantState(g, p)} ・ ${cost}</small>
        <span><button class="btn small" data-idle="${p.id}">${p.idle ? '休止をやめる' : '休止する'}</button><button class="btn small" data-rm="plant:${p.id}">撤去</button></span></span></div>`;
    })
    .join('');
  const lines = g.lines.map((l) => `<button class="gitem grow2" data-line="${l.id}"><span><b>${A.esc(Gm.lineName(g, l))}</b><small>${l.km.toFixed(1)} km・${l.n}回線 ・ ${stateOf(l, t) || `使用率 ${pct(g.last?.lines[l.id]?.util || 0)}`}</small></span><span class="go">›</span></button>`).join('');
  const subs = g.subs.map((x) => `<div class="gitem"><p class="spread"><b>${A.esc(Gm.nodeOf(g, x.town).name)}の変圧器 ${x.mva} MVA</b><small>${stateOf(x, t) || `使用率 ${pct(g.last?.subs[x.town] || 0)}`}</small></p></div>`).join('');
  const reports = g.reports
    .slice(0, 15)
    .map((r) => `<div class="gitem grep${r.ok === true ? ' ok' : r.ok === false ? ' ng' : ''}"><p class="spread"><b>${A.esc(r.title)}</b><small>${timeLabel({ t: r.t })}</small></p><p class="small">${A.esc(r.what)}${r.why ? `<br>なぜ：${A.esc(r.why)}` : ''}</p>${unitButtons(r.units || [])}</div>`)
    .join('');
  return {
    html: `<section class="card"><h2>事故（対処待ち ${g.incidents.length}／最大 ${Gm.MAX_INCIDENTS}件）</h2>${incs || '<p class="note">いまはありません</p>'}
      <p class="small">正しく対処すると被害が小さく、誤ると大きくなります。ゲームの1日（現実の1時間）答えなければ、標準の被害で片づきます。</p></section>
    <section class="card"><h2>接続の申し込み（${g.apps.length}件）</h2>${apps || `<p class="note">${Gm.overview(g, lc).accepted >= lc.dmax - 1 ? '需要の上限に達しています。レベルと定着が増えると、また届きます' : 'いまはありません（1日に1件ほど届きます）'}</p>`}</section>
    <section class="card"><h2>発電所と給電の優先順位</h2>
      <p class="small">番号の小さい順に使います。${lc.gate.econ ? '▲▼で並べ替え（燃料の安い順にすると得）' : '並べ替えは、電力系統工学「等増分燃料費」を1問正解すると使えます'}。直流の火力は、つないだ町の需要だけを先にまかないます。</p>
      ${!lc.gate.econ ? unitButtons(Gm.GATES.econ) : ''}
      ${plants || '<p class="note">発電所がありません</p>'}</section>
    <section class="card"><h2>送電線・配電線・変電所</h2>${lines + subs || '<p class="note">まだありません（地図で町や地点を押して建てます）</p>'}</section>
    <section class="card"><h2>報告書</h2>${reports || '<p class="note">まだありません</p>'}</section>`,
    bind: () => {
      A.on('[data-inc]', 'click', (e) => incidentScreen(e.currentTarget.dataset.inc));
      A.on('[data-accept]', 'click', async (e) => {
        Gm.acceptApp(g, e.currentTarget.dataset.accept);
        await save();
        screen('list');
      });
      const move = async (id, d) => {
        const i = g.priority.indexOf(id);
        if (i < 0 || i + d < 0 || i + d >= g.priority.length) return;
        [g.priority[i], g.priority[i + d]] = [g.priority[i + d], g.priority[i]];
        await save();
        screen('list');
      };
      A.on('[data-up]', 'click', (e) => move(e.currentTarget.dataset.up, -1));
      A.on('[data-down]', 'click', (e) => move(e.currentTarget.dataset.down, 1));
      A.on('[data-idle]', 'click', async (e) => {
        const p = g.plants.find((x) => x.id === e.currentTarget.dataset.idle);
        p.idle = !p.idle;
        await save();
        screen('list');
      });
      A.on('[data-rm]', 'click', (e) => removeDialog(...e.currentTarget.dataset.rm.split(':')));
      A.on('[data-line]', 'click', (e) => lineSheet(e.currentTarget.dataset.line));
    },
  };
}

// ---- 事故の問題：選択肢4つ。「わからない」は出さない。回答は回答記録（mode「系統」のセッション）に入れる ----
function incidentScreen(id) {
  const { S } = A;
  const g = G();
  const inc = g.incidents.find((x) => x.id === id);
  const q = inc && S.data.questions.find((x) => x.questionId === inc.qid);
  if (!q) return screen('list');
  const order = L.shuffle(q.choices);
  A.show(
    `<header class="top"><button class="back" data-back>‹ 系統</button><h1>事故の対処</h1></header>
    <section class="card gincident"><p class="spread"><b>${A.esc(Gm.INCIDENTS[inc.key].title)}</b><span class="lv lv-${q.level}">${q.level}</span></p><p class="small">${A.esc(inc.what || '')}</p></section>
    ${A.figureHtml(q)}
    <div class="stem">${A.rich(q.stem)}</div>
    <div class="choices">
      ${order.map((c, i) => `<button class="choice" data-choice="${A.esc(c.choiceId)}"><span class="mark">${'ABCD'[i]}</span><span>${A.rich(c.text)}</span></button>`).join('')}
    </div>
    <p class="note center">正しく対処すると被害が小さく、誤ると大きくなります（「わからない」はありません）</p>`,
    () => {
      A.bindFigureZoom();
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
      A.on('[data-report]', 'click', () => A.reportDialog(q));
      A.on('[data-unitgo]', 'click', (e) => goUnit(e.currentTarget.dataset.unitgo));
      A.on('[data-next]', 'click', () => screen('list'));
    },
  );
  await saved;
  await save();
  if (rec) await A.syncCollection();
}

// ---- 設定：予備力の目標・燃料の買い方・点検の方針・学習と設備・記録・新しい島 ----
function settingView(g, lc) {
  const o = Gm.overview(g, lc);
  const gates = Object.keys(Gm.GATES)
    .map((k) => {
      const p = lc.perf[k] || 0;
      return `<p class="spread grow"><span>${lc.gate[k] ? '<span class="tag ok">1問正解</span>' : '<span class="tag">まだ</span>'}${Gm.GATE_NAMES[k]}</span><small>性能 ${pct(p)}</small></p>`;
    })
    .join('');
  const bps = Object.entries(Gm.BLUEPRINTS).map(([k, b]) => `<span class="tag ${lc.blueprint[k] ? 'ok' : ''}">${b.name}${lc.blueprint[k] ? '' : '（まだ）'}</span>`).join('');
  const yr = g.yr;
  const yrow = (y, label) => `<p class="spread grow"><span>${label}</span><small>利益 ${yen(y.profit)} ・ 停電 ${Math.round(y.unserved).toLocaleString('ja-JP')} kWh ・ 周波数が正常 ${y.hours ? pct(y.okH / y.hours) : '—'}</small></p>`;
  const eras = Gm.ERAS.map((e) => `<span class="tag ${e.n <= g.era ? 'ok' : ''}">${e.name} Lv${e.level}${e.n > Gm.MAX_ERA ? '（これから）' : ''}</span>`).join('');
  return {
    html: `<section class="card">
      <h2>予備力の目標</h2>
      <label class="row"><input type="range" min="0" max="30" step="1" value="${Math.round(g.reserve * 100)}" data-reserve><b data-rv>${pct(g.reserve)}</b></label>
      <p class="small">需要のこの割合だけ、発電機の出力に余裕を残す（多いほど安全だが、燃料費は上がる）。いまの目標 ${kw(o.reserveKw)}${lc.gate.rel ? ` ・ 最大の発電機1台分 ${kw(o.biggest)}` : ''}</p>
    </section>
    <section class="card">
      <h2>燃料（石炭）の買い方</h2>
      <label class="row"><input type="radio" name="fuel" value="contract" ${g.fuelPlan === 'contract' ? 'checked' : ''}><span>長期契約<small>値段は固定（いま ${g.fuel.contract.toFixed(2)} 円/kWh・熱）。1年ごとに見直し</small></span></label>
      <label class="row"><input type="radio" name="fuel" value="spot" ${g.fuelPlan === 'spot' ? 'checked' : ''}><span>スポット<small>毎日 ±30% で変わる（今日 ${g.fuel.spot.toFixed(2)}）。平均は長期契約の 0.85 倍</small></span></label>
      <p class="small">燃料費（円/kWh）＝値段 ÷ 熱効率。熱効率は、火力発電の単元の定着で上がる</p>
    </section>
    <section class="card">
      <h2>点検の方針</h2>
      <label class="row"><input type="radio" name="maint" value="normal" ${g.maint !== 'defer' ? 'checked' : ''}><span>ふつうに点検する<small>保守費：1日に建設費の 0.05%</small></span></label>
      <label class="row"><input type="radio" name="maint" value="defer" ${g.maint === 'defer' ? 'checked' : ''}><span>点検を延ばす<small>保守費は半分。故障は 2〜3 倍に増える</small></span></label>
    </section>
    <section class="card">
      <h2>時代と学習</h2>
      <p class="gtags">${eras}</p>
      <p class="small">時代はレベルで進む（いま Lv ${lc.level}）。次の時代の設備は「試作」として先取りできる（建設費3倍・故障率3倍）${g.hz ? ` ・ この島の周波数 ${g.hz} Hz` : ''}</p>
      ${gates}
      <p class="small">関係する単元で1問正解すると、建設できる（使える）ようになる。性能＝その単元の定着の割合（これまでの最大値。下がらない）。熱効率・故障の少なさ・工期に効く</p>
      <h3>設計図</h3><p class="gtags">${bps}</p>
      <p class="small">その単元の試験レベルに正解するか、関係する外部試験で満点の3割以上</p>
    </section>
    <section class="card">
      <h2>記録</h2>
      ${yrow(yr, `${yr.idx + 1}年目（途中）`)}
      ${[...g.years].reverse().map((y) => yrow(y, `${y.idx + 1}年目`)).join('')}
      ${g.best ? `<p class="small">この島の最高の年間利益：${yen(g.best.profit)}</p>` : ''}
      ${(g.past || []).length ? `<h3>前の島</h3>${g.past.map((p) => `<p class="small">島 ${p.islandNo}（${Gm.TERRAINS[p.terrain]?.name || ''}）：${Math.floor(p.hours / 24)}日 ・ 最高の年間利益 ${p.best ? yen(p.best.profit) : '—'} ・ 需要 ${kw(p.peak || 0)}</p>`).join('')}` : ''}
    </section>
    <section class="card">
      <h2>新しい島</h2>
      <p class="small">いつでも、明治の小さな島からやり直せます。時代（レベル）・設計図・性能の上乗せは引き継ぎ、この島の記録は残ります。この島の設備と収益はなくなり、使ったコインは戻りません。</p>
      <button class="btn" data-newisland>新しい島を選ぶ</button>
    </section>
    ${versionHtml()}`,
    bind: () => {
      const rv = document.querySelector('[data-rv]');
      A.on('[data-reserve]', 'input', (e) => (rv.textContent = `${e.target.value}%`));
      A.on('[data-reserve]', 'change', async (e) => {
        g.reserve = Number(e.target.value) / 100;
        await save();
        screen('set');
      });
      A.on('input[name=fuel]', 'change', async (e) => ((g.fuelPlan = e.target.value), await save()));
      A.on('input[name=maint]', 'change', async (e) => ((g.maint = e.target.value), await save()));
      A.on('[data-newisland]', 'click', islandDialog);
      bindVersion();
    },
  };
}

function islandDialog() {
  sheet(
    `<h2>新しい島</h2>
    ${pic('island', 'wide')}
    <p class="warn small">いまの島の設備と収益はなくなります（記録は残ります）。</p>
    ${Object.entries(Gm.TERRAINS).map(([k, T]) => `<button class="btn gwide" data-terrain="${k}">${T.name}<small>${T.desc}</small></button>`).join('')}`,
    ({ onAll }) =>
      onAll('[data-terrain]', 'click', async (e) => {
        const now = Date.now();
        store.setGrid(Gm.newIsland(G(), e.currentTarget.dataset.terrain, now, (now % 2147483647) | 0));
        lcCache = null;
        G().era = learningNow().era;
        summary = null;
        await refresh();
        A.toast('新しい島で、明治から始めます');
        screen('map');
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
    ({ dlg, onAll }) => {
      onAll('[data-loan]', 'click', async () => {
        Gm.rebuildLoan(g);
        Gm.addReport(g, { title: '借入れをした', what: '残高を 0 に戻した。30日間、収入の 20% を返済に回す。', units: [] });
        await refresh();
      });
      onAll('[data-sellgo]', 'click', async () => {
        const sel = [...dlg.querySelectorAll('[data-sell]:checked')].map((x) => x.dataset.sell.split(':'));
        if (!sel.length) return A.toast('手放す設備を選んでください');
        const back = Gm.rebuildSell(g, sel);
        Gm.addReport(g, { title: '設備を手放した', what: `${sel.length}件を手放し、${yen(back)} が収益に戻った。`, units: [] });
        await refresh();
        if (g.rebuild) A.toast('まだ残高がマイナスです');
      });
    },
  );
}

// ---- 開発者モード（1.5.1）：バージョン番号を5回押すと入る。本番とは別の系統（kv「gridDev」）で動かす ----
function versionHtml() {
  return `<p class="note center"><button class="link gver" data-ver>版 ${A.esc(window.APP_VERSION || '')}</button></p>`;
}
function bindVersion() {
  A.on('[data-ver]', 'click', () => {
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
  Gm.applyLearning(G(), learningNow());
  delete G().eraUp;
  await save();
  A.toast('開発者モードに入った');
  screen(view);
}
async function exitDev() {
  if (DEV.running) return A.toast('早送りの途中です');
  await save();
  DEV.on = false;
  summary = null;
  document.querySelector('.modal.gsheet')?.remove();
  await sync();
  A.toast('本番の系統に戻った');
  screen(view);
}
function devBand() {
  if (!DEV.on) return '';
  const o = DEV.state.opts;
  return `<div class="gdevband"><span><b>開発者モード</b><small>（本番の記録には影響しません）</small></span>
    <span class="gdevbtns"><button class="btn small" data-devops>${o.speed ? `×${o.speed}` : '停止中'} ・ 操作</button><button class="btn small" data-devout>抜ける</button></span></div>`;
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
  if (idle()) screen(view);
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
        await screen(view);
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
        screen(view);
      });
      onAll('[data-evgo]', 'click', async () => {
        const r = Dv.triggerEvent(G(), learningNow(), $('[data-evkey]').value);
        await save();
        A.toast(r.ok ? '出来事を起こした' : r.why);
        if (r.ok) (close(), screen(view));
      });
      onAll('[data-devreset]', 'click', async (e) => {
        const g2 = Dv.freshGrid(Date.now(), e.currentTarget.dataset.devreset);
        g2.era = learningNow().era;
        store.setGrid(g2);
        DEV.state.money = [];
        summary = null;
        await save();
        close();
        A.toast(`開発者の系統を最初から（${Gm.TERRAINS[g2.terrain].name}）`);
        screen('map');
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
  await screen(view);
  devSheet();
}
