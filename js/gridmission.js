// 1.8.0 史実モードのミッション（E1〜E4）：データと答え合わせの文。画面と grid.js に依存しない（テストできるように分けた）
// 達成の判定（網をたどる計算）は grid.js の missionCheck・missionProgress。仕様は Code依頼_1.8.0_史実モードと自由モード.md の 4章
// 史実の値は出典で確かめたものだけ（S1〜S14）。cond の形：
//   { kind: 'dcLamp' }                             直流の火力から、町の電灯の需要に届く（前の日に、電灯のある町の需要の 90% 以上が直流から）
//   { kind: 'acPlant' }                            交流の発電機を初めて建てる（周波数を決める）
//   { kind: 'deliver', src, kv, km }               src（dc＝直流の火力／hydro＝水力／ac＝交流の発電所）から、電気が入っている線をたどって町に届く。
//                                                  その道のうち kv 以上の線の長さの合計が km 以上（直流は直流 200 V の線）。町は前の日の需要の 90% 以上に届いたこと
//   { kind: 'drought' }                            渇水の出来事の間（30日）、全域停電と負荷遮断がない
//   { kind: 'drought', restrict: true }            1.10.0 そのうえ渇水の間に使用制限（A・B・C のどれか）を 1 日（24 時間）以上使った
//   { kind: 'kanmon' }                             1.10.0 下関と小倉・八幡を交流の線で結び、前の日にその線に電気が流れていた（脱調で切れていない）
//   { kind: 'hzConv' }                             1.10.0 周波数をそろえる工事を1つ終える
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
  // ---- 1.10.0 戦後復興（E4b）。出典 S14〜S18（gridjapan.js の SOURCES） ----
  {
    id: 'M09', era: 5, name: '275 kV 超高圧送電', goal: '275 kV の線で 200 km 以上送って届ける',
    cond: { kind: 'deliver', src: 'ac', kv: 275, km: 200 }, units: ['denken2-denryoku-U06', 'transmission-1-U02'],
    hint: '275 kV は設計図が要る（送電の試験レベル）。損失は電圧の2乗に反比例',
    year: 1952, short: '新北陸幹線 275 kV 超高圧送電', text: '1952年7月、新北陸幹線で日本初の超高圧 275 kV 送電（230 km）。同じとき枚方変電所（198,000 kVA）が竣工。物理：同じ 50 MW を 230 km 送っても、損失は 154 kV の約 5 分の 1（275 kV で 0.46%、154 kV で 2.42%）',
    physics: true, src: 'S16・S18、検算', conf: true,
  },
  {
    id: 'M10', era: 5, name: '関門海峡を越える', goal: '下関と小倉・八幡を交流の線で結び、その線に電気を流す（脱調で切れていない）',
    cond: { kind: 'kanmon' }, units: ['denken3-denryoku-U06', 'circuit-b-U13'],
    hint: '九州と本州の周波数がそろっているか、先に確かめよう。海峡を渡る線は 66 kV 以上',
    year: 1945, short: '関門連絡送電線', text: '1945年、関門連絡送電線が完成し、本州と九州の間で送電を始めた。両側の周波数がそろっていないと、つないだ瞬間に脱調する',
    src: 'S14', conf: true,
  },
  {
    id: 'M11', era: 5, name: '周波数をそろえる', goal: '周波数をそろえる工事を1つ終える',
    cond: { kind: 'hzConv' }, units: ['circuit-b-U13', 'power-system-U03'],
    hint: '網の発電所の詳細から始められる。工事の間は出力が 8 割になる',
    year: 1949, short: '九州の 60 Hz 統一', text: '九州では 50 Hz と 60 Hz が混ざっていたため、60 Hz にそろえる方針を立て、第1期（1949〜1951）・第2期（1954〜1960）の工事で統一した',
    src: 'S17', conf: true,
  },
  {
    id: 'M12', era: 5, name: '渇水を使用制限でしのぐ', goal: '渇水の出来事の間に使用制限（A・B・C のどれか）を 1 日以上使い、負荷遮断と全域停電を起こさない',
    cond: { kind: 'drought', restrict: true }, units: ['power-system-U06', 'power-system-U14'],
    hint: '渇水が来たら、運転のパネルの使用制限を選んでみよう（史実モードでは、戦後復興に入ったあとの夏に決まって起きる）',
    year: 1951, short: '1951年の渇水と使用制限', text: '1946年、電気需給調整規則。1951年夏の異常渇水のあと、1951〜1953年度は法的な使用制限（電灯電力の使用時間の指定・大口の使用量の制限・最大電力の指定）。中部電力では、制限で減ったとみられる量が 1951年度に 2.89億 kWh（販売電力量の 8%）',
    src: 'S15・S17', conf: true,
  },
  // ---- 1.11.0 高度成長・前半「火主水従」（E5）。出典 S15〜S17・S28〜S31 ----
  {
    id: 'M13', era: 6, name: '大きなダム', goal: '貯水池式の水力を1つ動かし、その電気を 100 km 以上離れた町に届ける',
    cond: { kind: 'deliver', src: 'dam', kv: 0, km: 100 }, units: ['denken3-denryoku-U01', 'generation-U02'],
    hint: 'ダムは 5 つの地点だけ。遠いので、送る線も考えよう',
    year: 1956, short: '佐久間など大型ダムの建設', text: '1956年4月、佐久間発電所（35万 kW）。続いて田子倉（1959）・奥只見（1960）・御母衣（1961）・黒部川第四（1963）。物理：池が大きいほど、渇水や季節の差をならせる',
    physics: true, src: 'S28・S29', conf: true,
  },
  {
    id: 'M14', era: 6, name: '重油専焼の大型火力', goal: '32.5万 kW 以上の重油火力を動かし、1日の発電の半分以上を出す',
    cond: { kind: 'oilHalf', minKw: 325000 }, units: ['denken2-denryoku-U02', 'generation-U06'],
    hint: '重油はタンカーで運ぶので、海沿いの町に建つ',
    year: 1961, short: '重油専焼の大型火力', text: '1961年、三重4号が初の重油専焼（12.5万 kW）。1965年、姫路第二2号（32.5万 kW、重油専焼）。1967年、姉崎1号が 1台 60万 kW で当時最大',
    src: 'S15・S16', conf: true,
  },
  {
    id: 'M15', era: 6, name: '火主水従', goal: '1年の記録（年の変わり目の決算）で、火力の発電電力量が水力を上回る',
    cond: { kind: 'thermalLead' }, units: ['power-system-U06', 'generation-U01'],
    hint: '燃料の安い大きな火力を増やすと、発電量の割合が変わる',
    year: 1962, short: '火主水従（火力が水力を上回る）', text: '1962年、全国の火力の発電量が水力を上回った。設備でも 1963年4月に火力 975万 kW が水力 944万 kW を超えた。理由：火力は大容量化・高効率化と燃料の値段の安定で経済性が上がり、水力は地点が奥地になって建設費と補償が重くなった',
    src: 'S30・S15・S17', conf: true,
  },
  {
    id: 'M16', era: 6, name: '500 kV へ上げる', goal: '「500 kV 設計・275 kV で使う」で建てた線を 500 kV に上げ、その線で 100 km 以上送って届ける',
    cond: { kind: 'deliver', src: 'ac', kv: 500, km: 100, upgraded: true }, units: ['denken2-denryoku-U06', 'transmission-1-U02'],
    hint: '設計図がなくても 500 kV 設計で建てておける。設計図が開いたら上げられる',
    year: 1966, short: '房総線 500 kV 設計・昇圧運用', text: '東京電力の房総線（新古河〜房総、85 km）は、1966年に 500 kV 設計のまま 275 kV で使い始め、1973年から 500 kV で送った。理由：急増する需要に応じて送電線の大容量化が必要になった',
    src: 'S31', conf: true,
  },
  // ---- 1.12.0 高度成長・後半「夏のピークと原子力」（E5）。出典 S15・S29・S34〜S38 ----
  {
    id: 'M17', era: 6, name: '夏の山', goal: '1年の記録で、夏の最大需要が冬の最大需要の 1.1 倍以上で、その夏に負荷遮断・全域停電がない',
    cond: { kind: 'summerPeak' }, units: ['generation-U01', 'power-system-U14'],
    hint: '冷房・家電の申し込みを受けると夏の昼が伸びる。夏の予備に気をつけよう',
    year: 1966, short: '夏の最大電力が冬を上回る', text: '1966年、関西電力で夏の最大電力（636万 4,000 kW）が初めて冬を上回った。1968年には9電力の合計でも夏が冬を上回った。ルームエアコンを持つ世帯は 1966年の 2% から 1975年に 17% へ',
    src: 'S15・S29・S35', conf: true,
  },
  {
    id: 'M18', era: 6, name: '揚水で山を受ける', goal: '揚水を1つ動かし、夜にくみ上げた電気を同じ日の昼（10〜17 時）に出す日を 7 日以上つくる',
    cond: { kind: 'pumpedCycle', days: 7 }, units: ['generation-U04', 'denken3-denryoku-U04'],
    hint: '夜の余りでくみ上げ、昼に出す。原子力と組むと燃料費がほぼかからない',
    year: 1970, short: '喜撰山・奥多々良木（純揚水発電）', text: '1970年7月、喜撰山発電所（23万 3,000 kW × 2）が国内初の純揚水式として運転を始めた。1975年、奥多々良木（121万 2,000 kW）が当時日本最大の揚水',
    src: 'S29', conf: true,
  },
  {
    id: 'M19', era: 6, name: '原子力の火をともす', goal: '原子力を1つ動かし、30 日以上続けて出す',
    cond: { kind: 'nucStreak', days: 30 }, units: ['generation-U08', 'denken3-denryoku-U03'],
    hint: '原子力は出力を変えられない。昼の山は火力と揚水で',
    year: 1966, short: '東海・敦賀・美浜（営業用の原子力発電）', text: '1966年、東海発電所が日本初の営業用の原子力発電所として一部運転を始めた。1970年、敦賀1号（初の軽水炉）・美浜1号。1978年11月、原子力の設備が 1,000万 kW を超えた',
    src: 'S15・S29・S34', conf: true,
  },
  {
    id: 'M20', era: 6, name: '石油危機を越える', goal: '石油危機の出来事の間に負荷遮断・全域停電がなく、危機のあとの1年の記録で、重油の発電の割合が危機の前の年より 10 ポイント以上下がる',
    cond: { kind: 'oilShockClear' }, units: ['power-system-U05', 'power-system-U15'],
    hint: '重油の割合を下げるには、LNG・原子力・石炭を足すか、重油を止める',
    year: 1973, short: '第1次石油ショックと脱石油', text: '1973年10月の第1次石油ショックで、石油・電力の使用節約（10%、1974年1月から 15%）。石油の発電の割合は 1975年度の 62.1% から 1979年度に 50.3% へ下がり、LNG（13.6%）と原子力（14.1%）が増えた',
    src: 'S34・S36・S38', conf: true,
  },
];
export const missionOf = (id) => MISSIONS.find((m) => m.id === id) || null;
// 出典 S14（この版で足す。Code依頼_1.8.0 の出典）。S15〜S19 は 1.10.0（gridjapan.js の SOURCES）
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
