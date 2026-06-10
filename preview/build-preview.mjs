// writer-output.json을 읽어 단일 HTML 미리보기 파일 생성.
// 브라우저에서 더블클릭으로 열림 (file:// 프로토콜, fetch 사용 안 함, 데이터 인라인).
//
// 사용법:
//   node preview/build-preview.mjs
//   → preview/report-preview.html 생성

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const writerOutput = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "output-main/output-text/writer-output.json"), "utf-8"),
);
// 영역별 "비교한 데이터" 섹션 채우려면 brand·trend 원본도 필요.
const brandRaw = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "shared/data/brand-analysis.json"), "utf-8"),
).data;
const trendRaw = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "shared/data/trend-analysis.json"), "utf-8"),
).data;
const trendByName = new Map(trendRaw.trends.map((t) => [t.trend_name, t]));

// 영역별 제목·부제·"이 영역에서 본 것" 불렛.
// 백엔드 이름(Ingred-Fit 등) 대신 자연 한글 제목 사용 — 마케터·디자이너가 한 눈에 의미 파악.
const FIT_META = {
  ingred: {
    title: "제품 적합도",
    subtitle: "제품·제형이 트렌드와 맞는지",
    checks: [
      "브랜드 제품의 텍스처·성분 키워드",
      "트렌드의 핵심 키워드 (검색되는 단어)",
      "둘이 직접 매칭되는 단어가 있는지",
    ],
  },
  visual: {
    title: "비주얼·톤 적합도",
    subtitle: "브랜드 매체·톤이 트렌드와 맞는지",
    checks: [
      "브랜드의 톤앤매너 (럭셔리·감성·트렌디 등)",
      "트렌드의 시각적 성격 (꾸안꾸·미니멀·과감 등)",
      "콘텐츠 매체(유튜브·인스타 등)가 어울리는지",
    ],
  },
  life: {
    title: "타겟 적합도",
    subtitle: "타겟 고객이 트렌드에 맞는지",
    checks: [
      "브랜드 타겟 연령·성별",
      "트렌드 주요 향유층의 연령·라이프스타일",
      "타겟의 동기·가치관과 트렌드 코드의 일치",
    ],
  },
  safe: {
    title: "안전성·지속성",
    subtitle: "트렌드가 브랜드 이미지에 안전한지",
    checks: [
      "트렌드 단계 (성장기·정점·하락기)",
      "트렌드 수명 (단기 유행 vs 장기 자리잡기)",
      "브랜드 이미지에 충돌·리스크 없는지",
    ],
  },
};

const FIT_RESULT_LABEL = {
  "✅": { label: "적합", className: "fit-good" },
  "⚠️": { label: "부분 적합", className: "fit-warn" },
  "❌": { label: "부적합", className: "fit-bad" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 트렌드 keywords 정규화 — 옛 array vs 신 객체({ingred,life}) 둘 다 수용.
function normalizeTrendKeywords(keywords) {
  if (Array.isArray(keywords)) return keywords;
  if (keywords && typeof keywords === "object") {
    return [...(keywords.ingred ?? []), ...(keywords.life ?? [])];
  }
  return [];
}

// 판정결과 자연어 합성 — "어떤 데이터를 보고 + 왜 이 결과가 나왔는지" 한 문장.
// 영역별 brand/trend 원본 데이터를 인용 + 결과 라벨에 맞는 톤으로 결론까지.
// LLM 호출 없음, 결정적·코드 합성. 비전공자도 한 문장으로 매칭 근거 파악 가능.
function buildVerdictExplanation(fitKey, result, brand, td) {
  const trim = (s) => (s ? String(s).trim() : "");
  const fallback = (v, alt) => (v && v.length > 0 ? v : alt);

  switch (fitKey) {
    case "ingred": {
      const brandKw = esc(fallback(
        // 중복 제거 — texture_keywords와 product_features에 같은 단어("매트" 등)가
        // 모두 들어가는 경우가 흔함.
        [...new Set([...(brand?.texture_keywords ?? []), ...(brand?.product_features ?? [])])]
          .filter(Boolean)
          .join(", "),
        "(브랜드 키워드 없음)",
      ));
      const trendKw = esc(fallback(
        normalizeTrendKeywords(td?.keywords).slice(0, 5).join(", "),
        "(트렌드 키워드 없음)",
      ));
      return {
        "✅": `브랜드 제품 키워드 <b>"${brandKw}"</b>가 트렌드 핵심 키워드 <b>"${trendKw}"</b>와 직접 매칭되기 때문에 <b>적합</b>으로 판정.`,
        "⚠️": `브랜드 제품 키워드 <b>"${brandKw}"</b>가 트렌드 핵심 키워드 <b>"${trendKw}"</b> 중 일부와만 겹치기 때문에 <b>부분 적합</b>으로 판정.`,
        "❌": `브랜드 제품 키워드 <b>"${brandKw}"</b>가 트렌드 핵심 키워드 <b>"${trendKw}"</b>와 거의 겹치지 않아 <b>부적합</b>으로 판정.`,
      }[result] ?? "(판정 데이터 없음)";
    }
    case "visual": {
      const brandTone = esc(fallback(
        (brand?.tone_and_manner ?? []).join(", "),
        "(브랜드 톤 없음)",
      ));
      const channels = esc(fallback(
        (td?.media_channel_status ?? [])
          .map((c) => c.media_channel || c.name)
          .filter(Boolean)
          .join(", "),
        "(트렌드 활성 매체 데이터 없음)",
      ));
      return {
        "✅": `브랜드 톤앤매너 <b>"${brandTone}"</b>가 트렌드의 활성 매체 <b>"${channels}"</b>가 만드는 콘텐츠 성격과 잘 어울려서 <b>적합</b>으로 판정.`,
        "⚠️": `브랜드 톤 <b>"${brandTone}"</b>이 트렌드 매체 <b>"${channels}"</b>의 콘텐츠 성격과 부분적으로만 부합하여 <b>부분 적합</b>으로 판정.`,
        "❌": `브랜드 톤 <b>"${brandTone}"</b>이 트렌드 매체 <b>"${channels}"</b>의 시각·콘텐츠 성격과 충돌하여 <b>부적합</b>으로 판정.`,
      }[result] ?? "(판정 데이터 없음)";
    }
    case "life": {
      const t = brand?.target ?? {};
      const brandTarget = esc(fallback(
        [t.gender, (t.age_groups ?? []).join("·"), (t.motivation ?? []).join("·"), t.involvement]
          .filter(Boolean)
          .join(", "),
        "(브랜드 타겟 없음)",
      ));
      const trendAud = esc(fallback(
        trim(td?.audience_signal),
        td?.audience_distribution ? "트렌드 인구분포 데이터 참고" : "(트렌드 향유층 데이터 없음)",
      ));
      return {
        "✅": `브랜드 타겟 <b>"${brandTarget}"</b>이 트렌드 향유층 <b>"${trendAud}"</b>와 연령·라이프스타일·동기에서 일치하여 <b>적합</b>으로 판정.`,
        "⚠️": `브랜드 타겟 <b>"${brandTarget}"</b>과 트렌드 향유층 <b>"${trendAud}"</b> 사이 일부 일치하나 차이가 있어 <b>부분 적합</b>으로 판정.`,
        "❌": `브랜드 타겟 <b>"${brandTarget}"</b>과 트렌드 향유층 <b>"${trendAud}"</b>의 연령·라이프스타일이 명확히 달라 <b>부적합</b>으로 판정.`,
      }[result] ?? "(판정 데이터 없음)";
    }
    case "safe": {
      const stage = esc(fallback(trim(td?.trend_stage), "미정"));
      const lifespan = esc(fallback(trim(td?.lifespan_estimate), "미정"));
      const growth = esc(
        td?.metrics?.growth_rate != null
          ? `${td.metrics.growth_rate >= 0 ? "+" : ""}${Math.round(td.metrics.growth_rate * 100)}%`
          : "데이터 없음",
      );
      return {
        "✅": `트렌드가 <b>"${stage}"</b> 단계 + 수명 <b>"${lifespan}"</b> + 성장률 <b>${growth}</b>로 안정적이라 브랜드 이미지에 안전하여 <b>적합</b>으로 판정.`,
        "⚠️": `트렌드가 <b>"${stage}"</b> 단계라 곧 하락 가능 (수명 <b>"${lifespan}"</b>, 성장률 <b>${growth}</b>). 단기 캠페인에 한정해 <b>부분 적합</b>으로 판정.`,
        "❌": `트렌드가 <b>"${stage}"</b> 단계로 브랜드 이미지에 리스크가 있어 (수명 <b>"${lifespan}"</b>, 성장률 <b>${growth}</b>) <b>부적합</b>으로 판정.`,
      }[result] ?? "(판정 데이터 없음)";
    }
    default:
      return "(판정 데이터 없음)";
  }
}

function renderFitItem(fitKey, fit, brand, td) {
  const meta = FIT_META[fitKey];
  const r = fit?.result ?? "";
  const label = FIT_RESULT_LABEL[r] ?? { label: "-", className: "fit-empty" };
  const checks = Array.isArray(meta.checks) ? meta.checks : [];
  // 판정결과 = brand/trend 데이터 인용 + 왜 그 결과인지 한 문장 설명.
  // (esc 안 하는 이유: 함수 내부에서 안전한 <b> 태그만 직접 삽입 — 사용자 입력 esc는 함수 내부에서 처리 안 함.
  //  brand·trend 값은 esc 처리한 뒤 템플릿에 넣어야 안전하나, 현재는 작성가 통제 데이터라 신뢰 가정.)
  const verdictHtml = buildVerdictExplanation(fitKey, r, brand, td);

  return `
    <div class="fit-item ${label.className}">
      <div class="fit-head">
        <span class="fit-title">${esc(meta.title)}</span>
        <span class="fit-result">${esc(r)} ${esc(label.label)}</span>
      </div>
      <div class="fit-subtitle">${esc(meta.subtitle)}</div>
      ${
        checks.length > 0
          ? `<div class="fit-section-label">📌 이 영역에서 본 것</div>
             <ul class="fit-checks">${checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
          : ""
      }
      <div class="fit-section-label">📊 판정 결과</div>
      <div class="fit-verdict">${verdictHtml}</div>
    </div>
  `;
}

function renderKeywordBadges(keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return "";
  return keywords.map((k) => `<span class="kw-badge">#${esc(k)}</span>`).join(" ");
}

function renderEvidence(ev) {
  if (!Array.isArray(ev) || ev.length === 0) return "<div class='empty'>수집 근거 없음</div>";
  return ev
    .map((e) => {
      const link = e.url
        ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.label || e.source)}</a>`
        : `<strong>${esc(e.label || e.source)}</strong>`;
      return `<li>${link} — ${esc(e.description ?? "")}</li>`;
    })
    .join("");
}

function renderMetric(headline) {
  const value = headline?.value ?? "";
  const delta = headline?.delta ?? "";
  if (!value && !delta) return "<div class='empty'>지표 없음</div>";
  return `
    <div class="metric-strip">
      <div class="metric-value">${esc(value)}</div>
      ${delta ? `<div class="metric-delta">${esc(delta)}</div>` : ""}
    </div>
  `;
}

function renderCard(c) {
  const period = c.metrics?.period ?? "";
  const td = trendByName.get(c.trend_name); // 원본 트렌드 데이터 (audience_signal·trend_stage 등)
  const result4 = ["ingred", "visual", "life", "safe"]
    .map((k) => renderFitItem(k, c.match_fits?.[k], brandRaw, td))
    .join("");

  return `
    <article class="card">
      <header class="card-head">
        <div class="rank-badge">${esc(c.verdict || c.rank + "순위")}</div>
        <h2 class="trend-name">${esc(c.trend_name)}</h2>
        <div class="kw-row">${renderKeywordBadges(c.keywords)}</div>
      </header>

      <div class="card-body">
        <section class="left-col">
          <div class="block">
            <div class="block-title">📊 검색량 지수</div>
            ${renderMetric(c.headline_metric)}
            ${period ? `<div class="period">기간: ${esc(period)}</div>` : ""}
          </div>

          <div class="block">
            <div class="block-title">🎯 매칭이유</div>
            ${
              Array.isArray(c.reason_bullets) && c.reason_bullets.length > 0
                ? `<ul class="reason-list">${c.reason_bullets
                    .map((r) => `<li>${esc(r)}</li>`)
                    .join("")}</ul>`
                : "<div class='empty'>매칭 이유 없음</div>"
            }
          </div>

          <div class="block">
            <div class="block-title">📈 유행 현황</div>
            ${
              Array.isArray(c.summary_bullets) && c.summary_bullets.length > 0
                ? `<ul class="summary-list">${c.summary_bullets
                    .map((s) => `<li>${esc(s)}</li>`)
                    .join("")}</ul>`
                : "<div class='empty'>유행 현황 없음</div>"
            }
          </div>

          <div class="block">
            <div class="block-title">📚 수집 근거</div>
            <ul class="evidence-list">${renderEvidence(c.evidence)}</ul>
          </div>
        </section>

        <section class="right-col">
          <div class="block-title">🧭 매칭 4기준</div>
          <div class="fit-grid">${result4}</div>
        </section>
      </div>

      <footer class="card-foot">
        <div class="usage-title">💡 활용 방안</div>
        <div class="usage-text">${esc(c.usage_plan || "(활용 방안 없음)")}</div>
      </footer>
    </article>
  `;
}

const brand = writerOutput.data.brand;
const contents = writerOutput.data.contents;
const generatedAt = new Date(writerOutput.generated_at).toLocaleString("ko-KR");

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${esc(brand.name)} — 캠페인 트렌드 매칭 리포트</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "Noto Sans KR", "Apple SD Gothic Neo", "맑은 고딕", sans-serif;
      background: #fff5f7;
      color: #2a1a20;
      line-height: 1.55;
      padding: 32px 16px;
    }
    .wrap { max-width: 1180px; margin: 0 auto; }

    /* 헤더 */
    .report-header {
      background: linear-gradient(135deg, #ffe0e9 0%, #fff0f5 100%);
      border: 1px solid #f9c6d5;
      border-radius: 16px;
      padding: 28px 32px;
      margin-bottom: 28px;
    }
    .report-title { font-size: 26px; font-weight: 800; color: #c2185b; margin-bottom: 8px; }
    .report-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-top: 16px; font-size: 14px; }
    .meta-row { display: flex; gap: 8px; }
    .meta-label { color: #8a5a6e; font-weight: 600; min-width: 80px; }
    .meta-value { color: #2a1a20; }
    .campaign-box {
      grid-column: 1 / -1;
      background: rgba(255,255,255,0.6);
      border: 1px solid #f9c6d5;
      border-radius: 12px;
      padding: 12px 16px;
      margin-top: 8px;
    }
    .campaign-title { font-size: 13px; font-weight: 700; color: #c2185b; margin-bottom: 6px; }
    .campaign-row { display: flex; gap: 20px; font-size: 13px; }
    .campaign-key { color: #8a5a6e; font-weight: 600; }
    .gen-info { text-align: right; font-size: 12px; color: #8a5a6e; margin-top: 12px; }

    /* 카드 */
    .card {
      background: #ffffff;
      border: 1px solid #f9c6d5;
      border-radius: 16px;
      margin-bottom: 24px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(244, 143, 177, 0.12);
    }
    .card-head {
      padding: 20px 28px 16px;
      background: linear-gradient(135deg, #fce4ec 0%, #fff5f7 100%);
      border-bottom: 1px solid #f9c6d5;
    }
    .rank-badge {
      display: inline-block;
      background: #e91e63;
      color: white;
      font-weight: 700;
      font-size: 13px;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 10px;
    }
    .trend-name { font-size: 22px; font-weight: 800; color: #2a1a20; margin-bottom: 12px; }
    .kw-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .kw-badge {
      background: #fce4ec;
      border: 1px solid #f9c6d5;
      color: #c2185b;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 600;
    }

    /* 본문 좌우 분할 */
    .card-body { display: grid; grid-template-columns: 1.1fr 1fr; gap: 24px; padding: 24px 28px; }
    @media (max-width: 900px) { .card-body { grid-template-columns: 1fr; } }

    .block { margin-bottom: 18px; }
    .block-title {
      font-size: 13px; font-weight: 700; color: #c2185b;
      margin-bottom: 8px; letter-spacing: -0.2px;
    }
    .empty { color: #b88a98; font-size: 13px; font-style: italic; }

    /* 좌측 */
    .metric-strip {
      display: flex; gap: 12px; align-items: baseline;
      background: #fce4ec; padding: 14px 18px; border-radius: 12px;
    }
    .metric-value { font-size: 28px; font-weight: 800; color: #c2185b; }
    .metric-delta { font-size: 16px; font-weight: 700; color: #e91e63; }
    .period { font-size: 12px; color: #8a5a6e; margin-top: 6px; }

    .reason-list { list-style: none; padding: 0; }
    .reason-list li {
      position: relative; padding-left: 20px; margin-bottom: 8px;
      font-size: 14px; color: #3a2a30;
    }
    .reason-list li::before {
      content: "●"; position: absolute; left: 0; top: 0;
      color: #e91e63; font-size: 10px; line-height: 22px;
    }

    .summary-list { list-style: disc; padding-left: 20px; }
    .summary-list li { font-size: 13.5px; color: #3a2a30; margin-bottom: 6px; }

    .evidence-list { list-style: none; padding: 0; }
    .evidence-list li {
      font-size: 13px; color: #3a2a30; margin-bottom: 6px;
      padding-left: 12px; border-left: 2px solid #f9c6d5;
    }
    .evidence-list a { color: #c2185b; text-decoration: none; font-weight: 600; }
    .evidence-list a:hover { text-decoration: underline; }

    /* 우측 — 4기준 그리드 */
    .fit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 600px) { .fit-grid { grid-template-columns: 1fr; } }
    .fit-item {
      background: #fff;
      border: 1px solid #f9c6d5;
      border-radius: 12px;
      padding: 14px;
    }
    .fit-good { border-left: 4px solid #66bb6a; }
    .fit-warn { border-left: 4px solid #ffa726; }
    .fit-bad { border-left: 4px solid #ef5350; }
    .fit-empty { border-left: 4px solid #bdbdbd; }
    .fit-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .fit-title { font-size: 14px; font-weight: 800; color: #2a1a20; }
    .fit-result { font-size: 12px; font-weight: 700; color: #6a3a4a; }
    .fit-subtitle { font-size: 11.5px; color: #8a5a6e; margin-bottom: 8px; font-weight: 500; }
    .fit-section-label {
      font-size: 11px; font-weight: 700; color: #c2185b;
      margin-top: 10px; margin-bottom: 4px; letter-spacing: -0.2px;
    }
    .fit-checks {
      list-style: none; padding: 8px 10px; margin: 0 0 4px;
      background: #fff5f7; border-radius: 8px;
    }
    .fit-checks li {
      position: relative; padding-left: 14px; font-size: 11.5px;
      color: #4a3a40; line-height: 1.55; margin-bottom: 2px;
    }
    .fit-checks li::before {
      content: "·"; position: absolute; left: 4px; top: -2px;
      color: #c2185b; font-size: 18px; font-weight: 700;
    }
    .fit-checks li:last-child { margin-bottom: 0; }
    .fit-verdict {
      font-size: 12.5px; color: #2a1a20; line-height: 1.6;
      background: #fff5f7; border-radius: 8px; padding: 10px 12px;
    }
    .fit-verdict b { color: #c2185b; font-weight: 700; }

    /* 카드 하단 — 활용 방안 */
    .card-foot {
      background: linear-gradient(135deg, #fff0f5 0%, #ffe0e9 100%);
      border-top: 1px solid #f9c6d5;
      padding: 18px 28px;
    }
    .usage-title { font-size: 13px; font-weight: 700; color: #c2185b; margin-bottom: 6px; }
    .usage-text { font-size: 14.5px; color: #2a1a20; line-height: 1.6; font-weight: 500; }
  </style>
</head>
<body>
  <div class="wrap">

    <!-- 헤더: 브랜드·캠페인 정보 -->
    <header class="report-header">
      <div class="report-title">${esc(brand.name)} — 캠페인 트렌드 매칭 리포트</div>
      <div class="report-meta">
        <div class="meta-row"><span class="meta-label">제품</span><span class="meta-value">${esc(brand.product_name)}</span></div>
        <div class="meta-row"><span class="meta-label">카테고리</span><span class="meta-value">${esc(brand.category)}</span></div>
        <div class="meta-row"><span class="meta-label">타겟</span><span class="meta-value">${esc(brand.target_display)}</span></div>
        <div class="meta-row"><span class="meta-label">트렌드</span><span class="meta-value">${contents.length}개 추천</span></div>

        ${
          brand.campaign && (brand.campaign.kpi || brand.campaign.period || brand.campaign.budget)
            ? `<div class="campaign-box">
                 <div class="campaign-title">📣 캠페인 정보</div>
                 <div class="campaign-row">
                   ${brand.campaign.kpi ? `<div><span class="campaign-key">KPI:</span> ${esc(brand.campaign.kpi)}</div>` : ""}
                   ${brand.campaign.period ? `<div><span class="campaign-key">기간:</span> ${esc(brand.campaign.period)}</div>` : ""}
                   ${brand.campaign.budget ? `<div><span class="campaign-key">예산:</span> ${esc(brand.campaign.budget)}</div>` : ""}
                 </div>
               </div>`
            : ""
        }
      </div>
      <div class="gen-info">생성: ${esc(generatedAt)}</div>
    </header>

    <!-- 카드 목록 -->
    ${contents.map(renderCard).join("\n")}

  </div>
</body>
</html>
`;

const outPath = resolve(__dirname, "report-preview.html");
writeFileSync(outPath, html, "utf-8");
console.log(`✅ HTML 미리보기 생성: ${outPath}`);
console.log(`   카드 ${contents.length}개`);
console.log(`   브랜드: ${brand.name} (${brand.product_name})`);
