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
    naver_blog: { cls: "naver", label: "Naver 블로그" },
    naver_news: { cls: "naver", label: "Naver 뉴스" },
    naver_olive: { cls: "naver-olive", label: "Naver 올리브영" },
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
    if (known) return known;
    // dataLabel이 원문 source 그대로면(작성가가 라벨 못 붙인 경우) prettify
    var hasRealLabel = dataLabel && dataLabel !== source;
    return {
      cls: /naver/i.test(String(source)) ? "naver" : "",
      label: (hasRealLabel ? dataLabel : prettifySource(source)) || "출처",
    };
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

  // 수집 근거 — 출처 칩(링크 있으면 a, 없으면 span) + 설명
  function evidenceList(evidence) {
    var arr = evidence || [];
    if (!arr.length) return '<div class="mr-empty">—</div>';
    var items = arr
      .map(function (e) {
        var chip = chipFor(e.source, e.label);
        var clsAttr = chip.cls ? "mr-src-chip " + chip.cls : "mr-src-chip";
        var inner = e.url
          ? '<a class="' + clsAttr + '" href="' + esc(e.url) +
            '" target="_blank" rel="noopener noreferrer">' + esc(chip.label) + "</a>"
          : '<span class="' + clsAttr + '">' + esc(chip.label) + "</span>";
        return '<div class="mr-src-item">' + inner + "<span>" + esc(e.description) + "</span></div>";
      })
      .join("");
    return '<div class="mr-src-list">' + items + "</div>";
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

  /**
   * 트렌드 카드 리포트를 el 안에 렌더.
   * @param {HTMLElement} el  - 마운트 대상
   * @param {object} data     - writer-output 의 `data` (또는 envelope 전체도 방어적으로 허용)
   */
  function renderMatchReport(el, data) {
    if (!el) throw new Error("renderMatchReport: 마운트할 el이 필요합니다.");
    // envelope({data:{...}}) 통째로 들어와도 방어적으로 언래핑
    var d = data && data.data ? data.data : data || {};
    var contents = d.contents || [];
    var cards = contents.length
      ? contents.map(card).join("")
      : '<div class="mr-empty">—</div>';
    el.innerHTML = '<div class="mr-report"><div class="mr-trend-grid">' + cards + "</div></div>";
    return el;
  }

  // 전역 노출 (바닐라 UI에서 <script> 로드 후 호출) + node require 지원(테스트용)
  global.renderMatchReport = renderMatchReport;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderMatchReport: renderMatchReport };
  }
})(typeof window !== "undefined" ? window : globalThis);
