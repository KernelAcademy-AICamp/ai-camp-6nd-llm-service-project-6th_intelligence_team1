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

// ─── 출력 스키마 ────────────────────────────────────────────────────
// 한 시안(인물 또는 제품). LLM이 채우는 슬롯(A/B/C)과 코드가 채우는 슬롯([D]+필요 시 [A])이 섞임.
const VisualSchema = z.object({
  content_id: z.string().optional(),
  trend_name: z.string(),
  shot_type: z.enum(["person", "product"]), // 인물 샷 / 제품 샷
  concept: z.string(), // 시안 한 줄 컨셉 (한국어)
  visual_direction: z.string(), // 비주얼 방향 설명 (한국어)
  generation_prompt: z.string(), // 나노바나나에 넣을 영문 프롬프트 (고정 틀에 슬롯 채워진 완성형)
  negative_prompt: z.string(), // 피할 요소 (영문 콤마 구분)
  aspect_ratio: z.string(), // "9:16" | "1:1" | "16:9" 등
});

// 최종 저장 구조 — 콘텐츠 1개당 visual 2개(person, product)가 visuals 배열에 평탄화돼 들어감.
export const DesignDataSchema = z.object({
  brand_name: z.string(),
  visuals: z.array(VisualSchema),
});

export const DesignResultSchema = envelopeSchema(DesignDataSchema);

// ─── LLM 전용 출력 스키마 ───────────────────────────────────────────
// LLM은 슬롯 텍스트만 생성. [D]는 코드 룩업이라 LLM이 안 만듦.
// 콘텐츠 1개 → person·product 두 묶음으로 출력.
const LlmShotSlotsSchema = z.object({
  concept: z.string(),
  visual_direction: z.string(),
  // 인물 샷: a_model(모델 특징) | 제품 샷: a_product 없음(코드 매트릭스가 채움)
  a_model: z.string().optional(), // person 샷에만
  b_product: z.string(), // 공통
  c_background: z.string(), // 공통
  negative_prompt: z.string(),
  aspect_ratio: z.string(),
});

const LlmContentVisualsSchema = z.object({
  trend_name: z.string(),
  content_id: z.string().optional(),
  person: LlmShotSlotsSchema, // a_model 필수
  product: LlmShotSlotsSchema, // a_model 없음
});

export const LlmDesignDataSchema = z.object({
  contents: z.array(LlmContentVisualsSchema),
});
