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

function unitSubjectId(unitId) {
  return S.data?.subjects.find((s) => s.units.some((u) => u.unitId === unitId))?.subjectId;
}
// 単元名の（…）を省いた短い名前（タイル用）
function shortName(name) {
  return name.replace(/（.*?）/g, '');
}

// 定着（濃い）と学習中（薄い）の横棒
function barHtml(g) {
  const pct = (n) => (g.total ? (n / g.total) * 100 : 0);
  return `<span class="bar"><i class="bm" style="width:${pct(g.mastered)}%"></i><i class="bl" style="width:${pct(g.learning)}%"></i></span>`;
}

// ---- テーマ（シンプル／演出あり）と効果音 ----

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme === 'fx' ? 'fx' : 'simple';
}
const fx = () => S.settings.theme === 'fx';

// 効果音は Web Audio で作る（ファイルを同梱しない）。iPhone のマナーモードでは鳴らさない（ambient）
let audioCtx = null;
function primeAudio() {
  if (!fx()) return null;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}
function playCorrect() {
  const ac = primeAudio();
  if (!ac) return;
  try {
    const t = ac.currentTime + 0.02;
    [[880, 0], [1318.5, 0.08]].forEach(([f, d]) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28);
      o.connect(g).connect(ac.destination);
      o.start(t + d);
      o.stop(t + d + 0.3);
    });
  } catch {
    /* 音が出せなくても続ける */
  }
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

// ホームの一番上に出しておく「さっと出題」の1問目。答えるとそのままセットが始まる
function quickCardHtml() {
  if (!S.preview) {
    const q = L.pickWarmup(ctx()); // 1問目は始めやすい問題（期限が来て前回正解 → 基礎）
    S.preview = q ? { q, order: L.shuffle(q.choices) } : null;
  }
  if (!S.preview) return '<section class="card"><p class="note">いま出せる問題がありません（「出題対象の設定」を確認してください）</p></section>';
  const { q, order } = S.preview;
  return `<section class="card quick">
      <p class="spread small"><span>さっと${S.settings.quickSize}問 ・ 1問目</span><span class="lv lv-${q.level}">${q.level}</span></p>
      ${figureHtml(q)}
      <div class="stem">${rich(q.stem)}</div>
      <div class="choices">
        ${order.map((c, i) => `<button class="choice" data-qchoice="${esc(c.choiceId)}"><span class="mark">${'ABCD'[i]}</span><span>${rich(c.text)}</span></button>`).join('')}
      </div>
      <button class="btn idk" data-qidk>わからない</button>
    </section>`;
}

// 外部試験の「合格まであと何点」（行の一覧。compact はホーム用）
function examBar(r) {
  const pct = (n) => Math.min(100, (n / r.full) * 100);
  return `<span class="ebar"><i class="g" style="width:${pct(r.got)}%"></i><i class="r" style="width:${pct(r.made - r.got)}%"></i><b class="pass" style="left:${pct(r.pass)}%"></b></span>`;
}
function examLeft(r) {
  return r.got >= r.pass ? '<b class="ok">合格点に到達</b>' : `合格まで あと<b>${r.pass - r.got}</b>点`;
}

function examCardHtml() {
  const rows = L.examScores(S.data, S.logs);
  if (!rows.length) return '';
  const names = [...new Set(rows.map((r) => r.examName))];
  return `<button class="mapcard exam" data-go="exam">
      <span class="spread"><b>${esc(names.join('・'))}</b><span class="go">くわしく ›</span></span>
      ${rows
        .slice(0, 4)
        .map((r) => `<span class="erow"><span class="spread small"><span>${names.length > 1 ? esc(r.examName) + ' ' : ''}${esc(r.subject)}（${r.year}年）</span><span>${examLeft(r)}</span></span>${examBar(r)}</span>`)
        .join('')}
      ${rows.length > 4 ? `<span class="small">ほか ${rows.length - 4}件</span>` : ''}
    </button>`;
}

// 継続日数（今日まだ解いていなければ昨日まで）。途切れても責めない言い方にする
function streakHtml() {
  if (!S.logs.length) return '';
  const k = L.streakInfo(S.logs, today());
  const best = k.best > 1 ? ` ・ 最長 ${k.best}日` : '';
  return `<span class="streak">${k.current ? `継続 <b>${k.current}</b>日` : '今日解くと 1日目'}${best}</span>`;
}

function home() {
  stopTimer();
  S.reading = null;
  if (!S.data || L.activeQuestions(S.data).length === 0) return dataScreen();
  const due = L.countDue(ctx());
  const total = L.activeQuestions(S.data).length;
  const todayLogs = S.logs.filter((l) => L.localDate(new Date(l.answeredAt)) === today());
  const g = L.groupProgress(L.activeQuestions(S.data), L.questionProgress(S.logs));
  const ach = L.achievements(S.logs, S.data);
  const ready = [...L.masteryReadyByUnit(ctx()).values()].reduce((a, b) => a + b, 0);
  show(
    `<header class="top"><h1>復習アプリ</h1>${streakHtml()}</header>
    ${quickCardHtml()}
    ${examCardHtml()}
    <button class="mapcard" data-go="record">
      <span class="spread"><b>知識マップ</b><span class="go">記録を見る ›</span></span>
      ${barHtml(g)}
      <span class="spread small"><span>定着 ${g.mastered} ・ 学習中 ${g.learning} ／ ${g.total}問</span><span>実績 ${ach.filter((a) => a.achievedAt).length} / ${ach.length}</span></span>
      ${ready ? `<span class="small readyline"><span class="spark">✦</span> 今日解くと定着しそう ${ready}問</span>` : ''}
    </button>
    <section class="card stat">
      <div><span class="big">${due}</span><span>復習期限の問題</span></div>
      <div><span class="big">${todayLogs.length}</span><span>今日解いた問題</span></div>
      <div><span class="big">${total}</span><span>出題中の問題</span></div>
    </section>
    <nav class="menu">
      <button class="btn big" data-go="おまかせ">おまかせ<small>${S.settings.questionsPerSet}問</small></button>
      <button class="btn big" data-go="復習優先">復習優先<small>${due}問</small></button>
      <button class="btn big" data-go="select">科目・単元指定</button>
      <button class="btn big" data-go="read">読み流し<small>答えずに読むだけ・記録しない</small></button>
    </nav>
    <nav class="menu sub">
      <button class="btn" data-go="target">出題対象の設定</button>
      <button class="btn" data-go="data">データ管理</button>
    </nav>`,
    () => {
      bindFigureZoom();
      const quick = async (choiceId) => {
        const first = S.preview;
        S.preview = null;
        await startSession('さっと', null, first);
        answer(choiceId);
      };
      on('[data-qchoice]', 'click', (e) => {
        primeAudio(); // iPhone では、タップの直後でないと音を出す準備ができない
        quick(e.currentTarget.dataset.qchoice);
      });
      on('[data-qidk]', 'click', () => quick(null));
      on('[data-go]', 'click', (e) => {
        const g = e.currentTarget.dataset.go;
        if (g === 'select') selectScreen();
        else if (g === 'target') targetScreen();
        else if (g === 'data') dataScreen();
        else if (g === 'read') startReading();
        else if (g === 'record' || g === 'exam') {
          S.calMonth = null;
          recordScreen(g === 'exam' ? 'exam' : 'map');
        } else if (g === '復習優先' && due === 0) toast('期限の来た問題はありません');
        else startSession(g, null);
      });
    },
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
      <label class="row"><span>さっと出題・マップの単元から解くときの問題数</span><input type="number" min="1" max="20" inputmode="numeric" data-num="quickSize" value="${st.quickSize}"></label>
      <label class="row"><span>1セットの問題数（おまかせ・復習優先・指定）</span><input type="number" min="1" max="50" inputmode="numeric" data-num="questionsPerSet" value="${st.questionsPerSet}"></label>
      <label class="row"><span>時間の目安（分）</span><input type="number" min="1" max="60" inputmode="numeric" data-num="sessionMinutes" value="${st.sessionMinutes}"></label>
      <label class="row"><span>再出題の間隔（日）</span><input type="text" inputmode="numeric" data-intervals value="${st.intervals.join(',')}"></label>
    </section>
    <section class="card">
      <h2>テーマ</h2>
      <label class="row"><input type="radio" name="theme" value="simple" ${st.theme !== 'fx' ? 'checked' : ''}><span>シンプル<small>今のまま。出題中の演出なし</small></span></label>
      <label class="row"><input type="radio" name="theme" value="fx" ${st.theme === 'fx' ? 'checked' : ''}><span>演出あり<small>正解すると選択肢が光り、短い音が鳴る（マナーモードでは鳴らない）。結果画面の演出も少し強め</small></span></label>
    </section>`,
    () => {
      on('[data-back]', 'click', home);
      const save = () => {
        S.preview = null; // 出題対象が変わったら、ホームの1問目も選び直す
        return db.putKV('settings', S.settings);
      };
      on('input[name=theme]', 'change', (e) => {
        st.theme = e.target.value;
        applyTheme();
        if (fx()) playCorrect(); // どんな音か試しに鳴らす
        save();
      });
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

// ---- 記録：知識マップ・カレンダー・豆知識・実績（要件定義書 4.8、設計図 1.8） ----

const SHADE_FILL = ['var(--card)', 'var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)'];
const SHADE_LEGEND = `<p class="legend"><span><i class="u0"></i>未着手</span><span><i class="u1"></i>学習中</span><span><i class="u2"></i>定着 半分未満</span><span><i class="u3"></i>半分以上</span><span><i class="u4"></i>すべて定着</span></p>`;

function recordScreen(tab) {
  const tabs = [['map', 'マップ'], ...(L.examScores(S.data, S.logs).length ? [['exam', '試験']] : []), ['cal', 'カレンダー'], ['trivia', '豆知識'], ['ach', '実績']];
  const body = { map: mapTab, exam: examTab, cal: calendarTab, trivia: triviaTab, ach: achievementsTab }[tab]();
  show(
    `<header class="top"><button class="back" data-back>‹ ホーム</button><h1>記録</h1></header>
    <nav class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</nav>
    ${body.html}`,
    () => {
      on('[data-back]', 'click', home);
      on('[data-tab]', 'click', (e) => recordScreen(e.currentTarget.dataset.tab));
      body.bind?.();
    },
  );
}

// 辺の途中に点を足して少しずらし、海岸線らしいでこぼこにする（毎回同じ形になるよう乱数は使わない）
function roughen(pts) {
  return pts.flatMap((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const k = (((i * 7 + pts.length * 3) % 5) - 2) * 3; // -6〜+6
    return [p, [(p[0] + q[0]) / 2 + (dy / len) * k, (p[1] + q[1]) / 2 - (dx / len) * k]];
  });
}
// 輪郭の点をなめらかな閉曲線にする（Catmull-Rom → ベジェ）
function smoothPath(pts) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  let d = `M${P(0)[0]},${P(0)[1]}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d + 'Z';
}

// 全体マップ：島（分野）・町（科目）。問題データのある科目が登録済み、それ以外は点線の町（候補科目）
function mapSvg(map, stats) {
  const label = (name) => (name.length <= 6 ? [name] : [name.slice(0, Math.ceil(name.length / 2)), name.slice(Math.ceil(name.length / 2))]);
  let g = '';
  for (const r of map.regions) {
    const open = map.places.some((p) => p.region === r.id && stats.has(p.subjectId));
    g += `<path d="${smoothPath(roughen(r.pts))}" fill="var(--land)" stroke="var(--coast)" stroke-width="1.2" ${open ? '' : 'stroke-dasharray="3 4" opacity="0.55"'}/>`;
  }
  for (const r of map.regions) {
    g += `<text x="${r.lx}" y="${r.ly}" text-anchor="middle" font-size="10" font-weight="600" letter-spacing="3" fill="var(--muted)">${esc(r.name)}</text>`;
  }
  for (const p of map.places) {
    const st = stats.get(p.subjectId);
    const name = label(st ? st.name : p.name).map((t, i) => `<tspan x="${p.x}" dy="${i ? 10 : 0}">${esc(t)}</tspan>`).join('');
    const text = `<text y="${p.y + 25}" text-anchor="middle" font-size="8.5" font-weight="${st ? 600 : 400}" fill="var(--${st ? 'text' : 'muted'})" paint-order="stroke" stroke="var(--land)" stroke-width="4" stroke-linejoin="round">${name}</text>`;
    if (st) {
      const C = 2 * Math.PI * 13, r = st.g.total ? st.g.mastered / st.g.total : 0;
      g += `<g class="node" data-subj="${esc(p.subjectId)}">
        <circle cx="${p.x}" cy="${p.y}" r="20" fill="transparent"/>
        <circle cx="${p.x}" cy="${p.y}" r="13" fill="var(--card)" stroke="var(--line)" stroke-width="2.5"/>
        <circle cx="${p.x}" cy="${p.y}" r="13" fill="none" stroke="var(--m4)" stroke-width="2.5" stroke-dasharray="${C * r} ${C}" transform="rotate(-90 ${p.x} ${p.y})" stroke-linecap="round"/>
        <circle cx="${p.x}" cy="${p.y}" r="9" fill="${SHADE_FILL[L.shadeLevel(st.g)]}"/>${text}${st.ready ? `<text class="spark" x="${p.x - 15}" y="${p.y - 9}" font-size="12" text-anchor="middle">✦</text>` : ''}</g>`;
    } else {
      g += `<g class="node" data-cand="${esc(p.name)}" opacity="0.6">
        <circle cx="${p.x}" cy="${p.y}" r="18" fill="transparent"/>
        <circle cx="${p.x}" cy="${p.y}" r="10" fill="var(--land)" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="2.5 3"/>${text}</g>`;
    }
  }
  return `<svg class="kmap" viewBox="0 0 360 610" role="img" aria-label="知識マップ">${g}</svg>`;
}

function mapTab() {
  const prog = L.questionProgress(S.logs);
  const active = L.activeQuestions(S.data);
  const readyUnits = L.masteryReadyByUnit(ctx());
  const stats = new Map();
  for (const s of S.data.subjects) {
    const qs = active.filter((q) => q.subjectId === s.subjectId);
    const ready = s.units.reduce((a, u) => a + (readyUnits.get(u.unitId) || 0), 0);
    if (qs.length) stats.set(s.subjectId, { name: s.name, g: L.groupProgress(qs, prog), ready });
  }
  const all = L.groupProgress(active, prog);
  const map = S.data.map;
  return {
    html: `<section class="card map">
      <p class="spread small maphead"><span>定着 ${all.mastered} ・ 学習中 ${all.learning} ／ ${all.total}問</span></p>
      ${map ? mapSvg(map, stats) : '<p class="note">問題データを読み込み直すと、地図が表示されます</p>'}
      ${map ? `<p class="legend"><span>点線の町＝まだ問題がない科目</span><span>薄い島＝まだ科目がない分野</span>${readyUnits.size ? '<span><b class="spark">✦</b> 今日解くと定着しそうな問題がある</span>' : ''}</p>` : ''}
    </section>
    <section class="card">
      <h2>科目ごと</h2>
      ${[...stats]
        .map(([sid, st]) => `<button class="subjrow" data-subj="${esc(sid)}"><span class="spread"><b>${esc(st.name)}${st.ready ? ' <span class="spark">✦</span>' : ''}</b><span class="small">定着 ${st.g.mastered} ・ 学習中 ${st.g.learning} ／ ${st.g.total}問 ›</span></span>${barHtml(st.g)}</button>`)
        .join('')}
    </section>`,
    bind: () => {
      on('[data-subj]', 'click', (e) => subjectMapScreen(e.currentTarget.dataset.subj));
      on('[data-cand]', 'click', (e) => toast(`${e.currentTarget.dataset.cand}は、まだ問題がない科目です`));
    },
  };
}

// 単元のタイル。sub は上に小さく出す科目名、chips は解放したレベルの印
function tileLabel(g) {
  return g.touched ? `定着 ${g.mastered}/${g.total}` : '未着手';
}
// button：押せるタイル（科目マップの「この単元を3問」）。spark：✦ の印（今日解くと定着しそう）
function unitTile(unitId, g, { sub = '', chips = '', button = false, spark = false, label = tileLabel(g), cls = '' } = {}) {
  const tag = button ? 'button' : 'div';
  return `<${tag} class="tile u${L.shadeLevel(g)}${cls ? ' ' + cls : ''}"${button ? ` data-unit="${esc(unitId)}"` : ''}>${spark ? '<span class="spark tsp">✦</span>' : ''}${sub ? `<span class="sj">${esc(sub)}</span>` : ''}<span class="nm">${esc(shortName(unitName(unitId)))}</span><span class="ft"><span class="lb">${label}</span>${chips ? `<span class="chips">${chips}</span>` : ''}</span></${tag}>`;
}

function subjectMapScreen(subjectId) {
  const s = subjectOf(subjectId);
  const prog = L.questionProgress(S.logs);
  const active = L.activeQuestions(S.data);
  const correct = L.correctIdSet(S.logs);
  const readyUnits = L.masteryReadyByUnit(ctx());
  const g = L.groupProgress(active.filter((q) => q.subjectId === subjectId), prog);
  const units = [...s.units].sort((a, b) => a.order - b.order);
  let withQ = 0, touched = 0;
  const tiles = units
    .map((u) => {
      const inUnit = active.filter((q) => q.unitId === u.unitId);
      if (!inUnit.length) return `<div class="tile none"><span class="nm">${esc(shortName(u.name))}</span><span class="ft">問題なし</span></div>`;
      const gu = L.groupProgress(inUnit, prog);
      withQ++;
      if (gu.touched) touched++;
      const st = L.unitUnlockStatus(u.unitId, active, correct, S.settings);
      const chips = L.LEVELS.map((lv, i) =>
        inUnit.some((q) => q.level === lv) ? `<span class="chip l${i + 1} ${st[lv].unlocked ? 'on' : ''}">${lv[0]}</span>` : '',
      ).join('');
      return unitTile(u.unitId, gu, { chips, button: true, spark: readyUnits.has(u.unitId) });
    })
    .join('');
  show(
    `<header class="top"><button class="back" data-back>‹ マップ</button><h1>${esc(s.name)}</h1></header>
    <section class="card">
      <p class="spread small"><span>定着 ${g.mastered} ・ 学習中 ${g.learning} ／ ${g.total}問</span><span>手を付けた単元 ${touched}/${withQ}</span></p>
      ${barHtml(g)}
    </section>
    ${SHADE_LEGEND}
    <div class="tiles">${tiles}</div>
    <p class="note center">単元を押すと、その単元を${S.settings.quickSize}問${readyUnits.size ? '<br><span class="spark">✦</span> 今日解くと定着しそうな問題がある単元' : ''}<br>基・応・試：段階解放で、おまかせに出るようになったレベル（灰色はまだ）</p>`,
    () => {
      on('[data-back]', 'click', () => recordScreen('map'));
      on('[data-unit]', 'click', (e) => startUnit(subjectId, e.currentTarget.dataset.unit));
    },
  );
}

// 科目マップの単元タイルから「この単元を3問」
function startUnit(subjectId, unitId) {
  const scope = { subjectId, unitId };
  if (!L.pickNext('単元', ctx({ scope }))) return toast('この単元で出せる問題がありません（レベルのON/OFFを確認してください）');
  startSession('単元', scope);
}

// 外部試験：過去問を改題した問題で測った「合格まであと何点」
function examTab() {
  const rows = L.examScores(S.data, S.logs);
  const groups = [...new Set(rows.map((r) => r.examName))];
  return {
    html: `${groups
      .map(
        (name) => `<section class="card"><h2>${esc(name)}</h2>${rows
          .filter((r) => r.examName === name)
          .map(
            (r) => `<div class="erow big">
              <p class="spread"><b>${esc(r.subject)}（${r.year}年）</b><span>${examLeft(r)}</span></p>
              ${examBar(r)}
              <p class="small">取れる点 ${r.got} ／ 合格 ${r.pass} ／ 満点 ${r.full}</p>
              <p class="small">問題がある範囲 ${r.made}点分（${r.items}問）・ 解いた範囲 ${r.tried}点分${r.made < r.pass ? ' ・ 合格点まで届くには、問題の追加が必要' : ''}</p>
            </div>`,
          )
          .join('')}</section>`,
      )
      .join('')}
    <p class="legend"><span><i class="g"></i>取れる点</span><span><i class="r"></i>まだ取れていない点</span><span><i class="n"></i>問題がまだない範囲</span><span><i class="p"></i>合格点</span></p>
    <p class="note">その年の過去問を空欄ごとに4択にした問題で測っています。最後に解いた結果が正解の空欄の点だけを足すので、間違えたり「わからない」を押したりした空欄は、次に正解するまで数えません。</p>`,
  };
}

function calendarTab() {
  const counts = L.dailyCounts(S.logs);
  const now = new Date();
  const first = S.logs.length ? new Date(S.logs[0].answeredAt) : now;
  const months = [];
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push([d.getFullYear(), d.getMonth() + 1]);
  }
  const idx = Math.min(Math.max(S.calMonth ?? months.length - 1, 0), months.length - 1);
  const [y, m] = months[idx];
  const days = new Date(y, m, 0).getDate();
  const lv = (n) => (!n ? '' : n <= 10 ? 'u1' : n <= 20 ? 'u2' : n <= 30 ? 'u3' : 'u4');
  const cells = Array.from({ length: new Date(y, m - 1, 1).getDay() }, () => '<span></span>');
  let nDays = 0, nQ = 0;
  for (let d = 1; d <= days; d++) {
    const key = L.localDate(new Date(y, m - 1, d));
    const c = counts.get(key) || 0;
    if (c) (nDays++, (nQ += c));
    cells.push(`<span class="d ${lv(c)} ${key === today() ? 'today' : ''}">${d}</span>`);
  }
  return {
    html: `<section class="card">
      <div class="calhead"><button data-cal="-1" ${idx === 0 ? 'disabled' : ''} aria-label="前の月">‹</button><b>${y}年${m}月</b><button data-cal="1" ${idx === months.length - 1 ? 'disabled' : ''} aria-label="次の月">›</button></div>
      <div class="cal">${'日月火水木金土'.split('').map((w) => `<span class="wd">${w}</span>`).join('')}${cells.join('')}</div>
      <p class="legend right"><span>少</span><span><i class="u1"></i><i class="u2"></i><i class="u3"></i><i class="u4"></i></span><span>多</span></p>
    </section>
    <section class="card stat">
      <div><span class="big">${nDays}</span><span>解いた日</span></div>
      <div><span class="big">${nQ}</span><span>解いた問題</span></div>
    </section>`,
    bind: () =>
      on('[data-cal]', 'click', (e) => {
        S.calMonth = idx + Number(e.currentTarget.dataset.cal);
        recordScreen('cal');
      }),
  };
}

function triviaTab() {
  const answered = new Set(S.logs.map((l) => l.questionId));
  const active = L.activeQuestions(S.data).filter((q) => q.trivia);
  const order = new Map(S.data.subjects.flatMap((s) => s.units.map((u) => [u.unitId, u.order])));
  const seenAll = active.filter((q) => answered.has(q.questionId)).length;
  const groups = S.data.subjects
    .map((s) => {
      const qs = active.filter((q) => q.subjectId === s.subjectId);
      const seen = qs.filter((q) => answered.has(q.questionId)).sort((a, b) => order.get(a.unitId) - order.get(b.unitId));
      if (!qs.length) return '';
      return `<details class="card tvgroup" ${seen.length ? '' : 'data-empty'}>
        <summary class="spread"><b>${esc(s.name)}</b><span class="small">${seen.length} / ${qs.length}</span></summary>
        ${seen.map((q) => `<div class="tv"><p class="h">${esc(shortName(unitName(q.unitId)))} ・ ${esc(q.title)}</p><p class="b">${rich(q.trivia)}</p></div>`).join('') || '<p class="note">この科目の問題を解くと、ここに集まります</p>'}
      </details>`;
    })
    .join('');
  return { html: `<p class="note center">集めた豆知識 ${seenAll} / ${active.length}（問題を解くと、その問題の豆知識がここに集まります）</p>${groups}` };
}

function achievementsTab() {
  const list = L.achievements(S.logs, S.data);
  const fmt = (d) => d.split('-').map(Number).join('/');
  const detail = (a) => {
    const p = a.progress;
    if (!p) return esc(a.desc);
    if (a.id === 'gap30') return `いちばん長くあけて正解：${p.have}日`;
    if (a.id === 'unit-mastered') return `いちばん近い単元：${esc(subjectOf(unitSubjectId(p.unitId))?.name)}「${esc(shortName(unitName(p.unitId)))}」 ${p.have}/${p.need}`;
    if (a.id === 'subject-touched') return `いちばん近い科目：${esc(subjectOf(p.subjectId)?.name)} ${p.have}/${p.need}単元`;
    return `${p.have} / ${p.need}`;
  };
  return {
    html: `<p class="note center">達成 ${list.filter((a) => a.achievedAt).length} / ${list.length}</p>
    <section class="card">${list
      .map(
        (a) => `<div class="ach ${a.achievedAt ? '' : 'yet'}">
          <span class="ic">${esc(a.icon)}</span>
          <span><b>${esc(a.name)}</b><small>${a.achievedAt ? `${esc(a.desc)} ・ ${fmt(a.achievedAt)}` : detail(a)}</small>${a.progress ? `<span class="bar"><i class="bm" style="width:${Math.min(100, (a.progress.have / a.progress.need) * 100)}%"></i></span>` : ''}</span>
        </div>`,
      )
      .join('')}</section>`,
  };
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
  if (ss.timeNotified || isShort(ss.mode)) return;
  if (Date.now() - ss.startMs >= S.settings.sessionMinutes * 60000) {
    ss.timeNotified = true;
    banner.className = 'banner time';
    banner.innerHTML = `${S.settings.sessionMinutes}分たったよ。キリのいいところで終わろう <button aria-label="閉じる">×</button>`;
    banner.hidden = false;
    banner.querySelector('button').onclick = () => (banner.hidden = true);
  }
}

// さっと出題と「この単元を3問」は短いセット（7分の通知なし、結果画面は「もう3問」「終わる」）
const isShort = (mode) => mode === 'さっと' || mode === '単元';

// first：ホームに出しておいた1問目（さっと出題）。あれば、その問題から始める
async function startSession(mode, scope, first = null) {
  const now = new Date();
  const rec = { sessionId: uid(), mode, scope: scope || null, startedAt: now.toISOString(), endedAt: null };
  const size = isShort(mode) ? S.settings.quickSize : S.settings.questionsPerSet;
  S.session = { ...rec, rec, size, startMs: now.getTime(), asked: [], results: [], timeNotified: false };
  banner.hidden = true;
  S.sessions.push(rec);
  await db.put('sessions', rec);
  stopTimer();
  timerId = setInterval(checkTimer, 1000);
  if (first) {
    S.session.asked.push(first.q.questionId);
    S.session.current = { ...first };
    return;
  }
  nextQuestion();
}

function sessionCtx() {
  return ctx({ asked: new Set(S.session.asked), scope: S.session.scope });
}

function nextQuestion() {
  const ss = S.session;
  if (ss.asked.length >= ss.size) return endSession();
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
  const hideTags = ss.mode === 'おまかせ' || ss.mode === 'さっと'; // 単元から始めたときは出す
  show(
    `<header class="quizbar"><span>${ss.asked.length} / ${ss.size}</span><span class="lv lv-${q.level}">${q.level}</span><span class="clock">${elapsed()}</span><button class="btn small" data-end>終了</button></header>
    ${metaHtml(q, hideTags)}
    ${figureHtml(q)}
    <div class="stem">${rich(q.stem)}</div>
    <div class="choices">
      ${order.map((c, i) => `<button class="choice" data-choice="${esc(c.choiceId)}"><span class="mark">${'ABCD'[i]}</span><span>${rich(c.text)}</span></button>`).join('')}
    </div>
    <button class="btn idk" data-idk>わからない</button>`,
    () => {
      bindFigureZoom();
      on('[data-choice]', 'click', (e) => {
        primeAudio();
        answer(e.currentTarget.dataset.choice);
      });
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
  if (result === '正解') playCorrect(); // 演出ありのときだけ鳴る。不正解・わからないでは鳴らさない
  // 解説画面に出す単元のタイル：この回答の前と後の定着の状況
  const inU = L.activeQuestions(S.data).filter((x) => x.unitId === q.unitId);
  const tileBefore = L.groupProgress(inU, L.questionProgress(S.logs));
  S.logs.push(log);
  S.states[q.questionId] = state;
  ss.results.push({ q, result });
  ss.current.choiceId = choiceId;
  ss.current.result = result;
  ss.current.tile = inU.length ? { before: tileBefore, after: L.groupProgress(inU, L.questionProgress(S.logs)) } : null;
  answerScreen();
  await db.saveAnswer(log, state);
}

function answerScreen() {
  const ss = S.session;
  const { q, order, choiceId, result, tile } = ss.current;
  const cls = { 正解: 'ok', 不正解: 'ng', わからない: 'idk' }[result];
  const label = { 正解: '正解！', 不正解: '不正解', わからない: 'わからない' }[result];
  const last = ss.asked.length >= ss.size;
  const ex = L.examItemInfo(S.data, q);
  let gain = '';
  if (ex && result === '正解') {
    const r = L.examScores(S.data, S.logs).find((x) => x.key === ex.key);
    if (r) gain = `<p class="egain">${esc(r.subject)}（${r.year}年）の ${ex.points}点を確保 ・ ${examLeft(r)}</p>`;
  }
  show(
    `<header class="quizbar"><span>${ss.asked.length} / ${ss.size}</span><span class="lv lv-${q.level}">${q.level}</span><span class="clock">${elapsed()}</span><button class="btn small" data-end>終了</button></header>
    <div class="verdict ${cls}">${label}</div>
    ${gain}
    <div class="choices done">
      ${order
        .map((c, i) => {
          const k = c.choiceId === q.correctChoiceId ? `correct${result === '正解' ? ' flash' : ''}` : c.choiceId === choiceId ? 'wrong' : '';
          return `<div class="choice ${k}"><span class="mark">${'ABCD'[i]}</span><span>${rich(c.text)}</span></div>`;
        })
        .join('')}
    </div>
    <section class="card expl"><h2>解説</h2><p>${rich(q.explanation)}</p></section>
    ${q.trivia ? `<section class="card trivia"><h2>豆知識</h2><p>${rich(q.trivia)}</p></section>` : ''}
    <details class="stem-again"><summary>問題文${q.figure ? 'と図' : ''}を見る</summary>${figureHtml(q)}<div class="stem">${rich(q.stem)}</div></details>
    ${tile ? `<div class="unitnow">${unitTile(q.unitId, tile.before, { sub: subjectOf(q.subjectId)?.name, label: unitNowLabel(tile.before), cls: 'mini' })}</div>` : ''}
    <section class="info">
      <p><b>${esc(q.title)}</b></p>
      <p>${esc(subjectOf(q.subjectId)?.name)} ／ ${esc(unitName(q.unitId))}${(q.subUnitIds || []).map((u) => '・' + esc(unitName(u))).join('')}</p>
      <p>${esc(q.kind)}${(q.tags || []).length ? ' ／ 関連：' + q.tags.map(esc).join('・') : ''}${q.examRelevant ? ' ／ <span class="tag ok">試験で出題</span>' : ''}</p>
      ${ex ? `<p><span class="tag exam">${esc(ex.examName)} ${ex.year}年 ${esc(ex.subject)} ${esc(ex.problem || '')} ${esc(ex.blank || '')} ・ ${ex.points}点</span></p>` : ''}
      <p class="src">出典（${esc(q.sourceKind)}）：${esc(q.source)}</p>
      <p class="src">${esc(q.questionId)} 第${q.revision}版</p>
    </section>
    <div class="actions sticky">
      <button class="btn" data-report>疑問がある</button>
      <button class="btn primary big" data-next>${last ? '結果へ' : '次へ'}</button>
    </div>`,
    () => {
      bindFigureZoom();
      // 色の段階が変わったら、前の色から後の色へ（結果画面の「マップの変化」と同じ）
      const el = app.querySelector('.unitnow .tile');
      if (el && tile) {
        setTimeout(() => {
          const changed = L.shadeLevel(tile.before) !== L.shadeLevel(tile.after);
          el.className = `tile mini u${L.shadeLevel(tile.after)}${changed ? ' glow' : ''}`;
          el.querySelector('.lb').textContent = unitNowLabel(tile.after);
        }, 400);
      }
      on('[data-next]', 'click', nextQuestion);
      on('[data-end]', 'click', () => endSession());
      on('[data-report]', 'click', () => reportDialog(q));
    },
  );
}

function unitNowLabel(g) {
  return `定着 ${g.mastered} ／ 全 ${g.total}問`;
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
  ss.ended = true;
  ss.rec.endedAt = new Date().toISOString();
  await db.put('sessions', ss.rec);
  const n = (r) => ss.results.filter((x) => x.result === r).length;

  // マップの変化と「今回のよかったこと」（設計図 1.8）
  const sum = L.sessionSummary(S.logs.filter((l) => l.sessionId !== ss.sessionId), S.logs, S.data, S.settings);
  const unitLabel = (u) => `${subjectOf(unitSubjectId(u))?.name}「${shortName(unitName(u))}」`;
  const goods = [];
  if (sum.recovered) goods.push(['k1', '✓', `前に間違えた${sum.recovered}問に正解した`]);
  sum.mastered.slice(0, 3).forEach((q) => goods.push(['k2', '定', `「${q.title}」が定着した（7日以上あけて正解）`]));
  if (sum.mastered.length > 3) goods.push(['k2', '定', `ほかに${sum.mastered.length - 3}問が定着した`]);
  sum.unlocks.forEach((u) => goods.push(['k3', u.level[0], `${unitLabel(u.unitId)}で${u.level}レベルが出るようになった`]));
  sum.examGains.forEach((r) =>
    goods.push(['k4', '点', `${r.examName} ${r.subject}（${r.year}年）で +${r.gain}点 → ${r.got >= r.pass ? '合格点に到達！' : `合格まであと${r.pass - r.got}点`}`]),
  );
  // 継続日数の節目（3・7・14・30・100日）は1行にまとめる（実績と重ねて出さない）
  if (sum.streakMilestone) goods.push(['k6', '続', `${sum.streakMilestone}日続けて解いた！`, 'milestone']);
  sum.newAchievements
    .filter((a) => !(sum.streakMilestone && a.id.startsWith('streak-')))
    .forEach((a) => goods.push(['k5', '★', `実績「${a.name}」を達成`]));
  const changes = sum.changes.slice(0, 4);
  const short = isShort(ss.mode);
  const k = L.streakInfo(S.logs, today());
  const modeLabel = ss.mode === 'さっと' ? `さっと${ss.size}問` : ss.mode === '単元' ? `「${shortName(unitName(ss.scope.unitId))}」を${ss.size}問` : ss.mode;

  show(
    `<header class="top"><h1>セッション結果</h1></header>
    ${message ? `<p class="note center">${esc(message)}</p>` : ''}
    <section class="card stat">
      <div><span class="big ok">${n('正解')}</span><span>正解</span></div>
      <div><span class="big ng">${n('不正解')}</span><span>不正解</span></div>
      <div><span class="big idk">${n('わからない')}</span><span>わからない</span></div>
    </section>
    <p class="note center">${esc(modeLabel)} ／ ${elapsed()}</p>
    ${k.current ? `<p class="streakline${sum.streakMilestone ? ' hit' : ''}">継続 <b>${k.current}</b>日目${k.best > k.current ? ` ・ 最長 ${k.best}日` : ''}</p>` : ''}
    ${
      changes.length
        ? `<section class="card"><h2>マップの変化</h2><div class="tiles">${changes
            .map((c) => unitTile(c.unitId, c.before, { sub: subjectOf(unitSubjectId(c.unitId))?.name }))
            .join('')}</div></section>`
        : ''
    }
    ${
      goods.length
        ? `<section class="card"><h2>今回のよかったこと</h2><ul class="good">${goods
            .map(([k, mk, text, cls = '']) => `<li class="${cls}"><span class="mk ${k}">${esc(mk)}</span><span>${esc(text)}</span></li>`)
            .join('')}</ul></section>`
        : ''
    }
    <ul class="resultlist">
      ${ss.results.map((x) => `<li><span class="dot ${{ 正解: 'ok', 不正解: 'ng', わからない: 'idk' }[x.result]}"></span><span class="lv lv-${x.q.level}">${x.q.level}</span>${esc(x.q.title)}</li>`).join('')}
    </ul>
    <div class="actions">
      <button class="btn" data-home>${short ? '終わる' : 'ホームへ'}</button>
      <button class="btn primary big" data-again>${short ? `もう${ss.size}問` : 'もう1セット'}</button>
    </div>`,
    () => {
      // 単元の色を前の段階から後の段階へ変え、よかったことを1行ずつ出す
      const tiles = app.querySelectorAll('.tiles .tile');
      setTimeout(() => {
        changes.forEach((c, i) => {
          tiles[i].className = `tile u${L.shadeLevel(c.after)} glow`;
          tiles[i].querySelector('.lb').textContent = tileLabel(c.after);
        });
      }, 500);
      app.querySelectorAll('.good li').forEach((li, i) => setTimeout(() => li.classList.add('go'), 700 + i * 300));
      on('[data-home]', 'click', () => {
        S.session = null;
        banner.hidden = true;
        if (ss.mode === '単元') subjectMapScreen(ss.scope.subjectId); // マップから始めたら、マップに戻る
        else home();
      });
      on('[data-again]', 'click', () => {
        if (ss.mode === '復習優先' && L.countDue(ctx()) === 0) return toast('期限の来た問題はありません');
        if (ss.mode === 'さっと' && !L.pickNext('さっと', ctx())) return toast('いま出せる問題がありません');
        if (ss.mode === '単元' && !L.pickNext('単元', ctx({ scope: ss.scope }))) return toast('この単元で出せる問題がありません');
        startSession(ss.mode, ss.scope);
      });
    },
  );
}

// ---- 読み流し：答えずに問題と解説を読むだけ。何も記録しない（ANSWER_LOG・復習状態・定着・実績に影響しない） ----

function startReading() {
  stopTimer();
  banner.hidden = true;
  S.session = null;
  S.reading = { asked: [] };
  nextReading();
}

function nextReading() {
  const r = S.reading;
  // おまかせと同じ選び方（出題対象・段階解放・重み）。同じ問題は出さない
  const q = L.pickNext('おまかせ', ctx({ asked: new Set(r.asked) }));
  if (!q) {
    toast(r.asked.length ? '読み流せる問題がなくなりました' : 'いま出せる問題がありません');
    return home();
  }
  r.asked.push(q.questionId);
  r.q = q;
  r.order = L.shuffle(q.choices);
  readScreen();
}

function readScreen() {
  const { q, order, asked } = S.reading;
  const ex = L.examItemInfo(S.data, q);
  show(
    `<header class="quizbar"><span>読み流し ・ ${asked.length}問目</span><span class="lv lv-${q.level}">${q.level}</span><button class="btn small endbtn" data-end>終了</button></header>
    ${metaHtml(q, false)}
    ${figureHtml(q)}
    <div class="stem">${rich(q.stem)}</div>
    <div class="choices done">
      ${order.map((c, i) => `<div class="choice ${c.choiceId === q.correctChoiceId ? 'correct' : ''}"><span class="mark">${'ABCD'[i]}</span><span>${rich(c.text)}</span></div>`).join('')}
    </div>
    <section class="card expl"><h2>解説</h2><p>${rich(q.explanation)}</p></section>
    ${q.trivia ? `<section class="card trivia"><h2>豆知識</h2><p>${rich(q.trivia)}</p></section>` : ''}
    <section class="info">
      <p><b>${esc(q.title)}</b></p>
      <p>${esc(q.kind)}${(q.tags || []).length ? ' ／ 関連：' + q.tags.map(esc).join('・') : ''}${q.examRelevant ? ' ／ <span class="tag ok">試験で出題</span>' : ''}</p>
      ${ex ? `<p><span class="tag exam">${esc(ex.examName)} ${ex.year}年 ${esc(ex.subject)} ${esc(ex.problem || '')} ${esc(ex.blank || '')} ・ ${ex.points}点</span></p>` : ''}
      <p class="src">出典（${esc(q.sourceKind)}）：${esc(q.source)}</p>
      <p class="src">${esc(q.questionId)} 第${q.revision}版 ・ 読み流しは記録しません</p>
    </section>
    <div class="actions sticky">
      <button class="btn" data-report>疑問がある</button>
      <button class="btn primary big" data-next>次へ</button>
    </div>`,
    () => {
      bindFigureZoom();
      on('[data-next]', 'click', nextReading);
      on('[data-end]', 'click', home);
      on('[data-report]', 'click', () => reportDialog(q));
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
        S.preview = null;
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
  S.preview = null;
  applyTheme();
}

// しばらく閉じていたあとに開いたら、ホーム（さっと出題の1問目）から始める。解いている途中なら、そのまま続ける
const REOPEN_HOME_MS = 10 * 60000;
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  checkTimer();
  const away = hiddenAt != null && Date.now() - hiddenAt >= REOPEN_HOME_MS;
  hiddenAt = null;
  if (away && S.data && (!S.session || S.session.ended) && !S.reading && !document.querySelector('.modal, .zoom')) {
    S.session = null;
    banner.hidden = true;
    home();
  }
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
