# 데이터 계약 (Data Contracts)

각 에이전트가 주고받는 데이터의 형식 정의. **모든 통신은 JSON 파일 기반**.

## 파일 목록

| 파일 | 누가 만듦 | 누가 읽음 | 설명 |
|---|---|---|---|
| `brand-analysis.example.json` | 마케터 입력 | 매칭가 | 브랜드 프로필 (brand_name·target·tone_and_manner) |
| `trend-analysis.example.json` | 트렌드 분석가 | 매칭가 | 트렌드 데이터 배열 (가변 개수) |
| `match-result.example.json` | 매칭가 | 작성가 | 트렌드별 4비교 평가 + 최종 verdict |

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

## 상태: v0.2 (MVP)

매칭가 v0.2 스펙(2질문 × 2비교) 기준으로 단순화한 입력 형식.

- 브랜드 입력은 마케터가 직접 입력하는 최소 필드(brand_name·target·tone_and_manner)만 유지
- 트렌드 metrics는 평문 텍스트 (연령 비중·성별 비중·검색량·조회수 자연어 포함)
- 카테고리·lifecycle 필드 등 부가 정보는 후속 단계에서 추가 검토
