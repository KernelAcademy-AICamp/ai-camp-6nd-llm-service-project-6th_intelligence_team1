// 효희님 리포트 디자인(docs/report-preview.html)에 실제 writer-output 데이터를 주입.
// → preview/report-live.html 생성 (효희님 디자인 + 실데이터 통합 화면)
//
// 원리:
//   docs/report-preview.html 은 var SAMPLE_DATA = {목업} 을 renderMatchReport 에 넘김.
//   이 빌더는 그 SAMPLE_DATA 자리를 실제 writer-output.json 의 data 로 교체.
//   효희님 컴포넌트(match-report.css/js)는 건드리지 않고 읽기만 함 (CSS/JS 경로만 보정).
//
// 사용법:
//   node preview/build-live-preview.mjs
//   → preview/report-live.html 생성 → 더블클릭 또는 open 으로 열기
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const TEMPLATE_PATH = resolve(PROJECT_ROOT, "docs/report-preview.html");
const WRITER_PATH = resolve(PROJECT_ROOT, "output-main/output-text/writer-output.json");
const OUT_PATH = resolve(__dirname, "report-live.html");

// 1) 효희님 디자인 템플릿 읽기
let html = readFileSync(TEMPLATE_PATH, "utf-8");

// 2) 실제 writer-output 의 data 객체 읽기
const writer = JSON.parse(readFileSync(WRITER_PATH, "utf-8"));
const liveData = writer.data;
if (!liveData || !liveData.brand || !Array.isArray(liveData.contents)) {
  console.error("❌ writer-output.json 의 data.{brand, contents} 구조를 찾지 못했습니다.");
  process.exit(1);
}

// 3) CSS/JS 상대경로 보정
//    템플릿은 docs/ 기준 "../shared/..." 인데, 결과물은 preview/ 에 생기므로 동일하게 "../shared/..." 면 OK.
//    (docs/ 와 preview/ 둘 다 루트 한 단계 아래라 상대경로 동일 → 보정 불필요)

// 4) SAMPLE_DATA = {...}; 블록을 실데이터로 교체
//    "var SAMPLE_DATA = " 부터 그 뒤 첫 "};" 까지를 통째로 치환.
const startMarker = "var SAMPLE_DATA = ";
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) {
  console.error("❌ 템플릿에서 'var SAMPLE_DATA = ' 를 찾지 못했습니다.");
  process.exit(1);
}
// 객체 끝(};) 찾기: startIdx 이후 첫 "\n    };" 또는 "};"
const afterStart = startIdx + startMarker.length;
const endIdx = html.indexOf("};", afterStart);
if (endIdx === -1) {
  console.error("❌ SAMPLE_DATA 객체의 끝('};')을 찾지 못했습니다.");
  process.exit(1);
}

const injected =
  startMarker +
  JSON.stringify(liveData, null, 2) +
  ";  /* ← 실데이터 주입 (writer-output.json) */";

html = html.slice(0, startIdx) + injected + html.slice(endIdx + 2);

// 5) 제목에 [실데이터] 표시 (목업과 구분)
html = html.replace(
  /<title>[^<]*<\/title>/,
  `<title>${liveData.brand.name} — 실데이터 리포트 (통합 미리보기)</title>`
);

writeFileSync(OUT_PATH, html, "utf-8");

console.log("✅ 통합 미리보기 생성: " + OUT_PATH);
console.log(`   브랜드: ${liveData.brand.name} (${liveData.brand.product_name ?? ""})`);
console.log(`   카드 ${liveData.contents.length}개`);
console.log("   → open preview/report-live.html 로 열기");
