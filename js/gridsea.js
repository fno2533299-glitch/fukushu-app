// 1.10.0 海峡を渡る交流の線：島の違う2地点の「海の上の長さ」（km）の表。grid.js の quoteLine が使う（画面に依存しない。ほかのファイルを読まない）
// 海の上の長さの決め方と計算は ツール/日本列島/make_strait.mjs（海岸線の輪＝地球地図日本 1:100万。島から別の島へ渡る区間と、
// 同じ島に戻る区間のうち 1 km を超えるもの（湾・灘）を海の上とし、1 km 以下の河口・小さな入り江は岸に沿って回れるので数えない）。
// 建設モードは候補を探すのに quoteLine を地点の数の2乗ほど呼ぶので、ゲームの中では計算せず、この表を引く（1組 0.5 ms ほどかかる）
export const STRAIT_MAX_KM = 3; // 狭い海峡を高い鉄塔で渡れる上限（目安：1962年 中四幹線の最長径間 2,357 m。S19）
// 3 km 以下の組（make_strait.mjs の出力。地点か海岸線を作り直したら、ツール/test_grid.mjs の「1.10.0 海峡線：海の上の長さの表」が食い違いを知らせる）
// 関門（下関〜小倉・八幡）：直線 11.9 km、輪の外 3.78 km（下関側の入り江 0.62・海峡 2.41・小倉側の河口 0.70）→ 海の上 2.41 km
export const STRAIT_TABLE = { 'fukuoka|shimonoseki': 2.66, 'kokura|shimonoseki': 2.41, 'saga|shimonoseki': 2.07, 'hirotaki1|shimonoseki': 2.22, 'oyodo2|shimonoseki': 2.21 };
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
// 海の上の長さ（km）。3 km を超える組は null
export const straitSea = (a, b) => STRAIT_TABLE[pairKey(a, b)] ?? null;
