import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const anthropic = new Anthropic();

export const LlmConceptSchema = z.object({
  scene: z.string().min(1),          // 장면: 누가, 어디서, 무엇을 하는가
  visual_mood: z.string().min(1),    // 분위기·빛·질감
  product_moment: z.string().min(1), // 제품이 등장하는 방식
  color_tone: z.string().min(1),     // 주조색·보조색
  one_line: z.string().min(1),       // 카피·검색 쿼리용 한 줄 방향
});

const SYSTEM_PROMPT = `당신은 뷰티 광고 크리에이티브 디렉터입니다.
작성가가 정리한 트렌드 요약과 매칭 근거를 읽고, 시안 방향 5개 필드를 간결하게 작성합니다.

- scene: 타겟 페르소나의 감성적 행동·순간 한 문장. 장소·공간 언급 금지.
- visual_mood: 브랜드 톤앤매너 기반 분위기·빛·피부 질감 한 문장.
- product_moment: 제품이 자연스럽게 등장하는 감성적 순간 한 문장. 기능 설명 금지.
- color_tone: 브랜드 아이덴티티 기반 주조색·보조색 2~3개.
- one_line: 시안 방향 한 줄 요약 (검색 쿼리·카피 베이스).

수치·%·경쟁 제품명·보고서 인용구 사용 금지.`;

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
  return { concept: data, usage: response.usage };
}
