import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 시스템 프롬프트 로드 (매칭가의 두뇌)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 2. 입력 데이터 로드 (지금은 예시 데이터, 나중에 분석가 산출물로 교체)
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

// 3. 프로젝트 유형 (지금은 하드코딩, 나중에 인자로 받음)
const projectType = "brand_awareness"; // "product_promotion" | "brand_awareness"

// 4. 사용자 메시지 구성
const userMessage = `다음 입력 데이터로 매칭 평가를 수행하세요.

## 프로젝트 유형
${projectType}

## 브랜드 분석 결과
\`\`\`json
${JSON.stringify(brandAnalysis, null, 2)}
\`\`\`

## 트렌드 분석 결과
\`\`\`json
${JSON.stringify(trendAnalysis, null, 2)}
\`\`\`

## 출력해야 할 JSON 형식 (이 구조를 정확히 따르세요)
\`\`\`json
${outputExample}
\`\`\`

위 예시와 동일한 키 구조를 사용해 JSON 하나만 출력하세요. 코드 블록 표시(\`\`\`)나 부가 설명 없이 JSON만.`;

// 5. Claude API 호출
const client = new Anthropic();

console.log("매칭 평가 시작...\n");
const startTime = Date.now();

const response = await client.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 8192,
  system: systemPrompt,
  messages: [{ role: "user", content: userMessage }],
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// 6. 응답에서 텍스트 추출
const responseText =
  response.content.find((b) => b.type === "text")?.text ?? "";

// 7. JSON 파싱 (혹시 markdown 코드 블록으로 감싸져 있을 수 있어 안전 처리)
const jsonText = responseText
  .replace(/^```json\s*/, "")
  .replace(/^```\s*/, "")
  .replace(/```\s*$/, "")
  .trim();

let matchResult;
try {
  matchResult = JSON.parse(jsonText);
} catch (e) {
  console.error("❌ JSON 파싱 실패\n");
  console.error("--- 응답 원문 ---");
  console.error(responseText);
  console.error("--- 에러 ---");
  console.error(e.message);
  process.exit(1);
}

// 8. 결과 출력
console.log("=== 매칭 결과 ===\n");
console.log(JSON.stringify(matchResult, null, 2));

// 9. 결과 파일 저장
const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "match-result.json");
writeFileSync(outputPath, JSON.stringify(matchResult, null, 2), "utf-8");

// 10. 메타 정보 (비용/소요시간)
const cost =
  (response.usage.input_tokens * 1 + response.usage.output_tokens * 5) /
  1_000_000;

console.log("\n=== 메타 ===");
console.log(`모델       : ${response.model}`);
console.log(`소요 시간  : ${elapsed}s`);
console.log(`입력 토큰  : ${response.usage.input_tokens}`);
console.log(`출력 토큰  : ${response.usage.output_tokens}`);
console.log(
  `예상 비용  : $${cost.toFixed(6)} (≈ ${(cost * 1300).toFixed(2)}원)`,
);
console.log(`결과 저장  : ${outputPath}`);
