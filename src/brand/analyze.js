import { wrap } from "../../shared/envelope.js";
import { BrandInputSchema } from "./schemas.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 — 마케터 입력(JSON)을 받아 매칭가에 넘길 envelope을 만든다.
//
// 사용법 1: 함수로 호출 (웹 UI·테스트용)
//   import { analyzeBrand } from "./analyze.js";
//   const output = analyzeBrand(userInput);
//
// 사용법 2: 스크립트로 실행 (현재 파이프라인용)
//   node src/brand/analyze.js
//   → inputs/brand-input.json 읽어서 shared/data/brand-analysis.json 저장

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

export function analyzeBrand(userInput) {
  // 1) 입력 검증 — 잘못된 값이면 여기서 즉시 ZodError
  const validated = BrandInputSchema.parse(userInput);

  // 2) match_keywords 자동 생성
  const match_keywords = buildMatchKeywords(validated);

  // 3) envelope으로 감싸 반환
  return wrap({
    source: "브랜드 분석",
    ...validated,
    match_keywords,
  });
}

// ─── 스크립트 진입점 (CLI 실행 시) ──────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const inputPath = resolve(__dirname, "../../inputs/brand-input.json");
  const outPath = resolve(__dirname, "../../shared/data/brand-analysis.json");

  const userInput = JSON.parse(readFileSync(inputPath, "utf-8"));
  const output = analyzeBrand(userInput);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`✅ 브랜드 분석 완료: ${output.data.brand_name} (${output.data.product_name})`);
  console.log(`   저장: ${outPath}`);
}
