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
        '<div class="mr-m-value">' + esc(period) + "</div></div>"
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

  // 번호 박스 리스트 (매칭이유 등) — 연핑크 배경 + 핑크 stroke + 번호 배지
  function numberedList(items) {
    var arr = (items || []).filter(Boolean);
    if (!arr.length) return '<div class="mr-empty">—</div>';
    var lis = arr
      .map(function (t, i) {
        return (
          '<div class="mr-num-item"><span class="mr-num">' + (i + 1) + "</span>" +
            "<span>" + esc(t) + "</span></div>"
        );
      })
      .join("");
    return '<div class="mr-num-list">' + lis + "</div>";
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
        // 박스 없이 선(밑줄) 구분 — 출처 칩(제목) + 설명
        return (
          '<div class="mr-src-item">' + inner +
            '<span class="mr-src-desc">' + esc(e.description) + "</span></div>"
        );
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
  // 매칭 분석 상세 (어떻게 평가했나요) — c.match_reasons 바인딩.
  // 옛 match_fits 4기준 + reason_bullets 분리 영역을 한 곳으로 통합한 구조.
  function reasonsDetails(reasons) {
    if (!Array.isArray(reasons) || reasons.length === 0) return "";
    var groups = reasons
      .map(function (r) {
        var resultPrefix = r.result ? esc(r.result) + " " : "";
        return (
          '<div class="mr-ed-group">' +
            '<div class="mr-ed-group-title">' + resultPrefix + esc(r.title || "") + "</div>" +
            (r.summary ? '<div class="mr-ed-summary">' + esc(r.summary) + "</div>" : "") +
            '<div class="mr-ed-reason">' + esc(r.detail || "") + "</div>" +
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
  // 매칭 결과 — 통과 합계 바 + q1/q2 행 + 상세 (mockup 'Match Passes' 이식)
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
      reasonsDetails(c.match_reasons)
    );
  }

  // 신뢰도 — c.confidence(높음/중간/낮음 또는 high/mid/low) 우선, 없으면 evidence 개수로 추정
  function confidenceOf(c) {
    var MAP = { "높음": "high", high: "high", "중간": "mid", mid: "mid", "낮음": "low", low: "low" };
    var lvl = c.confidence ? (MAP[c.confidence] || "mid") : null;
    if (!lvl) {
      var n = (c.evidence || []).length;
      lvl = n >= 3 ? "high" : n === 2 ? "mid" : "low";
    }
    return { lvl: lvl, label: { high: "높음", mid: "중간", low: "낮음" }[lvl] };
  }

  // 출처 코드 → 사람이 읽는 라벨
  function srcLabel(s) {
    var M = {
      youtube: "유튜브",
      naver_blog: "네이버 블로그",
      naver_news: "네이버 뉴스",
      naver_datalab: "네이버 데이터랩",
      tavily: "Tavily",
    };
    return M[s] || s;
  }

  // 신뢰도 호버 툴팁 — confidence_basis(출처종류·신선·검증·기간)를 근거로 노출
  function confidenceTip(b) {
    function rowEl(k, v) {
      return (
        '<span class="mr-conf-tip-row"><span class="mr-conf-tip-k">' + k +
        '</span><span class="mr-conf-tip-v">' + esc(v) + "</span></span>"
      );
    }
    var types = (b.source_types || []).map(srcLabel);
    var srcText = types.length
      ? types.join("·") + " " + types.length + "종"
      : (b.source_count || 0) + "종";
    var rows =
      rowEl("출처", srcText) +
      rowEl("신선도", "최근 30일 근거 " + (b.fresh_count || 0) + "건") +
      rowEl("검증", "원문 확인 " + (b.verifiable_count || 0) + "/" + (b.total_evidence || 0) + "건");
    if (b.period) rows += rowEl("기간", b.period);
    return (
      '<span class="mr-conf-tip" role="tooltip">' +
        '<span class="mr-conf-tip-head">이 신뢰도의 근거</span>' +
        rows +
        '<span class="mr-conf-tip-foot">출처 종류·최신성·검증가능성으로 산출</span>' +
      "</span>"
    );
  }

  function card(c) {
    var rankCls = " mr-c" + (c.rank || 1); // 순위별 카드 색 구분 (mr-c1/c2/c3)
    // "보완 활용 권장" 배지 — 매칭 기준(q1/q2 passes·rank)과 별개. Safe-Fit 신호에만 연동.
    // Safe-Fit = 트렌드 수명·추세 위험: 쇠퇴기(declining) OR 마이너스 성장(growth_rate < 0).
    var gr = typeof c.growth_rate === "number" ? c.growth_rate : null;
    var isRisky = c.trend_stage === "declining" || (gr != null && gr < 0);
    var warnNote = isRisky ? '<span class="mr-warn-note">⚠️ 보완 활용 권장</span>' : "";
    var stage = c.trend_stage && TREND_STAGE[c.trend_stage];
    var stageChip = stage ? '<span class="mr-stage-chip">' + stage + "</span>" : "";
    var conf = confidenceOf(c);
    // 정도 미터 — 높음=3칸, 중간=2칸, 낮음=1칸
    var filled = conf.lvl === "high" ? 3 : conf.lvl === "mid" ? 2 : 1;
    var bars = "";
    for (var bi = 0; bi < 3; bi++) bars += '<span class="mr-conf-bar' + (bi < filled ? " mr-on" : "") + '"></span>';
    var basis = c.confidence_basis;
    var confChip =
      '<span class="mr-conf mr-conf-' + conf.lvl + (basis ? " mr-conf-has-tip" : "") + '"' +
        (basis ? ' tabindex="0"' : "") + ">신뢰도 " + conf.label +
        '<span class="mr-conf-meter">' + bars + "</span>" +
        (basis ? confidenceTip(basis) : "") +
      "</span>";

    // 카드 전체를 <details>로 — 헤더(summary) 클릭 시 본문 접기/펼치기 (네이티브, JS 불필요)
    // 디폴트: 1위만 펼침(open), 2·3위는 접힘
    var openAttr = c.rank === 1 ? " open" : "";
    return (
      '<details class="mr-trend-card mr-wide' + rankCls + '"' + openAttr + ">" +
        '<summary class="mr-card-top">' +
          '<div class="mr-rank-row">' +
            '<span class="mr-rank-badge' + rankBadgeClass(c.rank) + '">' + esc(c.rank) + "순위</span>" +
            stageChip +
            warnNote +
            confChip +
            '<span class="mr-card-toggle" aria-hidden="true">▾</span>' +
          "</div>" +
          '<h3 class="mr-h3">' + esc(c.trend_name) + "</h3>" +
          keywordTags(c.keywords) +
          metricStrip(c) +   // 지표(검색량 지수·기간) — 핑크 헤더 박스 안. 접으면 CSS로 숨김
        "</summary>" +
        // 단일 컬럼 — 이미지 순서: (헤더 안 지표) → 유행현황 → 수집근거 → 매칭이유 → 매칭 설명
        '<div class="mr-card-body">' +
          '<div class="mr-block">' +
            '<div class="mr-block-label"><span class="mr-ico">≡</span> 유행현황 (Status)</div>' +
            bulletList(c.summary_bullets) +
          "</div>" +
          '<details class="mr-block mr-evidence-details">' +
            '<summary class="mr-block-label"><span class="mr-ico">≡</span> 수집 근거</summary>' +
            evidenceList(c.evidence) +
          "</details>" +
          '<div class="mr-block">' +
            '<div class="mr-block-label"><span class="mr-ico">≡</span> 매칭 분석</div>' +
            matchExplain(c.match_reasons) +
          "</div>" +
        "</div>" +
        // 활용 방안 — 카드 하단 전체 폭
        '<div class="mr-card-usage">' +
          '<div class="mr-block-label"><span class="mr-ico">≡</span> 활용 방안</div>' +
          (c.usage_plan
            ? '<div class="mr-usage">' + esc(c.usage_plan) + "</div>"
            : '<div class="mr-usage mr-fit-placeholder">활용방안 작성</div>') +
        "</div>" +
      "</details>"
    );
  }

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

  // PART I — 트렌드 요약 (순위 + 트렌드명 + 한 줄 요약)
  function summarySection(contents) {
    var items = contents
      .map(function (c) {
        var body = (c.summary_bullets && c.summary_bullets[0]) || c.trend_name;
        return (
          '<div class="mr-summary-item">' +
            '<div class="mr-summary-letter">' + esc(c.rank) + "</div>" +
            '<div class="mr-summary-text">' +
              '<p class="mr-summary-title">' + esc(c.trend_name) + "</p>" +
              '<p class="mr-summary-body">' + esc(body) + "</p>" +
            "</div>" +
          "</div>"
        );
      })
      .join("");
    return (
      sectionHead("PART I", "트렌드 요약", "") +
      '<div class="mr-summary-card"><div class="mr-summary-list">' + items + "</div></div>"
    );
  }

  // growth_rate(소수 0.22) → 정수 퍼센트(22). 부호 유지, 숫자 아니면 null.
  // trend_stage → 한국어 라벨 (없으면 미표시)
  var TREND_STAGE = { emerging: "📈 상승 중", peak: "🔥 정점", declining: "📉 하락" };
  // 각 매칭 기준이 '무엇을 보는지' 보조 설명 — match_reasons[].id로 매핑.
  // 1: 제품·제형, 2: 매체·톤, 3: 타겟. 시장성(옛 safe)은 통합 매칭 분석에서 제외.
  var REASON_DESC = {
    1: "제품 성분·제형 ↔ 트렌드 핵심",
    2: "브랜드 채널·톤앤매너 ↔ 트렌드 표현 방식",
    3: "타겟 연령·라이프스타일·니즈 ↔ 트렌드 소비층",
  };
  // 판정 → 태그(라벨·색)
  var FIT_RESULT = {
    "✅": { tag: "적합", cls: "mr-fit-ok" },
    "⚠️": { tag: "부분 적합", cls: "mr-fit-mid" },
    "❌": { tag: "부적합", cls: "mr-fit-no" },
  };

  // 트렌드 지표 — 검색량 지수(headline_metric) + 트렌드 단계(trend_stage, 없으면 graceful)
  function trendMetrics(c) {
    var hm = c.headline_metric || {};
    var rows = "";
    if (hm.value) {
      var delta = hm.delta ? ' <span class="mr-m-delta">' + esc(hm.delta) + "</span>" : "";
      rows +=
        '<div class="mr-metric-row"><span class="mr-mr-label">' + esc(hm.metric || "검색량 지수") + "</span>" +
        '<span class="mr-mr-value">' + esc(hm.value) + delta + "</span></div>";
    }
    var stage = c.trend_stage && TREND_STAGE[c.trend_stage];
    if (stage) {
      rows += '<div class="mr-metric-row"><span class="mr-mr-label">트렌드 단계</span><span class="mr-mr-value">' + stage + "</span></div>";
    }
    return rows || '<div class="mr-empty">—</div>';
  }

  // 매칭 설명 — match_reasons 3항목(제품·제형 / 매체·톤 / 타겟) 통합 렌더링.
  // 옛 reason_bullets(요약) + match_fits(상세)가 같은 트렌드 매칭을 두 영역으로
  // 두 번 보여주던 중복을 한 영역으로 통합한 구조. summary 한 줄 + detail 한 단락.
  function matchExplain(reasons) {
    if (!Array.isArray(reasons) || reasons.length === 0) {
      return '<div class="mr-empty">—</div>';
    }
    var rows = reasons
      .map(function (r) {
        var resTag = FIT_RESULT[r.result] || { tag: "", cls: "" };
        var tag = resTag.tag
          ? '<span class="mr-fit-tag ' + resTag.cls + '">' + esc(r.result || "") + " " + resTag.tag + "</span>"
          : "";
        var summary = r.summary
          ? '<div class="mr-fit-summary">' + esc(r.summary) + "</div>"
          : "";
        var detail = r.detail
          ? '<div class="mr-fit-reason">' + esc(r.detail) + "</div>"
          : '<div class="mr-fit-reason mr-fit-placeholder">여기에 어떤 기준으로 매칭했는지 작성</div>';
        return (
          '<div class="mr-fit-row">' +
            '<div class="mr-fit-head"><span class="mr-fit-name">' + esc(r.title || "") + "</span>" + tag + "</div>" +
            '<div class="mr-fit-desc">' + esc(REASON_DESC[r.id] || "") + "</div>" +
            summary +
            detail +
          "</div>"
        );
      })
      .join("");
    return rows || '<div class="mr-empty">—</div>';
  }

  // DATA — 트렌드별 데이터카드 (검색량 지수·트렌드 단계 + 매칭 설명)
  function dataCard(c) {
    var warnCls =
      c.match_strength === "weak" || c.display_variant === "supplementary" ? " mr-warn" : "";
    return (
      '<div class="mr-data-card' + warnCls + '">' +
        '<div class="mr-data-card-head">' +
          '<span class="mr-data-card-name">' + esc(c.trend_name) + "</span>" +
          '<span class="mr-rank-badge' + rankBadgeClass(c.rank) + '">' + esc(c.rank) + "순위</span>" +
        "</div>" +
        '<div class="mr-data-block">' +
          '<div class="mr-db-label">트렌드 지표</div>' +
          trendMetrics(c) +
        "</div>" +
        '<div class="mr-data-block">' +
          '<div class="mr-db-label">매칭 분석</div>' +
          matchExplain(c.match_reasons) +
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
    // funnel — 박스 3개: 훑어본 데이터 N → 정제된 트렌드 M → 리포트 선별 K
    //  raw_count·trend_count는 트렌드 분석가 산출물(있으면 표시), K는 항상 contents 길이
    var steps = [];
    if (d.raw_count) steps.push({
      label: "전체 수집 데이터",
      platforms: d.platforms || "YouTube · 네이버 · Tavily · 데이터랩",
      value: d.raw_count,
      note: "훑어본 데이터",
    });
    if (d.used_data_count) steps.push({ label: "활용된 데이터", value: d.used_data_count, note: "리포트 구성 활용" });
    var funnel = steps.length
      ? '<div class="mr-funnel">' +
          steps
            .map(function (s) {
              return (
                '<div class="mr-funnel-card">' +
                  '<div class="mr-fc-label">' + esc(s.label) + "</div>" +
                  '<div class="mr-fc-value">' + esc(s.value) + '<span class="mr-fc-unit">개</span></div>' +
                  '<div class="mr-fc-note">' + esc(s.note) +
                    (s.platforms ? '<span class="mr-fc-platforms">' + esc(s.platforms) + "</span>" : "") +
                  "</div>" +
                "</div>"
              );
            })
            .join("") +
        "</div>"
      : "";
    el.innerHTML =
      '<div class="mr-report">' +
        headerSection(brand) +
        funnel +
        summarySection(contents) +
        sectionHead("PART II", "트렌드 카드", "유행현황 · 수집 근거 · 매칭이유 · 매칭 기준") +
        '<div class="mr-trend-grid">' + contents.map(card).join("") + "</div>" +
      "</div>";
    return el;
  }

  // 전역 노출 (바닐라 UI에서 <script> 로드 후 호출) + node require 지원(테스트용)
  global.renderMatchReport = renderMatchReport;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderMatchReport: renderMatchReport };
  }
})(typeof window !== "undefined" ? window : globalThis);
