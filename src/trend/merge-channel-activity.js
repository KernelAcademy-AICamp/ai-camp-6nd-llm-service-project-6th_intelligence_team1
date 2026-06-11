// 트렌드 1(가지수님)이 만든 채널 활성도 데이터를 트렌드 레코드에 조인
//
// 입력
//   - shared/data/trend-analysis.json       (트렌드 분석가가 만든 트렌드 분석)
//   - trend/data/channel-activity.json      (트렌드 1이 만든 채널별 활성도, 키 = search_keyword)
// 출력
//   - shared/data/trend-analysis.json       (channel_activity 배열을 채워 덮어쓰기)
//
// 조인 방식 (구조 C)
//   각 트렌드의 source_search_keywords 배열을 보고, channel-activity.json에서 매칭되는
//   키의 활성도 객체를 그대로 channel_activity 배열에 push.
//   점수 평균·합산 ❌ (후보군 내 상대 순위라 재정규화 깨짐). 매칭가가 알아서 해석.
//
// 실행: npm run trend:merge-activity

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const TREND_PATH = resolve(PROJECT_ROOT, "shared/data/trend-analysis.json");
const ACTIVITY_PATH = resolve(PROJECT_ROOT, "trend/data/channel-activity.json");

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
const activityMap = readJson(ACTIVITY_PATH);

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
    trend.channel_activity = [];
    continue;
  }

  const activities = [];
  for (const key of sourceKeys) {
    const activity = activityMap[key];
    if (!activity) {
      missingKeys.add(key);
      continue;
    }
    activities.push({
      search_keyword: key,
      scores: activity.scores,
      top_channel: activity.top_channel,
      interpretation: activity.interpretation ?? "relative_to_pool",
    });
  }

  trend.channel_activity = activities;
  if (activities.length > 0) mergedCount++;
}

// schema_version 업데이트 (실 데이터에도 v0.5 마크)
if (trendDoc.schema_version && trendDoc.schema_version < "0.5") {
  trendDoc.schema_version = "0.5";
}
trendDoc.generated_at = new Date().toISOString();

writeFileSync(TREND_PATH, JSON.stringify(trendDoc, null, 2) + "\n", "utf-8");

console.log("✅ channel_activity 병합 완료");
console.log(`   ${mergedCount}/${trends.length} 트렌드에 채널 활성도 채움`);

if (skippedTrends.length > 0) {
  console.log("\n⚠️  source_search_keywords 비어있는 트렌드:");
  for (const s of skippedTrends) console.log(`   - ${s}`);
}

if (missingKeys.size > 0) {
  console.log("\n⚠️  channel-activity.json에 없는 키 (오타 또는 임시본):");
  for (const k of missingKeys) console.log(`   - "${k}"`);
}

console.log(`\n   → 파일 갱신: ${TREND_PATH}`);
