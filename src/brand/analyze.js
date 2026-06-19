import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { wrap } from "../../shared/envelope.js";
import { recordUsage } from "../shared/token-log.js";
import {
  ALL_CATEGORY_NOUNS,
  BrandInputSchema,
  BrandKeywordsLlmSchema,
  buildProductFeatures,
  expandAgeGroupForMatching,
  getSynonymsForCategoryNouns,
} from "./schemas.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 — 마케터 입력(JSON)을 받아 매칭가에 넘길 envelope을 만든다.
// 추가로 트렌드 수집가가 쓸 검색 키워드(search_keywords)를 LLM으로 생성.
//
// 사용법 1: 함수로 호출 (웹 UI·테스트용)
//   import { analyzeBrand } from "./analyze.js";
//   const output = await analyzeBrand(userInput);
//
// 사용법 2: 스크립트로 실행 (현재 파이프라인용)
//   node src/brand/analyze.js
//   → inputs/brand-input.json 읽어서 shared/data/brand-analysis.json 저장

const __dirname = dirname(fileURLToPath(import.meta.url));

// 시스템 프롬프트 — 검색 키워드 생성 가이드
const searchKeywordsPrompt = readFileSync(
  resolve(__dirname, "prompts/search-keywords.md"),
  "utf-8",
);

// ─── search_keywords 후처리 (프롬프트 규칙 이중 안전망) ─────────────
// LLM이 프롬프트 규칙(1~2 어절, 마케터 속성 표면 박기 금지)을 어기면 매칭가의
// demand_fit이 네이버 월 검색량 0~50만 보고 와서 신호 무의미해짐. 코드에서
// 결정적으로 한 번 더 필터링.
//
// 임계값 변경 이력:
//   - 초기: 4+ 어절 차단 (4단어 스택 방지 목적)
//   - 현재: 3+ 어절 차단 — 트렌드 분석가 실측 결과 2어절 구도 INVALID_THRESHOLD(50)
//     미만이라 1~2 어절 단일·핵심 명사 형태로 더 조임.

// 어절(공백 단위) 3개 이상이면 긴 조합어로 간주.
function isLongCompound(keyword) {
  const tokens = String(keyword).trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 3;
}

// 키워드 표면에 들어가면 안 되는 마케터 입력 속성 단어 집합 구성.
// 텍스처(매트 등)는 *트렌드 자체의 핵심 키워드*일 수도 있어 제외 — 코드로
// 트렌드 컨텍스트 판별 어려우니 과잉 필터링 회피.
function buildForbiddenAttributeWords(input) {
  const forbidden = new Set();
  // 1) 타겟 연령 (30대·Z세대 등)
  for (const a of input.target?.age_groups ?? []) {
    if (a) forbidden.add(a);
  }
  // 2) 톤·무드 키워드 — "·"·공백 단위로 쪼개 개별 단어로 (예: "럭셔리·프리미엄"
  //    → "럭셔리", "프리미엄").
  for (const tone of input.tone_and_manner ?? []) {
    for (const w of String(tone).split(/[·\s]+/)) {
      if (w && w.length >= 2) forbidden.add(w);
    }
  }
  // 3) 자사 브랜드명·제품명. 한국어 제품명은 보통 "형용사·고유표현 + 카테고리
  //    명사" 패턴(예: "실키 파운데이션", "글로우 쿠션")이라 마지막 어절은 카테
  //    고리 명사일 가능성이 높음 — 그게 검색 키워드의 중심이라 forbidden에 넣
  //    으면 정상 키워드까지 다 막혀버림. 그래서 마지막 어절은 forbidden 제외.
  //
  //    제품명이 한 어절일 때:
  //    - 그 어절이 input.category 안의 카테고리 명사면(예: 사용자가 "쿠션",
  //      "아이섀도우" 같은 카테고리명을 그대로 제품명으로 적은 케이스) forbidden
  //      에 추가하지 않음. 안 그러면 "쿠션 추천" 같은 정상 키워드도 다 차단됨.
  //    - 카테고리에 없으면 자사 고유 표현이라 보고 forbidden 추가.
  if (input.brand_name) forbidden.add(input.brand_name);
  if (input.product_name) {
    const tokens = String(input.product_name).split(/\s+/).filter(Boolean);
    const categoryNouns = new Set(
      String(input.category ?? "")
        .split(/[>·\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    // 이 입력의 카테고리에 등록된 검색 동의어(예: 블러셔→치크)도 정식 카테고리
    // 명사처럼 취급 → 동의어는 키워드로 살리고, 제품명에서 새어 나온 나머지
    // 단어(예: "선 실드 글로이 치크"의 실드·글로이)만 forbidden에 넣는다.
    const synonymNouns = new Set(getSynonymsForCategoryNouns([...categoryNouns]));

    // 한 어절이 "사실상 카테고리 명사인지" 판정.
    //  - ALL_CATEGORY_NOUNS(전역) 또는 동의어 표에 있으면 카테고리 명사로 봄
    //  - 카테고리 명사와 부분 일치도 허용 (아이섀도우 vs 아이섀도 같은 미세 차이 흡수)
    const isCategoryNoun = (w) =>
      ALL_CATEGORY_NOUNS.has(w) ||
      synonymNouns.has(w) ||
      [...categoryNouns].some(
        (n) => n.length >= 2 && (n.includes(w) || w.includes(n)),
      );

    // 제품명의 모든 어절을 동일 규칙으로 검사. (이전엔 여러 어절일 때 *마지막*
    // 어절을 "카테고리 명사겠지" 하고 무조건 봐줬는데, "…글로이 치크"처럼 마지막
    // 어절이 카테고리 명사가 아닌 제품명 단어면 그대로 새어 나갔음 → 전부 검사.)
    for (const w of tokens) {
      if (w.length >= 2 && !isCategoryNoun(w)) forbidden.add(w);
    }
  }
  return forbidden;
}

// 키워드 안에 금지 단어가 표면 노출됐는지 검사. 매칭되면 그 단어 반환.
function findAttributeViolation(keyword, forbidden) {
  for (const word of forbidden) {
    if (keyword.includes(word)) return word;
  }
  return null;
}

// 길이·속성 표면 위반 키워드를 걸러내고 사유와 함께 로그. 통과한 키워드만 반환.
function sanitizeSearchKeywords(keywords, input) {
  const forbidden = buildForbiddenAttributeWords(input);
  const kept = [];
  const dropped = [];
  for (const kw of keywords ?? []) {
    if (typeof kw !== "string" || !kw.trim()) continue;
    if (isLongCompound(kw)) {
      dropped.push({ keyword: kw, reason: "3+ 어절 — 1~2 어절 단일 명사로 축약 필요 (월 검색량 0~50)" });
      continue;
    }
    const violation = findAttributeViolation(kw, forbidden);
    if (violation) {
      dropped.push({
        keyword: kw,
        reason: `마케터 속성 "${violation}" 표면 노출 (월 검색량 0~20)`,
      });
      continue;
    }
    kept.push(kw);
  }
  return { kept, dropped };
}

// match_keywords는 입력 필드에서 자동 유도 — 마케터가 별도로 채울 필요 없음.
function buildMatchKeywords(input) {
  // category "메이크업 > 베이스" → ["메이크업", "베이스"]
  const categoryParts = input.category.split(">").map((s) => s.trim()).filter(Boolean);

  return {
    character: [...input.tone_and_manner],
    benefit_texture: [...categoryParts, ...input.texture_keywords],
    target: [
      input.target.gender,
      ...input.target.age_groups,
      input.target.involvement,
      ...input.target.motivation,
    ],
    campaign: [
      input.campaign_kpi,
      input.campaign_period,
      input.campaign_budget,
      ...input.media_channels,
    ],
  };
}

// LLM 호출 — 브랜드 정보로부터 트렌드 수집용 키워드 두 종류 생성:
//   1) search_keywords: YouTube·Tavily용 자연 문장형 5~6개
//   2) datalab_keywords: Naver DataLab용 짧은 단어형 2~3 그룹
async function generateTrendKeywords(input) {
  const client = new Anthropic();

  // 시스템 컨텐츠 끝에 cache_control — 시스템 프롬프트는 안정적이라 캐싱 효과 큼
  const systemContent = [
    {
      type: "text",
      text: searchKeywordsPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  // 카테고리 4단계 + 제품특징 옵션/자유 입력을 분리해 LLM에 명시.
  // LLM이 자유 입력값의 *의미*만 참고하고 표면에 그대로 박지 않도록 프롬프트에서 강조됨.
  const featureOptions = (input.product_features ?? []).join(", ") || "(없음)";
  const featureCustom = (input.product_features_custom ?? []).join(", ") || "(없음)";

  // 이 제품 카테고리의 검색 동의어(예: 블러셔→치크). LLM이 핵심 명사로 써도 됨.
  const synonyms = getSynonymsForCategoryNouns([
    input.category_sub,
    input.category_mid,
    input.category_major,
  ]);
  const synonymLine = synonyms.length ? synonyms.join(", ") : "(없음)";

  const userMessage = `다음 브랜드·제품 정보로 트렌드 수집용 키워드 세 종류를 모두 생성하세요.

## 입력
- 브랜드명: ${input.brand_name}
- 제품명: ${input.product_name}

### 카테고리 (4단계 구조)
- 대분류: ${input.category_major}
- 중분류: ${input.category_mid}
- 소분류: ${input.category_sub || "(없음 — 메이크업이 아니면 비어 있음)"}
- 검색 동의어: ${synonymLine}  ← 위 카테고리 명사와 같은 뜻으로 실제 검색되는 표현. 핵심 명사로 그대로 써도 됨 (없으면 무시). 단, 제품명·브랜드 고유 표현은 절대 키워드에 넣지 말 것.

### 제품특징
- 옵션 선택: ${featureOptions}
- 자유 입력: ${featureCustom}

### 브랜드 톤·타겟
- 톤앤매너: ${input.tone_and_manner.join(", ")}
- 타겟 성별: ${input.target.gender}
- 타겟 연령: ${input.target.age_groups.join(", ")}
- 뷰티관여도: ${input.target.involvement}
- 소비동기: ${input.target.motivation.join(", ")}

## 자유 입력 처리 규칙 (중요)
- "자유 입력" 값은 마케터가 자유롭게 적은 표현이라 검색되지 않는 형태일 수 있음.
  *의미만 참고*하고 실제 검색되는 표현으로 변환해서 키워드에 반영하세요.
  예) 자유 입력 "24시간 지속력" → search "지속력 파운데이션", "장시간 메이크업"
  예) 자유 입력 "피지 흡수" → search "피지 컨트롤", "유분기 잡는 베이스"
- 자유 입력이 너무 추상적이거나 검색 부적합("우리만의 시그니처 톤" 등)이면 무시.
- 오타가 있으면 의미 파악해서 정확한 표현으로 변환.
- 자유 입력값을 그대로 키워드 표면에 박지 말 것 (예: "24시간 지속력 파운데이션" ❌).

\`keyword_pairs\`(Tavily 자연 문장 + Instagram·TikTok 해시태그 짝 5~6쌍, i번째 쌍의 search·hashtag가 같은 트렌드를 가리켜야 함), \`short_keywords\`(YouTube용 짧은 평면 배열 4~6개), \`datalab_keywords\`(Naver용 짧은 단어 그룹 2~3개) 모두 채워서 JSON으로만 반환.`;

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemContent,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(BrandKeywordsLlmSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    console.error("LLM 응답 파싱 실패:");
    console.error(response.content.find((b) => b.type === "text")?.text ?? "");
    throw new Error("키워드 생성 실패");
  }

  // keyword_pairs(쌍 묶음) → search_keywords / hashtag_keywords 두 배열로 분리.
  // 코드 레벨 짝짓기 보장: 두 배열의 i번째는 항상 같은 트렌드를 가리킨다.
  const pairs = parsed.keyword_pairs ?? [];
  const search_keywords = pairs.map((p) => p.search);
  const hashtag_keywords = pairs.map((p) => p.hashtag);

  return {
    search_keywords,
    short_keywords: parsed.short_keywords,
    datalab_keywords: parsed.datalab_keywords,
    hashtag_keywords,
    usage: response.usage,
  };
}

export async function analyzeBrand(userInput) {
  // 1) 입력 검증 — 잘못된 값이면 여기서 즉시 ZodError
  const validated = BrandInputSchema.parse(userInput);

  // 2) match_keywords 자동 생성 (LLM 호출 없음)
  const match_keywords = buildMatchKeywords(validated);

  // 3) product_features 룰베이스 합성 (LLM 호출 없음, 매칭가 Ingred-Fit 핵심 입력)
  //    texture_keywords·category 소분류·tone별 안전 표현으로 조립. 카테고리
  //    위반·환각 위험 0이며 마케터 입력에서 결정적으로 생성됨.
  const product_features = buildProductFeatures(validated);

  // 4) LLM으로 트렌드 수집용 키워드 네 종류 생성
  const { search_keywords: rawSearchKeywords, short_keywords, datalab_keywords, hashtag_keywords, usage } =
    await generateTrendKeywords(validated);

  // 4-1) search_keywords 결정적 후처리 — 프롬프트 규칙 이중 안전망.
  //      LLM이 프롬프트 규칙을 어기고 4+ 어절 스택이나 마케터 속성 표면 박기로
  //      반환해도 코드에서 한 번 더 거른다 (매칭가 demand_fit 신호 보존).
  const { kept: search_keywords, dropped: searchDropped } = sanitizeSearchKeywords(
    rawSearchKeywords,
    validated,
  );
  if (searchDropped.length > 0) {
    console.warn(`⚠️ search_keywords ${searchDropped.length}개 제외됨 (네이버 검색량 보장):`);
    for (const { keyword, reason } of searchDropped) {
      console.warn(`   - "${keyword}" — ${reason}`);
    }
  }

  // 5) "40대 이상" 같은 폼-전용 값은 매칭가가 모르는 포맷이므로 풀어줌
  //    (예: "40대 이상" → "40대"·"50대"·"60대"). 폼에 표시할 원본 값은
  //    target_display.age_groups_display로 별도 보존.
  const expandedAges = validated.target.age_groups.flatMap(expandAgeGroupForMatching);
  const targetForMatching = { ...validated.target, age_groups: expandedAges };

  // 6) envelope으로 감싸 반환
  const output = wrap({
    source: "브랜드 분석",
    ...validated,
    target: targetForMatching,
    target_display: { age_groups: validated.target.age_groups }, // UI 복원용
    match_keywords,
    product_features,
    search_keywords,
    short_keywords,
    datalab_keywords,
    hashtag_keywords,
  });

  return { output, usage };
}

// ─── 스크립트 진입점 (CLI 실행 시) ──────────────────────────────────
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const inputPath = resolve(__dirname, "../../inputs/brand-input.json");
  const outPath = resolve(__dirname, "../../shared/data/brand-analysis.json");

  const userInput = JSON.parse(readFileSync(inputPath, "utf-8"));

  const startTime = Date.now();
  const { output, usage } = await analyzeBrand(userInput);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`✅ 브랜드 분석 완료: ${output.data.brand_name} (${output.data.product_name})`);
  console.log(`   search_keywords (Tavily용): ${output.data.search_keywords.length}개`);
  output.data.search_keywords.forEach((k, i) => console.log(`     ${i + 1}. ${k}`));
  console.log(`   short_keywords (YouTube용): ${output.data.short_keywords.length}개`);
  output.data.short_keywords.forEach((k, i) => console.log(`     ${i + 1}. ${k}`));
  console.log(`   datalab_keywords (Naver용): ${output.data.datalab_keywords.length} 그룹`);
  output.data.datalab_keywords.forEach((g) =>
    console.log(`     [${g.groupName}] ${g.keywords.join(", ")}`),
  );
  console.log(`   hashtag_keywords (Instagram·TikTok용): ${output.data.hashtag_keywords.length}개`);
  output.data.hashtag_keywords.forEach((k, i) => console.log(`     ${i + 1}. #${k}`));
  console.log(`   소요 시간: ${elapsed}s`);
  if (usage) {
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    console.log(
      `   토큰: 입력 ${usage.input_tokens} / 캐시 읽기 ${cacheRead} / 캐시 쓰기 ${cacheWrite} / 출력 ${usage.output_tokens}`,
    );
    recordUsage("brand", usage, "claude-haiku-4-5");
  }
  console.log(`   저장: ${outPath}`);
}
