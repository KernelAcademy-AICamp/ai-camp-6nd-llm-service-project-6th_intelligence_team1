import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmPromptSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic();

const promptSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/prompt.md"),
  "utf-8",
);

// ─── 3단계: 3매체 분석 종합 → 영문 generation_prompt ──────────────────
// 입력: 매체별 분석 결과 배열 (Pinterest·Instagram·Mintoiro)
// 출력: 코드가 `vertical 3:4 portrait composition. Avoid: ...` 자동 통합한 단일 텍스트

// 손·팔·손가락 기형 방지 — 인물/손이 등장하는 구도(model)에만 적용.
// 제품 정물(product) 구도에 붙이면 "hand" 단어가 Gemini에 손을 유도하는 역효과 →
// 손 없어야 할 컷에 손이 생긴다. 그래서 구도별로 분기해 붙인다.
const HAND_NEGATIVE = [
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
  "three hands",
  "four hands",
  "asymmetrical hands",
  "extra fingers",
  "missing fingers",
  "fused fingers",
  "malformed fingers",
  "six fingers",
  "wrong number of fingers",
  "floating arms",
  "disconnected arms",
  "arms not connected to body",
  "unnatural arm angle",
];
// 제품을 신체에 얹는 부자연 배치 — 인물 구도(model)에서만 의미. 정물엔 신체가 없어 불필요.
const PLACEMENT_NEGATIVE = [
  "product resting on the back of the hand",
  "product balanced flat on hand",
  "product lying flat on skin",
  "floating product",
  "product standing on the chest",
  "product propped against the body",
  "product resting on the shoulder",
  "product balanced on décolletage",
  "product standing on clothing",
  "product propped on fabric",
];
// 구도 무관 공통 — 품질·패키지 결함.
const GENERAL_NEGATIVE = [
  "text",
  "watermark",
  "low quality",
  "blurry",
  "oversaturated",
  "deformed packaging",
];
// (A) 제품을 손에 쥐는 구도일 때만 추가 — 한 손만 보이게 강제.
//     제품을 표면에 두는 (B) 구도는 양손 포즈가 정상이므로 적용 안 함.
const GRIP_NEGATIVE = [
  "two hands visible",
  "both hands in frame",
  "second hand visible",
  "hand touching face instead of holding product",
];
// generation_prompt가 "제품을 손에 쥐는" 묘사인지 감지하는 패턴.
const GRIP_RE = /holding the product|fingers[^,]*wrapped around|gripping the product|raising the product|hand[^,]*holding the product/i;
const ASPECT_TAIL = "vertical 3:4 portrait composition";

export async function generatePromptFromSources({ brand, content, analyses }) {
  const byKey = (src) => analyses.find((a) => a.source === src) ?? null;
  const pin = byKey("pinterest");

  const block = (label, a) =>
    a
      ? `### ${label}
- shot_type: ${a.shot_type}
- mood: ${a.mood}
- composition: ${a.composition}
- lighting: ${a.lighting || "(없음)"}
- pose: ${a.pose || "(인물 없음)"}
- texture: ${a.texture || "(없음)"}
- hair: ${a.hair || "(인물 없음)"}
- makeup: ${a.makeup || "(인물 없음)"}
- styling: ${a.styling || "(인물 없음)"}
- color_palette: ${JSON.stringify(a.color_palette ?? [])}
- key_objects: ${JSON.stringify(a.key_objects ?? [])}
- background: ${a.background || "(없음)"}
- source_specific: ${a.source_specific}`
      : `### ${label}\n(분석 없음)`;

  const userMessage = `다음 Pinterest 분석을 기반으로 시안 1장의 영문 generation_prompt 한 줄을 작성하세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept ?? "(없음)"}${content.composition_hint ? `\n- **고정 구도 (필수)**: ${content.composition_hint} — 이 구도를 프롬프트 구도 어휘로 반드시 반영하고, 다른 구도로 바꾸지 말 것.` : ""}

## 매체 분석

${block("Pinterest", pin)}

\`8k wallpaper\`까지만 작성. 그 뒤(aspect ratio, Avoid)는 코드가 자동 추가.`;

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    temperature: 0,
    system: [
      { type: "text", text: promptSystemPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: zodOutputFormat(LlmPromptSchema) },
  });

  const data = response.parsed_output;
  if (!data) throw new Error("프롬프트 생성 실패 (LLM 응답 파싱 실패)");

  const base = data.generation_prompt.trim().replace(/[.,\s]+$/, "");

  // 정물(product): 손/사람 단어를 negative에 노출하지 않고(Gemini 역효과 방지)
  //   본문을 긍정형으로 보강해 "제품만 단독"을 강제. negative는 품질 결함만.
  // 라이프스타일(lifestyle): 제품이 공간(화장대·욕실 등) 맥락에 놓인 컷. 인물·손 중심이
  //   아니므로 손 negative는 빼되, isolated는 강제하지 않아 공간 맥락을 살린다.
  // 인물(model): 손 기형·신체 배치 negative 유지, 손에 쥐는 구도면 한 손만 강제.
  const isProductStill = content.shot_direction === "product";
  const isLifestyle = content.shot_direction === "lifestyle";
  let body, negatives;
  if (isProductStill) {
    body = `${base}, isolated product still life, product is the sole subject, clean empty surface`;
    negatives = GENERAL_NEGATIVE;
  } else if (isLifestyle) {
    body = base;
    negatives = GENERAL_NEGATIVE;
  } else {
    body = base;
    negatives = GRIP_RE.test(base)
      ? [...HAND_NEGATIVE, ...PLACEMENT_NEGATIVE, ...GENERAL_NEGATIVE, ...GRIP_NEGATIVE]
      : [...HAND_NEGATIVE, ...PLACEMENT_NEGATIVE, ...GENERAL_NEGATIVE];
  }
  const final = `${body}, ${ASPECT_TAIL}. Avoid: ${negatives.join(", ")}.`;

  return {
    generation_prompt: final,
    usage: response.usage,
  };
}
