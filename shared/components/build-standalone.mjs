/* match-report 컴포넌트를 "피그마에 붙여넣을 단일 HTML"로 굽는 빌드 스크립트.
 *
 * 하는 일:
 *   1) match-report.js 를 로드 → globalThis.renderMatchReport 등록 (side-effect)
 *   2) writer-output.json 의 data 를 주입해 리포트 마크업을 "미리" 렌더 (정적 HTML 문자열)
 *   3) match-report.css 를 <style> 로 인라인 + 페이지 래퍼(배경/폰트/가운데정렬) 추가
 *   4) shared/components/match-report.standalone.html 로 저장
 *
 * → JS 실행 없이도(=피그마 플러그인이 코드만 읽어도) 화면이 그대로 보이는 자기완결형 파일.
 *
 * 실행: node shared/components/build-standalone.mjs
 *   다른 writer-output 으로 굽고 싶으면: node shared/components/build-standalone.mjs <경로.json>
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// 1) 컴포넌트 로드 — 파일 끝에서 globalThis.renderMatchReport 를 등록함
await import("./match-report.js");
if (typeof globalThis.renderMatchReport !== "function") {
  throw new Error("renderMatchReport 가 등록되지 않았습니다 — match-report.js 확인");
}

// 2) 데이터 로드 (인자로 경로 받으면 그걸, 없으면 기본 writer-output)
const dataPath =
  process.argv[2] || join(ROOT, "output-main", "output-text", "writer-output.json");
const envelope = JSON.parse(await readFile(dataPath, "utf-8"));
const data = envelope && envelope.data ? envelope.data : envelope;

// renderMatchReport(el, data) 는 el.innerHTML 에 마크업을 써넣음 → 가짜 el 로 문자열만 회수
const fakeEl = {};
globalThis.renderMatchReport(fakeEl, data);
const reportMarkup = fakeEl.innerHTML || "";

// 3) CSS 인라인 + 페이지 래퍼
const css = await readFile(join(__dirname, "match-report.css"), "utf-8");

const brandName = (data.brand && (data.brand.name || data.brand.brand_name)) || "매칭 리포트";

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${brandName} — 매칭 리포트</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
/>
<style>
/* ── 페이지 래퍼: 컴포넌트는 자기 폭/배경/폰트를 안 잡음(부모 소유) → 여기서 제공 ── */
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; }
body{
  font-family:"Pretendard",-apple-system,"Apple SD Gothic Neo",sans-serif;
  background:#faf6f8;
  color:#4a424a;
  -webkit-font-smoothing:antialiased;
}
.mr-page{
  max-width:1080px;
  margin:0 auto;
  padding:40px 24px 64px;
}
/* ── 컴포넌트 스타일 (shared/components/match-report.css 인라인) ── */
${css}
</style>
</head>
<body>
  <div class="mr-page">
${reportMarkup}
  </div>
</body>
</html>
`;

const outPath = join(__dirname, "match-report.standalone.html");
await writeFile(outPath, html, "utf-8");
console.log(`✅ 생성 완료 → ${outPath}`);
console.log(`   데이터 출처: ${dataPath}`);
console.log(`   브랜드: ${brandName} / 카드 ${(data.contents || []).length}개`);
