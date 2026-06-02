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
const SOURCE_URL = {
  "naver datalab": "https://datalab.naver.com/",
  "naver": "https://datalab.naver.com/",
  "네이버": "https://datalab.naver.com/",
  "instagram": "https://www.instagram.com/",
  "인스타그램": "https://www.instagram.com/",
  "tavily": "https://tavily.com/",
};

// 출처 문자열에 매핑 키가 포함되면 해당 URL 반환 (없으면 null)
function sourceUrl(source = "") {
  const s = source.toLowerCase();
  for (const [key, url] of Object.entries(SOURCE_URL)) {
    if (s.includes(key)) return url;
  }
  return null;
}

// 키워드 배열 → `칩1` `칩2` (백틱 인라인 코드로 칩 표현, HTML keyword-tags 등가)
function keywordChips(keywords = []) {
  return keywords.filter(Boolean).map((k) => `\`${k}\``).join(" ");
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

    // 📚 수집 근거 — 출처 링크 (HTML src-chip 등가)
    lines.push("**📚 수집 근거**");
    const evidence = td?.evidence ?? [];
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

// ─── writer-output.json 생성 (UI용 구조화 JSON) ─────────────────
// shared/schemas/writer-output.example.json 형식에 맞춰 출력.
// 카피 필드(concept·headline·body_copy·key_message)는 LLM 없이
// 매칭·트렌드 데이터에서 데이터 매핑으로 채움. v2에서 LLM 카피 생성 예정.

// 채널명 → format_hint 매핑
const CHANNEL_FORMAT = {
  유튜브: "video",
  메타: "image",
  인스타그램: "image",
  카카오: "card",
};

function deriveFormatHint(channel = "") {
  return CHANNEL_FORMAT[channel] ?? "image";
}

export function generateWriterOutput({ brand, trend, match } = {}) {
  const b = unwrap(brand);
  const t = unwrap(trend);
  const m = unwrap(match);

  const top = m.recommendations ?? [];
  const findTrend = (name) => (t.trends ?? []).find((x) => x.trend_name === name);

  const tone = (b.tone_and_manner ?? []).join("·");
  const primaryChannel = (b.media_channels ?? [])[0] ?? "유튜브";

  // 캠페인 테마: 제품명 + 1순위 트렌드 요약
  const top1 = top[0];
  const top1Trend = top1 ? findTrend(top1.trend_name) : null;
  const campaign_theme = top1Trend
    ? `${b.product_name}: ${top1Trend.summary ?? top1.trend_name}`
    : (b.product_name ?? "");

  const contents = top.map((r, i) => {
    const td = findTrend(r.trend_name);
    const id = `C${String(i + 1).padStart(3, "0")}`;
    const reasons = r.summary_reasons ?? [];
    return {
      content_id: id,
      trend_name: r.trend_name,
      concept: td?.meaning ?? "",                       // 트렌드의 의미 → 콘셉트
      headline: td?.summary ?? r.trend_name,             // 트렌드 요약 → 헤드라인
      body_copy: reasonText(reasons[0]),                 // 매칭이유 1 (fact 평문) → 본문
      key_message: reasonText(reasons[1] ?? reasons[0]), // 매칭이유 2 → 핵심 메시지
      channel: primaryChannel,
      mood: tone,
      format_hint: deriveFormatHint(primaryChannel),
    };
  });

  return {
    schema_version: "0.2",
    generated_at: new Date().toISOString(),
    status: "success",
    data: {
      source: "작성가",
      brand_name: b.brand_name ?? "",
      product_name: b.product_name ?? "",
      campaign_theme,
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

  // 2) JSON 구조화 산출물 (UI용)
  const writerJson = generateWriterOutput({ brand, trend, match });
  const jsonPath = resolve(__dirname, "writer-output.json");
  writeFileSync(jsonPath, JSON.stringify(writerJson, null, 2));

  console.log(`✅ 작성가 산출물 생성 완료`);
  console.log(`   브랜드: ${brand.data.brand_name} (${brand.data.product_name})`);
  console.log(`   트렌드 ${match.data.recommendations.length}개 추천`);
  console.log(`   📄 마크다운: ${mdPath}`);
  console.log(`   📦 JSON:    ${jsonPath}`);
}
