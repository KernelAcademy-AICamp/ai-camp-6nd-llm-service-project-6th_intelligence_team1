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

## 매칭가 규약

### 입력 요구사항 (분석가가 매칭가에게 줄 것)

매칭가의 4비교(1-A, 1-B, 2-A, 2-B)가 동작하려면 다음 필드가 필수.

**브랜드 분석가가 줄 brand-analysis.json**

| 필드 | 형식 | 비고 |
|---|---|---|
| `data.brand_name` | string | 표시용 |
| `data.target.gender` | `"여성"` / `"남성"` / `"여성·남성"` | 2-A 성별 오버랩 계산 |
| `data.target.age_range` 또는 `target.age_groups` | `"20-30"` 문자열 또는 `["20대","30대"]` 배열 | 둘 중 하나, 매칭가가 흡수 |
| `data.tone_and_manner` | 배열, 7종 enum 중 선택 | 1-A·1-B 친화/충돌 판정. `클린뷰티`/`로맨틱·감성`/`럭셔리·프리미엄`/`키치·플레이풀`/`더마·과학적`/`Z세대·트렌디`/`비건` |

부가 필드(`category`, `match_keywords` 등)는 자유 — 매칭가는 패스스루.

**트렌드 분석가가 줄 trend-analysis.json**

| 필드 | 형식 | 비고 |
|---|---|---|
| `data.trends[].trend_name` | string | |
| `data.trends[].summary` | string (~50자) | 1-A 무드 판정 |
| `data.trends[].keywords` 또는 `core_keywords` | 배열 | 1-B 키워드 매칭 |
| `data.trends[].audience_distribution` 또는 평문 `metrics` | 연령·성별 비중 | **2-A 필수**. 객체면 `age_ratio["20s"]: 0.39` / `gender_ratio.female: 0.87` 영문 비율, 평문이면 "20대 39%, 여성 87%" |
| `data.trends[].channel_status` 또는 `media_channel_status` | 문자열 또는 배열 | 2-B 페르소나 보강용 |

부가 필드(`meaning`, `status`, `evidence`, `headline_metric` 등)는 자유 — 매칭가가 reason 보강에 참고.

### 출력 규약 (매칭가가 작성가에게 줄 것)

**match-result.json**

envelope `data` 안에:

| 필드 | 형식 | 비고 |
|---|---|---|
| `brand_name` | string | 평가 대상 브랜드 |
| `recommendations[]` | 배열 (최대 3개) | **브랜드와 맞는 상위 3개 추천.** 제외 트렌드는 빠짐. `{ rank, trend_name, summary_reasons }` — verdict 등급은 노출하지 않음(rank·근거만) |
| `evaluations[]` | 배열 (입력 트렌드 수만큼) | 각 트렌드 평가 전체 (verdict 등급 포함, 추천순 → 제외순 정렬) |

**선별·랭킹** (코드가 수행): 입력 트렌드 전체를 평가한 뒤 — ① 제외(verdict="제외")를 뺀 후 ② verdict 순위(1순위>2순위>3순위) → passes 합 → 트렌드 `metrics.score` 순으로 정렬해 ③ 상위 3개를 `recommendations`로 추림. 맞는 트렌드가 3개 미만이면 있는 만큼만.

각 evaluation 항목:

| 필드 | 형식 | 비고 |
|---|---|---|
| `trend_name` | string | |
| `evaluation.question_1` | `{label, comparisons{1-A, 1-B}, passes}` | 브랜드 적합성 |
| `evaluation.question_2` | `{label, comparisons{2-A, 2-B}, passes}` | 타겟 적합성 |
| `comparisons.X-Y` | `{result: "✅"|"⚠️"|"❌", reason: string}` | 각 비교 판정 + 근거 |
| `passes` | `0` / `1` / `2` | 질문별 패스 등급 (조합 매핑 결과) |
| `verdict` | `"1순위"` / `"2순위"` / `"3순위"` / `"제외"` | 최종 등급 |
| `summary_reasons` | string[] (1-3개) | 핵심 근거 요약 |

전체 구조 예시는 [`match-result.example.json`](match-result.example.json).
Zod 스키마(코드 진실 공급원)는 [`src/matching/schemas.js`](../../src/matching/schemas.js)의 `MatchDataSchema`.

평가 로직(4비교 기준, passes 산정, verdict 매트릭스)은 [`src/matching/README.md`](../../src/matching/README.md) 참고.

## 상태: v0.2 (MVP)

매칭가 v0.2 스펙(2질문 × 2비교) 기준으로 단순화한 입력 형식.

- 브랜드 입력은 마케터가 직접 입력하는 최소 필드(brand_name·target·tone_and_manner)만 유지
- 트렌드 metrics는 평문 텍스트 (연령 비중·성별 비중·검색량·조회수 자연어 포함)
- 카테고리·lifecycle 필드 등 부가 정보는 후속 단계에서 추가 검토
