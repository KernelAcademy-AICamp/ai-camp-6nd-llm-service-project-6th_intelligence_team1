import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 시안가 v2 입출력 스키마.
// 입력: 작성가 산출 — 트렌드 N개.
// 처리: 트렌드별 × 매체별(Pinterest·Instagram·Mintoiro) 검색 → 매체별 선별·분석 → 매체별 분석 종합 → 시안 1개.
// 출력: 트렌드 1개당 시안 1장.

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

// ─── 1단계 LLM: 검색 쿼리·해시태그 생성 ─────────────────────────────
//   queries: 영문 자연어 쿼리 — Pinterest·Mintoiro용.
//   instagram_hashtags: 인스타 해시태그 (영문/한글 단어, # 없이) — Instagram용.
export const LlmSearchQueriesSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
  instagram_hashtags: z.array(z.string().min(1)).min(1).max(5),
});

// ─── 2단계 LLM: 매체별 선별 + 분석 ──────────────────────────────────
// N장 보여주고 → 대표 1장 인덱스 + 그 매체 강점에 맞는 분석 추출.
// 매체별 강점:
//   - pinterest → composition·shot_type (구도·앵글·연출)
//   - instagram → mood·trend·lifestyle (트렌드 무드·인물·라이프스타일)
//   - mintoiro → color_palette·package (패키지 디테일·컬러·타이포)
export const LlmSourceAnalysisSchema = z.object({
  best_index: z.number().int().min(0), // 보낸 이미지 배열의 인덱스 (0부터)
  shot_type: z.string(), // 동적, 한국어
  mood: z.string(), // 한국어
  composition: z.string(), // 한국어
  color_palette: z.array(z.string()).optional(),
  key_objects: z.array(z.string()).optional(),
  background: z.string().optional(), // 배경·장소·환경 (한국어)
  source_specific: z.string(), // 이 매체에서 특히 강조할 1-2문장 (한국어)
});

// ─── 3단계 LLM: 영문 generation_prompt 작성 ─────────────────────────
export const LlmPromptSchema = z.object({
  generation_prompt: z.string().min(1),
});

// ─── 최종 출력 스키마 (envelope의 data) ─────────────────────────────

const ReferenceSchema = z.object({
  url: z.string(),
  image_url: z.string().nullable(),
  title: z.string(),
  source: z.enum(["pinterest", "mintoiro", "instagram"]),
});

// 매체별 분석 결과 + 대표 이미지.
const SourceAnalysisSchema = z.object({
  source: z.enum(["pinterest", "mintoiro", "instagram"]),
  best_reference: ReferenceSchema.nullable(), // 매체에서 선별된 대표 1장 (없으면 null)
  shot_type: z.string(),
  mood: z.string(),
  composition: z.string(),
  color_palette: z.array(z.string()).optional(),
  key_objects: z.array(z.string()).optional(),
  background: z.string().optional(),
  source_specific: z.string(),
});

const VisualSchema = z.object({
  content_id: z.string().optional(),
  trend_name: z.string(),
  search_queries: z.array(z.string()), // Pinterest·Mintoiro 영문 쿼리
  instagram_hashtags: z.array(z.string()).optional(),
  references_by_source: z.object({
    pinterest: z.array(ReferenceSchema),
    instagram: z.array(ReferenceSchema),
    mintoiro: z.array(ReferenceSchema),
  }), // 1단계 수집된 raw (매체별 10장 정도)
  analyses_by_source: z.array(SourceAnalysisSchema), // 2단계 매체별 분석
  generation_prompt: z.string(), // 3단계 종합 영문 프롬프트
  aspect_ratio: z.literal("3:4"),
  reference_image_path: z.string(), // 제품 사진 (Img2Img용)
  generated_image_url: z.string().nullable(),
});

const DesignV2DataSchema = z.object({
  brand_name: z.string(),
  visuals: z.array(VisualSchema),
});

export const DesignV2ResultSchema = envelopeSchema(DesignV2DataSchema);
