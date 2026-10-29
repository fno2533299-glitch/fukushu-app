// 画面と操作（設計図 2章の画面遷移）
import * as db from './db.js';
import * as L from './logic.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');

const S = {
  data: null, // 問題データ { subjects, questions }
  settings: L.withDefaults(null),
  states: {},
  logs: [],
  sessions: [],
  reports: [],
  session: null,
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const today = () => L.localDate();

// ---- 表示の部品 ----

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 問題文などの書式：**太字**、改行、$数式$
function rich(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function renderMath(el) {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}

function show(html, after) {
  app.innerHTML = html;
  renderMath(app);
  window.scrollTo(0, 0);
  after?.();
}

function on(sel, ev, fn) {
  app.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
}

function figureHtml(q) {
  if (!q.figure) return '';
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q.figure);
  return `<button class="figure" data-zoom><img src="${src}" alt="図"></button>`;
}

function bindFigureZoom() {
  on('[data-zoom]', 'click', (e) => {
    const img = e.currentTarget.querySelector('img');
    const ov = document.createElement('div');
    ov.className = 'zoom';
    ov.innerHTML = `<img src="${img.src}" alt="図（拡大）"><p>タップで閉じる</p>`;
    ov.addEventListener('click', () => ov.remove());
    document.body.append(ov);
  });
}

function subjectOf(id) {
  return S.data?.subjects.find((s) => s.subjectId === id);
}
function unitName(unitId) {
  for (const s of S.data?.subjects || []) {
    const u = s.units.find((u) => u.unitId === unitId);
    if (u) return u.name;
  }
  return unitId;
}

function toast(msg) {
  banner.textContent = msg;
  banner.className = 'banner info';
  banner.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (banner.hidden = true), 3000);
}

function ctx(extra = {}) {
  return {
    data: S.data,
    states: S.states,
    logs: S.logs,
    settings: S.settings,
    asked: new Set(),
    today: today(),
    ...extra,
  };
}

// ---- ホーム ----

function home() {
  stopTimer();
  if (!S.data || L.activeQuestions(S.data).length === 0) return dataScreen();
  const due = L.countDue(ctx());
  const total = L.activeQuestions(S.data).length;
  const todayLogs = S.logs.filter((l) => L.localDate(new Date(l.answeredAt)) === today());
  show(
    `<header class="top"><h1>復習アプリ</h1></header>
    <section class="card stat">
      <div><span class="big">${due}</span><span>復習期限の問題</span></div>
      <div><span class="big">${todayLogs.length}</span><span>今日解いた問題</span></div>
      <div><span class="big">${total}</span><span>出題中の問題</span></div>
    </section>
    <nav class="menu">
      <button class="btn primary big" data-go="おまかせ">おまかせ</button>
      <button class="btn big" data-go="復習優先">復習優先<small>${due}問</small></button>
      <button class="btn big" data-go="select">科目・単元指定</button>
    </nav>
    <nav class="menu sub">
      <button class="btn" data-go="target">出題対象の設定</button>
      <button class="btn" data-go="data">データ管理</button>
    </nav>`,
    () =>
      on('[data-go]', 'click', (e) => {
        const g = e.currentTarget.dataset.go;
        if (g === 'select') selectScreen();
        else if (g === 'target') targetScreen();
        else if (g === 'data') dataScreen();
        else if (g === '復習優先' && due === 0) toast('期限の来た問題はありません');
        else startSession(g, null);
      }),
  );
}

// ---- 科目・単元・レベルの選択 ----

function selectScreen() {
  const subjects = S.data.subjects;
  const pre = S.lastScope;
  let subjectId = pre?.subjectId || subjects[0].subjectId;
  const levelsOn = L.LEVELS.filter((lv) => S.settings.levelEnabled[lv]);

  const render = () => {
    const subj = subjectOf(subjectId);
    const counts = (unitId) =>
      L.activeQuestions(S.data).filter((q) => [q.unitId, ...(q.subUnitIds || [])].includes(unitId)).length;
    const units = [...subj.units].sort((a, b) => a.order - b.order);
    show(
      `<header class="top"><button class="back" data-back>‹ ホーム</button><h1>科目・単元指定</h1></header>
      <section class="card">
        <h2>科目</h2>
        ${subjects
          .map(
            (s) =>
              `<label class="row"><input type="radio" name="subj" value="${esc(s.subjectId)}" ${s.subjectId === subjectId ? 'checked' : ''}>${esc(s.name)}</label>`,
          )
          .join('')}
      </section>
      <section class="card">
        <h2>単元 <button class="link" data-all>すべて</button><button class="link" data-none>解除</button></h2>
        ${units
          .map((u) => {
            const n = counts(u.unitId);
            const checked = pre?.subjectId === subjectId ? pre.unitIds.includes(u.unitId) : true;
            return `<label class="row ${n ? '' : 'muted'}"><input type="checkbox" name="unit" value="${esc(u.unitId)}" ${checked && n ? 'checked' : ''} ${n ? '' : 'disabled'}>${esc(u.name)}<span class="count">${n}問</span></label>`;
          })
          .join('')}
      </section>
      <section class="card">
        <h2>レベル</h2>
        ${levelsOn
          .map(
            (lv) =>
              `<label class="row"><input type="checkbox" name="level" value="${lv}" ${!pre || pre.levels.includes(lv) ? 'checked' : ''}>${lv}</label>`,
          )
          .join('')}
        ${levelsOn.length < 3 ? '<p class="note">OFFにしたレベルは「出題対象の設定」で戻せます</p>' : ''}
      </section>
      <div class="actions"><button class="btn primary big" data-start>開始</button></div>`,
      () => {
        on('[data-back]', 'click', home);
        on('input[name=subj]', 'change', (e) => {
          subjectId = e.target.value;
          render();
        });
        on('[data-all]', 'click', () => app.querySelectorAll('input[name=unit]:not(:disabled)').forEach((i) => (i.checked = true)));
        on('[data-none]', 'click', () => app.querySelectorAll('input[name=unit]').forEach((i) => (i.checked = false)));
        on('[data-start]', 'click', () => {
          const unitIds = [...app.querySelectorAll('input[name=unit]:checked')].map((i) => i.value);
          const levels = [...app.querySelectorAll('input[name=level]:checked')].map((i) => i.value);
          if (!unitIds.length || !levels.length) return toast('単元とレベルを1つ以上選んでください');
          const scope = { subjectId, unitIds, levels };
          if (!L.pickNext('科目・単元指定', ctx({ scope }))) return toast('この条件で出せる問題がありません');
          S.lastScope = scope;
          startSession('科目・単元指定', scope);
        });
      },
    );
  };
  render();
}

// ---- 出題対象の設定 ----

function targetScreen() {
  const st = S.settings;
  const all = L.activeQuestions(S.data);
  const correct = L.correctIdSet(S.logs);
  const unlockText = (unitId) => {
    const u = L.unitUnlockStatus(unitId, all, correct, st);
    return ['応用', '試験']
      .filter((lv) => all.some((q) => q.unitId === unitId && q.level === lv))
      .map((lv) =>
        u[lv].unlocked
          ? `<span class="tag ok">${lv} 解放</span>`
          : `<span class="tag">${lv} ${u[lv].have}/${u[lv].need}</span>`,
      )
      .join('');
  };
  show(
    `<header class="top"><button class="back" data-back>‹ ホーム</button><h1>出題対象の設定</h1></header>
    <section class="card">
      <h2>レベル（OFFはどのモードでも出しません）</h2>
      ${L.LEVELS.map(
        (lv) =>
          `<label class="row switch"><span>${lv}</span><input type="checkbox" data-level="${lv}" ${st.levelEnabled[lv] ? 'checked' : ''}></label>`,
      ).join('')}
    </section>
    ${S.data.subjects
      .map(
        (s) => `<section class="card">
        <label class="row switch"><h2>${esc(s.name)}</h2><input type="checkbox" data-subject="${esc(s.subjectId)}" ${st.subjectTarget[s.subjectId] !== false ? 'checked' : ''}></label>
        ${[...s.units]
          .sort((a, b) => a.order - b.order)
          .map((u) => {
            const n = all.filter((q) => q.unitId === u.unitId).length;
            return `<label class="row switch ${n ? '' : 'muted'}"><span>${esc(u.name)}<small>${n}問 ${unlockText(u.unitId)}</small></span><input type="checkbox" data-unit="${esc(u.unitId)}" ${st.unitTarget[u.unitId] !== false ? 'checked' : ''}></label>`;
          })
          .join('')}
      </section>`,
      )
      .join('')}
    <section class="card">
      <h2>段階解放（おまかせのみ）</h2>
      <p class="note">単元ごとに、下のレベルを何問正解したら次のレベルを出すか。「応用 1/2」は、まだ解放されていない応用の 正解数/必要数</p>
      <label class="row"><span>必要な正解数</span>
        <select data-threshold>
          <option value="" ${st.unlockThreshold == null ? 'selected' : ''}>半数（切り上げ）</option>
          ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${st.unlockThreshold === n ? 'selected' : ''}>${n}問</option>`).join('')}
        </select></label>
    </section>
    <section class="card">
      <h2>セット</h2>
      <label class="row"><span>1セットの問題数</span><input type="number" min="1" max="50" inputmode="numeric" data-num="questionsPerSet" value="${st.questionsPerSet}"></label>
      <label class="row"><span>時間の目安（分）</span><input type="number" min="1" max="60" inputmode="numeric" data-num="sessionMinutes" value="${st.sessionMinutes}"></label>
      <label class="row"><span>再出題の間隔（日）</span><input type="text" inputmode="numeric" data-intervals value="${st.intervals.join(',')}"></label>
    </section>`,
    () => {
      on('[data-back]', 'click', home);
      const save = () => db.putKV('settings', S.settings);
      on('[data-level]', 'change', (e) => {
        st.levelEnabled[e.target.dataset.level] = e.target.checked;
        save();
      });
      on('[data-subject]', 'change', (e) => {
        st.subjectTarget[e.target.dataset.subject] = e.target.checked;
        save();
      });
      on('[data-unit]', 'change', (e) => {
        st.unitTarget[e.target.dataset.unit] = e.target.checked;
        save();
      });
      on('[data-threshold]', 'change', (e) => {
        st.unlockThreshold = e.target.value ? Number(e.target.value) : null;
        save();
        targetScreen();
      });
      on('[data-num]', 'change', (e) => {
        const v = Math.round(Number(e.target.value));
        if (v >= 1) st[e.target.dataset.num] = v;
        else e.target.value = st[e.target.dataset.num];
        save();
      });
      on('[data-intervals]', 'change', (e) => {
        const v = e.target.value.split(/[,、\s]+/).filter(Boolean).map(Number);
        if (v.length && v.every((n) => Number.isInteger(n) && n > 0)) st.intervals = v;
        else toast('「1,3,7,14,30」のように正の整数をカンマで区切ってください');
        e.target.value = st.intervals.join(',');
        save();
      });
    },
  );
}

// ---- セッション・出題・解説 ----

let timerId = null;
function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}
function checkTimer() {
  const ss = S.session;
  if (!ss) return;
  const clock = app.querySelector('.clock');
  if (clock) clock.textContent = elapsed();
  if (ss.timeNotified) return;
  if (Date.now() - ss.startMs >= S.settings.sessionMinutes * 60000) {
    ss.timeNotified = true;
    banner.className = 'banner time';
    banner.innerHTML = `${S.settings.sessionMinutes}分たったよ。キリのいいところで終わろう <button aria-label="閉じる">×</button>`;
    banner.hidden = false;
    banner.querySelector('button').onclick = () => (banner.hidden = true);
  }
}

async function startSession(mode, scope) {
  const now = new Date();
  const rec = { sessionId: uid(), mode, scope: scope || null, startedAt: now.toISOString(), endedAt: null };
  S.session = { ...rec, rec, startMs: now.getTime(), asked: [], results: [], timeNotified: false };
  banner.hidden = true;
  S.sessions.push(rec);
  await db.put('sessions', rec);
  stopTimer();
  timerId = setInterval(checkTimer, 1000);
  nextQuestion();
}

function sessionCtx() {
  return ctx({ asked: new Set(S.session.asked), scope: S.session.scope });
}

function nextQuestion() {
  const ss = S.session;
  if (ss.asked.length >= S.settings.questionsPerSet) return endSession();
  const q = L.pickNext(ss.mode, sessionCtx());
  if (!q) return endSession(ss.asked.length === 0 ? '出せる問題がありません' : '');
  ss.asked.push(q.questionId);
  ss.current = { q, order: L.shuffle(q.choices) };
  questionScreen();
}

function metaHtml(q, hideTags) {
  if (hideTags) return '';
  return `<p class="meta">${esc(subjectOf(q.subjectId)?.name)} ／ ${esc(unitName(q.unitId))}</p>`;
}

function elapsed() {
  const s = Math.floor((Date.now() - S.session.startMs) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function questionScreen() {
  const ss = S.session;
  const { q, order } = ss.current;
  const hideTags = ss.mode === 'おまかせ';
  show(
    `<header class="quizbar"><span>${ss.asked.length} / ${S.settings.questionsPerSet}</span><span class="lv lv-${q.level}">${q.level}</span><span class="clock">${elapsed()}</span><button class="btn small" data-end>終了</button></header>
    ${metaHtml(q, hideTags)}
    ${figureHtml(q)}
    <div class="stem">${rich(q.stem)}</div>
    <div class="choices">
      ${order.map((c, i) => `<button class="choice" data-choice="${esc(c.choiceId)}"><span class="mark">${'ABCD'[i]}</span><span>${rich(c.text)}</span></button>`).join('')}
    </div>
    <button class="btn idk" data-idk>わからない</button>`,
    () => {
      bindFigureZoom();
      on('[data-choice]', 'click', (e) => answer(e.currentTarget.dataset.choice));
      on('[data-idk]', 'click', () => answer(null));
      on('[data-end]', 'click', () => {
        ss.asked.pop(); // 答えていない問題は出題しなかった扱い
        endSession();
      });
    },
  );
}

async function answer(choiceId) {
  const ss = S.session;
  const { q } = ss.current;
  const result = choiceId == null ? 'わからない' : choiceId === q.correctChoiceId ? '正解' : '不正解';
  const now = new Date();
  const log = {
    logId: uid(),
    questionId: q.questionId,
    sessionId: ss.sessionId,
    questionRevision: q.revision,
    answeredAt: now.toISOString(),
    result,
    selectedChoiceId: choiceId,
  };
  const state = L.nextReviewState(S.states[q.questionId], q.questionId, result, now, S.settings.intervals);
  S.logs.push(log);
  S.states[q.questionId] = state;
  ss.results.push({ q, result });
  ss.current.choiceId = choiceId;
  ss.current.result = result;
  answerScreen();
  await db.saveAnswer(log, state);
}

function answerScreen() {
  const ss = S.session;
  const { q, order, choiceId, result } = ss.current;
  const cls = { 正解: 'ok', 不正解: 'ng', わからない: 'idk' }[result];
  const label = { 正解: '正解！', 不正解: '不正解', わからない: 'わからない' }[result];
  const last = ss.asked.length >= S.settings.questionsPerSet;
  show(
    `<header class="quizbar"><span>${ss.asked.length} / ${S.settings.questionsPerSet}</span><span class="lv lv-${q.level}">${q.level}</span><span class="clock">${elapsed()}</span><button class="btn small" data-end>終了</button></header>
    <div class="verdict ${cls}">${label}</div>
    <div class="choices done">
      ${order
        .map((c, i) => {
          const k = c.choiceId === q.correctChoiceId ? 'correct' : c.choiceId === choiceId ? 'wrong' : '';
          return `<div class="choice ${k}"><span class="mark">${'ABCD'[i]}</span><span>${rich(c.text)}</span></div>`;
        })
        .join('')}
    </div>
    <section class="card expl"><h2>解説</h2><p>${rich(q.explanation)}</p></section>
    ${q.trivia ? `<section class="card trivia"><h2>豆知識</h2><p>${rich(q.trivia)}</p></section>` : ''}
    <details class="stem-again"><summary>問題文${q.figure ? 'と図' : ''}を見る</summary>${figureHtml(q)}<div class="stem">${rich(q.stem)}</div></details>
    <section class="info">
      <p><b>${esc(q.title)}</b></p>
      <p>${esc(subjectOf(q.subjectId)?.name)} ／ ${esc(unitName(q.unitId))}${(q.subUnitIds || []).map((u) => '・' + esc(unitName(u))).join('')}</p>
      <p>${esc(q.kind)}${(q.tags || []).length ? ' ／ 関連：' + q.tags.map(esc).join('・') : ''}${q.examRelevant ? ' ／ <span class="tag ok">試験で出題</span>' : ''}</p>
      <p class="src">出典（${esc(q.sourceKind)}）：${esc(q.source)}</p>
      <p class="src">${esc(q.questionId)} 第${q.revision}版</p>
    </section>
    <div class="actions sticky">
      <button class="btn" data-report>疑問がある</button>
      <button class="btn primary big" data-next>${last ? '結果へ' : '次へ'}</button>
    </div>`,
    () => {
      bindFigureZoom();
      on('[data-next]', 'click', nextQuestion);
      on('[data-end]', 'click', () => endSession());
      on('[data-report]', 'click', () => reportDialog(q));
    },
  );
}

function reportDialog(q) {
  const dlg = document.createElement('div');
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="sheet">
      <h2>この問題に疑問がある</h2>
      <p class="note">${esc(q.questionId)}（第${q.revision}版）${esc(q.title)}</p>
      <textarea rows="5" placeholder="どこが気になったか（任意）"></textarea>
      <div class="actions"><button class="btn" data-cancel>取り消し</button><button class="btn primary" data-save>保存</button></div>
    </div>`;
  document.body.append(dlg);
  dlg.querySelector('textarea').focus();
  dlg.querySelector('[data-cancel]').onclick = () => dlg.remove();
  dlg.querySelector('[data-save]').onclick = async () => {
    const rep = {
      reportId: uid(),
      questionId: q.questionId,
      questionRevision: q.revision,
      createdAt: new Date().toISOString(),
      memo: dlg.querySelector('textarea').value.trim(),
      resolved: false,
    };
    S.reports.push(rep);
    await db.put('issueReports', rep);
    dlg.remove();
    toast('疑問を記録しました');
  };
}

async function endSession(message = '') {
  const ss = S.session;
  stopTimer();
  ss.rec.endedAt = new Date().toISOString();
  await db.put('sessions', ss.rec);
  const n = (r) => ss.results.filter((x) => x.result === r).length;
  show(
    `<header class="top"><h1>セッション結果</h1></header>
    ${message ? `<p class="note center">${esc(message)}</p>` : ''}
    <section class="card stat">
      <div><span class="big ok">${n('正解')}</span><span>正解</span></div>
      <div><span class="big ng">${n('不正解')}</span><span>不正解</span></div>
      <div><span class="big idk">${n('わからない')}</span><span>わからない</span></div>
    </section>
    <p class="note center">${ss.mode} ／ ${elapsed()}</p>
    <ul class="resultlist">
      ${ss.results.map((x) => `<li><span class="dot ${{ 正解: 'ok', 不正解: 'ng', わからない: 'idk' }[x.result]}"></span><span class="lv lv-${x.q.level}">${x.q.level}</span>${esc(x.q.title)}</li>`).join('')}
    </ul>
    <div class="actions">
      <button class="btn" data-home>ホームへ</button>
      <button class="btn primary big" data-again>もう1セット</button>
    </div>`,
    () => {
      on('[data-home]', 'click', () => {
        S.session = null;
        banner.hidden = true;
        home();
      });
      on('[data-again]', 'click', () => {
        if (ss.mode === '復習優先' && L.countDue(ctx()) === 0) return toast('期限の来た問題はありません');
        startSession(ss.mode, ss.scope);
      });
    },
  );
}

// ---- データ管理 ----

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function saveFile(name, text, type = 'application/json') {
  const file = new File([text], name, { type });
  if (isIOS && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; // iOS では accept を付けると .json が選べないことがあるため付けない
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? await f.text() : null);
    };
    input.click();
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function dataScreen() {
  const has = !!S.data && S.data.questions.length > 0;
  const open = S.reports.filter((r) => !r.resolved);
  const qById = new Map((S.data?.questions || []).map((q) => [q.questionId, q]));
  show(
    `<header class="top">${has ? '<button class="back" data-back>‹ ホーム</button>' : ''}<h1>データ管理</h1></header>
    ${has ? '' : `<section class="card welcome"><h2>はじめに</h2><p>問題データ（.json）を読み込むと使えるようになります。iPhoneでは「ファイル」アプリ（Google Drive など）から選べます。</p></section>`}
    <section class="card">
      <h2>問題データ</h2>
      ${
        has
          ? S.data.subjects
              .map((s) => {
                const qs = S.data.questions.filter((q) => q.subjectId === s.subjectId);
                const c = (st) => qs.filter((q) => q.status === st).length;
                return `<p>${esc(s.name)}：出題中 ${c('出題中')}問${c('保留') ? `・保留 ${c('保留')}` : ''}${c('廃止') ? `・廃止 ${c('廃止')}` : ''}</p>`;
              })
              .join('') + `<p class="note">読み込み日時：${esc(new Date(S.data.importedAt).toLocaleString('ja-JP'))}</p>`
          : '<p class="note">まだありません</p>'
      }
      <button class="btn primary" data-import>問題データを読み込む</button>
    </section>
    <section class="card">
      <h2>バックアップ</h2>
      <p class="note">問題データ・学習履歴・設定を1つのファイルに書き出します。最終書き出し：${esc(S.lastBackup ? new Date(S.lastBackup).toLocaleString('ja-JP') : 'なし')}</p>
      <button class="btn" data-backup ${has ? '' : 'disabled'}>書き出し</button>
      <button class="btn" data-restore>復元</button>
    </section>
    <section class="card">
      <h2>疑問報告（未対応 ${open.length}件）</h2>
      ${
        S.reports.length
          ? `<ul class="reports">${[...S.reports]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((r) => {
                const q = qById.get(r.questionId);
                return `<li class="${r.resolved ? 'resolved' : ''}"><label><input type="checkbox" data-resolve="${esc(r.reportId)}" ${r.resolved ? 'checked' : ''}> 対応済み</label>
                <b>${esc(r.questionId)}</b> 第${r.questionRevision}版 ${esc(q?.title || '')}<br><small>${esc(new Date(r.createdAt).toLocaleString('ja-JP'))}</small>${r.memo ? `<p>${esc(r.memo)}</p>` : ''}</li>`;
              })
              .join('')}</ul>
             <button class="btn" data-export-reports>未対応の報告を書き出す</button>`
          : '<p class="note">まだありません</p>'
      }
    </section>
    <p class="note center">記録 ${S.logs.length}件 ／ 復習状態 ${Object.keys(S.states).length}問 ／ 版 ${esc(window.APP_VERSION || '')}</p>`,
    () => {
      on('[data-back]', 'click', home);
      on('[data-import]', 'click', importFlow);
      on('[data-backup]', 'click', exportBackup);
      on('[data-restore]', 'click', restoreFlow);
      on('[data-resolve]', 'change', async (e) => {
        const r = S.reports.find((x) => x.reportId === e.target.dataset.resolve);
        r.resolved = e.target.checked;
        await db.put('issueReports', r);
        dataScreen();
      });
      on('[data-export-reports]', 'click', exportReports);
    },
  );
}

async function importFlow() {
  const text = await pickFile();
  if (text == null) return;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return toast('JSONとして読めないファイルです');
  }
  const errors = L.validateQuestionFile(json);
  if (errors.length) {
    return show(
      `<header class="top"><h1>読み込めません</h1></header>
      <section class="card"><ul>${errors.slice(0, 20).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></section>
      <div class="actions"><button class="btn primary" data-ok>戻る</button></div>`,
      () => on('[data-ok]', 'click', dataScreen),
    );
  }
  const { data, summary } = L.mergeQuestionData(S.data, json);
  const list = (ids) => (ids.length ? `<p class="note">${ids.map(esc).join('、')}</p>` : '');
  show(
    `<header class="top"><h1>取り込み内容の確認</h1></header>
    <section class="card">
      <p>科目：${json.subjects.map((s) => esc(s.name)).join('、')}</p>
      <p>新規 <b>${summary.added.length}</b>問</p>${summary.added.length > 12 ? '' : list(summary.added)}
      <p>更新 <b>${summary.updated.length}</b>問</p>${list(summary.updated)}
      <p>廃止 <b>${summary.retired.length}</b>問</p>${list(summary.retired)}
      <p>変更なし ${summary.unchanged}問</p>
      <p class="note">学習履歴と設定は変わりません。</p>
    </section>
    <div class="actions"><button class="btn" data-cancel>取り消し</button><button class="btn primary big" data-ok>確定</button></div>`,
    () => {
      on('[data-cancel]', 'click', dataScreen);
      on('[data-ok]', 'click', async () => {
        data.importedAt = new Date().toISOString();
        S.data = data;
        await db.putKV('questionData', data);
        navigator.storage?.persist?.();
        toast('問題データを読み込みました');
        dataScreen();
      });
    },
  );
}

async function exportBackup() {
  const backup = {
    format: 'fukushu-backup',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    questionData: S.data,
    settings: S.settings,
    reviewStates: Object.values(S.states),
    answerLogs: S.logs,
    sessions: S.sessions,
    issueReports: S.reports,
  };
  await saveFile(`復習アプリ_バックアップ_${stamp()}.json`, JSON.stringify(backup));
  S.lastBackup = backup.exportedAt;
  await db.putKV('lastBackup', S.lastBackup);
  dataScreen();
}

async function restoreFlow() {
  const text = await pickFile();
  if (text == null) return;
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return toast('JSONとして読めないファイルです');
  }
  if (b?.format !== 'fukushu-backup') return toast('バックアップのファイルではありません');
  show(
    `<header class="top"><h1>バックアップから復元</h1></header>
    <section class="card">
      <p>書き出し日時：${esc(new Date(b.exportedAt).toLocaleString('ja-JP'))}</p>
      <p>問題 ${b.questionData?.questions?.length ?? 0}問 ／ 記録 ${b.answerLogs.length}件 ／ 疑問報告 ${b.issueReports.length}件</p>
      <p class="warn">今この端末にあるデータは、すべてこのバックアップの内容に置き換わります。</p>
    </section>
    <div class="actions"><button class="btn" data-cancel>取り消し</button><button class="btn primary big" data-ok>復元する</button></div>`,
    () => {
      on('[data-cancel]', 'click', dataScreen);
      on('[data-ok]', 'click', async () => {
        await db.replaceAll(b);
        await load();
        toast('復元しました');
        dataScreen();
      });
    },
  );
}

async function exportReports() {
  const qById = new Map(S.data.questions.map((q) => [q.questionId, q]));
  const lines = ['# 疑問報告', '', `書き出し：${new Date().toLocaleString('ja-JP')}`, ''];
  for (const r of S.reports.filter((x) => !x.resolved).sort((a, b) => a.questionId.localeCompare(b.questionId))) {
    const q = qById.get(r.questionId);
    lines.push(`## ${r.questionId}（報告時 第${r.questionRevision}版${q && q.revision !== r.questionRevision ? `、現在 第${q.revision}版` : ''}）${q?.title || ''}`);
    lines.push(`- 日時：${new Date(r.createdAt).toLocaleString('ja-JP')}`);
    lines.push(`- メモ：${r.memo || '（なし）'}`);
    if (q) lines.push(`- 問題文：${q.stem.replace(/\n/g, ' ')}`);
    lines.push('');
  }
  await saveFile(`疑問報告_${stamp()}.md`, lines.join('\n'), 'text/markdown');
}

// ---- 起動 ----

async function load() {
  const all = await db.loadAll();
  S.data = all.questionData;
  S.settings = L.withDefaults(all.settings);
  S.states = all.reviewStates;
  S.logs = all.answerLogs.sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  S.sessions = all.sessions;
  S.reports = all.issueReports;
  S.lastBackup = all.lastBackup;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkTimer();
});

try {
  await load();
  home();
} catch (e) {
  app.innerHTML = `<p class="warn">データを読み込めませんでした：${esc(e.message)}</p>`;
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js');
}

window.__app = { S, L, db, load, home }; // 動作確認用
