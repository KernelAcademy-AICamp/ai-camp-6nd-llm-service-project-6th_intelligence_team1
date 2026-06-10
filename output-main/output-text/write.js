import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

// 매칭가 summary_reasons 호환 처리:
//   - 신형(객체): { category, fact, source } → 두 가지 형식으로 변환
//   - 구형(문자열): 그대로 사용 (하위 호환)
//
// formatReason: 마크다운 리포트 불릿용. "**카테고리** — fact" 형식.
// reasonText:   UI JSON 카피용. 평문 fact만.
function formatReason(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  const cat = r.category ? `**${r.category}** — ` : "";
  return cat + (r.fact ?? "");
}

function reasonText(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  return r.fact ?? "";
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
    safe: pickFit(fits, "safe_fit"),
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
    return response.parsed_output ?? null;
  } catch (err) {
    console.warn(`⚠️ enrichContent 실패 (${td?.trend_name ?? "?"}): ${err.message}`);
    return null;
  }
}

// ─── usage_plan 전용 LLM (트렌드 분석가 합의 — 채널 매핑 + evidence 인용) ─
// 마케터 채널과 트렌드의 채널 활성도를 비교해 활용 방안 한 줄 생성.
// score·top_channel 메타데이터가 없을 때도 안전한 표현으로 강제:
//   - "없다"로 단정 X (수집 누락 가능성)
//   - 채널 간 절대 점수 비교 X
//   - 인스타는 경향 표현만 (수치 X)
//   - evidence(media_channel_status status 텍스트)를 자연스럽게 인용
//   - 새 사실 추가 X (환각 방지)
const UsagePlanLlmSchema = z.object({
  usage_plan: z.string().min(10).max(200),
});

const USAGE_PLAN_SYSTEM_PROMPT = `당신은 마케팅 카드의 활용 방안을 1줄 행동 제안으로 만드는 사람입니다.

입력에 두 가지 형식이 들어올 수 있음:
- structured: channel_activity의 pool별 top_channel + 채널별 score + evidence
- text: media_channel_status의 채널별 status 서술 (top_channel·score 메타 없음)

규칙:
1) 마케터 활용 채널(매핑 후)이 트렌드 활성 채널(structured면 top_channel, text면 evidence가 활발한 채널)과 일치 → "이미 활용 중인 [채널]을 강화" 방향. 불일치면 → "[채널]로 확장 고려" 방향.
2) 채널 정보가 누락된 경우 "없다"·"활동 없음"으로 단정하지 말 것. (수집 누락 가능)
   - score=0이어도 "없다"로 표현 금지.
3) 채널 간 절대 점수 비교 금지 (예: "유튜브 80점 vs 인스타 60점" X).
   - 점수는 LLM 자체 판단의 힌트로만 사용. 출력 문장에 점수 숫자 노출 금지.
4) Instagram·메타는 절대 수치 사용 금지. "활발한 편", "콘텐츠 증가" 같은 경향 표현만 사용.
5) evidence 텍스트를 자연스럽게 인용. 거기 없는 새 사실·수치 추가 금지.
6) 한국어, 한 문장(또는 짧은 두 문장 이내), 구체적 행동 제안 형태.

예시(좋음): "유튜브에서 매트 쿠션 튜토리얼 콘텐츠가 활발하니, 이미 활용 중인 유튜브 채널을 통해 30대 데일리 베이스 콘텐츠를 강화하세요."
예시(좋음): "TikTok에서 데일리 룩 콘텐츠가 증가 중이라, 이 채널로 확장해 짧은 비포·애프터 영상으로 도달 확대를 고려하세요."`;

// 트렌드의 채널 활성도 추출 — 두 형식 모두 수용 (트렌드 분석가 진화 단계 대응).
//   1) structured: td.channel_activity[]가 채워져 있으면 (top_channel + score
//      + evidence). 트렌드 분석가 합의 신 형식.
//   2) text: media_channel_status[]만 있으면 (status 텍스트로 추론). 폴백.
function extractChannelEvidence(td) {
  const pools = Array.isArray(td?.channel_activity) ? td.channel_activity : [];
  const populated = pools.filter((p) =>
    p && p.scores && Object.values(p.scores).some(
      (c) => (c?.score ?? 0) > 0 || (c?.evidence && c.evidence.length > 0),
    ),
  );
  if (populated.length > 0) return { format: "structured", pools: populated };

  const items = Array.isArray(td?.media_channel_status) ? td.media_channel_status : [];
  if (items.length > 0) return { format: "text", items };
  return null;
}

// ─── match_fits.reason 전용 LLM (4기준 영역별 1회씩, 총 4회 호출) ────
// enrichContent의 일괄 풍부화보다 영역별 가이드로 더 정교하게.
//   - ingred: 제품·제형 관점
//   - visual: 매체·톤 관점
//   - life: 타겟 라이프스타일 관점
//   - safe: 트렌드 수명·이미지 관점
// 실패 시 enrichContent 결과로 폴백.
const MatchReasonLlmSchema = z.object({
  reason: z.string().min(10).max(200),
});

const MATCH_REASON_FIT_GUIDE = {
  ingred: "이 영역은 **제품·제형이 트렌드와 맞는지** 평가합니다. 제형·텍스처·성분 키워드 위주로 표현하세요.",
  visual: "이 영역은 **브랜드 매체·톤이 트렌드와 맞는지** 평가합니다. 채널·콘텐츠 톤·시각 표현 위주로 표현하세요.",
  life: "이 영역은 **타겟 고객층이 트렌드와 맞는지** 평가합니다. 타겟 연령·라이프스타일·동기 위주로 표현하세요.",
  safe: "이 영역은 **트렌드가 브랜드 이미지에 안전한지** 평가합니다. 트렌드 수명·정점 시기·이미지 리스크 위주로 표현하세요.",
};

const MATCH_REASON_SYSTEM_PROMPT = `당신은 마케팅 카드의 매칭 근거 한 줄을 다듬는 사람입니다.

규칙:
1) 매칭가의 result(✅/⚠️/❌)와 톤이 일치해야 함.
   - ✅: 적합·일치·강점 표현 (예: "정확히 일치", "강한 부합")
   - ⚠️: 부분적 일치·조건부 표현 (예: "부분적으로 부합", "주의 필요")
   - ❌: 부적합·충돌 표현 (예: "어긋남", "불일치")
2) 트렌드 수치(headline_metric·growth_rate)를 자연스럽게 인용해 정량적 설득력 강화.
   예: "검색량 47.4(+22%)로 떠오른" / "82점 트렌드가" / "성장률 +22%로 부상 중"
3) 처음 보는 사람도 이해되는 한 문장 (또는 짧은 두 문장 이내).
4) 환각 금지 — 주어진 데이터에 없는 수치·사실 만들지 말 것.
5) 영역별 관점 유지 — 제품(ingred), 매체·톤(visual), 타겟(life), 안전(safe) 각 영역의 시각으로만 표현.

예시(좋음, ingred ✅): "검색량 47.4(+22%)로 부상한 매트 트렌드가 브랜드 매트 제형과 직결돼 적합도가 높습니다."
예시(좋음, safe ⚠️): "검색량은 47.4로 정점이지만 곧 하락 가능성으로 단기 캠페인에 한정하는 게 안전합니다."`;

async function generateMatchReason({ fitKey, fitData, td, brand, matchEval, client }) {
  if (!client) return null;
  if (!fitData || !fitData.result) return null; // fit 데이터 없으면 스킵

  const hm = td?.headline_metric ?? {};
  const growth =
    td?.metrics?.growth_rate != null
      ? `+${(td.metrics.growth_rate * 100).toFixed(0)}%`
      : "-";

  const userMessage = `## 평가 영역
${MATCH_REASON_FIT_GUIDE[fitKey] ?? "(영역 가이드 없음)"}

## 매칭가 판정 (raw)
- result: ${fitData.result}
- reason: ${fitData.reason ?? "(없음)"}

## 트렌드 수치
- 이름: ${td?.trend_name ?? "-"}
- 대표 지표: ${hm.metric ?? "-"} ${hm.value ?? ""}${hm.delta ? ` (${hm.delta})` : ""}
- 성장률: ${growth}
- 기간: ${td?.metrics?.period ?? "-"}
- 트렌드 점수: ${td?.metrics?.score ?? "-"}

## 매칭 종합
- score: ${matchEval?.score ?? "-"}
- matching_grade: ${matchEval?.matching_grade ?? "-"}

## 브랜드 정보 (참고)
- ${brand?.brand_name ?? "-"} / ${brand?.product_name ?? "-"} / ${brand?.category ?? "-"}

위 데이터로 위 영역(${fitKey})의 매칭 근거 한 줄을 다듬어 JSON으로 반환. 환각·추측 금지.`;

  try {
    const response = await client.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      temperature: 0.3,
      system: [
        { type: "text", text: MATCH_REASON_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(MatchReasonLlmSchema) },
    });
    return response.parsed_output?.reason ?? null;
  } catch (err) {
    console.warn(`⚠️ generateMatchReason 실패 (${td?.trend_name ?? "?"}.${fitKey}): ${err.message}`);
    return null;
  }
}

async function generateUsagePlan({ rawContent, td, brand, client }) {
  if (!client) return null;
  const evidence = extractChannelEvidence(td);
  if (!evidence) return null; // 채널 정보 0건 → LLM 건너뜀

  const marketerChannels = getEffectiveMarketerChannels(brand);

  // 구조화된 channel_activity / 옛 텍스트 둘 다 사람·LLM이 읽기 좋게 직렬화.
  let channelBlock;
  if (evidence.format === "structured") {
    channelBlock = evidence.pools
      .map((p, i) => {
        const lines = [`[Pool ${i + 1}] search_keyword: "${p.search_keyword ?? "-"}"`];
        if (p.top_channel) lines.push(`  top_channel: ${p.top_channel}`);
        if (p.interpretation) lines.push(`  interpretation: ${p.interpretation}`);
        for (const [ch, data] of Object.entries(p.scores ?? {})) {
          const score = data?.score ?? 0;
          const ev = data?.evidence ? ` — ${data.evidence}` : "";
          lines.push(`  ${ch}: score=${score}${ev}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  } else {
    channelBlock = evidence.items
      .map((c) => `- ${c.media_channel ?? c.name ?? "?"}: ${c.status ?? "(상태 미상)"}`)
      .join("\n");
  }

  const userMessage = `## 마케터 활용 채널 (트렌드 채널 형식으로 매핑됨, 자사몰·오프라인 등은 제외됨)
${marketerChannels.length > 0 ? marketerChannels.join(", ") : "(매핑된 비교 가능 채널 없음)"}

## 트렌드 채널별 상태 (evidence, 형식: ${evidence.format})
${channelBlock}

## 트렌드 정보
- 이름: ${td?.trend_name ?? "-"}
- 의미(meaning): ${td?.meaning ?? "-"}

위 데이터로 활용 방안 한 줄 만들어 JSON으로만 반환. 환각·추측 금지, 위 evidence에 있는 표현만 활용.`;

  try {
    const response = await client.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      temperature: 0.3,
      system: [
        { type: "text", text: USAGE_PLAN_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(UsagePlanLlmSchema) },
    });
    return response.parsed_output?.usage_plan ?? null;
  } catch (err) {
    console.warn(`⚠️ generateUsagePlan 실패 (${td?.trend_name ?? "?"}): ${err.message}`);
    return null;
  }
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

  // 2-1) usage_plan 전용 LLM — 채널 매핑 + evidence 인용으로 별도 호출.
  //      트렌드 분석가 합의 규칙 적용. enrichContent의 usage_plan보다 우선.
  //      실패 시 enrichContent 값으로 폴백.
  const usagePlans = await Promise.all(
    rawContents.map((c) => {
      const td = findTrend(c.trend_name);
      return generateUsagePlan({ rawContent: c, td, brand: b, client });
    }),
  );

  // 2-2) match_fits.reason 전용 LLM — 4영역(ingred·visual·life·safe)별 각 1회.
  //      enrichContent의 일괄 풍부화보다 영역별 가이드로 정교한 한 줄. 실패 시
  //      enrichContent 결과로 폴백 (enrichContent도 실패하면 raw matcher reason).
  const FIT_KEYS = ["ingred", "visual", "life", "safe"];
  const matchReasons = await Promise.all(
    rawContents.map(async (c) => {
      const td = findTrend(c.trend_name);
      const ev = findEval(c.trend_name);
      const results = await Promise.all(
        FIT_KEYS.map((key) =>
          generateMatchReason({
            fitKey: key,
            fitData: c.match_fits?.[key],
            td,
            brand: b,
            matchEval: ev,
            client,
          }),
        ),
      );
      return Object.fromEntries(FIT_KEYS.map((k, i) => [k, results[i]]));
    }),
  );

  // 3) raw + enrichment + usage_plan + match_reasons 머지
  // 우선순위 (match_fits.reason): generateMatchReason(dedicated) → enrichContent → raw matcher
  // 우선순위 (usage_plan): generateUsagePlan(dedicated) → enrichContent → ""
  const contents = rawContents.map((c, i) => {
    const enr = enrichments[i];
    const dedicatedUsagePlan = usagePlans[i];
    const dedicatedReasons = matchReasons[i] ?? {};
    const pickReason = (fitKey) =>
      dedicatedReasons[fitKey] || enr?.fit_reasons?.[fitKey] || null;

    const mergedFit = (fitKey) => {
      const base = c.match_fits[fitKey];
      if (!base) return base; // 매칭가가 안 준 fit
      const reason = pickReason(fitKey);
      return reason ? { ...base, reason } : base;
    };

    if (!enr && !dedicatedUsagePlan && !Object.values(dedicatedReasons).some(Boolean)) {
      return c; // 모든 LLM 실패 → raw 그대로
    }

    return {
      ...c,
      summary_bullets:
        Array.isArray(enr?.summary_bullets) && enr.summary_bullets.length > 0
          ? enr.summary_bullets
          : c.summary_bullets,
      usage_plan: dedicatedUsagePlan || enr?.usage_plan || "",
      match_fits: {
        ...c.match_fits,
        ingred: mergedFit("ingred"),
        visual: mergedFit("visual"),
        life: mergedFit("life"),
        safe: mergedFit("safe"),
      },
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
