// 에이전트 간 통신 공통 envelope.
// 모든 에이전트(브랜드 분석가·트렌드 분석가·매칭가·작성가)는
// 산출 JSON을 wrap()/wrapError()로 감싸 동일한 구조를 보장한다.
//
// envelope 구조:
//   {
//     schema_version: "0.2",
//     generated_at:   ISO-8601 timestamp,
//     status:         "success" | "error",
//     data:           { ... },          // success일 때만
//     error_message:  "..."             // error일 때만
//   }
//
// 자세한 규칙은 shared/schemas/README.md 참고.

import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = "0.2";

export function wrap(data, { schemaVersion = CURRENT_SCHEMA_VERSION } = {}) {
  return {
    schema_version: schemaVersion,
    generated_at: new Date().toISOString(),
    status: "success",
    data,
  };
}

export function wrapError(message, { schemaVersion = CURRENT_SCHEMA_VERSION } = {}) {
  return {
    schema_version: schemaVersion,
    generated_at: new Date().toISOString(),
    status: "error",
    error_message: message,
  };
}

// 입력 검증용 Zod 빌더. 각 에이전트의 data 스키마를 감싸 envelope 전체를 검증.
//   const BrandAnalysisSchema = envelopeSchema(BrandDataSchema);
export function envelopeSchema(dataSchema) {
  return z.object({
    schema_version: z.string(),
    generated_at: z.string(),
    status: z.enum(["success", "error"]),
    data: dataSchema.optional(),
    error_message: z.string().optional(),
  });
}
