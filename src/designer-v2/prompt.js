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

const FIXED_NEGATIVE = [
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
  "text",
  "watermark",
  "low quality",
  "blurry",
  "oversaturated",
  "deformed packaging",
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
  // 제품을 손에 쥐는 구도면 "한 손만" negative를 추가로 적용.
  const negatives = GRIP_RE.test(base)
    ? [...FIXED_NEGATIVE, ...GRIP_NEGATIVE]
    : FIXED_NEGATIVE;
  const final = `${base}, ${ASPECT_TAIL}. Avoid: ${negatives.join(", ")}.`;

  return {
    generation_prompt: final,
    usage: response.usage,
  };
}
