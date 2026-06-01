import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 시안가 v2 입출력 스키마.
// 입력: 작성가 산출(v1과 동일) — 콘텐츠 N개.
// 처리: 콘텐츠별 [검색 → 비전 분석 → 프롬프트 생성 → (옵션) 이미지 생성] 4단계.
// 출력: 콘텐츠 1개당 시안 1장. shot_type 등 형식은 LLM이 레퍼런스 보고 동적 결정.

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

// ─── 단계별 LLM 출력 스키마 ──────────────────────────────────────────

// 1단계: 검색 쿼리 생성 (LLM이 콘텐츠·브랜드 보고 영문 쿼리 생성)
export const LlmSearchQueriesSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});

// 2단계: 비전 분석 결과.
// shot_type은 LLM이 레퍼런스 보고 동적으로 작성 (인물 광고·제품 단독·통합·무드보드 등 자유).
export const LlmAnalysisSchema = z.object({
  shot_type: z.string(), // 동적, LLM 자유 작성 (한국어 권장)
  mood: z.string(), // 한국어 무드 요약
  color_palette: z.array(z.string()).optional(), // HEX 또는 색명
  composition: z.string(), // 구도 설명
  key_objects: z.array(z.string()).optional(), // 핵심 오브제
});

// 3단계: 프롬프트 생성 (LLM이 영문 generation_prompt 한 줄)
export const LlmPromptSchema = z.object({
  generation_prompt: z.string().min(1),
});

// ─── 최종 출력 스키마 (envelope의 data) ─────────────────────────────

const ReferenceSchema = z.object({
  url: z.string(), // 원문 페이지 URL
  image_url: z.string().nullable(), // 이미지 URL (없으면 null)
  title: z.string(),
});

const VisualSchema = z.object({
  content_id: z.string().optional(),
  trend_name: z.string(),
  search_queries: z.array(z.string()), // 1단계 결과
  references: z.array(ReferenceSchema), // 1단계 결과
  analysis: LlmAnalysisSchema, // 2단계 결과
  generation_prompt: z.string(), // 3단계 결과 (Avoid까지 통합된 영문)
  aspect_ratio: z.literal("3:4"), // 코드 고정 (v1과 동일)
  reference_image_path: z.string(), // 제품 사진 상대 경로 (Img2Img용)
  generated_image_url: z.string().nullable(), // 4단계 결과 (Replicate URL 또는 null)
});

const DesignV2DataSchema = z.object({
  brand_name: z.string(),
  visuals: z.array(VisualSchema),
});

export const DesignV2ResultSchema = envelopeSchema(DesignV2DataSchema);
