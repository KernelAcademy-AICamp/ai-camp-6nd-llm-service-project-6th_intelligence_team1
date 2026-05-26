# 데이터 계약 (Data Contracts)

각 에이전트가 주고받는 데이터의 형식 정의. **모든 통신은 JSON 파일 기반**.

## 파일 목록

| 파일 | 누가 만듦 | 누가 읽음 | 설명 |
|---|---|---|---|
| `brand-analysis.example.json` | 마케터 입력 / 브랜드 분석가 | 매칭가 | 브랜드 프로필 (brand_name·target·tone_and_manner) |
| `trend-analysis.example.json` | 트렌드 분석가 | 매칭가 | 트렌드 데이터 배열 (가변 개수) |
| `match-result.example.json` | 매칭가 | 작성가 | 트렌드별 4비교 평가 + 최종 verdict |

## 공통 규칙

- **인코딩**: UTF-8
- **언어**: 한국어 (영문 식별자는 snake_case)
- **저장 경로**: `shared/data/` (실제 파일은 gitignore, 예시만 schemas/에)
- **상태 처리**: 실패 시에도 JSON으로 (`status: "error"` + `error_message`)

## 공통 envelope (전 에이전트 필수)

모든 에이전트의 산출 JSON은 다음 envelope으로 감싸야 함:

```json
{
  "schema_version": "0.2",
  "generated_at": "ISO-8601 timestamp",
  "status": "success" | "error",
  "data": { ... },
  "error_message": "..."
}
```

| 필드 | 필수 여부 | 비고 |
|---|---|---|
| `schema_version` | 필수 | 현재 `"0.2"` (string) |
| `generated_at` | 필수 | `new Date().toISOString()` 결과 |
| `status` | 필수 | `"success"` 또는 `"error"` |
| `data` | `status="success"`일 때 필수 | 에이전트별 본체 |
| `error_message` | `status="error"`일 때 필수 | 사람이 읽을 수 있는 에러 설명 |

### 사용법: `shared/envelope.js` 헬퍼 모듈

JS/Node 에이전트는 [`shared/envelope.js`](../envelope.js)를 import해서 사용. 직접 envelope을 손으로 작성하지 말 것 — `generated_at` 타임스탬프 누락이나 형식 차이로 다른 에이전트가 파싱 실패할 수 있음.

```js
import { wrap, wrapError, envelopeSchema } from "../shared/envelope.js";
import { z } from "zod";

// 출력 시: data 본체만 만들고 wrap()
const brandProfile = { brand_name: "...", target: {...}, tone_and_manner: [...] };
const output = wrap(brandProfile);
// → { schema_version, generated_at, status: "success", data: brandProfile }

// 실패 시
const errOutput = wrapError("브랜드 분석 실패: ...");

// 입력 검증 시: 자기 data 스키마를 envelopeSchema로 감싸 Zod 검증
const BrandDataSchema = z.object({ brand_name: z.string(), ... });
const BrandSchema = envelopeSchema(BrandDataSchema);
const parsed = BrandSchema.parse(JSON.parse(file));
```

Python 등 다른 언어 에이전트는 동일 구조를 직접 구현하되, `generated_at`은 ISO-8601 UTC(`datetime.now(timezone.utc).isoformat()`).

## 상태: v0.2 (MVP)

매칭가 v0.2 스펙(2질문 × 2비교) 기준으로 단순화한 입력 형식.

- 브랜드 입력은 마케터가 직접 입력하는 최소 필드(brand_name·target·tone_and_manner)만 유지
- 트렌드 metrics는 평문 텍스트 (연령 비중·성별 비중·검색량·조회수 자연어 포함)
- 카테고리·lifecycle 필드 등 부가 정보는 후속 단계에서 추가 검토
