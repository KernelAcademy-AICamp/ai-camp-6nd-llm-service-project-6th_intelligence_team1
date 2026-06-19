import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { InputMatchSchema } from "./schemas.js";
import { generateQueriesAndSearch } from "./search.js";
import { analyzeOneSource } from "./analyze.js";
import { generatePromptFromSources } from "./prompt.js";
import { wrap, wrapError } from "../../shared/envelope.js";
import { generateImage } from "./generateImage.js";
import { generateConcept } from "./concept.js";
import { recordUsage } from "../shared/token-log.js";

// 시안가 v2 — Pinterest 단일 소스 흐름:
//   1단계 검색 — 트렌드별 Pinterest 수집 (쿼리 3개, 최대 20장)
//   2단계 분석 — Pinterest 레퍼런스 선별(1장) + 구도·무드·컬러 분석
//   3단계 프롬프트 — 분석 종합 → 영문 generation_prompt 한 줄
//   4단계 이미지 — Gemini 2.5 Flash Image (제품 img2img), 실패 시 Imagen 4.0 폴백
// (Instagram·Mintoiro 멀티소스는 db076f9에서 품질 개선 위해 Pinterest 단일로 축소)

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

function readJsonOrExit(dataRelPath, agentLabel) {
  const dataPath = resolve(PROJECT_ROOT, dataRelPath);
  try {
    return JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.error(`❌ ${agentLabel} 산출 파일이 없습니다: ${dataRelPath}`);
    process.exit(1);
  }
}

const matchRaw = readJsonOrExit("shared/data/match-result.json", "매칭가");
const brandRaw = readJsonOrExit("shared/data/brand-analysis.json", "브랜드 분석가");
const trendRaw = readJsonOrExit("shared/data/trend-analysis.json", "트렌드 분석가");

// trend_name으로 트렌드 원본 데이터 조회 (meaning·audience_signal·keywords·summary)
const trendByName = new Map(
  (trendRaw?.data?.trends ?? []).map((t) => [t.trend_name, t])
);

const parsed = InputMatchSchema.safeParse(matchRaw);
if (!parsed.success) {
  console.error("❌ 매칭가 산출 유효성 검사 실패");
  parsed.error.issues.forEach((iss) => {
    const path = iss.path.length ? iss.path.join(".") : "(root)";
    console.error(`  - ${path}: ${iss.message}`);
  });
  process.exit(1);
}

const matchData = matchRaw.data;
const brandData = brandRaw?.data ?? {};
const brandName = matchData.brand_name;

// 매칭가 recommendations → designer contents 변환 (rank 1~3, 오름차순)
// 슬롯별 샷 방향 고정 — "model"(인물) / "product"(제품·제형). rank별로 지정.
const SHOT_DIRECTION_BY_RANK = {
  1: "product", // R1 — 제품·정물샷
  2: "model",   // R2 — 인물·모델샷
  3: "product", // R3 — 제품·제형 매크로
};
const DEFAULT_SHOT_DIRECTION = "product";

// 슬롯별 구도 키워드 — 같은 shot_direction이라도 구도가 겹치지 않도록 강제
const COMPOSITION_BY_RANK = {
  1: "top-down flat lay, overhead arrangement, neatly arranged composition", // R1 평면 배치
  2: "upper-body portrait close-up", // R2 인물 클로즈업
  3: "extreme macro close-up, product texture and finish detail", // R3 초근접 매크로 (제형 종류는 제품에 맞게 — 액상 vs 고체)
};

const contents = matchData.recommendations
  .slice()
  .sort((a, b) => a.rank - b.rank)
  .slice(0, process.env.MAX_CONTENTS ? Number(process.env.MAX_CONTENTS) : undefined)
  .map((rec) => {
    const trendData = trendByName.get(rec.trend_name);
    const summaryBullets = trendData?.summary
      ? [trendData.summary]
      : [];
    const reasonBullets = (rec.summary_reasons ?? []).map(
      (r) => `${r.category}: ${r.fact}${r.source ? ` (${r.source})` : ""}`
    );
    return {
      content_id: `R${rec.rank}`,
      trend_name: rec.trend_name,
      summary_bullets: summaryBullets,
      reason_bullets: reasonBullets,
      shot_direction: SHOT_DIRECTION_BY_RANK[rec.rank] ?? DEFAULT_SHOT_DIRECTION,
      composition_hint: COMPOSITION_BY_RANK[rec.rank] ?? null,
    };
  });

// 제품 사진 탐지
function findProductImage(brand) {
  const dir = resolve(PROJECT_ROOT, "inputs/product-images");
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const p = resolve(dir, `${brand}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}
const productImageAbs = findProductImage(brandName);
const productImagePath = productImageAbs
  ? relative(PROJECT_ROOT, productImageAbs)
  : null;
if (!productImagePath) {
  console.error("");
  console.error("❌ 시안 생성을 진행하려면 제품 사진이 필요합니다.");
  console.error(`   inputs/product-images/${brandName}.jpg`);
  console.error("   (지원: jpg, jpeg, png, webp)");
  process.exit(1);
}

// ─── 콘텐츠별 처리 ─────────────────────────────────────────────────────
console.log(`\n시안가 v2 시작 — 콘텐츠 ${contents.length}개\n`);
const startTime = Date.now();

const visuals = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;
const usedQueries = []; // R1 → R2 → R3 순으로 누적, 중복 방지

for (const c of contents) {
  console.log(`▶ ${c.trend_name} (${c.content_id ?? "id 없음"})`);

  // concept 없으면 자동 생성 — 트렌드 원본(meaning·audience_signal) + 매칭 근거 추가 투입
  if (!c.concept) {
    const trendData = trendByName.get(c.trend_name) ?? null;
    try {
      const r = await generateConcept({ brand: brandData, content: c, trendData });
      c.concept = r.concept;
      totalInputTokens += r.usage?.input_tokens ?? 0;
      totalOutputTokens += r.usage?.output_tokens ?? 0;
      console.log(`  [0단계] concept 자동 생성: ${c.concept.slice(0, 60)}...`);
    } catch (err) {
      console.error(`  ❌ [0단계] concept 생성 실패: ${err.message}`);
      continue;
    }
  }

  // 1단계: 매체별 수집
  let queries = [];
  let refsBySource = { pinterest: [] };
  try {
    const r = await generateQueriesAndSearch({ brand: brandData, content: c, usedQueries, shot_direction: c.shot_direction });
    queries = r.queries;
    usedQueries.push(...queries);
    refsBySource = r.references_by_source;
    if (r.usage) {
      totalInputTokens += r.usage.input_tokens ?? 0;
      totalOutputTokens += r.usage.output_tokens ?? 0;
    }
    console.log(`  [1단계] Pinterest ${refsBySource.pinterest.length}`);
  } catch (err) {
    console.error(`  ❌ [1단계] 실패: ${err.message}`);
    continue;
  }

  // 2단계: 매체별 선별·분석 (병렬)
  let analyses = [];
  try {
    analyses = await Promise.all([
      analyzeOneSource({ brand: brandData, content: c, source: "pinterest", references: refsBySource.pinterest }),
    ]);
    analyses.forEach((a) => {
      if (a.usage) {
        totalInputTokens += a.usage.input_tokens ?? 0;
        totalOutputTokens += a.usage.output_tokens ?? 0;
      }
    });
    const summary = analyses
      .map((a) => `${a.source}: ${a.best_reference ? "✓" : "✗"}`)
      .join(" / ");
    console.log(`  [2단계] 매체별 선별+분석 — ${summary}`);
  } catch (err) {
    console.error(`  ❌ [2단계] 실패: ${err.message}`);
    continue;
  }

  // 3단계: 3매체 분석 종합 → 영문 프롬프트
  let generation_prompt;
  try {
    const r3 = await generatePromptFromSources({
      brand: brandData,
      content: c,
      analyses,
    });
    generation_prompt = r3.generation_prompt;
    if (r3.usage) {
      totalInputTokens += r3.usage.input_tokens ?? 0;
      totalOutputTokens += r3.usage.output_tokens ?? 0;
    }
    console.log(`  [3단계] 프롬프트 ${generation_prompt.length}자`);
  } catch (err) {
    console.error(`  ❌ [3단계] 실패: ${err.message}`);
    continue;
  }

  // 4단계: 이미지 생성 (제품 사진 SUBJECT 레퍼런스) — 항상 실행
  const outputImagePath = `shared/data/images/${brandName}/${c.content_id ?? visuals.length}.png`;
  let generatedImageUrl = null;
  try {
    generatedImageUrl = await generateImage({
      prompt: generation_prompt,
      outputPath: outputImagePath,
      aspectRatio: "3:4",
      referenceImagePath: productImagePath,
    });
    console.log(`  [4단계] 이미지 저장: ${generatedImageUrl}`);
  } catch (err) {
    console.error(`  ❌ [4단계] 실패: ${err.message}`);
  }

  visuals.push({
    content_id: c.content_id,
    trend_name: c.trend_name,
    search_queries: queries,
    references_by_source: refsBySource,
    analyses_by_source: analyses.map(({ usage, ...rest }) => rest),
    generation_prompt,
    aspect_ratio: "3:4",
    reference_image_path: productImagePath,
    generated_image_url: generatedImageUrl,
  });
}

// ─── 저장 ─────────────────────────────────────────────────────────────
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const finalData = { brand_name: brandName, visuals };
const result = wrap(finalData);

const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "design-output.json");
writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

console.log("\n=== 메타 ===");
console.log(`소요 시간     : ${elapsed}s`);
console.log(`산출 시안     : ${visuals.length}개`);
console.log(`입력 토큰     : ${totalInputTokens} (Anthropic 누적)`);
console.log(`출력 토큰     : ${totalOutputTokens} (Anthropic 누적)`);
// 시안가는 여러 LLM 호출을 합산해 한 번에 기록 (이미지 생성 모델 토큰은 제외, Anthropic 텍스트만)
recordUsage(
  "designer-v2",
  { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
  "claude-haiku-4-5",
);
console.log(`결과 저장     : ${outputPath}`);
