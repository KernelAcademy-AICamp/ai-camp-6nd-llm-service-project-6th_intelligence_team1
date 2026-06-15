import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 시안가 v2 입출력 스키마.
// 입력: 매칭가 산출(match-result) + 트렌드 분석가 산출(trend-analysis) + 브랜드 분석가 산출(brand-analysis)
// 처리: 트렌드별 × 매체별(Pinterest·Instagram·Mintoiro) 검색 → 매체별 선별·분석 → 매체별 분석 종합 → 시안 1개.
// 출력: 트렌드 1개당 시안 1장.

// ─── 입력 스키마 (매칭가 산출 검증) ─────────────────────────────────
const MatchReasonSchema = z.object({
  category: z.string(),
  fact: z.string(),
  source: z.string().optional(),
}).passthrough();

const MatchRecommendationSchema = z.object({
  rank: z.number().int().min(1),
  trend_name: z.string().min(1, "trend_name 비어있음"),
  summary_reasons: z.array(MatchReasonSchema).min(1),
}).passthrough();

export const InputMatchSchema = z
  .object({
    data: z
      .object({
        brand_name: z.string().min(1, "brand_name 비어있음"),
        recommendations: z
          .array(MatchRecommendationSchema)
          .min(1, "recommendations 배열 비어있음 (시안 만들 추천 없음)"),
      })
      .passthrough(),
  })
  .passthrough();

// ─── 1단계 LLM: 검색 쿼리 생성 ──────────────────────────────────────
//   queries: 영문 자연어 쿼리 — Pinterest용.
export const LlmSearchQueriesSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
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
  lighting: z.string().optional(), // 조명 방향·강도·유형 (한국어). 예: "부드러운 측면 자연광", "스튜디오 림 라이트"
  pose: z.string().optional(), // 인물샷 전용: 자세·시선·손 위치 (한국어). 예: "3/4 각도, 눈 감음, 뺨에 손"
  texture: z.string().optional(), // 피부 또는 제품 텍스처 묘사 (한국어). 예: "글래스 스킨", "매트 포어리스"
  hair: z.string().optional(), // 인물샷 전용: 헤어 스타일·컬러 (한국어). 예: "다크 브라운 웨이브 롱헤어"
  makeup: z.string().optional(), // 인물샷 전용: 메이크업 룩 (한국어). 예: "누드 립 클린 메이크업"
  styling: z.string().optional(), // 인물샷 전용: 의상·네크라인 (한국어). 예: "화이트 오프숄더 미니멀"
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
  search_queries: z.array(z.string()), // Pinterest 영문 쿼리
  references_by_source: z.object({
    pinterest: z.array(ReferenceSchema),
  }), // 1단계 수집된 raw
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
