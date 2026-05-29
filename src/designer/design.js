import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmDesignDataSchema, InputWriterSchema } from "./schemas.js";
import { wrap, wrapError } from "../../shared/envelope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 시스템 프롬프트 로드 (시안가의 두뇌)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 2. 작성가 산출 로드. 없으면 친절한 안내와 함께 종료.
function readAgentOutput(dataRelPath, agentLabel, runHint) {
  const dataPath = resolve(PROJECT_ROOT, dataRelPath);
  try {
    return JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.error(`❌ ${agentLabel} 산출 파일이 없습니다: ${dataRelPath}`);
    console.error(`   ${agentLabel}를 먼저 실행해서 위 파일을 생성하세요.`);
    console.error(`     ${runHint}`);
    console.error(
      `   형식은 shared/schemas/writer-output.example.json 참고.`,
    );
    process.exit(1);
  }
}

const writerRaw = readAgentOutput(
  "shared/data/writer-output.json",
  "작성가",
  "(작성가 미구현 시 shared/schemas/writer-output.example.json을 복사해 사용)",
);

// 2-1. 입력 유효성 검사 — LLM 호출 전 형식·필수값 위반 차단.
const parsed = InputWriterSchema.safeParse(writerRaw);
if (!parsed.success) {
  console.error("❌ 입력 유효성 검사 실패 — 시안 생성을 진행하지 않습니다.");
  parsed.error.issues.forEach((iss) => {
    const path = iss.path.length ? iss.path.join(".") : "(root)";
    console.error(`  - ${path}: ${iss.message}`);
  });
  process.exit(1);
}

const writerData = writerRaw.data;

// 3. 시스템 컨텐츠 — 안정적 컨텐츠 끝에 cache_control (비용 절감)
const systemContent = [
  { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
];

// 4. 사용자 메시지 — 작성가 콘텐츠 기획
const userMessage = `다음 작성가 콘텐츠 기획으로 시안 명세를 만드세요.

## 콘텐츠 기획
\`\`\`json
${JSON.stringify(writerData, null, 2)}
\`\`\`

각 콘텐츠(contents[])마다 시안 명세 1개를 \`visuals[]\`에 담아 반환하세요. brand_name·envelope은 시안가 코드가 채우므로 출력하지 마세요.`;

// 5. Claude API 호출 — LLM은 visuals(시안 명세)만 생성
const client = new Anthropic();
console.log("시안 생성 시작...\n");
const startTime = Date.now();

const response = await client.messages.parse({
  model: "claude-haiku-4-5",
  max_tokens: 8192,
  system: systemContent,
  messages: [{ role: "user", content: userMessage }],
  output_config: { format: zodOutputFormat(LlmDesignDataSchema) },
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

const data = response.parsed_output;
if (!data) {
  console.error("❌ 스키마 검증 실패");
  console.error(response.content.find((b) => b.type === "text")?.text ?? "");
  console.error(JSON.stringify(wrapError("시안가 LLM 출력이 LlmDesignDataSchema 검증에 실패함"), null, 2));
  process.exit(1);
}

// 6. brand_name(입력값 신뢰) + LLM visuals 조립 → envelope wrap
const finalData = {
  brand_name: writerData.brand_name,
  visuals: data.visuals,
};
const result = wrap(finalData);

// 7. 결과 출력
console.log("=== 시안 결과 ===\n");
console.log(JSON.stringify(result, null, 2));

// 8. 결과 파일 저장
const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "design-output.json");
writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

// 9. 메타 정보
const usage = response.usage;
const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
const cacheRead = usage?.cache_read_input_tokens ?? 0;
const cost = usage
  ? (usage.input_tokens * 1 +
      cacheWrite * 1.25 +
      cacheRead * 0.1 +
      usage.output_tokens * 5) /
    1_000_000
  : 0;

console.log("\n=== 메타 ===");
console.log(`모델          : ${response.model}`);
console.log(`소요 시간     : ${elapsed}s`);
console.log(`산출 시안     : ${finalData.visuals.length}개`);
if (usage) {
  console.log(`입력 토큰     : ${usage.input_tokens}`);
  console.log(`출력 토큰     : ${usage.output_tokens}`);
  console.log(`예상 비용     : $${cost.toFixed(6)} (≈ ${(cost * 1300).toFixed(2)}원)`);
}
console.log(`결과 저장     : ${outputPath}`);
