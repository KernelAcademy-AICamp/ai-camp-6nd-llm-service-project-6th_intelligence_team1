# writer-output.json v2 합의 메모 (draft)

> output-text · output-design 합의용 문서. 확정되면 `shared/schemas/README.md`와 `shared/schemas/writer-output.example.json` 갱신.

## 배경

현재 `writer-output.example.json` schema는 **마케팅 캠페인 카피** (concept/headline/body_copy/key_message) 중심으로 정의돼 있음. 하지만:

1. 우리 팀은 **캠페인 에셋 텍스트 카피를 사용하지 않음** — 현재 mockup HTML 어디에도 이 필드들이 표시되지 않음
2. mockup은 **리포트 화면** (트렌드 분석 결과 + 매칭 결과 시각화)이 핵심 산출물
3. 현재 v1 `write.js`의 `generateWriterOutput()`이 카피 필드를 채우긴 하지만, LLM 없이 단순 데이터 재배치라 의미 없는 placeholder
4. mockup은 v1 산출물을 사용하지 않고 하드코딩 상태

→ **`writer-output.json`을 리포트 mockup 전용 단일 데이터 소스로 재정의** (옵션 C).

## 결정 사항

- ✅ `writer-output.json`의 카피 필드 (`concept`, `headline`, `body_copy`, `key_message`, `mood`, `format_hint`) 모두 **제거**
- ✅ mockup이 필요로 하는 리포트 메타데이터 필드 **추가**
- ✅ output-text v2 `write.js`가 `brand-analysis.json` + `trend-analysis.json` + `match-result.json` 3개를 입력 받아 단일 `writer-output.json` 출력
- ✅ mockup은 이 한 JSON만 읽어 모든 화면 렌더링

## 새 schema (제안)

```jsonc
{
  "schema_version": "0.2",
  "generated_at": "ISO-8601",
  "status": "success",
  "data": {
    "source": "작성가",

    "brand": {
      "name": "힌스 (hince)",
      "product_name": "커버 마스터 핑크 쿠션",
      "category": "메이크업 > 베이스",
      "target_display": "20대 여성 · Z세대·트렌디"
    },

    "contents": [
      {
        // ─ 식별 + 순위 ─
        "content_id": "C001",
        "trend_name": "매트 쿠션의 부상",
        "rank": 1,
        "verdict": "1순위",
        "display_variant": "primary",

        // ─ 키워드 (PART II 칩) ─
        "keywords": ["매트 쿠션", "세미매트", "결 살아있는", "라네즈 네오 쿠션", "자연 매트"],

        // ─ 메트릭 (PART II metric-strip + 정량분석 G2/G3) ─
        "headline_metric": {
          "metric": "검색량 지수",
          "value": "47.4",
          "delta": "+22%"
        },
        "metrics": {
          "score": 92,
          "growth_rate": 22,
          "period": "26.01-05"
        },

        // ─ 본문 bullet 텍스트 ─
        "summary_bullets": [
          "글래스 스킨이나 과도한 광택보다 자연스럽고 얇은 레이어의 매트한 피부 표현이 2026년 핵심 트렌드로 떠올랐다.",
          "매트 쿠션 검색 관심도가 2026년 1월 38.9에서 5월 47.4로 22% 상승했다.",
          "20대 여성층을 중심으로 '너무 매끈한' 베이스보다 '피부 결이 살아있는' 매트 마무리를 선호하는 경향이 확대되고 있다."
        ],
        "reason_bullets": [
          "브랜드 제형 '매트'와 트렌드 키워드 '매트쿠션' 직결로 제품-트렌드 일치도 높음",
          "Z세대·트렌디 톤의 '피부 결이 살아있는' 자연스러운 표현이 브랜드 정체성과 완벽 부합",
          "20대 여성의 자기표현 동기와 '새로운 기준' 트렌드 수용 성향 일치"
        ],

        // ─ 수집 근거 (PART II) ─
        "evidence": [
          {
            "source": "naver_datalab",
            "label": "Naver Datalab",
            "description": "검색량 지수 (2026-01 ~ 2026-05) → 매트쿠션 47.4 (5월), 커버쿠션·세미매트쿠션 함께 트렌드",
            "url": "https://datalab.naver.com/..."
          },
          {
            "source": "instagram",
            "label": "Instagram",
            "description": "관련 콘텐츠 (최근 30일) → 라네즈 네오 쿠션 더 매트, 어바웃톤 디자인 멀티 팔레트 등 신상품 언급 다수",
            "url": null
          },
          {
            "source": "tavily",
            "label": "Tavily",
            "description": "업계 분석 (2026년) → 2026 뷰티 트렌드 보고서에서 '매트와 글로의 대비'를 메이크업의 새로운 균형으로 명시",
            "url": "https://tavily.com/..."
          }
        ],

        // ─ 채널 현황 (정량분석) ─
        "channels": [
          { "name": "Instagram", "status": "active" },
          { "name": "TikTok", "status": "rising" },
          { "name": "Naver 블로그", "status": "stable" }
        ],

        // ─ 매칭 결과 (정량분석 G5) ─
        "match_passes": {
          "q1": 2,
          "q2": 2,
          "total": 4
        },
        "match_strength": "strong"
      }
    ]
  }
}
```

## 필드별 입력 → 출력 매핑

| 출력 필드 | 입력 출처 | 변환 |
|---------|---------|------|
| `brand.name` | `brand-analysis.brand_name` | 그대로 |
| `brand.product_name` | `brand-analysis.product_name` | 그대로 |
| `brand.category` | `brand-analysis.category` | 그대로 |
| `brand.target_display` | `brand-analysis.target` | "20대 여성 · Z세대·트렌디" 형태로 합성 |
| `content_id` | (자동 발급) | `"C001"`, `"C002"`, `"C003"` (sequential) |
| `trend_name` | `match-result.recommendations[].trend_name` | 그대로 |
| `rank` | `match-result.recommendations[].rank` | 그대로 (1/2/3) |
| `verdict` | `match-result.evaluations[].verdict` | trend_name으로 join 후 그대로 |
| `display_variant` | `rank` 기반 derive | rank===3 → `supplementary`, 그 외 `primary` |
| `keywords` | `trend-analysis.trends[].keywords` | trend_name으로 join, 상위 5개 슬라이스 |
| `headline_metric` | `trend-analysis.trends[].headline_metric` | 그대로 |
| `metrics` | `trend-analysis.trends[].metrics` | 그대로 |
| `summary_bullets` | `trend-analysis.trends[].summary` + `meaning` + `status` | 합쳐서 bullet array로 가공 (작성가 LLM or 룰베이스) |
| `reason_bullets` | `match-result.recommendations[].summary_reasons[].fact` | array 그대로, fact 텍스트만 추출 |
| `evidence` | `trend-analysis.trends[].evidence[]` | source enum 매핑 + label 합성 + url 살림 |
| `channels` | `trend-analysis.trends[].media_channel_status[]` | name + status enum 매핑 |
| `match_passes.q1` | `match-result.evaluations[].evaluation.question_1.passes` | 그대로 (0/1/2) |
| `match_passes.q2` | `match-result.evaluations[].evaluation.question_2.passes` | 그대로 (0/1/2) |
| `match_passes.total` | `q1 + q2` | 계산 |
| `match_strength` | `match_passes.total` 기반 derive | 4 → `strong`, 3 → `partial`, ≤2 → `weak` |

## Enum 값 정의

```ts
source:         "naver_datalab" | "tavily" | "instagram" | "youtube"
channel.status: "active" | "rising" | "stable" | "decline"
verdict:        "1순위" | "2순위" | "3순위" | "제외"
display_variant:"primary" | "supplementary"
match_strength: "strong" | "partial" | "weak"
rank:           1 | 2 | 3
passes:         0 | 1 | 2
```

## 가변·옵셔널 처리

- `contents[]` 길이: **0~3개 가변**. 매칭가의 `recommendations` 길이에 의존. mockup은 있는 만큼만 렌더링.
- `headline_metric.delta`: optional (없으면 빈 문자열)
- `evidence[].url`: nullable (Naver/YouTube 출처는 현재 null, Tavily는 채워짐)
- `keywords`: 비어있을 수 있음 (분석가가 못 채운 경우)
- `summary_bullets`·`reason_bullets`: 1~5개 가변

## 작성가가 결정해야 할 미해결 항목

| # | 항목 | 결정 필요 |
|---|------|--------|
| 1 | `content_id` 형식 | `"C001"`/`"C002"`/`"C003"` (sequential) — OK? |
| 2 | `summary_bullets` 가공 방식 | LLM으로 자연스럽게 다듬기 vs trend-analysis의 summary/meaning/status를 그대로 슬라이스 |
| 3 | `keywords` 슬라이싱 | 작성가가 top-5 자르기 vs 분석가 출력 그대로 전달 후 디자인이 자르기 |
| 4 | `evidence[].description` 형식 | 어떻게 가공할지 (수동 템플릿 vs 라네즈 네오쿠션 같은 fact를 평문으로) |
| 5 | `match_strength` 분류 규칙 | total === 4 strong / 3 partial / ≤2 weak — OK? |
| 6 | `display_variant` 분류 규칙 | rank === 3 → supplementary — OK? 아니면 verdict 기반? |

## 다음 단계

### output-text 담당자 작업
1. v2 `write.js` 작성:
   - 기존 `generateWriterOutput()` 함수를 위 스키마로 재작성
   - 카피 필드 (concept/headline/body_copy/key_message/mood/format_hint) 제거
   - 메타데이터 필드 (keywords/evidence/channels/match_passes 등) 추가
   - `isDirectRun` 블록에서 `generateWriterOutput()` 호출해 `writer-output.json` 실제 파일 저장
2. `shared/schemas/writer-output.example.json` 갱신 (새 schema 예시)
3. `shared/schemas/README.md`에 작성가 출력 규약 섹션 추가
4. (선택) Zod 스키마 작성 (`src/writer/schemas.js`)

### output-design 담당자 작업
1. mockup HTML을 하드코딩 → `writer-output.json` 데이터 바인딩 코드로 변환
2. 데이터 변환 정책 (옵션 3 등) 입력 반영
3. enum → CSS 클래스 매핑 함수 작성 (source → chip class 등)

### 외부 의존성 (트렌드 분석가)
- `evidence[].url`을 Naver/YouTube에서도 합성하도록 모듈 보강 (현재 null)
- `media_channel_status[].status`를 영문 enum으로 (현재 한국어인지 확인 필요)

## 우선순위

1. **🔥 output-text와 위 schema 합의** (가장 먼저)
2. v2 `write.js` 구현
3. mockup 데이터 바인딩 작업
4. 트렌드 분석가에게 URL 합성·enum 통일 요청 (병렬)
