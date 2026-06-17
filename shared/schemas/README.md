# 데이터 계약 (Data Contracts)

각 에이전트가 주고받는 데이터의 형식 정의. **모든 통신은 JSON 파일 기반**.

## 파일 목록

| 파일 | 누가 만듦 | 누가 읽음 | 설명 |
|---|---|---|---|
| `brand-analysis.example.json` | 마케터 입력 / 브랜드 분석가 | 매칭가 | 브랜드 프로필 (brand_name·target·tone_and_manner) |
| `trend-analysis.example.json` | 트렌드 분석가 | 매칭가 | 트렌드 데이터 배열 (가변 개수) |
| `match-result.example.json` | 매칭가 | 작성가 | 트렌드별 4비교 평가 + 최종 verdict |
| `writer-output.example.json` | 작성가 | 디자이너 (리포트 렌더러) | 리포트 mockup 단일 데이터 소스 (3개 입력 JSON 통합 + 가공) |

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

**브랜드 분석가가 줄 brand-analysis.json** (v1.2)

| 필드 | 형식 | 비고 |
|---|---|---|
| `data.brand_name` | string | 표시용 |
| `data.category` | `"대분류 > 소분류"` (예: `"메이크업 > 립"`) | **카테고리 게이트 필수.** 트렌드와 대분류 일치 + 소분류 포함 관계일 때만 평가 진행 |
| `data.target.gender` | `"여성"` / `"남성"` / `"여성·남성"` | 2-A 성별 오버랩 계산 |
| `data.target.age_range` 또는 `target.age_groups` | `"20-30"` 문자열 또는 `["20대","30대"]` 배열 | 둘 중 하나, 매칭가가 흡수 |
| `data.tone_and_manner` | 배열, 7종 enum 중 선택 | 1-A·1-B 친화/충돌 판정. `클린뷰티`/`로맨틱·감성`/`럭셔리·프리미엄`/`키치·플레이풀`/`더마·과학적`/`Z세대·트렌디`/`비건` |
| `data.product_features` | 배열 | Ingred-Fit 핵심 입력. 룰베이스로 합성 (texture·category 소분류·tone phrase 조합) |
| `data.search_keywords` | 배열 (자연 문장형, 5~6개) | Tavily 웹 기사 검색용 |
| `data.short_keywords` | 배열 (짧은 명사, 4~6개) | YouTube 영상 검색용 |
| `data.datalab_keywords` | `[{groupName, keywords}]` (2~3 그룹) | Naver DataLab 검색 지수용 (그룹 단위 OR 합산) |
| `data.hashtag_keywords` | 배열 (띄어쓰기 없는 한글 명사, 5~7개) | **Instagram·TikTok 해시태그 수집용**. 띄어쓰기 있으면 # 한 덩어리로 안 잡힘 |

부가 필드(`match_keywords` 등)는 자유 — 매칭가는 패스스루.

**버전 이력:**
- v1.0 → v1.1: `product_features` 추가 (룰베이스 합성, Ingred-Fit 입력)
- v1.1 → v1.2: `hashtag_keywords` 추가 (SNS 해시태그 수집용)

**트렌드 분석가가 줄 trend-analysis.json**

| 필드 | 형식 | 비고 |
|---|---|---|
| `data.trends[].trend_name` | string | |
| `data.trends[].category` | `"대분류 > 소분류"` (예: `"메이크업 > 아이&립"`) | **카테고리 게이트 필수.** 브랜드 소분류를 포함하면 통과 (대분류는 일치해야 함) |
| `data.trends[].summary` | string (~50자) | 1-A 무드 판정 |
| `data.trends[].keywords` 또는 `core_keywords` | 배열 | 1-B 키워드 매칭 |
| `data.trends[].audience_distribution` 또는 평문 `metrics` | 연령·성별 비중 | **2-A 필수**. 객체면 `age_ratio["20s"]: 0.39` / `gender_ratio.female: 0.87` 영문 비율, 평문이면 "20대 39%, 여성 87%" |
| `data.trends[].channel_status` 또는 `media_channel_status` | 문자열 또는 배열 | 2-B 페르소나 보강용 |

**판정 품질 향상용 (있으면 좋음, 없으면 해당 항목 ⚠️ 고정 처리)**

| 필드 | 형식 | 비고 |
|---|---|---|
| `data.trends[].trend_stage` | `"emerging"`/`"peak"`/`"declining"` | Safe-Fit 보조 라벨. **서술형 `status`와 별개 필드** (status는 현황 텍스트, trend_stage는 enum). 매칭가는 enum을 `trend_stage`에서 읽음 |
| `data.trends[].lifespan_estimate` | `"3개월 미만"`/`"3-6개월"`/`"6개월 이상"` | Safe-Fit 보조 (트렌드 지속성 추정) |
| `data.trends[].audience_signal` | string (페르소나 서술) | 2-B Life-Fit 보강 (행동·라이프스타일·니즈 묘사) |

부가 필드(`meaning`, `status`, `evidence`, `headline_metric` 등)는 자유 — 매칭가가 reason 보강에 참고. (`status`는 서술형 현황 텍스트이며, 라이프사이클 enum은 `trend_stage`를 사용.)

### 카테고리 게이트 (포함 관계)

매칭가는 브랜드·트렌드 `category`를 `"대분류 > 소분류"`로 보고 **포함 관계**로 비교한다:
- **대분류 일치** AND **브랜드 소분류가 트렌드 소분류 문자열에 포함** → 통과
- 예: 브랜드 `"메이크업 > 립"` → 트렌드 `"메이크업 > 아이&립"`·`"메이크업 > 립&컬러"` 통과 / `"메이크업 > 베이스"`·`"스킨케어 > 토너"` 제외
- 통과한 트렌드만 4비교 평가, 제외 트렌드는 LLM 호출 없이 verdict="제외"로 결과에 포함

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

### 출력 규약 (작성가가 디자이너에게 줄 것)

**writer-output.json**

작성가는 `brand-analysis.json` + `trend-analysis.json` + `match-result.json` 세 입력을 `trend_name` 기준으로 조인해서 **리포트 mockup이 필요한 모든 데이터를 단일 JSON으로 출력**한다. 디자이너 렌더러는 이 한 파일만 읽어 화면 전체를 그린다.

envelope `data` 안에:

| 필드 | 형식 | 비고 |
|---|---|---|
| `source` | string | 고정값 `"작성가"` |
| `brand` | `{ name, product_name, category, target_display }` | 브랜드 헤더용 (target_display는 "20대 여성 · Z세대·트렌디" 형태로 합성) |
| `contents[]` | 배열 (0~3개 가변) | 매칭가 `recommendations` 길이에 의존. **카피 필드 없음** — 리포트 렌더링용 메타데이터만 |

각 `contents[]` 항목:

| 필드 | 형식 | 출처 |
|---|---|---|
| `content_id` | string (`"C001"` 형식) | 작성가가 sequential 발급 |
| `trend_name` | string | `match-result.recommendations[].trend_name` |
| `rank` | 양의 정수 (1~N, 매칭가 결정) | `match-result.recommendations[].rank` |
| `verdict` | `"{rank}순위"` 형식 문자열 | recommendations에 들어온 트렌드는 모두 "{N}순위"로 표기 (제외 트렌드는 포함되지 않음) |
| `matching_grade` | `"상" \| "중" \| "하"` | `match-result.evaluations[].matching_grade` (trend_name 조인) |
| `display_variant` | `"primary" \| "supplementary"` | rank===3 → supplementary, 그 외 primary (옛 규칙, 매칭가 v0.3 이후 가변 추천에서는 재정의 필요) |
| `keywords` | string[] (보통 5개) | `trend-analysis.trends[].keywords` |
| `headline_metric` | `{ metric, value, delta }` | `trend-analysis.trends[].headline_metric` |
| `metrics` | `{ score, growth_rate, period }` | `trend-analysis.trends[].metrics` |
| `summary_bullets` | string[] (1~5개) | `trend-analysis.trends[].summary` + `meaning` + `status` 가공 |
| `reason_bullets` | string[] (1~3개) | `match-result.recommendations[].summary_reasons[].fact` |
| `evidence[]` | `{ source, label, description, url }` 배열 (가변 개수) | `trend-analysis.trends[].evidence[]` 변환. 길이 상한 없음 — 트렌드 분석가가 결정 |
| `channels[]` | `{ name, status }` 배열 | `trend-analysis.trends[].media_channel_status[]` |
| `match_passes` | `{ q1, q2, total }` | 매칭가 v0.3 4기준(ingred·visual·life·safe)을 옛 q1/q2 passes(0/1/2)로 압축 매핑 |
| `match_strength` | `"strong" \| "partial" \| "weak"` | `matching_grade` 기반 derive: 상→strong / 중→partial / 하→weak |
| `match_fits` | `{ ingred, visual, life, safe, score }` | 매칭가 4기준 결과를 그대로 노출 (각 fit은 `{result, reason}`, score는 0-8) |

**Enum 값**:

| 필드 | 값 |
|---|---|
| `evidence[].source` | `"naver_datalab" \| "naver_blog" \| "naver_news" \| "tavily" \| "youtube"` (확장 가능, 매핑 없는 source는 raw 그대로 통과) |
| `channels[].status` | `"active" \| "rising" \| "stable" \| "decline"` |
| `verdict` | `"{N}순위"` 형식 (N = rank) — 매칭가 v0.3에서 추천 상한 폐지 후 가변. "제외"는 recommendations에 포함되지 않음 |
| `matching_grade` | `"상" \| "중" \| "하"` |
| `display_variant` | `"primary" \| "supplementary"` |
| `match_strength` | `"strong" \| "partial" \| "weak"` |

> **source enum 정책**: `naver_datalab`(검색지수)·`naver_blog`(UGC)·`naver_news`(기사)는 출처 성격이 달라 별도 enum으로 유지. Instagram은 의도적으로 제외(브랜드 미사용 매체 — EXCLUDED_SOURCES).

**가변·옵셔널 처리**:
- `contents[]` 길이: 매칭가 추천 개수에 따라 가변(보통 3~8개). 매칭가 v0.3 commit `7f69cb4` 이후 추천 상한 제거 — 트렌드 분석가가 N개 트렌드 주면 제외 안 된 트렌드 전체가 추천에 들어감. 디자이너 UI는 가변 개수 레이아웃 지원 필요.
- `evidence[]` 길이: 트렌드 분석가의 evidence 개수가 그대로 통과됨. 보통 2~5개, 상한 없음. UI는 가변 개수 대응 필요.
- `evidence[].url`: nullable (DataLab·Tavily만 매핑 채워짐, 그 외 source는 null 가능)
- `evidence[].source`: 위 enum 목록에 없는 값도 들어올 수 있음 — UI는 알 수 없는 source에 대해 fallback 아이콘·라벨 처리 필요
- `headline_metric.delta`: optional (없으면 빈 문자열)

전체 구조 예시는 [`writer-output.example.json`](writer-output.example.json).

자세한 합의 배경·매핑 근거는 [`docs/writer-output-v2-spec.md`](../../docs/writer-output-v2-spec.md) 참고.

## 상태: v0.2 (MVP)

매칭가 v0.2 스펙(2질문 × 2비교) 기준으로 단순화한 입력 형식.

- 브랜드 입력은 마케터가 직접 입력하는 최소 필드(brand_name·target·tone_and_manner)만 유지
- 트렌드 metrics는 평문 텍스트 (연령 비중·성별 비중·검색량·조회수 자연어 포함)
- 라이프사이클(`trend_stage`)·지속성(`lifespan_estimate`)·페르소나 신호(`audience_signal`)는 판정 품질 향상용 선택 필드로 추가됨
