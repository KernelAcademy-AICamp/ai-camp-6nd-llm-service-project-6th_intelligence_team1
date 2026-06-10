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
브랜드·트렌드·매칭 정보를 읽고, 시각화 가능한 광고 시안 방향을 구조화해 작성합니다.

## 각 필드 작성 기준

**scene**: 모델이 어떤 공간에서 어떤 행동을 하는지 한 문장.
  - 타겟 페르소나의 실제 라이프스타일 기반
  - 예: "30대 여성이 자연광 창가에서 거울을 보며 데일리 메이크업을 마무리하는 장면"

**visual_mood**: 광고의 전체 분위기·빛·피부 질감 한 문장.
  - 브랜드 톤앤매너에서 도출
  - 예: "정제된 럭셔리, 소프트 자연광, 세미매트 피부 질감"

**product_moment**: 제품이 화면에 등장하는 방식.
  - 제품 특성(product_features)과 트렌드 ingred 키워드 반영
  - 예: "실키 파운데이션을 손등에 올리고 손가락으로 피부에 가볍게 블렌딩"

**color_tone**: 화면 주조색 + 보조색 2~3개.
  - 예: "누드 베이지, 웜 화이트, 소프트 그레이"

**one_line**: 이 시안의 방향을 한 줄로 요약. 검색 쿼리·카피 베이스로 쓰임.
  - [브랜드 톤] + [트렌드 핵심] + [타겟 가치관] 조합
  - 예: "완벽하지 않아도 괜찮은, 나다운 피부를 위한 럭셔리 데일리 베이스"

## 반드시 반영할 것
- 브랜드 tone_and_manner → visual_mood·color_tone 방향
- 트렌드 meaning → scene·one_line의 문화적 맥락
- 타겟 audience_signal → scene 페르소나
- 제품 product_features → product_moment

## 버릴 것
- 수치·%·검색량
- 경쟁 제품명
- 보고서 인용구`;

export async function generateConcept({ brand, content, trendData }) {
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

  const reasons = Array.isArray(content.reason_bullets)
    ? content.reason_bullets.map((r) => `- ${r}`).join("\n")
    : "(없음)";

  const meaning = trendData?.meaning ?? "(없음)";
  const audienceSignal = trendData?.audience_signal ?? "(없음)";
  const ingredKws = (() => {
    const kw = trendData?.keywords;
    if (Array.isArray(kw)) return kw.join(", ");
    if (kw?.ingred) return kw.ingred.join(", ");
    return "(없음)";
  })();

  const productFeatures = (brand.product_features ?? brand.texture_keywords ?? []).join(", ") || "(없음)";

  const userMessage = `## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${(brand.tone_and_manner ?? []).join(", ")}
- target: ${targetStr}
- product_features: ${productFeatures}

## 트렌드
- trend_name: ${content.trend_name}
- meaning(문화적 맥락): ${meaning}
- audience_signal(타겟 페르소나): ${audienceSignal}
- ingred 키워드: ${ingredKws}

## 트렌드 요약 (summary_bullets)
${bullets}

## 매칭 근거 (이 브랜드와 왜 맞는가)
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
