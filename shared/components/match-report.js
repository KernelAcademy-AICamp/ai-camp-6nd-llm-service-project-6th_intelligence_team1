/* match-report 공유 컴포넌트 — output-design 시안의 트렌드 카드를 데이터 바인딩으로 렌더.
 *
 * 계약 (UI 담당자 합의):
 *   renderMatchReport(el, data)
 *     - el   : 마운트할 DOM 엘리먼트 (부모가 크기·스크롤 소유)
 *     - data : 이미 파싱된 writer-output 의 `data` 객체. {brand, contents:[...]}
 *              ※ 컴포넌트는 URL을 직접 fetch하지 않음. 데이터 주입은 앱(UI)이 소유.
 *   - light DOM 렌더 (Shadow DOM 미사용 — html2pdf 캡처 위해)
 *   - 마크업 클래스는 모두 `.mr-` prefix (match-report.css 와 짝)
 *
 * 함께 로드: match-report.css
 */
(function (global) {
  "use strict";

  // 출처 식별자 → 칩 색상 클래스(브랜드 색) + 표시 라벨.
  var SRC_CHIP = {
    naver_datalab: { cls: "naver", label: "Naver Datalab" },
    naver: { cls: "naver", label: "Naver" },
    naver_blog: { cls: "naver", label: "Naver Blog" },
    naver_news: { cls: "naver", label: "Naver News" },
    naver_olive: { cls: "naver-olive", label: "Naver Olive Young" },
    instagram: { cls: "insta", label: "Instagram" },
    tavily: { cls: "tavily", label: "Tavily" },
    youtube: { cls: "youtube", label: "YouTube" },
  };

  // source 문자열을 보기 좋게: "naver_cafe" → "Naver Cafe"
  function prettifySource(s) {
    return String(s || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  // 출처 → { cls, label }. generic fallback 보장:
  //  - 알려진 source → 지정 색·라벨
  //  - 모르는 source라도 naver 계열이면 naver 색, 그 외엔 회색 기본 칩
  //  - 라벨은 항상 읽을 수 있게 (data label → 없으면 prettify → 최후 "출처")
  //  → 빈 아이콘이 절대 안 뜨고, 새 source가 들어와도 회색 칩으로 안전하게 표시됨
  function chipFor(source, dataLabel) {
    var known = SRC_CHIP[source];
    var cls = known ? known.cls : (/naver/i.test(String(source)) ? "naver" : "");
    // 라벨은 output-text(write.js)가 보낸 dataLabel을 우선 따름 (단일 소스).
    // 라벨이 없거나 원문 source 그대로면 → 컴포넌트 기본(known) → prettify 순 fallback.
    var hasRealLabel = dataLabel && dataLabel !== source;
    var label = hasRealLabel
      ? dataLabel
      : (known ? known.label : prettifySource(source)) || "출처";
    return { cls: cls, label: label };
  }

  // innerHTML 주입 전 텍스트 이스케이프 (데이터에 <, & 등 있어도 깨지지 않게)
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function rankBadgeClass(rank) {
    return rank === 2 ? " mr-r2" : rank === 3 ? " mr-r3" : "";
  }

  function keywordTags(keywords) {
    var arr = (keywords || []).filter(Boolean);
    if (!arr.length) return '<div class="mr-keyword-tags"><span class="mr-empty">—</span></div>';
    var chips = arr
      .map(function (k) { return '<span class="mr-kw-chip">' + esc(k) + "</span>"; })
      .join("");
    return '<div class="mr-keyword-tags">' + chips + "</div>";
  }

  // 정량 지표 — headline_metric(지표·값·증감) + 기간(metrics.period)
  function metricStrip(c) {
    var hm = c.headline_metric || {};
    var period = c.metrics && c.metrics.period;
    var cells = [];
    if (hm.metric || hm.value) {
      var delta = hm.delta ? '<span class="mr-m-delta">' + esc(hm.delta) + "</span>" : "";
      cells.push(
        '<div class="mr-metric"><div class="mr-m-label">' + esc(hm.metric) +
        '</div><div class="mr-m-value">' + esc(hm.value) + delta + "</div></div>"
      );
    }
    if (period) {
      cells.push(
        '<div class="mr-metric"><div class="mr-m-label">기간</div>' +
        '<div class="mr-m-value" style="font-size:14px;">' + esc(period) + "</div></div>"
      );
    }
    return cells.length ? '<div class="mr-metric-strip">' + cells.join("") + "</div>" : "";
  }

  function bulletList(items) {
    var arr = (items || []).filter(Boolean);
    if (!arr.length) return '<div class="mr-empty">—</div>';
    var lis = arr
      .map(function (t) { return "<li>" + esc(t) + "</li>"; })
      .join("");
    return '<ul class="mr-reason-list">' + lis + "</ul>";
  }

  // 링크 가능 판정 — 실제 출처 페이지(경로·쿼리 있음)만 링크.
  //  "https://datalab.naver.com/" 같은 플랫폼 홈(루트)은 링크 안 함
  //  → 클릭 시 엉뚱한 플랫폼 메인으로 가는 것 방지. 특정 글 링크만 클릭됨.
  function isLinkable(url) {
    if (!url || typeof url !== "string") return false;
    try {
      var u = new URL(url);
      var pathLen = u.pathname.replace(/\/+$/, "").length; // 끝 슬래시 제거 후 경로
      return pathLen > 0 || !!u.search || !!u.hash;
    } catch (e) {
      return false; // 파싱 불가 url은 링크 안 함
    }
  }

  // 수집 근거 — 출처 칩(실제 글 링크면 a, 아니면 span) + 설명
  function evidenceList(evidence) {
    var arr = evidence || [];
    if (!arr.length) return '<div class="mr-empty">—</div>';
    var items = arr
      .map(function (e) {
        var chip = chipFor(e.source, e.label);
        var clsAttr = chip.cls ? "mr-src-chip " + chip.cls : "mr-src-chip";
        var inner = isLinkable(e.url)
          ? '<a class="' + clsAttr + '" href="' + esc(e.url) +
            '" target="_blank" rel="noopener noreferrer">' + esc(chip.label) + "</a>"
          : '<span class="' + clsAttr + '">' + esc(chip.label) + "</span>";
        return '<div class="mr-src-item">' + inner + "<span>" + esc(e.description) + "</span></div>";
      })
      .join("");
    return '<div class="mr-src-list">' + items + "</div>";
  }

  // 채널별 현황 — 채널명 + 상태 dot/pill. status enum → 색·라벨 매핑.
  var CH_STATUS = {
    active: { cls: "mr-active", label: "활성" },
    rising: { cls: "mr-rising", label: "부상" },
    stable: { cls: "mr-stable", label: "안정" },
    decline: { cls: "mr-decline", label: "하락" },
    declining: { cls: "mr-decline", label: "하락" },
  };
  function channelList(channels) {
    var arr = (channels || []).filter(Boolean);
    if (!arr.length) return '<div class="mr-empty">—</div>';
    var rows = arr
      .map(function (ch) {
        var st = CH_STATUS[ch.status] || { cls: "mr-stable", label: ch.status || "—" };
        return (
          '<div class="mr-channel-row">' +
            '<span class="mr-ch-name"><span class="mr-ch-dot ' + st.cls + '"></span>' + esc(ch.name) + "</span>" +
            '<span class="mr-ch-status ' + st.cls + '">' + esc(st.label) + "</span>" +
          "</div>"
        );
      })
      .join("");
    return '<div class="mr-channel-list">' + rows + "</div>";
  }

  // 통과 강도 → 색 클래스 (passed/max 비율: 만점=strong, 일부=partial, 0=weak)
  function strengthCls(passed, max) {
    if (passed >= max) return "mr-strong";
    if (passed >= 1) return "mr-partial";
    return "mr-weak";
  }
  // on/off 점 max개 (앞에서부터 passed개 채움)
  function passDots(on, max) {
    var s = "";
    for (var i = 0; i < max; i++) s += '<span class="mr-mp-dot' + (i < on ? " mr-on" : "") + '"></span>';
    return '<span class="mr-mp-dots">' + s + "</span>";
  }
  // 질문 1행 — 라벨 + 점 + 분수 + 서브설명
  function passesRow(label, sub, passed, max) {
    return (
      '<div class="mr-mp-passes-row ' + strengthCls(passed, max) + ' mr-with-sub">' +
        '<span class="mr-mp-q">' + esc(label) + "</span>" +
        passDots(passed, max) +
        '<span class="mr-mp-frac">' + passed + "/" + max + "</span>" +
      "</div>" +
      '<div class="mr-mp-sub">' + esc(sub) + "</div>"
    );
  }
  // 4기준 상세 (어떻게 평가했나요) — match_fits 바인딩
  var FIT_LABELS = { ingred: "성분 적합성", visual: "비주얼 적합성", life: "라이프스타일 적합성", safe: "브랜드 안전성" };
  function fitsDetails(fits) {
    if (!fits) return "";
    var groups = ["ingred", "visual", "life", "safe"]
      .filter(function (k) { return fits[k]; })
      .map(function (k) {
        var f = fits[k];
        return (
          '<div class="mr-ed-group">' +
            '<div class="mr-ed-group-title">' + esc(f.result || "") + " " + esc(FIT_LABELS[k]) + "</div>" +
            '<div class="mr-ed-reason">' + esc(f.reason || "") + "</div>" +
          "</div>"
        );
      })
      .join("");
    if (!groups) return "";
    return (
      '<details class="mr-eval-details"><summary>어떻게 평가했나요?</summary>' +
        '<div class="mr-ed-body">' + groups + "</div>" +
      "</details>"
    );
  }
  // 매칭 결과 — 통과 합계 바 + q1/q2 행 + 4기준 상세 (mockup 'Match Passes' 이식)
  function passesBlock(c) {
    var mp = c.match_passes;
    if (!mp) return '<div class="mr-empty">—</div>';
    var total = mp.total != null ? mp.total : (mp.q1 || 0) + (mp.q2 || 0);
    var pct = Math.round((total / 4) * 100);
    return (
      '<div class="mr-mp-total">4개 비교 중 ' + esc(total) + "개 통과</div>" +
      '<div class="mr-match-passes-bar ' + strengthCls(total, 4) + '">' +
        '<div class="mr-mpb-fill" style="width:' + pct + '%"></div>' +
      "</div>" +
      passesRow("브랜드 적합성", "톤·키워드가 트렌드와 맞는지", mp.q1 || 0, 2) +
      passesRow("타겟 적합성", "우리 고객층·라이프스타일이 트렌드와 맞는지", mp.q2 || 0, 2) +
      fitsDetails(c.match_fits)
    );
  }

  function card(c, i) {
    var letter = String.fromCharCode(65 + i); // 0→A, 1→B, 2→C
    var isWarn = c.rank === 3 || c.display_variant === "supplementary";
    var warnCls = isWarn ? " mr-warn" : "";
    var warnNote = c.rank === 3 ? '<span class="mr-warn-note">⚠️ 보완 활용 권장</span>' : "";

    return (
      '<div class="mr-trend-card' + warnCls + '">' +
        '<div class="mr-card-top">' +
          '<div class="mr-rank-row">' +
            '<span class="mr-rank-badge' + rankBadgeClass(c.rank) + '">' + esc(c.rank) + "순위</span>" +
            '<span class="mr-group-letter">' + letter + "</span>" +
            warnNote +
          "</div>" +
          '<h3 class="mr-h3">' + esc(c.trend_name) + "</h3>" +
          keywordTags(c.keywords) +
        "</div>" +
        '<div class="mr-card-body">' +
          metricStrip(c) +
          '<div class="mr-block">' +
            '<div class="mr-block-label"><span class="mr-ico">📊</span> 유행현황 (Status)</div>' +
            bulletList(c.summary_bullets) +
          "</div>" +
          '<div class="mr-block">' +
            '<div class="mr-block-label"><span class="mr-ico">📚</span> 수집 근거</div>' +
            evidenceList(c.evidence) +
          "</div>" +
          '<div class="mr-block">' +
            '<div class="mr-block-label"><span class="mr-ico">🎯</span> 매칭이유</div>' +
            bulletList(c.reason_bullets) +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function letterOf(i) { return String.fromCharCode(65 + i); } // 0→A, 1→B
  function rankClass(i) { return i === 0 ? "mr-r1" : i === 1 ? "mr-r2" : "mr-r3"; }

  // 섹션 헤더 — badge + title + (선택)desc. isData면 DATA 배지 스타일.
  function sectionHead(badge, title, desc, isData) {
    return (
      '<div class="mr-section-head">' +
        '<span class="mr-section-badge' + (isData ? " mr-data" : "") + '">' + esc(badge) + "</span>" +
        '<h2 class="mr-section-title">' + esc(title) + "</h2>" +
        (desc ? '<span class="mr-section-desc">' + esc(desc) + "</span>" : "") +
      "</div>"
    );
  }

  // PART I — Trend Summary (A/B/C + 트렌드명 + 한 줄 요약)
  function summarySection(contents) {
    var items = contents
      .map(function (c, i) {
        var body = (c.summary_bullets && c.summary_bullets[0]) || c.trend_name;
        return (
          '<div class="mr-summary-item">' +
            '<div class="mr-summary-letter">' + letterOf(i) + "</div>" +
            '<div class="mr-summary-text">' +
              '<p class="mr-summary-title">' + esc(c.trend_name) + "</p>" +
              '<p class="mr-summary-body">' + esc(body) + "</p>" +
            "</div>" +
          "</div>"
        );
      })
      .join("");
    return (
      sectionHead("PART I", "Trend Summary", "트렌드 요약") +
      '<div class="mr-summary-card"><div class="mr-summary-list">' + items + "</div></div>"
    );
  }

  // DATA G3 — 트렌드 점수 비교 그래프 (매칭 통과수 total/4 × 100 = 0~100점)
  function compareCard(contents) {
    var rows = contents
      .map(function (c, i) {
        var mp = c.match_passes || {};
        var total = mp.total != null ? mp.total : (mp.q1 || 0) + (mp.q2 || 0);
        var score = Math.round((total / 4) * 100);
        return (
          '<div class="mr-compare-row">' +
            '<div class="mr-compare-label">' +
              '<span class="mr-group-letter">' + letterOf(i) + "</span>" +
              '<span class="mr-compare-name">' + esc(c.trend_name) + "</span>" +
            "</div>" +
            '<div class="mr-compare-bar-track">' +
              '<div class="mr-compare-bar-fill ' + rankClass(i) + '" style="width:' + score + '%"><span>' + score + "</span></div>" +
            "</div>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="mr-compare-card"><div class="mr-compare-head">트렌드 점수 비교 (매칭 점수)</div>' +
        '<div class="mr-compare-list">' + rows + "</div>" +
      "</div>"
    );
  }

  // growth_rate(소수 0.22) → 정수 퍼센트(22). 부호 유지, 숫자 아니면 null.
  function growthPct(g) {
    if (typeof g !== "number") return null;
    return Math.round(g * 100);
  }

  // DATA — 트렌드별 데이터카드 (점수·성장률 + 매칭결과 + 채널별현황)
  function dataCard(c, i) {
    var mp = c.match_passes || {};
    var total = mp.total != null ? mp.total : (mp.q1 || 0) + (mp.q2 || 0);
    var score = Math.round((total / 4) * 100);
    var gp = growthPct(c.metrics && c.metrics.growth_rate);
    var warnCls =
      c.match_strength === "weak" || c.display_variant === "supplementary" ? " mr-warn" : "";
    var growthHtml =
      gp == null
        ? ""
        : '<div class="mr-growth-pill ' + (gp >= 0 ? "mr-up" : "mr-down") + '">' +
          '<span><span class="mr-arrow">' + (gp >= 0 ? "▲" : "▼") + "</span>" +
          (gp >= 0 ? "+" : "") + gp + "%</span>" +
          '<span class="mr-growth-sub">3개월</span>' +
          "</div>";
    return (
      '<div class="mr-data-card' + warnCls + '">' +
        '<div class="mr-data-card-head">' +
          '<span class="mr-group-letter">' + letterOf(i) + "</span>" +
          '<span class="mr-data-card-name">' + esc(c.trend_name) + "</span>" +
          '<span class="mr-rank-badge' + rankBadgeClass(c.rank) + '">' + esc(c.rank) + "순위</span>" +
        "</div>" +
        '<div class="mr-data-block">' +
          '<div class="mr-db-label">점수 · 성장률</div>' +
          '<div class="mr-score-row">' +
            '<div class="mr-big-score"><div class="mr-m-label">매칭 점수</div><div class="mr-m-value-xl">' + score + "</div></div>" +
            growthHtml +
          "</div>" +
          '<div class="mr-mini-bar"><div class="mr-mini-bar-fill ' + rankClass(i) + '" style="width:' + score + '%"></div></div>' +
        "</div>" +
        '<div class="mr-data-block">' +
          '<div class="mr-db-label">매칭 결과</div>' +
          passesBlock(c) +
        "</div>" +
        '<div class="mr-data-block">' +
          '<div class="mr-db-label">채널별 현황</div>' +
          channelList(c.channels) +
        "</div>" +
      "</div>"
    );
  }

  // 최상단 리포트 헤더 (브랜드·제품·카테고리·타겟). brand 객체 또는 평평한 필드 모두 허용.
  function headerSection(b) {
    b = b || {};
    var name = b.name || b.brand_name || "";
    var product = b.product_name || "";
    var category = b.category || "";
    var target = b.target_display || b.target || "";
    var chips = "";
    if (product) chips += '<div class="mr-meta-chip"><span class="mr-dot"></span><strong>제품</strong> ' + esc(product) + "</div>";
    if (category) chips += '<div class="mr-meta-chip"><span class="mr-dot mr-dot-b"></span><strong>카테고리</strong> ' + esc(category) + "</div>";
    if (target) chips += '<div class="mr-meta-chip"><span class="mr-dot mr-dot-c"></span><strong>타겟</strong> ' + esc(target) + "</div>";
    return (
      '<div class="mr-report-header">' +
        '<span class="mr-report-eyebrow">● Beauty × Trend Matching</span>' +
        '<h1 class="mr-report-title">' + esc(name) + " — 캠페인 트렌드 매칭 리포트</h1>" +
        '<p class="mr-report-sub">브랜드 톤·타겟과 트렌드의 적합도를 분석했습니다.</p>' +
        (chips ? '<div class="mr-meta-row">' + chips + "</div>" : "") +
      "</div>"
    );
  }

  /**
   * full 매칭 리포트 렌더 (헤더 → PART I 요약 → PART II 카드 → DATA 점수비교+데이터카드).
   * @param {HTMLElement} el  - 마운트 대상
   * @param {object} data     - writer-output 의 `data` (또는 envelope 전체도 방어적으로 허용)
   */
  function renderMatchReport(el, data) {
    if (!el) throw new Error("renderMatchReport: 마운트할 el이 필요합니다.");
    // envelope({data:{...}}) 통째로 들어와도 방어적으로 언래핑
    var d = data && data.data ? data.data : data || {};
    var contents = d.contents || [];
    var brand = d.brand || d;
    if (!contents.length) {
      el.innerHTML = '<div class="mr-report">' + headerSection(brand) + '<div class="mr-empty">—</div></div>';
      return el;
    }
    el.innerHTML =
      '<div class="mr-report">' +
        headerSection(brand) +
        summarySection(contents) +
        sectionHead("PART II", "트렌드 카드", "유행현황 · 수집 근거 · 매칭이유") +
        '<div class="mr-trend-grid">' + contents.map(card).join("") + "</div>" +
        sectionHead("📊 DATA", "정량 분석", "점수 · 성장률 · 매칭 결과 · 채널별 현황", true) +
        compareCard(contents) +
        '<div class="mr-data-grid">' + contents.map(dataCard).join("") + "</div>" +
      "</div>";
    return el;
  }

  // 전역 노출 (바닐라 UI에서 <script> 로드 후 호출) + node require 지원(테스트용)
  global.renderMatchReport = renderMatchReport;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderMatchReport: renderMatchReport };
  }
})(typeof window !== "undefined" ? window : globalThis);
