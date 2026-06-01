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

// 3단계 — 분석 결과(shot_type·mood·구도·컬러·오브제) + 브랜드·콘셉트로 영문 generation_prompt 작성.
// 결과는 단일 텍스트 — 본문 끝에 `, vertical 3:4 portrait composition. Avoid: ...` 통합.

// 인물 손·팔 결함 방지 어휘 (제품 단독 시안에도 무해해서 모든 시안에 일괄 append).
// + 일반 광고 사진 negative.
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
  "asymmetrical hands",
  "text",
  "watermark",
  "low quality",
  "blurry",
  "oversaturated",
  "deformed packaging",
];

const ASPECT_TAIL = "vertical 3:4 portrait composition";

export async function generatePrompt({ brand, content, analysis }) {
  const userMessage = `다음 정보로 시안 1장의 영문 generation_prompt를 작성하세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept}

## 분석 결과 (레퍼런스 무드)
- shot_type: ${analysis.shot_type}
- mood: ${analysis.mood}
- composition: ${analysis.composition}
- color_palette: ${JSON.stringify(analysis.color_palette ?? [])}
- key_objects: ${JSON.stringify(analysis.key_objects ?? [])}

위 분석 결과의 무드·구도·컬러를 따라가는 영문 generation_prompt 한 줄을 작성하세요. \`8k wallpaper\`까지만 — 그 뒤(aspect ratio, Avoid)는 코드가 자동 추가.`;

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

  // LLM이 끝에 마침표·공백 붙였으면 정리 후 aspect tail + Avoid 통합.
  const base = data.generation_prompt.trim().replace(/[.,\s]+$/, "");
  const final = `${base}, ${ASPECT_TAIL}. Avoid: ${FIXED_NEGATIVE.join(", ")}.`;

  return {
    generation_prompt: final,
    usage: response.usage,
  };
}
