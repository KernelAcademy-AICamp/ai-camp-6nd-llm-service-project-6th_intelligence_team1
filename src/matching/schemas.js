import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 매칭가 출력 스키마 v0.2 (2질문 × 2비교 × ✅/⚠️/❌ 판정 방식)
// envelope(schema_version·generated_at·status)은 shared/envelope.js의 envelopeSchema로 자동 부여.

// ─── 입력 스키마 (분석가 산출 검증) ─────────────────────────────────
// LLM에 보내기 전 형식·타입·enum 위반을 코드에서 잡는다. 시스템 프롬프트의
// 톤 7종 enum과 일치시켜, 같은 약속을 코드·프롬프트 양쪽에서 강제.

// 시스템 프롬프트 prompts/system.md에 정의된 톤앤매너 7종 — 변경 시 같이 갱신.
const TONE_KEYWORDS = [
  "클린뷰티",
  "로맨틱·감성",
  "럭셔리·프리미엄",
  "키치·플레이풀",
  "더마·과학적",
  "Z세대·트렌디",
  "비건",
];

// age_groups 원소: '20대' 정량 표현 또는 세대 표현(Z세대·MZ세대·밀레니얼).
// 세대 표현은 match.js에서 현재 년도 기준 연령 범위로 환산됨 (GENERATION_BIRTH_YEARS).
const AGE_GROUP_RE = /^(\d+대|Z세대|MZ세대|밀레니얼)$/;

const BrandTargetSchema = z
  .object({
    gender: z.enum(["여성", "남성", "공용"], {
      message: "gender는 '여성'·'남성'·'공용' 중 하나여야 합니다",
    }),
    age_groups: z
      .array(z.string().regex(AGE_GROUP_RE, "age_groups 원소는 '20대' 또는 'Z세대/MZ세대/밀레니얼' 형식"))
      .optional(),
    age_range: z
      .string()
      .regex(/^\d+(-\d+)?$/, "age_range는 '20-30' 형식")
      .refine(
        (s) => {
          const [lo, hi] = s.split("-").map(Number);
          return hi === undefined || lo <= hi;
        },
        { message: "age_range 시작이 종료보다 큼 (예: '30-20' 불가)" },
      )
      .optional(),
    involvement: z.string().optional(),
    motivation: z.array(z.string()).optional(),
  })
  .refine(
    (t) =>
      (Array.isArray(t.age_groups) && t.age_groups.length > 0) ||
      (typeof t.age_range === "string" && t.age_range.trim().length > 0),
    { message: "target.age_groups 또는 target.age_range 중 하나는 비어있지 않아야 함 (2-A 평가에 필요)" },
  )
  .refine(
    (t) =>
      (Array.isArray(t.motivation) && t.motivation.length > 0) ||
      (typeof t.involvement === "string" && t.involvement.trim().length > 0),
    { message: "target.motivation 또는 target.involvement 중 하나는 비어있지 않아야 함 (2-B 평가에 필요)" },
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
          .min(1, "tone_and_manner는 최소 1개 (1-A·1-B 평가에 필요)"),
        target: BrandTargetSchema,
      })
      .passthrough(),
  })
  .passthrough();

// 2-A를 코드가 계산하려면 트렌드에 연령·성별 비중이 구조화돼 있어야 함.
// 합계는 1에 수렴해야 함 — 1을 넘으면 2-A 연령·성별 오버랩이 부풀려져 판정이 왜곡됨.
// 소수점 반올림 오차를 감안해 ±0.02 허용.
const RATIO_SUM_TOLERANCE = 0.02;
const sumsToOne = (nums) =>
  Math.abs(nums.reduce((s, v) => s + v, 0) - 1) <= RATIO_SUM_TOLERANCE;

const AudienceDistributionSchema = z.object({
  gender_ratio: z
    .object({
      female: z.number().min(0).max(1),
      male: z.number().min(0).max(1),
    })
    .refine((g) => sumsToOne([g.female, g.male]), {
      message: "gender_ratio 합(female+male)이 1±0.02를 벗어남 (2-A 계산 왜곡 방지)",
    }),
  age_ratio: z
    .record(z.string(), z.number().min(0).max(1))
    .refine((a) => sumsToOne(Object.values(a)), {
      message: "age_ratio 전체 합이 1±0.02를 벗어남 (2-A 계산 왜곡 방지)",
    }),
}).passthrough();

const TrendItemSchema = z
  .object({
    trend_name: z.string().min(1, "trend_name 비어있음"),
    category: z.string().min(1, "category 비어있음 (카테고리 게이트에 필요, 브랜드와 '대분류 > 소분류' 표기 동일)"),
    summary: z.string().min(1, "summary 비어있음 (1-A 평가에 필요)"),
    keywords: z.array(z.string().min(1)).optional(),
    core_keywords: z.array(z.string().min(1)).optional(),
    audience_distribution: AudienceDistributionSchema,
  })
  .passthrough()
  .refine(
    (t) =>
      (Array.isArray(t.keywords) && t.keywords.length > 0) ||
      (Array.isArray(t.core_keywords) && t.core_keywords.length > 0),
    { message: "keywords 또는 core_keywords 중 하나는 비어있지 않아야 함 (1-B 평가에 필요)" },
  );

export const InputTrendSchema = z
  .object({
    data: z
      .object({
        trends: z.array(TrendItemSchema).min(1, "trends 배열 비어있음 (평가할 트렌드 없음)"),
      })
      .passthrough(),
  })
  .passthrough();

// ─── 출력 스키마 (LLM 응답 검증) ────────────────────────────────────

const ComparisonResultSchema = z.object({
  result: z.enum(["✅", "⚠️", "❌"]),
  reason: z.string(),
});

// 데이터 근거 — 입력 데이터에서 직접 확인 가능한 사실 + 출처만. 정성 판단(톤 부합 등)은 제외.
const EvidenceReasonSchema = z.object({
  category: z.string(), // 분류 (예: "제형 적합성", "시장 성장성", "색상 적합성")
  fact: z.string(), // 입력에서 직접 확인 가능한 사실 (수치 또는 키워드 일치)
  source: z.string(), // 출처 (예: "네이버 데이터랩, 2026-01~05", "트렌드 키워드", "audience_distribution")
});

const Question1Schema = z.object({
  label: z.literal("브랜드 적합성"),
  comparisons: z.object({
    "1-A": ComparisonResultSchema,
    "1-B": ComparisonResultSchema,
  }),
  passes: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

const Question2Schema = z.object({
  label: z.literal("타겟 적합성"),
  comparisons: z.object({
    "2-A": ComparisonResultSchema,
    "2-B": ComparisonResultSchema,
  }),
  passes: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

const EvaluationItemSchema = z.object({
  trend_name: z.string(),
  evaluation: z.object({
    question_1: Question1Schema,
    question_2: Question2Schema,
  }),
  matching_grade: z.enum(["상", "중", "하", "제외"]),
  summary_reasons: z.array(EvidenceReasonSchema).min(1).max(3),
});

// 추천 트렌드 (제외 아닌 것 중 상위 N개). 코드가 정렬·선별해 생성.
// verdict 등급은 출력에 노출하지 않음 — rank(추천 순서)와 근거만. 등급은 evaluations에 내부 보존.
const RecommendationSchema = z.object({
  rank: z.number().int().positive(),
  trend_name: z.string(),
  summary_reasons: z.array(EvidenceReasonSchema),
});

// 최종 저장 구조 (코드가 LLM 정성 판정 + 코드 계산[2-A·passes·verdict]을 조립한 결과)
//   - recommendations: 브랜드와 맞는 상위 3개 추천 (제외 트렌드는 빠짐)
//   - evaluations: 입력 트렌드 전체 평가 (제외 포함, 추천순 → 제외순 정렬)
export const MatchDataSchema = z.object({
  brand_name: z.string(),
  recommendations: z.array(RecommendationSchema),
  evaluations: z.array(EvaluationItemSchema),
});

// 상위 추천 간 방향성 충돌 감지 — 정반대 개념 쌍 있으면 remove 지정
export const ConflictCheckSchema = z.object({
  has_conflict: z.boolean(),
  remove: z.string().nullable(),
  reason: z.string(),
});

// 저장된 결과 전체를 검증할 때 사용 (envelope 포함)
export const MatchResultSchema = envelopeSchema(MatchDataSchema);

// ─── LLM 전용 출력 스키마 ───────────────────────────────────────────
// LLM은 정성 판정(1-A·1-B·2-B의 result+reason)과 summary_reasons만 생성.
// 숫자 계산인 2-A, 규칙 계산인 passes·verdict는 코드(match.js)가 확정한다.
const LlmEvaluationItemSchema = z.object({
  trend_name: z.string(),
  comparisons: z.object({
    "1-A": ComparisonResultSchema,
    "1-B": ComparisonResultSchema,
    "2-B": ComparisonResultSchema,
  }),
  summary_reasons: z.array(EvidenceReasonSchema).min(1).max(3),
});

export const LlmMatchDataSchema = z.object({
  evaluations: z.array(LlmEvaluationItemSchema),
});
