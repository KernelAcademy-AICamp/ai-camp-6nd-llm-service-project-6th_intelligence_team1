import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 시안가(designer) 입출력 스키마.
// 입력: 작성가 산출(콘텐츠 기획) → 출력: 콘텐츠당 시안 2장(인물 샷 + 제품 샷).

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

// ─── 최종 저장 스키마 (envelope의 data) ─────────────────────────────
// 한 시안(인물 또는 제품). 코드가 매트릭스 룩업으로 [A]·[D]를 채우고
// LLM은 [B]·[C]+메타만 채워, 코드가 고정 틀에 끼워 generation_prompt를 조립한 결과.
const VisualSchema = z.object({
  content_id: z.string().optional(),
  trend_name: z.string(),
  shot_type: z.enum(["person", "product"]),
  concept: z.string(), // 한국어 한 줄
  visual_direction: z.string(), // 한국어 2-3문장
  generation_prompt: z.string(), // 나노바나나용 영문 완성형
  negative_prompt: z.string(), // 영문 콤마 구분
  aspect_ratio: z.string(), // "9:16" | "1:1" | "16:9" | "4:5"
  reference_image_path: z.string(), // 제품 사진 경로 (필수). 나노바나나 호출 시 이미지+텍스트 같이 전달.
});

// 콘텐츠 1개당 visual 2개(person, product)가 평탄화돼 visuals 배열에 들어감.
const DesignDataSchema = z.object({
  brand_name: z.string(),
  visuals: z.array(VisualSchema),
});

// envelope 포함 전체. 외부에서 design-output.json 검증할 때 사용 가능.
export const DesignResultSchema = envelopeSchema(DesignDataSchema);

// ─── LLM 전용 출력 스키마 ───────────────────────────────────────────
// LLM은 [C 배경 컬러]·메타만 생성. [A]·[D]·고정 틀은 코드, [B 제품 특징]은 첨부 사진으로 대체.
const LlmShotSlotsSchema = z.object({
  concept: z.string(),
  visual_direction: z.string(),
  c_background: z.string(),
  negative_prompt: z.string(),
  aspect_ratio: z.string(),
});

const LlmContentVisualsSchema = z.object({
  trend_name: z.string(),
  content_id: z.string().optional(),
  person: LlmShotSlotsSchema,
  product: LlmShotSlotsSchema,
});

export const LlmDesignDataSchema = z.object({
  contents: z.array(LlmContentVisualsSchema),
});
