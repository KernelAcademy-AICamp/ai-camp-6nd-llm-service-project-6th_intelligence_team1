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

## 2026-06-29 (이어서) — R1 풀런 검증 중 발견한 품질 이슈 2건

가히/럭셔리·프리미엄 R1 풀런(MAX_CONTENTS=1)으로 톤앤매너 앵커 검증 중 발견·수정.

**이슈 1 — 손 등장 (prompt.js)**: R1은 flat lay 제품 정물인데 손모델이 등장. 원인은 negative 부메랑 — Gemini 2.5 Flash Image엔 진짜 negative 파라미터가 없어 "Avoid: hands..."의 hand 단어를 오히려 흡수해 손 생성. 손 negative(원 FIXED_NEGATIVE)는 R2 인물컷의 손 기형 방지용인데 손 없어야 할 R1에도 무차별 적용된 게 버그.
- 수정: negative를 HAND/PLACEMENT/GENERAL로 3분할. shot_direction==="product"면 손·신체 단어를 negative에서 빼고(노출이 손 유도) 본문을 긍정형("isolated product still life, sole subject, clean empty surface")으로 보강. model 구도만 손 기형 negative 유지.
- 검증: R1 재실행 → 손 사라짐.

**이슈 2 — 배경 패턴 (prompt.md)**: 레퍼런스 핀은 미니멀 단색인데 결과 배경에 기하학 링·나뭇잎 데코 생성. 원인은 analyze가 선별 1장(background="뉴트럴 그레이 단색")과 20장 종합(source_specific="기하학적 추상 이미지")을 함께 내보내고, prompt.md에 배경 충실/장식 금지 규칙이 없어 LLM이 source_specific 장식어를 "geometric abstract elements"로 직역.
- 수정: prompt.md 제품샷 규칙에 "background 분석값 충실, 단색·미니멀이면 기하 오브제·소품·패턴·잎 추가 금지, source_specific은 무드 톤 참고로만" 추가.
- 검증: R1 재실행 → geometric/abstract 어휘 0, 배경 단색.

## 2026-06-29 (이어서) — R1·R3 수렴 해결: R3을 라이프스타일 컷으로

R1·R3이 둘 다 shot_direction=product라 "흰 케이스 정면 단독 + 베이지 배경"으로 거의 동일. R3 extreme macro가 약하게 구현된 데다 제품이 고체 스틱이라 텍스처 매크로 소재도 빈약 → 차별 실패.

**수정 (design.js, prompt.js)**:
- design.js: SHOT_DIRECTION_BY_RANK[3] product→lifestyle, COMPOSITION_BY_RANK[3]을 "화장대·욕실 공간 + 창광 + 리추얼 맥락, 제품이 초점"으로. (search.md에 lifestyle shot_direction 이미 정의돼 쿼리는 자동 공간·리추얼 어휘로 전환.)
- prompt.js: lifestyle 분기 추가 — 손 negative는 빼되(인물·손 중심 아님) isolated/clean empty surface는 강제 안 함(공간 맥락 보존). product/model 이분법을 3분기로.

**검증**: 전체 재실행 → R3 쿼리 "vanity skincare ritual / bathroom aesthetic / morning glow routine"(앵커 유지), 이미지는 대리석 화장대·꽃·골드용기 라이프스타일. R1(빈 배경 정물)과 명확히 구분. 세 슬롯이 무드 통일 + 구성(정물/인물/공간) 차별 달성.
