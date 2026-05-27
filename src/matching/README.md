# 매칭가 (Matching Agent) v0.2

마케터가 입력한 브랜드 프로필과 정보수집가가 제공한 트렌드 데이터를 교차 비교하여, **2질문 × 2비교 = 총 4개 판정(✅/⚠️/❌)** 으로 트렌드별 적합도를 평가하고 최종 등급(1순위/2순위/3순위/제외)을 산출.

## 구조

```
src/matching/
├── README.md
├── match.js            ← 실행 진입점
├── schemas.js          ← Zod 출력 스키마
└── prompts/
    └── system.md       ← 매칭가 시스템 프롬프트 + 톤앤매너 친화/충돌 테이블
```

## 입출력

| 종류 | 출처 | 실제 파일 | 형식 예시 |
|---|---|---|---|
| 입력 1 | 브랜드 분석가 | `shared/data/brand-analysis.json` | `shared/schemas/brand-analysis.example.json` |
| 입력 2 | 트렌드 분석가 | `shared/data/trend-analysis.json` | `shared/schemas/trend-analysis.example.json` |
| 출력 | 작성가에게 전달 | `shared/data/match-result.json` | `shared/schemas/match-result.example.json` |

`shared/data/`는 `.gitignore` 대상. 분석가들이 각자 산출한 실제 JSON을 거기 둠. 파일이 없으면 매칭가는 친절한 안내와 함께 종료한다. 더미로 빠르게 시험하려면 example을 `shared/data/`로 복사:

```bash
cp shared/schemas/brand-analysis.example.json shared/data/brand-analysis.json
cp shared/schemas/trend-analysis.example.json shared/data/trend-analysis.json
```

### 입력 유효성 검사 (Zod)

LLM에 보내기 전, 분석가 산출이 약속된 형식인지 [schemas.js](schemas.js)의 `InputBrandSchema`/`InputTrendSchema`로 검증. 위반 시 어떤 경로의 어떤 규칙이 깨졌는지 한국어로 출력하고 즉시 종료(API 호출·결과 파일 모두 생략). **garbage-in으로 잘못된 1순위/2순위가 새어 나가는 사고를 막기 위함**.

| 영역 | 검증 항목 |
|---|---|
| brand | `brand_name` 비어있지 않음, `tone_and_manner`는 7종 enum(클린뷰티·로맨틱·감성·럭셔리·프리미엄·키치·플레이풀·더마·과학적·Z세대·트렌디·비건) 중 1개 이상, `target.gender ∈ {여성, 남성, 공용}`, `target.age_groups`(정규식 `\d+대`) 또는 `target.age_range`(정규식 `\d+(-\d+)?`) 중 하나, `target.motivation` 또는 `target.involvement` 중 하나 |
| trend | `data.trends` 배열 1개 이상, 각 트렌드 `trend_name`·`summary` 필수, `keywords` 또는 `core_keywords` 중 하나 |

검증되는 오류 유형:
- **누락**: 비어있는 문자열, 빈 배열, `null`/`undefined`
- **형식**: 배열이어야 하는데 문자열, 객체여야 하는데 배열 등 타입 오류
- **enum**: gender가 "고양이", tone이 "사이버펑크" 등 정의 외 값
- **정규식**: age_groups가 "삼십대" (`\d+대` 불일치) 등

> 시맨틱 부적합(예: 자동차 브랜드 × 뷰티 트렌드)은 코드 단계가 아니라 LLM이 평가 과정에서 "제외" verdict로 처리. 코드는 형식·필수·enum까지 책임짐.

## 평가 로직 (2질문 × 2비교)

### 질문 1: 브랜드 적합성 — "우리 브랜드가 이 트렌드를 말할 때 자연스러운가?"
- **1-A**: `tone_and_manner` ↔ 트렌드 `summary` (톤앤매너 친화/충돌 테이블 기준)
- **1-B**: `tone_and_manner` ↔ 트렌드 `keywords` (키워드별 친화/충돌 비율)

### 질문 2: 타겟 적합성 — "우리 고객이 이 트렌드에 끌릴 것 같은가?"
- **2-A**: `target` ↔ 트렌드 `metrics` (브랜드 타겟 연령·성별 비중 합산 ≥ 60% 여부)
- **2-B**: `target` ↔ 트렌드 `summary` (행동·라이프스타일·니즈 페르소나 겹침 개수)

### 점수 환산
- 각 비교: ✅=1점 / ⚠️=0.5점 / ❌=0점
- 질문별 합산(0~2점) → `passes` 등급 0/1/2

### 최종 verdict 매트릭스
| q1.passes | q2.passes | verdict |
|---|---|---|
| 0 또는 0 | * 또는 0 | 제외 |
| 2 | 2 | 1순위 |
| 2/1 | 1/2 | 2순위 |
| 1 | 1 | 3순위 |

자세한 기준·테이블·체크리스트는 [prompts/system.md](prompts/system.md) 참고.

## 실행

```bash
node src/matching/match.js
```

결과는 `shared/data/match-result.json`에 저장.

## 사용 모델

- **현재**: `claude-haiku-4-5` (학습/실험 단계, 비용 효율)
- **본격 단계 시 검토**: `claude-sonnet-4-6` (추론 품질 향상)
