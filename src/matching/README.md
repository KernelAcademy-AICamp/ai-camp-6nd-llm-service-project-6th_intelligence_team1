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

### 입력 유효성 검사

LLM에 보내기 전, 4판정에 꼭 필요한 필드가 비어있지 않은지 확인. 하나라도 빈값이면 어느 필드가 어떤 평가를 못 하게 만드는지 한국어로 출력하고 즉시 종료(API 호출·결과 파일 모두 생략). **garbage-in으로 잘못된 1순위/2순위가 새어 나가는 사고를 막기 위함**.

| 영역 | 필수 (비어있으면 종료) |
|---|---|
| brand | `brand_name`, `tone_and_manner`, `target.gender`, `target.age_groups` 또는 `age_range`, `target.motivation` 또는 `involvement` |
| trend | `data.trends` 배열 비어있지 않음, 각 트렌드의 `trend_name`·`keywords`·`summary` |

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
