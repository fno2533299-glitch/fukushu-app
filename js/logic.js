// 出題・復習・段階解放・取り込み・学習の記録の計算（画面や保存に依存しない部分）
// 仕様：要件定義書 4章、設計図 1.2〜1.5・1.8

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
  // 知識マップの地図は新しいファイルのもので置き換える。地図のない古いファイルなら今の地図を残す
  const map = incoming.map || cur.map || null;
  return { data: { subjects, questions, map }, summary };
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

export const ACHIEVEMENTS = [
  { id: 'first-correct', icon: '初', name: 'はじめての正解', desc: '1問正解する' },
  { id: 'first-mastered', icon: '定', name: 'はじめての定着', desc: '7日以上あけて解いても正解できた' },
  { id: 'first-exam', icon: '試', name: '試験レベルにはじめて正解', desc: '試験レベルの問題に正解する' },
  { id: 'overcome', icon: '克', name: '苦手を克服', desc: '2回以上間違えた問題が定着した' },
  { id: 'gap30', icon: '30', name: '30日あけても正解', desc: '正解のあと、30日以上あけて解いても正解' },
  { id: 'unit-mastered', icon: '全', name: '単元をまるごと定着', desc: '2問以上ある単元で、すべてが定着' },
  { id: 'subject-touched', icon: '科', name: '1科目の全単元に手を付ける', desc: 'ある科目のすべての単元で1問以上解いた' },
  { id: 'mastered-10', icon: '10', name: '定着10問', desc: '定着している問題が10問', need: 10 },
  { id: 'mastered-50', icon: '50', name: '定着50問', desc: '定着している問題が50問', need: 50 },
  { id: 'mastered-100', icon: '100', name: '定着100問', desc: '定着している問題が100問', need: 100 },
  { id: 'exam-10', icon: '試', name: '試験レベルを10問定着', desc: '定着している試験レベルの問題が10問', need: 10 },
  { id: 'trivia-50', icon: '豆', name: '豆知識を50個集める', desc: '解いた問題の豆知識が50個', need: 50 },
  { id: 'trivia-100', icon: '豆', name: '豆知識を100個集める', desc: '解いた問題の豆知識が100個', need: 100 },
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
  const hit = (id) => (got[id] ??= date);

  const prog = questionProgress(logs, (l, p) => {
    const q = qById.get(l.questionId);
    if (!q) return;
    date = localDate(new Date(l.answeredAt));
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
  return { recovered: recovered.length, mastered, unlocks, changes, newAchievements };
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
