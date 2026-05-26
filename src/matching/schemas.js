import { z } from "zod";

// 매칭가 출력 스키마 v0.2 (2질문 × 2비교 × ✅/⚠️/❌ 판정 방식)
// match-result.example.json과 동일 구조

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

const DataSchema = z.object({
  brand_name: z.string(),
  evaluations: z.array(EvaluationItemSchema),
});

export const MatchResultSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  status: z.enum(["success", "error"]),
  data: DataSchema,
});
