# 데이터 계약 (Data Contracts)

각 에이전트가 주고받는 데이터의 형식 정의. **모든 통신은 JSON 파일 기반**.

## 파일 목록

| 파일 | 누가 만듦 | 누가 읽음 | 설명 |
|---|---|---|---|
| `brand-analysis.example.json` | 브랜드 분석가 | 매칭가 | 브랜드 분석 결과 |
| `trend-analysis.example.json` | 트렌드 분석가 | 매칭가 | 트렌드 분석 결과 (배열, 보통 2개) |
| `match-result.example.json` | 매칭가 | 작성가 | 매칭 적합도 + 활용 방안 |

## 공통 규칙

- **인코딩**: UTF-8 (Python: `json.dump(..., ensure_ascii=False, indent=2)`)
- **언어**: 한국어 (영문 식별자는 snake_case)
- **저장 경로**: `shared/data/` (실제 파일은 gitignore, 예시만 schemas/에)
- **상태 처리**: 실패 시에도 JSON으로 (`status: "error"` + `error_message`)

## 공통 envelope

모든 파일은 다음 메타데이터를 포함:

```json
{
  "schema_version": "0.1",
  "generated_at": "ISO-8601 timestamp",
  "status": "success" | "error",
  "data": { ... },                  
  "error_message": "..."           
}
```

## 상태: 초안 (v0.1)

매칭가 관점에서 작성된 초안. **다음 단계: 분석가들과 합의 후 v1.0 확정.**

협의 포인트:
- 필드명 (예: `audience` vs `target_audience`)
- 필수 vs 선택 필드 구분
- 어디까지 분석가가 채우고, 어디부터 매칭가가 추론하는지
- 트렌드 개수 (항상 2개? 가변?)
