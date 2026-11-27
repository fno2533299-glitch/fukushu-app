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
// エリアが開く時代（1〜4）。start：始めた町の id。1.10.0：戦後復興（5）で新しく開くエリアはない（全部 4 までに開く）
export function areaEra(start, area, nodeId = null) {
  const s = JAPAN_NODES.find((n) => n.id === start) || JAPAN_NODES.find((n) => n.id === TOKYO);
  if (s.area === '東京市内') return ORDER_TOKYO[area] || 4;
  if (nodeId === s.id) return 1;
  if (s.id === 'osaka') return ORDER_OSAKA[area] || 4;
  if (area === s.area) return 2;
  const a = AREA_CENTER.get(area), b = AREA_CENTER.get(s.area);
  return a && b && Math.hypot(a.x - b.x, a.y - b.y) <= AREA_NEAR_KM ? 3 : 4;
}
// 水力の地点・大学のキャンパスは、史実の年の時代までは開かない（年のない地点は明治後期）。1.11.0：1955〜1972 年は高度成長（6）、1973 年〜は現代（7）
export function yearEra(year) {
  if (!year) return 2;
  return year <= 1890 ? 1 : year <= 1911 ? 2 : year <= 1925 ? 3 : year <= 1940 ? 4 : year <= 1954 ? 5 : year <= 1972 ? 6 : 7;
}
// 地点が開く時代（1.10.1：炭田はエリアの決まりのまま。1.11.0：大学のキャンパスは史実の年の時代から。1.12.0：原子力・揚水はすべて E5＝6 から）
export function nodeOpenEra(start, n) {
  const e = areaEra(start, n.area, n.id);
  if (n.npp || n.pumped) return Math.max(e, 6);
  if (n.campus) return Math.max(e, yearEra(n.year));
  return n.town || n.coal ? e : Math.max(e, yearEra(n.year));
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
  // 1.10.0 海峡を渡る交流の線（史実モードは関門だけ）
  { id: 'kanmon', year: 1945, short: '関門連絡送電線', a: ['shimonoseki'], b: ['kokura'], text: '1945年、関門連絡送電線が完成し、本州と九州の間で送電を始めた', src: 'S14', conf: true },
  { id: 'oi-osaka', year: 1924, short: '大井〜大阪 200 km 以上の送電', a: ['oi'], b: ['osaka'], text: '1924年、200km 以上を送電して関西へ', src: 'G1', conf: false },
];
export function lineFact(a, b) {
  return LINE_FACTS.find((f) => (f.a.includes(a) && f.b.includes(b)) || (f.a.includes(b) && f.b.includes(a))) || null;
}
export const confText = (c) => (c === true ? '確かめた' : c === 'part' ? '一部を確かめた' : '未確認');

// ---- 1.10.4 電鉄（路面電車）の史実の順（史実モードの申し込み順と年表） ----
export const TRAM_HISTORY = [
  { id: 'tram-kyoto', town: 'kyoto', year: 1895, short: '京都電気鉄道の開業（日本初の営業電車）', text: '1895年2月1日、京都電気鉄道が伏見線（七条停車場〜下油掛、約 6.7 km）を直流で開業。日本で最初の営業の電車', src: 'S22', conf: true },
  { id: 'tram-nagoya', town: 'nagoya', year: 1898, short: '名古屋電気鉄道の開業', text: '1898年、名古屋電気鉄道が開業（未確認）', src: 'G2', conf: false },
  { id: 'tram-kawasaki', town: 'kawasaki', year: 1899, short: '大師電気鉄道の開業', text: '1899年1月21日、大師電気鉄道が六郷橋〜大師（約 2 km）を開業。自社の火力発電所の電気で走り、1901年から沿線に電灯も売った', src: 'S23', conf: true },
  { id: 'tram-tokyo', town: 'tk-shiba', year: 1903, short: '東京電車鉄道の開業（品川〜新橋）', text: '1903年8月22日、東京電車鉄道が品川〜新橋に路面電車を開業', src: 'S24', conf: true },
  { id: 'tram-osaka', town: 'osaka', year: 1903, short: '大阪市営路面電車の開業', text: '1903年9月12日、大阪市が花園橋〜築港桟橋に日本で最初の公営の路面電車を開業', src: 'S25', conf: true },
];
export const tramFactOf = (town) => TRAM_HISTORY.find((x) => x.town === town) || null;

// ---- 時代が進んだときのまとめに出す史実（確かめたものだけ。1〜2行） ----
export const ERA_FACTS = {
  2: ['1891年、京都の蹴上で日本初の事業用の水力。1907年、駒橋から東京へ 55kV・76km', '1895年、浅草の火力が 50Hz（ドイツ製）、1897年、大阪の幸町が 60Hz（アメリカ製）。今の東西の周波数の始まり'],
  3: ['1912年、下滝（鬼怒川）から東京へ 66kV', '1915年、猪苗代第一から東京へ 115kV の長距離送電'],
  4: ['1928年、日本電力の東京送電幹線 154kV（293.6km）'],
  // 1.10.0 戦後復興（E4b）。体制の移り変わりは年表と時代のまとめの文だけ（遊びの規則は変えない）
  5: ['1939年、日本発送電が設立。1942年、配電統制令にもとづき 9 配電会社（北海道・東北・北陸・関東・中部・関西・中国・四国・九州）が発足', '1951年5月1日、9 電力会社が発足。1952年、電源開発（株）設立。同じ年、新北陸幹線で日本初の 275 kV 送電'],
  // 1.11.0 高度成長（E5 前半「火主水従」）
  6: [
    '1956年4月、佐久間発電所（35万 kW）が運転を始めた。米国の大型の土木機械を使い、3年でできた',
    '1957年、千葉1号（12.5万 kW）が当時の1台で日本最大の火力。1961年、三重4号が初の重油専焼の火力',
    '1962年、全国の火力の発電量が水力を上回った（火主水従）',
  ],
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
  ['S14', '電気事業連合会「電気の歴史年表 大正から昭和へ」（1.8.0。1939年の異常渇水と電力調整令）', 'https://www.fepc.or.jp/enterprise/rekishi/taishou/'],
  ['S15', '電気事業連合会「電気の歴史年表 昭和後期-1（1946〜1969年）」（1.10.0。電気需給調整規則・9電力会社・電源開発・日本初の 27 万 V 送電）', 'https://www.fepc.or.jp/enterprise/rekishi/shouwa1946/'],
  ['S16', '渋沢社史データベース『関西電力五十年史』年表（1.10.0。枚方変電所・新北陸幹線 275 kV）', 'https://shashi.shibusawa.or.jp/details_nenpyo.php?sid=13490&query=&class=&d=all&page=41'],
  ['S17', '九州電力「歴史・沿革 1951〜1960年」（周波数統一）と中部電力70年史 第1章（1951年の渇水と使用制限）（1.10.0）', 'https://www.kyuden.co.jp/company/history/period/1951-1960.html ／ https://www.chuden.co.jp/resource/corporate/company/history/70yearshistory_02.pdf'],
  ['S18', '電線総合技術センター「送配電線の歴史」（1.10.0。1952年 275 kV 新北陸幹線 230 km）', 'https://www.jectec.or.jp/densen-kiso/souhaiden/3-1/'],
  ['S19', '文化庁 近代遺跡調査 中国電力大三島支線（旧中四幹線）（1.10.0。最長径間 2,357 m。海峡線の長さの目安にだけ使う）', 'https://www.bunka.go.jp/kindai/kenzoubutsu/research_doboku/denryoku/soudensisetsu/t005/index.html'],
  ['S20', '産総研 地質調査総合センター『地質ニュース』（1.10.1。わが国の代表的な炭田：石狩・筑豊・釧路・三池・常磐）', 'https://www.gsj.jp/data/chishitsunews/66_03_07.pdf'],
  ['S21', '産総研 地質調査総合センター『地質調査所月報』32巻11号（1.10.1。主要炭田の一覧に宇部炭田）', 'https://www.gsj.jp/data/bull-gsj/32-11_01.pdf'],
  ['S22', '電気学会「第3回でんきの礎」（1.10.4。1895年2月1日 京都電気鉄道伏見線の開業）', 'https://www.iee.jp/file/foundation/data05/ishi3.pdf'],
  ['S23', '京急「京急歴史館 創業期」（1.10.4。1899年1月21日 大師電気鉄道の開業）', 'https://www.keikyu.co.jp/history/chronology01.html'],
  ['S24', '東京都交通局「交通局のあゆみ 都電荒川線」（1.10.4。1903年8月22日 東京電車鉄道の開業）', 'https://www.kotsu.metro.tokyo.jp/about/ayumi/toden.html'],
  ['S25', '大阪市教育委員会 文化財の紹介（市電 501 型）（1.10.4。1903年9月12日 大阪市営路面電車の開業）', 'https://www.city.osaka.lg.jp/kyoiku/cmsfiles/contents/0000674/674333/8.pdf'],
  ['S26', '東急「池上電気鉄道の歴史（1-2-3-1）」（1.10.4。玉川電気鉄道の発電所 525 kW のうち 450 kW が電車用）', 'https://www.tokyu.co.jp/history/chapter01_2_3/'],
  ['S27', '名古屋市交通局『名古屋市営交通百年史』第2編第1章（1.10.4。1922年 2,800 kW・600 V、1929年水銀整流器、1940年 25% 節電・朝夕急行）', ''],
  ['S28', '電源開発「沿革」（1.11.0。佐久間 1956-04 35万 kW・3年、田子倉 1959-05・1961 38万 kW、奥只見 1960-12 36万 kW、御母衣 1961-01 16万 kW）', 'https://www.jpower.co.jp/company_info/history/'],
  ['S29', '関西電力「沿革」（1.11.0。黒部川第四 1963-06 竣工、アーチダム 186 m）', 'https://www.kepco.co.jp/corporate/profile/history.html'],
  ['S30', '渋沢社史データベース『中国電力50年史』年表（1.11.0。1962年 全国の火力の発電量が水力を上回る）', 'https://shashi.shibusawa.or.jp/details_nenpyo.php?sid=13670&query=&class=&d=all&page=152'],
  ['S31', '電気学会「でんきの礎」500kV系送電の実運用（1.11.0。房総線 新古河〜房総 85 km、1966年 275 kV・1973年 500 kV）', 'https://www.iee.jp/file/foundation/data02/ishi-01/ishi-2324.pdf'],
  ['S32', '学校法人東京理科大学「学校法人東京理科大学の沿革」（1.11.0。1906 神楽坂・1966 野田1号館・1987 長万部・2013 葛飾、小川町校舎）', 'https://www.tus.ac.jp/about/data/data/file/wp24_3.pdf'],
  ['S33', '東京理科大学「沿革」・大学案内 2024（1.11.0。1967年4月 理工学部設置・2023年 創域理工学部に名称変更）', 'https://www.tus.ac.jp/about/university/history/'],
  ['S34', '電気事業連合会「電気の歴史年表 昭和後期-2（1970年〜）」（1.12.0。島根1号・玄海1号・浜岡1号・原子力 1,000万 kW 超え・1973年石油危機・1974年使用制限と料金改定・電源三法）', 'https://www.fepc.or.jp/enterprise/rekishi/shouwa1970/'],
  ['S35', '内閣府「消費動向調査」参考7表 主要耐久消費財の普及率の推移（1.12.0。ルームエアコン 1966 2.0%・1975 17.2%・1980 39.2%、カラーテレビ 1970 26.3%・1975 90.3%）', 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000029325152&fileKind=0'],
  ['S36', '電気事業連合会 INFOBASE 2023「b-10 電源別発電電力量構成比の推移」（1.12.0。1975年度 石油 62.1%、1979年度 石油 50.3%・LNG 13.6%・原子力 14.1%）', 'https://www.fepc.or.jp/pr/data/infobase/pdf/2023_b.pdf'],
  ['S37', '経済企画庁『昭和49年 年次経済報告』（1.12.0。1973年10月以降の石油・電力の消費節減が生産を抑えた）', 'https://www5.cao.go.jp/keizai3/keizaiwp/wp-je74/wp-je74-01103.html'],
  ['S38', 'ENEOS『石油便覧』第1部第2章第6節（1.12.0。1973年11月 石油緊急対策要綱 10% 使用節約、1974年1月 15%、8月末解除）', 'https://www.eneos.co.jp/binran/document/part01/chapter02/section06.html'],
  ['G1', 'Gemini の調査（1回目、2026-11-15）。出典を Claude が確かめていない行は「未確認」', ''],
  ['G2', 'Gemini の調査（2回目、2026-11-16）。出典を Claude が確かめていない行は「未確認」', ''],
];
