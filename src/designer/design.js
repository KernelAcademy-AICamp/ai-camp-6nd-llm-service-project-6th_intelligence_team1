import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmDesignDataSchema, InputWriterSchema } from "./schemas.js";
import {
  isCategorySupported,
  pickPersonPose,
  pickProductShot,
  pickPersonA,
} from "./d-matrix.js";
import { wrap, wrapError } from "../../shared/envelope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 시스템 프롬프트 (LLM이 채울 슬롯 [B]·[C]·메타 규칙)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 2. 작성가 산출 로드 + 브랜드 입력 로드 (카테고리 파악·게이트용)
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

// 2-1. 입력 유효성 검사
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
const brandCategory = brandRaw?.data?.category ?? "";
const brandTone = brandRaw?.data?.tone_and_manner ?? [];
const brandName = writerData.brand_name;

// 2-0. 제품 이미지 탐지 — inputs/product-images/<brand>.<ext>
// [B 제품 특징] 텍스트 슬롯 대신 실제 사진을 나노바나나에 함께 전달하기 위함.
function findProductImage(brand) {
  const dir = resolve(PROJECT_ROOT, "inputs/product-images");
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const p = resolve(dir, `${brand}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}
const productImageAbs = findProductImage(brandName);
// 출력엔 프로젝트 루트 기준 상대 경로로 저장 (예: inputs/product-images/힌스.jpg)
const productImagePath = productImageAbs ? relative(PROJECT_ROOT, productImageAbs) : null;
if (!productImagePath) {
  console.error("");
  console.error("❌ 시안 생성을 진행하려면 제품 사진이 필요합니다.");
  console.error("");
  console.error("   사진을 다음 경로에 넣어주세요:");
  console.error(`   inputs/product-images/${brandName}.jpg`);
  console.error(`   (예: inputs/product-images/${brandName}.jpg)`);
  console.error("");
  console.error("   지원 포맷: jpg, png, webp");
  console.error("   사진을 넣은 뒤 다시 실행해주세요.");
  console.error("");
  process.exit(1);
}

// 2-2. 게이트 — 인물 [A]는 톤별 매트릭스, [D]·제품 [A]는 카테고리별 매트릭스라
//      입력이 매트릭스 범위 밖이면 처리 불가. 둘 다 점검 후 미지원이면 wrapError 파일 저장하고 종료.
function exitUnsupported(message) {
  console.error(`❌ ${message}`);
  writeFileSync(
    resolve(PROJECT_ROOT, "shared/data/design-output.json"),
    JSON.stringify(wrapError(message), null, 2),
    "utf-8",
  );
  process.exit(1);
}
const personA = pickPersonA(brandTone);
if (!personA) {
  exitUnsupported(
    `시안가 미지원 톤: '${JSON.stringify(brandTone)}'. ` +
      `지원: 클린뷰티·로맨틱·감성·럭셔리·프리미엄·키치·플레이풀·더마·과학적·Z세대·트렌디·비건`,
  );
}
if (!isCategorySupported(brandCategory)) {
  exitUnsupported(
    `시안가 미지원 카테고리: '${brandCategory}'. ` +
      `지원: 클렌징·스킨케어·메이크업>립·메이크업>베이스·메이크업>아이`,
  );
}

// 3. 시스템 컨텐츠
const systemContent = [
  { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
];

// 4. 사용자 메시지 — 작성가 콘텐츠 + 브랜드 정보 (LLM은 [B]·[C]·메타만 채움)
const userMessage = `다음 작성가 콘텐츠 기획으로 시안 슬롯(B/C + 메타)을 채우세요.

## 브랜드 정보
- brand_name: ${writerData.brand_name}
- category: ${brandCategory}
- tone_and_manner: ${JSON.stringify(brandTone)}

## 콘텐츠 기획
\`\`\`json
${JSON.stringify(writerData, null, 2)}
\`\`\`

각 콘텐츠마다 person(인물 샷)과 product(제품 샷) 슬롯을 채워 \`contents[]\`에 담아 반환하세요.
- 각 샷에 작성: c_background, negative_prompt, aspect_ratio, concept, visual_direction
- ⚠️ [A 모델 특징]·[B 제품 특징]·[D 자세 및 구도]·고정 틀은 절대 만들지 마세요.
  · [A]·[D]는 코드가 매트릭스 룩업
  · [B]는 첨부 제품 사진으로 대체 (텍스트 슬롯 없음)
- LLM은 [C 배경 컬러] + 메타만 출력.`;

// 5. Claude API 호출
const client = new Anthropic();
console.log("시안 생성 시작...\n");
const startTime = Date.now();

const response = await client.messages.parse({
  model: "claude-haiku-4-5",
  max_tokens: 8192,
  temperature: 0,
  system: systemContent,
  messages: [{ role: "user", content: userMessage }],
  output_config: { format: zodOutputFormat(LlmDesignDataSchema) },
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

const data = response.parsed_output;
if (!data) {
  console.error("❌ 스키마 검증 실패");
  console.error(response.content.find((b) => b.type === "text")?.text ?? "");
  process.exit(1);
}

// 6. 고정 틀 조립 함수 (인물·제품 두 가지)
//    [B 제품 특징] 텍스트 슬롯은 제거됨 — 첨부 사진이 그 역할을 대신.
function buildPersonPrompt({ a_model, d_pose, c_background }) {
  return `1girl, korean beauty influencer, ${a_model}, ${d_pose}, ${c_background}, high-fashion cosmetic advertising composition, directional beauty lighting, skin sheen, soft catchlights in the eyes, sharp focus, shallow depth of field, creamy bokeh, cinematic lighting, photorealistic, hyper-detailed, masterpiece, best quality, 8k wallpaper`;
}
function buildProductPrompt({ a_product, d_layout, c_background }) {
  return `product still life photography, no human, no model, ${a_product}, ${d_layout}, ${c_background}, premium cosmetic advertising composition, commercial product shot, sharp focus, hyper-detailed product texture, soft reflections, photorealistic, masterpiece, best quality, 8k wallpaper`;
}

// 7. 콘텐츠별로 person+product 두 시안 조립 (D는 코드 매트릭스 룩업)
const visuals = [];
for (const c of data.contents) {
  const seed = c.content_id || c.trend_name;

  // 인물 샷 [A]는 톤 룩업(고정), [D]는 카테고리+시드 룩업
  const personD = pickPersonPose(brandCategory, seed);
  if (personD) {
    visuals.push({
      content_id: c.content_id,
      trend_name: c.trend_name,
      shot_type: "person",
      concept: c.person.concept,
      visual_direction: c.person.visual_direction,
      generation_prompt: buildPersonPrompt({
        a_model: personA,
        d_pose: personD,
        c_background: c.person.c_background,
      }),
      negative_prompt: c.person.negative_prompt,
      aspect_ratio: c.person.aspect_ratio,
      reference_image_path: productImagePath,
    });
  }

  // 제품 샷 [A]+[D]
  const productAD = pickProductShot(brandCategory, seed);
  if (productAD) {
    visuals.push({
      content_id: c.content_id,
      trend_name: c.trend_name,
      shot_type: "product",
      concept: c.product.concept,
      visual_direction: c.product.visual_direction,
      generation_prompt: buildProductPrompt({
        a_product: productAD.a_slot,
        d_layout: productAD.d_slot,
        c_background: c.product.c_background,
      }),
      negative_prompt: c.product.negative_prompt,
      aspect_ratio: c.product.aspect_ratio,
      reference_image_path: productImagePath,
    });
  }
}

const finalData = { brand_name: writerData.brand_name, visuals };
const result = wrap(finalData);

// 8. 결과 출력·저장
console.log("=== 시안 결과 ===\n");
console.log(JSON.stringify(result, null, 2));

const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "design-output.json");
writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

// 9. 메타
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
console.log(`산출 시안     : ${finalData.visuals.length}개 (콘텐츠 ${data.contents.length}건 × 2)`);
if (usage) {
  console.log(`입력 토큰     : ${usage.input_tokens}`);
  console.log(`출력 토큰     : ${usage.output_tokens}`);
  console.log(`예상 비용     : $${cost.toFixed(6)} (≈ ${(cost * 1300).toFixed(2)}원)`);
}
console.log(`결과 저장     : ${outputPath}`);
