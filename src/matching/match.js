import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MatchDataSchema, InputBrandSchema, InputTrendSchema } from "./schemas.js";
import { wrap, wrapError } from "../../shared/envelope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 시스템 프롬프트 로드 (매칭가의 두뇌 + 톤앤매너 친화/충돌 테이블 포함)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 2. 입력 데이터 로드 + 분석가 형식 흡수
//    브랜드 분석가가 target.age_groups: ["20대","30대"] 배열로 줄 수도 있어
//    매칭가가 기대하는 target.age_range: "20-30" 문자열로 정규화한다.
function normalizeBrandInput(brand) {
  const target = brand?.data?.target;
  if (target?.age_groups && !target.age_range) {
    const nums = target.age_groups
      .map((g) => parseInt(g, 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (nums.length === 1) target.age_range = `${nums[0]}`;
    else if (nums.length >= 2)
      target.age_range = `${nums[0]}-${nums[nums.length - 1]}`;
  }
  return brand;
}

// 분석가들의 실제 산출물을 읽음. 파일이 없으면 친절한 안내와 함께 종료.
function readAgentOutput(dataRelPath, exampleRelPath, agentLabel) {
  const dataPath = resolve(PROJECT_ROOT, dataRelPath);
  try {
    return JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.error(`❌ ${agentLabel} 산출 파일이 없습니다: ${dataRelPath}`);
    console.error(`   ${agentLabel}를 먼저 실행해서 위 파일을 생성하세요.`);
    console.error(`   더미로 빠르게 시험하려면:`);
    console.error(`     cp ${exampleRelPath} ${dataRelPath}`);
    process.exit(1);
  }
}

// 산출 파일을 원본 그대로 로드. normalize는 검증 후로 미룬다 — 잘못된 타입(예:
// age_groups가 문자열)이 normalize의 .map() 호출에서 크래시하는 걸 방지.
const brandRaw = readAgentOutput(
  "shared/data/brand-analysis.json",
  "shared/schemas/brand-analysis.example.json",
  "브랜드 분석가",
);
const trendRaw = readAgentOutput(
  "shared/data/trend-analysis.json",
  "shared/schemas/trend-analysis.example.json",
  "트렌드 분석가",
);
const outputExample = readFileSync(
  resolve(PROJECT_ROOT, "shared/schemas/match-result.example.json"),
  "utf-8",
);

// 2-1. 입력 유효성 검사 — Zod 스키마로 형식·타입·enum·필수값 위반을 모두 잡는다.
//      LLM 호출 전 종료. garbage-in으로 잘못된 1순위/2순위가 새어나가는 사고 방지.
function formatZodIssues(issues) {
  return issues.map((iss) => {
    const path = iss.path.length ? iss.path.join(".") : "(root)";
    return `  - ${path}: ${iss.message}`;
  });
}

const brandResult = InputBrandSchema.safeParse(brandRaw);
const trendResult = InputTrendSchema.safeParse(trendRaw);
if (!brandResult.success || !trendResult.success) {
  console.error("❌ 입력 유효성 검사 실패 — 매칭 평가를 진행하지 않습니다.");
  if (!brandResult.success) {
    console.error("\n[브랜드 분석가 산출 문제]");
    formatZodIssues(brandResult.error.issues).forEach((line) =>
      console.error(line),
    );
  }
  if (!trendResult.success) {
    console.error("\n[트렌드 분석가 산출 문제]");
    formatZodIssues(trendResult.error.issues).forEach((line) =>
      console.error(line),
    );
  }
  console.error(
    "\n해당 분석가의 산출을 고친 뒤 다시 실행하세요. (LLM 호출·결과 파일 모두 생략됨)",
  );
  process.exit(1);
}

// 검증 통과 후 정규화 — analyzer v1(age_groups 배열) → v2(age_range 문자열) 흡수.
const brandAnalysis = normalizeBrandInput(brandRaw);
const trendAnalysis = trendRaw;

// 3. 시스템 컨텐츠 — 안정적 컨텐츠 끝에 cache_control (90% 비용 절감)
//    출력 예시에서 envelope 부분(schema_version·generated_at·status)을 제거하고
//    LLM에게는 data 객체만 만들도록 안내. envelope은 wrap()이 추가.
const exampleData = JSON.parse(outputExample).data;
const systemContent = [
  {
    type: "text",
    text: systemPrompt,
  },
  {
    type: "text",
    text: `## 출력 JSON 형식 (data 객체만 — envelope은 매칭가가 추가)

다음 구조의 JSON 하나만 출력하세요. \`schema_version\`/\`generated_at\`/\`status\` 같은 envelope 필드는 매칭가 코드가 자동으로 채우므로 LLM은 \`data\`의 내용물(brand_name·evaluations 배열)만 만들면 됩니다.

\`\`\`json
${JSON.stringify(exampleData, null, 2)}
\`\`\`

코드 블록 표시(\`\`\`)나 부가 설명 없이 순수 JSON만.`,
    cache_control: { type: "ephemeral" },
  },
];

// 4. 사용자 메시지 — 매 호출마다 바뀌는 변동 컨텐츠
const userMessage = `다음 입력 데이터로 매칭 평가를 수행하세요.

## 브랜드 프로필
\`\`\`json
${JSON.stringify(brandAnalysis, null, 2)}
\`\`\`

## 트렌드 데이터 (${trendAnalysis.data.trends.length}개)
\`\`\`json
${JSON.stringify(trendAnalysis, null, 2)}
\`\`\`

위 모든 트렌드에 대해 4개 비교(1-A, 1-B, 2-A, 2-B)를 수행하고, verdict까지 산출해 \`evaluations[]\`에 담아 반환하세요. (envelope 제외, data 본체만)`;

// 5. Claude API 호출 — LLM은 data 본체만 생성
const client = new Anthropic();

console.log("매칭 평가 시작...\n");
const startTime = Date.now();

const response = await client.messages.parse({
  model: "claude-haiku-4-5",
  max_tokens: 8192,
  system: systemContent,
  messages: [{ role: "user", content: userMessage }],
  output_config: {
    format: zodOutputFormat(MatchDataSchema),
  },
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// 6. 스키마로 자동 검증된 data 본체. envelope은 매칭가가 추가.
const data = response.parsed_output;
if (!data) {
  console.error("❌ 스키마 검증 실패");
  console.error("--- 응답 원문 ---");
  console.error(response.content.find((b) => b.type === "text")?.text ?? "");
  const errorResult = wrapError("매칭가 LLM 출력이 MatchDataSchema 검증에 실패함");
  console.error(JSON.stringify(errorResult, null, 2));
  process.exit(1);
}

const matchResult = wrap(data);

// 7. 결과 출력
console.log("=== 매칭 결과 ===\n");
console.log(JSON.stringify(matchResult, null, 2));

// 8. 결과 파일 저장
const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "match-result.json");
writeFileSync(outputPath, JSON.stringify(matchResult, null, 2), "utf-8");

// 9. 메타 정보
const usage = response.usage;
const cacheWrite = usage.cache_creation_input_tokens ?? 0;
const cacheRead = usage.cache_read_input_tokens ?? 0;

// Haiku 4.5 가격 ($/1M tokens): input $1, output $5
const cost =
  (usage.input_tokens * 1 +
    cacheWrite * 1.25 +
    cacheRead * 0.1 +
    usage.output_tokens * 5) /
  1_000_000;

console.log("\n=== 메타 ===");
console.log(`모델          : ${response.model}`);
console.log(`소요 시간     : ${elapsed}s`);
console.log(`입력 토큰     : ${usage.input_tokens}  (비캐시)`);
console.log(`캐시 쓰기     : ${cacheWrite}  (이번에 캐시에 저장됨, 1.25x 비용)`);
console.log(`캐시 읽기     : ${cacheRead}  (캐시에서 가져옴, 0.1x 비용)`);
console.log(`출력 토큰     : ${usage.output_tokens}`);
console.log(
  `예상 비용     : $${cost.toFixed(6)} (≈ ${(cost * 1300).toFixed(2)}원)`,
);
console.log(`결과 저장     : ${outputPath}`);
