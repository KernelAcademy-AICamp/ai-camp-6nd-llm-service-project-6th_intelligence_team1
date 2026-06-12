import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const anthropic = new Anthropic();

export const LlmConceptSchema = z.object({
  concept: z.string().min(1), // 시안 방향 한 줄
});

const SYSTEM_PROMPT = `당신은 뷰티 광고 크리에이티브 디렉터입니다.
브랜드·트렌드·매칭 정보를 읽고, 시안 방향을 한 줄로 작성합니다.

- 브랜드 톤앤매너 + 트렌드 핵심 + 타겟 감성을 하나의 문장으로 압축
- 수치·%·경쟁 제품명·장소명 사용 금지`;

export async function generateConcept({ brand, content, trendData }) {
  const bullets = Array.isArray(content.summary_bullets)
    ? content.summary_bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")
    : "(없음)";

  const reasons = Array.isArray(content.reason_bullets)
    ? content.reason_bullets.map((r) => `- ${r}`).join("\n")
    : "(없음)";

  const userMessage = `## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- tone_and_manner: ${(brand.tone_and_manner ?? []).join(", ")}

## 트렌드
- trend_name: ${content.trend_name}

## 트렌드 요약 (작성가 정리)
${bullets}

## 매칭 근거 (작성가 정리)
${reasons}`;

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    temperature: 0,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: zodOutputFormat(LlmConceptSchema) },
  });

  const data = response.parsed_output;
  if (!data) throw new Error(`concept 자동 생성 실패 (${content.trend_name})`);
  return { concept: data.concept, usage: response.usage };
}
