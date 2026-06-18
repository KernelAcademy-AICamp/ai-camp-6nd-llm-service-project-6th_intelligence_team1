import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wrap, wrapError } from "../../shared/envelope.js";
import { recordUsage } from "../shared/token-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// envelope을 매칭가가 읽는 표준 경로(shared/data/trend-analysis.json)에 기록
function writeOutput(obj) {
  const outputDir = resolve(PROJECT_ROOT, "shared/data");
  mkdirSync(outputDir, { recursive: true });
  const outPath = resolve(outputDir, "trend-analysis.json");
  writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");
  return outPath;
}

// 1. 분석가1이 수집한 raw 데이터 로드 (trend/data/trend_raw.json)
const rawPath = resolve(PROJECT_ROOT, "trend/data/trend_raw.json");
let raw;
try {
  raw = JSON.parse(readFileSync(rawPath, "utf-8"));
} catch (err) {
  console.error("❌ raw 데이터 파일을 읽을 수 없습니다: trend/data/trend_raw.json");
  console.error("   분석가1의 수집기를 먼저 실행하세요: node trend/merge.js");
  process.exit(1);
}

const brandContext = raw.brand_context ?? {};
const rawData = raw.raw_data ?? [];
if (rawData.length === 0) {
  console.error("❌ raw_data가 비어있습니다. 수집기 실행을 확인하세요.");
  process.exit(1);
}

// 1-2. 브랜드 분석가 산출 로드 (제품·카테고리·제형 컨텍스트).
//      없으면 빈 객체로 graceful 처리 (브랜드 분석가를 먼저 실행하면 정확도↑).
let brand = {};
try {
  const brandPath = resolve(PROJECT_ROOT, "shared/data/brand-analysis.json");
  brand = JSON.parse(readFileSync(brandPath, "utf-8")).data ?? {};
  console.log(
    `[brand] ${brand.brand_name ?? "(미상)"} / ${brand.product_name ?? "(제품 미상)"} / ${brand.category ?? "(카테고리 미상)"}`,
  );
} catch {
  console.warn(
    "⚠️ brand-analysis.json을 못 읽었습니다 — 제품 컨텍스트 없이 진행 (브랜드 분석가를 먼저 실행하세요).",
  );
}

// 2. 시스템 프롬프트 — LLM이 따라야 할 출력 형식·규칙 (트렌드 분석가의 두뇌)
const systemPrompt = `당신은 10년차 뷰티 트렌드 분석가입니다.
수집된 raw 검색 데이터(YouTube·Tavily)를 분석해, 매칭가에게 넘길 트렌드 분석 JSON을 생성합니다.

## 작업
1. raw_data 배열(검색 결과 제목·설명)을 읽고, 의미가 비슷한 것끼리 묶어 **근거가 뚜렷하고 서로 구별되는 트렌드를 최대한 많이** 정제합니다. (개수를 억지로 채우려 비슷한 트렌드를 쪼개거나 근거 없는 트렌드를 만들지 마세요.)
2. 각 트렌드마다 아래 구조의 객체를 만듭니다.
3. raw 데이터에 실제 근거가 있는 트렌드만 만듭니다. 없는 내용을 지어내지 마세요.

## 출력 형식 (이 구조를 정확히 따르세요)
\`\`\`json
{
  "trends": [
    {
      "trend_id": "T001",
      "trend_name": "트렌드 이름",
      "category": "메이크업 > 베이스",
      "keywords": ["키워드1", "키워드2"],
      "source_search_keywords": ["검색어1", "검색어2"],
      "summary": "한 줄 요약 (50자 이내, 수치 포함 권장)",
      "headline_metric": { "metric": "검색량 지수", "value": "89", "delta": "+45% vs 전월" },
      "meaning": "트렌드의 의미 (2~3문장)",
      "status": "현황 (2~3문장, 수치 포함)",
      "trend_stage": "peak",
      "lifespan_estimate": "3-6개월",
      "metrics": { "score": 89, "growth_rate": 0.45, "period": "2026-04 ~ 2026-05" },
      "evidence": [
        { "source": "YouTube", "source_type": "sns_api", "metric": "관련 영상 다수", "value": "무드 메이크업 튜토리얼 다수 관측", "period": "최근 30일", "url": "https://www.youtube.com/watch?v=..." }
      ],
      "audience_distribution": {
        "primary_gender": "female",
        "primary_age": ["20s", "30s"],
        "gender_ratio": { "female": 0.88, "male": 0.12 },
        "age_ratio": { "10s": 0.07, "20s": 0.42, "30s": 0.31, "40s": 0.14, "50s+": 0.06 },
        "source": "brand_context 기반 추정"
      },
      "audience_signal": "여름철 피지·번들거림에 민감한 20-30대 직장인 여성, 데일리 메이크업 지속력을 중시",
      "media_channel_status": [
        { "media_channel": "YouTube", "status": "관련 튜토리얼 콘텐츠 다수" }
      ]
    }
  ]
}
\`\`\`

## 규칙 (반드시 준수)
- **category**: "대분류 > 소분류" 형식. 대분류는 클렌징/스킨케어/메이크업 중 하나, 소분류는 하위 (예: "메이크업 > 베이스", "메이크업 > 립", "스킨케어 > 토너")
- **keywords**: 최소 1개
- **source_search_keywords**: 위 "브랜드 프로필"의 \`search_keywords\` 중 이 트렌드의 근거가 된 검색어만 골라 글자 그대로(verbatim) 배열에 담으세요. 한 트렌드가 여러 검색어에 걸쳐있을 수 있으니 해당되는 것 모두. 관련된 게 없으면 빈 배열([]). 이 필드는 채널 활성도·검색 수요(demand_fit) 매칭의 조인 키로 사용됩니다.
- **summary**: 50자 이내
- **gender_ratio**: female + male 합이 정확히 1.0
- **age_ratio**: 모든 값 합이 정확히 1.0. 키는 "10s","20s","30s","40s","50s+"만 사용
- **primary_gender**: female / male / all 중 하나
- **primary_age**: "10s","20s","30s","40s","50s+" 중 비중 높은 것
- **metrics.score**: 0~100 정수, **metrics.growth_rate**: 소수(0.45 = 45% 상승)
- **trend_stage**: "emerging"/"peak"/"declining" 중 하나. growth_rate·검색/조회 추세로 판정 — 급상승·신규 부상이면 "emerging", 정점 도달 후 성장 둔화·정체(둔화 임박)면 "peak", 하락·감소 추세면 "declining". (서술형 status와 별개의 라벨 필드)
- **lifespan_estimate**: "3개월 미만"/"3-6개월"/"6개월 이상" 중 하나. 트렌드 지속성 추정 — 일시적 챌린지·시즌성은 짧게, 구조적·라이프스타일 변화는 길게
- **audience_signal**: 핵심 소비자를 행동·라이프스타일·니즈 중심으로 1~2문장 서술. 연령·성별 수치는 audience_distribution에 있으므로 여기선 행태 묘사 위주
- 모든 자연어는 한국어
- 검색·조회수 등 수치는 raw 데이터로 직접 관측되지 않으면 brand_context 기반으로 합리적 추정하되, source에 "추정" 명시
- **evidence.url**: 각 근거가 나온 위 raw_data 항목의 \`url\` 값을 **글자 그대로(verbatim) 복사**하세요. 절대 지어내거나 변형하지 마세요. 매칭되는 raw 항목이 없거나 집계성 근거(검색량 지수 등 url 없음)면 \`url\`을 빈 문자열("")로 두세요.
- **출력은 순수 JSON 하나만.** 코드 블록 표시나 설명 텍스트 없이 JSON만.`;

// 3. 사용자 메시지 — 브랜드 프로필 + 수집 컨텍스트 + raw 데이터
const brandProfile = {
  brand_name: brand.brand_name,
  product_name: brand.product_name,
  category: brand.category,
  texture_keywords: brand.texture_keywords,
  tone_and_manner: brand.tone_and_manner,
  target: brand.target,
  search_keywords: brand.search_keywords,
};
const targetCategory = brand.category ?? "";
const targetTexture = (brand.texture_keywords ?? []).join(", ");

// LLM에 보낼 raw 데이터에서 url 제거 — url은 LLM 호출 후 검증용(realUrls)으로만
// 쓰이므로 모델에 보낼 필요가 없다. 입력 토큰의 ~19%를 차지해 비용 절감 효과 큼.
// rawData 원본은 그대로 두어 이후 url 검증 로직이 정상 동작한다.
const rawDataForLlm = rawData.map(({ url, ...rest }) => rest);

const userMessage = `다음 수집 데이터를 분석해서, 이 브랜드/제품에 맞는 트렌드를 산출하세요.

## 브랜드 프로필 (이 제품 기준으로 트렌드를 정렬·선별하세요)
\`\`\`json
${JSON.stringify(brandProfile, null, 2)}
\`\`\`

## 수집 컨텍스트 (크롤 기준)
\`\`\`json
${JSON.stringify(brandContext, null, 2)}
\`\`\`

## 수집된 raw 데이터 (${rawDataForLlm.length}개)
\`\`\`json
${JSON.stringify(rawDataForLlm, null, 2)}
\`\`\`

위 데이터에서 근거가 뚜렷하고 서로 구별되는 트렌드를 최대한 많이 정제해 출력 형식대로 JSON으로 반환하세요.${
  targetCategory
    ? `\n\n**카테고리 정렬 (중요)**: 이 브랜드의 카테고리는 "${targetCategory}"입니다. 트렌드의 category 대분류·소분류가 이와 명백히 다르면(예: 베이스 브랜드 × 립 트렌드) 생성하지 마세요. 제품 카테고리와 제형(${targetTexture || "미상"})에 직접 관련된 트렌드를 우선합니다.`
    : ""
}`;

// 4. Claude API 호출 (시스템 프롬프트 끝에 cache_control로 비용 절감)
const client = new Anthropic();
console.log(`트렌드 분석 시작... (raw ${rawData.length}개 → 트렌드 정제)\n`);
const startTime = Date.now();

// 트렌드를 "최대한 많이" 뽑으므로 출력 잘림 방지로 상향. haiku-4-5 출력 한도는
// 64K라 여유가 있어, 잘림이 감지되면 1회 더 높여 자동 재시도한다.
const MAX_TOKENS_PRIMARY = 32000;
const MAX_TOKENS_RETRY = 48000;

async function callLLM(maxTokens) {
  return client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: maxTokens,
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userMessage }],
  });
}

let response = await callLLM(MAX_TOKENS_PRIMARY);

// 4-1. 출력이 max_tokens에 막혀 잘리면 JSON이 중간에 끊긴다. 이걸 "파싱 실패"로
//      오인하지 않도록 stop_reason을 먼저 확인하고, 한도를 높여 1회 자동 재시도.
if (response.stop_reason === "max_tokens") {
  console.warn(
    `⚠️ 출력이 max_tokens(${MAX_TOKENS_PRIMARY})에 막혀 잘렸습니다 — ${MAX_TOKENS_RETRY}로 상향해 재시도합니다.`,
  );
  response = await callLLM(MAX_TOKENS_RETRY);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// 4-2. 재시도 후에도 여전히 잘렸으면, "파싱 실패"가 아니라 "출력 초과로 잘림"으로
//      명확히 에러 처리한다 (원인이 가려지지 않게).
if (response.stop_reason === "max_tokens") {
  console.error(
    `❌ 출력이 max_tokens(${MAX_TOKENS_RETRY})를 또 초과해 JSON이 잘렸습니다. 파싱 실패가 아니라 출력 초과입니다.`,
  );
  console.error(
    "   트렌드 수를 줄이거나(입력 분할) max_tokens를 더 올려야 합니다.",
  );
  writeOutput(wrapError("트렌드 분석가 LLM 출력 초과로 JSON 잘림 (max_tokens)"));
  process.exit(1);
}

// 5. 응답에서 JSON 추출 (LLM이 코드블록으로 감싸도 제거)
const rawText = response.content.find((b) => b.type === "text")?.text ?? "";
const jsonText = rawText.replace(/```json\s*/g, "").replace(/```/g, "").trim();

let parsed;
try {
  parsed = JSON.parse(jsonText);
} catch (err) {
  console.error("❌ LLM 응답을 JSON으로 파싱하지 못했습니다.");
  console.error(`   (stop_reason: ${response.stop_reason}) — 출력 잘림은 아니나 JSON 형식이 깨졌습니다.`);
  console.error("--- 응답 원문 ---");
  console.error(rawText);
  writeOutput(wrapError("트렌드 분석가 LLM 출력 JSON 파싱 실패"));
  process.exit(1);
}

// 6. 기본 검증 — trends 배열이 비어있지 않은지
if (!Array.isArray(parsed.trends) || parsed.trends.length === 0) {
  console.error("❌ trends 배열이 비어있거나 형식이 잘못되었습니다.");
  writeOutput(wrapError("트렌드 분석가 LLM 출력에 trends 배열 없음"));
  process.exit(1);
}

// 6-1. evidence.url 안전망 — LLM이 url을 지어내거나 한 글자라도 변형하면 링크가 깨진다.
//      실제 수집 raw_data에 존재하는 url만 신뢰하고, 그 외(환각·변형·빈값)는 null 처리.
//      → 수집 단계의 진짜 링크만 끝까지 전달됨.
const realUrls = new Set(rawData.map((d) => d.url).filter(Boolean));
for (const trend of parsed.trends) {
  if (!Array.isArray(trend.evidence)) continue;
  for (const ev of trend.evidence) {
    if (!ev || typeof ev !== "object") continue;
    ev.url = ev.url && realUrls.has(ev.url) ? ev.url : null;
  }
}

// 7. 메타데이터 추가 + envelope wrap (source·analyzed_at·trend_count는 코드가 부여)
const data = {
  source: "트렌드 분석",
  analyzed_at: new Date().toISOString(),
  raw_count: rawData.length,
  trend_count: parsed.trends.length,
  trends: parsed.trends,
};
const output = wrap(data);

// 8. 표준 경로에 저장
const outPath = writeOutput(output);

// 9. 결과·메타 로그
console.log("=== 트렌드 분석 결과 ===\n");
console.log(JSON.stringify(output, null, 2));

console.log("\n=== 메타 ===");
console.log(`모델          : ${response.model}`);
console.log(`소요 시간     : ${elapsed}s`);
console.log(`산출 트렌드   : ${data.trend_count}개`);
const usage = response.usage;
if (usage) {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  // Haiku 4.5 가격 ($/1M): input $1, output $5
  const cost =
    (usage.input_tokens * 1 +
      cacheWrite * 1.25 +
      cacheRead * 0.1 +
      usage.output_tokens * 5) /
    1_000_000;
  console.log(`입력 토큰     : ${usage.input_tokens}`);
  console.log(`출력 토큰     : ${usage.output_tokens}`);
  console.log(`예상 비용     : $${cost.toFixed(6)} (≈ ${(cost * 1300).toFixed(2)}원)`);
  recordUsage("trend", usage, response.model ?? "claude-haiku-4-5");
}
console.log(`결과 저장     : ${outPath}`);

export default output;
