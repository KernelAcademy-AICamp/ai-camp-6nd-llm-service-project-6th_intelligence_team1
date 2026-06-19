import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recordUsage } from "../../src/shared/token-log.js";

// 작성가 v1 — 순수 데이터 매핑 + 카드 텍스트 LLM 풍부화 (디자인 담당 합의).
//
// 입력 (shared/data/):
//   - brand-analysis.json  (엄남경)
//   - trend-analysis.json  (이효희 분석 + 가지수 수집)
//   - match-result.json    (오주연)
// 출력:
//   - output-main/output-text/report.md  (이 파일 옆)
//   - output-main/output-text/writer-output.json (UI 서빙용)
//
// 사용법:
//   node output-main/output-text/write.js
//   import { generateReport } from "./write.js"; const md = generateReport({brand, trend, match});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

function readJSON(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

// envelope 형식("data" 안에 본문) 또는 본문 직접 형태 모두 지원
function unwrap(json) {
  return json?.data ?? json;
}

// 매칭가가 LLM 출력에 섞어 보내는 내부 필드명을 사람이 읽기 좋은 한글로
// 치환. 매칭가 측 시스템 프롬프트가 자연어 강제를 안 해 영문 식별자가
// 가끔 섞이는 문제의 작성가 측 후처리. (근본 해결은 매칭가 프롬프트 측에서)
//
// 매핑은 긴 매칭(여러 단어)부터 시도해야 부분 일치로 잘림이 안 일어남.
// 예: "trend_stage" 먼저 → "stage" 그 다음.
const TECHNICAL_TERM_MAP = [
  ["audience_distribution", "타겟 분포"],
  ["audience_signal", "타겟 라이프스타일"],
  ["product_features", "제품 특성"],
  ["media_channel_status", "채널별 활성도"],
  ["channel_activity", "채널별 활성도"],
  ["matching_grade", "매칭 등급"],
  ["headline_metric", "대표 지표"],
  ["growth_rate", "성장률"],
  ["trend_stage", "트렌드 단계"],
  ["product_fit", "제품 적합도"],
  ["target_fit", "타겟 적합도"],
  ["tnm_fit", "톤·매너 적합도"],
  ["ingred_fit", "성분 적합도"],
  ["visual_fit", "비주얼 적합도"],
  ["life_fit", "라이프스타일 적합도"],
  ["stage peak", "정점 단계"],
  ["stage emerging", "성장 단계"],
  ["stage declining", "하락 단계"],
  ["ingred", "성분·제형"],
  ["features", "특성"],
  ["product_name", "제품명"],
  ["lifespan_estimate", "트렌드 수명"],
  ["keywords", "키워드"],
  ["status", "현황"],
];
// 배열 내부 문자열을 따옴표 제거 + 쉼표로 join.
//   "'자기표현'"        → "자기표현"
//   "'20대', '30대'"    → "20대, 30대"
//   "'값1', \"값2\""     → "값1, 값2"
function extractArrayValues(inner) {
  if (!inner) return "";
  const matches = [...inner.matchAll(/['"]([^'"]+)['"]/g)];
  if (matches.length === 0) return inner.trim();
  return matches.map((m) => m[1].trim()).join(", ");
}

// 한글 음절의 종성(받침) 코드 반환. 한글 음절이 아니면 -1.
// 한글 음절 = 0xAC00 ~ 0xD7A3, 종성 = (code - 0xAC00) % 28.
// 0=받침없음, 1=ㄱ, …, 8=ㄹ, … (28종)
function getJongseong(syllable) {
  if (!syllable) return -1;
  const code = syllable.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return -1;
  return (code - 0xAC00) % 28;
}

// 받침 기반 조사 자동 교정. 매칭가 LLM이 받침에 안 맞는 조사를 박거나
// 단어 사이 공백이 끼면 보정. 한글 음절 앞에만 적용 — 영문/숫자 끝나는
// 단어는 LLM 원본 보존.
//   "광택가 매칭"   → "광택이 매칭"      (ㄱ 받침 → 이)
//   "20-30대 과 부합" → "20-30대와 부합"  (대 무받침 → 와, 공백 흡수)
//   "물으로 씻어"    → "물로 씻어"        (ㄹ 받침 예외 → 로)
// 매칭 후 경계(공백·구두점·문장끝)가 따라야만 조사로 인정해 단어 내부 매칭 회피.
//
// 보정 제외 케이스:
//   - "은/는": 동사 관형사형 어미("있는", "되는", "하는")로 자주 쓰여 주격조사와
//     모양이 같지만 받침 규칙이 반대(있는 → 있은 오류). 한국어 형태소 분석기
//     없이는 구분 불가.
//   - "와/과": 명사 자체에 들어가는 경우("사과", "치과", "외과") 잘못 건드릴 수
//     있어 단어 사이 *명시적 공백*이 있는 케이스만 보정 (별도 분기).
//   - "(으)로": ㄹ 받침(jongseong=8)은 "로" 사용 (한국어 예외 규칙).

// 이/가, 을/를 — 동사 활용 충돌 거의 없어 일반 패턴 보정.
const SAFE_PARTICLE_PAIRS = [
  { jong: "이", noJong: "가" },
  { jong: "을", noJong: "를" },
];

function fixKoreanParticles(text) {
  if (!text) return text;
  let result = text;
  // 조사 앞에 한글 2자(받침 검사 대상은 마지막 1자). 짧은 명사 "증가"·"고가"·
  // "추가" 같은 1자 어간+1자 패턴이 잘못 보정되지 않도록 prefix 2자 강제.
  for (const { jong, noJong } of SAFE_PARTICLE_PAIRS) {
    const pattern = new RegExp(
      `([가-힣][가-힣])(?:${jong}|${noJong})(?=\\s|$|[,.!?…·)\\]])`,
      "g",
    );
    result = result.replace(pattern, (_, prefix) => {
      const lastCh = prefix[prefix.length - 1];
      const right = getJongseong(lastCh) !== 0 ? jong : noJong;
      return `${prefix}${right}`;
    });
  }
  // 와/과 — 한글 + 공백 + 조사 패턴만 (명사 "사과"·"치과" 보호).
  result = result.replace(
    /([가-힣])\s+(?:와|과)(?=\s|$|[,.!?…·)\]])/g,
    (_, ch) => `${ch}${getJongseong(ch) !== 0 ? "과" : "와"}`,
  );
  // (으)로 — 동일하게 prefix 2자 요구 ("결과로" 등 짧은 명사 보호).
  // 받침 ㄹ(8)은 예외적으로 "로" 사용.
  result = result.replace(
    /([가-힣][가-힣])\s*(?:으로|로)(?=\s|$|[,.!?…·)\]])/g,
    (_, prefix) => {
      const lastCh = prefix[prefix.length - 1];
      const j = getJongseong(lastCh);
      const right = j === 0 || j === 8 ? "로" : "으로";
      return `${prefix}${right}`;
    },
  );
  return result;
}

function naturalizeMatcherText(text) {
  if (!text) return text;
  let result = text;

  // 1) 단어 매핑 — 영문 식별자를 자연 한글로 (audience_signal → 타겟 라이프스타일 등)
  for (const [tech, natural] of TECHNICAL_TERM_MAP) {
    result = result.split(tech).join(natural);
  }

  // 2) 변수.속성=['값', '값'] 패턴 → 값들만 (쉼표로 연결).
  //    매칭가 LLM이 가끔 raw 코드 액세서를 그대로 노출:
  //    "target.motivation=['자기표현']" → "자기표현"
  //    "target.age_groups=['20대','30대']" → "20대, 30대"
  result = result.replace(
    /[A-Za-z가-힣_]+(?:\.[A-Za-z가-힣_]+)+\s*=\s*\[([^\[\]]*)\]/g,
    (_, inner) => extractArrayValues(inner),
  );

  // 3) 잔여 배열 표기 ['값'] 또는 ["값"] → 값만 (변수 없이 단독 배열도 정리)
  result = result.replace(/\[\s*((?:['"][^'"\[\]]+['"])(?:\s*,\s*['"][^'"\[\]]+['"])*)\s*\]/g,
    (_, inner) => extractArrayValues(inner),
  );

  // 4) 잔여 따옴표 둘러싼 텍스트 → 따옴표만 제거. 한글·영문·숫자·언더스코어
  //    외에 자주 들어오는 문장부호(>, ·, ,, -, ., :, %, ~, /, ↔ 등)도 포함.
  result = result.replace(
    /['"]([가-힣A-Za-z0-9_·,\->.:%~/↔()\s]+)['"]/g,
    "$1",
  );

  // 5) 영문 소문자 키:값 패턴 → 키 제거하고 값만 남김.
  //    "age_groups: 20대" → "20대",  "involvement: 입문자" → "입문자"
  //    5자 이상 길이 제한으로 영문 약어("URL:", "ID:", "AI:") 보호.
  result = result.replace(/\b[a-z][a-z_]{4,}\s*:\s*/g, "");

  // 6) 단어 단독 "target" → "타겟" (target.motivation 같은 패턴은 1·2단계에서
  //    이미 처리됨, 단독 등장한 영문 단어만 한글화)
  result = result.replace(/\btarget\b/g, "타겟");

  // 7) 사람 친화 접속어 치환 — 자연스러운 한국어로
  //    "A vs B" → "A 와 B" / "A + B" (양옆 공백 끼인 +만, +22% 같은 부호는 보존)
  //    "A ↔ B" → "A 와 B" (매칭가가 비교 의미로 자주 사용)
  result = result.replace(/\s+vs\s+/gi, " 와 ");
  result = result.replace(/\s\+\s/g, " 와 ");
  result = result.replace(/\s*↔\s*/g, " 와 ");

  // 8) "N+" → "N건 이상" 풀어쓰기 — 매칭가 reason에도 evidence value의
  //    "30+", "50+" 같은 표기가 들어올 수 있어 텍스트 단위로 통합 변환.
  result = expandNPlus(result);

  // 9) 한국어 조사 자동 교정 (받침 기반) — 마지막 단계. 위 단계들에서
  //    "와"·"N건 이상" 등을 삽입했을 수 있어 조사 보정은 가장 끝에서 수행.
  result = fixKoreanParticles(result);

  return result;
}

// 매칭가 summary_reasons 호환 처리:
//   - 신형(객체): { category, fact, source } → 두 가지 형식으로 변환
//   - 구형(문자열): 그대로 사용 (하위 호환)
//
// formatReason: 마크다운 리포트 불릿용. "**카테고리** — fact" 형식.
// reasonText:   UI JSON 카피용. 평문 fact만.
// 둘 다 naturalizeMatcherText()로 영문 식별자 치환 후 반환.
function formatReason(r) {
  if (r == null) return "";
  if (typeof r === "string") return naturalizeMatcherText(r);
  const cat = r.category ? `**${r.category}** — ` : "";
  return cat + naturalizeMatcherText(r.fact ?? "");
}

function reasonText(r) {
  if (r == null) return "";
  if (typeof r === "string") return naturalizeMatcherText(r);
  return naturalizeMatcherText(r.fact ?? "");
}

// 타겟 표시: "20대 여성 · Z세대·트렌디" 형식
// - 연령·성별은 공백으로 묶고, 톤앤매너만 점으로 구분
function formatTarget(data) {
  const ages = data.target_display?.age_groups ?? data.target?.age_groups ?? [];
  const gender = data.target?.gender ?? "";
  const tone = (data.tone_and_manner ?? []).join("·");
  const demo = [ages.join("·"), gender].filter(Boolean).join(" ");
  return [demo, tone].filter(Boolean).join(" · ");
}

// 출처명 → 원본 링크 (HTML 시안 report-mockup.html의 src-chip 기준)
// Instagram은 미사용 (브랜드가 캠페인 매체로 안 씀) — 트렌드 evidence에 들어와도 EXCLUDED_SOURCES로 걸러냄.
const SOURCE_URL = {
  "naver datalab": "https://datalab.naver.com/",
  "naver": "https://datalab.naver.com/",
  "네이버": "https://datalab.naver.com/",
  "tavily": "https://tavily.com/",
};

// 작성가 출력에서 제외할 source/채널 — 브랜드가 이 매체를 캠페인에 안 씀.
const EXCLUDED_SOURCES = ["instagram", "인스타그램"];
function isExcluded(name = "") {
  const s = String(name).toLowerCase();
  return EXCLUDED_SOURCES.some((ex) => s.includes(ex));
}

// 출처 문자열에 매핑 키가 포함되면 해당 URL 반환 (없으면 null)
function sourceUrl(source = "") {
  const s = source.toLowerCase();
  for (const [key, url] of Object.entries(SOURCE_URL)) {
    if (s.includes(key)) return url;
  }
  return null;
}

// 트렌드 keywords 정규화. 매칭가가 형식 두 가지 중 하나로 줄 수 있음:
//   - 옛 형식: Array<string>
//   - 신 형식: { ingred?: string[], life?: string[], ... } 카테고리 객체
// 둘 다 받아서 평면 배열로 통일. 객체일 땐 ingred + life만 사용.
function normalizeKeywords(keywords) {
  if (Array.isArray(keywords)) return keywords;
  if (keywords && typeof keywords === "object") {
    return [...(keywords.ingred ?? []), ...(keywords.life ?? [])];
  }
  return [];
}

// 키워드 배열 → `칩1` `칩2` (백틱 인라인 코드로 칩 표현, HTML keyword-tags 등가)
function keywordChips(keywords = []) {
  return normalizeKeywords(keywords).filter(Boolean).map((k) => `\`${k}\``).join(" ");
}

// 정량 지표 한 줄 (headline_metric + 기간) — HTML metric-strip 등가
function metricStrip(td) {
  const hm = td?.headline_metric ?? {};
  const period = td?.metrics?.period ?? "";
  const parts = [];
  if (hm.metric || hm.value) {
    const delta = hm.delta ? ` (${hm.delta})` : "";
    parts.push(`**${hm.metric ?? "지표"}** ${hm.value ?? ""}${delta}`.trim());
  }
  if (period) parts.push(`**기간** ${period}`);
  return parts.length ? `> 📊 ${parts.join(" · ")}` : "";
}

export function generateReport({ brand, trend, match } = {}) {
  const b = unwrap(brand);
  const t = unwrap(trend);
  const m = unwrap(match);

  const top = m.recommendations ?? [];
  const findTrend = (name) => (t.trends ?? []).find((x) => x.trend_name === name);

  const lines = [];

  // 헤더
  lines.push(`# ${b.brand_name} — 캠페인 트렌드 매칭 리포트`);
  lines.push("");
  lines.push(`**제품**: ${b.product_name}`);
  lines.push(`**카테고리**: ${b.category}`);
  lines.push(`**타겟**: ${formatTarget(b)}`);
  lines.push("");

  // 캠페인 정보 — brand-analysis.json의 campaign_kpi/period/budget 노출.
  // 빈 값이거나 누락된 필드는 건너뜀(헤더 깨지지 않도록).
  const campaignLines = [];
  if (b.campaign_kpi) campaignLines.push(`- KPI: ${b.campaign_kpi}`);
  if (b.campaign_period) campaignLines.push(`- 기간: ${b.campaign_period}`);
  if (b.campaign_budget) campaignLines.push(`- 예산: ${b.campaign_budget}`);
  if (campaignLines.length > 0) {
    lines.push("**캠페인 정보**");
    campaignLines.forEach((l) => lines.push(l));
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Part I — Trend Summary
  lines.push("## 📌 Part I — Trend Summary");
  lines.push("");
  top.forEach((r, i) => {
    const td = findTrend(r.trend_name);
    const letter = String.fromCharCode(65 + i);
    lines.push(`**${letter}. ${r.trend_name}**`);
    lines.push(td?.summary ?? "*(요약 없음)*");
    lines.push("");
  });
  lines.push("---");
  lines.push("");

  // Part II — 트렌드 카드
  // 차별점 — 카드끼리 다른 키워드를 표면화 (같은 결의 트렌드가 추천되어도
  // 마케터가 선택지를 식별할 수 있게). generateWriterOutput과 같은 로직.
  lines.push("## 📌 Part II — 트렌드 카드");
  lines.push("");
  const allKeywordArrays = top.map((r) => {
    const td = findTrend(r.trend_name);
    return normalizeKeywords(td?.keywords).slice(0, 5);
  });
  top.forEach((r, i) => {
    const td = findTrend(r.trend_name);
    const letter = String.fromCharCode(65 + i);
    const distinction = buildDistinction(allKeywordArrays, i);
    const distSuffix = distinction ? ` — ${distinction}` : "";

    lines.push(`### [${letter}] ${r.trend_name} (${r.rank}순위)${distSuffix}`);
    lines.push("");

    // 키워드 칩 (HTML keyword-tags 등가)
    const chips = keywordChips(td?.keywords);
    if (chips) {
      lines.push(chips);
      lines.push("");
    }

    // 정량 지표 (HTML metric-strip 등가)
    const strip = metricStrip(td);
    if (strip) {
      lines.push(strip);
      lines.push("");
    }

    // 📊 유행현황 — 의미(meaning)를 첫 불렛으로 흡수 (별도 의미 블록 제거)
    lines.push("**📊 유행현황 (Status)**");
    const statusBullets = [];
    if (td?.meaning) statusBullets.push(td.meaning);
    const status = td?.status;
    if (Array.isArray(status)) statusBullets.push(...status.filter(Boolean));
    else if (status) statusBullets.push(status);
    if (statusBullets.length === 0) {
      lines.push("*(데이터 없음)*");
    } else {
      statusBullets.forEach((s) => lines.push(`- ${s}`));
    }
    lines.push("");

    // 📚 수집 근거 — 출처 링크 (HTML src-chip 등가). Instagram 등 EXCLUDED는 제외.
    lines.push("**📚 수집 근거**");
    const evidence = (td?.evidence ?? []).filter((e) => !isExcluded(e.source));
    if (evidence.length === 0) {
      lines.push("*(수집된 evidence 없음)*");
    } else {
      evidence.forEach((e) => {
        const url = sourceUrl(e.source);
        const src = url ? `[${e.source}](${url})` : `**[${e.source}]**`;
        const period = e.period ? ` (${e.period})` : "";
        lines.push(`- ${src} — ${e.metric}${period} → ${e.value}`);
      });
    }
    lines.push("");

    lines.push(`**🎯 매칭이유 (오주연)**`);
    (r.summary_reasons ?? []).forEach((s) => lines.push(`- ${formatReason(s)}`));
    lines.push("");

    if (i < top.length - 1) {
      lines.push("---");
      lines.push("");
    }
  });

  lines.push("---");
  lines.push("");

  // Part III — Reference (이미지)
  lines.push("## 📌 Part III — Reference (오주연 담당)");
  lines.push("");
  lines.push("*이미지 시안 영역 — 추후 추가*");
  lines.push("");
  lines.push("---");
  lines.push("");

  // 데이터 소스
  lines.push("### 📎 데이터 소스");
  lines.push("");
  lines.push("| 영역 | 출처 파일 | 담당 |");
  lines.push("|---|---|---|");
  lines.push("| 브랜드/제품/타겟 | `brand-analysis.json` | 엄남경 |");
  lines.push("| 한 줄 요약 · 의미 · 유행현황 | `trend-analysis.json` | 이효희 (분석) |");
  lines.push("| 수집 근거 (출처별 원본) | `trend-analysis.json` evidence[] | 가지수 (수집) |");
  lines.push("| 매칭이유 · 추천 순위 | `match-result.json` | 오주연 |");
  lines.push("");
  lines.push("*LLM 호출 0회 — 순수 데이터 매핑으로 생성됨 (작성가 v1)*");
  lines.push("");

  return lines.join("\n");
}

// ─── writer-output.json v2 생성 (리포트 mockup 전용 단일 데이터 소스) ─
// 합의문: docs/writer-output-v2-spec.md (옵션 C)
// 형식: shared/schemas/writer-output.example.json
//
// 카피 필드(concept·headline·body_copy·key_message·mood·format_hint)는
// 모두 제거됨. mockup이 필요로 하는 리포트 메타데이터 필드만 출력.

// evidence source 한국어/영문 표기를 enum으로 정규화.
// naver blog(UGC)·naver news(기사)·naver_datalab(검색지수)은 출처 성격이 달라 별도 enum.
const SOURCE_ENUM = {
  "naver datalab": "naver_datalab",
  "naver_datalab": "naver_datalab",
  "naver": "naver_datalab",
  "네이버": "naver_datalab",
  "naver blog": "naver_blog",
  "naver_blog": "naver_blog",
  "네이버 블로그": "naver_blog",
  "naver news": "naver_news",
  "naver_news": "naver_news",
  "네이버 뉴스": "naver_news",
  "tavily": "tavily",
  "youtube": "youtube",
  "유튜브": "youtube",
};

function normalizeSource(source = "") {
  const key = String(source).trim().toLowerCase();
  return SOURCE_ENUM[key] ?? key;
}

// enum에 맞는 라벨 (UI 표시용)
const SOURCE_LABEL = {
  naver_datalab: "Naver Datalab",
  naver_blog: "Naver Blog",
  naver_news: "Naver News",
  tavily: "Tavily",
  youtube: "YouTube",
};

function targetDisplay(b) {
  const ages = b.target_display?.age_groups ?? b.target?.age_groups ?? [];
  const gender = b.target?.gender ?? "";
  const tone = (b.tone_and_manner ?? []).join("·");
  const demo = [ages.join("·"), gender].filter(Boolean).join(" ");
  return [demo, tone].filter(Boolean).join(" · ");
}

// 매칭가 v0.3 matching_grade(상/중/하/제외) → UI strength enum
function deriveStrength(grade) {
  if (grade === "상") return "strong";
  if (grade === "중") return "partial";
  return "weak";
}

// 매칭가가 기준명을 옛(ingred·visual·life) ↔ 신(product·tnm·target) 둘 중
// 어느 쪽으로 보내든 폴백으로 정규화. 매칭가 v0.4부터 safe-fit(=market_fit)은
// 생성 안 함 — 작성가도 더 이상 받지 않으니 정규화에서 제외.
function pickFit(fits, ...keys) {
  for (const k of keys) if (fits?.[k]) return fits[k];
  return null;
}
function normalizeFits(fits) {
  return {
    ingred: pickFit(fits, "ingred_fit", "product_fit"),
    visual: pickFit(fits, "visual_fit", "tnm_fit"),
    life: pickFit(fits, "life_fit", "target_fit"),
  };
}

// 3기준 result → 옛 question_1/question_2 passes 호환 매핑.
// q1=브랜드 적합성(ingred+visual, max 4 → 0/1/2 압축), q2=타겟 적합성(life 단일,
// FIT_POINT 그대로 0/1/2). safe(market_fit) 제거 후 q2는 단일 fit 직접 매핑.
const FIT_POINT = { "✅": 2, "⚠️": 1, "❌": 0 };
function legacyPasses(fits) {
  const n = normalizeFits(fits);
  const q1Raw = (FIT_POINT[n.ingred?.result] ?? 0) + (FIT_POINT[n.visual?.result] ?? 0);
  const compress = (s) => (s >= 4 ? 2 : s >= 2 ? 1 : 0);
  const q1 = compress(q1Raw);
  const q2 = FIT_POINT[n.life?.result] ?? 0;
  return { q1, q2, total: q1 + q2 };
}

// summary_bullets 룰베이스 생성:
// trend의 summary·meaning·status를 빈 값 제외하고 차례대로 array에 담음.
// LLM 없이 분석가가 만든 텍스트를 그대로 활용.
function buildSummaryBullets(td) {
  if (!td) return [];
  return [td.summary, td.meaning, td.status].filter(
    (x) => typeof x === "string" && x.trim().length > 0,
  );
}

// evidence: 분석가가 만든 원본을 v2 enum 형식으로 정규화
// Instagram 등 EXCLUDED_SOURCES는 트렌드 측이 보내와도 작성가가 출력에서 제외.
// value의 "N+" 표기는 expandNPlus로 "N건 이상" 자연 한국어로 풀어 씀.
function buildEvidence(td) {
  return (td?.evidence ?? [])
    .filter((e) => !isExcluded(e.source))
    .map((e) => {
      const src = normalizeSource(e.source);
      const value = expandNPlus(e.value);
      return {
        source: src,
        label: SOURCE_LABEL[src] ?? e.source,
        description: [e.metric, e.period ? `(${e.period})` : null, value]
          .filter(Boolean)
          .join(" "),
        url: e.url ?? sourceUrl(e.source) ?? null,
      };
    });
}

// channels: trend의 media_channel_status를 그대로 받되 빈 배열 fallback
// Instagram 등 EXCLUDED_SOURCES는 트렌드 측이 보내와도 작성가가 출력에서 제외.
function buildChannels(td) {
  return (td?.media_channel_status ?? [])
    .filter((c) => !isExcluded(c.media_channel ?? c.name))
    .map((c) => ({
      name: c.media_channel ?? c.name ?? "",
      status: c.status ?? "stable",
    }));
}

// ─── usage_plan 전용 채널 매핑 (트렌드 분석가 합의) ──────────────────
// 마케터 측 채널명을 트렌드가 쓰는 채널 식별자로 정규화. null은 비교 제외
// (자사몰·네이버 스토어·오프라인은 SNS·영상 트렌드와 비교 의미 없음).
const MARKETER_TO_TREND_CHANNEL = {
  "인스타그램": "instagram",
  "메타": "instagram", // 메타 = 인스타그램 모회사
  "유튜브": "youtube",
  "틱톡": "tiktok",
  "자사몰": null,
  "네이버 스토어": null,
  "네이버스토어": null,
  "오프라인 스토어": null,
  "오프라인": null,
  "카카오": null,
};

function mapMarketerChannel(name) {
  if (!name) return undefined; // 매핑 사전에 없는 채널 (외부에서 unknown 처리)
  if (name in MARKETER_TO_TREND_CHANNEL) return MARKETER_TO_TREND_CHANNEL[name];
  for (const [k, v] of Object.entries(MARKETER_TO_TREND_CHANNEL)) {
    if (name.includes(k)) return v;
  }
  return undefined;
}

// 마케터 측 채널을 트렌드 비교용 식별자로 정규화 — current_channels +
// media_channels 합쳐서 null(제외)·undefined(unknown)는 빼고 중복 제거.
function getEffectiveMarketerChannels(brand) {
  const all = [
    ...(brand?.current_channels ?? []),
    ...(brand?.media_channels ?? []),
  ];
  const mapped = all.map(mapMarketerChannel).filter((c) => typeof c === "string");
  return [...new Set(mapped)];
}

// 한글 단어가 3개 이상이거나 4어절 이상이면 서술형 value로 간주. 정량 지표가
// 아니라 수상·이벤트·라벨 등이라 그대로 박으면 어색.
function isDescriptiveMetricValue(value) {
  if (!value) return false;
  const tokens = String(value).split(/\s+/).filter(Boolean);
  if (tokens.length >= 4) return true;
  const hangulTokens = tokens.filter((t) => /[가-힣]/.test(t));
  if (hangulTokens.length >= 3) return true;
  return false;
}

// delta가 괄호로 둘러싸여 있거나 내부에 괄호를 포함하면 중첩 회피를 위해
// 외곽 괄호 벗기고 첫 괄호 앞까지만 사용. 비어 있으면 빈 문자열.
function cleanDelta(delta) {
  if (!delta) return "";
  let s = String(delta).trim();
  if (!s) return "";
  s = s.replace(/^\(+|\)+$/g, "").trim();
  const parenIdx = s.indexOf("(");
  if (parenIdx > 0) s = s.slice(0, parenIdx).trim();
  return s;
}

// ─── 수치 라벨 분리 (트렌드 분석가 7종 수치 데이터 정리) ─────────────
// 트렌드 분석가가 보내는 수치는 의미가 다른데 옛 코드는 한 라벨("검색량")로
// 뭉뚱그려서 노출하던 문제. 다음 셋으로 분리:
//
//   1. 검색 추이 지수 (0~100 상대값) ← metrics.score + growth_rate
//      "검색 추이 지수 82 (+25%)"
//   2. 월간 검색량 (절대 건수)        ← demand_fit.monthly_searches
//      "월간 검색량 1,890건"
//   3. 헤드라인 서술 (수상·이벤트 등)  ← headline_metric (서술형 value)
//      "신제품 출시 사례: 수야 서울 센트 오일 컬렉션"
//
// 셋 다 카드마다 다를 수 있어 별도 라벨로 노출. invalid_keyword 시 월간 검색량
// 스킵 (트렌드 분석가가 검색어 부적합 표시).

// 검색 추이 지수 — metrics.score(0~100) + growth_rate로 합성. score가 숫자가
// 아니면 null. 증감률이 0이거나 없으면 단독 표시.
function buildIndexPhrase(td) {
  const score = td?.metrics?.score;
  if (typeof score !== "number") return null;
  const rate = td?.metrics?.growth_rate;
  if (typeof rate === "number" && Math.round(rate * 100) !== 0) {
    const pct = Math.round(rate * 100);
    const sign = pct > 0 ? "+" : "";
    return `검색 추이 지수 ${score} (${sign}${pct}%)`;
  }
  return `검색 추이 지수 ${score}`;
}

// 월간 검색량 — demand_fit.monthly_searches(절대 건수). invalid_keyword 트루
// 또는 0 이하면 스킵. 천 단위 구분자(ko-KR locale) 적용해 가독성 ↑.
function buildSearchVolumePhrase(td) {
  const df = td?.demand_fit;
  if (!df || df.invalid_keyword === true) return null;
  const ms = df.monthly_searches;
  if (typeof ms !== "number" || ms <= 0) return null;
  return `월간 검색량 ${ms.toLocaleString("ko-KR")}건`;
}

// 헤드라인 서술 — headline_metric.value가 서술형(수상·이벤트·신제품 등)일
// 때만 노출. 숫자 인덱스는 buildIndexPhrase가 담당하므로 여기서는 제외.
// "{metric}: {value}" 형식 (예: "신제품 출시 사례: 수야 서울 센트 오일 컬렉션").
// "N+" 표기는 expandNPlus로 풀어 씀.
function buildHeadlineDescriptionPhrase(td) {
  const hm = td?.headline_metric ?? {};
  const raw = String(hm?.value ?? "").trim();
  if (!raw) return null;
  if (!isDescriptiveMetricValue(raw)) return null;
  const value = expandNPlus(raw);
  const label = String(hm?.metric ?? "").trim();
  return label ? `${label}: ${value}` : value;
}

// "30+", "30+ 개" → "30건 이상" 변환. evidence value, 매칭가 reason, usage_plan
// 어느 자리에서든 깔끔히 풀어쓰도록 텍스트 단위 헬퍼.
// "(+22%)" 같은 패턴은 회피 (숫자 앞에 + 위치).
function expandNPlus(text) {
  if (!text) return text;
  // "30+ 개" / "30+개" — "개" 흡수해서 "건 이상"으로 통일
  let result = String(text).replace(/(\d+)\+\s*개(?=\s|$|[,.!?…·)\]가-힣])/g, "$1건 이상");
  // 일반 "30+" — 한글·공백·구두점이 따라올 때만 (영문/숫자 다음은 안 건드림)
  result = result.replace(/(\d+)\+(?=\s|$|[,.!?…·)\]가-힣])/g, "$1건 이상");
  return result;
}

// ─── usage_plan 코드 템플릿 (LLM 호출 없음) ─────────────────────────
// 원칙: 트렌드가 채널 evidence(media_channel_status[i].status)를 채워서 보내고
// 마케터가 채널·KPI를 입력으로 주므로 작성가는 두 데이터를 결정적으로 합성만 함.
// LLM 불필요.
//
// 데이터 매핑:
//   - top_channel  ← trend.media_channel_status[]에서 마케터 채널과 겹치는 첫 항목
//                   (없으면 트렌드의 첫 정규화 가능 채널)
//   - evidence     ← 그 항목의 status 텍스트 (트렌드 분석가가 채워둠)
//   - 마케터 채널  ← brand.current_channels + media_channels (매핑 후 정규화)
//
// 출력 템플릿 (사양):
//   잘 맞음 케이스: "[{top_channel} 활성] {evidence}. 지금 채널과 잘 맞습니다."
//   확장 케이스:   "[{top_channel} 활성] {evidence}. {마케터 채널} 외 {top_channel} 확장도 고려해보세요."

const TREND_CHANNEL_KEYS = [
  { key: "youtube", needles: ["youtube", "유튜브"] },
  { key: "instagram", needles: ["instagram", "인스타"] },
  { key: "tiktok", needles: ["tiktok", "틱톡"] },
];
const CHANNEL_LABEL = {
  youtube: "유튜브",
  instagram: "인스타그램",
  tiktok: "틱톡",
};

// 한 항목(`media_channel_status[i]`)을 정규 채널 키 배열로. "Instagram/TikTok"
// 처럼 두 채널이 한 항목에 묶여 있을 수 있어 needle 매칭으로 양쪽 다 잡음.
function normalizeChannelItem(item) {
  const raw = String(item?.media_channel ?? item?.name ?? "").toLowerCase();
  const keys = [];
  for (const { key, needles } of TREND_CHANNEL_KEYS) {
    if (needles.some((n) => raw.includes(n))) keys.push(key);
  }
  return {
    keys,
    status: String(item?.status ?? "").trim(),
    rawName: item?.media_channel ?? item?.name ?? "",
  };
}

// KPI별 콘텐츠 형식 — 문장 합성용 명사구 (조사 "로/으로"는 buildUsagePlan에서).
// rank 미지정/순위 0 같은 폴백 케이스에서 사용.
const KPI_CONTENT = {
  "신제품 런칭": "30초 숏폼 언박싱과 첫 사용 후기 콘텐츠",
  "시즌 프로모션": "시즌 루틴·한정 할인 메시지",
  "재구매 유도": "공병 후기·데일리 루틴 콘텐츠",
};

// rank별 활용 강도 라벨 — 카드 1·2·3순위에 맞춰 액션 톤 차별화.
//   1순위 → 핵심 캠페인 (주력 집행)
//   2순위 → 보조 콘텐츠 (보강 활용)
//   3순위 → 테스트 콘텐츠 (가벼운 시도)
const RANK_TIER_LABEL = {
  1: "핵심 캠페인",
  2: "보조 콘텐츠",
  3: "테스트 콘텐츠",
};

// KPI × rank → 카드별 콘텐츠 형식. 카드마다 활용 방안 두 번째 문장의 액션
// 표현이 달라지도록. 미매칭 케이스는 KPI_CONTENT 폴백.
const KPI_CONTENT_BY_RANK = {
  "신제품 런칭": {
    1: "30초 숏폼 언박싱·첫 사용 후기 중심 콘텐츠",
    2: "첫 사용 후기 카루셀로 함께 활용",
    3: "숏폼 한 편 가볍게 활용",
  },
  "시즌 프로모션": {
    1: "시즌 루틴·한정 할인 메시지 중심 콘텐츠",
    2: "시즌 루틴 카루셀 보강",
    3: "가볍게 시즌 메시지 활용",
  },
  "재구매 유도": {
    1: "공병 후기·데일리 루틴 콘텐츠 중심",
    2: "데일리 루틴 콘텐츠 보강",
    3: "가볍게 공병 후기 한 편 활용",
  },
};

// 카드 순위·KPI에 맞는 tier 라벨과 콘텐츠 명사구 반환.
// 순위 정보 없거나 1·2·3 외 값이면 2순위(중간 액션)로 폴백.
// KPI가 KPI_CONTENT_BY_RANK에 없으면 KPI_CONTENT 일반 매핑으로 폴백.
function getKpiContentByRank(kpi, rank) {
  const r = rank === 1 || rank === 2 || rank === 3 ? rank : 2;
  const tier = RANK_TIER_LABEL[r];
  const tableContent = KPI_CONTENT_BY_RANK[kpi]?.[r] ?? null;
  const content = tableContent ?? KPI_CONTENT[kpi] ?? null;
  return { tier, content };
}

// 카드별 evidence 한 줄 — td.evidence[]의 첫 항목에서 "{출처}에서 {value/metric}"
// 형식으로 단문 합성. Instagram 등 EXCLUDED_SOURCES는 제외. "N+" 표기는
// expandNPlus로 "N건 이상" 풀어 씀. 데이터 없으면 null.
function buildEvidenceSnippet(td) {
  const list = (td?.evidence ?? []).filter((e) => !isExcluded(e?.source));
  if (list.length === 0) return null;
  const first = list[0];
  const src = normalizeSource(first.source);
  const label = SOURCE_LABEL[src] ?? first.source ?? null;
  const body = expandNPlus(
    (first.value || first.metric || "").toString().trim(),
  );
  if (!body) return null;
  if (!label) return body;
  return `${label}에서 ${body}`;
}

// 트렌드 단계(trend_stage) → 자연 한국어 라벨
const STAGE_LABEL = {
  emerging: "성장세",
  peak: "정점",
  declining: "하락기",
};

// 기간/예산 조합 → 트렌드 활용 성격 명사구. period 단독 매핑이 우선이고
// "한달"만 budget 갈래 둘로 분기. (조사 "로"는 buildUsagePlan에서 붙임)
function mapPeriodBudget(period, budget) {
  if (period === "1주") return "단기 빠른 진입형 트렌드";
  if (period === "3개월") return "중기 안정형 트렌드";
  if (period === "1년") return "장기 안정형 트렌드";
  if (period === "한달") {
    if (budget === "200만원 미만" || budget === "200~500만원") {
      return "단기 효율형 트렌드";
    }
    if (budget === "500~1000만원" || budget === "1000만원 초과") {
      return "단기 화제 트렌드";
    }
    return null; // 한달인데 예산 미상 → 매핑 생략 (시스템 안전)
  }
  return null;
}

// 시의성 멘트 — trend_stage·growth_rate 기반 카드별 한 줄 단서. 매칭 적합도와
// 별개인 "트렌드 수명/추세" 신호로 마케터에게 집행 타이밍 힌트 제공.
//
// 우선순위 (위에서부터 매칭):
//   1. growth_rate < -0.5 (-50% 미만 급락) → 짧은 캠페인 권장 — stage보다 강한 신호
//   2. trend_stage === "declining"        → 보완 활용 권장
//   3. trend_stage === "peak"              → 빠른 집행 권장
//   4. trend_stage === "emerging"/"growing" → 안정적 진입 가능
//   5. 그 외(데이터 없음·기타) → null (멘트 생략)
//
// "emerging"·"growing" 둘 다 받음 — 트렌드 분석가가 둘 중 어느 표기로 보내든 흡수.
function buildTimingNote(td) {
  const rate = td?.metrics?.growth_rate;
  const stage = td?.trend_stage;
  if (typeof rate === "number" && rate < -0.5) {
    return "급격한 하락세라 짧은 캠페인 권장";
  }
  if (stage === "declining") {
    return "쇠퇴기에 접어드는 중이라 보완해서 활용 권장";
  }
  if (stage === "peak") {
    return "피크를 찍는 중이라 빠르게 집행 권장";
  }
  if (stage === "emerging" || stage === "growing") {
    return "성장세 흐름이라 안정적 진입 가능";
  }
  return null;
}

// 트렌드 수명 한 줄 — stage 라벨 + lifespan_estimate 조합. 한쪽만 있어도 출력.
function buildLifespanPhrase(td) {
  const stage = STAGE_LABEL[td?.trend_stage] ?? null;
  const lifespan = td?.lifespan_estimate;
  if (stage && lifespan) return `${stage}이며 ${lifespan} 흐름`;
  if (stage) return `${stage} 단계`;
  if (lifespan) return `${lifespan} 흐름`;
  return null;
}

// 트렌드 키워드 따옴표 묶음 — 처음 N개를 'kw' 형식으로
function buildKeywordPhrase(td, n = 3) {
  const kws = (td?.keywords ?? [])
    .filter((k) => typeof k === "string" && k.trim().length > 0)
    .slice(0, n);
  if (kws.length === 0) return null;
  return kws.map((k) => `'${k}'`).join(", ");
}

// 카드별 차별점 한 줄 — 같은 결의 트렌드가 여러 카드에 함께 추천될 때
// "비슷해 보임" 문제를 차이를 드러내 해소. 매칭가는 브랜드 적합성으로
// 정확하게 골랐고(같은 계열이 위로 오는 게 정상), 작성가가 카드끼리 다른
// 키워드를 표면화해 마케터가 선택지를 식별할 수 있게 해줌.
//
// 로직: 각 카드의 keywords 배열에서 *다른 카드들엔 없는 첫 키워드*를 추출.
//       fallback: 모든 키워드가 다른 카드와 겹치면 null (진짜 분리 신호 없음 —
//       억지 라벨링 회피).
// 출력 형식: "{고유 키워드} 중심"  예) "립오일 중심", "럭셔리 오일 중심"
function buildDistinction(allKeywordArrays, myIndex) {
  const myKws = (allKeywordArrays[myIndex] ?? []).filter(
    (k) => typeof k === "string" && k.trim().length > 0,
  );
  if (myKws.length === 0) return null;
  if (allKeywordArrays.length <= 1) {
    return myKws[0] ? `${myKws[0]} 중심` : null;
  }
  const others = new Set();
  for (let i = 0; i < allKeywordArrays.length; i++) {
    if (i === myIndex) continue;
    for (const k of allKeywordArrays[i] ?? []) {
      if (typeof k === "string") others.add(k.toLowerCase());
    }
  }
  const unique = myKws.find((kw) => !others.has(kw.toLowerCase()));
  return unique ? `${unique} 중심` : null;
}

// usage_plan 한 단락 합성. 다섯 정보를 세 문장으로 자연스럽게 결합. 카드별
// 차별화를 위해 evidence 한 줄과 rank별 액션 톤을 함께 받음:
//   문장 1) 트렌드 현황 — [채널 활성] + 카드별 evidence + 트렌드 수명 + 검색량
//   문장 2) 행동 제안   — rank tier + KPI 톤 + 키워드 강조 + KPI 콘텐츠 + 채널 비교
//   문장 3) 기간/예산   — 마케터 기간·예산 → 트렌드 활용 성격
//
// rank별 차별화:
//   - 같은 KPI라도 1순위=핵심 캠페인 / 2순위=보조 콘텐츠 / 3순위=테스트 콘텐츠
//   - 카드별 evidence(td.evidence[0])가 sentence 1에 들어가 카드마다 첫 줄이 다름
//
// 데이터가 비면 해당 부분/문장 생략 (시스템 안전, 어색한 빈 자리 X).
//
// 결과 예:
//   "[유튜브 활성] Naver News에서 매트 쿠션 비교 영상 22% 증가, 정점이며 6개월 이상 흐름.
//    핵심 캠페인으로 시즌 프로모션에 맞춰 '세미매트', '쿠션' 키워드 중심의 시즌 루틴·한정
//    할인 메시지 중심 콘텐츠, 인스타그램 외 유튜브 확장 추천.
//    한달 + 200만원 미만 예산이라 단기 효율형 트렌드로 활용 가능."
function buildUsagePlan(brand, td, opts = {}) {
  if (!td?.trend_name) return "";
  const rank = opts?.rank;
  // suppressIndex: 같은 metrics.score+growth_rate가 앞 카드에 이미 나왔으면
  // 두 번째 이상 카드에서 검색 추이 지수 라벨 생략 (같은 키워드 그룹의 중복
  // 노출 방지). 호출자에서 카드 순서대로 dedup 키 누적해 전달.
  const suppressIndex = opts?.suppressIndex === true;

  // ─ 채널 비교 ────────────────────────────────────────────────────
  const marketer = getEffectiveMarketerChannels(brand);
  const items = Array.isArray(td?.media_channel_status)
    ? td.media_channel_status.map(normalizeChannelItem).filter((x) => x.keys.length > 0)
    : [];

  // 보강: channel_activity(Apify 결과)에서 인스타·틱톡 보완. media_channel_status에
  // 누락된 채널만 추가 — 트렌드 분석가가 두 필드를 분리해서 저장하는 케이스 흡수.
  const pools = Array.isArray(td?.channel_activity) ? td.channel_activity : [];
  if (pools.length > 0) {
    const existingKeys = new Set(items.flatMap((x) => x.keys));
    for (const pool of pools) {
      const scores = pool?.scores ?? {};
      for (const ch of ["instagram", "tiktok", "youtube"]) {
        if (existingKeys.has(ch)) continue; // 이미 media_channel_status에 있음
        const data = scores[ch];
        if (!data) continue;
        // score 0이어도 evidence가 있으면 포함 ("없다" 단정 금지 규칙)
        if (!data.evidence && (data.score ?? 0) <= 0) continue;
        items.push({
          keys: [ch],
          status: data.evidence || `${CHANNEL_LABEL[ch]} 관련 콘텐츠 활발`,
          rawName: CHANNEL_LABEL[ch] ?? ch,
        });
        existingKeys.add(ch); // 이후 pool에서 중복 추가 방지
      }
    }
  }

  let channelTag = null; // "[유튜브 활성]"
  let channelEvidence = null; // status 텍스트
  let channelAction = null; // "지금 채널과 잘 맞으니 강화" / "X 외 Y 확장 추천"

  if (items.length > 0) {
    let matched = null;
    let matchedKey = null;
    if (marketer.length > 0) {
      for (const item of items) {
        const k = item.keys.find((k) => marketer.includes(k));
        if (k) { matched = item; matchedKey = k; break; }
      }
    }
    if (matched) {
      const channel = CHANNEL_LABEL[matchedKey] ?? matched.rawName;
      channelTag = `[${channel} 활성]`;
      channelEvidence = matched.status || null;
      channelAction = "지금 채널과 잘 맞으니 강화 추천";
    } else {
      // 확장 — 트렌드 첫 활성 채널로 확장 제안
      const first = items[0];
      const firstKey = first.keys[0];
      const channel = CHANNEL_LABEL[firstKey] ?? first.rawName;
      channelTag = `[${channel} 활성]`;
      channelEvidence = first.status || null;
      if (marketer.length > 0) {
        const marketerLabels = marketer
          .map((k) => CHANNEL_LABEL[k])
          .filter(Boolean)
          .join("·");
        channelAction = `${marketerLabels} 외 ${channel} 확장 추천`;
      }
      // marketer가 0건이면 channelAction 그대로 null — 행동 제안에서 채널 비교 부분 생략
    }
  }

  // ─ 보조 정보 ────────────────────────────────────────────────────
  const lifespanPhrase = buildLifespanPhrase(td); // "정점이며 6개월 이상 흐름"
  const keywordPhrase = buildKeywordPhrase(td);   // "'세미매트', '쿠션'"
  const kpiTone = brand?.campaign_kpi ?? null;    // "시즌 프로모션"
  // rank별 tier 라벨 + 콘텐츠 명사구 (1순위=핵심, 2=보조, 3=테스트). KPI 미매칭은
  // KPI_CONTENT 일반 매핑으로 폴백, 순위 미지정은 2순위(중간) 폴백.
  const { tier: rankTier, content: kpiContent } = getKpiContentByRank(kpiTone, rank);
  const pbLabel = mapPeriodBudget(brand?.campaign_period, brand?.campaign_budget); // "단기 효율형 트렌드"
  // 카드별 evidence 한 줄 — sentence 1에 들어가 카드마다 첫 줄이 다르게.
  const evidenceSnippet = buildEvidenceSnippet(td);

  // 수치 라벨 분리 — 검색 추이 지수·월간 검색량·헤드라인 서술 셋으로 노출.
  // 옛 buildMetricPhrase(headline_metric 단일)에서 분리 (라벨 분리 작업).
  // suppressIndex 시 indexPhrase 생략 — 앞 카드에 이미 같은 지수 노출됨.
  const indexPhrase = suppressIndex ? null : buildIndexPhrase(td);
  const volumePhrase = buildSearchVolumePhrase(td);  // "월간 검색량 1,890건"
  const headlineDesc = buildHeadlineDescriptionPhrase(td); // "신제품 출시 사례: ..."
  // 시의성 멘트 — trend_stage·growth_rate 기반 집행 타이밍 힌트. lifespan
  // 바로 옆에 자연스럽게 녹이기 위해 sentence 1 마지막에 배치.
  const timingNote = buildTimingNote(td);

  // ─ 문장 1: 트렌드 현황 ──────────────────────────────────────────
  // "[채널 활성] {카드별 evidence | 채널 evidence}, {지수}, {월간 검색량},
  //  {헤드라인 서술}, {수명}, {시의성 멘트}"
  // evidenceSnippet(td.evidence[0])이 있으면 카드별 차별화 키 — 우선 사용.
  // 없으면 channelEvidence(채널 레벨)로 폴백. 수치 셋은 의미가 다르므로
  // 각자 라벨 붙은 채로 콤마 join. 시의성 멘트는 가장 뒤에 — 트렌드 현황
  // 다 보고 마지막에 "그래서 어떻게 집행하면 좋은가" 신호로 마무리.
  let sentence1 = null;
  const opener = evidenceSnippet ?? channelEvidence;
  const sentence1Parts = [opener, indexPhrase, volumePhrase, headlineDesc, lifespanPhrase, timingNote];
  if (channelTag) {
    const tail = sentence1Parts.filter(Boolean).join(", ");
    sentence1 = tail ? `${channelTag} ${tail}` : channelTag;
  } else {
    const parts = sentence1Parts.filter(Boolean);
    if (parts.length > 0) sentence1 = parts.join(", ");
  }

  // ─ 문장 2: 행동 제안 (rank 차별화) ───────────────────────────────
  // "{tier}로 {KPI 톤}에 맞춰 {키워드 강조} {KPI 콘텐츠}, {채널 비교}"
  // channelAction이 이미 "추천"으로 끝나면 그대로, 없으면 끝에 " 추천" 추가.
  let sentence2 = null;
  if (rankTier || kpiTone || kpiContent || channelAction) {
    const tierPart = rankTier ? `${rankTier}로` : null;
    const kpiPart = kpiTone ? `${kpiTone}에 맞춰` : null;
    const kwPart = keywordPhrase ? `${keywordPhrase} 키워드 중심의` : null;
    const contentPart = kpiContent ?? null;
    const head = [tierPart, kpiPart, kwPart, contentPart].filter(Boolean).join(" ");
    if (head && channelAction) {
      // 두 의미 다 살리되 중복 "추천" 방지 — head 뒤에 콤마로 channelAction 붙임.
      sentence2 = `${head}, ${channelAction}`;
    } else if (head) {
      sentence2 = head.endsWith("추천") ? head : `${head} 추천`;
    } else if (channelAction) {
      sentence2 = channelAction;
    }
  }

  // ─ 문장 3: 기간/예산 ───────────────────────────────────────────
  // "{기간} + {예산} 예산이라 {pb}로 활용 가능"
  let sentence3 = null;
  if (pbLabel) {
    const p = brand?.campaign_period;
    const b = brand?.campaign_budget;
    if (p && b) {
      sentence3 = `${p} + ${b} 예산이라 ${pbLabel}로 활용 가능`;
    } else {
      sentence3 = `${pbLabel}로 활용 가능`;
    }
  }

  // 세 문장을 줄바꿈으로 분리해 출력 (최대 3줄). 데이터 비어 있는 문장은 자동 생략.
  // 한 줄에 한 문장씩 들어가게 ".\n"으로 join — 마지막 문장도 마침표 한 번씩.
  // 받침 기반 조사 보정 마지막 적용 — "캠페인로" → "캠페인으로" 등 교정.
  const sentences = [sentence1, sentence2, sentence3].filter(Boolean);
  if (sentences.length === 0) return "";
  return sentences.map((s) => fixKoreanParticles(`${s}.`)).join("\n");
}

// ─── LLM 카드 풍부화 (디자인 담당 합의) ────────────────────────────
// 콘텐츠 카드 1장당 LLM 1회 호출로 다음 3가지를 한 번에 만든다:
//   1) fit_reasons.{ingred,visual,life,safe} — 매칭가 raw reason + 트렌드 수치
//      를 합쳐 정량적 설득력 있는 한 줄로 다듬기
//   2) usage_plan — 트렌드 + 마케터 매체·타겟·KPI로 행동 제안 한 줄
//   3) summary_bullets — 기존 분석체 bullets를 구어체로 다듬기 (내용 유지)
// 실패 시 raw 값 그대로 유지 — 시스템이 안 무너지게.

const ContentEnrichmentSchema = z.object({
  fit_reasons: z.object({
    ingred: z.string(),
    visual: z.string(),
    life: z.string(),
  }),
  usage_plan: z.string(),
  summary_bullets: z.array(z.string()).min(1).max(5),
});

const ENRICH_SYSTEM_PROMPT = `당신은 마케팅 리포트 카드의 카피를 다듬는 사람입니다.
주어진 데이터만 활용해 풍부하게 다듬되, 환각·새 사실 추가는 금지.

3가지 작업:

1. fit_reasons.{ingred,visual,life} — 매칭가 3기준의 raw reason과 트렌드 수치(headline_metric·growth_rate)를 합쳐 정량적으로 설득되는 한 줄로 다듬기.
   예: "검색량 47.4(+22%)로 떠오른 매트 트렌드가 브랜드 매트 제형과 직결돼 적합도가 높습니다."

2. usage_plan — 트렌드 + 마케터 매체(current_channels)·타겟·KPI를 보고 구체적 행동 제안 한 줄.
   예: "인스타 릴스로 매트 쿠션 결 살리기 챌린지를 열어 20대 타겟에 도달."

3. summary_bullets — 기존 분석체 bullets를 구어체로 다듬기. 내용 그대로, 표현만 부드럽게.
   예: "~로 자리 잡고 있다" → "요즘 ~가 대세예요"

스타일 규칙:
- 매번 같은 입력엔 같은 출력 (temperature 낮게).
- 데이터에 없는 수치·사실 만들지 말 것.
- 한국어, 한 문장 또는 짧은 두 문장 이내.`;

async function enrichContent({ rawContent, td, brand, matchEval, client }) {
  if (!client) return null;
  const fits = matchEval?.evaluation ?? {};
  const n = normalizeFits(fits);
  if (!n.ingred && !n.visual && !n.life) {
    return null; // 매칭 데이터 없으면 LLM 건너뜀
  }

  const hm = td?.headline_metric ?? {};
  const userMessage = `## 매칭가 3-Fit 판정 (raw)
- Ingred: ${n.ingred?.result ?? "-"} — ${n.ingred?.reason ?? "(없음)"}
- Visual: ${n.visual?.result ?? "-"} — ${n.visual?.reason ?? "(없음)"}
- Life: ${n.life?.result ?? "-"} — ${n.life?.reason ?? "(없음)"}
- 매칭 점수: ${matchEval?.score ?? "-"}/6
- 매칭 등급: ${matchEval?.matching_grade ?? "-"}

## 트렌드 정보
- 이름: ${td?.trend_name ?? "-"}
- 키워드: ${(rawContent?.keywords ?? []).join(", ") || "-"}
- 대표 지표: ${hm.metric ?? "-"} ${hm.value ?? ""}${hm.delta ? ` (${hm.delta})` : ""}
- 증가율: ${td?.metrics?.growth_rate != null ? `+${(td.metrics.growth_rate * 100).toFixed(0)}%` : "-"}
- 기간: ${td?.metrics?.period ?? "-"}
- 의미(meaning): ${td?.meaning ?? "-"}
- 유행현황(status): ${td?.status ?? "-"}
- 기존 summary_bullets (분석체):
${(rawContent?.summary_bullets ?? []).map((s) => "  - " + s).join("\n") || "  (없음)"}

## 마케터 정보
- 브랜드: ${brand?.brand_name ?? "-"} / ${brand?.product_name ?? "-"}
- 타겟: ${brand?.target?.gender ?? ""} ${(brand?.target?.age_groups ?? []).join("·")} ${(brand?.tone_and_manner ?? []).join("·")}
- 활용 매체(current_channels): ${(brand?.current_channels ?? []).join(", ") || "(없음)"}
- 캠페인 KPI: ${brand?.campaign_kpi ?? "-"}

위 데이터로 3가지 작업 수행. JSON으로만 반환.`;

  try {
    const response = await client.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      temperature: 0.3,
      system: [
        { type: "text", text: ENRICH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(ContentEnrichmentSchema) },
    });
    recordUsage("writer", response.usage, "claude-haiku-4-5");
    return response.parsed_output ?? null;
  } catch (err) {
    console.warn(`⚠️ enrichContent 실패 (${td?.trend_name ?? "?"}): ${err.message}`);
    return null;
  }
}

// ─── match_reasons.detail 코드 템플릿 합성 (LLM 호출 없음) ───────────
// 매칭가 raw reason + 트렌드 수치(headline_metric.value + growth_rate)를
// 자연스러운 한국어 문장으로 결합. 환각 위험 0, 비용 0, 결정적.
//
// 출력 형식:
//   "검색량이 {N}건 이상이고 {X}% 증가하며 떠오르는 트렌드예요. {매칭가 raw reason}"
// 트렌드 수치 없으면 raw reason만. 매칭가 raw reason 없으면 빈 문자열.

// growth_rate(0.22) → "+22%" / -0.05 → "-5%". null/undefined면 null 반환.
function formatGrowthRate(rate) {
  if (rate == null || typeof rate !== "number") return null;
  const pct = Math.round(rate * 100);
  const sign = pct >= 0 ? "+" : ""; // 음수면 toString이 이미 - 붙임
  return `${sign}${pct}%`;
}

// 트렌드 수치를 자연스러운 한국어 문장으로 풀어 쓴다. match_reasons.detail의
// prefix로 쓰임. 라벨 분리 작업 이후 우선순위:
//   1순위: metrics.score(검색 추이 지수, 0~100) + growth_rate → "검색 추이 지수가
//          82이고 25% 증가하며 떠오르는 트렌드예요."
//   2순위: demand_fit.monthly_searches → "네이버 월간 검색량 1,890건 수준이에요."
//          (1순위 문장과 함께 나올 수 있음 — 둘 다 있으면 두 문장 join)
//   3순위 폴백: headline_metric.value (서술형·정성)
//
// 옛 parseSearchVolumeValue/headline_metric.value 파싱은 폐기 — metrics.score가
// 항상 numeric 0~100으로 일관되어 더 안정적.

// rate 단독 풀어쓰기 — 증가/감소/유지 분기.
function formatRateSentence(rate) {
  const pct = Math.round(rate * 100);
  const absPct = Math.abs(pct);
  if (pct > 0) return `${absPct}% 증가하며 떠오르는 트렌드예요.`;
  if (pct < 0) return `${absPct}% 감소했지만 안정적으로 자리잡은 트렌드예요.`;
  return null; // 0%는 굳이 안 표시
}

// 검색 추이 지수 한 문장 — metrics.score + 선택적 growth_rate.
function buildIndexSentence(td) {
  const score = td?.metrics?.score;
  if (typeof score !== "number") return null;
  const rate = td?.metrics?.growth_rate;
  if (typeof rate === "number" && Math.round(rate * 100) !== 0) {
    const pct = Math.round(rate * 100);
    const absPct = Math.abs(pct);
    if (pct > 0) return `검색 추이 지수가 ${score}이고 ${absPct}% 증가하며 떠오르는 트렌드예요.`;
    return `검색 추이 지수가 ${score}이고 ${absPct}% 감소했지만 안정적으로 자리잡은 트렌드예요.`;
  }
  return `검색 추이 지수가 ${score}이에요.`;
}

// 네이버 월간 검색량 한 문장 — demand_fit.monthly_searches.
// invalid_keyword 트루면 스킵 (트렌드 분석가가 검색어 부적합 표시).
function buildVolumeSentence(td) {
  const df = td?.demand_fit;
  if (!df || df.invalid_keyword === true) return null;
  const ms = df.monthly_searches;
  if (typeof ms !== "number" || ms <= 0) return null;
  return `네이버 월간 검색량 ${ms.toLocaleString("ko-KR")}건 수준이에요.`;
}

function buildMetricPrefixSentence(td) {
  const sentences = [];

  // 1) 검색 추이 지수 — metrics.score 우선
  const indexSent = buildIndexSentence(td);
  if (indexSent) {
    sentences.push(indexSent);
  } else {
    // score 없으면 growth_rate 단독 시도
    const rate = td?.metrics?.growth_rate;
    if (typeof rate === "number") {
      const r = formatRateSentence(rate);
      if (r) sentences.push(r);
    }
  }

  // 2) 네이버 월간 검색량 — 따로 노출 (의미 다르므로)
  const volumeSent = buildVolumeSentence(td);
  if (volumeSent) sentences.push(volumeSent);

  // 1·2 둘 다 못 만들면 headline_metric 서술 폴백
  if (sentences.length === 0) {
    const value = td?.headline_metric?.value;
    const metric = td?.headline_metric?.metric;
    const hasValue = value != null && String(value).trim().length > 0;
    if (!hasValue) return null;
    const valueStr = String(value).trim();
    if (typeof metric === "string" && /활성/.test(metric) && valueStr.length <= 10) {
      sentences.push(`이 카테고리의 ${metric}이 ${valueStr}으로 활발해요.`);
    } else if (/^(매우\s*)?(높음|높은|중간|보통|낮음|낮은)$/.test(valueStr)) {
      const tag = metric || "트렌드 신호";
      if (/높/.test(valueStr)) sentences.push(`${tag}이 ${valueStr}으로 강하게 잡히고 있어요.`);
      else if (/중간|보통/.test(valueStr)) sentences.push(`${tag}이 ${valueStr} 수준으로 관찰돼요.`);
      else sentences.push(`${tag}이 ${valueStr}으로 약해진 상태예요.`);
    } else if (metric) {
      sentences.push(`${metric}: ${valueStr}.`);
    } else {
      sentences.push(`${valueStr}.`);
    }
  }

  return sentences.length > 0 ? sentences.join(" ") : null;
}

// 각 기준의 detail 문장 합성. 코드 템플릿만 사용 (LLM 호출 X).
// 매칭가가 영문 필드명(ingred·product_features 등)을 섞어 보내면
// naturalizeMatcherText()가 자연 한글로 치환. 빈/공백·단독 부호는 빈 문자열 반환,
// 끝에 종결부호 없으면 자동 보정.
function buildMatchReason(fitData, td) {
  const rawReason = fitData?.reason;
  if (!rawReason || !String(rawReason).trim()) return "";
  const polished = String(naturalizeMatcherText(rawReason) ?? "").trim();
  const sentence = buildMetricPrefixSentence(td);
  // polished가 비어 있으면 sentence 단독 (있을 때만)
  if (!polished) return sentence ?? "";
  const merged = sentence ? `${sentence} ${polished}` : polished;
  const trimmed = merged.trim();
  if (!trimmed) return "";
  return /[.。!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// ─── match_reasons 통합 구조 (LLM 없음, 결정적) ─────────────────────
// 옛 reason_bullets(매칭이유 3줄) + match_fits.reason(매칭기준 detail)이
// 같은 트렌드 매칭을 두 번 보여주던 중복을 1개 영역으로 통합.
// 3개 항목 = product_fit(ingred) · tnm_fit(visual) · target_fit(life).
// market_fit(safe)는 시장성 참고 지표라 제외 (매칭가 정의 그대로).
const MATCH_REASON_CATEGORIES = [
  { id: 1, fitKey: "ingred", title: "제품·제형이 트렌드와 맞는가" },
  { id: 2, fitKey: "visual", title: "브랜드 매체·톤이 트렌드와 맞는가" },
  { id: 3, fitKey: "life", title: "타겟 고객층이 트렌드와 맞는가" },
];

function buildMatchReasons(reasonBullets, mergedFits, td) {
  return MATCH_REASON_CATEGORIES.map((cat, i) => {
    const fit = mergedFits?.[cat.fitKey];
    return {
      id: cat.id,
      title: cat.title,
      summary: reasonBullets?.[i] ?? "",
      detail: fit?.reason ?? "",
      result: fit?.result ?? "",
    };
  });
}

export async function generateWriterOutput({ brand, trend, match } = {}) {
  const b = unwrap(brand);
  const t = unwrap(trend);
  const m = unwrap(match);

  const top = m.recommendations ?? [];
  const evaluations = m.evaluations ?? [];
  const findTrend = (name) => (t.trends ?? []).find((x) => x.trend_name === name);
  const findEval = (name) => evaluations.find((e) => e.trend_name === name);

  // LLM 클라이언트 — ANTHROPIC_API_KEY 없으면 풍부화 단계 자동 스킵.
  const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  // 1) 카드 raw 생성 (LLM 호출 없음, 순수 매핑)
  const rawContents = top.map((r, i) => {
    const td = findTrend(r.trend_name);
    const ev = findEval(r.trend_name);
    const fits = ev?.evaluation ?? {};

    return {
      content_id: `C${String(i + 1).padStart(3, "0")}`,
      trend_name: r.trend_name,
      rank: r.rank,
      verdict: `${r.rank}순위`, // recommendations에 들어왔으면 N순위 (제외 트렌드는 애초에 없음)
      matching_grade: ev?.matching_grade ?? "중", // 매칭가 v0.3 절대 등급
      // rank-based 배지 결정(display_variant) 제거 — "보완 활용 권장" 같은 배지는
      // 공용 렌더러(match-report.js) 영역. 작성가는 raw 데이터만 노출.
      // 렌더러는 trend_stage·growth_rate 신호로 자체 판단.
      keywords: normalizeKeywords(td?.keywords).slice(0, 5),
      headline_metric: td?.headline_metric ?? { metric: "", value: "", delta: "" },
      metrics: td?.metrics ?? { score: 0, growth_rate: 0, period: "" },
      // 렌더러가 배지 판단에 쓰는 raw 신호 — 작성가는 노출만 함.
      trend_stage: td?.trend_stage ?? null,
      growth_rate: td?.metrics?.growth_rate ?? null,
      summary_bullets: buildSummaryBullets(td),
      reason_bullets: (r.summary_reasons ?? []).map(reasonText).filter(Boolean),
      evidence: buildEvidence(td),
      channels: buildChannels(td),
      // 옛 UI 호환: 3기준을 2질문(passes 0/1/2)으로 압축
      match_passes: legacyPasses(fits),
      match_strength: deriveStrength(ev?.matching_grade),
      // raw 3기준 fit (normalizeFits로 정규화) — match_reasons 빌더 입력용.
      // 옛 match_fits 출력 필드는 새 match_reasons 구조로 통합되어 제거됨.
      raw_fits: normalizeFits(fits),
      usage_plan: "", // 풍부화 단계에서 채움 (실패 시 빈 문자열 유지)
    };
  });

  // 2) LLM 풍부화 — 카드 1장당 enrichContent 1회 호출, 병렬 실행.
  //    실패한 카드는 raw 값 그대로 유지 (시스템 안 무너짐).
  const enrichments = await Promise.all(
    rawContents.map((c) => {
      const td = findTrend(c.trend_name);
      const ev = findEval(c.trend_name);
      return enrichContent({ rawContent: c, td, brand: b, matchEval: ev, client });
    }),
  );

  // 2-1) usage_plan — 코드 템플릿(LLM 호출 X). 트렌드의 media_channel_status +
  //      브랜드 채널·KPI를 결정적으로 합성. 같은 metrics.score+growth_rate가
  //      여러 카드에 반복되면 두 번째부터 검색 추이 지수 노출 생략 (dedup).
  const seenIndexKeys = new Set();
  const usagePlans = rawContents.map((c) => {
    const td = findTrend(c.trend_name);
    const score = td?.metrics?.score;
    const rate = td?.metrics?.growth_rate;
    const indexKey =
      typeof score === "number" ? `${score}|${rate ?? ""}` : null;
    const suppressIndex = indexKey != null && seenIndexKeys.has(indexKey);
    if (indexKey != null) seenIndexKeys.add(indexKey);
    return buildUsagePlan(b, td, { rank: c.rank, suppressIndex });
  });

  // 2-2) match_reasons.detail 코드 합성 (LLM 호출 X).
  //      raw_fits에 매칭가 reason + 트렌드 수치 prefix 결합 후 mergedFits 빌드.
  const FIT_KEYS = ["ingred", "visual", "life"];
  const dedicatedReasons = rawContents.map((c) => {
    const td = findTrend(c.trend_name);
    return Object.fromEntries(
      FIT_KEYS.map((key) => [key, buildMatchReason(c.raw_fits?.[key], td)]),
    );
  });

  // 2-4) 카드별 차별점 — 다른 카드에 없는 첫 키워드를 "{X} 중심" 형태로.
  //      매칭가는 브랜드 적합성으로 같은 결의 트렌드를 위로 올리는 게 정상.
  //      작성가가 카드끼리 다른 키워드를 표면화해 마케터가 식별 가능하게.
  const allKeywordArrays = rawContents.map((c) => c.keywords ?? []);

  // 3) raw + enrichment + usage_plan + match_reasons + distinction 머지
  // 우선순위 (detail reason): buildMatchReason(코드 합성) → enrichContent → raw matcher
  // usage_plan: 항상 buildUsagePlan 코드 템플릿 (LLM 미사용).
  // 결과: 옛 match_fits 영역 완전 제거. 출력은 match_reasons로만 노출.
  // reason_bullets는 designer-v2·web/UI_v1.html 등 다운스트림이 쓰므로 유지.
  const contents = rawContents.map((c, i) => {
    const enr = enrichments[i];
    const dedicated = dedicatedReasons[i] ?? {};
    const pickReason = (fitKey) =>
      dedicated[fitKey] || enr?.fit_reasons?.[fitKey] || null;

    // mergedFits — match_reasons 빌더에 넘길 임시 구조. 출력엔 안 나감.
    const mergedFits = Object.fromEntries(
      FIT_KEYS.map((fitKey) => {
        const base = c.raw_fits?.[fitKey];
        if (!base) return [fitKey, null];
        const reason = pickReason(fitKey);
        return [fitKey, reason ? { ...base, reason } : base];
      }),
    );

    const td = findTrend(c.trend_name);
    const { raw_fits, ...rest } = c; // raw_fits는 내부용이라 출력에서 제외
    return {
      ...rest,
      distinction: buildDistinction(allKeywordArrays, i),
      summary_bullets:
        Array.isArray(enr?.summary_bullets) && enr.summary_bullets.length > 0
          ? enr.summary_bullets
          : c.summary_bullets,
      usage_plan: usagePlans[i] || "",
      match_reasons: buildMatchReasons(c.reason_bullets, mergedFits, td),
    };
  });

  return {
    schema_version: "0.2",
    generated_at: new Date().toISOString(),
    status: "success",
    data: {
      source: "작성가",
      brand: {
        name: b.brand_name ?? "",
        product_name: b.product_name ?? "",
        category: b.category ?? "",
        target_display: targetDisplay(b),
        // 캠페인 정보 — brand-analysis.json의 campaign_* 필드를 그대로 노출.
        // 매칭가는 무시하고 작성가/UI만 활용.
        campaign: {
          kpi: b.campaign_kpi ?? "",
          period: b.campaign_period ?? "",
          budget: b.campaign_budget ?? "",
        },
      },
      contents,
    },
  };
}

// ─── 스크립트 진입점 ─────────────────────────────────────────────
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const brand = readJSON(resolve(PROJECT_ROOT, "shared/data/brand-analysis.json"));
  const trend = readJSON(resolve(PROJECT_ROOT, "shared/data/trend-analysis.json"));
  const match = readJSON(resolve(PROJECT_ROOT, "shared/data/match-result.json"));

  // 1) 마크다운 리포트 (사람용)
  const md = generateReport({ brand, trend, match });
  const mdPath = resolve(__dirname, "report.md");
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md);

  // 2) JSON 구조화 산출물 (UI 서빙용) — 팀 합의로 output-main/output-text/에 저장하고
  //    git 추적함. shared/data/는 gitignore라 UI 작업자(mockup HTML·web/) 디스크엔 안
  //    생기는 문제 때문에 서빙용 파일은 추적되는 위치에 보관.
  //    카드 1장당 LLM 1회로 fit_reasons·usage_plan·summary_bullets 풍부화.
  const writerJson = await generateWriterOutput({ brand, trend, match });
  const jsonPath = resolve(__dirname, "writer-output.json");
  writeFileSync(jsonPath, JSON.stringify(writerJson, null, 2));

  console.log(`✅ 작성가 산출물 생성 완료`);
  console.log(`   브랜드: ${brand.data.brand_name} (${brand.data.product_name})`);
  console.log(`   트렌드 ${match.data.recommendations.length}개 추천`);
  console.log(`   📄 마크다운: ${mdPath}`);
  console.log(`   📦 JSON:    ${jsonPath}`);
}
