// 端末内の保存（IndexedDB）。起動時に全部を読み込み、変更は1件ずつ書く
// kv: questionData（問題データ）・settings（本人の設定）・lastBackup（最終書き出し日時）
//     cardData（カードと称号のデータ）・gachaLog（ガチャの記録と系統の支出）・collection（覚醒した日・称号を手に入れた日）
//     grid（動く系統の状態。1.5.0）・gridDev（開発者モードの系統。1.5.1。バックアップには入れない）
//     gridDemo（デモの系統。1.5.3。バックアップには入れない）
//     gridFree（自由モードの系統。1.8.0）・gridMode（いま遊んでいるモード 'history'／'free'。1.8.0。なければ史実モード）
// reviewStates / answerLogs / sessions / issueReports: 学習データ（設計図 1.1）

const DB_NAME = 'fukushu-app';
const STORES = {
  kv: null,
  reviewStates: 'questionId',
  answerLogs: 'logId',
  sessions: 'sessionId',
  issueReports: 'reportId',
};

let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, keyPath ? { keyPath } : undefined);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAll() {
  const db = await open();
  const tx = db.transaction(Object.keys(STORES), 'readonly');
  const kv = tx.objectStore('kv');
  const [questionData, settings, lastBackup, cardData, gachaLog, collection, grid, gridFree, gridMode, states, answerLogs, sessions, issueReports] = await Promise.all([
    request(kv.get('questionData')),
    request(kv.get('settings')),
    request(kv.get('lastBackup')),
    request(kv.get('cardData')),
    request(kv.get('gachaLog')),
    request(kv.get('collection')),
    request(kv.get('grid')),
    request(kv.get('gridFree')),
    request(kv.get('gridMode')),
    request(tx.objectStore('reviewStates').getAll()),
    request(tx.objectStore('answerLogs').getAll()),
    request(tx.objectStore('sessions').getAll()),
    request(tx.objectStore('issueReports').getAll()),
  ]);
  return {
    questionData: questionData || null,
    settings: settings || null,
    lastBackup: lastBackup || null,
    cardData: cardData || null,
    gachaLog: gachaLog || [],
    collection: collection || null,
    grid: grid || null,
    gridFree: gridFree || null,
    gridMode: gridMode || null,
    reviewStates: Object.fromEntries(states.map((s) => [s.questionId, s])),
    answerLogs,
    sessions,
    issueReports,
  };
}

export async function getKV(key) {
  const db = await open();
  return request(db.transaction('kv', 'readonly').objectStore('kv').get(key));
}

export async function putKV(key, value) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return done(tx);
}

// 1.5.2：チュートリアルの練習の島（kv「gridTutorial」）を、終わったら消す
export async function delKV(key) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').delete(key);
  return done(tx);
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

// 回答1件分（記録と復習状態）を同じトランザクションで書く
export async function saveAnswer(log, state) {
  const db = await open();
  const tx = db.transaction(['answerLogs', 'reviewStates'], 'readwrite');
  tx.objectStore('answerLogs').put(log);
  tx.objectStore('reviewStates').put(state);
  return done(tx);
}

// バックアップからの復元：すべて消して入れ直す。
// カードと称号のデータ（cardData）は、バックアップになければ（1.3.0 以前のバックアップ）今のものを残す
// 開発者モードの系統（gridDev。1.5.1）・デモの系統（gridDemo。1.5.3）はバックアップに入れないので、今のものを残す（keepDev・keepDemo）
export async function replaceAll(backup, keepCardData = null, keepDev = null, keepDemo = null) {
  const db = await open();
  const tx = db.transaction(Object.keys(STORES), 'readwrite');
  for (const name of Object.keys(STORES)) tx.objectStore(name).clear();
  const kv = tx.objectStore('kv');
  if (backup.questionData) kv.put(backup.questionData, 'questionData');
  if (backup.settings) kv.put(backup.settings, 'settings');
  const cardData = backup.cardData || keepCardData;
  if (cardData) kv.put(cardData, 'cardData');
  if (Array.isArray(backup.gachaLog)) kv.put(backup.gachaLog, 'gachaLog');
  if (backup.collection) kv.put(backup.collection, 'collection');
  // 系統の状態（1.5.0）。古いバックアップにはないので、そのときは最初の島から始まる（支出の台帳も一緒に戻るため）
  if (backup.grid) kv.put(backup.grid, 'grid');
  // 1.8.0 自由モードの系統といまのモード。古いバックアップにはないので、そのときは自由モードの系統なし・史実モード
  if (backup.gridFree) kv.put(backup.gridFree, 'gridFree');
  if (backup.gridMode === 'free' && backup.gridFree) kv.put('free', 'gridMode');
  if (keepDev) kv.put(keepDev, 'gridDev');
  if (keepDemo) kv.put(keepDemo, 'gridDemo');
  for (const s of backup.reviewStates) tx.objectStore('reviewStates').put(s);
  for (const l of backup.answerLogs) tx.objectStore('answerLogs').put(l);
  for (const s of backup.sessions) tx.objectStore('sessions').put(s);
  for (const r of backup.issueReports) tx.objectStore('issueReports').put(r);
  return done(tx);
}
