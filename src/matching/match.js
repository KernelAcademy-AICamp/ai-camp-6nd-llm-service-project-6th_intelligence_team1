import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmMatchDataSchema, InputBrandSchema, InputTrendSchema, ConflictCheckSchema } from "./schemas.js";
import { computeIngredFit } from "./embedIngredFit.js";
import { wrap, wrapError } from "../../shared/envelope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// 1. 시스템 프롬프트 로드 (매칭가의 두뇌 + 톤앤매너 친화/충돌 테이블 포함)
const systemPrompt = readFileSync(
  resolve(__dirname, "prompts/system.md"),
  "utf-8",
);

// 세대 표현 → 출생 년도 범위. 현재 년도 기준으로 나이 범위를 동적 계산한다.
// (예: 2026년 기준 Z세대(1997~2012생) = 14~29세). 정의 변경 시 여기만 수정.
const GENERATION_BIRTH_YEARS = {
  "Z세대": { start: 1997, end: 2012 },
  "MZ세대": { start: 1980, end: 2004 },
  "밀레니얼": { start: 1981, end: 1996 },
};

// age_groups 원소 하나를 [최소나이, 최대나이]로 변환.
//   "20대"   → [20, 29]
//   "Z세대"  → [현재년도-end, 현재년도-start]  (출생년도 기준 동적)
function ageGroupToRange(group, currentYear) {
  const gen = GENERATION_BIRTH_YEARS[group];
  if (gen) return [currentYear - gen.end, currentYear - gen.start];
  const decade = parseInt(group, 10); // "20대" → 20
  if (!Number.isNaN(decade)) return [decade, decade + 9];
  return null;
}

// ─── 4기준 score·matching_grade 코드 계산 ───────────────────────────────
// 각 fit: ✅=2, ⚠️=1, ❌=0. 4기준 합산 max 8.
// matching_grade 규칙:
//   - ❌ 2개 이상 → 제외 (합산 무관)
//   - score 8 → 상
//   - score 6-7 → 중
//   - score 2-5 → 하 (❌ 1개 가능)
//   - score < 2 → 제외
const FIT_POINT = { "✅": 2, "⚠️": 1, "❌": 0 };

function computeScoreAndGrade(fits /* { ingred_fit, visual_fit, life_fit, safe_fit } */) {
  const results = [
    fits.ingred_fit?.result,
    fits.visual_fit?.result,
    fits.life_fit?.result,
    fits.safe_fit?.result,
  ];
  const failCount = results.filter((r) => r === "❌").length;
  const score = results.reduce((sum, r) => sum + (FIT_POINT[r] ?? 0), 0);

  let matching_grade;
  if (failCount >= 2) matching_grade = "제외";
  else if (score === 8) matching_grade = "상";
  else if (score >= 6) matching_grade = "중";
  else if (score >= 2) matching_grade = "하";
  else matching_grade = "제외";

  return { score, matching_grade };
}

// LLM 정성 판정(1-A·1-B·2-B) + 코드 계산(2-A·passes·verdict)을 최종 구조로 조립.
// summary_reasons에서 신뢰할 수 없는 근거 항목을 제거 (코드 안전망).
const VAGUE_TERMS = ["다수", "확산", "활발", "급증", "다양", "여럿", "증가 추세", "인기", "주목"];
// 인구통계 수치(추정값이라 부정확) 인용 차단용 패턴. LLM이 규칙 어기고 넣어도 코드가 제거.
const DEMOGRAPHIC_RE = /(여성|남성)\s*\d|\d+\s*(대|세)\s*\d*\s*%|성별\s*(비중|오버랩)|연령\s*(비중|오버랩)/;
function filterVagueReasons(reasons) {
  if (!Array.isArray(reasons)) return reasons;
  const kept = reasons.filter((r) => {
    const text = `${r?.category ?? ""} ${r?.fact ?? ""}`;
    // ① 인구통계 수치 인용 항목 제거 (추정값 — 근거로 쓰지 않음)
    if (DEMOGRAPHIC_RE.test(text)) return false;
    // ② 모호어가 들었는데 숫자가 없으면 제거 (숫자 있으면 구체적이므로 유지)
    const fact = r?.fact ?? "";
    const hasNumber = /\d/.test(fact);
    const hasVague = VAGUE_TERMS.some((t) => fact.includes(t));
    return hasNumber || !hasVague;
  });
  // 전부 걸러져 빈 배열이 되면 원본 유지 (근거 0개 방지) — 최소 1개는 남긴다.
  return kept.length > 0 ? kept : reasons;
}

// status → Safe-Fit result 매핑
const STATUS_SAFE_FIT = {
  emerging: { result: "✅", reason: "트렌드 성장 중 (emerging) — 브랜드 격 손상 위험 낮음" },
  peak:     { result: "⚠️", reason: "트렌드 정점 (peak) — 곧 하락 가능, 단기 캠페인 적합" },
  declining: { result: "❌", reason: "트렌드 하락 중 (declining) — 이미 식는 트렌드" },
};

function assembleEvaluation(llmEval, trendData, ingredOverride) {
  const fits = {
    ingred_fit: ingredOverride ?? llmEval.ingred_fit,
    visual_fit: llmEval.visual_fit,
    life_fit: llmEval.life_fit,
    safe_fit: llmEval.safe_fit,
  };

  // Life-Fit 코드 보정: audience_signal 없으면 ⚠️ 강제
  if (!trendData?.audience_signal) {
    fits.life_fit = { result: "⚠️", reason: "타겟 페르소나 정보 없음 — 비교 불가" };
  }

  // Safe-Fit 코드 보정: trend_stage 우선, 없으면 status fallback. 둘 다 없으면 ⚠️ 강제
  const status = trendData?.trend_stage ?? trendData?.status;
  const lifespan = trendData?.lifespan_estimate;
  if (STATUS_SAFE_FIT[status]) {
    fits.safe_fit = STATUS_SAFE_FIT[status];
  } else if (!lifespan) {
    fits.safe_fit = { result: "⚠️", reason: "트렌드 수명 정보 없음 — 지속 가능성 불확실" };
  }

  const { score, matching_grade } = computeScoreAndGrade(fits);
  return {
    trend_name: llmEval.trend_name,
    evaluation: fits,
    score,
    matching_grade,
    summary_reasons: filterVagueReasons(llmEval.summary_reasons),
  };
}

// 2. 입력 데이터 로드 + 분석가 형식 흡수
//    age_groups(정량 "20대" 또는 세대 "Z세대")를 age_range "14-29" 문자열로 정규화.
//    세대 표현은 실행 시점 년도 기준으로 연령 범위를 계산.
function normalizeBrandInput(brand, currentYear = new Date().getFullYear()) {
  const target = brand?.data?.target;
  if (target?.age_groups && !target.age_range) {
    const ranges = target.age_groups
      .map((g) => ageGroupToRange(g, currentYear))
      .filter(Boolean);
    if (ranges.length > 0) {
      const min = Math.min(...ranges.map((r) => r[0]));
      const max = Math.max(...ranges.map((r) => r[1]));
      target.age_range = min === max ? `${min}` : `${min}-${max}`;
    }
  }
  return brand;
}

// 분석가들의 실제 산출물을 읽음. 파일이 없으면 친절한 안내와 함께 종료.
function readAgentOutput(dataRelPath, agentLabel, runHint) {
  const dataPath = resolve(PROJECT_ROOT, dataRelPath);
  try {
    return JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.error(`❌ ${agentLabel} 산출 파일이 없습니다: ${dataRelPath}`);
    console.error(`   ${agentLabel}를 먼저 실행해서 위 파일을 생성하세요.`);
    console.error(`     ${runHint}`);
    console.error(
      `   파일 형식은 shared/schemas/ 의 example 참고 (값은 비어있는 모양만 표시).`,
    );
    process.exit(1);
  }
}

// 산출 파일을 원본 그대로 로드. normalize는 검증 후로 미룬다 — 잘못된 타입(예:
// age_groups가 문자열)이 normalize의 .map() 호출에서 크래시하는 걸 방지.
const brandRaw = readAgentOutput(
  "shared/data/brand-analysis.json",
  "브랜드 분석가",
  "node src/brand/analyze.js",
);
const trendRaw = readAgentOutput(
  "shared/data/trend-analysis.json",
  "트렌드 분석가",
  "node src/trend/analyze.js",
);
// 2-1. 입력 유효성 검사 — Zod 스키마로 형식·타입·enum·필수값 위반을 모두 잡는다.
//      LLM 호출 전 종료. garbage-in으로 잘못된 1순위/2순위가 새어나가는 사고 방지.
function formatZodIssues(issues) {
  return issues.map((iss) => {
    const path = iss.path.length ? iss.path.join(".") : "(root)";
    return `  - ${path}: ${iss.message}`;
  });
}

const brandResult = InputBrandSchema.safeParse(brandRaw);
const trendResult = InputTrendSchema.safeParse(trendRaw);
if (!brandResult.success || !trendResult.success) {
  console.error("❌ 입력 유효성 검사 실패 — 매칭 평가를 진행하지 않습니다.");
  if (!brandResult.success) {
    console.error("\n[브랜드 분석가 산출 문제]");
    formatZodIssues(brandResult.error.issues).forEach((line) =>
      console.error(line),
    );
  }
  if (!trendResult.success) {
    console.error("\n[트렌드 분석가 산출 문제]");
    formatZodIssues(trendResult.error.issues).forEach((line) =>
      console.error(line),
    );
  }
  console.error(
    "\n해당 분석가의 산출을 고친 뒤 다시 실행하세요. (LLM 호출·결과 파일 모두 생략됨)",
  );
  process.exit(1);
}

// 검증 통과 후 정규화 — analyzer v1(age_groups 배열) → v2(age_range 문자열) 흡수.
const brandAnalysis = normalizeBrandInput(brandRaw);
const trendAnalysis = trendRaw;

// 2-2. 카테고리 게이트 — 포함 관계 방식.
//      "대분류 > 소분류"에서 ① 대분류가 같고 ② 브랜드 소분류가 트렌드 소분류 문자열에
//      포함되면 통과. 예: 브랜드 "메이크업 > 립" → 트렌드 "메이크업 > 아이&립"(립 포함) 통과,
//      "메이크업 > 베이스"(립 없음)·"스킨케어 > 토너"(대분류 다름) 제외.
//      불일치 트렌드는 코드가 "제외" verdict로 만들어 결과에 포함하고 LLM 호출은 생략.
function parseCategory(c) {
  const [major, minor = ""] = String(c ?? "").split(">").map((s) => s.trim());
  return { major, minor };
}
function categoryMatches(brandCat, trendCat) {
  const b = parseCategory(brandCat);
  const t = parseCategory(trendCat);
  // 대분류 일치 + 브랜드 소분류가 트렌드 소분류에 포함 (브랜드 소분류 없으면 대분류만 비교)
  return b.major === t.major && t.minor.includes(b.minor);
}

function makeExcludedByCategory(trend, brandCategory) {
  const reason = `카테고리 불일치: 브랜드 '${brandCategory}'와 트렌드 '${trend.category}'가 대분류·소분류 포함 관계 아님`;
  const skip = { result: "❌", reason };
  return {
    trend_name: trend.trend_name,
    evaluation: {
      ingred_fit: skip,
      visual_fit: skip,
      life_fit: skip,
      safe_fit: skip,
    },
    score: 0,
    matching_grade: "제외",
    summary_reasons: [
      {
        category: "카테고리 적합성",
        fact: reason,
        source: "브랜드·트렌드 category (입력)",
      },
    ],
  };
}

const brandCategory = brandAnalysis.data.category;

// 입력 트렌드 중복 제거 — 트렌드 분석가가 같은 trend_name을 두 번 산출하면
// evaluations·recommendations에 동일 트렌드가 중복되므로, 첫 번째만 남기고 거른다.
const seenTrendNames = new Set();
const uniqueTrends = [];
let dupCount = 0;
for (const t of trendAnalysis.data.trends) {
  if (seenTrendNames.has(t.trend_name)) {
    dupCount++;
    continue;
  }
  seenTrendNames.add(t.trend_name);
  uniqueTrends.push(t);
}
if (dupCount > 0) {
  console.log(`중복 트렌드 ${dupCount}개 제거 (trend_name 기준)`);
}

const passedTrends = [];
const gatedEvaluations = [];
for (const t of uniqueTrends) {
  if (categoryMatches(brandCategory, t.category)) passedTrends.push(t);
  else gatedEvaluations.push(makeExcludedByCategory(t, brandCategory));
}
console.log(
  `카테고리 게이트(브랜드 '${brandCategory}'): 통과 ${passedTrends.length}개 / 제외 ${gatedEvaluations.length}개`,
);

// 3. 시스템 컨텐츠 — 안정적 컨텐츠 끝에 cache_control (90% 비용 절감)
//    LLM은 정성 판정(1-A·1-B·2-B+summary)만 생성. 2-A·passes·verdict·envelope은 코드가 채움.
const systemContent = [
  {
    type: "text",
    text: systemPrompt,
  },
  {
    type: "text",
    text: `## 출력 리마인더

각 트렌드마다 **4기준(ingred_fit·visual_fit·life_fit·safe_fit)의 result(✅/⚠️/❌)+reason**과 **summary_reasons**를 담아 \`evaluations[]\`로 출력하세요.

score·verdict·envelope·rank는 매칭가 코드가 계산·부여하므로 **출력하지 마세요.** 코드 블록 표시나 부가 설명 없이 순수 JSON 하나만.`,
    cache_control: { type: "ephemeral" },
  },
];

// 4. 사용자 메시지 — 카테고리 게이트 통과 트렌드만 LLM에 전달

// 매체명 정규화 — "Instagram Reels" / "Instagram" 등 동일 매체 통일
function normalizeChannel(ch) {
  const s = String(ch ?? "").toLowerCase();
  if (s.includes("instagram")) return "instagram";
  if (s.includes("youtube")) return "youtube";
  if (s.includes("tiktok") || s.includes("틱톡")) return "tiktok";
  if (s.includes("naver") || s.includes("네이버")) return "naver";
  if (s.includes("blog") || s.includes("블로그")) return "blog";
  return s;
}

// 브랜드 매체 ∩ 트렌드 매체 교집합 사전 계산 — LLM에 팩트로 전달
const brandChannelNorm = (brandAnalysis.data.media_channels ?? []).map(normalizeChannel);
const mediaOverlapByTrend = passedTrends.map((t) => {
  const trendChannelNorm = (t.media_channel_status ?? []).map((s) => normalizeChannel(s.media_channel));
  const overlap = brandChannelNorm.filter((b) => trendChannelNorm.includes(b));
  return { trend_name: t.trend_name, overlap, overlap_count: overlap.length };
});

const passedTrendInput = {
  ...trendAnalysis,
  data: { ...trendAnalysis.data, trends: passedTrends },
};
const mediaOverlapBlock = mediaOverlapByTrend.length
  ? `\n## 매체 교집합 (코드 계산 — 브랜드 매체 ∩ 트렌드 매체)\n${mediaOverlapByTrend.map((m) => `- ${m.trend_name}: 겹치는 매체 ${m.overlap_count}개 [${m.overlap.join(", ") || "없음"}]`).join("\n")}\n\n## 매체 데이터 신뢰도\n- youtube: 직접 수집 데이터 (높음) — Visual-Fit 강신호로 반영\n- instagram·tiktok: 웹 기사 2차 정보 (낮음) — 참고 수준으로만 반영\n- naver·blog: 검색 데이터 기반 (중간)\n`
  : "";

// 관여도·소비동기 의미 테이블 — LLM이 일관된 기준으로 Life-Fit 판단하도록
const INVOLVEMENT_DESC = {
  "입문자": "뷰티 루틴 막 시작, 간단하고 쉬운 제품 선호, 트렌드보다 기본에 집중",
  "일상사용자": "데일리 루틴 중심, 기능성·편의성 중시, 안정적 제품 선호",
  "얼리어답터": "새 트렌드·신제품 빠르게 수용, 실험적 소비, 바이럴 민감",
};
const MOTIVATION_DESC = {
  "자기표현": "개성·스타일 표현, 나를 드러내는 소비",
  "관리/케어": "피부 건강·유지가 우선, 기능성·성분 중시",
  "사회적 인정": "타인 시선 의식, 유행 따라가기, 보여지는 것 중요",
  "가성비·가심비": "가격 대비 가치 중시, 실용적 소비",
};

const target = brandAnalysis.data.target ?? {};
const involvementDesc = INVOLVEMENT_DESC[target.involvement] ?? target.involvement ?? "";
const motivationDescs = (target.motivation ?? []).map((m) => `${m}(${MOTIVATION_DESC[m] ?? m})`).join(", ");
const lifeFitBlock = (involvementDesc || motivationDescs)
  ? `\n## 브랜드 타겟 특성 (Life-Fit 판단 기준)\n- 관여도: ${target.involvement} → ${involvementDesc}\n- 소비동기: ${motivationDescs}\n`
  : "";

const userMessage = `다음 입력 데이터로 매칭 평가를 수행하세요.

## 브랜드 프로필
\`\`\`json
${JSON.stringify(brandAnalysis, null, 2)}
\`\`\`

## 트렌드 데이터 (${passedTrends.length}개 — 카테고리 게이트 통과분)
\`\`\`json
${JSON.stringify(passedTrendInput, null, 2)}
\`\`\`
${mediaOverlapBlock}${lifeFitBlock}
위 모든 트렌드에 대해 **4기준(ingred_fit·visual_fit·life_fit·safe_fit)의 result+reason과 summary_reasons**를 \`evaluations[]\`에 담아 반환하세요.

score·verdict·envelope·rank는 매칭가 코드가 계산·부여하므로 출력하지 마세요.`;

// 5. Ingred-Fit 임베딩 사전 계산 — LLM 호출 전 features ↔ keywords 유사도 판정
const brandFeatures = brandAnalysis.data.product_features ?? [];
const ingredOverrides = new Map();
if (brandFeatures.length > 0 && passedTrends.length > 0) {
  console.log("Ingred-Fit 임베딩 계산 중...");
  for (const t of passedTrends) {
    const keywords = t.keywords ?? t.core_keywords ?? [];
    const fit = await computeIngredFit(brandFeatures, keywords);
    if (fit) ingredOverrides.set(t.trend_name, fit);
  }
}

// 6. Claude API 호출 — 통과 트렌드가 있을 때만. LLM은 data 본체만 생성.
let llmEvaluations = [];
let usage = null;
let elapsed = "0.0";
let modelName = "(LLM 호출 생략)";

if (passedTrends.length > 0) {
  const client = new Anthropic();
  console.log("매칭 평가 시작...\n");
  const startTime = Date.now();

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 8192,
    temperature: 0, // 정성 판정(1-A·1-B·2-B) 흔들림 최소화 — 경계선 트렌드 순위 안정화
    system: systemContent,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(LlmMatchDataSchema),
    },
  });

  elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const data = response.parsed_output;
  if (!data) {
    console.error("❌ 스키마 검증 실패");
    console.error("--- 응답 원문 ---");
    console.error(response.content.find((b) => b.type === "text")?.text ?? "");
    const errorResult = wrapError("매칭가 LLM 출력이 LlmMatchDataSchema 검증에 실패함");
    console.error(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }

  // LLM 응답 trend_name 집합이 입력(통과 트렌드)과 정확히 일치하는지 검증.
  //   - 입력에 없는 이름 반환 → 환각/오염
  //   - 입력에 있는데 응답에서 누락 → 평가 누락
  // 둘 다 결과 무결성을 깨므로 즉시 실패시킨다 (잘못된 매칭이 새어나가는 사고 방지).
  const inputNames = new Set(passedTrends.map((t) => t.trend_name));
  const responseNames = new Set(data.evaluations.map((le) => le.trend_name));
  const extra = [...responseNames].filter((n) => !inputNames.has(n));
  const missing = [...inputNames].filter((n) => !responseNames.has(n));
  if (extra.length || missing.length) {
    console.error("❌ LLM 응답의 트렌드 집합이 입력과 불일치 — 결과 무결성 보장 불가.");
    if (extra.length) console.error(`   입력에 없는 트렌드(환각): ${extra.join(", ")}`);
    if (missing.length) console.error(`   응답에서 누락된 트렌드: ${missing.join(", ")}`);
    const errorResult = wrapError("LLM 응답 trend_name 집합이 입력과 불일치");
    console.error(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }

  // LLM이 같은 trend_name을 두 번 출력하는 환각 케이스 — 첫 번째만 남기고 dedup.
  const seenLlmNames = new Set();
  const dedupedEvals = [];
  let llmDupCount = 0;
  for (const le of data.evaluations) {
    if (seenLlmNames.has(le.trend_name)) {
      llmDupCount++;
      continue;
    }
    seenLlmNames.add(le.trend_name);
    dedupedEvals.push(le);
  }
  if (llmDupCount > 0) {
    console.warn(`⚠️ LLM 응답에서 ${llmDupCount}개 중복 trend_name 제거됨`);
  }

  // LLM 정성 판정(4기준) + 코드 계산(score·verdict)을 조립.
  const passedTrendByName = new Map(passedTrends.map((t) => [t.trend_name, t]));
  llmEvaluations = dedupedEvals.map((le) =>
    assembleEvaluation(le, passedTrendByName.get(le.trend_name), ingredOverrides.get(le.trend_name))
  );
  usage = response.usage;
  modelName = response.model;
} else {
  console.log("카테고리 게이트 통과 트렌드 0개 — LLM 호출 생략, 전부 제외 처리.\n");
}

// 6. LLM 평가분(통과) + 코드 생성분(카테고리 제외)을 합쳐 정렬·선별.
//    매칭가의 목적: 여러 트렌드 중 브랜드와 맞는 상위 3개를 골라 추천.
const allEvaluations = [...llmEvaluations, ...gatedEvaluations];
const allTrendByName = new Map(
  trendAnalysis.data.trends.map((t) => [t.trend_name, t]),
);

// 정렬: matching_grade → 4기준 score 내림 → 트렌드 metrics.score 내림.
const GRADE_RANK = { "상": 1, "중": 2, "하": 3, 제외: 99 };
function sortTuple(ev) {
  const vr = GRADE_RANK[ev.matching_grade] ?? 99;
  const fitScore = ev.score ?? 0;
  const trendScore = allTrendByName.get(ev.trend_name)?.metrics?.score ?? 0;
  return [vr, -fitScore, -trendScore];
}
allEvaluations.sort((a, b) => {
  const ka = sortTuple(a);
  const kb = sortTuple(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
});

// 추천: 제외가 아닌 것 전부 (최소 3개 기준, 있는 만큼 다양하게).
const nonExcluded = allEvaluations.filter((ev) => ev.matching_grade !== "제외");
let topEvals = [...nonExcluded];

// 뷰티 카테고리 정반대 개념 쌍 — 코드 1차 감지용
const KEYWORD_CONFLICT_PAIRS = [
  ["글로우", "매트"],
  ["광채", "매트"],
  ["글로시", "매트"],
  ["쿨톤", "웜톤"],
];

function detectKeywordConflict(evs) {
  for (const [keyA, keyB] of KEYWORD_CONFLICT_PAIRS) {
    const hasA = (ev) => {
      const t = allTrendByName.get(ev.trend_name);
      return [...(t?.keywords ?? []), ...(t?.core_keywords ?? [])]
        .some((k) => k.toLowerCase().includes(keyA));
    };
    const hasB = (ev) => {
      const t = allTrendByName.get(ev.trend_name);
      return [...(t?.keywords ?? []), ...(t?.core_keywords ?? [])]
        .some((k) => k.toLowerCase().includes(keyB));
    };
    const groupA = evs.filter(hasA);
    const groupB = evs.filter(hasB);
    if (groupA.length > 0 && groupB.length > 0) {
      // 이미 정렬된 상태 — 가장 낮은 순위(인덱스 큰 것) 제거
      const conflicting = [...groupA, ...groupB];
      const toRemove = conflicting.reduce((worst, ev) =>
        evs.indexOf(ev) > evs.indexOf(worst) ? ev : worst
      );
      return { remove: toRemove.trend_name, reason: `키워드 충돌: '${keyA}' vs '${keyB}'` };
    }
  }
  return null;
}

// 충돌 체크 — 코드 감지 우선, 못 잡으면 LLM. 충돌 없을 때까지 반복 (최대 5회).
const MAX_CONFLICT_ROUNDS = 5;
const conflictClient = new Anthropic();
for (let round = 0; round < MAX_CONFLICT_ROUNDS && topEvals.length >= 2; round++) {
  // 1차: 코드 키워드 감지
  const codeConflict = detectKeywordConflict(topEvals);
  if (codeConflict) {
    console.log(`⚠️ 방향성 충돌 감지 (${round + 1}회, 코드) — '${codeConflict.remove}' 제거: ${codeConflict.reason}`);
    topEvals = topEvals.filter((ev) => ev.trend_name !== codeConflict.remove);
    continue;
  }

  // 2차: LLM 감지 (코드가 못 잡은 경우)
  const topCtx = topEvals.map((ev) => {
    const t = allTrendByName.get(ev.trend_name);
    return { trend_name: ev.trend_name, keywords: t?.keywords ?? t?.core_keywords ?? [], summary: t?.summary ?? "" };
  });

  const conflictMsg = `추천 트렌드 간 핵심 방향성을 비교하세요.

## 추천 트렌드 전체
${JSON.stringify(topCtx, null, 2)}

핵심 개념이 정반대인 쌍(예: 글로우 vs 매트, 쿨톤 vs 웜톤)이 있으면:
- has_conflict: true
- remove: 나머지 트렌드들과의 방향성 비교해 덜 일치하는 트렌드명 (정확히 trend_name 그대로)
- reason: 한 줄 이유

충돌 없으면 has_conflict: false, remove: null.`;

  const conflictRes = await conflictClient.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    temperature: 0,
    messages: [{ role: "user", content: conflictMsg }],
    output_config: { format: zodOutputFormat(ConflictCheckSchema) },
  });

  const cd = conflictRes.parsed_output;
  if (cd?.has_conflict && cd.remove) {
    console.log(`⚠️ 방향성 충돌 감지 (${round + 1}회, LLM) — '${cd.remove}' 제거: ${cd.reason}`);
    topEvals = topEvals.filter((ev) => ev.trend_name !== cd.remove);
  } else {
    break;
  }
}

const recommendations = topEvals.slice(0, 3).map((ev, i) => {
  const trendRaw = allTrendByName.get(ev.trend_name);
  return {
    rank: i + 1,
    trend_id: trendRaw?.trend_id ?? null,
    trend_name: trendRaw?.trend_name ?? ev.trend_name, // 입력 원본 우선 (LLM 변형 방지)
    summary_reasons: ev.summary_reasons,
  };
});

// envelope은 매칭가가 wrap()으로 추가. brand_name은 입력값을 신뢰(LLM 오타 방지).
const finalData = {
  brand_name: brandAnalysis.data.brand_name,
  recommendations,
  evaluations: allEvaluations,
};
const matchResult = wrap(finalData);

// 7. 결과 출력
console.log("=== 매칭 결과 ===\n");
console.log(JSON.stringify(matchResult, null, 2));

// 8. 결과 파일 저장
const outputDir = resolve(PROJECT_ROOT, "shared/data");
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "match-result.json");
writeFileSync(outputPath, JSON.stringify(matchResult, null, 2), "utf-8");

// 9. 메타 정보 (LLM 호출이 있었을 때만 비용·토큰 표시)
console.log("\n=== 메타 ===");
console.log(`모델          : ${modelName}`);
console.log(`소요 시간     : ${elapsed}s`);
console.log(
  `평가          : LLM ${llmEvaluations.length}개 + 카테고리 제외 ${gatedEvaluations.length}개`,
);
if (usage) {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  // Haiku 4.5 가격 ($/1M tokens): input $1, output $5
  const cost =
    (usage.input_tokens * 1 +
      cacheWrite * 1.25 +
      cacheRead * 0.1 +
      usage.output_tokens * 5) /
    1_000_000;
  console.log(`입력 토큰     : ${usage.input_tokens}  (비캐시)`);
  console.log(`캐시 쓰기     : ${cacheWrite}  (이번에 캐시에 저장됨, 1.25x 비용)`);
  console.log(`캐시 읽기     : ${cacheRead}  (캐시에서 가져옴, 0.1x 비용)`);
  console.log(`출력 토큰     : ${usage.output_tokens}`);
  console.log(
    `예상 비용     : $${cost.toFixed(6)} (≈ ${(cost * 1300).toFixed(2)}원)`,
  );
}
console.log(`결과 저장     : ${outputPath}`);
