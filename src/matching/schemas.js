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

const BrandTargetSchema = z
  .object({
    gender: z.enum(["여성", "남성", "공용"], {
      message: "gender는 '여성'·'남성'·'공용' 중 하나여야 합니다",
    }),
    age_groups: z
      .array(z.string().regex(/^\d+대$/, "age_groups 원소는 '20대' 형식"))
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

const TrendItemSchema = z
  .object({
    trend_name: z.string().min(1, "trend_name 비어있음"),
    summary: z.string().min(1, "summary 비어있음 (1-A 평가에 필요)"),
    keywords: z.array(z.string().min(1)).optional(),
    core_keywords: z.array(z.string().min(1)).optional(),
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

// LLM이 직접 만드는 부분 (envelope 제외, data 본체만)
export const MatchDataSchema = z.object({
  brand_name: z.string(),
  evaluations: z.array(EvaluationItemSchema),
});

// 저장된 결과 전체를 검증할 때 사용 (envelope 포함)
export const MatchResultSchema = envelopeSchema(MatchDataSchema);
