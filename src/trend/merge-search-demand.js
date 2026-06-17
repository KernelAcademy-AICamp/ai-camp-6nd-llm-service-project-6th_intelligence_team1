// 트렌드 1(가지수님)이 만든 검색 수요 데이터를 트렌드 레코드에 조인
//
// 입력
//   - shared/data/trend-analysis.json   (트렌드 분석가가 만든 트렌드 분석)
//   - trend/data/search-demand.json     (트렌드 1이 만든 키워드별 수요, 키 = search_keyword)
// 출력
//   - shared/data/trend-analysis.json   (demand_fit / competition_fit 채워 덮어쓰기)
//
// 조인 방식 (A안 — 최고 검색량 대표)
//   각 트렌드의 source_search_keywords 배열을 보고, search-demand.json에서 매칭되는
//   키워드들 중 "월간 검색수가 가장 높은" 키워드 하나를 그 트렌드의 대표로 선정.
//   그 대표의 demand_fit / competition_fit 객체를 트렌드 레코드에 붙임.
//   (매칭가 match.js가 demand_fit을 "객체 1개"로 기대하므로 단수로 맞춤)
//
// 실행: npm run trend:merge-demand
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const TREND_PATH = resolve(PROJECT_ROOT, "shared/data/trend-analysis.json");
const DEMAND_PATH = resolve(PROJECT_ROOT, "trend/data/search-demand.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`❌ 파일을 읽을 수 없습니다: ${path}`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }
}

const trendDoc = readJson(TREND_PATH);
const demandMap = readJson(DEMAND_PATH);

const trends = trendDoc?.data?.trends;
if (!Array.isArray(trends)) {
  console.error("❌ trend-analysis.json에 data.trends 배열이 없습니다.");
  process.exit(1);
}

let mergedCount = 0;
let skippedTrends = [];
let missingKeys = new Set();

for (const trend of trends) {
  const sourceKeys = trend.source_search_keywords ?? [];
  if (!Array.isArray(sourceKeys) || sourceKeys.length === 0) {
    skippedTrends.push(`${trend.trend_id} ${trend.trend_name} (source_search_keywords 비어있음)`);
    continue;
  }

  // 이 트렌드의 source 키워드들 중 search-demand.json에 있는 것만 수집
  const candidates = [];
  for (const key of sourceKeys) {
    const demand = demandMap[key];
    if (!demand) {
      missingKeys.add(key);
      continue;
    }
    candidates.push({ key, demand });
  }

  if (candidates.length === 0) continue;

  // A안: 월간 검색수가 가장 높은 키워드를 대표로 선정
  const best = candidates.reduce((top, cur) => {
    const topVal = top.demand.demand_fit?.monthly_searches ?? 0;
    const curVal = cur.demand.demand_fit?.monthly_searches ?? 0;
    return curVal > topVal ? cur : top;
  });

  // 대표 키워드의 demand_fit / competition_fit을 트렌드에 붙임
  // (어느 키워드가 대표였는지 추적용으로 source_keyword 필드 추가)
  trend.demand_fit = { source_keyword: best.key, ...best.demand.demand_fit };
  if (best.demand.competition_fit != null) {
    trend.competition_fit = { source_keyword: best.key, ...best.demand.competition_fit };
  }
  mergedCount++;
}

// schema_version 업데이트
if (trendDoc.schema_version && trendDoc.schema_version < "0.6") {
  trendDoc.schema_version = "0.6";
}
trendDoc.generated_at = new Date().toISOString();

writeFileSync(TREND_PATH, JSON.stringify(trendDoc, null, 2) + "\n", "utf-8");

console.log("✅ demand_fit / competition_fit 병합 완료");
console.log(`   ${mergedCount}/${trends.length} 트렌드에 검색 수요 채움`);

if (skippedTrends.length > 0) {
  console.log("\n⚠️  source_search_keywords 비어있는 트렌드:");
  for (const s of skippedTrends) console.log(`   - ${s}`);
}
if (missingKeys.size > 0) {
  console.log("\n⚠️  search-demand.json에 없는 키 (오타 또는 미수집):");
  for (const k of missingKeys) console.log(`   - "${k}"`);
}
console.log(`\n   → 파일 갱신: ${TREND_PATH}`);
