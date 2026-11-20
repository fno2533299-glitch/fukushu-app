// 1.8.0 史実モードのミッション（E1〜E4）：データと答え合わせの文。画面と grid.js に依存しない（テストできるように分けた）
// 達成の判定（網をたどる計算）は grid.js の missionCheck・missionProgress。仕様は Code依頼_1.8.0_史実モードと自由モード.md の 4章
// 史実の値は出典で確かめたものだけ（S1〜S14）。cond の形：
//   { kind: 'dcLamp' }                             直流の火力から、町の電灯の需要に届く（前の日に、電灯のある町の需要の 90% 以上が直流から）
//   { kind: 'acPlant' }                            交流の発電機を初めて建てる（周波数を決める）
//   { kind: 'deliver', src, kv, km }               src（dc＝直流の火力／hydro＝水力／ac＝交流の発電所）から、電気が入っている線をたどって町に届く。
//                                                  その道のうち kv 以上の線の長さの合計が km 以上（直流は直流 200 V の線）。町は前の日の需要の 90% 以上に届いたこと
//   { kind: 'drought' }                            渇水の出来事の間（30日）、全域停電と負荷遮断がない
import * as J from './gridjapan.js';

export const MISSIONS = [
  {
    id: 'M01', era: 1, name: '町に電気を灯す', goal: '直流の石炭火力から、町の電灯の需要に届ける（1日の需要の 90% 以上）',
    cond: { kind: 'dcLamp' }, units: ['denken3-riron-U03'],
    hint: 'まずは町に直流の火力を建てる。電灯は夕方から夜に灯る',
    year: 1887, src: 'S1・S3・S8', conf: true,
  },
  {
    id: 'M02', era: 1, name: '直流の届く範囲', goal: '直流 200 V の線で、1 km 以上離れた町に届ける',
    cond: { kind: 'deliver', src: 'dc', kv: 0, km: 1 }, units: ['denken3-riron-U03'],
    hint: '直流の線は 200 V のまま。距離を伸ばすと損失がどうなるか、需給で見てみよう',
    year: null, short: '直流 200 V の届く範囲', text: '直流は電圧を変えられない。200 V で 50 kW を 1 km 送ると電流 250 A、損失は 12.5%（2 km なら 25%）。遠くへ送るには、変圧器で電圧を上げられる交流が要る',
    physics: true, src: '設計 v1（検算済み）', conf: true,
  },
  {
    id: 'M03', era: 2, name: '周波数を決める', goal: '交流の発電機を初めて建てる（50 Hz／60 Hz を決める）',
    cond: { kind: 'acPlant' }, units: ['circuit-b-U01', 'power-system-U03'],
    hint: '交流の発電機は、まだ周波数のない網に初めて建てるとき 50 Hz か 60 Hz を選ぶ。あとから変えられない',
    year: 1895, short: '50 Hz と 60 Hz の始まり', text: '1895年、浅草の火力が 50 Hz（ドイツ製）、1897年、大阪の幸町が 60 Hz（アメリカ製）。今の東西の周波数の始まり',
    src: 'S1・S2・S3', conf: true,
  },
  {
    id: 'M04', era: 2, name: '遠くの水力から町へ', goal: '水力の発電所から、変電所を通して 11 kV 以上の線で、20 km 以上離れた町に届ける',
    cond: { kind: 'deliver', src: 'hydro', kv: 11, km: 20 }, units: ['denken3-denryoku-U01', 'denken3-denryoku-U05', 'denken3-denryoku-U06'],
    hint: '11 kV 以上の送電線は、町の側に変電所（変圧器）が要る',
    year: 1891, short: '遠くの水力から町へ', text: '1891年、京都の蹴上で日本初の事業用の水力。1907年、駒橋から早稲田へ 55 kV・76 km で送電',
    src: 'S4・S7・S9・S10', conf: true,
  },
  {
    id: 'M05', era: 2, level: 5, name: '66 kV の長距離送電', goal: '66 kV 以上の線で 80 km 以上送って届ける',
    cond: { kind: 'deliver', src: 'ac', kv: 66, km: 80 }, units: ['denken3-denryoku-U06', 'power-system-U07'],
    hint: '66 kV は Lv5 から。損失は電圧の2乗に反比例',
    year: 1912, short: '66 kV の長距離送電', text: '1912年、下滝（鬼怒川）から東京へ 66 kV で送電。物理：66 kV で 30 MW を 80 km（力率 1）送ると損失は約 5.5%。損失は電圧の2乗に反比例する',
    physics: true, src: 'S6、設計 v1（検算済み）', conf: true,
  },
  {
    id: 'M06', era: 3, name: '110 kV で東京へ', goal: '110 kV 以上の線で 150 km 以上送って届ける',
    cond: { kind: 'deliver', src: 'ac', kv: 110, km: 150 }, units: ['denken3-denryoku-U06', 'denken2-denryoku-U06'],
    hint: '大正の 110 kV（猪苗代の 115 kV を表す）。長い線は雷の多い山を通るかどうかも見ておく',
    year: 1915, short: '110 kV の長距離送電', text: '1915年、猪苗代第一から東京へ 115 kV の長距離送電（年と電圧は確かめた。距離 約 227 km は未確認）',
    src: 'S6・G2', conf: 'part',
  },
  {
    id: 'M07', era: 4, name: '154 kV の送電幹線', goal: '154 kV の線で 200 km 以上送って届ける',
    cond: { kind: 'deliver', src: 'ac', kv: 154, km: 200 }, units: ['denken2-denryoku-U06', 'denken3-denryoku-U06'],
    hint: '154 kV は設計図「送電線 154 kV」が要る（電験2種 電力の送電の単元）',
    year: 1928, short: '154 kV の送電幹線', text: '1928年、日本電力の東京送電幹線 154 kV・293.6 km',
    src: 'S6', conf: true,
  },
  {
    id: 'M08', era: 4, name: '渇水をしのぐ', goal: '渇水の出来事の間（30日）、全域停電と負荷遮断を起こさない',
    cond: { kind: 'drought' }, units: ['denken3-denryoku-U01', 'power-system-U06'],
    hint: '渇水では水力が 4 割に落ちる。火力の予備を用意しておく（史実モードでは、昭和前期に入ったあとの夏に決まって起きる）',
    year: 1939, short: '1939年の渇水', text: '1939年、全国的な異常渇水と石炭不足で電力供給制限（制限率：関東 30%、関西 35%）。電力調整令。水力に頼りすぎた系統の弱点',
    src: 'S14', conf: true,
  },
];
export const missionOf = (id) => MISSIONS.find((m) => m.id === id) || null;
// 出典 S14（この版で足す。Code依頼_1.8.0 の出典）
export const SOURCE_S14 = ['S14', '電気事業連合会「電気の歴史年表 大正から昭和へ」', 'https://www.fepc.or.jp/enterprise/rekishi/taishou/'];

// 今の周波数（始める町。答え合わせで、選んだ周波数と並べる。今の境目の東が 50 Hz、西が 60 Hz）
export const NOW_HZ = { 'tk-nihonbashi': 50, sendai: 50, sapporo: 50, kobe: 60, kyoto: 60, osaka: 60, nagoya: 60, fukuoka: 60 };

// 答え合わせのカードの中身：{ year, text, src, conf, extra }。M01 は始めた町、M03 は選んだ周波数で変わる
// g：系統（start・plants の hz・missions.done の info だけを見る）
export function answerOf(m, g) {
  const base = { year: m.year, text: m.text || '', src: m.src, conf: m.conf, physics: !!m.physics, extra: '' };
  const start = g?.start || J.TOKYO;
  if (m.id === 'M01') {
    if (start === J.TOKYO) return { ...base, year: 1887, text: '1887年11月、東京電燈の第二電灯局（茅場町）が開業（直流）。日本の電気事業の始まり', src: 'S1', conf: true };
    const s = J.startOf(start);
    if (s?.conf) return { ...base, year: s.year, text: s.fact, src: s.src, conf: true };
    return { ...base, year: null, text: `${s?.label || 'この町'}の電気事業の始まり：年は未確認（史実の調べが出典で確かめられていない）。日本の電気事業の始まりは、1887年11月、東京電燈の第二電灯局（茅場町）の開業（直流）`, src: `${s?.src || 'G2'}・S1`, conf: false };
  }
  if (m.id === 'M03') {
    const info = g?.missions?.done?.M03?.info;
    const chosen = info?.hz || g?.plants?.find((p) => p.hz)?.hz || null;
    const now = NOW_HZ[start] || null;
    const label = J.startOf(start)?.label || '始めた町';
    const side = now === 50 ? '今の境目の東' : now === 60 ? '今の境目の西' : '';
    const extra = chosen && now ? `あなたが選んだ周波数：${chosen} Hz ／ ${label}の今の周波数：${now} Hz（${side}）${chosen === now ? '。今と同じ' : '。今とは逆'}` : chosen ? `あなたが選んだ周波数：${chosen} Hz` : '';
    return { ...base, extra };
  }
  return base;
}
// 再現した史実の年表の行（ミッションを達成したとき）
export const missionFact = (id) => {
  const m = missionOf(id);
  return m ? { year: m.year || null, short: m.short || m.name, conf: m.conf, mission: true } : null;
};
