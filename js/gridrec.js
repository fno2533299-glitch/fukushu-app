// 1.8.2 系統の記録（kv「gridRecord」）：絵のアルバム（出会った絵と初めて出会った日）と、系統で初めて起きたこと（称号の種類 grid の元）。
// 史実モード・自由モード・新しい島をまたいで残る（一度入ったら消えない）。コインの財布と同じく1つだけ。バックアップに入れる。
// チュートリアル・デモ・開発者モードで起きたことは数えない（gridui.js が本番の系統のときだけ書く）
import * as Gm from './grid.js';

// 絵のアルバム：G01〜G36・I01〜I07・L01〜L03 の 46 枚（何の絵か）。番号は 試作/系統ゲーム_画像プロンプト.md
export const ALBUM = [
  ['G01', '明治前期の町（1887〜）'],
  ['G02', '明治後期の町（1891〜）'],
  ['G03', '大正の町（1912〜）'],
  ['G04', '昭和前期の町（1926〜）'],
  ['G05', '直流の石炭火力'],
  ['G06', '石炭火力（汽力・交流）'],
  ['G07', '大型の石炭火力（高圧ボイラ）'],
  ['G08', '流れ込み式の水力'],
  ['G09', '調整池式の水力'],
  ['G10', '変電所・変圧器'],
  ['G11', '送電線（大きな鉄塔）'],
  ['G12', '出来事：猛暑'],
  ['G13', '出来事：厳冬'],
  ['G14', '出来事：台風'],
  ['G15', '出来事：大雪'],
  ['G16', '出来事：石炭の値段の高騰'],
  ['G17', '出来事：電力戦'],
  ['G18', '出来事：渇水'],
  ['G19', '全域停電'],
  ['G20', '全域停電からの復旧'],
  ['G21', '経営再建'],
  ['G22', '新しい島・別の地方から'],
  ['G23', '戦後復興の町（1941〜）'], // 1.10.0
  ['G24', '高度成長の町（1955〜）'], // 1.10.3
  ['G25', '需要：電灯'],
  ['G26', '需要：住宅'],
  ['G27', '需要：町の動力'],
  ['G28', '需要：工場（動力）'],
  ['G29', 'ミッション M01：町に電気を灯す'],
  ['G30', 'ミッション M02：直流の届く範囲'],
  ['G31', 'ミッション M03：周波数を決める'],
  ['G32', 'ミッション M04：遠くの水力から町へ'],
  ['G33', 'ミッション M05：66 kV の長距離送電'],
  ['G34', 'ミッション M06：110 kV で東京へ'],
  ['G35', 'ミッション M07：154 kV の送電幹線'],
  ['G36', 'ミッション M08：渇水をしのぐ'],
  ['I01', '事故：落雷（逆フラッシオーバ・地絡のアーク）'],
  ['I02', '事故：塩害（海沿いの送電線の閃絡）'],
  ['I03', '事故：着雪とギャロッピング'],
  ['I04', '事故：発電機の故障・並列投入・脱調'],
  ['I05', '事故：変圧器（損失・循環電流・過負荷）'],
  ['I06', '事故：過負荷と予備力の不足'],
  ['I07', '事故：電圧の低下（暗い・ちらつく・力率の悪い工場）'],
  ['L01', '線：直流配電 200 V・交流配電 3.3 kV（町の電柱）'],
  ['L02', '線：交流送電 11 kV・22 kV（木柱の送電線）'],
  ['L03', '線：交流送電 66 kV・110 kV（中くらいの鉄塔）'],
];
export const ALBUM_IDS = ALBUM.map((a) => a[0]);
export const albumName = (id) => ALBUM.find((a) => a[0] === id)?.[1] || id;
// 画面の絵のキー → 番号（gridui.js の PIC と同じ）
export const PIC_ID = { era1: 'G01', era2: 'G02', era3: 'G03', era4: 'G04', era5: 'G23', era6: 'G24', dcCoal: 'G05', acCoal: 'G06', bigCoal: 'G07', oilFire: 'G07', ror: 'G08', pond: 'G09', dam: 'G09', sub: 'G10', rotary: 'G10', mercury: 'G10', line: 'G11', heat: 'G12', cold: 'G13', typhoon: 'G14', snowstorm: 'G15', coalSpike: 'G16', priceWar: 'G17', drought: 'G18', blackout: 'G19', recover: 'G20', rebuild: 'G21', island: 'G22', load_lamp: 'G25', load_home: 'G26', load_shop: 'G27', load_factory: 'G28', load_tram: 'G27', M01: 'G29', M02: 'G30', M03: 'G31', M04: 'G32', M05: 'G33', M06: 'G34', M07: 'G35', M08: 'G36' };
export const LOAD_PIC = { lamp: 'G25', home: 'G26', shop: 'G27', factory: 'G28', tram: 'G27' };
export const MISSION_PIC = { M01: 'G29', M02: 'G30', M03: 'G31', M04: 'G32', M05: 'G33', M06: 'G34', M07: 'G35', M08: 'G36' };
// 線の種類 → 番号（gridmenu.js の LINE_PIC と同じ）。事故 → 番号（INC_PIC と同じ）
const LINE_ID = { dc200: 'L01', ac3: 'L01', ac11: 'L02', ac22: 'L02', ac66: 'L03', ac110: 'L03', ac154: 'G11', ac275: 'G11' };
const INC_ID = { lightning: 'I01', backFlash: 'I01', arc: 'I01', catenary: 'I01', salt: 'I02', gallop: 'I03', genTrip: 'I04', genShort: 'I04', parallelIn: 'I04', outOfStep: 'I04', trLoss: 'I05', trParallel: 'I05', trShare: 'I05', lineOver: 'I06', reserve: 'I06', dcDrop: 'I07', motor: 'I07', factoryPf: 'I07', drought: 'G18' };

export const emptyRec = () => ({ v: 1, album: {}, firsts: {}, imported: false });
export function normalizeRec(r) {
  if (!r || typeof r !== 'object') return emptyRec();
  return { v: 1, album: { ...(r.album || {}) }, firsts: { ...(r.firsts || {}) }, imported: !!r.imported };
}
// 絵に出会った（初めてなら日付を残す）。戻り値：新しく出会ったか
export function seePic(rec, id, date) {
  if (!id || !ALBUM_IDS.includes(id) || rec.album[id]) return false;
  rec.album[id] = date;
  return true;
}
export const albumCount = (rec) => ALBUM_IDS.filter((id) => rec.album[id]).length;

// ---- 系統で初めて起きたこと（節目）。いまの系統で成り立っているものの一覧（キー）----
// era:n 時代 n に到達・acc:kW 受けた需要の合計がその値以上・noBlackYear 停電なしで1年（年の決算で届かなかった量が 0）・
// line:種類 その線が開通・plant:種類 その発電所が運転開始・mission:n 史実モードのミッションを n 個達成・rd:1 研究開発が1段終わった・
// rd:max どれかの項目が最高の段・invest:max どれかの町への投資が最高の段・decor:n 記念の建物を n 個建てた（この系統で）・
// hz2 50 Hz と 60 Hz の網を1つの系統に持った・island:n n 個目の系統（新しい島・別の地方）
export const ACC_MILES = [1000, 10000, 100000, 1000000];
export function milestones(G) {
  if (!G) return [];
  const t = G.t;
  const out = [];
  for (let n = 2; n <= G.era; n++) out.push(`era:${n}`);
  const acc = G.loads.reduce((a, l) => a + l.kw, 0);
  for (const v of ACC_MILES) if (acc >= v) out.push(`acc:${v}`);
  if ((G.years || []).some((y) => y.hours >= 24 * Gm.YEAR_DAYS * 0.99 && (y.unserved || 0) < 0.5)) out.push('noBlackYear');
  for (const k of ['ac66', 'ac110', 'ac154']) if (G.lines.some((l) => l.kind === k && l.readyAt <= t)) out.push(`line:${k}`);
  for (const k of ['pond', 'bigCoal']) if (G.plants.some((p) => p.type === k && p.readyAt <= t)) out.push(`plant:${k}`);
  const ms = Object.keys(G.missions?.done || {}).length;
  for (const n of [1, 4, 8]) if (ms >= n) out.push(`mission:${n}`);
  if ((G.rd?.done || 0) >= 1) out.push('rd:1');
  if (Object.values(G.rd?.lv || {}).some((v) => v >= Gm.RD_MAX)) out.push('rd:max');
  if (Object.values(G.invest || {}).some((v) => v >= Gm.INVEST_MAX)) out.push('invest:max');
  for (const n of [1, 9]) if ((G.decorBuilt || 0) >= n) out.push(`decor:${n}`);
  if (Gm.hzList(G).length >= 2) out.push('hz2');
  for (const n of [2, 3]) if ((G.islandNo || 1) >= n) out.push(`island:${n}`);
  // 1.10.3 初めて電気が届いた町の数（称号 grid にも使えるように）
  const litN = Object.keys(G.litTowns || {}).length;
  for (const n of [1, 5, 10]) if (litN >= n) out.push(`firstLit:${n}`);
  return out;
}
// いまの系統の節目を記録に足す。戻り値：新しく足したキー
export function recordGrid(rec, G, date) {
  const fresh = [];
  for (const k of milestones(G)) if (!rec.firsts[k]) (rec.firsts[k] = date), fresh.push(k);
  return fresh;
}
// その系統で、今までに出ているはずの絵（初めて記録を作るとき。わかる範囲で）
export function picsOf(G) {
  if (!G) return [];
  const t = G.t;
  const s = new Set();
  for (let n = 1; n <= Math.min(G.era, 5); n++) s.add(PIC_ID[`era${n}`]); // 1.10.0 戦後復興（G23）まで
  for (const p of G.plants) if (p.readyAt <= t) s.add(PIC_ID[p.type]);
  if (G.subs.some((x) => x.readyAt <= t) || (G.convs || []).some((x) => x.readyAt <= t)) s.add('G10');
  for (const l of G.lines) if (l.readyAt <= t) s.add(LINE_ID[l.kind]);
  for (const e of G.events || []) if (PIC_ID[e.key]) s.add(PIC_ID[e.key]);
  const titles = new Map(Object.entries(Gm.INCIDENTS).map(([k, D]) => [D.title, k]));
  for (const r of G.reports || []) {
    const k = titles.get(r.title);
    if (k && INC_ID[k]) s.add(INC_ID[k]);
    if (/全域停電/.test(r.title || '')) s.add('G19');
  }
  for (const i of G.incidents || []) if (INC_ID[i.key]) s.add(INC_ID[i.key]);
  if ((G.acc?.blackH || 0) > 0 || Object.keys(G.black || {}).length) s.add('G19');
  if (G.loanUntil > 0 || (G.debt || 0) > 0) s.add('G21');
  if ((G.islandNo || 1) > 1 || (G.past || []).length) s.add('G22');
  for (const ld of G.loads || []) if (LOAD_PIC[ld.type]) s.add(LOAD_PIC[ld.type]); // 1.10.3 G25〜G28
  for (const id of Object.keys(G.missions?.done || {})) if (MISSION_PIC[id]) s.add(MISSION_PIC[id]); // 1.10.3 G29〜G36
  return [...s].filter(Boolean);
}
// 初めて記録を作るとき：今までの系統（史実・自由。前の島の記録 past の需要の最大）から、わかるものを取り込む
export function importPast(rec, grids, date) {
  if (rec.imported) return false;
  for (const G of grids.filter(Boolean)) {
    recordGrid(rec, G, date);
    for (const id of picsOf(G)) seePic(rec, id, date);
    for (const p of G.past || []) {
      for (const v of ACC_MILES) if ((p.peak || 0) >= v && !rec.firsts[`acc:${v}`]) rec.firsts[`acc:${v}`] = date;
      if ((p.years || []).some((y) => y.hours >= 24 * Gm.YEAR_DAYS * 0.99 && (y.unserved || 0) < 0.5) && !rec.firsts.noBlackYear) rec.firsts.noBlackYear = date;
    }
  }
  rec.imported = true;
  return true;
}
