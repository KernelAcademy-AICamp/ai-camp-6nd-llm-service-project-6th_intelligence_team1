// 트렌드별 신뢰도(confidence) 결정적 산출 — LLM 추정 ❌, 코드로 evidence를 집계.
//
// v0.8: source_search_keywords→raw 조인 방식 폐기. 그 방식은 수집 검색어가 broad 몇 개뿐이라
//       모든 트렌드가 같은 raw 버킷에 매칭 → channel_count 포화 → 전부 "높음"으로 변별 0이었음.
//       대신 각 트렌드의 evidence[](분석가가 트렌드별로 귀속해 둔 근거)에서 직접 계산한다.
//       url·published_at은 analyze.js의 id-조인이 코드로 붙여 신뢰 가능.
//
// 입력
//   - shared/data/trend-analysis.json   (트렌드 분석가 산출 — evidence[]에 source·published_at·url 포함)
// 출력
//   - shared/data/trend-analysis.json   (각 트렌드에 confidence / confidence_basis 채워 덮어쓰기)
//
// 계산 (각 트렌드, evidence[] 기준)
//   source_count     = distinct 독립 출처 수 (youtube/tavily/naver_datalab/naver_blog/naver_news), '추정'류 제외
//   fresh_count      = published_at이 최근 RECENT_DAYS 이내인 근거 수
//   verifiable_count = url 있음 OR (집계성 출처 + period 있음) 근거 수
//   total_evidence   = 근거 총 개수
// 등급 (잠정 — 첫 분포 보고 튜닝. 검증 하네스 confidence_dist_check.py와 동일 규칙)
//   높음: source_count >= 3 그리고 fresh_count >= 1 그리고 verifiable_count >= 1 (3신호 모두 충족)
//   중간: source_count == 2
//   낮음: source_count <= 1
//
// 렌더러(match-report.js의 confidenceOf)가 trend.confidence를 우선 사용하므로 채우면 자동 반영.
// confidence_basis는 툴팁 근거 노출용(출처 종류·근거 수·신선/검증 건수·기간).
//
// 실행: npm run trend:merge-confidence
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const TREND_PATH = resolve(PROJECT_ROOT, "shared/data/trend-analysis.json");

const RECENT_DAYS = 30; // 최신성 기준 (잠정)

// 출처 표기 정규화 (LLM이 "YouTube"/"youtube"/"네이버 블로그" 등으로 섞어 써도 한 종류로)
// 키는 모두 정규화된 형태(소문자 + 공백→_). norm()이 입력도 같은 형태로 바꿔 매칭하므로
// "Naver DataLab"·"YouTube"·"네이버 뉴스" 등 표기 차이에 휘둘리지 않는다.
const NORM = {
  youtube: "youtube",
  "유튜브": "youtube",
  naver_datalab: "naver_datalab",
  datalab: "naver_datalab",
  "네이버_데이터랩": "naver_datalab",
  naver_blog: "naver_blog",
  "네이버_블로그": "naver_blog",
  naver_news: "naver_news",
  "네이버_뉴스": "naver_news",
  tavily: "tavily",
};
// 다양성 집계에서 제외 — '추정'은 독립 출처가 아님 (정규화된 형태로 비교)
const EXCLUDE = new Set(["추정", "brand_context", "brand_context_기반_추정"]);
// url이 원래 없는 집계성 출처 — period가 있으면 검증 가능으로 인정
const AGG_OK = new Set(["naver_datalab"]);

function norm(s) {
  const t = (s || "").trim().toLowerCase().replace(/\s+/g, "_");
  return NORM[t] ?? t;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`❌ 파일을 읽을 수 없습니다: ${path}`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }
}

// 등급 판정 (3신호 — 출처 다양성·신선·검증가능성. 하네스와 동일)
function gradeOf(sourceCount, freshCount, verifiableCount) {
  if (sourceCount >= 3 && freshCount >= 1 && verifiableCount >= 1) return "높음";
  if (sourceCount === 2) return "중간";
  return "낮음";
}

const trendDoc = readJson(TREND_PATH);
const trends = trendDoc?.data?.trends;
if (!Array.isArray(trends)) {
  console.error("❌ trend-analysis.json에 data.trends 배열이 없습니다.");
  process.exit(1);
}

const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
const dist = { 높음: 0, 중간: 0, 낮음: 0 };
const missingEvidence = [];

for (const trend of trends) {
  const ev = Array.isArray(trend.evidence) ? trend.evidence : [];

  // 출처 다양성 — 정규화한 독립 출처 종류 수 ('추정' 제외)
  const sourceSet = new Set();
  for (const e of ev) {
    const s = norm(e?.source);
    if (s && !EXCLUDE.has(s)) sourceSet.add(s);
  }
  const source_count = sourceSet.size;

  // 신선도 — published_at이 최근 RECENT_DAYS 이내인 근거 수
  const fresh_count = ev.filter((e) => {
    const t = e?.published_at ? Date.parse(e.published_at) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  }).length;

  // 검증가능성 — url 있음 OR (집계성 출처 + period)
  const verifiable_count = ev.filter((e) => {
    if (e?.url) return true;
    return AGG_OK.has(norm(e?.source)) && !!e?.period;
  }).length;

  const total_evidence = ev.length;
  const period = trend?.metrics?.period ?? "";

  const confidence = gradeOf(source_count, fresh_count, verifiable_count);
  trend.confidence = confidence;
  trend.confidence_basis = {
    source_count,
    source_types: [...sourceSet],
    fresh_count,
    verifiable_count,
    total_evidence,
    period,
  };
  dist[confidence]++;

  if (total_evidence === 0) {
    missingEvidence.push(`${trend.trend_id ?? "?"} ${trend.trend_name ?? ""}`);
  }
}

// schema_version 마크 (evidence 기반 신뢰도 = v0.8)
if (trendDoc.schema_version && trendDoc.schema_version < "0.8") {
  trendDoc.schema_version = "0.8";
}
trendDoc.generated_at = new Date().toISOString();

writeFileSync(TREND_PATH, JSON.stringify(trendDoc, null, 2) + "\n", "utf-8");

console.log("✅ confidence 산출 완료 (evidence 기반 · 결정적 — LLM 아님)");
console.log(
  `   분포 — 높음 ${dist["높음"]} / 중간 ${dist["중간"]} / 낮음 ${dist["낮음"]} (총 ${trends.length})`,
);

// 변별 경고 — 신호가 평평하면 임계값 튜닝으론 못 고침
const levels = Object.entries(dist).filter(([, n]) => n > 0).map(([k]) => k);
const totalFresh = trends.reduce((a, t) => a + (t.confidence_basis?.fresh_count ?? 0), 0);
const totalVerif = trends.reduce((a, t) => a + (t.confidence_basis?.verifiable_count ?? 0), 0);
if (trends.length > 1 && levels.length === 1) {
  console.log(`\n⚠️  모든 트렌드가 "${levels[0]}" — 변별 없음. 분포 검증 후 수집 폭(키워드) 확장 필요.`);
}
if (totalFresh === 0) {
  console.log("⚠️  신선도(published_at) 신호가 전부 0 — raw에 발행일이 없습니다. published_at 포함 재수집 필요(npm run trend:collect).");
}
if (totalVerif === 0) {
  console.log("⚠️  검증가능성(url) 신호가 전부 0 — evidence에 url이 안 붙었습니다. analyze.js 재실행/재수집 확인.");
}
if (missingEvidence.length > 0) {
  console.log("\n⚠️  evidence 0건 트렌드:");
  for (const s of missingEvidence) console.log(`   - ${s}`);
}
console.log(`\n   → 파일 갱신: ${TREND_PATH}`);
