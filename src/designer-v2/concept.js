import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const anthropic = new Anthropic();

const LlmConceptSchema = z.object({
  concept: z.string().min(1),
});

const SYSTEM_PROMPT = `당신은 뷰티 광고 크리에이티브 디렉터입니다.
트렌드 분석 보고서(summary_bullets)에서 시각화 가능한 라이프스타일·감성 요소만 추출해,
브랜드 톤앤매너에 맞는 시안 방향 한 줄을 작성합니다.

## 추출할 것
- 소비자 라이프스타일·감성 표현
- 트렌드가 표현하는 피부 마무리·분위기
- 타겟 페르소나의 행동·가치관

## 버릴 것
- 수치·%·검색량·성장률
- 경쟁 제품명
- 시장 규모·보고서 인용

## 출력 구조
[브랜드 톤] + [제품]으로 연출하는 [트렌드 시각 핵심] — [타겟 페르소나]의 [라이프스타일·가치관]

예시:
"럭셔리 브랜드 헤라의 실키 파운데이션으로 연출하는 세미매트 피부 — 과하지 않은 커버와 자연스러운 피부 결, 30대 커리어 여성의 자기표현을 위한 프리미엄 데일리 베이스"

## 출력 형식
{"concept": "..."}

코드 블록·인사 없이 순수 JSON 하나만.`;

export async function generateConcept({ brand, content }) {
  const targetStr = brand.target
    ? [
        brand.target.gender,
        (brand.target.age_groups ?? []).join("·"),
        brand.target.involvement,
        (brand.target.motivation ?? []).join("·"),
      ]
        .filter(Boolean)
        .join(", ")
    : "(없음)";

  const bullets = Array.isArray(content.summary_bullets)
    ? content.summary_bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")
    : "(없음)";

  const userMessage = `## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}
- target: ${targetStr}

## 트렌드
- trend_name: ${content.trend_name}

## 트렌드 분석 (summary_bullets)
${bullets}`;

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    temperature: 0,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: zodOutputFormat(LlmConceptSchema) },
  });

  const data = response.parsed_output;
  if (!data) throw new Error(`concept 자동 생성 실패 (${content.trend_name})`);
  return { concept: data.concept, usage: response.usage };
}
