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
  "asymmetrical hands",
  "text",
  "watermark",
  "low quality",
  "blurry",
  "oversaturated",
  "deformed packaging",
];
const ASPECT_TAIL = "vertical 3:4 portrait composition";

export async function generatePromptFromSources({ brand, content, analyses }) {
  const byKey = (src) => analyses.find((a) => a.source === src) ?? null;
  const pin = byKey("pinterest");
  const ig = byKey("instagram");
  const min = byKey("mintoiro");

  const block = (label, a) =>
    a
      ? `### ${label}
- shot_type: ${a.shot_type}
- mood: ${a.mood}
- composition: ${a.composition}
- color_palette: ${JSON.stringify(a.color_palette ?? [])}
- key_objects: ${JSON.stringify(a.key_objects ?? [])}
- source_specific: ${a.source_specific}`
      : `### ${label}\n(분석 없음)`;

  const userMessage = `다음 3매체 분석을 종합해 시안 1장의 영문 generation_prompt 한 줄을 작성하세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept}

## 매체별 분석

${block("Pinterest (구도·앵글·연출 우선)", pin)}

${block("Instagram (트렌드 무드·인물·라이프스타일 우선)", ig)}

${block("Mintoiro (패키지·컬러·타이포 우선)", min)}

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
  const final = `${base}, ${ASPECT_TAIL}. Avoid: ${FIXED_NEGATIVE.join(", ")}.`;

  return {
    generation_prompt: final,
    usage: response.usage,
  };
}
