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

// 타겟 표시: "20대 여성 · Z세대·트렌디" 형식
// - 연령·성별은 공백으로 묶고, 톤앤매너만 점으로 구분
function formatTarget(data) {
  const ages = data.target_display?.age_groups ?? data.target?.age_groups ?? [];
  const gender = data.target?.gender ?? "";
  const tone = (data.tone_and_manner ?? []).join("·");
  const demo = [ages.join("·"), gender].filter(Boolean).join(" ");
  return [demo, tone].filter(Boolean).join(" · ");
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

    lines.push("**💡 의미 (Meaning)**");
    lines.push(td?.meaning ?? "*(데이터 없음)*");
    lines.push("");

    lines.push("**📊 유행현황 (Status)**");
    lines.push(td?.status ?? "*(데이터 없음)*");
    lines.push("");

    lines.push("**📚 수집 근거 (가지수)**");
    const evidence = td?.evidence ?? [];
    if (evidence.length === 0) {
      lines.push("*(수집된 evidence 없음)*");
    } else {
      evidence.forEach((e) => {
        const period = e.period ? ` (${e.period})` : "";
        lines.push(`- **[${e.source}]** ${e.metric}${period} → ${e.value}`);
      });
    }
    lines.push("");

    lines.push(`**🎯 매칭이유 (오주연)**${rankSuffix}`);
    (r.summary_reasons ?? []).forEach((s) => lines.push(`- ${s}`));
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

// ─── 스크립트 진입점 ─────────────────────────────────────────────
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const brand = readJSON(resolve(PROJECT_ROOT, "shared/data/brand-analysis.json"));
  const trend = readJSON(resolve(PROJECT_ROOT, "shared/data/trend-analysis.json"));
  const match = readJSON(resolve(PROJECT_ROOT, "shared/data/match-result.json"));

  const md = generateReport({ brand, trend, match });

  const outPath = resolve(__dirname, "report.md");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md);

  console.log(`✅ 리포트 생성 완료: ${md.split("\n").length}줄`);
  console.log(`   브랜드: ${brand.data.brand_name} (${brand.data.product_name})`);
  console.log(`   트렌드 ${match.data.recommendations.length}개 추천`);
  console.log(`   저장: ${outPath}`);
}
