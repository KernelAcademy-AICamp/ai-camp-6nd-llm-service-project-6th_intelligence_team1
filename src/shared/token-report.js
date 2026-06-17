// 단계별 토큰 소진 현황을 표로 출력한다.
//
//   npm run tokens          → 단계별 토큰·비용·비중 표 출력
//   npm run tokens:reset    → 누적 로그 초기화 (다음 측정을 깨끗하게)
//
// shared/data/token-usage.json 을 읽어 비용 큰 순으로 보여준다.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "../../shared/data/token-usage.json");

// 단계 키 → 한글 이름
const STAGE_KR = {
  brand: "브랜드분석가",
  trend: "트렌드분석가",
  match: "매칭가",
  "designer-v2": "시안가",
  writer: "작성가",
};

if (process.argv.includes("--reset")) {
  writeFileSync(
    LOG_PATH,
    JSON.stringify({ updated_at: new Date().toISOString(), totals_by_stage: {}, runs: [] }, null, 2),
    "utf-8",
  );
  console.log("🧹 토큰 로그 초기화 완료:", LOG_PATH);
  process.exit(0);
}

if (!existsSync(LOG_PATH)) {
  console.log("아직 토큰 로그가 없습니다. 파이프라인을 한 번 실행한 뒤 다시 확인하세요.");
  process.exit(0);
}

const log = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
const stages = Object.entries(log.totals_by_stage ?? {});
if (stages.length === 0) {
  console.log("기록된 단계가 없습니다. 파이프라인을 실행해 보세요.");
  process.exit(0);
}

const totalCost = stages.reduce((s, [, t]) => s + t.cost_usd, 0);
const totalTok = stages.reduce(
  (s, [, t]) => s + t.input_tokens + t.cache_write_tokens + t.cache_read_tokens + t.output_tokens,
  0,
);

// 비용 큰 순 정렬 — 어디서 가장 많이 쓰는지 위에서부터
stages.sort((a, b) => b[1].cost_usd - a[1].cost_usd);

const pad = (s, n) => String(s).padStart(n);

console.log("\n================== 단계별 토큰 소진 현황 ==================");
console.log(`마지막 갱신: ${log.updated_at}\n`);
console.log("단계          호출   입력토큰  캐시읽기   출력토큰    비용($)   비중");
console.log("----------------------------------------------------------------");
for (const [stage, t] of stages) {
  const name = (STAGE_KR[stage] ?? stage).padEnd(10, " ");
  const pct = totalCost ? ((t.cost_usd / totalCost) * 100).toFixed(1) : "0.0";
  console.log(
    `${name}  ${pad(t.calls, 4)}  ${pad(t.input_tokens, 8)}  ${pad(t.cache_read_tokens, 8)}  ${pad(t.output_tokens, 8)}  ${pad(t.cost_usd.toFixed(4), 8)}  ${pad(pct, 5)}%`,
  );
}
console.log("----------------------------------------------------------------");
console.log(
  `합계 비용: $${totalCost.toFixed(4)} (≈ ${(totalCost * 1300).toFixed(0)}원)   합계 토큰: ${totalTok.toLocaleString()}`,
);
console.log("==========================================================\n");
console.log("💡 다음 파이프라인을 깨끗하게 측정하려면: npm run tokens:reset 실행 후 파이프라인 재실행\n");
