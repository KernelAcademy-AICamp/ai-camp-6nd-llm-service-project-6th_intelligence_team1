import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 매칭가 출력 스키마 v0.3 (4기준: Ingred-Fit / Visual-Fit / Life-Fit / Safe-Fit).
// 각 기준 단일 ✅/⚠️/❌ 판정. verdict는 4기준 합산 + ❌ 개수로 결정.
// envelope(schema_version·generated_at·status)은 shared/envelope.js가 자동 부여.

// ─── 입력 스키마 (분석가 산출 검증) ─────────────────────────────────

const TONE_KEYWORDS = [
  "클린뷰티",
  "로맨틱·감성",
  "럭셔리·프리미엄",
  "키치·플레이풀",
  "더마·과학적",
  "Z세대·트렌디",
  "비건",
];

const AGE_GROUP_RE = /^(\d+대|Z세대|MZ세대|밀레니얼)$/;

const BrandTargetSchema = z
  .object({
    gender: z.enum(["여성", "남성", "공용"]).optional(),
    age_groups: z
      .array(z.string().regex(AGE_GROUP_RE, "age_groups 원소는 '20대' 또는 'Z세대/MZ세대/밀레니얼' 형식"))
      .optional(),
    age_range: z
      .string()
      .regex(/^\d+(-\d+)?$/, "age_range는 '20-30' 형식")
      .optional(),
    involvement: z.string().optional(),
    motivation: z.array(z.string()).optional(),
  })
  // Life-Fit이 LLM 정성 평가라 필수 필드가 줄어듬. 다만 라이프스타일 비교에 쓸 정보 최소 1개는 있어야.
  .refine(
    (t) =>
      (Array.isArray(t.age_groups) && t.age_groups.length > 0) ||
      (typeof t.age_range === "string" && t.age_range.trim().length > 0) ||
      (Array.isArray(t.motivation) && t.motivation.length > 0) ||
      (typeof t.involvement === "string" && t.involvement.trim().length > 0),
    { message: "target에 age·motivation·involvement 중 최소 1개는 있어야 Life-Fit 평가 가능" },
  );

export const InputBrandSchema = z
  .object({
    data: z
      .object({
        brand_name: z.string().min(1, "brand_name은 비어있지 않아야 함"),
        category: z.string().min(1, "category 비어있음 (카테고리 게이트에 필요, 예: '메이크업 > 립')"),
        tone_and_manner: z
          .array(
            z.enum(TONE_KEYWORDS, {
              message: `tone_and_manner는 ${TONE_KEYWORDS.join("·")} 중 하나여야 합니다`,
            }),
          )
          .min(1, "tone_and_manner는 최소 1개 (Visual·Safe-Fit 평가에 필요)"),
        target: BrandTargetSchema,
        // 선택: 있으면 Ingred-Fit이 강한 근거. 없으면 LLM이 정성 판단.
        product_features: z.array(z.string().min(1)).min(1).optional(),
        // 선택: 있으면 Visual-Fit이 매체 매칭 강도 ↑.
        media_channels: z.array(z.string().min(1)).min(1).optional(),
      })
      .passthrough(),
  })
  .passthrough();

// 트렌드 audience_distribution: Life-Fit이 LLM 정성 평가로 바뀌어 필수 X (코드 계산 폐지).
// 다만 LLM이 인구통계 참고는 가능하므로 선택 필드로 유지 (스키마 검증 없이 통과).
const TrendItemSchema = z
  .object({
    trend_name: z.string().min(1, "trend_name 비어있음"),
    category: z.string().min(1, "category 비어있음"),
    summary: z.string().min(1, "summary 비어있음 (모든 4기준 평가에 필요)"),
    keywords: z.array(z.string().min(1)).optional(),
    core_keywords: z.array(z.string().min(1)).optional(),
  })
  .passthrough()
  .refine(
    (t) =>
      (Array.isArray(t.keywords) && t.keywords.length > 0) ||
      (Array.isArray(t.core_keywords) && t.core_keywords.length > 0),
    { message: "keywords 또는 core_keywords 중 하나는 비어있지 않아야 함 (Ingred-Fit 평가에 필요)" },
  );

export const InputTrendSchema = z
  .object({
    data: z
      .object({
        trends: z.array(TrendItemSchema).min(1, "trends 배열 비어있음"),
      })
      .passthrough(),
  })
  .passthrough();

// ─── 출력 스키마 ────────────────────────────────────────────────────

// 4기준 단일 결과. ⚠️/❌일 때 gap·solution(컨설팅 제안)을 LLM이 작성.
// ✅이면 갭 없으므로 gap·solution 생략 또는 null.
const FitResultSchema = z.object({
  result: z.enum(["✅", "⚠️", "❌"]),
  reason: z.string(),
  gap: z.string().nullable().optional(), // 어디서 어긋나는지 (⚠️/❌일 때)
  solution: z.string().nullable().optional(), // 갭을 메우는 액션 (⚠️/❌일 때)
});

// 데이터 근거 — 입력에서 직접 확인 가능한 사실 + 출처만. 정성 판단은 제외.
const EvidenceReasonSchema = z.object({
  category: z.string(), // 예: "성분 적합성", "매체 매칭", "라이프스타일 매칭", "트렌드 수명"
  fact: z.string(),
  source: z.string(),
});

const EvaluationItemSchema = z.object({
  trend_name: z.string(),
  evaluation: z.object({
    ingred_fit: FitResultSchema, // 제품 features ↔ 트렌드 성분·효능
    visual_fit: FitResultSchema, // 매체·톤 ↔ 트렌드 매체 콘텐츠
    life_fit: FitResultSchema, // 타겟 ↔ 트렌드 라이프스타일·가치관
    safe_fit: FitResultSchema, // 브랜드 격·톤 ↔ 트렌드 수명·이미지
  }),
  score: z.number().int().min(0).max(8), // ✅=2, ⚠️=1, ❌=0 합산 (max 8)
  verdict: z.enum(["1순위", "2순위", "3순위", "제외"]),
  summary_reasons: z.array(EvidenceReasonSchema).min(1).max(3),
});

const RecommendationSchema = z.object({
  rank: z.number().int().positive(),
  trend_name: z.string(),
  summary_reasons: z.array(EvidenceReasonSchema),
});

export const MatchDataSchema = z.object({
  brand_name: z.string(),
  recommendations: z.array(RecommendationSchema),
  evaluations: z.array(EvaluationItemSchema),
});

export const MatchResultSchema = envelopeSchema(MatchDataSchema);

// ─── LLM 전용 출력 스키마 ───────────────────────────────────────────
// LLM은 4기준 정성 판정 + summary_reasons만 생성. score·verdict는 코드가 계산.
const LlmEvaluationItemSchema = z.object({
  trend_name: z.string(),
  ingred_fit: FitResultSchema,
  visual_fit: FitResultSchema,
  life_fit: FitResultSchema,
  safe_fit: FitResultSchema,
  summary_reasons: z.array(EvidenceReasonSchema).min(1).max(3),
});

export const LlmMatchDataSchema = z.object({
  evaluations: z.array(LlmEvaluationItemSchema),
});
