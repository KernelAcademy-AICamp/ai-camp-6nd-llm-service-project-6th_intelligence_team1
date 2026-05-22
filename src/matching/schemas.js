import { z } from "zod";

// 매칭가 출력 스키마 (match-result.example.json과 동일 구조)
// Anthropic structured outputs로 강제하기 위한 런타임 검증 + 타입 정의

const ScoreBreakdownSchema = z.object({
  audience_fit: z.number().min(0).max(100),
  tone_alignment: z.number().min(0).max(100),
  media_compatibility: z.number().min(0).max(100),
  executability: z.number().min(0).max(100),
  freshness: z.number().min(0).max(100),
});

const SuggestedAngleSchema = z.object({
  angle: z.string(),
  description: z.string(),
  primary_media: z.string(),
  estimated_effort: z.enum(["low", "medium", "high"]),
});

const RiskSchema = z.object({
  type: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});

const MatchSchema = z.object({
  trend_id: z.string(),
  trend_name: z.string(),
  match_score: z.number().min(0).max(100),
  score_breakdown: ScoreBreakdownSchema,
  rationale: z.string(),
  suggested_angles: z.array(SuggestedAngleSchema),
  risks: z.array(RiskSchema),
  confidence: z.enum(["low", "medium", "high"]),
  priority: z.number().int().positive(),
});

const SummarySchema = z.object({
  primary_recommendation: z.string(),
  secondary_consideration: z.string(),
  overall_confidence: z.enum(["low", "medium", "high"]),
  next_steps: z.array(z.string()),
});

const DataSchema = z.object({
  brand_ref: z.string(),
  project_type: z.enum(["product_promotion", "brand_awareness"]),
  matches: z.array(MatchSchema),
  summary: SummarySchema,
});

export const MatchResultSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  status: z.enum(["success", "error"]),
  data: DataSchema,
});
