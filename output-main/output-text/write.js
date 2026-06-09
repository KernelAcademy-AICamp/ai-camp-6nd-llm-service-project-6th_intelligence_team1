import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 작성가 v1 — LLM 호출 없이 순수 데이터 매핑으로 마케터 리포트 생성.
//
// 입력 (shared/data/):
//   - brand-analysis.json  (엄남경)
//   - trend-analysis.json  (이효희 분석 + 가지수 수집)
//   - match-result.json    (오주연)
// 출력:
//   - output-main/output-text/report.md  (이 파일 옆)
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

// 4기준(ingred·visual·life·safe) result → 옛 question_1/question_2 passes 호환 매핑.
// q1=브랜드 적합성(ingred+visual), q2=타겟·격 적합성(life+safe). 4점 만점에서 0/1/2로 압축.
const FIT_POINT = { "✅": 2, "⚠️": 1, "❌": 0 };
function legacyPasses(fits) {
  const q1Raw = (FIT_POINT[fits?.ingred_fit?.result] ?? 0) + (FIT_POINT[fits?.visual_fit?.result] ?? 0);
  const q2Raw = (FIT_POINT[fits?.life_fit?.result] ?? 0) + (FIT_POINT[fits?.safe_fit?.result] ?? 0);
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

export function generateWriterOutput({ brand, trend, match } = {}) {
  const b = unwrap(brand);
  const t = unwrap(trend);
  const m = unwrap(match);

  const top = m.recommendations ?? [];
  const evaluations = m.evaluations ?? [];
  const findTrend = (name) => (t.trends ?? []).find((x) => x.trend_name === name);
  const findEval = (name) => evaluations.find((e) => e.trend_name === name);

  const contents = top.map((r, i) => {
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
      // 신 UI용: 4기준 result + reason만 노출. gap/solution은 작성가가 안 씀.
      match_fits: {
        ingred: slimFit(fits.ingred_fit),
        visual: slimFit(fits.visual_fit),
        life: slimFit(fits.life_fit),
        safe: slimFit(fits.safe_fit),
        score: ev?.score ?? 0, // 0-8
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
  const writerJson = generateWriterOutput({ brand, trend, match });
  const jsonPath = resolve(__dirname, "writer-output.json");
  writeFileSync(jsonPath, JSON.stringify(writerJson, null, 2));

  console.log(`✅ 작성가 산출물 생성 완료`);
  console.log(`   브랜드: ${brand.data.brand_name} (${brand.data.product_name})`);
  console.log(`   트렌드 ${match.data.recommendations.length}개 추천`);
  console.log(`   📄 마크다운: ${mdPath}`);
  console.log(`   📦 JSON:    ${jsonPath}`);
}
