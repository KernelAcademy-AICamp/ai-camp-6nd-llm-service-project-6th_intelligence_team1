import { z } from "zod";
import { envelopeSchema } from "../../shared/envelope.js";

// 매칭가 출력 스키마 v0.2 (2질문 × 2비교 × ✅/⚠️/❌ 판정 방식)
// envelope(schema_version·generated_at·status)은 shared/envelope.js의 envelopeSchema로 자동 부여.

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
