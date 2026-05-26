# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

뷰티 브랜드 마케팅을 위한 **멀티 에이전트 LLM 파이프라인**. 현재 구현된 에이전트는 **매칭가(matching agent)** 하나이며, 향후 추가될 에이전트들과 JSON 파일 기반으로 데이터를 주고받도록 설계됨.

```
[마케터 입력]      →  brand-analysis.json   ┐
[정보수집가/트렌드 분석가] → trend-analysis.json   ┴→  [매칭가]  → match-result.json → [작성가]
```

- **현재**: 매칭가 v0.2만 구현 (`src/matching/`)
- **mock 단계**: 마케터·분석가·작성가는 미구현. 매칭가는 `shared/schemas/*.example.json` 더미를 입력으로 사용
- **다른 사람 브랜치**: `trend1`, `trend2` 등에서 분석가 에이전트들이 별도 개발 중일 수 있음 — 그쪽 브랜치는 절대 자동 푸시 금지

## 명령어

```bash
npm run match           # 매칭가 실행 (src/matching/match.js)
npm run hello           # Anthropic SDK 학습 예제 - 단일 호출
npm run chat            # Anthropic SDK 학습 예제 - REPL
```

`.env`에 `ANTHROPIC_API_KEY` 필요. 별도 빌드·테스트·린트 도구 없음 (MVP 단계, ES modules 직접 실행).

## 아키텍처

### 에이전트 간 데이터 계약 (`shared/schemas/`)

모든 에이전트 간 통신은 JSON 파일로 이루어지며, **공통 envelope** 구조를 따름:

```json
{
  "schema_version": "0.2",
  "generated_at": "ISO-8601",
  "status": "success" | "error",
  "data": { ... },
  "error_message": "..."
}
```

- 입력 예시는 `shared/schemas/*.example.json` (git 추적됨)
- 실제 산출물은 `shared/data/` (gitignore됨)
- 인코딩 UTF-8, 식별자는 영문 snake_case, 자연어 응답은 한국어

### 매칭가 평가 로직 (v0.2)

`src/matching/prompts/system.md`가 두뇌. 핵심 구조:

- **2질문 × 2비교 = 4판정** (✅/⚠️/❌)
  - q1(브랜드 적합성): 1-A(톤앤매너↔트렌드 요약), 1-B(톤앤매너↔키워드)
  - q2(타겟 적합성): 2-A(타겟↔수치 metrics 합산 ≥60%), 2-B(타겟↔라이프스타일·니즈 페르소나)
- **조합 매핑 매트릭스**로 질문별 `passes` 산정:
  - ✅+✅ → 2, ✅+⚠️ 또는 ⚠️+⚠️ → 1, **❌가 하나라도 있으면 즉시 0**
- 최종 `verdict`: q1·q2 중 하나라도 0이면 "제외", 합산에 따라 1순위/2순위/3순위
- 톤앤매너 친화/충돌 키워드 테이블 7종이 시스템 프롬프트에 포함됨 (클린뷰티/로맨틱·감성/럭셔리·프리미엄/키치·플레이풀/더마·과학적/Z세대·트렌디/비건)

평가 규칙을 바꿀 때는 `system.md`·`schemas.js`·`match-result.example.json` 세 파일이 일관성을 유지해야 함.

### Claude API 사용 패턴 (`src/matching/match.js`)

매칭가 호출의 핵심 패턴 — 새 에이전트 추가 시 동일하게 사용:

- **`messages.parse` + Zod 스키마**로 structured output 강제 (`schemas.js`의 `MatchResultSchema`)
- **프롬프트 캐싱**: 시스템 블록 끝에 `cache_control: { type: "ephemeral" }` — 시스템 프롬프트와 출력 예시 JSON이 캐시 대상. 사용자 메시지(입력 데이터)만 매 호출 변동
- 모델은 `claude-haiku-4-5` (MVP 단계 비용 효율). 본격 단계엔 Sonnet 4.6 검토
- 응답 후 `usage` 객체로 캐시 통계·비용 추정 로깅

### 의존성

- `@anthropic-ai/sdk` — Anthropic SDK (Node)
- `zod` — Structured output 검증
- `dotenv` — `.env`에서 `ANTHROPIC_API_KEY` 로드

## CI

`.github/workflows/secret-check.yml`이 모든 push·PR에서 실행:
1. `.env`가 `.gitignore`에 포함됐는지 확인
2. `.env` 계열 파일이 git에 추적되고 있지 않은지 확인
3. 추적 파일에 시크릿 패턴(`sk-`, `sk-ant-`, `ghp_`, AWS 키 등) 미노출 확인

→ 시크릿이 코드에 들어가면 CI가 막아줌. 위반 시 키 로테이션 후 제거.

## 컨벤션

- **자연어**: 한국어 (시스템 프롬프트, README, 커밋 메시지 본문 모두)
- **식별자**: snake_case 영문 (JSON 키, 변수 이름)
- **커밋 메시지**: `feat(scope):`, `fix:`, `chore:`, `docs:`, `refactor:` 접두사(영문) + 한국어 본문
- **JSON 출력**: 한글 보존(`ensure_ascii=false` 등가), indent=2
