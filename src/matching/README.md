# 매칭가 (Matching Agent)

분석가들이 만든 결과(브랜드 분석 + 트렌드 분석)를 받아, **브랜드와 트렌드의 매칭 적합도를 5축으로 평가하고 활용 방안을 제시**.

## 구조

```
src/matching/
├── README.md
└── prompts/
    └── system.md        ← 매칭가 시스템 프롬프트
```

## 입출력

| 종류 | 출처 | 형식 |
|---|---|---|
| 입력 1 | 브랜드 분석가 | `shared/schemas/brand-analysis.example.json` 형식 |
| 입력 2 | 트렌드 분석가 | `shared/schemas/trend-analysis.example.json` 형식 |
| 입력 3 | 프로젝트 정보 | `product_promotion` or `brand_awareness` |
| 출력 | 작성가에게 전달 | `shared/schemas/match-result.example.json` 형식 |

## 평가 5축

| 축 | 기본 가중치 |
|---|---|
| audience_fit (타겟 일치) | 25% |
| tone_alignment (톤 조화) | 25% |
| media_compatibility (매체 호환) | 20% |
| executability (실행 가능성) | 15% |
| freshness (시기 적절성) | 15% |

자세한 사고 흐름과 평가 기준은 [prompts/system.md](prompts/system.md) 참고.

## 사용 모델

- **현재**: `claude-haiku-4-5` (학습/실험 단계, 비용 효율)
- **본격 단계 시 검토**: `claude-sonnet-4-6` (추론 품질 향상)
