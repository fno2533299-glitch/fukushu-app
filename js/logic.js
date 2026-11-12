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

export function activeQuestions(data) {
  return (data?.questions || []).filter((q) => q.status === '出題中');
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

export function pickNext(mode, ctx) {
  // さっと出題：期限の来た問題を先に、なければおまかせ
  if (mode === 'さっと') return pickNext('復習優先', ctx) || pickNext('おまかせ', ctx);
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
export function pickWarmup(ctx) {
  const rng = ctx.rng || Math.random;
  const due = candidates('復習優先', ctx).filter((q) => ctx.states[q.questionId].stage >= 1);
  if (due.length) {
    const ready = masteryReadyIds(ctx.logs, ctx.today);
    return pickAny(due.filter((q) => ready.has(q.questionId)), rng) || pickAny(due, rng);
  }
  const basic = candidates('おまかせ', ctx).filter((q) => q.level === '基礎' && ctx.states[q.questionId]?.stage !== 0);
  return pickOmakase(basic, ctx, rng) || pickNext('さっと', ctx);
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
  }
  return errors;
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
  return { data: { subjects, questions, map, exams }, summary };
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
export function questionProgress(logs, onStep) {
  const map = new Map();
  for (const l of logs) {
    const date = localDate(new Date(l.answeredAt));
    let p = map.get(l.questionId);
    if (!p) map.set(l.questionId, (p = { answered: 0, lapses: 0, mastered: false, maxGap: 0, lastResult: null, lastDate: null }));
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
    if (l.result === '正解') {
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
  const recovered = sessionLogs.filter((l) => l.result === '正解' && ['不正解', 'わからない'].includes(pb.get(l.questionId)?.lastResult));
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
      if (e && e.points > 0 && !examDone.has(l.questionId)) {
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
export function titleDates(titles, { logs, data, gachaLog = [], cards = null }) {
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
  for (const ex of data?.exams || []) for (const p of ex.papers || []) papers.set(paperKey({ examId: ex.examId, ...p }), { pass: p.pass, got: 0 });
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
    if (e) {
      const r = papers.get(paperKey(e));
      const ok = l.result === '正解';
      if (ok !== !!lastOk.get(l.questionId)) r.got += ok ? e.points : -e.points;
      lastOk.set(l.questionId, ok);
      if (!passDate && r.got >= r.pass) passDate = date;
    }
    if (!midnight && new Date(l.answeredAt).getHours() < 4) midnight = date;
    if (l.result === 'わからない') idk.set(l.questionId, (idk.get(l.questionId) || 0) + 1);
    else if (l.result === '正解' && !idk3 && (idk.get(l.questionId) || 0) >= 3) idk3 = date;
  });
  for (const t of of('examPass')) set(t, passDate);
  for (const t of of('hidden')) set(t, { midnight, idk3ThenCorrect: idk3 }[t.condition.key]);

  if (of('seriesComplete').length && cards) {
    const owned = new Set();
    const done = new Map();
    for (const g of [...gachaLog].sort((a, b) => a.at.localeCompare(b.at))) {
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
  for (const g of gachaLog) if (!m.has(g.cardId)) m.set(g.cardId, localDate(new Date(g.at)));
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
