import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { InputWriterSchema } from "./schemas.js";
import { generateQueriesAndSearch } from "./search.js";
import { analyzeReferences } from "./analyze.js";
import { generatePrompt } from "./prompt.js";
import { wrap, wrapError } from "../../shared/envelope.js";

// 시안가 v2 — 4단계 도구 체인 (현재 1단계만 구현, 2~4 placeholder)
//   1. 검색 → Tavily 이미지 (LLM이 쿼리 생성)
//   2. 비전 분석 → Haiku 비전 (TODO)
//   3. 프롬프트 생성 → Haiku 영문 프롬프트 (TODO)
//   4. 이미지 생성 → Flux Dev via Replicate (TODO)

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 입력 로드 — 작성가 산출 + 브랜드 분석가 산출
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

const writerRaw = readJsonOrExit("shared/data/writer-output.json", "작성가");
const brandRaw = readJsonOrExit("shared/data/brand-analysis.json", "브랜드 분석가");

// 2. 입력 검증
const parsed = InputWriterSchema.safeParse(writerRaw);
if (!parsed.success) {
  console.error("❌ 작성가 산출 유효성 검사 실패");
  parsed.error.issues.forEach((iss) => {
    const path = iss.path.length ? iss.path.join(".") : "(root)";
    console.error(`  - ${path}: ${iss.message}`);
  });
  process.exit(1);
}

const writerData = writerRaw.data;
const brandData = brandRaw?.data ?? {};
const brandName = writerData.brand_name;

// 3. 제품 사진 탐지 — inputs/product-images/<brand>.<ext> (Img2Img용)
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
  console.error("");
  console.error("   사진을 다음 경로에 넣어주세요:");
  console.error(`   inputs/product-images/${brandName}.jpg`);
  console.error("");
  console.error("   지원 포맷: jpg, jpeg, png, webp");
  console.error("");
  process.exit(1);
}

// 4. 콘텐츠별 처리 — 콘텐츠 1개당 시안 1장
console.log(`\n시안가 v2 시작 — 콘텐츠 ${writerData.contents.length}개\n`);
const startTime = Date.now();

const visuals = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;

for (const c of writerData.contents) {
  console.log(`▶ ${c.trend_name} (${c.content_id ?? "id 없음"})`);

  // 1단계: 쿼리 생성 + 이미지 검색
  let queries = [];
  let references = [];
  try {
    const r = await generateQueriesAndSearch({ brand: brandData, content: c });
    queries = r.queries;
    references = r.references;
    if (r.usage) {
      totalInputTokens += r.usage.input_tokens ?? 0;
      totalOutputTokens += r.usage.output_tokens ?? 0;
    }
    console.log(`  [1단계] 쿼리 ${queries.length}개 → 레퍼런스 ${references.length}건`);
  } catch (err) {
    console.error(`  ❌ [1단계] 실패: ${err.message}`);
    continue;
  }

  // 2단계: 레퍼런스 비전 분석 (Haiku)
  let analysis;
  try {
    const r2 = await analyzeReferences({ brand: brandData, content: c, references });
    analysis = r2.analysis;
    if (r2.usage) {
      totalInputTokens += r2.usage.input_tokens ?? 0;
      totalOutputTokens += r2.usage.output_tokens ?? 0;
    }
    console.log(
      `  [2단계] shot_type="${analysis.shot_type}" / mood="${analysis.mood}" (이미지 ${r2.analyzed_count}장)`,
    );
  } catch (err) {
    console.error(`  ❌ [2단계] 실패: ${err.message}`);
    continue;
  }

  // 3단계: 영문 generation_prompt 작성 (Haiku, 끝에 aspect+Avoid 코드가 통합)
  let generation_prompt;
  try {
    const r3 = await generatePrompt({ brand: brandData, content: c, analysis });
    generation_prompt = r3.generation_prompt;
    if (r3.usage) {
      totalInputTokens += r3.usage.input_tokens ?? 0;
      totalOutputTokens += r3.usage.output_tokens ?? 0;
    }
    console.log(`  [3단계] 프롬프트 길이 ${generation_prompt.length}자`);
  } catch (err) {
    console.error(`  ❌ [3단계] 실패: ${err.message}`);
    continue;
  }

  // 4단계: 이미지 생성 (TODO — Replicate 키 도착 후)
  const generated_image_url = null;

  visuals.push({
    content_id: c.content_id,
    trend_name: c.trend_name,
    search_queries: queries,
    references,
    analysis,
    generation_prompt,
    aspect_ratio: "3:4",
    reference_image_path: productImagePath,
    generated_image_url,
  });
}

// 5. 저장
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const finalData = { brand_name: brandName, visuals };
const result = wrap(finalData);

const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "design-v2-output.json");
writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

console.log("\n=== 메타 ===");
console.log(`소요 시간     : ${elapsed}s`);
console.log(`산출 시안     : ${visuals.length}개`);
console.log(`입력 토큰     : ${totalInputTokens} (Anthropic 누적)`);
console.log(`출력 토큰     : ${totalOutputTokens} (Anthropic 누적)`);
console.log(`결과 저장     : ${outputPath}`);
console.log(`\n⚠️ 현재 1~3단계 구현됨. 4단계(이미지 생성)는 Replicate 키 도착 후.`);
