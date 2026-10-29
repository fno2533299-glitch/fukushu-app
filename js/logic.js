// 出題・復習・段階解放・取り込みの計算（画面や保存に依存しない部分）
// 仕様：要件定義書 4章、設計図 1.2〜1.5

export const LEVELS = ['基礎', '応用', '試験'];

export const DEFAULT_SETTINGS = {
  levelEnabled: { 基礎: true, 応用: true, 試験: true },
  unlockThreshold: null, // null は「半数（切り上げ、最低1問）」
  sessionMinutes: 7,
  questionsPerSet: 10,
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

// ctx = { data, states, logs, settings, asked: Set, scope, today, rng }
export function candidates(mode, ctx) {
  const { settings, asked, states, today } = ctx;
  const active = activeQuestions(ctx.data).filter(
    (q) => settings.levelEnabled[q.level] && !asked.has(q.questionId),
  );
  if (mode === 'おまかせ') {
    const correct = correctIdSet(ctx.logs);
    const all = activeQuestions(ctx.data);
    const cache = new Map();
    const unlocked = (q) => {
      if (!cache.has(q.unitId)) cache.set(q.unitId, unitUnlockStatus(q.unitId, all, correct, settings));
      return cache.get(q.unitId)[q.level].unlocked;
    };
    return active.filter((q) => isTargeted(q, settings) && unlocked(q));
  }
  if (mode === '復習優先') {
    return active.filter((q) => isTargeted(q, settings) && isDue(states[q.questionId], today));
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

export function pickNext(mode, ctx) {
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
  if (mode === 'おまかせ') {
    // 科目間で配分してから、試験で出題された内容を多め、講義資料のみの内容を少なめに
    const subjects = [...new Set(list.map((q) => q.subjectId))];
    const sid = subjects[Math.floor(rng() * subjects.length)];
    const pool = list.filter((q) => q.subjectId === sid);
    return weightedPick(
      pool,
      (q) =>
        (q.examRelevant ? 2 : 1) * (q.sourceKind === '講義資料' && !q.examRelevant ? 0.5 : 1) * freshness(q, states, today),
      rng,
    );
  }
  return weightedPick(list, (q) => freshness(q, states, today), rng);
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
  return { data: { subjects, questions }, summary };
}
