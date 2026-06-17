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
  ["market_fit", "수요 시급성"],
  ["safe_fit", "수요 시급성"],
  ["ingred_fit", "성분 적합도"],
  ["visual_fit", "비주얼 적합도"],
  ["life_fit", "라이프스타일 적합도"],
  ["stage peak", "정점 단계"],
  ["stage emerging", "성장 단계"],
  ["stage declining", "하락 단계"],
  ["ingred", "성분·제형"],
  ["features", "특성"],
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
  lines.push("## 📌 Part II — 트렌드 카드");
  lines.push("");
  top.forEach((r, i) => {
    const td = findTrend(r.trend_name);
    const letter = String.fromCharCode(65 + i);
    const rankSuffix = r.rank === 3 ? ` ⚠️ *${r.rank}순위 — 보완 활용 권장*` : "";

    lines.push(`### [${letter}] ${r.trend_name} (${r.rank}순위)`);
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

    lines.push(`**🎯 매칭이유 (오주연)**${rankSuffix}`);
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

function deriveVariant(rank) {
  return rank === 3 ? "supplementary" : "primary";
}

// 매칭가 v0.3 matching_grade(상/중/하/제외) → UI strength enum
function deriveStrength(grade) {
  if (grade === "상") return "strong";
  if (grade === "중") return "partial";
  return "weak";
}

// 4기준 fit 객체에서 result·reason만 발췌. 매칭가가 gap/solution을 더 이상
// 출력하지 않더라도 같은 처리 — 작성가는 둘 다 안 씀.
function slimFit(f) {
  if (!f) return null;
  return { result: f.result, reason: f.reason };
}

// 매칭가가 기준명을 옛(ingred·visual·life) ↔ 신(product·tnm·target) 둘 중
// 어느 쪽으로 보내든 폴백으로 정규화. UI엔 옛 이름(ingred·visual·life·safe)으로 노출.
function pickFit(fits, ...keys) {
  for (const k of keys) if (fits?.[k]) return fits[k];
  return null;
}
function normalizeFits(fits) {
  return {
    ingred: pickFit(fits, "ingred_fit", "product_fit"),
    visual: pickFit(fits, "visual_fit", "tnm_fit"),
    life: pickFit(fits, "life_fit", "target_fit"),
    // v0.4: safe_fit → market_fit (트렌드 단계 × 수요 규모 = 시급성 지표).
    // 옛(safe_fit)·신(market_fit) 둘 다 폴백 수용. UI 키는 그대로 safe 유지.
    safe: pickFit(fits, "safe_fit", "market_fit"),
  };
}

// 4기준 result → 옛 question_1/question_2 passes 호환 매핑.
// q1=브랜드 적합성(ingred+visual), q2=타겟·격 적합성(life+safe). 4점 만점에서 0/1/2로 압축.
const FIT_POINT = { "✅": 2, "⚠️": 1, "❌": 0 };
function legacyPasses(fits) {
  const n = normalizeFits(fits);
  const q1Raw = (FIT_POINT[n.ingred?.result] ?? 0) + (FIT_POINT[n.visual?.result] ?? 0);
  const q2Raw = (FIT_POINT[n.life?.result] ?? 0) + (FIT_POINT[n.safe?.result] ?? 0);
  const compress = (s) => (s >= 4 ? 2 : s >= 2 ? 1 : 0);
  const q1 = compress(q1Raw);
  const q2 = compress(q2Raw);
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
function buildEvidence(td) {
  return (td?.evidence ?? [])
    .filter((e) => !isExcluded(e.source))
    .map((e) => {
      const src = normalizeSource(e.source);
      return {
        source: src,
        label: SOURCE_LABEL[src] ?? e.source,
        description: [e.metric, e.period ? `(${e.period})` : null, e.value]
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

// KPI별 콘텐츠 형식 — 문장 합성용 명사구 (조사 "로/으로"는 buildUsagePlan에서)
const KPI_CONTENT = {
  "신제품 런칭": "30초 숏폼 언박싱과 첫 사용 후기 콘텐츠",
  "시즌 프로모션": "시즌 루틴·한정 할인 메시지",
  "재구매 유도": "공병 후기·데일리 루틴 콘텐츠",
};

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

// usage_plan 한 단락 합성. 다섯 정보를 세 문장으로 자연스럽게 결합:
//   문장 1) 트렌드 현황 — [채널 활성] + evidence + 트렌드 수명
//   문장 2) 행동 제안   — KPI 톤 + 키워드 강조 + KPI 콘텐츠 형식 + 채널 비교
//   문장 3) 기간/예산   — 마케터 기간·예산 → 트렌드 활용 성격
//
// 데이터가 비면 해당 부분/문장 생략 (시스템 안전, 어색한 빈 자리 X).
//
// 결과 예:
//   "[유튜브 활성] 세미매트 쿠션 추천 영상 다수, 정점이며 6개월 이상 흐름.
//    시즌 프로모션에 맞춰 '세미매트', '쿠션' 키워드 중심의 시즌 루틴·한정
//    할인 메시지로 인스타그램 외 유튜브 확장 추천.
//    한달 + 200만원 미만 예산이라 단기 효율형 트렌드로 활용 가능."
function buildUsagePlan(brand, td) {
  if (!td?.trend_name) return "";

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
  const kpiContent = KPI_CONTENT[kpiTone] ?? null; // "시즌 루틴·한정 할인 메시지"
  const pbLabel = mapPeriodBudget(brand?.campaign_period, brand?.campaign_budget); // "단기 효율형 트렌드"

  // 검색량·증가율 — headline_metric에서 추출 (있을 때만 노출).
  // 예: "월별 검색지수 32.4 (-67.6%)" / value만 있으면 "월별 검색지수 32.4"
  const hm = td?.headline_metric ?? {};
  let metricPhrase = null;
  if (hm.value) {
    const label = hm.metric || "검색량";
    metricPhrase = hm.delta ? `${label} ${hm.value} (${hm.delta})` : `${label} ${hm.value}`;
  }

  // ─ 문장 1: 트렌드 현황 ──────────────────────────────────────────
  // "[채널 활성] {evidence}, {검색량/증가율}, {수명}"
  let sentence1 = null;
  if (channelTag) {
    const tail = [channelEvidence, metricPhrase, lifespanPhrase]
      .filter(Boolean)
      .join(", ");
    sentence1 = tail ? `${channelTag} ${tail}` : channelTag;
  } else {
    // 채널 정보 없어도 검색량·수명만으로 문장 1 합성
    const parts = [metricPhrase, lifespanPhrase].filter(Boolean);
    if (parts.length > 0) sentence1 = parts.join(", ");
  }

  // ─ 문장 2: 행동 제안 ───────────────────────────────────────────
  // "{KPI 톤}에 맞춰 {키워드 강조} {KPI 콘텐츠}로 {채널 비교} 추천"
  let sentence2 = null;
  if (kpiTone || kpiContent || channelAction) {
    const head = kpiTone ? `${kpiTone}에 맞춰` : null;
    const kwPart = keywordPhrase ? `${keywordPhrase} 키워드 중심의` : null;
    const body = kpiContent ? `${kpiContent}로` : null;
    const tail = channelAction ?? null;
    sentence2 = [head, kwPart, body, tail].filter(Boolean).join(" ");
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
  const sentences = [sentence1, sentence2, sentence3].filter(Boolean);
  if (sentences.length === 0) return "";
  return sentences.map((s) => `${s}.`).join("\n");
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
    safe: z.string(),
  }),
  usage_plan: z.string(),
  summary_bullets: z.array(z.string()).min(1).max(5),
});

const ENRICH_SYSTEM_PROMPT = `당신은 마케팅 리포트 카드의 카피를 다듬는 사람입니다.
주어진 데이터만 활용해 풍부하게 다듬되, 환각·새 사실 추가는 금지.

3가지 작업:

1. fit_reasons.{ingred,visual,life,safe} — 각 4기준의 매칭가 raw reason과 트렌드 수치(headline_metric·growth_rate)를 합쳐 정량적으로 설득되는 한 줄로 다듬기.
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
  if (!n.ingred && !n.visual && !n.life && !n.safe) {
    return null; // 매칭 데이터 없으면 LLM 건너뜀
  }

  const hm = td?.headline_metric ?? {};
  const userMessage = `## 매칭가 4-Fit 판정 (raw)
- Ingred: ${n.ingred?.result ?? "-"} — ${n.ingred?.reason ?? "(없음)"}
- Visual: ${n.visual?.result ?? "-"} — ${n.visual?.reason ?? "(없음)"}
- Life: ${n.life?.result ?? "-"} — ${n.life?.reason ?? "(없음)"}
- Safe: ${n.safe?.result ?? "-"} — ${n.safe?.reason ?? "(없음)"}
- 매칭 점수: ${matchEval?.score ?? "-"}/8
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

// ─── match_fits.casual_bullets 코드 템플릿 (LLM 호출 없음) ───────────
// 「판정결과(매칭 설명)」는 「매칭 이유」와 60% 이상 내용이 겹치지 않아야 함.
// → 매칭 이유 = 브랜드·트렌드가 매칭된 *사실*(무엇이 맞는지)
//   매칭 설명 = 우리가 *어떤 기준·방법*으로 매칭했는지(방법론)
//
// 따라서 매칭가 reason을 풀어 쓰는 대신, 영역별 평가 방법론을 고정 문구로
// 설명한 뒤 마지막 불렛에 결과 톤만 결과 심볼(✅/⚠️/❌)에 맞춰 자연스럽게.
// 코드 템플릿이라 환각·비용 0, 매번 결정적.

// 결과 심볼별 마지막 불렛 톤 — 영역마다 살짝 표현을 달리해 같은 문장이
// 4영역 반복되지 않도록.
const VERDICT_LINE = {
  ingred: {
    "✅": "그 결과 제품 핵심 특성과 트렌드 키워드가 잘 맞물려요.",
    "⚠️": "그 결과 일부 키워드는 겹치지만 전부 들어맞진 않아요.",
    "❌": "그 결과 제품 특성과 트렌드 키워드가 잘 맞물리지 않아요.",
  },
  visual: {
    "✅": "그 결과 브랜드 톤과 트렌드 분위기가 같은 결로 흘러요.",
    "⚠️": "그 결과 톤이 부분적으로 맞고 일부는 살짝 어긋나요.",
    "❌": "그 결과 브랜드 톤과 트렌드 분위기가 서로 부딪혀요.",
  },
  life: {
    "✅": "그 결과 우리 타겟과 트렌드 소비자층이 거의 같은 사람들이에요.",
    "⚠": "그 결과 타겟층 일부만 트렌드 소비자와 겹쳐요.",
    "⚠️": "그 결과 타겟층 일부만 트렌드 소비자와 겹쳐요.",
    "❌": "그 결과 우리 타겟과 트렌드 소비자가 다른 그룹이에요.",
  },
  safe: {
    "✅": "그 결과 트렌드 단계와 수요 규모가 캠페인 시기와 잘 맞물려요.",
    "⚠️": "그 결과 단계·수요가 적당하지만 시점 선택은 신중하면 좋아요.",
    "❌": "그 결과 트렌드 단계나 수요 규모가 캠페인과 어긋날 수 있어요.",
  },
};

function verdictLine(fitKey, result) {
  const table = VERDICT_LINE[fitKey] ?? {};
  return table[result] ?? "그 결과 종합 판정을 내렸어요.";
}

// 영역별 매칭가 기준 라벨 (v0.6 3-허들 + 참고). 매칭가 system.md 기준 순서.
const FIT_CRITERION_LABEL = {
  ingred: "1차 기준 ‘제품 적합도(Product-Fit)’",
  visual: "2차 기준 ‘톤앤매너 적합도(TnM-Fit)’",
  life: "3차 기준 ‘타겟 적합도(Target-Fit)’",
  safe: "참고 기준 ‘수요 시급성(Market-Fit)’",
};

// 결과 심볼 → 매칭가 적합도 점수 (✅=2, ⚠️=1, ❌=0).
// 매칭가가 FitResult를 점수로 직접 내보내지 않아 작성가가 매핑.
const POINT_BY_RESULT = { "✅": 2, "⚠️": 1, "❌": 0 };
const LABEL_BY_RESULT = { "✅": "적합", "⚠️": "부분 적합", "❌": "부적합" };
const SCORE_TONE = {
  "✅": "높은 수치로 통과",
  "⚠️": "중간 수치로 부분 통과",
  "❌": "낮은 수치로 미통과",
};

// 영역별 *방법론* 불렛 — 매칭가의 N차 기준 + 적합도 점수를 명시해 매칭 이유
// (사실 일치)와 의미가 명확히 갈리도록. 마지막 불렛은 결과 심볼별 결론 라인.
function buildMethodologyBullets(fitKey, result) {
  const criterion = FIT_CRITERION_LABEL[fitKey] ?? "매칭 기준";
  const score = POINT_BY_RESULT[result];
  const label = LABEL_BY_RESULT[result];
  const tone = SCORE_TONE[result];
  if (score == null) return [`매칭가의 ${criterion} 평가 데이터가 비어 있어요.`];

  return [
    `브랜드와 트렌드 매칭은 매칭가의 ${criterion} 단계에서 평가했어요.`,
    `이 단계의 매칭 적합도 점수가 ${score}/2점으로 ${tone}, ‘${label}’으로 분류됐답니다.`,
    verdictLine(fitKey, result),
  ];
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

// 트렌드 수치를 자연스러운 한국어 한 문장으로 풀어 쓴다. 옛 "[검색량 N +X%]"
// 대괄호 표기 대체. 트렌드 분석가가 다양한 형식으로 value를 보내므로 6가지
// 패턴으로 분기. 매칭 안 되면 null (prefix 없이 raw reason만 노출).
//
// 케이스 예:
//   value="300+", rate=+0.45 → "검색량이 300건 이상이고 45% 증가하며 떠오르는 트렌드예요."
//   value="47.4", rate=-0.15 → "검색량이 47.4건이고 15% 감소했지만 안정적으로 자리잡은 트렌드예요."
//   value="56%↑", rate=+0.56 → "56% 증가하며 떠오르는 트렌드예요." (% 중복 회피)
//   value="100 → 11.17", rate=-0.89 → "89% 감소했지만 안정적으로 자리잡은 트렌드예요."
//   metric="검색 수요 지수", value="높음" → "검색 수요 지수가 높음으로 강하게 잡히고 있어요."
//   metric="활성도", value=68 → "이 카테고리의 활성도가 68으로 활발해요."
//   metric="제품 순위 및 수상", value="화해 1위 2년 연속" → "제품 순위 및 수상: 화해 1위 2년 연속."

// 순수 검색량 숫자형(정수/소수, 끝에 "+" 허용)이면 {num, endsWithPlus} 반환.
function parseSearchVolumeValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/[%↑↓]/.test(s)) return null;
  if (/[가-힣]/.test(s)) return null;
  if (/\s/.test(s)) return null;
  const endsWithPlus = s.endsWith("+");
  const numPart = endsWithPlus ? s.slice(0, -1) : s;
  if (!/^\d+(\.\d+)?$/.test(numPart)) return null;
  return { num: numPart, endsWithPlus };
}

// rate 단독 풀어쓰기 — 증가/감소/유지 분기.
function formatRateSentence(rate) {
  const pct = Math.round(rate * 100);
  const absPct = Math.abs(pct);
  if (pct > 0) return `${absPct}% 증가하며 떠오르는 트렌드예요.`;
  if (pct < 0) return `${absPct}% 감소했지만 안정적으로 자리잡은 트렌드예요.`;
  return null; // 0%는 굳이 안 표시
}

function buildMetricPrefixSentence(td) {
  const value = td?.headline_metric?.value;
  const metric = td?.headline_metric?.metric;
  const rate = td?.metrics?.growth_rate;

  const hasValue = value != null && String(value).trim().length > 0;
  const hasRate = rate != null && typeof rate === "number";

  if (!hasValue && !hasRate) return null;

  const valueStr = hasValue ? String(value).trim() : "";

  // 1) 활성/활성도 metric + 짧은 value — "이 카테고리의 활성도가 N으로 활발해요"
  if (hasValue && typeof metric === "string" && /활성/.test(metric) && valueStr.length <= 10) {
    return `이 카테고리의 ${metric}이 ${valueStr}으로 활발해요.`;
  }

  // 2) 순수 검색량 숫자 — 가장 정밀한 풀어쓰기
  const parsed = hasValue ? parseSearchVolumeValue(value) : null;
  if (parsed) {
    if (hasRate) {
      const pct = Math.round(rate * 100);
      const absPct = Math.abs(pct);
      if (pct > 0) {
        const suffix = parsed.endsWithPlus ? "건 이상이고" : "건이고";
        return `검색량이 ${parsed.num}${suffix} ${absPct}% 증가하며 떠오르는 트렌드예요.`;
      }
      if (pct < 0) {
        const suffix = parsed.endsWithPlus ? "건 이상이지만" : "건이고";
        return `검색량이 ${parsed.num}${suffix} ${absPct}% 감소했지만 안정적으로 자리잡은 트렌드예요.`;
      }
      const suffix = parsed.endsWithPlus ? "건 이상으로" : "건으로";
      return `검색량이 ${parsed.num}${suffix} 안정적인 트렌드예요.`;
    }
    const suffix = parsed.endsWithPlus ? "건 이상이에요" : "건이에요";
    return `검색량이 ${parsed.num}${suffix}.`;
  }

  // 3) % 패턴 value (56%↑, -22%) — rate와 의미 중복 → rate 우선, 없으면 value에서 추출.
  if (hasValue && /^[+-]?\d+(\.\d+)?%[↑↓]?$/.test(valueStr)) {
    if (hasRate) return formatRateSentence(rate);
    const m = valueStr.match(/(\d+(\.\d+)?)/);
    if (m) {
      const sign = /[-↓]/.test(valueStr) ? -1 : 1;
      return formatRateSentence((Number(m[1]) / 100) * sign);
    }
  }

  // 4) 변화 패턴 ("100 → 11.17 (-88.8%)") — rate에 위임
  if (hasValue && /→/.test(valueStr) && hasRate) {
    return formatRateSentence(rate);
  }

  // 5) 정성 평가 단어 (높음/중간/낮음 등) + metric 동반
  if (hasValue && /^(매우\s*)?(높음|높은|중간|보통|낮음|낮은)$/.test(valueStr)) {
    const tag = metric || "트렌드 신호";
    if (/높/.test(valueStr)) return `${tag}이 ${valueStr}으로 강하게 잡히고 있어요.`;
    if (/중간|보통/.test(valueStr)) return `${tag}이 ${valueStr} 수준으로 관찰돼요.`;
    return `${tag}이 ${valueStr}으로 약해진 상태예요.`;
  }

  // 6) 그 외 — rate가 있으면 rate만, 없으면 metric+value를 자연 문장으로.
  if (hasRate) return formatRateSentence(rate);
  if (hasValue && metric) return `${metric}: ${valueStr}.`;
  if (hasValue) return `${valueStr}.`;
  return null;
}

// 각 기준의 detail 문장 합성. 코드 템플릿만 사용 (LLM 호출 X).
// 매칭가가 영문 필드명(ingred·product_features 등)을 섞어 보내면
// naturalizeMatcherText()가 자연 한글로 치환. 끝에 종결부호 없으면 자동 보정.
function buildMatchReason(fitData, td) {
  const rawReason = fitData?.reason;
  if (!rawReason) return ""; // 매칭가 데이터 없으면 빈 문자열
  const polished = naturalizeMatcherText(rawReason);
  const sentence = buildMetricPrefixSentence(td);
  const merged = sentence ? `${sentence} ${polished}` : polished;
  return /[.。!?]$/.test(merged.trim()) ? merged : `${merged}.`;
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
      display_variant: deriveVariant(r.rank),
      keywords: normalizeKeywords(td?.keywords).slice(0, 5),
      headline_metric: td?.headline_metric ?? { metric: "", value: "", delta: "" },
      metrics: td?.metrics ?? { score: 0, growth_rate: 0, period: "" },
      summary_bullets: buildSummaryBullets(td),
      reason_bullets: (r.summary_reasons ?? []).map(reasonText).filter(Boolean),
      evidence: buildEvidence(td),
      channels: buildChannels(td),
      // 옛 UI 호환: 4기준을 2질문(passes 0/1/2)으로 압축
      match_passes: legacyPasses(fits),
      match_strength: deriveStrength(ev?.matching_grade),
      // 신 UI용: 4기준 result + reason만 노출. 매칭가의 옛(ingred_fit)·신(product_fit)
      // 두 이름 모두 폴백으로 수용. UI엔 옛 이름(ingred·visual·life·safe)으로 유지.
      match_fits: (() => {
        const n = normalizeFits(fits);
        return {
          ingred: slimFit(n.ingred),
          visual: slimFit(n.visual),
          life: slimFit(n.life),
          safe: slimFit(n.safe),
          score: ev?.score ?? 0, // 0-8
        };
      })(),
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
  //      브랜드 채널·KPI를 결정적으로 합성. 트렌드가 evidence를 채워서 보내고
  //      마케터가 채널·KPI를 주므로 작성가는 두 데이터를 결합만 하면 됨.
  const usagePlans = rawContents.map((c) =>
    buildUsagePlan(b, findTrend(c.trend_name)),
  );

  // 2-2) match_fits.reason 코드 합성 (LLM 호출 X).
  //      매칭가 raw reason + 트렌드 수치 prefix 결합 — 결정적·비용 0.
  const FIT_KEYS = ["ingred", "visual", "life", "safe"];
  const matchReasons = rawContents.map((c) => {
    const td = findTrend(c.trend_name);
    return Object.fromEntries(
      FIT_KEYS.map((key) => [key, buildMatchReason(c.match_fits?.[key], td)]),
    );
  });

  // 2-3) match_fits.casual_bullets — 평가 *방법론* 코드 템플릿 (LLM 호출 X).
  //      「매칭 이유」가 사실 중심이라면 「판정결과(casual_bullets)」는 *우리가
  //      어떤 기준으로 매칭했는지* 방법론 중심으로 풀어 매칭 이유와 의미 중복
  //      ≤60% 보장. 결과 심볼(✅/⚠️/❌)에 맞춰 마지막 불렛 톤만 다르게.
  const casualBulletsByCard = rawContents.map((c) =>
    Object.fromEntries(
      FIT_KEYS.map((key) => {
        const fit = c.match_fits?.[key];
        if (!fit) return [key, null];
        return [key, buildMethodologyBullets(key, fit.result)];
      }),
    ),
  );

  // 3) raw + enrichment + usage_plan + match_reasons 머지
  // 우선순위 (detail reason): buildMatchReason(코드 합성) → enrichContent → raw matcher
  // usage_plan: 항상 buildUsagePlan 코드 템플릿 (LLM 미사용).
  // 결과: match_fits 제거 — 매칭이유(reason_bullets)와 같은 트렌드 매칭을
  // 두 영역으로 두 번 보여주던 중복을 match_reasons 한 영역으로 통합.
  // reason_bullets는 designer-v2·web/UI_v1.html 등 다운스트림이 쓰므로 유지.
  const contents = rawContents.map((c, i) => {
    const enr = enrichments[i];
    const dedicatedReasons = matchReasons[i] ?? {};
    const pickReason = (fitKey) =>
      dedicatedReasons[fitKey] || enr?.fit_reasons?.[fitKey] || null;

    // mergedFits — match_reasons 빌더에 넘길 임시 구조. 출력엔 안 나감.
    const mergedFits = Object.fromEntries(
      FIT_KEYS.map((fitKey) => {
        const base = c.match_fits?.[fitKey];
        if (!base) return [fitKey, null];
        const reason = pickReason(fitKey);
        return [fitKey, reason ? { ...base, reason } : base];
      }),
    );

    const td = findTrend(c.trend_name);
    const merged = {
      ...c,
      summary_bullets:
        Array.isArray(enr?.summary_bullets) && enr.summary_bullets.length > 0
          ? enr.summary_bullets
          : c.summary_bullets,
      usage_plan: usagePlans[i] || "",
      match_reasons: buildMatchReasons(c.reason_bullets, mergedFits, td),
    };
    // match_fits는 새 구조(match_reasons)로 통합 — 출력에서 제거.
    delete merged.match_fits;
    return merged;
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
