// 動く系統の開発者モード（1.5.1）。画面に依存しない部分（テストできるように分けた）
// 本番とは別の系統（kv「gridDev」）で動かし、本番の kv「grid」・回答記録・コイン（gachaLog）・称号などには一切書かない
import * as Gm from './grid.js';
import { GRID_SUBJECT } from './logic.js';

export const DEV_KEY = 'gridDev';
// 1.5.3 デモ：問題データなしで動く系統を試す（Gemini のリモートブラウザでのレビュー用）。開発者モードと同じ仕組みで、kv「gridDemo」に保存する
export const DEMO_KEY = 'gridDemo';
// URL に ?demo（?demo=1、?x=1&demo など）が付いていれば、デモから始める
export const wantsDemo = (search) => new URLSearchParams(search || '').has('demo');
// デモの学習の状況の元：何も学習していない状態に、事故の問題の一覧だけ入れる（問題データがなくても事故が起きるように）
export const DEMO_QIDS = [...new Set(Object.values(Gm.INCIDENTS).flatMap((D) => D.q.map((q) => `${GRID_SUBJECT}-${q}`)))];
export const demoBase = () => Gm.blankLearning({ incidentQs: new Set(DEMO_QIDS) });
// デモの事故の問題がないとき：その事故だけを標準の被害で片づける（期限が来たときと同じ扱い）
export function settleIncident(G, id) {
  const i = G.incidents.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [inc] = G.incidents.splice(i, 1);
  Gm.addReport(G, { title: Gm.INCIDENTS[inc.key].title, what: `${inc.what || ''}標準の被害で片づいた（デモ）。`, units: Gm.INCIDENTS[inc.key].units });
  return true;
}
export const SPEEDS = [0, 1, 10, 100]; // 一時停止・×1・×10・×100
export const JUMPS = { day: 24, week: 24 * 7, year: 24 * Gm.YEAR_DAYS }; // 1年＝16,128 刻み

export function defaultOpts() {
  return {
    coins: 'unlimited', // unlimited：建てても減らない／limited：開発者モードだけの残高（devCoins）から引く
    devCoins: 0,
    ignoreGates: true, // 学習の条件（gate・設計図）をすべて開く
    perf: null, // 性能の単元の定着の割合（0〜1）。null＝本番の記録のまま
    level: null, // レベル（null＝本番の記録のまま）
    era: null, // 時代 1〜4（null＝レベルから）
    mastered: null, // 定着の問題数（null＝本番の記録のまま）
    speed: 1,
  };
}
export function newDevState(nowMs, terrain = 'standard') {
  return { v: 1, grid: freshGrid(nowMs, terrain), opts: defaultOpts(), money: [] };
}
export function freshGrid(nowMs, terrain = 'standard', seed = (nowMs % 2147483647) | 0) {
  return Gm.newGrid(seed, nowMs, { terrain });
}
// kv から読んだ値を整える（古い形・壊れた形でも動くように）
export function normalize(state, nowMs) {
  if (!state || !state.grid) return newDevState(nowMs);
  return { v: 1, grid: state.grid, opts: { ...defaultOpts(), ...(state.opts || {}) }, money: Array.isArray(state.money) ? state.money : [] };
}

const all = (o, v) => Object.fromEntries(Object.keys(o).map((k) => [k, v]));
// 学習の状況の差し替え：blankLearning を元に、選んだレベル・時代・定着数・性能と、gate・設計図を入れる
// real：本番の記録から計算した学習の状況（事故の問題の一覧 incidentQs はここから受け取る）
export function devLearning(real, opts) {
  const level = Math.max(1, Math.round(opts.level ?? real.level));
  const mastered = Math.max(0, Math.round(opts.mastered ?? real.mastered));
  const era = Math.min(Gm.MAX_ERA, Math.max(1, opts.era ?? Gm.eraOf(level)));
  return Gm.blankLearning({
    level,
    era,
    mastered,
    dmax: Gm.dmaxKw(level, mastered),
    gate: opts.ignoreGates ? all(Gm.GATES, true) : { ...real.gate },
    blueprint: opts.ignoreGates ? all(Gm.BLUEPRINTS, true) : { ...real.blueprint },
    perf: opts.perf != null ? all(Gm.PERF, Math.min(1, Math.max(0, opts.perf))) : { ...real.perf },
    incidentQs: real.incidentQs,
  });
}

// 1刻みずつ進める（開いている間と同じ扱い：期限の来た事故は標準の被害で片づく）。money：1日の収益の内訳の記録（直近24刻み）
export function advance(G, lc, n, money = null) {
  if (lc.era < G.era) G.era = lc.era; // 開発者モードでは時代を戻せる
  Gm.applyLearning(G, lc);
  for (let i = 0; i < n; i++) {
    const a = G.acc;
    const b = { rev: a.rev, fuel: a.fuel, maint: a.maint, repair: a.repair, loan: a.loan };
    const t = G.t;
    Gm.step(G, lc);
    Gm.expireIncidents(G);
    if (money) {
      const c = G.acc; // takeSummary で空になっていても、差を取れば1刻み分になる
      money.push({ t, rev: c.rev - b.rev, fuel: c.fuel - b.fuel, maint: c.maint - b.maint, repair: c.repair - b.repair, loan: c.loan - b.loan });
      if (money.length > 24) money.splice(0, money.length - 24);
    }
  }
  return n;
}
// 長く進める（1年など）：区切りごとに一息ついて、進み具合を知らせる。cancel() が true を返したら止める
export async function run(G, lc, n, { chunk = 400, onProgress, money, cancel } = {}) {
  let done = 0;
  while (done < n) {
    if (cancel?.()) break;
    const k = Math.min(chunk, n - done);
    advance(G, lc, k, money);
    done += k;
    onProgress?.(done, n);
    await new Promise((r) => setTimeout(r, 0));
  }
  return done;
}
// 現実の時刻に合わせて進める刻みの数（速さ ×1 で本番と同じ。一時停止なら進めない）
export function dueSteps(G, nowMs, speed) {
  if (!(speed > 0)) {
    G.realAt = nowMs;
    return 0;
  }
  const per = Gm.HOUR_MS / speed;
  let n = Math.floor((nowMs - G.realAt) / per);
  if (n <= 0) return 0;
  if (n > Gm.MAX_CATCHUP) {
    n = Gm.MAX_CATCHUP;
    G.realAt = nowMs;
  } else G.realAt += n * per;
  return n;
}

// 1日の収益の内訳（直近24刻み）
export function moneyDay(money) {
  const s = { hours: money.length, rev: 0, fuel: 0, maint: 0, repair: 0, loan: 0 };
  for (const m of money) for (const k of ['rev', 'fuel', 'maint', 'repair', 'loan']) s[k] += m[k];
  s.profit = s.rev - s.fuel - s.maint - s.repair - s.loan;
  return s;
}

// ---- 事故・出来事をすぐ起こす ----
// 事故の対象（発電所・線・変電所・町）を選ぶ。故障の事故は、本当に止めて標準の被害を入れる（ふだんの故障と同じ形）
const LINE_KEYS = { salt: 'coast', gallop: 'snow', lightning: 'thunder', backFlash: 'thunder', arc: null, lineOver: null };
const PLANT_KEYS = ['parallelIn', 'genTrip', 'genShort'];
const SUB_KEYS = ['trLoss', 'trParallel', 'trShare'];
const TOWN_KEYS = ['dcDrop', 'factoryPf', 'motor'];
// tag：事故の文に添える呼び名（開発者モード／デモ）
export function triggerIncident(G, lc, key, tag = '開発者モード') {
  if (!Gm.INCIDENTS[key]) return { ok: false, why: '事故の種類がない' };
  if (key === 'drought') {
    const e = Gm.evOn(G, 'drought');
    if (!e) {
      G.cool.drought = 0;
      Gm.startEvent(G, lc, 'drought'); // 水力があれば、渇水の事故も一緒に起きる
    }
    if (!G.incidents.some((i) => i.key === 'drought')) {
      G.cool.drought = 0;
      Gm.raise(G, lc, 'drought', { what: '渇水で水力の出力が 4 割まで落ちた。', cool: 1 });
    }
    return done(G, key);
  }
  const t = G.t;
  const info = { cool: 1 };
  if (key in LINE_KEYS) {
    const hz = LINE_KEYS[key];
    const lines = G.lines.filter((l) => l.readyAt <= t && Gm.lineCircuits(l, t) > 0);
    const l = lines.find((x) => hz && x.hazards.includes(hz)) || lines[0];
    if (l) {
      info.line = l.id;
      const name = Gm.lineName(G, l);
      if (key === 'lineOver') info.what = `${name}の使用率が 120% を超えた（${tag}）。`;
      else {
        const dur = 24;
        const cost = l.cost * 0.05;
        const circuit = Gm.lineCircuits(l, t) >= 2;
        if (circuit) l.c1Until = t + dur;
        else l.downUntil = t + dur;
        G.yen -= cost;
        Object.assign(info, { dur, cost, circuit, what: `${name}が止まった（${tag}。${circuit ? '1回線' : '全回線'}）。` });
      }
    }
  } else if (PLANT_KEYS.includes(key)) {
    const p = G.plants.find((x) => Gm.PLANTS[x.type].ac && x.readyAt <= t && x.downUntil <= t) || G.plants.find((x) => x.readyAt <= t);
    if (p) {
      info.plant = p.id;
      const name = `${Gm.nodeOf(G, p.site).name}の${Gm.PLANTS[p.type].short}（${Gm.fmtKw(p.kw)}）`;
      if (key === 'parallelIn') info.what = `${name}を、系統に並列投入する（${tag}）。`;
      else {
        const dur = 48;
        const cost = p.cost * 0.05;
        p.on = false;
        p.onAt = null;
        p.downUntil = t + dur;
        G.yen -= cost;
        Object.assign(info, { dur, cost, what: `${name}が故障で止まった（${tag}）。` });
      }
    }
  } else if (SUB_KEYS.includes(key)) {
    const s = G.subs[0];
    if (s) Object.assign(info, { sub: s.id, what: `${Gm.nodeOf(G, s.town).name}の変電所から報告が来た（${tag}）。` });
  } else if (TOWN_KEYS.includes(key)) {
    const town = G.loads[0]?.town || 'T1';
    Object.assign(info, { town, what: `${Gm.nodeOf(G, town).name}で起きた（${tag}）。` });
  }
  info.what ||= `${tag}で起こした。`;
  G.cool[key] = 0;
  const inc = Gm.raise(G, lc, key, info);
  if (!inc) return { ok: false, why: '事故の問題（系統の事故.json）が読み込まれていない' };
  return { ok: true, inc };
}
const done = (G, key) => ({ ok: true, inc: G.incidents.find((i) => i.key === key) || null });
export function triggerEvent(G, lc, key) {
  if (!Gm.EVENTS[key]) return { ok: false, why: '出来事の種類がない' };
  const e = Gm.evOn(G, key);
  if (e) return { ok: false, why: `${Gm.EVENTS[key].name}は、もう起きている` };
  Gm.startEvent(G, lc, key);
  return { ok: true };
}

// ---- 書き込み先（本番／開発者モード）。画面からの書き込みはすべてここを通す ----
// db：putKV・saveAnswer・put を持つもの。S：アプリの状態（S.grid・S.gacha・S.logs など）。dev：{ on, state, key }
// key：別の系統を保存する kv の名前（開発者モード「gridDev」、1.5.2 のチュートリアルの練習の島「gridTutorial」）
export function makeStore(db, S, dev) {
  const key = () => dev.key || DEV_KEY;
  return {
    grid: () => (dev.on ? dev.state.grid : S.grid),
    setGrid: (g) => (dev.on ? (dev.state.grid = g) : (S.grid = g)),
    save: () => (dev.on ? db.putKV(key(), dev.state) : db.putKV('grid', S.grid)),
    // コインの残高。開発者モードでは本番のコインを使わない
    balance: (real) => (!dev.on ? real : dev.state.opts.coins === 'unlimited' ? Infinity : dev.state.opts.devCoins),
    async spend(coins, what, entry) {
      if (dev.on) {
        if (dev.state.opts.coins !== 'unlimited') dev.state.opts.devCoins = Math.max(0, dev.state.opts.devCoins - coins);
        return db.putKV(key(), dev.state);
      }
      S.gacha.push({ ...entry, kind: 'grid', cardId: null, paid: 'coin', coins, what });
      return db.putKV('gachaLog', S.gacha);
    },
    // 事故の問題の回答：開発者モードでは回答記録・復習状態・セッションに残さない（正誤だけをゲームに反映する）
    async answer({ log, state, session }) {
      if (dev.on) return false;
      S.logs.push(log);
      S.states[log.questionId] = state;
      await db.saveAnswer(log, state);
      await db.put('sessions', session);
      return true;
    },
  };
}
