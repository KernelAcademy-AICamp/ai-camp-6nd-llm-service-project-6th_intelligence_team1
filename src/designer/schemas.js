import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 시안가(designer) 입출력 스키마.
// 입력: 작성가 산출(콘텐츠 기획) → 출력: 시안 명세(컨셉 + 이미지/영상 생성 프롬프트).

// ─── 입력 스키마 (작성가 산출 검증) ─────────────────────────────────
const WriterContentSchema = z
  .object({
    trend_name: z.string().min(1, "trend_name 비어있음"),
    concept: z.string().min(1, "concept 비어있음 (시안 방향의 근거)"),
  })
  .passthrough();

export const InputWriterSchema = z
  .object({
    data: z
      .object({
        brand_name: z.string().min(1, "brand_name 비어있음"),
        contents: z
          .array(WriterContentSchema)
          .min(1, "contents 배열 비어있음 (시안 만들 콘텐츠 없음)"),
      })
      .passthrough(),
  })
  .passthrough();

// ─── 출력 스키마 (시안 명세) ────────────────────────────────────────
const VisualSchema = z.object({
  content_id: z.string().optional(),
  trend_name: z.string(),
  format: z.enum(["image", "video"]),
  concept: z.string(), // 시안 한 줄 컨셉
  visual_direction: z.string(), // 구도·색감·분위기·피사체 방향 (한국어, 사람이 읽는 설명)
  generation_prompt: z.string(), // 나노바나나에 넣을 자연어 프롬프트 (양식은 사용자 정의 예정)
  negative_prompt: z.string(), // 피할 요소 (본문에 녹이는 게 권장, 별도 필드는 호환용)
  aspect_ratio: z.string(), // 예: "9:16", "1:1", "16:9" — API 호출 시 파라미터로 전달
  duration: z.string().optional(), // video일 때 길이 (예: "15초")
  scene_flow: z.array(z.string()).optional(), // video일 때 장면 흐름
});

// 최종 저장 구조 (envelope의 data) — 코드가 brand_name 부여 + LLM visuals 합침
export const DesignDataSchema = z.object({
  brand_name: z.string(),
  visuals: z.array(VisualSchema),
});

export const DesignResultSchema = envelopeSchema(DesignDataSchema);

// ─── LLM 전용 출력 스키마 ───────────────────────────────────────────
// LLM은 visuals(시안 명세)만 생성. brand_name·envelope은 코드가 부여.
export const LlmDesignDataSchema = z.object({
  visuals: z.array(VisualSchema),
});
