import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmMatchDataSchema, InputBrandSchema, InputTrendSchema } from "./schemas.js";
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

// ─── 2-A·passes·verdict 코드 계산 (숫자·규칙은 LLM에 맡기지 않음) ───────

// "14-29" → [14, 29] / "20" → [20, 20]
function parseAgeRange(s) {
  const m = String(s ?? "").match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  return [lo, m[2] ? parseInt(m[2], 10) : lo];
}

// 트렌드 age_ratio 키 → 나이 버킷. "10s" → [10,19], "50s+" → [50, 200]
function ageBucketRange(key) {
  const n = parseInt(key, 10);
  if (Number.isNaN(n)) return null;
  return key.includes("+") ? [n, 200] : [n, n + 9];
}

function rangesOverlap([a1, a2], [b1, b2]) {
  return a1 <= b2 && b1 <= a2;
}

// 비교 2-A: 브랜드 타겟 연령·성별 ↔ 트렌드 비중 합산. 60%가 칼같은 경계.
function compute2A(brandTarget, audience) {
  const range = parseAgeRange(brandTarget?.age_range);
  const ageRatio = audience?.age_ratio ?? {};
  let agePct = 0;
  if (range) {
    for (const [key, val] of Object.entries(ageRatio)) {
      const bucket = ageBucketRange(key);
      if (bucket && rangesOverlap(range, bucket)) agePct += val;
    }
  }
  agePct = Math.round(agePct * 100);

  const genderRatio = audience?.gender_ratio ?? {};
  let genderPct;
  if (brandTarget?.gender === "여성") genderPct = Math.round((genderRatio.female ?? 0) * 100);
  else if (brandTarget?.gender === "남성") genderPct = Math.round((genderRatio.male ?? 0) * 100);
  else genderPct = 100; // 공용 → 전체 포괄

  const ageOk = agePct >= 60;
  const genderOk = genderPct >= 60;
  const result = ageOk && genderOk ? "✅" : ageOk || genderOk ? "⚠️" : "❌";
  const reason = `[코드 계산] 연령 오버랩 ${agePct}% (${ageOk ? "≥" : "<"}60), 성별 오버랩 ${genderPct}% (${genderOk ? "≥" : "<"}60) → ${result}`;
  return { result, reason };
}

// 질문별 passes: 두 비교 조합 매핑. ❌ 하나라도 → 0, ✅+✅ → 2, 그 외 → 1.
function computePasses(rA, rB) {
  if (rA === "❌" || rB === "❌") return 0;
  if (rA === "✅" && rB === "✅") return 2;
  return 1;
}

// 최종 verdict: q1·q2 passes 매트릭스. 하나라도 0이면 제외.
function computeVerdict(q1, q2) {
  if (q1 === 0 || q2 === 0) return "제외";
  const sum = q1 + q2;
  return sum === 4 ? "1순위" : sum === 3 ? "2순위" : "3순위";
}

// LLM 정성 판정(1-A·1-B·2-B) + 코드 계산(2-A·passes·verdict)을 최종 구조로 조립.
function assembleEvaluation(llmEval, trend, brandTarget) {
  const c = llmEval.comparisons;
  const a2 = compute2A(brandTarget, trend?.audience_distribution);
  const q1passes = computePasses(c["1-A"].result, c["1-B"].result);
  const q2passes = computePasses(a2.result, c["2-B"].result);
  return {
    trend_name: llmEval.trend_name,
    evaluation: {
      question_1: {
        label: "브랜드 적합성",
        comparisons: { "1-A": c["1-A"], "1-B": c["1-B"] },
        passes: q1passes,
      },
      question_2: {
        label: "타겟 적합성",
        comparisons: { "2-A": a2, "2-B": c["2-B"] },
        passes: q2passes,
      },
    },
    verdict: computeVerdict(q1passes, q2passes),
    summary_reasons: llmEval.summary_reasons,
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

// 2-2. 카테고리 게이트 — 브랜드 category와 "대분류 > 소분류" 표기가 정확히 같은
//      트렌드만 LLM 평가 대상. 불일치 트렌드는 코드가 "제외" verdict로 직접 만들어
//      결과에 포함(작성가가 제외 사유를 알 수 있게)하고 LLM 호출은 생략(비용 절약).
function makeExcludedByCategory(trend, brandCategory) {
  const reason = `카테고리 불일치: 브랜드 '${brandCategory}' ≠ 트렌드 '${trend.category}'`;
  const skip = { result: "❌", reason };
  return {
    trend_name: trend.trend_name,
    evaluation: {
      question_1: { label: "브랜드 적합성", comparisons: { "1-A": skip, "1-B": skip }, passes: 0 },
      question_2: { label: "타겟 적합성", comparisons: { "2-A": skip, "2-B": skip }, passes: 0 },
    },
    verdict: "제외",
    summary_reasons: [`${reason} → 카테고리 게이트에서 사전 제외 (LLM 평가 생략)`],
  };
}

const brandCategory = brandAnalysis.data.category;
const passedTrends = [];
const gatedEvaluations = [];
for (const t of trendAnalysis.data.trends) {
  if (t.category === brandCategory) passedTrends.push(t);
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

각 트렌드마다 **1-A·1-B·2-B의 result(✅/⚠️/❌)+reason**과 **summary_reasons**만 담아 \`evaluations[]\`로 출력하세요. 2-A·passes·verdict·envelope은 매칭가 코드가 계산·부여하므로 **출력하지 마세요.** 코드 블록 표시나 부가 설명 없이 순수 JSON 하나만.`,
    cache_control: { type: "ephemeral" },
  },
];

// 4. 사용자 메시지 — 카테고리 게이트 통과 트렌드만 LLM에 전달
const passedTrendInput = {
  ...trendAnalysis,
  data: { ...trendAnalysis.data, trends: passedTrends },
};
const userMessage = `다음 입력 데이터로 매칭 평가를 수행하세요.

## 브랜드 프로필
\`\`\`json
${JSON.stringify(brandAnalysis, null, 2)}
\`\`\`

## 트렌드 데이터 (${passedTrends.length}개 — 카테고리 게이트 통과분)
\`\`\`json
${JSON.stringify(passedTrendInput, null, 2)}
\`\`\`

위 모든 트렌드에 대해 4개 비교(1-A, 1-B, 2-A, 2-B)를 수행하고, verdict까지 산출해 \`evaluations[]\`에 담아 반환하세요. (envelope 제외, data 본체만)`;

// 5. Claude API 호출 — 통과 트렌드가 있을 때만. LLM은 data 본체만 생성.
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

  // LLM 정성 판정 + 코드 계산(2-A·passes·verdict)을 조립. trend_name으로 트렌드 매칭.
  const trendByName = new Map(passedTrends.map((t) => [t.trend_name, t]));
  llmEvaluations = data.evaluations.map((le) => {
    const trend = trendByName.get(le.trend_name);
    if (!trend) {
      console.warn(`⚠️ LLM이 반환한 trend_name '${le.trend_name}'을 입력에서 못 찾음 — audience_distribution 없이 2-A 계산.`);
    }
    return assembleEvaluation(le, trend, brandAnalysis.data.target);
  });
  usage = response.usage;
  modelName = response.model;
} else {
  console.log("카테고리 게이트 통과 트렌드 0개 — LLM 호출 생략, 전부 제외 처리.\n");
}

// 6. LLM 평가분(통과) + 코드 생성분(카테고리 제외)을 합쳐 최종 결과 구성.
//    envelope은 매칭가가 wrap()으로 추가. brand_name은 입력값을 신뢰(LLM 오타 방지).
const finalData = {
  brand_name: brandAnalysis.data.brand_name,
  evaluations: [...llmEvaluations, ...gatedEvaluations],
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
