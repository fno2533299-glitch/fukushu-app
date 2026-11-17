// 動く系統の画面のうち、画面に依存しない部分（1.5.2。テストできるように分けた）
// 地点のメニュー（SAO 風）の項目と位置の計算、したことの表示の文、工事の完成の見つけ方、チュートリアルの手順と練習の島
// 地点・手順はデータなので、1.6.0（日本列島）では中身を差し替えるだけでよい
import * as Gm from './grid.js';
import * as J from './gridjapan.js';

const eraName = (n) => Gm.ERAS[Math.min(n, Gm.ERAS.length) - 1].name;
const gateText = (keys) => `「${keys.map((k) => Gm.GATE_NAMES[k]).join('」「')}」の単元で、まだ1問も正解していない`;

// 種類ごとの「建てられるか」（場所によらない条件：時代・学習の単元・設計図）。kind：plant・line・sub
export function typeStatus(lc, kind, key) {
  const D = kind === 'plant' ? Gm.PLANTS[key] : kind === 'line' ? Gm.LINES[key] : Gm.TR;
  const level = kind === 'line' ? D.level || 0 : 0;
  const st = Gm.eraStatus(lc, D.era, level);
  if (st === 'no') return { ok: false, era: true, why: `まだ先の時代の設備（${eraName(D.era)}${level ? `・Lv${level}` : ''}から）` };
  const miss = (D.gates || []).filter((k) => !lc.gate[k]);
  if (miss.length) return { ok: false, why: gateText(miss), gates: miss };
  if (D.blueprint && !lc.blueprint[D.blueprint]) return { ok: false, why: `設計図「${Gm.BLUEPRINTS[D.blueprint].name}」がない（試験レベルに正解するか、関係する外部試験で満点の3割以上）`, blueprint: D.blueprint };
  return { ok: true, proto: st === 'proto' };
}

// ---- 地点のメニューの項目 ----
// メニューに出す短い名前（丸いボタンの横の文字）
export const SHORT = { dcCoal: '直流の火力', acCoal: '石炭火力', bigCoal: '大型火力', ror: '水力 流れ込み', pond: '水力 調整池', tr: '変圧器' };
// その地点で建てられる種類（時代が先すぎるものは出さない。学習の条件を満たさないものは灰色 ok: false）
export function buildChoices(g, lc, id) {
  const n = Gm.nodeOf(g, id);
  const out = [];
  for (const [k, D] of Object.entries(Gm.PLANTS)) {
    if (!Gm.siteAllows(g, k, id)) continue;
    const st = typeStatus(lc, 'plant', k);
    if (st.era) continue;
    out.push({ kind: 'plant', key: k, name: SHORT[k] || D.short, st });
  }
  if (n.town) {
    const st = typeStatus(lc, 'sub', 'tr');
    if (!st.era) out.push({ kind: 'sub', key: 'tr', name: SHORT.tr, st });
  }
  return out;
}
// その地点から引ける線の種類（直流は町と町の間だけ）
export function lineChoices(g, lc, id) {
  const n = Gm.nodeOf(g, id);
  const out = [];
  for (const [k, K] of Object.entries(Gm.LINES)) {
    if (K.dc && !n.town) continue;
    const st = typeStatus(lc, 'line', k);
    if (st.era) continue;
    out.push({ kind: 'line', key: k, name: K.short, st });
  }
  return out;
}
// その地点で撤去できる設備（発電所・変圧器）
export function removables(g, id) {
  return [
    ...g.plants.filter((p) => p.site === id).map((p) => ({ kind: 'plant', id: p.id, name: `${Gm.PLANTS[p.type].short} ${Gm.fmtKw(p.kw)}` })),
    ...g.subs.filter((s) => s.town === id).map((s) => ({ kind: 'sub', id: s.id, name: `変圧器 ${s.mva} MVA` })),
  ];
}
export function incidentsAt(g, id) {
  const plants = new Set(g.plants.filter((p) => p.site === id).map((p) => p.id));
  const subs = new Set(g.subs.filter((s) => s.town === id).map((s) => s.id));
  return g.incidents.filter((i) => i.town === id || plants.has(i.plant) || subs.has(i.sub));
}
// 地点を押したときのメニュー：建設・線を引く・詳細・撤去・事故（あるものだけ）
export function nodeMenu(g, lc, id) {
  const items = [];
  if (buildChoices(g, lc, id).length) items.push({ k: 'build', label: '建設', branch: true });
  if (lineChoices(g, lc, id).length) items.push({ k: 'line', label: '線を引く', branch: true });
  items.push({ k: 'detail', label: '詳細' });
  const rm = removables(g, id);
  if (rm.length) items.push({ k: 'rm', label: '撤去', branch: rm.length > 1 });
  if (incidentsAt(g, id).length) items.push({ k: 'inc', label: '事故', alert: true });
  return items;
}
// 線を押したときのメニュー（線の中ほど）：回線の増設・詳細・撤去
export function lineMenu() {
  return [
    { k: 'circ', label: '回線の増設' },
    { k: 'detail', label: '詳細' },
    { k: 'rm', label: '撤去' },
  ];
}
// 枝分かれの中身
export function branchItems(g, lc, sel, k) {
  if (k === 'build') return buildChoices(g, lc, sel.id).map((c) => ({ ...c, b: `${c.kind}:${c.key}`, ok: c.st.ok }));
  if (k === 'line') return lineChoices(g, lc, sel.id).map((c) => ({ ...c, b: `line:${c.key}`, ok: c.st.ok }));
  if (k === 'rm') return removables(g, sel.id).map((r) => ({ ...r, b: `rm:${r.kind}:${r.id}`, ok: true }));
  return [];
}

// ---- メニューの位置（画面からはみ出さない） ----
// 押す場所は 44pt 以上（丸いボタン 48px）。文字はボタンの外側に置く
export const MENU = { btn: 48, gap: 8, minGap: 2, labelW: 84, off: 30, margin: 8, colGap: 12 };
export const colWidth = (m = MENU) => m.btn + 6 + m.labelW;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 縦に並べる：中心 cy のまわりに n 個。画面の上下からはみ出す分はずらし、それでも入らなければ間を詰める
function stack(cy, n, h, m) {
  const avail = h - 2 * m.margin;
  let gap = m.gap;
  if (n > 1 && n * m.btn + (n - 1) * gap > avail) gap = Math.max(m.minGap, (avail - n * m.btn) / (n - 1));
  const H = n * m.btn + (n - 1) * gap;
  const y0 = H > avail ? m.margin : clamp(cy - H / 2, m.margin, h - m.margin - H);
  return Array.from({ length: n }, (_, i) => y0 + i * (m.btn + gap));
}
// 1列を置く。side：'r'（列の左に丸、右に文字）／'l'（列の右に丸、左に文字）
function column(x0, side, ys, w, m) {
  const W = colWidth(m);
  const x = clamp(x0, m.margin, w - m.margin - W);
  return { x, w: W, side, items: ys.map((y) => ({ x, y, w: W, h: m.btn, cx: side === 'r' ? x + m.btn / 2 : x + W - m.btn / 2, cy: y + m.btn / 2 })) };
}
// 地点（anchor：メニューの層の中の座標）の横にメニューを出す。右に入らなければ左（画面の右寄りの地点）
export function placeMenu(anchor, n, box, m = MENU) {
  const W = colWidth(m);
  const roomR = box.w - m.margin - (anchor.x + m.off);
  const roomL = anchor.x - m.off - m.margin;
  const side = roomR >= W || roomR >= roomL ? 'r' : 'l';
  const x0 = side === 'r' ? anchor.x + m.off : anchor.x - m.off - W;
  return { anchor, ...column(x0, side, stack(anchor.y, n, box.h, m), box.w, m) };
}
// 枝分かれ：メニューの i 番目のボタンから、さらに外側へ。外側に入らなければ地点の反対側、どちらも入らなければ外側に寄せる
export function placeBranch(menu, i, n, box, m = MENU) {
  const W = colWidth(m);
  const from = menu.items[i];
  const ys = stack(from.cy, n, box.h, m);
  const out = menu.side === 'r' ? menu.x + W + m.colGap : menu.x - m.colGap - W;
  const fits = (x) => x >= m.margin && x + W <= box.w - m.margin;
  if (fits(out)) return { from, ...column(out, menu.side, ys, box.w, m) };
  const a = menu.anchor;
  const opp = menu.side === 'r' ? a.x - m.off - W : a.x + m.off;
  const oside = menu.side === 'r' ? 'l' : 'r';
  if (fits(opp)) return { from, ...column(opp, oside, ys, box.w, m) };
  return { from, ...column(out, menu.side, ys, box.w, m) };
}
// カード（見積もり・詳細）を出す側：選んだ地点と反対の側（上か下）。ys：選んだ地点の y（複数なら平均）
export function cardSide(ys, h) {
  if (!ys.length) return 'bottom';
  const y = ys.reduce((a, b) => a + b, 0) / ys.length;
  return y > h / 2 ? 'top' : 'bottom';
}

// ---- 地点名の改行（1.6.0。Gemini の UIレビュー 7番）----
// 6 文字までは1行。長い名前は、切れ目の候補（「の」の後ろ、「・」「（」の前）のうち真ん中に近いところで2行に。候補がなければ1行のまま
export function splitName(name, max = 6) {
  const s = String(name || '');
  if (s.length <= max) return [s];
  const cuts = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1] === 'の' || s[i] === '・' || s[i] === '（') cuts.push(i);
  }
  if (!cuts.length) return [s];
  const mid = s.length / 2;
  const i = cuts.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  return [s.slice(0, i), s.slice(i)];
}

// ---- したことの表示の文 ----
export function hoursText(h) {
  h = Math.max(0, Math.round(h));
  if (h < 24) return `${h}時間`;
  if (h % 24 === 0) return `${h / 24}日`;
  return `${Math.floor(h / 24)}日と${h % 24}時間`;
}
const yenText = (v) => `${Math.round(v).toLocaleString('ja-JP')} 円`;
const pctText = (v) => `${Math.round(v * 100)}%`;
const nodeName = (g, id) => Gm.nodeOf(g, id)?.name || id;
const plantText = (p) => `${SHORT[p.type] || Gm.PLANTS[p.type].short}（${Gm.fmtKw(p.kw)}）`;
const FUEL = { contract: '長期契約', spot: 'スポット' };
const MAINT = { normal: 'ふつうに点検する', defer: '点検を延ばす' };
// kind ごとの文。x：対象（発電所・線・変圧器・需要・申し込みなど）
export function actText(g, kind, x = {}) {
  switch (kind) {
    case 'buildPlant':
      return `${nodeName(g, x.site)}に${plantText(x)}の建設を始めた（完成まであと${hoursText(x.readyAt - g.t)}）`;
    case 'buildLine':
      return `${nodeName(g, x.a)}〜${nodeName(g, x.b)}に${Gm.LINES[x.kind].short}（${x.km.toFixed(1)} km）の線の建設を始めた（開通まであと${hoursText(x.readyAt - g.t)}）`;
    case 'buildSub':
      return `${nodeName(g, x.town)}に変圧器（${x.mva} MVA）の設置を始めた（完成まであと${hoursText(x.readyAt - g.t)}）`;
    case 'donePlant':
      return `${nodeName(g, x.site)}の${plantText(x)}が完成した`;
    case 'doneLine':
      return `${Gm.lineName(g, x)}が開通した`;
    case 'doneSub':
      return `${nodeName(g, x.town)}の変圧器（${x.mva} MVA）が使えるようになった`;
    case 'remove':
      return `${x.name}を撤去した（収益に ${yenText(x.back)} 戻った）`;
    case 'circuit':
      return `${Gm.lineName(g, x)}の回線を増やした（${x.n}回線）`;
    case 'cap':
      return `${nodeName(g, x.town)}の工場に進相コンデンサを付けた（力率 0.95）`;
    case 'incident':
      return `事故「${x.title}」：${x.settled ? '標準の被害で片づけた' : x.correct ? '正しく対処した' : '対処を誤った'}${x.text ? `。${x.text}` : ''}`;
    case 'accept':
      return `${nodeName(g, x.town)}の${Gm.LOADS[x.type].name}（${Gm.fmtKw(x.kw)}）の申し込みを受けた`;
    case 'hold':
      return `${nodeName(g, x.town)}の${Gm.LOADS[x.type].name}（${Gm.fmtKw(x.kw)}）の申し込みを保留した（いつでも受けられる）`;
    case 'reserve':
      return `予備力の目標を ${pctText(x.value)} にした`;
    case 'fuel':
      return `燃料の買い方を「${FUEL[x.value]}」にした`;
    case 'maint':
      return `点検の方針を「${MAINT[x.value]}」にした`;
    case 'priority':
      return `給電の優先順位を変えた（1番目：${x.first ? `${nodeName(g, x.first.site)}の${plantText(x.first)}` : 'なし'}）`;
    case 'idle':
      return `${nodeName(g, x.site)}の${plantText(x)}を${x.idle ? '休止した' : '動かせるようにした'}`;
    case 'hz':
      return `周波数を ${x.value} Hz に決めた`;
    case 'loan':
      return '経営再建：借入れをした（30日間、収入の 20% を返済に回す）';
    case 'sell':
      return `経営再建：設備を${x.count}件手放した（収益に ${yenText(x.back)} 戻った）`;
    case 'island':
      if (x.terrain === 'japan') return `別の地方から始めた（日本列島の${J.startOf(x.start)?.label || nodeName(g, x.start)}から、明治から）`;
      return `新しい島（${Gm.TERRAINS[x.terrain].name}）で、明治から始めた`;
    default:
      return '';
  }
}

// ---- 工事の完成を見つける（開いている間に完成したら帯で知らせる） ----
// 工事中の設備の id の集まり
export function underWork(g) {
  const s = new Set();
  for (const x of [...g.plants, ...g.lines, ...g.subs]) if (x.readyAt > g.t) s.add(x.id);
  return s;
}
// 前に工事中だったもののうち、完成したもの。[{ kind: 'plant'|'line'|'sub', x }]
export function finished(g, before) {
  const out = [];
  const add = (kind, list) => list.forEach((x) => before.has(x.id) && x.readyAt <= g.t && out.push({ kind, x }));
  add('plant', g.plants);
  add('line', g.lines);
  add('sub', g.subs);
  return out;
}
export const doneText = (g, f) => actText(g, { plant: 'donePlant', line: 'doneLine', sub: 'doneSub' }[f.kind], f.x);

// ---- チュートリアル（案内の文字だけ。押す場所だけを明るくする） ----
// 練習の島は本番とは別の系統（kv「gridTutorial」）。コインは練習用、学習は「直流の配電だけ1問正解」の扱い（灰色の種類を見せるため）
// 1.6.0：練習の島を「練習の東京」に（日本列島の東京。日本橋（茅場町）から京橋・銀座へ）
export const TUT_KEY = 'gridTutorial';
export const TUT_SEEN = 'gridTutorialSeen';
export const TUT_COINS = 20000;
export const TUT_HOME = J.TOKYO; // 日本橋（茅場町）
export const TUT_NEXT = 'tk-kyobashi'; // 京橋・銀座（線を引く先）
export function tutorialGrid(nowMs) {
  const g = Gm.newJapan(20261115, nowMs);
  // 最初の発電所はなし（自分で建てて町を灯す）
  g.plants = [];
  g.priority = [];
  return g;
}
export function tutorialState(nowMs) {
  return { v: 1, grid: tutorialGrid(nowMs), opts: { coins: 'limited', devCoins: TUT_COINS, speed: 0 }, money: [], step: 0 };
}
export function tutorialLearning(real) {
  return Gm.blankLearning({ gate: { ...Object.fromEntries(Object.keys(Gm.GATES).map((k) => [k, false])), dc: true }, incidentQs: real?.incidentQs || new Set() });
}
// 本番の系統が、まだ始めたばかりか（チュートリアルをすぐ出す人）
export function isFreshGrid(g) {
  return !!g && g.islandNo === 1 && !g.lines.length && !g.subs.length && g.plants.every((p) => p.id === 'P1') && g.loads.length <= 1 && g.t < 24 * 3;
}

// 手順：target＝明るくする場所（CSS のセレクタ。なければ画面の真ん中に吹き出しだけ）、text＝吹き出しの文、
// on＝この出来事で次へ（画面から tutEvent で知らせる）、next＝「次へ」のボタン（文字を変えるときは文字列）、
// before／after＝手順の前後にすること（練習の島の時間をとばす・申し込みを出す・事故を起こす など）、need＝この条件がなければとばす
export const TUTORIAL = [
  { id: 'intro', text: '練習の東京で、動く系統の動かし方をひととおり試します。本番の系統・コイン・記録は変わりません。', next: '始める' },
  { id: 'hud', target: '[data-hud]', text: '上の帯：時代と日付・状態、コイン（建設に使う）・収益（円）・需要と届いた量・周波数。押すと需給のくわしい画面が開きます。', next: true },
  { id: 'town', target: `[data-node="${TUT_HOME}"]`, text: '日本橋（茅場町）には電灯の需要がありますが、発電所がありません。町を押してみましょう。', on: `menu:${TUT_HOME}` },
  { id: 'build', target: '[data-mi="build"]', text: '地点の横にメニューが出ました。「建設」を押します。', on: 'branch:build' },
  { id: 'dc', target: '[data-mb="plant:dcCoal"]', text: 'この地点に建てられる種類が並びます。「直流の火力」を押します。', on: 'bmode:plant' },
  { id: 'size', target: '[data-bcard]', text: '大きさで費用と工期が変わります。あとで京橋・銀座にも送るので 50 kW にして「建設する」。', on: 'built:plant' },
  { id: 'work', target: `[data-node="${TUT_HOME}"]`, text: 'コインが減り、町に工事の印が出ました。本番では完成を待ちます。ここでは時間をとばします。', next: 'とばす（完成まで）', after: 'skipWork' },
  { id: 'lit', target: `[data-node="${TUT_HOME}"]`, before: 'toEvening', text: '完成して夜になり、町が灯りました（黄色）。足りないと暗い色になります。', next: true },
  { id: 'line1', target: `[data-node="${TUT_HOME}"]`, text: '次は京橋・銀座へ線を引きます。もう一度、日本橋を押します。', on: `menu:${TUT_HOME}` },
  { id: 'line2', target: '[data-mi="line"]', text: '「線を引く」を押します。', on: 'branch:line' },
  { id: 'line3', target: '[data-mb="line:dc200"]', text: '明治の電灯は直流 200 V で配りました。押します（ほかの種類は、まだ灰色）。', on: 'bmode:line' },
  { id: 'line4', target: `[data-node="${TUT_NEXT}"]`, text: '光っている地点が終点に選べます。京橋・銀座を押します。', on: 'line:to' },
  { id: 'line5', target: '[data-bcard]', text: '距離・危険・損失を見て「建設する」。直流は遠くへ送るほど損失が大きくなります。', on: 'built:line' },
  { id: 'line6', target: '[data-line]', text: '線の工事が始まりました（点線）。時間をとばします。', next: 'とばす（開通まで）', after: 'skipWork' },
  { id: 'app1', target: '[data-dockp="list"]', before: 'spawnApp', text: '京橋・銀座から接続の申し込みが届きました。「一覧」を押します。', on: 'panel:list' },
  { id: 'app2', target: '[data-accept]', text: '受けたときの見込み（供給の余裕・線の使用率）を見て「受ける」。保留しても罰はありません。', on: 'app:accept' },
  { id: 'flow', target: '[data-line]', before: 'toEvening', text: '京橋・銀座にも電気が届きました。黄色い点線は電気の流れる向きで、線が混むほど速く流れます。', next: true },
  { id: 'inc1', target: '[data-dockp="list"]', before: 'raiseInc', need: 'incident', text: '事故が起きました（赤い印）。「一覧」を押します。', on: 'panel:list' },
  { id: 'inc2', target: '[data-inc]', need: 'incident', text: '「対処を選ぶ」を押します。', on: 'inc:open' },
  { id: 'inc3', target: '.choices', need: 'incident', text: '4つから対処を選びます。正しいと被害が小さく、誤ると大きくなります（練習なので回答記録には残りません）。', on: 'inc:answer' },
  { id: 'inc4', target: '[data-next]', need: 'incident', text: '解説を読んだら、系統に戻ります。', on: 'inc:back' },
  { id: 'run', target: '[data-dockp="run"]', text: '運転：給電の優先順位・予備力の目標・点検・燃料の買い方を決めます。毎時の出力の配分は自動です。', next: true },
  { id: 'supply', target: '[data-dockp="supply"]', text: '需給：需要と発電のグラフ、周波数、需要の上限（レベルと定着で広がる）。', next: true },
  { id: 'manage', target: '[data-dockp="manage"]', text: '経営：収益の推移、時代と学習、別の地方から始める。このチュートリアルも、ここからもう一度見られます。', next: true },
  { id: 'gate1', target: '[data-dockp="build"]', text: '最後に「建設」を押します。', on: 'panel:build' },
  { id: 'gate2', target: '.gbitem.locked', text: '灰色の種類は、関係する単元で1問正解すると建てられます。押すと理由と「この単元を解く」が出ます（練習の東京では、直流のほかは解いていない扱い）。', next: true },
  { id: 'zoom', target: '[data-zoom="all"]', before: 'closePanel', text: '地図は2本指で拡大・縮小、1本指で動かせます。2本指で縮めると列島全体が見えます（「全体」「始めた町」のボタンでも）。時代が進むと、建てられる範囲が広がります。', next: true },
  { id: 'end', text: '練習はここまでです。本番の系統に戻ります。電気が届くと収益が入り、解くほど建てられる設備と需要が広がります。', next: '本番の系統へ', after: 'finish' },
];

// 手順の前後にすること（練習の島の系統だけを動かす。規則は変えず、時間をとばすだけ）。
// 戻り値：{ ok, inc }。advance(n)：n 刻み進める関数（画面側で Dv.advance を渡す）
export function tutorialAction(g, lc, name, advance) {
  if (name === 'skipWork') {
    // 工事が終わるまで進める（最大 14 日）
    let k = 0;
    while (underWork(g).size && k < 24 * 14) advance(1), k++;
    return { ok: true, steps: k };
  }
  if (name === 'toEvening') {
    // 次の 19 時（電灯の多い時間）まで進める
    let k = 0;
    do advance(1), k++;
    while (g.t % 24 !== 19 && k < 48);
    return { ok: true, steps: k };
  }
  if (name === 'spawnApp') {
    // 京橋・銀座から電灯の申し込み（10 kW）
    // 一覧のいちばん上に出す（1.6.0：区が多く、ほかの区からの申し込みが先に届いていることがあるので）
    const app = { id: `A${g.nextId++}`, town: TUT_NEXT, type: 'lamp', kw: 10, at: g.t };
    g.apps.unshift(app);
    return { ok: true, app };
  }
  if (name === 'raiseInc') {
    g.cool.dcDrop = 0;
    const inc = Gm.raise(g, lc, 'dcDrop', { town: TUT_NEXT, what: '京橋・銀座から「電灯が暗い」という苦情が来た。', cool: 1 });
    return { ok: !!inc, inc };
  }
  return { ok: true };
}

// ---- 1.5.3 事故・出来事が起きたときの演出：見出し・絵・新しく起きたものの見つけ方 ----
// 事故の絵は7つにまとめる（I01〜I07。試作/系統ゲーム_画像プロンプト.md）。渇水は出来事の絵（G18）。絵がない間は fallback の G の絵
export const INC_PIC = { lightning: 'I01', backFlash: 'I01', arc: 'I01', salt: 'I02', gallop: 'I03', genTrip: 'I04', genShort: 'I04', parallelIn: 'I04', trLoss: 'I05', trParallel: 'I05', trShare: 'I05', lineOver: 'I06', reserve: 'I06', dcDrop: 'I07', motor: 'I07', factoryPf: 'I07', drought: 'G18' };
export const PIC_FALLBACK = { I01: 'G11', I02: 'G11', I03: 'G15', I04: 'G06', I05: 'G10', I06: 'G11', I07: 'G01' };
export const EV_PIC = { heat: 'G12', cold: 'G13', typhoon: 'G14', snowstorm: 'G15', coalSpike: 'G16', priceWar: 'G17', drought: 'G18' };
// 赤い太字の見出し（「◯◯発生」。起きたことではなく判断を求めるものは、それに合う言い方）
export const INC_HEAD = { dcDrop: '電圧低下発生', parallelIn: '並列投入の判断', salt: '塩害発生', gallop: 'ギャロッピング発生', genTrip: '発電機故障発生', genShort: '発電機故障・予備力不足', reserve: '予備力不足', trLoss: '変圧器の損失報告', trParallel: '循環電流発生', trShare: '変圧器過負荷発生', lineOver: '送電線過負荷発生', factoryPf: '低力率の申し込み', motor: '電灯のちらつき発生', lightning: '落雷事故発生', backFlash: '逆フラッシオーバ発生', arc: '地絡アーク発生', drought: '渇水発生' };
export const EV_HEAD = { heat: '猛暑到来', cold: '厳冬到来', typhoon: '台風発生', snowstorm: '大雪発生', coalSpike: '石炭価格高騰', priceWar: '電力戦勃発', drought: '渇水発生' };
const evId = (e) => `${e.key}@${e.at}`;
// いまある事故と出来事の印（これと比べて、新しく起きたものを見つける）
export function alertSeen(g) {
  return { inc: new Set(g.incidents.map((i) => i.id)), ev: new Set(g.events.filter((e) => e.until > g.t).map(evId)) };
}
// 印のあとで新しく起きたもの（起きた順）。kind：inc（事故）／ev（出来事）
export function newAlerts(g, seen) {
  const out = [];
  for (const e of g.events) {
    if (e.until <= g.t || seen?.ev.has(evId(e)) || !Gm.EVENTS[e.key]) continue;
    const E = Gm.EVENTS[e.key];
    const days = Math.max(1, Math.round((e.until - e.at) / 24));
    out.push({ kind: 'ev', key: e.key, at: e.at, head: EV_HEAD[e.key] || E.name, pic: EV_PIC[e.key], text: `${E.text}。${days}日続く（あと${hoursText(e.until - g.t)}）。` });
  }
  for (const i of g.incidents) {
    if (seen?.inc.has(i.id)) continue;
    out.push({ kind: 'inc', id: i.id, key: i.key, at: i.at, head: INC_HEAD[i.key] || Gm.INCIDENTS[i.key].title, pic: INC_PIC[i.key], text: i.what || Gm.INCIDENTS[i.key].title });
  }
  return out.sort((a, b) => a.at - b.at || (a.kind === 'ev' ? -1 : 1));
}
// 続けて起きたら順に出す。3つ目からは1枚にまとめる（rest）
export function planAlerts(list) {
  return { each: list.slice(0, 2), rest: list.slice(2) };
}

// ---- 1.5.3 上の帯の下の状態の札（ゲームの状態異常のように）：全域停電・負荷遮断・事故の対処待ち・続いている出来事 ----
// 悪い状態ほど前に、目立つ色で（cls：c-black＞c-shed＞c-inc＞c-ev）。left：残りの時間（「あと2日」）
export function leftText(h) {
  h = Math.max(0, Math.ceil(h));
  return h < 24 ? `あと${h}時間` : `あと${Math.ceil(h / 24)}日`;
}
export function statusChips(g) {
  const t = g.t;
  const out = [];
  const black = Math.max(0, ...Object.values(g.black || {}));
  if (black > t) out.push({ kind: 'black', name: '全域停電', left: `復旧まで${leftText(black - t)}`, cls: 'c-black' });
  else if (g.last?.shed) out.push({ kind: 'shed', name: '負荷遮断', left: '', cls: 'c-shed' });
  for (const i of [...g.incidents].sort((a, b) => a.deadline - b.deadline)) out.push({ kind: 'inc', id: i.id, key: i.key, name: (INC_HEAD[i.key] || Gm.INCIDENTS[i.key].title).replace(/発生$/, ''), left: leftText(i.deadline - t), cls: 'c-inc' });
  for (const e of g.events.filter((x) => x.until > t).sort((a, b) => a.until - b.until)) out.push({ kind: 'ev', key: e.key, name: Gm.EVENTS[e.key].name, left: leftText(e.until - t), cls: 'c-ev' });
  return out;
}
