// 日本列島（1.6.0）の決まりと史実：始める町・エリアの開く順番・史実の線・時代のまとめの史実・出典の一覧
// 方針「規則と舞台は史実、選ぶのは自由、史実は答え合わせ」（Code依頼_1.6.0_日本列島.md）。画面に依存しない（テストできるように分けた）
// 史実の値は出典で確かめたものだけを「確かめた」とし、Gemini の調査（G1・G2）だけのものは「未確認」とする
import { JAPAN_NODES } from './japan.js';

export const TOKYO = 'tk-nihonbashi';
export const TOKYO_WARDS = JAPAN_NODES.filter((n) => n.area === '東京市内').map((n) => n.id);

// ---- 始める町（6章）。fact は確かめたものだけ。未確認の町は「年は未確認」とだけ出す ----
export const START_TOWNS = [
  { id: TOKYO, label: '東京（日本橋）', year: 1887, fact: '1887年11月、東京電燈の第二電灯局（茅場町）が開業（直流）。日本の電気事業の始まり', src: 'S1', conf: true },
  { id: 'kobe', label: '神戸', year: 1888, fact: '1888年9月、神戸電灯が開業（栄町発電所 40kW・直流）', src: 'S3', conf: true },
  { id: 'kyoto', label: '京都', year: 1889, fact: '1889年7月、京都電灯が開業（備前島発電所 50kW・直流）', src: 'S3', conf: true },
  { id: 'osaka', label: '大阪', year: 1889, fact: '1889年5月、大阪電灯が開業（西道頓堀発電所 30kW・交流 125Hz）。1897年に幸町で 60Hz の発電機が動き、西日本の 60Hz の始まり', src: 'S1・S2・S3', conf: true },
  { id: 'sendai', label: '仙台', year: 1888, fact: '1888年、三居沢で宮城紡績会社が工場の電灯に水力発電（自家用）', src: 'S8', conf: true },
  { id: 'nagoya', label: '名古屋', year: null, fact: '', src: 'G2', conf: false },
  { id: 'fukuoka', label: '福岡', year: null, fact: '', src: 'G2', conf: false },
  { id: 'sapporo', label: '札幌', year: null, fact: '', src: 'G1', conf: false },
];
export const startOf = (id) => START_TOWNS.find((s) => s.id === id) || null;

// ---- 建てられる範囲（3章）：地点をエリアにまとめ、時代（学習のレベル）でエリアが開く ----
// 史実に合わせて決めた順番（東京から・大阪から）。ほかの町からは、その町 → その町のエリア → 真ん中が 300 km 以内のエリア → 残り
const ORDER_TOKYO = { 東京市内: 1, 関東平野: 2, '相模川・山梨': 2, '鬼怒川・日光': 2, 利根川: 3, '猪苗代・福島': 3, 信越: 3 };
const ORDER_OSAKA = { 関西: 2, '東海・木曽川': 3, '北陸・黒部': 3, '中国・四国': 3 };
export const AREA_NEAR_KM = 300;
// エリアの真ん中（地点の平均の位置。地図の座標＝km）
export const AREA_CENTER = (() => {
  const m = new Map();
  for (const n of JAPAN_NODES) {
    const c = m.get(n.area) || { x: 0, y: 0, k: 0 };
    c.x += n.x;
    c.y += n.y;
    c.k++;
    m.set(n.area, c);
  }
  return new Map([...m].map(([a, c]) => [a, { x: c.x / c.k, y: c.y / c.k }]));
})();
export const AREAS = [...AREA_CENTER.keys()];
// エリアが開く時代（1〜4）。start：始めた町の id
export function areaEra(start, area, nodeId = null) {
  const s = JAPAN_NODES.find((n) => n.id === start) || JAPAN_NODES.find((n) => n.id === TOKYO);
  if (s.area === '東京市内') return ORDER_TOKYO[area] || 4;
  if (nodeId === s.id) return 1;
  if (s.id === 'osaka') return ORDER_OSAKA[area] || 4;
  if (area === s.area) return 2;
  const a = AREA_CENTER.get(area), b = AREA_CENTER.get(s.area);
  return a && b && Math.hypot(a.x - b.x, a.y - b.y) <= AREA_NEAR_KM ? 3 : 4;
}
// 水力の地点は、史実の年の時代までは開かない（年のない地点は明治後期）
export function yearEra(year) {
  if (!year) return 2;
  return year <= 1890 ? 1 : year <= 1911 ? 2 : year <= 1925 ? 3 : 4;
}
// 地点が開く時代
export function nodeOpenEra(start, n) {
  const e = areaEra(start, n.area, n.id);
  return n.town ? e : Math.max(e, yearEra(n.year));
}

// ---- 史実と同じ2地点を線で結んだとき（7章） ----
// id・year・short（1.6.4）：再現した史実の年表に残す鍵・史実の年・短い名前。
// a・b：どちらかの端がこの中なら（向きは問わない）。conf：true＝確かめた／'part'＝一部だけ確かめた／false＝未確認
export const LINE_FACTS = [
  { id: 'komahashi55', year: 1907, short: '駒橋〜早稲田 55 kV 送電', a: ['komahashi'], b: ['tk-waseda'], text: '1907年、駒橋から早稲田へ 55kV・76km で送電（当時の日本で最初の 55kV 送電線）', src: 'S4・S9', conf: true },
  { id: 'shimotaki66', year: 1912, short: '下滝〜東京 66 kV 送電', a: ['shimotaki'], b: TOKYO_WARDS, text: '1912年、下滝から東京へ 66kV で送電を始めた', src: 'S6', conf: true },
  { id: 'inawashiro115', year: 1915, short: '猪苗代第一〜東京 115 kV 長距離送電', a: ['inawashiro1'], b: ['tk-tabata'], text: '1915年、猪苗代第一から東京へ 115kV（約 227km）の長距離送電を始めた（年と電圧は確かめた。終点と距離は未確認）', src: 'S6・G2', conf: 'part' },
  { id: 'nichiden154', year: 1928, short: '日本電力の東京送電幹線 154 kV', a: ['yanagawara', 'kurobe2'], b: TOKYO_WARDS, text: '1928年、日本電力の東京送電幹線 154kV・293.6km', src: 'S6', conf: true },
  { id: 'numakami', year: 1899, short: '沼上〜郡山 高圧の長距離送電', a: ['numakami'], b: ['koriyama'], text: '1899年、日本初の高圧の長距離送電（紡績工場の動力）', src: 'G1', conf: false },
  { id: 'oi-osaka', year: 1924, short: '大井〜大阪 200 km 以上の送電', a: ['oi'], b: ['osaka'], text: '1924年、200km 以上を送電して関西へ', src: 'G1', conf: false },
];
export function lineFact(a, b) {
  return LINE_FACTS.find((f) => (f.a.includes(a) && f.b.includes(b)) || (f.a.includes(b) && f.b.includes(a))) || null;
}
export const confText = (c) => (c === true ? '確かめた' : c === 'part' ? '一部を確かめた' : '未確認');

// ---- 時代が進んだときのまとめに出す史実（確かめたものだけ。1〜2行） ----
export const ERA_FACTS = {
  2: ['1891年、京都の蹴上で日本初の事業用の水力。1907年、駒橋から東京へ 55kV・76km', '1895年、浅草の火力が 50Hz（ドイツ製）、1897年、大阪の幸町が 60Hz（アメリカ製）。今の東西の周波数の始まり'],
  3: ['1912年、下滝（鬼怒川）から東京へ 66kV', '1915年、猪苗代第一から東京へ 115kV の長距離送電'],
  4: ['1928年、日本電力の東京送電幹線 154kV（293.6km）'],
};

// ---- 出典（Code依頼_1.6.0_日本列島.md の出典） ----
export const SOURCES = [
  ['S1', '電気学会 電気技術史研究会ニュースレター No.83', 'http://www2.iee.or.jp/~fms/tech_a/ahee/newsletters/pdf/n83.pdf'],
  ['S2', '電気事業連合会「電気事業の歴史（明治）」', 'https://www.fepc.or.jp/enterprise/rekishi/meiji/'],
  ['S3', '渋沢社史データベース 関西電力『関西地方電気事業百年史』年表', 'https://shashi.shibusawa.or.jp/details_nenpyo.php?sid=13490&query=&class=&d=all&page=3'],
  ['S4', '国立科学博物館 産業技術史資料（駒橋発電所）', 'https://sts.kahaku.go.jp/sts/detail.php?no=901390200023&c=&y1=&y2=&id=&pref=&city=&org=&word=&p=1433'],
  ['S5', '東京電力リニューアブルパワー「水力発電所一覧」（2025年3月末）', 'https://www.tepco.co.jp/rp/business/hydroelectric_power/domestic/list.html'],
  ['S6', '渋沢社史データベース 東京電力『東京電力三十年史』年表ほか', 'https://shashi.shibusawa.or.jp/details_nenpyo.php?sid=13800&query=&class=&d=all&page=16'],
  ['S7', '京都市・関西電力「蹴上発電所」IEEE マイルストーン認定（2016）', 'https://www.city.kyoto.lg.jp/suido/cmsfiles/contents/0000205/205346/press.pdf'],
  ['S8', '電気学会「でんきの礎」三居沢発電所', 'https://www.iee.jp/file/foundation/data02/ishi-10/ishi-1011.pdf'],
  ['S9', '渋沢社史データベース『東京電灯株式会社開業五十年史』写真・図表の一覧', 'https://shashi.shibusawa.or.jp/details_siryo.php?sid=13790'],
  ['S10', '東芝未来科学館（蹴上発電所）', 'https://toshiba-mirai-kagakukan.jp/a-guide/en/history-zone/founders/hydroelectric.htm'],
  ['S11', '電気学会「でんきの礎」北海道・本州間電力連系設備', 'https://www.iee.jp/file/foundation/data02/ishi-06/ishi-2021.pdf'],
  ['S12', 'ニュースイッチ（周波数変換所）', 'https://newswitch.jp/p/4177'],
  ['S13', '三菱電機技報 1965（佐久間周波数変換所）', 'https://www.giho.mitsubishielectric.co.jp/giho/pdf/1965/6511.pdf'],
  ['G1', 'Gemini の調査（1回目、2026-11-15）。出典を Claude が確かめていない行は「未確認」', ''],
  ['G2', 'Gemini の調査（2回目、2026-11-16）。出典を Claude が確かめていない行は「未確認」', ''],
];
