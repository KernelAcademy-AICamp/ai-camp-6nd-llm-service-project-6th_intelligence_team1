import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MatchResultSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 시스템 프롬프트 로드 (매칭가의 두뇌 + 톤앤매너 친화/충돌 테이블 포함)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 2. 입력 데이터 로드
const brandAnalysis = JSON.parse(
  readFileSync(
    resolve(PROJECT_ROOT, "shared/schemas/brand-analysis.example.json"),
    "utf-8",
  ),
);
const trendAnalysis = JSON.parse(
  readFileSync(
    resolve(PROJECT_ROOT, "shared/schemas/trend-analysis.example.json"),
    "utf-8",
  ),
);
const outputExample = readFileSync(
  resolve(PROJECT_ROOT, "shared/schemas/match-result.example.json"),
  "utf-8",
);

// 3. 시스템 컨텐츠 — 안정적 컨텐츠 끝에 cache_control (90% 비용 절감)
const systemContent = [
  {
    type: "text",
    text: systemPrompt,
  },
  {
    type: "text",
    text: `## 출력 JSON 형식 (반드시 이 구조 그대로 사용)

\`\`\`json
${outputExample}
\`\`\`

위 예시와 동일한 키 구조의 JSON 하나만 출력하세요. 코드 블록 표시(\`\`\`)나 부가 설명 없이 순수 JSON만.`,
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

위 모든 트렌드에 대해 4개 비교(1-A, 1-B, 2-A, 2-B)를 수행하고, verdict까지 산출해 \`data.evaluations[]\`에 담아 반환하세요.`;

// 5. Claude API 호출
const client = new Anthropic();

console.log("매칭 평가 시작...\n");
const startTime = Date.now();

const response = await client.messages.parse({
  model: "claude-haiku-4-5",
  max_tokens: 8192,
  system: systemContent,
  messages: [{ role: "user", content: userMessage }],
  output_config: {
    format: zodOutputFormat(MatchResultSchema),
  },
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// 6. 스키마로 자동 검증된 결과
const matchResult = response.parsed_output;
if (!matchResult) {
  console.error("❌ 스키마 검증 실패");
  console.error("--- 응답 원문 ---");
  console.error(response.content.find((b) => b.type === "text")?.text ?? "");
  process.exit(1);
}

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
