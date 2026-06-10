import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 매칭가 출력 스키마 v0.6 (3단계 허들: Product-Fit→TnM-Fit→Target-Fit).
// 0순위(product)·1순위(tone) ❌ 시 eliminated_by 설정. 통과 시 target_score로 순위 결정.
// safe_fit은 시급성 참고 정보. envelope은 shared/envelope.js가 자동 부여.

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
  // Target-Fit LLM 정성 평가 — 라이프스타일 비교에 쓸 정보 최소 1개는 있어야.
  .refine(
    (t) =>
      (Array.isArray(t.age_groups) && t.age_groups.length > 0) ||
      (typeof t.age_range === "string" && t.age_range.trim().length > 0) ||
      (Array.isArray(t.motivation) && t.motivation.length > 0) ||
      (typeof t.involvement === "string" && t.involvement.trim().length > 0),
    { message: "target에 age·motivation·involvement 중 최소 1개는 있어야 Target-Fit 평가 가능" },
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
          .min(1, "tone_and_manner는 최소 1개 (TnM-Fit 평가에 필요)"),
        target: BrandTargetSchema,
        // 선택: 있으면 Product-Fit이 강한 근거. 없으면 LLM이 정성 판단.
        product_features: z.array(z.string().min(1)).min(1).optional(),
        // 선택: 참고용 (평가 기준에서 제외).
        media_channels: z.array(z.string().min(1)).min(1).optional(),
        // 캠페인 정보 (선택) — 작성가가 카피 생성에 활용. 매칭가는 사용하지 않음.
        campaign_kpi: z.enum(["신제품 런칭", "시즌 프로모션", "재구매 유도"]).optional(),
        primary_channels: z.array(z.string().min(1)).optional(),
        campaign_period: z.enum(["1주", "한달", "3개월", "1년"]).optional(),
        budget: z.enum(["200만원 미만", "200~500만원", "500~1000만원", "1000만원 초과"]).optional(),
      })
      .passthrough(),
  })
  .passthrough();

// 트렌드 audience_distribution: Target-Fit은 LLM 정성 평가. 선택 필드로 유지 (스키마 검증 없이 통과).
const TrendItemSchema = z
  .object({
    trend_name: z.string().min(1, "trend_name 비어있음"),
    category: z.string().min(1, "category 비어있음"),
    summary: z.string().min(1, "summary 비어있음 (모든 4기준 평가에 필요)"),
    keywords: z.union([
      z.array(z.string().min(1)),
      z.object({
        ingred: z.array(z.string().min(1)).optional(),
        life: z.array(z.string().min(1)).optional(),
      }),
    ]).optional(),
    core_keywords: z.array(z.string().min(1)).optional(),
  })
  .passthrough()
  .refine(
    (t) => {
      const kw = t.keywords;
      if (Array.isArray(kw) && kw.length > 0) return true;
      if (kw != null && typeof kw === "object" && (kw.ingred?.length > 0 || kw.life?.length > 0)) return true;
      if (Array.isArray(t.core_keywords) && t.core_keywords.length > 0) return true;
      return false;
    },
    { message: "keywords 또는 core_keywords 중 하나는 비어있지 않아야 함 (Product-Fit 평가에 필요)" },
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

const FitResultSchema = z.object({
  result: z.enum(["✅", "⚠️", "❌"]),
  reason: z.string(),
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
    product_fit: FitResultSchema, // 0순위 허들 — 성분·텍스처
    tnm_fit: FitResultSchema, // 1순위 허들 — 톤앤매너
    target_fit: FitResultSchema,   // 2순위 순위 결정 — 라이프스타일
    safe_fit: FitResultSchema,   // 서브 참고 — 트렌드 시급성
  }),
  target_score: z.number().int().min(0).max(2), // target_fit: ✅=2, ⚠️=1, ❌=0
  eliminated_by: z.enum(["product", "tone", "category"]).nullable(),
  summary_reasons: z.array(EvidenceReasonSchema).min(1).max(3),
});

const RecommendationSchema = z.object({
  rank: z.number().int().positive(),
  trend_id: z.string().nullable(),
  trend_name: z.string(),
  summary_reasons: z.array(EvidenceReasonSchema),
});

export const MatchDataSchema = z.object({
  brand_name: z.string(),
  recommendations: z.array(RecommendationSchema),
  evaluations: z.array(EvaluationItemSchema),
});

// 추천 트렌드 간 방향성 충돌 감지 — 정반대 개념 쌍 있으면 remove 지정
export const ConflictCheckSchema = z.object({
  has_conflict: z.boolean(),
  remove: z.string().nullable(),
  reason: z.string(),
});

export const MatchResultSchema = envelopeSchema(MatchDataSchema);

// ─── LLM 전용 출력 스키마 ───────────────────────────────────────────
// LLM은 4기준 정성 판정 + summary_reasons만 생성. score·verdict는 코드가 계산.
const LlmEvaluationItemSchema = z.object({
  trend_name: z.string(),
  product_fit: FitResultSchema,
  tnm_fit: FitResultSchema,
  target_fit: FitResultSchema,
  safe_fit: FitResultSchema,
  summary_reasons: z.array(EvidenceReasonSchema).min(1).max(3),
});

export const LlmMatchDataSchema = z.object({
  evaluations: z.array(LlmEvaluationItemSchema),
});
