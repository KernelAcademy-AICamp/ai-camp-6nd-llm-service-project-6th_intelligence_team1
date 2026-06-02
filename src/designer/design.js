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

// 1. 시스템 프롬프트 (LLM이 채울 슬롯 [C]·메타 규칙)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 2. 입력 로드 — 작성가 산출 + 브랜드 분석가 산출 (카테고리·톤 게이트용)
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

// 3. 입력 검증 (스키마 → 이미지 첨부 → 톤·카테고리 게이트)
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

// 3-1. 제품 사진 탐지 — inputs/product-images/<brand>.<ext>
// 텍스트 [B 제품 특징] 슬롯 대신 실제 사진을 나노바나나에 함께 전달.
function findProductImage(brand) {
  const dir = resolve(PROJECT_ROOT, "inputs/product-images");
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const p = resolve(dir, `${brand}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}
const productImageAbs = findProductImage(brandName);
// 출력엔 프로젝트 루트 기준 상대 경로로 저장 (예: inputs/product-images/식물나라.jpg)
const productImagePath = productImageAbs ? relative(PROJECT_ROOT, productImageAbs) : null;
if (!productImagePath) {
  console.error("");
  console.error("❌ 시안 생성을 진행하려면 제품 사진이 필요합니다.");
  console.error("");
  console.error("   사진을 다음 경로에 넣어주세요:");
  console.error(`   inputs/product-images/${brandName}.jpg`);
  console.error("");
  console.error("   지원 포맷: jpg, jpeg, png, webp");
  console.error("   사진을 넣은 뒤 다시 실행해주세요.");
  console.error("");
  process.exit(1);
}

// 3-2. 톤·카테고리 게이트 — 매트릭스 범위 밖이면 wrapError 저장 후 종료.
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

// 4. Claude 메시지 구성 — LLM은 [C 배경 컬러] + 메타(concept·visual_direction·negative_prompt)만 작성.
const systemContent = [
  { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
];

const inputContentCount = writerData.contents.length;
const inputContentSummary = writerData.contents
  .map((c, i) => `  ${i + 1}. content_id=${c.content_id ?? "(없음)"} / trend_name=${c.trend_name}`)
  .join("\n");

const userMessage = `다음 작성가 콘텐츠 기획으로 시안 슬롯(C + 메타)을 채우세요.

## 브랜드 정보
- brand_name: ${writerData.brand_name}
- category: ${brandCategory}
- tone_and_manner: ${JSON.stringify(brandTone)}

## 콘텐츠 기획 (총 ${inputContentCount}개 — **이 중 하나도 빠뜨리지 마세요**)
${inputContentSummary}

\`\`\`json
${JSON.stringify(writerData, null, 2)}
\`\`\`

## 출력 규칙
- 콘텐츠 **1개당 1건씩**, 입력과 정확히 1:1 매핑 — 출력 \`contents[]\` 길이는 **반드시 ${inputContentCount}** (위 ${inputContentCount}개 모두 포함, 입력 순서 유지, 같은 trend_name·content_id 중복 출력 금지, 입력에 없는 콘텐츠 추가 금지).
- 각 콘텐츠마다 person(인물 샷)·product(제품 샷) 두 슬롯에 작성: c_background, negative_prompt, concept, visual_direction.
- ⚠️ [A 모델 특징]·[B 제품 특징]·[D 자세 및 구도]·고정 틀·aspect_ratio는 절대 만들지 마세요.
  · [A]·[D]는 코드가 매트릭스 룩업
  · [B]는 첨부 제품 사진으로 대체 (텍스트 슬롯 없음)
  · aspect_ratio는 코드가 3:4 고정
- LLM은 [C 배경 컬러] + 메타(concept·visual_direction·negative_prompt)만 출력.`;

// 5. Claude API 호출 (structured output 강제)
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

// 6. 고정 틀 조립 — 인물·제품 두 종류. 각 시안은 단일 generation_prompt 한 줄로 출력.
//    · aspect_ratio는 3:4 고정. 본문 끝에 'vertical 3:4 portrait composition' 어휘 자동 포함.
//      (나노바나나 캔버스 강제는 UI 설정이 담당, 본문은 구도 유도)
//    · negative_prompt는 별도 필드 없이 본문 끝에 'Avoid: ...' 형태로 합쳐 출력.
//    · 인물샷 손 중복 방지 4어휘는 코드가 무조건 append (LLM이 빼먹어도 강제 포함).
const ASPECT_RATIO = "3:4";
const ASPECT_TAIL = "vertical 3:4 portrait composition";
// 인물 손·팔 결함 방지 어휘. LLM의 negative_prompt에 코드가 무조건 append.
// 같은 의미라도 표현이 다르면 생성기마다 인식이 달라 모두 박는다 (mergeNegative가 정확 일치만 dedup).
const PERSON_NEGATIVE_FIXED = [
  "duplicate hands",
  "duplicated hands",
  "two left hands",
  "two right hands",
  "mirrored hands",
  "extra hands",
  "extra arms",
  "missing hands",
  "fused hands",
  "deformed hands",
  "more than two hands",
  "multiple hands",
  "asymmetrical hands",
];

function mergeNegative(llmNeg, fixedTokens) {
  const tokens = String(llmNeg ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set(tokens.map((t) => t.toLowerCase()));
  for (const t of fixedTokens) {
    if (seen.has(t.toLowerCase())) continue;
    tokens.push(t);
    seen.add(t.toLowerCase());
  }
  return tokens.join(", ");
}

function withAvoid(base, negative) {
  return negative ? `${base}. Avoid: ${negative}.` : base;
}

function buildPersonPrompt({ a_model, d_pose, c_background, negative }) {
  const base = `1girl, korean beauty influencer, ${a_model}, ${d_pose}, ${c_background}, high-fashion cosmetic advertising composition, directional beauty lighting, skin sheen, soft catchlights in the eyes, sharp focus, shallow depth of field, creamy bokeh, cinematic lighting, photorealistic, hyper-detailed, masterpiece, best quality, 8k wallpaper, ${ASPECT_TAIL}`;
  return withAvoid(base, negative);
}
function buildProductPrompt({ a_product, d_layout, c_background, negative }) {
  const base = `product still life photography, no human, no model, ${a_product}, ${d_layout}, ${c_background}, premium cosmetic advertising composition, commercial product shot, sharp focus, hyper-detailed product texture, soft reflections, photorealistic, masterpiece, best quality, 8k wallpaper, ${ASPECT_TAIL}`;
  return withAvoid(base, negative);
}

// 7. 콘텐츠별 시안 조립 — 각 콘텐츠당 인물 1장 + 제품 1장.
//    LLM이 가끔 같은 콘텐츠를 두 번 출력하는 경우가 있어 content_id/trend_name 기준 dedup.
const seenKeys = new Set();
const dedupedContents = [];
for (const c of data.contents) {
  const key = c.content_id || c.trend_name;
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);
  dedupedContents.push(c);
}
if (dedupedContents.length !== data.contents.length) {
  console.warn(
    `⚠️ LLM 출력에서 ${data.contents.length - dedupedContents.length}개 중복 콘텐츠 제거됨 (${data.contents.length} → ${dedupedContents.length})`,
  );
}

// 7-1. 입력과 출력 1:1 매핑 검증 — LLM이 콘텐츠 누락 시 어떤 게 빠졌는지 알림.
const inputKeys = writerData.contents.map((c) => c.content_id || c.trend_name);
const outputKeys = new Set(dedupedContents.map((c) => c.content_id || c.trend_name));
const missing = inputKeys.filter((k) => !outputKeys.has(k));
if (missing.length > 0) {
  console.warn(
    `⚠️ LLM이 ${missing.length}개 콘텐츠를 누락했습니다 (${inputContentCount}개 입력 → ${dedupedContents.length}개 출력):`,
  );
  missing.forEach((k) => console.warn(`   - ${k}`));
  console.warn(`   누락된 콘텐츠는 시안가 결과에 포함되지 않습니다. 필요 시 재실행하세요.`);
}

const visuals = [];
for (const c of dedupedContents) {
  const seed = c.content_id || c.trend_name;

  // 인물 샷 — [A]는 톤 룩업(고정), [D]는 카테고리+시드 룩업.
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
        negative: mergeNegative(c.person.negative_prompt, PERSON_NEGATIVE_FIXED),
      }),
      aspect_ratio: ASPECT_RATIO,
      reference_image_path: productImagePath,
    });
  }

  // 제품 샷 — [A]+[D] 모두 카테고리+시드 룩업. [A]는 통일된 한 줄, [D]가 무드·구도 결정.
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
        negative: c.product.negative_prompt,
      }),
      aspect_ratio: ASPECT_RATIO,
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
