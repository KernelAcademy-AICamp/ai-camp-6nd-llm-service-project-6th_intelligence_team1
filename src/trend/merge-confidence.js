// 트렌드별 신뢰도(confidence) 결정적 산출 — LLM 추정 ❌, 코드로 건수·날짜를 정확히 집계.
//
// 입력
//   - shared/data/trend-analysis.json   (트렌드 분석가 산출 — source_search_keywords 포함)
//   - trend/data/trend_raw.json         (수집 raw — query·source·published_at 포함)
// 출력
//   - shared/data/trend-analysis.json   (각 트렌드에 confidence / confidence_basis 채워 덮어쓰기)
//
// 계산 (각 트렌드)
//   지지 raw = raw_data 중 query ∈ trend.source_search_keywords
//   mention_total = 지지 raw 총 건수
//   channel_count = 지지 raw의 distinct source 수 (youtube/tavily/naver_datalab/naver_blog/naver_news)
//   recent_count  = 지지 raw 중 published_at이 최근 30일 이내인 건수
// 등급 (잠정 — 첫 산출 분포 보고 튜닝)
//   높음: channel_count >= 3 그리고 recent_count >= 1
//   중간: channel_count == 2
//   낮음: channel_count <= 1 (단일 채널 메아리)
//
// 렌더러(match-report.js의 confidenceOf)가 trend.confidence를 우선 사용하므로 채우면 자동 반영.
// confidence_basis는 "총 N건·M개 채널·최근30일 K건" 근거 노출용.
//
// 실행: npm run trend:merge-confidence
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const TREND_PATH = resolve(PROJECT_ROOT, "shared/data/trend-analysis.json");
const RAW_PATH = resolve(PROJECT_ROOT, "trend/data/trend_raw.json");

const RECENT_DAYS = 30; // 최신성 기준 (잠정)

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
const rawDoc = readJson(RAW_PATH);

const trends = trendDoc?.data?.trends;
if (!Array.isArray(trends)) {
  console.error("❌ trend-analysis.json에 data.trends 배열이 없습니다.");
  process.exit(1);
}
const rawData = Array.isArray(rawDoc?.raw_data) ? rawDoc.raw_data : [];

// 등급 판정 (channel_count·recent_count 기준)
function gradeOf(channelCount, recentCount) {
  if (channelCount >= 3 && recentCount >= 1) return "높음";
  if (channelCount === 2) return "중간";
  return "낮음";
}

const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
const dist = { 높음: 0, 중간: 0, 낮음: 0 };
let missingSupport = [];

for (const trend of trends) {
  const keys = new Set(
    Array.isArray(trend.source_search_keywords) ? trend.source_search_keywords : [],
  );
  // 지지 raw = query가 이 트렌드의 source_search_keywords에 포함된 항목
  const supporting = rawData.filter((r) => r.query && keys.has(r.query));

  const mention_total = supporting.length;
  const channel_count = new Set(
    supporting.map((r) => r.source).filter(Boolean),
  ).size;
  const recent_count = supporting.filter((r) => {
    const t = r.published_at ? Date.parse(r.published_at) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  }).length;

  const confidence = gradeOf(channel_count, recent_count);
  trend.confidence = confidence;
  trend.confidence_basis = { mention_total, channel_count, recent_count };
  dist[confidence]++;

  if (mention_total === 0) {
    missingSupport.push(`${trend.trend_id} ${trend.trend_name}`);
  }
}

// schema_version 마크 (신뢰도 추가 = v0.7)
if (trendDoc.schema_version && trendDoc.schema_version < "0.7") {
  trendDoc.schema_version = "0.7";
}
trendDoc.generated_at = new Date().toISOString();

writeFileSync(TREND_PATH, JSON.stringify(trendDoc, null, 2) + "\n", "utf-8");

console.log("✅ confidence 산출 완료 (결정적 — LLM 아님)");
console.log(
  `   분포 — 높음 ${dist["높음"]} / 중간 ${dist["중간"]} / 낮음 ${dist["낮음"]} (총 ${trends.length})`,
);
if (missingSupport.length > 0) {
  console.log("\n⚠️  지지 raw 0건 트렌드 (source_search_keywords 비었거나 raw query 불일치):");
  for (const s of missingSupport) console.log(`   - ${s}`);
}
console.log(`\n   → 파일 갱신: ${TREND_PATH}`);
