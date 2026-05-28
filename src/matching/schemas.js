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
    age_range: z.string().regex(/^\d+(-\d+)?$/, "age_range는 '20-30' 형식").optional(),
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
const AudienceDistributionSchema = z.object({
  gender_ratio: z.object({
    female: z.number().min(0).max(1),
    male: z.number().min(0).max(1),
  }),
  age_ratio: z.record(z.string(), z.number().min(0).max(1)),
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
  verdict: z.enum(["1순위", "2순위", "3순위", "제외"]),
  summary_reasons: z.array(z.string()).min(1).max(3),
});

// 최종 저장 구조 (코드가 LLM 정성 판정 + 코드 계산[2-A·passes·verdict]을 조립한 결과)
export const MatchDataSchema = z.object({
  brand_name: z.string(),
  evaluations: z.array(EvaluationItemSchema),
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
  summary_reasons: z.array(z.string()).min(1).max(3),
});

export const LlmMatchDataSchema = z.object({
  evaluations: z.array(LlmEvaluationItemSchema),
});
