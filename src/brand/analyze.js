import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { wrap } from "../../shared/envelope.js";
import { BrandInputSchema, BrandKeywordsLlmSchema } from "./schemas.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 — 마케터 입력(JSON)을 받아 매칭가에 넘길 envelope을 만든다.
// 추가로 트렌드 수집가가 쓸 검색 키워드(search_keywords)를 LLM으로 생성.
//
// 사용법 1: 함수로 호출 (웹 UI·테스트용)
//   import { analyzeBrand } from "./analyze.js";
//   const output = await analyzeBrand(userInput);
//
// 사용법 2: 스크립트로 실행 (현재 파이프라인용)
//   node src/brand/analyze.js
//   → inputs/brand-input.json 읽어서 shared/data/brand-analysis.json 저장

const __dirname = dirname(fileURLToPath(import.meta.url));

// 시스템 프롬프트 — 검색 키워드 생성 가이드
const searchKeywordsPrompt = readFileSync(
  resolve(__dirname, "prompts/search-keywords.md"),
  "utf-8",
);

// match_keywords는 입력 필드에서 자동 유도 — 마케터가 별도로 채울 필요 없음.
function buildMatchKeywords(input) {
  // category "메이크업 > 베이스" → ["메이크업", "베이스"]
  const categoryParts = input.category.split(">").map((s) => s.trim()).filter(Boolean);

  return {
    character: [...input.tone_and_manner],
    benefit_texture: [...categoryParts, ...input.texture_keywords],
    target: [
      input.target.gender,
      ...input.target.age_groups,
      input.target.involvement,
      ...input.target.motivation,
    ],
    campaign: [
      input.campaign_kpi,
      input.campaign_period,
      input.campaign_budget,
      ...input.media_channels,
    ],
  };
}

// LLM 호출 — 브랜드 정보로부터 트렌드 수집용 키워드 두 종류 생성:
//   1) search_keywords: YouTube·Tavily용 자연 문장형 5~6개
//   2) datalab_keywords: Naver DataLab용 짧은 단어형 2~3 그룹
async function generateTrendKeywords(input) {
  const client = new Anthropic();

  // 시스템 컨텐츠 끝에 cache_control — 시스템 프롬프트는 안정적이라 캐싱 효과 큼
  const systemContent = [
    {
      type: "text",
      text: searchKeywordsPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  const userMessage = `다음 브랜드·제품 정보로 트렌드 수집용 키워드 세 종류를 모두 생성하세요.

## 입력
- 브랜드명: ${input.brand_name}
- 제품명: ${input.product_name}
- 카테고리: ${input.category}
- 제형(텍스처): ${input.texture_keywords.join(", ")}
- 톤앤매너: ${input.tone_and_manner.join(", ")}
- 타겟 성별: ${input.target.gender}
- 타겟 연령: ${input.target.age_groups.join(", ")}
- 뷰티관여도: ${input.target.involvement}
- 소비동기: ${input.target.motivation.join(", ")}

\`search_keywords\`(Tavily용 자연 문장형 5~6개), \`short_keywords\`(YouTube용 짧은 평면 배열 4~6개), \`datalab_keywords\`(Naver용 짧은 단어 그룹 2~3개) 모두 채워서 JSON으로만 반환.`;

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemContent,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(BrandKeywordsLlmSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    console.error("LLM 응답 파싱 실패:");
    console.error(response.content.find((b) => b.type === "text")?.text ?? "");
    throw new Error("키워드 생성 실패");
  }

  return {
    search_keywords: parsed.search_keywords,
    short_keywords: parsed.short_keywords,
    datalab_keywords: parsed.datalab_keywords,
    usage: response.usage,
  };
}

export async function analyzeBrand(userInput) {
  // 1) 입력 검증 — 잘못된 값이면 여기서 즉시 ZodError
  const validated = BrandInputSchema.parse(userInput);

  // 2) match_keywords 자동 생성 (LLM 호출 없음)
  const match_keywords = buildMatchKeywords(validated);

  // 3) LLM으로 트렌드 수집용 키워드 세 종류 생성
  const { search_keywords, short_keywords, datalab_keywords, usage } =
    await generateTrendKeywords(validated);

  // 4) envelope으로 감싸 반환
  const output = wrap({
    source: "브랜드 분석",
    ...validated,
    match_keywords,
    search_keywords,
    short_keywords,
    datalab_keywords,
  });

  return { output, usage };
}

// ─── 스크립트 진입점 (CLI 실행 시) ──────────────────────────────────
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const inputPath = resolve(__dirname, "../../inputs/brand-input.json");
  const outPath = resolve(__dirname, "../../shared/data/brand-analysis.json");

  const userInput = JSON.parse(readFileSync(inputPath, "utf-8"));

  const startTime = Date.now();
  const { output, usage } = await analyzeBrand(userInput);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`✅ 브랜드 분석 완료: ${output.data.brand_name} (${output.data.product_name})`);
  console.log(`   search_keywords (Tavily용): ${output.data.search_keywords.length}개`);
  output.data.search_keywords.forEach((k, i) => console.log(`     ${i + 1}. ${k}`));
  console.log(`   short_keywords (YouTube용): ${output.data.short_keywords.length}개`);
  output.data.short_keywords.forEach((k, i) => console.log(`     ${i + 1}. ${k}`));
  console.log(`   datalab_keywords (Naver용): ${output.data.datalab_keywords.length} 그룹`);
  output.data.datalab_keywords.forEach((g) =>
    console.log(`     [${g.groupName}] ${g.keywords.join(", ")}`),
  );
  console.log(`   소요 시간: ${elapsed}s`);
  if (usage) {
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    console.log(
      `   토큰: 입력 ${usage.input_tokens} / 캐시 읽기 ${cacheRead} / 캐시 쓰기 ${cacheWrite} / 출력 ${usage.output_tokens}`,
    );
  }
  console.log(`   저장: ${outPath}`);
}
