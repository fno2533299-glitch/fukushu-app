// 出題・復習・段階解放・取り込み・学習の記録の計算（画面や保存に依存しない部分）
// 仕様：要件定義書 4章、設計図 1.2〜1.5・1.8

export const LEVELS = ['基礎', '応用', '試験'];

export const DEFAULT_SETTINGS = {
  levelEnabled: { 基礎: true, 応用: true, 試験: true },
  unlockThreshold: null, // null は「半数（切り上げ、最低1問）」
  sessionMinutes: 7,
  questionsPerSet: 10,
  quickSize: 3, // ホームの「さっと出題」・マップの「この単元を3問」の問題数
  theme: 'simple', // 'simple'（シンプル）／'fx'（演出あり：正解の光と効果音）
  titleId: null, // ホームに付けている称号（1.4.0）
  intervals: [1, 3, 7, 14, 30],
  subjectTarget: {}, // subjectId → false で対象外（未設定は対象）
  unitTarget: {}, // unitId → false で対象外
};

export function withDefaults(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  s.levelEnabled = { ...DEFAULT_SETTINGS.levelEnabled, ...(settings?.levelEnabled || {}) };
  s.subjectTarget = { ...(settings?.subjectTarget || {}) };
  s.unitTarget = { ...(settings?.unitTarget || {}) };
  return s;
}

// ---- 日付（端末のローカル日付で YYYY-MM-DD） ----

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

// ---- 復習状態（設計図 1.3） ----

// 正解：stage を1つ上げ、intervals[stage-1] 日後に出す（1→3→7→14→30日、以後30日）
// 不正解・わからない：stage 0 に戻し、当日中に復習優先で出せるようにする
export function nextReviewState(prev, questionId, result, now, intervals) {
  const today = localDate(now);
  const base = prev || { questionId, stage: 0, lapseCount: 0 };
  if (result === '正解') {
    const stage = Math.min(base.stage + 1, intervals.length);
    return { ...base, stage, dueDate: addDays(today, intervals[stage - 1]), lastAnsweredAt: now.toISOString() };
  }
  return { ...base, stage: 0, dueDate: today, lastAnsweredAt: now.toISOString(), lapseCount: base.lapseCount + 1 };
}

export function isDue(state, today) {
  return !!state && state.dueDate <= today;
}

// ---- 出題対象・段階解放（設計図 1.5） ----

// ゲームの中だけで出す科目（1.5.0 の「系統の事故」）。おまかせ・さっと出題・復習優先・科目指定・この単元を3問・
// 読み流しのどの候補にも入れず、知識マップ・実績・称号・カードでも扱わない（回答記録・通貨・定着の計算には入る）
export const GRID_SUBJECT = 'grid-incident';
export function gameOnlySubjectIds(data) {
  const ids = new Set([GRID_SUBJECT]);
  for (const s of data?.subjects || []) if (s.gameOnly) ids.add(s.subjectId);
  return ids;
}

// 出題中の問題（ゲームの中だけで出す科目は除く）
export function activeQuestions(data) {
  const game = gameOnlySubjectIds(data);
  return (data?.questions || []).filter((q) => q.status === '出題中' && !game.has(q.subjectId));
}

// ゲームの中だけで出す問題（出題中）
export function gameQuestions(data) {
  const game = gameOnlySubjectIds(data);
  return (data?.questions || []).filter((q) => q.status === '出題中' && game.has(q.subjectId));
}

// 画面の一覧（出題対象の設定・科目指定）に出す科目
export function listedSubjects(data) {
  const game = gameOnlySubjectIds(data);
  return (data?.subjects || []).filter((s) => !game.has(s.subjectId));
}

export function isTargeted(q, settings) {
  return settings.subjectTarget[q.subjectId] !== false && settings.unitTarget[q.unitId] !== false;
}

export function unlockNeed(count, settings) {
  if (settings.unlockThreshold == null) return Math.max(1, Math.ceil(count / 2));
  return Math.min(count, Math.max(1, settings.unlockThreshold));
}

// 単元ごとの解放状況。下のレベルが単元にない場合は、さらに下のレベルで判定する
// （どのレベルもなければ解放済み）
export function unitUnlockStatus(unitId, active, correctIds, settings) {
  const inUnit = active.filter((q) => q.unitId === unitId);
  const status = { 基礎: { unlocked: true } };
  for (let i = 1; i < LEVELS.length; i++) {
    let lower = [];
    for (let j = i - 1; j >= 0 && lower.length === 0; j--) {
      lower = inUnit.filter((q) => q.level === LEVELS[j]);
    }
    if (lower.length === 0) {
      status[LEVELS[i]] = { unlocked: true };
      continue;
    }
    const need = unlockNeed(lower.length, settings);
    const have = lower.filter((q) => correctIds.has(q.questionId)).length;
    status[LEVELS[i]] = { unlocked: have >= need, have, need, basis: lower[0].level };
  }
  return status;
}

export function correctIdSet(logs) {
  return new Set(logs.filter((l) => l.result === '正解').map((l) => l.questionId));
}

// ---- 出題の選び方（要件定義書 4.2） ----

function weightedPick(items, weight, rng) {
  const ws = items.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

function freshness(q, states, today) {
  const st = states[q.questionId];
  if (!st) return 1; // 未回答
  if (isDue(st, today)) return 1.5; // 期限が来ている
  return 0.3; // 正解して間隔待ち
}

// 段階解放の判定（おまかせと同じ）。単元ごとに結果を覚えておく
function unlockedFn(ctx) {
  const correct = correctIdSet(ctx.logs);
  const all = activeQuestions(ctx.data);
  const cache = new Map();
  return (q) => {
    if (!cache.has(q.unitId)) cache.set(q.unitId, unitUnlockStatus(q.unitId, all, correct, ctx.settings));
    return cache.get(q.unitId)[q.level].unlocked;
  };
}

function inUnit(q, unitId) {
  return q.unitId === unitId || (q.subUnitIds || []).includes(unitId);
}

// ctx = { data, states, logs, settings, asked: Set, scope, today, rng }
export function candidates(mode, ctx) {
  const { settings, asked, states, today } = ctx;
  const active = activeQuestions(ctx.data).filter(
    (q) => settings.levelEnabled[q.level] && !asked.has(q.questionId),
  );
  if (mode === 'おまかせ') {
    const unlocked = unlockedFn(ctx);
    return active.filter((q) => isTargeted(q, settings) && unlocked(q));
  }
  if (mode === '復習優先') {
    return active.filter((q) => isTargeted(q, settings) && isDue(states[q.questionId], today));
  }
  if (mode === '単元') {
    // 科目マップの「この単元を3問」：scope = { unitId }。ONで段階解放済みのレベル（出題対象の設定は見ない）
    const unlocked = unlockedFn(ctx);
    return active.filter((q) => inUnit(q, ctx.scope.unitId) && unlocked(q));
  }
  // 科目・単元指定：scope = { subjectId, unitIds, levels }
  const { subjectId, unitIds, levels } = ctx.scope;
  return active.filter(
    (q) =>
      q.subjectId === subjectId &&
      levels.includes(q.level) &&
      [q.unitId, ...(q.subUnitIds || [])].some((u) => unitIds.includes(u)),
  );
}

// おまかせの重み：試験で出題された内容を多め、講義資料のみの内容を少なめに
function omakaseWeight(q, states, today) {
  return (q.examRelevant ? 2 : 1) * (q.sourceKind === '講義資料' && !q.examRelevant ? 0.5 : 1) * freshness(q, states, today);
}

// おまかせと同じ選び方：科目を等確率で選び、その中で重み付き抽選
function pickOmakase(list, ctx, rng) {
  if (list.length === 0) return null;
  const subjects = [...new Set(list.map((q) => q.subjectId))];
  const sid = subjects[Math.floor(rng() * subjects.length)];
  const pool = list.filter((q) => q.subjectId === sid);
  return weightedPick(pool, (q) => omakaseWeight(q, ctx.states, ctx.today), rng);
}

const pickAny = (list, rng) => (list.length ? list[Math.floor(rng() * list.length)] : null);

// ctx.slot（おまかせの枠。omakasePlan）があれば枠から選ぶ。なければ今までのおまかせ（読み流しなど）
export function pickNext(mode, ctx) {
  // さっと出題：基礎だけ（1.4.1）。基礎がなければ今までどおり（期限の来た問題 → おまかせ）
  // 1.9.0：ctx.quickNeedNew（このセットでまだ足りない新しい問題の数。quickNeedNew()）があれば、未回答の基礎を先に
  if (mode === 'さっと') return (ctx.quickNeedNew > 0 && pickQuickNew(ctx)) || pickQuick(ctx, false);
  if (mode === 'おまかせ' && ctx.slot) return pickSlot(ctx.slot, ctx);
  const rng = ctx.rng || Math.random;
  const list = candidates(mode, ctx);
  if (list.length === 0) return null;
  const { states, today } = ctx;

  if (mode === '復習優先') {
    // 誤答・わからない（stage 0）を先に、次に期限の古い順。同順位はランダム
    const keyed = list.map((q) => ({ q, r: rng(), st: states[q.questionId] }));
    keyed.sort((a, b) => a.st.stage - b.st.stage || a.st.dueDate.localeCompare(b.st.dueDate) || a.r - b.r);
    return keyed[0].q;
  }
  if (mode === 'おまかせ') return pickOmakase(list, ctx, rng);
  if (mode === '単元') {
    // 今日解くと定着しそうな問題（その単元が主の問題）→ 期限の来た問題 → おまかせと同じ重み
    const ready = masteryReadyIds(ctx.logs, today);
    return (
      pickAny(list.filter((q) => q.unitId === ctx.scope.unitId && ready.has(q.questionId)), rng) ||
      pickAny(list.filter((q) => isDue(states[q.questionId], today)), rng) ||
      weightedPick(list, (q) => omakaseWeight(q, states, today), rng)
    );
  }
  return weightedPick(list, (q) => freshness(q, states, today), rng);
}

// さっと出題の1問目（ホームに出しておく問題）。始めやすい問題から選ぶ
//  1. 期限が来た問題のうち、最後の回答が正解のもの（stage 1 以上）。今日解くと定着しそうなものを先に
//  2. なければ基礎（おまかせと同じ対象・重み。基礎が OFF なら飛ばす）。最後が不正解・わからない（stage 0）の問題は除く
//  3. どちらもなければ、今までどおり pickNext('さっと')
// 1.4.1 から：基礎だけで選ぶ（pickQuick）。基礎が1問もなければ、1.3.0 のウォームアップ（legacyWarmup）
export function pickWarmup(ctx) {
  return pickQuick(ctx, true);
}

// 1.3.0〜1.4.0 のさっと出題（基礎がないときに使う）
function legacyQuick(ctx) {
  const c = { ...ctx, slot: null };
  return pickNext('復習優先', c) || pickNext('おまかせ', c);
}
function legacyWarmup(ctx) {
  const rng = ctx.rng || Math.random;
  const due = candidates('復習優先', ctx).filter((q) => ctx.states[q.questionId].stage >= 1);
  if (due.length) {
    const ready = masteryReadyIds(ctx.logs, ctx.today);
    return pickAny(due.filter((q) => ready.has(q.questionId)), rng) || pickAny(due, rng);
  }
  const basic = candidates('おまかせ', ctx).filter((q) => q.level === '基礎' && ctx.states[q.questionId]?.stage !== 0);
  return pickOmakase(basic, ctx, rng) || legacyQuick(ctx);
}

// さっと出題（ホームの3問・もう3問）は基礎だけ（1.4.1）
//  ① 期限が来て前回正解した基礎（今日解くと定着しそうなものを先に）
//  ② 未回答の基礎 ③ 期限が来た基礎（前回間違えた・わからない） ④ それ以外の基礎（間隔待ち。重み 0.3）
//  1問目（first）は ①→②→④→③（前回間違えた問題は、ほかに基礎がないときだけ）
//  ②〜④はおまかせと同じ選び方（科目を等確率→重み）。基礎が1問もなければ今までの選び方
function pickQuick(ctx, first) {
  const rng = ctx.rng || Math.random;
  const { states, today } = ctx;
  const basic = candidates('おまかせ', ctx).filter((q) => q.level === '基礎');
  if (basic.length === 0) return first ? legacyWarmup(ctx) : legacyQuick(ctx);
  const st = (q) => states[q.questionId];
  const due = basic.filter((q) => isDue(st(q), today));
  const g1 = due.filter((q) => st(q).stage >= 1);
  if (g1.length) {
    const ready = masteryReadyIds(ctx.logs, today);
    return pickAny(g1.filter((q) => ready.has(q.questionId)), rng) || pickAny(g1, rng);
  }
  const g2 = basic.filter((q) => !st(q));
  const g3 = due.filter((q) => st(q).stage === 0);
  const g4 = basic.filter((q) => st(q) && !isDue(st(q), today));
  for (const g of first ? [g2, g4, g3] : [g2, g3, g4]) if (g.length) return pickOmakase(g, ctx, rng);
  return null;
}

// ---- さっと出題の新しい問題（1.9.0。要件定義書 4.2、設計図 1.7） ----
// セットの問題数の 2/3（端数は切り上げ。3問なら2問）を未回答の基礎にする。1問目（ホームの1問目・もう3問の1問目）は
// 今までどおり選び、それが未回答の基礎ならその分も数に入れる。足りなければ pickQuick の順で埋める
export const quickNewTarget = (size) => Math.ceil((size * 2) / 3);

// このセットであと何問、未回答の基礎を出すか。asked：出した数、newCount：そのうち出したときに未回答だった基礎の数
export function quickNeedNew(size, asked, newCount) {
  if (asked === 0) return 0; // 1問目は今のまま
  return Math.max(0, quickNewTarget(size) - newCount);
}

// 出したときに「未回答の基礎」だったか（セットの数に入れるか）
export const isNewBasic = (q, states) => !!q && q.level === '基礎' && !states[q.questionId];

// 未回答の基礎の選び方はおまかせの new 枠と同じ（授業の科目の未回答の基礎から、科目を等確率 → 重み付き抽選）
function pickQuickNew(ctx) {
  return pickOmakase(omakasePools(ctx).new, ctx, ctx.rng || Math.random);
}

// ---- 単元のまとめ（1.9.0。要件定義書 4.12、設計図 1.13） ----
// 問題データの summaries：[{ unitId, subjectId, revision, lines: [{ text, questionIds }], figure, source }]
// text の［［…］］は空欄（タップで中身を出す）。questionIds はその行に関係する問題（解説から開いたときに目立たせる）

export function summaryFor(data, unitId) {
  return (data?.summaries || []).find((s) => s.unitId === unitId) || null;
}

// 問題からまとめを開くときの単元：主の単元 → 従の単元の順で、まとめのある最初のもの
export function summaryOfQuestion(data, q) {
  for (const u of [q?.unitId, ...(q?.subUnitIds || [])]) {
    const s = u && summaryFor(data, u);
    if (s) return s;
  }
  return null;
}

// 単元に答えた記録が1件でもあるか（主の単元で数える。ゲームの中の回答も含む）
export function unitAnswered(data, logs, unitId) {
  const ids = new Set((data?.questions || []).filter((q) => q.unitId === unitId).map((q) => q.questionId));
  return logs.some((l) => ids.has(l.questionId));
}

// 問題を出す直前に、まとめを自動で出すか：その単元（主の単元）にまとめがあって、その単元の問題を1問も解いておらず、
// まとめもまだ開いていない（read：kv summaryRead。単元ごとに1回だけ）
export function needsAutoSummary(data, logs, read, q) {
  if (!q) return false;
  const s = summaryFor(data, q.unitId);
  return !!s && !read?.[q.unitId] && !unitAnswered(data, logs, q.unitId);
}

// 空欄の数（［［…］］）
export const SUMMARY_BLANK = /［［(.+?)］］/g;
export function summaryBlankCount(s) {
  return (s?.lines || []).reduce((n, l) => n + (l.text.match(SUMMARY_BLANK) || []).length, 0);
}

// ---- おまかせを「枠」で組む（1.4.1。要件定義書 4.2、設計図 1.7） ----
// 新しい問題（未回答の基礎。正解率が高いときは応用も）・復習・挑戦（応用・試験、改題の科目）の3つの枠。
// 直近の正解率で枠の数を変え、1セットの正解率が目標の7割前後になるようにする

export const TARGET_ACCURACY = 0.7; // 目標の正解率（段の境目はこれを挟む）
export const RECENT_ANSWERS = 30; // 直近の正解率に使う回答数
export const RECENT_MIN = 10; // これ未満なら真ん中の段
// 10問のときの枠の数。below 未満の正解率でその段（上から順に見る）。applied：新しい問題のうち応用にしてよい数
export const OMAKASE_TIERS = [
  { below: 0.6, new: 5, review: 5, challenge: 0, applied: 0 },
  { below: 0.8, new: 6, review: 3, challenge: 1, applied: 0 },
  { below: Infinity, new: 6, review: 2, challenge: 2, applied: 2 },
];
const MIDDLE_TIER = 1;
// 直近の正解率に入れない問題（1.5.0 の系統の事故）
const NOT_IN_ACCURACY = (questionId) => questionId.startsWith('grid-incident-');

// 改題の科目（外部試験の問題だけの科目）。挑戦の枠からしか出さない
export function examSubjectIds(data) {
  const qs = new Map();
  for (const q of data?.questions || []) {
    if (!qs.has(q.subjectId)) qs.set(q.subjectId, []);
    qs.get(q.subjectId).push(q);
  }
  const ids = new Set();
  for (const s of data?.subjects || []) {
    const list = qs.get(s.subjectId) || [];
    if (s.category === '外部試験' || (list.length && list.every((q) => q.examItem))) ids.add(s.subjectId);
  }
  return ids;
}

// 直近 RECENT_ANSWERS 回答の正解の割合（「わからない」は不正解と同じ）。読み流しは記録がないので入らない
export function recentAccuracy(logs) {
  const recent = [...logs]
    .filter((l) => !NOT_IN_ACCURACY(l.questionId))
    .sort((a, b) => (a.answeredAt || '').localeCompare(b.answeredAt || ''))
    .slice(-RECENT_ANSWERS);
  const correct = recent.filter((l) => l.result === '正解').length;
  return { count: recent.length, correct, rate: recent.length ? correct / recent.length : null };
}

export function omakaseTier(logs) {
  const acc = recentAccuracy(logs);
  const index = acc.count < RECENT_MIN ? MIDDLE_TIER : OMAKASE_TIERS.findIndex((t) => acc.rate < t.below);
  return { index, tier: OMAKASE_TIERS[index], accuracy: acc };
}

// 問題数 size のときの枠の数。比率で割り振り、端数は新しい問題へ。挑戦は（その段にあれば）最低1。
// 最初の1問を挑戦にしないため、挑戦は size−1 まで
export function slotCounts(size, tier) {
  let challenge = tier.challenge ? Math.max(1, Math.floor((size * tier.challenge) / 10)) : 0;
  challenge = Math.min(challenge, Math.max(0, size - 1));
  const review = Math.min(Math.floor((size * tier.review) / 10), size - challenge);
  const n = size - review - challenge;
  const applied = Math.min(Math.floor((size * tier.applied) / 10), Math.max(0, n - 1));
  return { new: n, review, challenge, applied };
}

// 次のおまかせの組み方。slots は1問ずつの枠（'new'・'newApplied'・'review'・'challenge'）。
// 順番は混ぜるが、最初の1問は新しい基礎か復習
export function omakasePlan(size, logs, rng = Math.random) {
  const t = omakaseTier(logs);
  const counts = slotCounts(size, t.tier);
  const slots = shuffle(
    [
      ...Array(counts.new - counts.applied).fill('new'),
      ...Array(counts.applied).fill('newApplied'),
      ...Array(counts.review).fill('review'),
      ...Array(counts.challenge).fill('challenge'),
    ],
    rng,
  );
  const i = slots.findIndex((s) => s === 'new' || s === 'review');
  if (i > 0) [slots[0], slots[i]] = [slots[i], slots[0]];
  return { ...t, counts, slots };
}

// 授業の科目は科目ごと、改題の科目はまとめて1つの「外部試験」として等確率で選び、その中で重み付き抽選
function pickGrouped(list, ctx, rng, examIds) {
  if (list.length === 0) return null;
  const key = (q) => (examIds.has(q.subjectId) ? '外部試験' : q.subjectId);
  const groups = [...new Set(list.map(key))];
  const g = groups[Math.floor(rng() * groups.length)];
  return weightedPick(list.filter((q) => key(q) === g), (q) => omakaseWeight(q, ctx.states, ctx.today), rng);
}

// 枠ごとの候補（おまかせの候補＝出題対象・ONのレベル・段階解放済み・このセットでまだ出していない）
export function omakasePools(ctx) {
  const { states, today } = ctx;
  const examIds = examSubjectIds(ctx.data);
  const list = candidates('おまかせ', ctx);
  const lecture = list.filter((q) => !examIds.has(q.subjectId));
  const st = (q) => states[q.questionId];
  return {
    examIds,
    new: lecture.filter((q) => !st(q) && q.level === '基礎'),
    newApplied: lecture.filter((q) => !st(q) && q.level === '応用'),
    // 復習：期限の来た問題（前回間違えた・わからない を先に）→ なければ間隔待ちの正解済みの問題
    review: [
      lecture.filter((q) => isDue(st(q), today) && st(q).stage === 0),
      lecture.filter((q) => isDue(st(q), today) && st(q).stage >= 1),
      lecture.filter((q) => st(q) && !isDue(st(q), today)),
    ],
    challenge: list.filter((q) => examIds.has(q.subjectId) || q.level !== '基礎'),
  };
}

// 枠が空なら、ほかの枠から埋める（並びは枠ごと）
const SLOT_FALLBACK = {
  new: ['new', 'review', 'challenge'],
  newApplied: ['newApplied', 'new', 'review', 'challenge'],
  review: ['review', 'new', 'challenge'],
  challenge: ['challenge', 'new', 'review'],
};

export function pickSlot(slot, ctx) {
  const rng = ctx.rng || Math.random;
  const pools = omakasePools(ctx);
  for (const s of SLOT_FALLBACK[slot] || SLOT_FALLBACK.new) {
    if (s === 'review') {
      for (const g of pools.review) if (g.length) return pickOmakase(g, ctx, rng);
      continue;
    }
    const q = s === 'challenge' ? pickGrouped(pools.challenge, ctx, rng, pools.examIds) : pickOmakase(pools[s], ctx, rng);
    if (q) return q;
  }
  return null;
}

// 出題対象の設定に出す1行の文（例：「新しい6・復習3・挑戦1」）
export function planLabel(counts) {
  const nw = counts.applied ? `新しい${counts.new}（応用${counts.applied}まで）` : `新しい${counts.new}`;
  return [nw, `復習${counts.review}`, counts.challenge ? `挑戦${counts.challenge}` : null].filter(Boolean).join('・');
}

export function countDue(ctx) {
  return candidates('復習優先', { ...ctx, asked: new Set() }).length;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- 問題データの検査と取り込み（設計図 1.1・1.2） ----

export function validateQuestionFile(json) {
  const errors = [];
  if (json?.format !== 'fukushu-questions') return ['問題データのファイルではありません（format が違います）'];
  if (!Array.isArray(json.subjects) || !Array.isArray(json.questions)) return ['subjects / questions がありません'];
  const unitIds = new Set(json.subjects.flatMap((s) => (s.units || []).map((u) => u.unitId)));
  const papers = new Set((json.exams || []).flatMap((ex) => (ex.papers || []).map((p) => paperKey({ examId: ex.examId, ...p }))));
  const seen = new Set();
  for (const q of json.questions) {
    const id = q.questionId || '(IDなし)';
    if (!q.questionId) errors.push('questionId のない問題があります');
    if (seen.has(q.questionId)) errors.push(`${id}: IDが重複しています`);
    seen.add(q.questionId);
    if (!LEVELS.includes(q.level)) errors.push(`${id}: レベルが不正です`);
    if (!Array.isArray(q.choices) || q.choices.length !== 4) errors.push(`${id}: 選択肢が4つではありません`);
    else if (!q.choices.some((c) => c.choiceId === q.correctChoiceId)) errors.push(`${id}: 正解の選択肢がありません`);
    if (!unitIds.has(q.unitId)) errors.push(`${id}: 単元 ${q.unitId} が定義されていません`);
    if (!['出題中', '保留', '廃止'].includes(q.status)) errors.push(`${id}: status が不正です`);
    if (q.examItem != null) {
      const e = q.examItem;
      if (!(typeof e.points === 'number' && e.points > 0)) errors.push(`${id}: examItem の points が不正です`);
      else if (!papers.has(paperKey(e))) errors.push(`${id}: 外部試験 ${e.examId} ${e.year}年 ${e.subject} が exams に定義されていません`);
    }
    if (q.steps != null) errors.push(...validateSteps(q.steps).map((e) => `${id}: ${e}`));
  }
  // 単元のまとめ（1.9.0）。なくてもよい
  if (json.summaries != null) {
    if (!Array.isArray(json.summaries)) errors.push('summaries が配列ではありません');
    else
      for (const s of json.summaries) {
        if (!unitIds.has(s?.unitId)) errors.push(`まとめ: 単元 ${s?.unitId} が定義されていません`);
        else if (!Array.isArray(s.lines) || !s.lines.length || s.lines.some((l) => typeof l?.text !== 'string')) errors.push(`まとめ ${s.unitId}: lines が不正です`);
      }
  }
  return errors;
}

// ---- 段階問題（小問。1.7.0：要件定義書 4.1・4.2、設計図 1.12） ----
// q.steps = { guided: [小問 1〜4], light: [小問 1] }。小問 = { stepId, title, kind, stem, choices, correctChoiceId, explanation }
// 誘導の段階：2＝誘導あり（guided の小問 → 元の問題）、1＝誘導少なめ（light の小問 → 元の問題）、0＝誘導なし（元の問題だけ）

export const STEP_KINDS = ['値', '式', '代入'];
export const ASSIST_OF_LEVEL = { 2: 'guided', 1: 'light', 0: null };
const LEVEL_OF_ASSIST = { guided: 2, light: 1 };
export const ASSIST_LABEL = { guided: '誘導あり', light: '誘導少なめ' };

// 回答記録が誘導つき（誘導あり・誘導少なめ）か。古い記録（assist なし）は誘導なし
export const isAssisted = (log) => !!log && (log.assist === 'guided' || log.assist === 'light');

export function validateSteps(steps) {
  const errors = [];
  const g = steps?.guided, l = steps?.light;
  if (!Array.isArray(g) || g.length < 1 || g.length > 4) errors.push('steps.guided（誘導ありの小問）は 1〜4 個にします');
  if (!Array.isArray(l) || l.length !== 1) errors.push('steps.light（誘導少なめの小問）は 1 個にします');
  const seen = new Set();
  for (const s of [...(Array.isArray(g) ? g : []), ...(Array.isArray(l) ? l : [])]) {
    const sid = s?.stepId || '(stepIdなし)';
    if (!s?.stepId) errors.push('stepId のない小問があります');
    else if (seen.has(s.stepId)) errors.push(`小問 ${sid}: stepId が重複しています`);
    seen.add(s?.stepId);
    if (!STEP_KINDS.includes(s?.kind)) errors.push(`小問 ${sid}: 種類が「値・式・代入」ではありません`);
    if (!Array.isArray(s?.choices) || s.choices.length !== 4) errors.push(`小問 ${sid}: 選択肢が4つではありません`);
    else if (!s.choices.some((c) => c.choiceId === s.correctChoiceId)) errors.push(`小問 ${sid}: 正解の選択肢がありません`);
  }
  return errors;
}

// その回の小問（段階 level の小問の列）。誘導なし・steps のない問題は []
export function stepsFor(q, level) {
  const a = ASSIST_OF_LEVEL[level];
  return (a && q?.steps?.[a]) || [];
}

// 1件の回答記録の「段階」と「全部正解か」（小問と元の問題がすべて正解）
function assistOutcome(log) {
  const level = LEVEL_OF_ASSIST[log.assist] || 0;
  const ok = log.result === '正解' && (level === 0 || (log.steps || []).every((s) => s.result === '正解'));
  return { level, ok };
}

// 次に出す誘導の段階（回答記録から計算し、保存しない。logs は古い順）
//  最初は 2。誘導なしで正解したことがあれば 0
//  誘導あり・誘導少なめで、小問と元の問題をすべて正解 → 1つ減らす。誘導なしで正解 → 0 のまま
//  どこかで間違えた・「わからない」→ 同じ段階。同じ段階で2回続けたら1つ戻す（0 → 1 → 2）
//  誘導なしで答えた記録は、いまの段階が 0 でなければ正解だけを見る（1.7.0 より前の記録が段階を下げないように）
export function assistLevel(q, logs) {
  if (!q?.steps) return 0;
  let level = 2, missLevel = null, misses = 0;
  for (const l of logs) {
    if (l.questionId !== q.questionId) continue;
    const o = assistOutcome(l);
    if (o.level === 0 && level !== 0 && !o.ok) continue;
    if (o.ok) {
      level = Math.max(o.level - 1, 0);
      misses = 0;
      missLevel = null;
      continue;
    }
    misses = missLevel === o.level ? misses + 1 : 1;
    missLevel = o.level;
    if (misses >= 2) {
      level = Math.min(o.level + 1, 2);
      misses = 0;
      missLevel = null;
    } else level = o.level;
  }
  return level;
}

// 記録の画面の「計算のつまずき」：小問の種類ごとの正解率と、間違えることの多い小問（3つまで）
export function stepStats(logs, data) {
  const qById = new Map((data?.questions || []).map((q) => [q.questionId, q]));
  const byKind = new Map(STEP_KINDS.map((k) => [k, { kind: k, answered: 0, correct: 0 }]));
  const bySteps = new Map();
  for (const l of logs) {
    if (!isAssisted(l)) continue;
    const q = qById.get(l.questionId);
    const defs = new Map([...(q?.steps?.guided || []), ...(q?.steps?.light || [])].map((s) => [s.stepId, s]));
    for (const a of l.steps || []) {
      const s = defs.get(a.stepId);
      if (!s) continue; // 小問が消えた・変わった
      const k = byKind.get(s.kind);
      k.answered++;
      if (a.result === '正解') k.correct++;
      const key = `${q.questionId}|${s.stepId}`;
      if (!bySteps.has(key)) bySteps.set(key, { questionId: q.questionId, stepId: s.stepId, title: s.title, kind: s.kind, qTitle: q.title, answered: 0, missed: 0 });
      const b = bySteps.get(key);
      b.answered++;
      if (a.result !== '正解') b.missed++;
    }
  }
  const kinds = [...byKind.values()].map((k) => ({ ...k, rate: k.answered ? k.correct / k.answered : null }));
  const hard = [...bySteps.values()]
    .filter((b) => b.missed > 0)
    .sort((a, b) => b.missed - a.missed || b.missed / b.answered - a.missed / a.answered || a.questionId.localeCompare(b.questionId))
    .slice(0, 3);
  return { kinds, hard, answered: kinds.reduce((a, k) => a + k.answered, 0) };
}

// 取り込み後のデータと、新規・更新・廃止の件数を返す。
// ファイルに含まれる科目の問題は置き換え、ファイルにない問題は「廃止」にする（履歴は残る）
export function mergeQuestionData(current, incoming) {
  const cur = current || { subjects: [], questions: [] };
  const inSubjects = new Set(incoming.subjects.map((s) => s.subjectId));
  const curById = new Map(cur.questions.map((q) => [q.questionId, q]));
  const inIds = new Set(incoming.questions.map((q) => q.questionId));
  const summary = { added: [], updated: [], retired: [], unchanged: 0 };

  const questions = [];
  for (const q of incoming.questions) {
    const old = curById.get(q.questionId);
    if (!old) summary.added.push(q.questionId);
    else if (JSON.stringify(old) !== JSON.stringify(q)) {
      if (q.status === '廃止' && old.status !== '廃止') summary.retired.push(q.questionId);
      else summary.updated.push(q.questionId);
    } else summary.unchanged++;
    questions.push(q);
  }
  for (const q of cur.questions) {
    if (inIds.has(q.questionId)) continue;
    if (inSubjects.has(q.subjectId) && q.status !== '廃止') {
      questions.push({ ...q, status: '廃止' });
      summary.retired.push(q.questionId);
    } else questions.push(q);
  }
  const subjects = [...cur.subjects.filter((s) => !inSubjects.has(s.subjectId)), ...incoming.subjects];
  // 知識マップの地図は新しいファイルのもので置き換える。地図のない古いファイルなら今の地図を残す
  const map = incoming.map || cur.map || null;
  // 外部試験の定義（合格点など）も同じ扱い
  const exams = incoming.exams || cur.exams || [];
  // 単元のまとめ（1.9.0）：ファイルにある科目のまとめは置き換え（ファイルにまとめがなければ、その科目のまとめはなくなる）
  const curSum = new Map((cur.summaries || []).map((s) => [s.unitId, s]));
  const inSum = incoming.summaries || [];
  summary.summaries = { added: [], updated: [], removed: [] };
  for (const s of inSum) {
    const old = curSum.get(s.unitId);
    if (!old) summary.summaries.added.push(s.unitId);
    else if (JSON.stringify(old) !== JSON.stringify(s)) summary.summaries.updated.push(s.unitId);
  }
  const inSumIds = new Set(inSum.map((s) => s.unitId));
  const keep = (cur.summaries || []).filter((s) => {
    if (!inSubjects.has(s.subjectId)) return true;
    if (!inSumIds.has(s.unitId)) summary.summaries.removed.push(s.unitId);
    return false;
  });
  const summaries = [...keep, ...inSum];
  return { data: { subjects, questions, map, exams, summaries }, summary };
}

// ---- 学習の記録：定着・実績・結果画面（要件定義書 4.8、設計図 1.8） ----

export const MASTERY_DAYS = 7;

export function daysBetween(a, b) {
  const t = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

// 回答記録（古い順）をたどって問題ごとの状態を作る。
// 定着：正解で、1つ前の回答も正解、その間が7日以上。不正解・わからないで定着でなくなる。
// maxGap は「正解→正解」の間があいた日数の最大。onStep(log, p) で途中経過を見られる
// 誘導つきの回答（1.7.0）は飛ばす：定着・取れる点はその前の誘導なしの回答で決まる。onStep は誘導つきの回答でも
// 呼ぶ（継続日数などのため）が、p は変えない（まだ誘導なしで答えていない問題なら、map に入らない空の p）
const emptyProgress = () => ({ answered: 0, lapses: 0, mastered: false, maxGap: 0, lastResult: null, lastDate: null });
export function questionProgress(logs, onStep) {
  const map = new Map();
  for (const l of logs) {
    if (isAssisted(l)) {
      onStep?.(l, map.get(l.questionId) || emptyProgress());
      continue;
    }
    const date = localDate(new Date(l.answeredAt));
    let p = map.get(l.questionId);
    if (!p) map.set(l.questionId, (p = emptyProgress()));
    if (l.result === '正解') {
      if (p.lastResult === '正解') {
        const gap = daysBetween(p.lastDate, date);
        if (gap >= MASTERY_DAYS) p.mastered = true;
        p.maxGap = Math.max(p.maxGap, gap);
      }
    } else {
      p.mastered = false;
      p.lapses++;
    }
    p.answered++;
    p.lastResult = l.result;
    p.lastDate = date;
    onStep?.(l, p);
  }
  return map;
}

// 問題の集まり（単元・科目）の定着の状況
export function groupProgress(questions, prog) {
  const g = { total: questions.length, mastered: 0, touched: 0 };
  for (const q of questions) {
    const p = prog.get(q.questionId);
    if (!p) continue;
    g.touched++;
    if (p.mastered) g.mastered++;
  }
  g.learning = g.touched - g.mastered;
  return g;
}

// 色の段階：0 未着手／1 学習中（定着0）／2 定着が半分未満／3 半分以上／4 すべて定着
export function shadeLevel(g) {
  if (!g.total || !g.touched) return 0;
  if (!g.mastered) return 1;
  const r = g.mastered / g.total;
  return r < 0.5 ? 2 : r < 1 ? 3 : 4;
}

// 今日解くと定着しそうな問題：最後の回答が正解で、その回答から7日以上たち、まだ定着していない
// （設計図 1.8 の判定で、次に正解すれば定着になる問題）
export function masteryReadyIds(logs, today, prog = questionProgress(logs)) {
  const ids = new Set();
  for (const [id, p] of prog) {
    if (!p.mastered && p.lastResult === '正解' && daysBetween(p.lastDate, today) >= MASTERY_DAYS) ids.add(id);
  }
  return ids;
}

// 印を付ける単元：unitId → 今日解くと定着しそうな問題の数。
// 「この単元を3問」で出せる問題（出題中・ONのレベル・段階解放済み）に限る
export function masteryReadyByUnit(ctx) {
  const ready = masteryReadyIds(ctx.logs, ctx.today);
  const unlocked = unlockedFn(ctx);
  const m = new Map();
  for (const q of activeQuestions(ctx.data)) {
    if (!ready.has(q.questionId) || !ctx.settings.levelEnabled[q.level] || !unlocked(q)) continue;
    m.set(q.unitId, (m.get(q.unitId) || 0) + 1);
  }
  return m;
}

// ---- 継続日数：1問以上回答した日（端末の日付）が何日続いているか。1日でも空くと0に戻る ----

export const STREAK_MILESTONES = [3, 7, 14, 30, 100];

// current：今日まで（今日まだ解いていなければ昨日まで）続いている日数。best：これまでの最長
export function streakInfo(logs, today) {
  const days = [...new Set(logs.map((l) => localDate(new Date(l.answeredAt))))].sort();
  let run = 0, best = 0, prev = null;
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const gap = prev ? daysBetween(prev, today) : Infinity;
  return { current: gap === 0 || gap === 1 ? run : 0, best, todayDone: gap === 0 };
}

// coin：達成したときにもらえる通貨（1.4.0。重い実績ほど多い）
const STREAK_COIN = { 3: 3000, 7: 5000, 14: 6000, 30: 8000, 100: 10000 };
export const ACHIEVEMENTS = [
  { id: 'first-correct', icon: '初', name: 'はじめての正解', desc: '1問正解する', coin: 3000 },
  { id: 'first-mastered', icon: '定', name: 'はじめての定着', desc: '7日以上あけて解いても正解できた', coin: 3000 },
  { id: 'first-exam', icon: '試', name: '試験レベルにはじめて正解', desc: '試験レベルの問題に正解する', coin: 3000 },
  { id: 'overcome', icon: '克', name: '苦手を克服', desc: '2回以上間違えた問題が定着した', coin: 5000 },
  { id: 'gap30', icon: '30', name: '30日あけても正解', desc: '正解のあと、30日以上あけて解いても正解', coin: 5000 },
  { id: 'unit-mastered', icon: '全', name: '単元をまるごと定着', desc: '2問以上ある単元で、すべてが定着', coin: 5000 },
  { id: 'subject-touched', icon: '科', name: '1科目の全単元に手を付ける', desc: 'ある科目のすべての単元で1問以上解いた', coin: 5000 },
  { id: 'mastered-10', icon: '10', name: '定着10問', desc: '定着している問題が10問', need: 10, coin: 5000 },
  { id: 'mastered-50', icon: '50', name: '定着50問', desc: '定着している問題が50問', need: 50, coin: 8000 },
  { id: 'mastered-100', icon: '100', name: '定着100問', desc: '定着している問題が100問', need: 100, coin: 10000 },
  { id: 'exam-10', icon: '試', name: '試験レベルを10問定着', desc: '定着している試験レベルの問題が10問', need: 10, coin: 8000 },
  { id: 'trivia-50', icon: '豆', name: '豆知識を50個集める', desc: '解いた問題の豆知識が50個', need: 50, coin: 5000 },
  { id: 'trivia-100', icon: '豆', name: '豆知識を100個集める', desc: '解いた問題の豆知識が100個', need: 100, coin: 8000 },
  ...STREAK_MILESTONES.map((n) => ({ id: `streak-${n}`, icon: `${n}日`, name: `${n}日連続`, desc: `${n}日続けて解いた`, need: n, coin: STREAK_COIN[n] })),
];

// 実績ごとに、達成日（記録を古い順にたどって最初に条件を満たした日）と、未達成なら途中経過を返す
export function achievements(logs, data) {
  const qById = new Map((data?.questions || []).map((q) => [q.questionId, q]));
  const active = activeQuestions(data);
  const activeIds = new Set(active.map((q) => q.questionId));
  const unitTotal = new Map();
  const subjectUnits = new Map();
  for (const q of active) {
    unitTotal.set(q.unitId, (unitTotal.get(q.unitId) || 0) + 1);
    if (!subjectUnits.has(q.subjectId)) subjectUnits.set(q.subjectId, new Set());
    subjectUnits.get(q.subjectId).add(q.unitId);
  }
  const touchedUnits = new Map([...subjectUnits.keys()].map((s) => [s, new Set()]));
  const unitMastered = new Map([...unitTotal.keys()].map((u) => [u, new Set()]));
  const mastered = new Set();
  const examMastered = new Set();
  const trivia = new Set();
  const got = {};
  let date;
  let streakDay = null, streakRun = 0, streakBest = 0;
  const hit = (id) => (got[id] ??= date);

  const prog = questionProgress(logs, (l, p) => {
    date = localDate(new Date(l.answeredAt));
    if (date !== streakDay) {
      streakRun = streakDay && daysBetween(streakDay, date) === 1 ? streakRun + 1 : 1;
      streakBest = Math.max(streakBest, streakRun);
      streakDay = date;
      for (const n of STREAK_MILESTONES) if (streakRun >= n) hit(`streak-${n}`);
    }
    const q = qById.get(l.questionId);
    if (!q) return;
    if (l.result === '正解' && !isAssisted(l)) {
      hit('first-correct');
      if (q.level === '試験') hit('first-exam');
      if (p.maxGap >= 30) hit('gap30');
    }
    if (!activeIds.has(q.questionId)) return;
    if (q.trivia) trivia.add(q.questionId);
    touchedUnits.get(q.subjectId).add(q.unitId);
    for (const set of [mastered, unitMastered.get(q.unitId), ...(q.level === '試験' ? [examMastered] : [])]) {
      if (p.mastered) set.add(q.questionId);
      else set.delete(q.questionId);
    }
    if (p.mastered) {
      hit('first-mastered');
      if (p.lapses >= 2) hit('overcome');
    }
    if (unitTotal.get(q.unitId) >= 2 && unitMastered.get(q.unitId).size === unitTotal.get(q.unitId)) hit('unit-mastered');
    if (touchedUnits.get(q.subjectId).size === subjectUnits.get(q.subjectId).size) hit('subject-touched');
    for (const n of [10, 50, 100]) if (mastered.size >= n) hit(`mastered-${n}`);
    if (examMastered.size >= 10) hit('exam-10');
    for (const n of [50, 100]) if (trivia.size >= n) hit(`trivia-${n}`);
  });

  // 未達成の実績の途中経過
  const best = (entries) => entries.sort((a, b) => b.have / b.need - a.have / a.need)[0] || null;
  const progress = {
    gap30: { have: Math.max(0, ...[...prog.values()].map((p) => p.maxGap)), need: 30 },
    'unit-mastered': best([...unitTotal].filter(([, t]) => t >= 2).map(([u, t]) => ({ unitId: u, have: unitMastered.get(u).size, need: t }))),
    'subject-touched': best([...subjectUnits].map(([s, us]) => ({ subjectId: s, have: touchedUnits.get(s).size, need: us.size }))),
    'exam-10': { have: examMastered.size, need: 10 },
  };
  for (const n of [10, 50, 100]) progress[`mastered-${n}`] = { have: mastered.size, need: n };
  for (const n of [50, 100]) progress[`trivia-${n}`] = { have: trivia.size, need: n };
  for (const n of STREAK_MILESTONES) progress[`streak-${n}`] = { have: streakBest, need: n };

  return ACHIEVEMENTS.map((a) => ({ ...a, achievedAt: got[a.id] || null, progress: got[a.id] ? null : progress[a.id] || null }));
}

// 結果画面：セッション前の記録（before）と後の記録（after）を比べる
export function sessionSummary(before, after, data, settings) {
  const pb = questionProgress(before);
  const pa = questionProgress(after);
  const prev = new Set(before.map((l) => l.logId));
  const sessionLogs = after.filter((l) => !prev.has(l.logId));
  const qById = new Map((data?.questions || []).map((q) => [q.questionId, q]));
  const qs = [...new Set(sessionLogs.map((l) => l.questionId))].map((id) => qById.get(id)).filter(Boolean);

  // 前に間違えた問題（セッション前の最後の回答が不正解・わからない）に正解した
  const recovered = sessionLogs.filter((l) => l.result === '正解' && !isAssisted(l) && ['不正解', 'わからない'].includes(pb.get(l.questionId)?.lastResult));
  const mastered = qs.filter((q) => pa.get(q.questionId)?.mastered && !pb.get(q.questionId)?.mastered);

  const active = activeQuestions(data);
  const units = [...new Set(qs.filter((q) => q.status === '出題中').map((q) => q.unitId))];
  const cb = correctIdSet(before);
  const ca = correctIdSet(after);
  const unlocks = [];
  const changes = [];
  for (const u of units) {
    const sb = unitUnlockStatus(u, active, cb, settings);
    const sa = unitUnlockStatus(u, active, ca, settings);
    for (const lv of ['応用', '試験']) if (!sb[lv].unlocked && sa[lv].unlocked) unlocks.push({ unitId: u, level: lv });
    const inUnit = active.filter((q) => q.unitId === u);
    const gb = groupProgress(inUnit, pb);
    const ga = groupProgress(inUnit, pa);
    if (shadeLevel(gb) !== shadeLevel(ga)) changes.push({ unitId: u, before: gb, after: ga });
  }

  const had = new Set(achievements(before, data).filter((a) => a.achievedAt).map((a) => a.id));
  const newAchievements = achievements(after, data).filter((a) => a.achievedAt && !had.has(a.id));

  // 外部試験の点が増えた年度・科目
  const eb = new Map(examScores(data, before).map((r) => [r.key, r]));
  const examGains = examScores(data, after)
    .filter((r) => r.got > (eb.get(r.key)?.got ?? 0))
    .map((r) => ({ ...r, gain: r.got - (eb.get(r.key)?.got ?? 0) }));
  // 継続日数：その日の最初のセッションで節目（3・7・14・30・100日）に達したら出す
  const day = sessionLogs.length ? localDate(new Date(sessionLogs[sessionLogs.length - 1].answeredAt)) : null;
  const sb = day ? streakInfo(before, day).current : 0;
  const streak = day ? streakInfo(after, day) : null;
  const streakMilestone = streak ? STREAK_MILESTONES.find((n) => sb < n && streak.current >= n) || null : null;
  // 通貨（このセットでもらった分の内訳）とレベル（1.4.0）
  const cb2 = coinTotals(coinEvents(before, data));
  const ca2 = coinTotals(coinEvents(after, data));
  const coins = Object.fromEntries(Object.keys(ca2).map((k) => [k, Math.max(0, ca2[k] - cb2[k])]));
  const level = { before: levelInfo(cb2.total).level, after: levelInfo(ca2.total).level };
  return { recovered: recovered.length, mastered, unlocks, changes, newAchievements, examGains, streak, streakMilestone, coins, level };
}

// カレンダー：端末の日付ごとの回答数
export function dailyCounts(logs) {
  const m = new Map();
  for (const l of logs) {
    const d = localDate(new Date(l.answeredAt));
    m.set(d, (m.get(d) || 0) + 1);
  }
  return m;
}

// ---- 外部試験の物差し：過去問の改題で「合格まであと何点」 ----
// data.exams = [{ examId, name, papers: [{ year, subject, full, pass }] }]
// 問題の examItem = { examId, year, subject, problem, blank, points }（過去問の空欄1つ分）
// 取れる点：最後に解いた結果が「正解」の空欄の点の合計（今の実力。間違えるとその空欄は数えない）

export function paperKey(e) {
  return `${e.examId}|${e.year}|${e.subject}`;
}

// 問題が1つ以上ある年度・科目ごとに { key, examId, examName, year, subject, full, pass, made, tried, got, items }
export function examScores(data, logs) {
  const rows = new Map();
  for (const ex of data?.exams || []) {
    for (const p of ex.papers || []) {
      const key = paperKey({ examId: ex.examId, ...p });
      rows.set(key, { key, examId: ex.examId, examName: ex.name, year: p.year, subject: p.subject, full: p.full, pass: p.pass, made: 0, tried: 0, got: 0, items: 0 });
    }
  }
  if (!rows.size) return [];
  const prog = questionProgress(logs);
  for (const q of activeQuestions(data)) {
    const r = q.examItem && rows.get(paperKey(q.examItem));
    if (!r) continue;
    r.made += q.examItem.points;
    r.items++;
    const p = prog.get(q.questionId);
    if (!p) continue;
    r.tried += q.examItem.points;
    if (p.lastResult === '正解') r.got += q.examItem.points;
  }
  return [...rows.values()].filter((r) => r.items > 0);
}

// 1問分の外部試験の情報（表示用）。定義がなければ null
export function examItemInfo(data, q) {
  const e = q.examItem;
  if (!e) return null;
  const ex = (data?.exams || []).find((x) => x.examId === e.examId);
  return ex ? { ...e, examName: ex.name, key: paperKey(e) } : null;
}

// ---- 通貨・レベル・称号・カード（1.4.0：要件定義書 4.10、設計図 1.10） ----
// もらった通貨は ANSWER_LOG と問題データから計算する（さかのぼって効く）。使った分はガチャの記録から

export const COIN = { correct: 100, mastered: 1000, examPerPoint: 100, gacha: 10000 };

// 通貨をもらったできごと（日付の順）。kind：correct（問題ごとに1日1回）／mastered（定着になった回答ごと）／
// exam（examItem のある問題に初めて正解。配点×100）／achievement（実績の coin）。不正解・わからないは0で、減ることもない
// 誘導つきの回答（1.7.0）：元の問題に正解したら correct は同じようにもらえる。exam・mastered は誘導なしの回答だけ
export function coinEvents(logs, data) {
  const qById = new Map((data?.questions || []).map((q) => [q.questionId, q]));
  const ev = [];
  const correctDay = new Set();
  const examDone = new Set();
  const was = new Map();
  questionProgress(logs, (l, p) => {
    const date = localDate(new Date(l.answeredAt));
    if (l.result === '正解') {
      const k = `${l.questionId}|${date}`;
      if (!correctDay.has(k)) {
        correctDay.add(k);
        ev.push({ kind: 'correct', amount: COIN.correct, date, questionId: l.questionId });
      }
      const e = qById.get(l.questionId)?.examItem;
      if (e && e.points > 0 && !examDone.has(l.questionId) && !isAssisted(l)) {
        examDone.add(l.questionId);
        ev.push({ kind: 'exam', amount: e.points * COIN.examPerPoint, date, questionId: l.questionId });
      }
    }
    if (p.mastered && !was.get(l.questionId)) ev.push({ kind: 'mastered', amount: COIN.mastered, date, questionId: l.questionId });
    was.set(l.questionId, p.mastered);
  });
  for (const a of achievements(logs, data)) {
    if (a.achievedAt && a.coin) ev.push({ kind: 'achievement', amount: a.coin, date: a.achievedAt, achievementId: a.id });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

export function coinTotals(events) {
  const t = { correct: 0, mastered: 0, exam: 0, achievement: 0, total: 0 };
  for (const e of events) {
    t[e.kind] += e.amount;
    t.total += e.amount;
  }
  return t;
}

// レベル：経験値＝もらった通貨の合計（使っても減らない）。Lv1→2 が 3,000、以後 2,000 ずつ増える
// （Lv2→3 は 5,000、Lv3→4 は 7,000）。Lv L に達する合計は 1000×(L²−1)
export const levelXp = (lv) => 1000 * (lv * lv - 1);
export function levelInfo(xp) {
  let level = Math.max(1, Math.floor(Math.sqrt(xp / 1000 + 1)));
  while (levelXp(level + 1) <= xp) level++;
  while (level > 1 && levelXp(level) > xp) level--;
  const base = levelXp(level);
  const next = levelXp(level + 1);
  return { level, xp, into: xp - base, need: next - base, toNext: next - xp };
}

// 財布：残高＝もらった合計 − 使った合計。ガチャ券はレベルが上がるたびに1枚（Lv L までに L−1 枚）
// gachaLog = [{ gachaId, at, cardId, paid: 'coin' | 'ticket', coins }]
// 1.5.0 から、系統の建設・試作の支出も同じ台帳に入れる：{ gachaId, at, kind: 'grid', cardId: null, paid: 'coin', coins, what }
export function wallet(logs, data, gachaLog = [], events = coinEvents(logs, data)) {
  const earned = coinTotals(events).total;
  const spent = gachaLog.reduce((a, g) => a + (g.coins || 0), 0);
  const lv = levelInfo(earned);
  const ticketsUsed = gachaLog.filter((g) => g.paid === 'ticket').length;
  return { earned, spent, balance: Math.max(0, earned - spent), ...lv, tickets: Math.max(0, lv.level - 1 - ticketsUsed) };
}

// 継続日数が n 日に初めて達した日（first[n]）
function streakFirstDates(logs) {
  const days = [...new Set(logs.map((l) => localDate(new Date(l.answeredAt))))].sort();
  const first = [];
  let run = 0, prev = null;
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    first[run] ??= d;
    prev = d;
  }
  return first;
}

export const HIDDEN_KEYS = ['midnight', 'idk3ThenCorrect'];

// 称号ごとに、最初に条件を満たした日。titleId → 'YYYY-MM-DD'（満たしていない称号は入らない）。
// コードにない条件（type・key）は無視する。cards：カードのデータ（seriesComplete 用）
// 1.8.2：gridRecord（kv「gridRecord」。系統で初めて起きたこと firsts・絵のアルバム album）で判定する種類 grid
//   { type: 'grid', key: 'era:3' など（firsts のキー）}・{ type: 'grid', key: 'album', n }（絵に n 枚出会った）・{ type: 'grid', key: 'incOk', n }（事故の問題に n 回正解）
// examPass・examScore は examPrefix（試験 ID の頭。'denken3-' など）と subject（科目名）で絞れる（試験 ID が増えても壊れない）。
//   examScore：{ examPrefix, subject?, ratio }（その試験のどれかの回・科目で、満点の ratio 以上）
export function titleDates(titles, { logs, data, gachaLog = [], cards = null, gridRecord = null }) {
  const res = new Map();
  const list = (titles || []).filter((t) => t?.titleId && t.condition && !t.retired);
  if (!list.length) return res;
  const of = (type) => list.filter((t) => t.condition.type === type);
  const set = (t, d) => d && !res.has(t.titleId) && res.set(t.titleId, d);

  if (of('achievement').length) {
    const got = new Map(achievements(logs, data).map((a) => [a.id, a.achievedAt]));
    for (const t of of('achievement')) set(t, got.get(t.condition.achievementId));
  }
  if (of('level').length) {
    let sum = 0;
    const reached = [];
    for (const e of coinEvents(logs, data)) {
      sum += e.amount;
      for (let lv = levelInfo(sum).level; lv >= 1 && !reached[lv]; lv--) reached[lv] = e.date;
    }
    for (const t of of('level')) set(t, reached[t.condition.level]);
  }
  if (of('streak').length) {
    const first = streakFirstDates(logs);
    for (const t of of('streak')) set(t, first.slice(t.condition.days).find(Boolean));
  }

  // 回答記録をたどって判定するもの：unitMastery・examPass・hidden
  const active = activeQuestions(data);
  const unitTitles = of('unitMastery')
    .map((t) => {
      const units = new Set(t.condition.unitIds || []);
      return { t, ids: new Set(active.filter((q) => units.has(q.unitId)).map((q) => q.questionId)) };
    })
    .filter((u) => u.ids.size > 0);
  const papers = new Map();
  for (const ex of data?.exams || []) for (const p of ex.papers || []) papers.set(paperKey({ examId: ex.examId, ...p }), { examId: ex.examId, subject: p.subject, pass: p.pass, full: p.full, got: 0, best: 0 });
  // 1.8.2 回・科目ごとの合格した日と、満点に対する割合の最高（日付の順）
  const paperPass = new Map(), paperRatio = [];
  const examQ = new Map(active.filter((q) => q.examItem && papers.has(paperKey(q.examItem))).map((q) => [q.questionId, q.examItem]));
  const mastered = new Set();
  const lastOk = new Map();
  const idk = new Map();
  let passDate = null, midnight = null, idk3 = null;
  questionProgress(logs, (l, p) => {
    const date = localDate(new Date(l.answeredAt));
    if (p.mastered) mastered.add(l.questionId);
    else mastered.delete(l.questionId);
    for (const u of unitTitles) {
      if (!res.has(u.t.titleId) && u.ids.has(l.questionId) && [...u.ids].every((id) => mastered.has(id))) set(u.t, date);
    }
    const e = examQ.get(l.questionId);
    if (e && !isAssisted(l)) {
      const r = papers.get(paperKey(e));
      const ok = l.result === '正解';
      if (ok !== !!lastOk.get(l.questionId)) r.got += ok ? e.points : -e.points;
      lastOk.set(l.questionId, ok);
      if (!passDate && r.got >= r.pass) passDate = date;
      if (r.got >= r.pass && !paperPass.has(paperKey(e))) paperPass.set(paperKey(e), date);
      if (r.full > 0 && r.got / r.full > r.best) (r.best = r.got / r.full), paperRatio.push({ r, ratio: r.best, date });
    }
    if (!midnight && new Date(l.answeredAt).getHours() < 4) midnight = date;
    if (l.result === 'わからない') idk.set(l.questionId, (idk.get(l.questionId) || 0) + 1);
    else if (l.result === '正解' && !idk3 && (idk.get(l.questionId) || 0) >= 3) idk3 = date;
  });
  const fit = (r, c) => (!c.examPrefix || r.examId.startsWith(c.examPrefix)) && (!c.subject || r.subject === c.subject);
  for (const t of of('examPass')) {
    const c = t.condition;
    if (!c.examPrefix && !c.subject) set(t, passDate);
    else set(t, [...paperPass].filter(([k]) => fit(papers.get(k), c)).map(([, d]) => d).sort()[0]);
  }
  for (const t of of('examScore')) {
    const c = t.condition;
    set(t, paperRatio.find((x) => fit(x.r, c) && x.ratio >= (c.ratio || 0))?.date);
  }
  for (const t of of('hidden')) set(t, { midnight, idk3ThenCorrect: idk3 }[t.condition.key]);

  // 1.8.2 系統の記録で判定する称号
  if (of('grid').length) {
    const rec = gridRecord || {};
    const album = Object.values(rec.album || {}).sort();
    const incOk = logs.filter((l) => l.result === '正解' && String(l.questionId).startsWith(`${GRID_SUBJECT}-`)).map((l) => localDate(new Date(l.answeredAt)))
      .sort();
    for (const t of of('grid')) {
      const c = t.condition;
      if (c.key === 'album') set(t, album[(c.n || 1) - 1]);
      else if (c.key === 'incOk') set(t, incOk[(c.n || 1) - 1]);
      else set(t, rec.firsts?.[c.key]);
    }
  }

  if (of('seriesComplete').length && cards) {
    const owned = new Set();
    const done = new Map();
    for (const g of [...gachaLog].sort((a, b) => a.at.localeCompare(b.at))) {
      if (!g.cardId) continue; // 系統の支出
      owned.add(g.cardId);
      for (const t of of('seriesComplete')) {
        if (done.has(t.titleId)) continue;
        const members = (cards.cards || []).filter((c) => c.seriesId === t.condition.seriesId && !c.retired);
        if (members.length && members.every((c) => owned.has(c.cardId))) done.set(t.titleId, localDate(new Date(g.at)));
      }
    }
    for (const t of of('seriesComplete')) set(t, done.get(t.titleId));
  }
  return res;
}

// ---- カード ----

// 持っているカード：cardId → 手に入れた日
export function ownedCards(gachaLog = []) {
  const m = new Map();
  for (const g of gachaLog) if (g.cardId && !m.has(g.cardId)) m.set(g.cardId, localDate(new Date(g.at)));
  return m;
}

// 最近（今日を含めて14日）定着した問題がある科目
export function recentMasteredSubjects(logs, data, today, days = 14) {
  const qById = new Map((data?.questions || []).map((q) => [q.questionId, q]));
  const s = new Set();
  for (const e of coinEvents(logs, data)) {
    if (e.kind !== 'mastered' || daysBetween(e.date, today) >= days) continue;
    const q = qById.get(e.questionId);
    if (q) s.add(q.subjectId);
  }
  return s;
}

export const RARITY_WEIGHT = { 1: 60, 2: 30, 3: 10 };

// ガチャに出るカード：持っていないもの（重複は出さない）。ファイルからなくなったカード（retired）は出さない
export function gachaPool(cards, owned) {
  return (cards?.cards || []).filter((c) => !c.retired && !owned.has(c.cardId));
}

// 出やすさ：レア度の重み。関係する科目で最近14日に定着した問題があれば2倍
export function cardWeight(card, recentSubjects) {
  return (RARITY_WEIGHT[card.rarity] || 1) * ((card.subjectIds || []).some((s) => recentSubjects.has(s)) ? 2 : 1);
}

// 1枚引く。持っていないカードがなければ null（入荷待ち）
export function drawCard(cards, owned, recentSubjects, rng = Math.random) {
  const pool = gachaPool(cards, owned);
  return pool.length ? weightedPick(pool, (c) => cardWeight(c, recentSubjects), rng) : null;
}

// 覚醒の判定に使う問題の集まり：unitIds（空なら subjectIds）の出題中の問題
export function cardGroup(card, data, prog) {
  const units = new Set(card.unitIds || []);
  const subjects = new Set(card.subjectIds || []);
  const qs = activeQuestions(data).filter((q) => (units.size ? units.has(q.unitId) : subjects.has(q.subjectId)));
  return groupProgress(qs, prog);
}

// 覚醒の条件：関係する単元（なければ科目）の定着が半分以上（単元の色の段階 3 以上）。問題がまだなければ覚醒できない
export function canAwaken(card, data, prog) {
  const g = cardGroup(card, data, prog);
  return g.total > 0 && shadeLevel(g) >= 3;
}

// ---- カードと称号のデータ（問題データとは別のファイル。format: fukushu-cards） ----

export function validateCardFile(json) {
  if (json?.format !== 'fukushu-cards') return ['カードと称号のファイルではありません（format が違います）'];
  if (!Array.isArray(json.cards) || !Array.isArray(json.series) || !Array.isArray(json.titles)) return ['series / cards / titles がありません'];
  const errors = [];
  const series = new Set(json.series.map((s) => s.seriesId));
  const seen = new Set();
  for (const c of json.cards) {
    const id = c.cardId || '(IDなし)';
    if (!c.cardId) errors.push('cardId のないカードがあります');
    if (seen.has(c.cardId)) errors.push(`${id}: IDが重複しています`);
    seen.add(c.cardId);
    if (![1, 2, 3].includes(c.rarity)) errors.push(`${id}: rarity が 1〜3 ではありません`);
    if (!series.has(c.seriesId)) errors.push(`${id}: シリーズが定義されていません`);
    if (c.image != null && !/^data:image\//.test(c.image)) errors.push(`${id}: image が data URI ではありません`);
  }
  const tseen = new Set();
  for (const t of json.titles) {
    const id = t.titleId || '(IDなし)';
    if (!t.titleId) errors.push('titleId のない称号があります');
    if (tseen.has(t.titleId)) errors.push(`${id}: IDが重複しています`);
    tseen.add(t.titleId);
    if (!t.condition?.type) errors.push(`${id}: condition がありません`);
  }
  return errors;
}

// 取り込み：cardId・titleId・seriesId で照合して置き換える。ファイルからなくなったカードは、
// 持っていれば retired にして残し（図鑑に残り、ガチャには出ない）、持っていなければ消す。称号は retired で残す
export function mergeCardData(current, incoming, ownedIds = new Set()) {
  const cur = current || { series: [], cards: [], titles: [] };
  const ids = (xs, k) => new Set(xs.map((x) => x[k]));
  const inCards = ids(incoming.cards, 'cardId');
  const inTitles = ids(incoming.titles, 'titleId');
  const inSeries = ids(incoming.series, 'seriesId');
  const curCards = ids(cur.cards, 'cardId');
  const keptCards = cur.cards.filter((c) => !inCards.has(c.cardId) && ownedIds.has(c.cardId)).map((c) => ({ ...c, retired: true }));
  const needSeries = new Set(keptCards.map((c) => c.seriesId));
  return {
    data: {
      format: 'fukushu-cards',
      series: [...incoming.series, ...cur.series.filter((s) => !inSeries.has(s.seriesId) && needSeries.has(s.seriesId))],
      cards: [...incoming.cards, ...keptCards],
      titles: [...incoming.titles, ...cur.titles.filter((t) => !inTitles.has(t.titleId)).map((t) => ({ ...t, retired: true }))],
    },
    summary: {
      added: incoming.cards.filter((c) => !curCards.has(c.cardId)).length,
      retired: cur.cards.filter((c) => !inCards.has(c.cardId) && !c.retired).length,
    },
  };
}
