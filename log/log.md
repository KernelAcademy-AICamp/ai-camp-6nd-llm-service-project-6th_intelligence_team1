## 2026-06-29 — 시안가 v2: 톤앤매너 무드 앵커 강화

**문제**: 시안이 trend_name과 무관하게 나옴. 트렌드 단어는 핀터레스트 무드 앵커로 약하고, 톤앤매너 어휘(예: derma cosmetic aesthetic)가 무드 앵커로 강함.

**누수 2지점 진단**:
1. 쿼리 생성(search) — 톤앤매너가 입력엔 있으나 활용 규칙 0줄, concept만 무드 핵심으로 강조 → LLM이 톤앤매너 무시.
2. 선별(analyze) — best_index 기준이 "광고 우수성 + 구도(Pinterest 강점)"라 무드 안 맞아도 구도 좋으면 뽑힘.

**수정 (3파일)**:
- `search.js` — TONE_ANCHOR 매핑(7종→영문 무드 동의어 세트) + userMessage에 앵커 블록 주입. 매핑 없으면 빈 블록(기존 동작 유지).
- `prompts/search.md` — "톤앤매너 무드 앵커(최우선)" 섹션 추가: 쿼리 3개 맨 앞 앵커 고정, 동의어 회전(동질화 방지), 변주축 분담. concept "핵심" → 변주로 톤다운.
- `prompts/analyze.md` — best_index 선별 1순위를 톤앤매너 무드 적합으로 격상(구도는 2순위).

**비율 설계**: 톤앤매너=1단어 앵커(무드 통일), shot_direction+composition=R1/R2/R3 차별, trend=변주. → "무드 통일 + 구성 다양".

**검증**: node --check 통과, 매핑 로직 확인. 실제 쿼리 풀런 검증은 미실행(API 비용, 오주님 승인 대기).
