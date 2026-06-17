// 단계별 토큰 사용량 누적 기록기.
//
// 각 에이전트(브랜드/트렌드/매칭/시안/작성)가 Anthropic 호출 후 recordUsage()를
// 부르면, shared/data/token-usage.json 한 곳에 단계별로 토큰·비용이 쌓인다.
// 어느 단계가 토큰을 많이 쓰는지 한눈에 비교하기 위한 용도.
//
// 안전 설계: 기록이 실패해도 절대 파이프라인을 멈추지 않는다(에러를 삼킴).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo 루트 기준 shared/data/token-usage.json (shared/data는 gitignore됨)
const LOG_PATH = resolve(__dirname, "../../shared/data/token-usage.json");

// 모델별 단가 ($/1M tokens). 새 모델 추가 시 여기에만 넣으면 됨.
const PRICING = {
  "claude-haiku-4-5": { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
};

function costOf(model, u) {
  const p = PRICING[model] ?? PRICING["claude-haiku-4-5"];
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.cache_creation_input_tokens ?? 0) * p.cache_write +
      (u.cache_read_input_tokens ?? 0) * p.cache_read +
      (u.output_tokens ?? 0) * p.output) /
    1_000_000
  );
}

/**
 * 한 번의 LLM 호출 usage를 단계별로 기록한다.
 * @param {string} stage  단계 키 (brand|trend|match|designer-v2|writer)
 * @param {object} usage  Anthropic response.usage 객체
 * @param {string} [model] 모델명 (기본 haiku-4-5)
 */
export function recordUsage(stage, usage, model = "claude-haiku-4-5") {
  if (!usage) return;

  let log = { updated_at: null, totals_by_stage: {}, runs: [] };
  try {
    if (existsSync(LOG_PATH)) log = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
  } catch {
    // 파일이 깨졌으면 새로 시작
  }

  const entry = {
    stage,
    at: new Date().toISOString(),
    model,
    input_tokens: usage.input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cost_usd: Number(costOf(model, usage).toFixed(6)),
  };
  log.runs.push(entry);

  // 단계별 누적을 runs 기준으로 재계산 (항상 일관)
  const totals = {};
  for (const r of log.runs) {
    const t = (totals[r.stage] ??= {
      calls: 0,
      input_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    });
    t.calls += 1;
    t.input_tokens += r.input_tokens;
    t.cache_write_tokens += r.cache_write_tokens;
    t.cache_read_tokens += r.cache_read_tokens;
    t.output_tokens += r.output_tokens;
    t.cost_usd = Number((t.cost_usd + r.cost_usd).toFixed(6));
  }
  log.totals_by_stage = totals;
  log.updated_at = entry.at;

  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
  } catch (e) {
    console.warn(`⚠️ 토큰 로그 기록 실패(무시하고 진행): ${e.message}`);
  }
}
