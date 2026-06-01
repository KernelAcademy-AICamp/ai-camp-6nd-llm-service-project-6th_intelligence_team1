import "dotenv/config";
import { ApifyClient } from "apify-client";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmSearchQueriesSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
const anthropic = new Anthropic();

const searchSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/search.md"),
  "utf-8",
);

// 1단계 — 영문 쿼리 생성 + Apify Pinterest 검색.
//   1-1. Haiku에 브랜드+콘텐츠 던져 영문 쿼리 3개
//   1-2. Apify Pinterest Scraper (fatihtahta/pinterest-scraper-search) 호출
//   1-3. entity_type='pin' 항목에서 media.images.large.url 추출
//
// 로컬 dataset 모드: Apify 한도 도달 시 미리 export 받은 JSON 사용.
// USE_LOCAL_PINTEREST=1 또는 파일이 있으면 자동 활성화.

const PINTEREST_ACTOR = "fatihtahta/pinterest-scraper-search";
const MAX_ITEMS_PER_QUERY = 8;
const PINS_PER_CONTENT = 5; // 2단계 분석에 5장이면 충분

const LOCAL_PINTEREST_PATH = resolve(
  PROJECT_ROOT,
  "shared/data/pinterest-dataset-sample.json",
);
const USE_LOCAL_PINTEREST =
  process.env.USE_LOCAL_PINTEREST === "1" || existsSync(LOCAL_PINTEREST_PATH);

export async function generateQueriesAndSearch({ brand, content }) {
  // 1-1. LLM 호출 — 영문 쿼리 생성
  const userMessage = `브랜드와 트렌드 콘텐츠로 영문 검색 쿼리 3개를 만드세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept}${content.mood ? `\n- mood: ${content.mood}` : ""}${content.key_message ? `\n- key_message: ${content.key_message}` : ""}

\`queries\` 배열에 영문 쿼리 3개 반환.`;

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    temperature: 0,
    system: [
      { type: "text", text: searchSystemPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: zodOutputFormat(LlmSearchQueriesSchema) },
  });

  const data = response.parsed_output;
  if (!data) throw new Error("검색 쿼리 생성 실패 (LLM 응답 파싱 실패)");

  // 1-2. Pinterest 검색
  let pinterestRefs = [];
  try {
    pinterestRefs = await searchPinterest(data.queries);
  } catch (err) {
    console.warn(`  ⚠️ Pinterest 검색 실패: ${err.message}`);
  }

  // 로컬 모드: 콘텐츠당 PINS_PER_CONTENT개만 시드 기반 선택 (재현성 + 콘텐츠별 다양성)
  // 운영 모드: 전체 결과 반환 (analyze.js에서 앞 N장 분석)
  const finalRefs = USE_LOCAL_PINTEREST
    ? samplePins(pinterestRefs, PINS_PER_CONTENT, content)
    : pinterestRefs;

  return {
    queries: data.queries,
    references: finalRefs,
    usage: response.usage,
    used_local_pinterest: USE_LOCAL_PINTEREST,
  };
}

// Pinterest Apify Actor 호출 (또는 로컬 dataset 로드).
async function searchPinterest(queries) {
  if (!queries?.length) return [];

  let items;
  if (USE_LOCAL_PINTEREST) {
    items = JSON.parse(readFileSync(LOCAL_PINTEREST_PATH, "utf-8"));
  } else {
    const run = await apify.actor(PINTEREST_ACTOR).call({
      queries,
      maxItems: Math.max(queries.length * MAX_ITEMS_PER_QUERY, 10),
    });
    const result = await apify.dataset(run.defaultDatasetId).listItems();
    items = result.items;
  }

  return mapPinterestItems(items);
}

// 핀(entity_type='pin')만 추출. media.images.large.url(736px)을 image_url로.
function mapPinterestItems(items) {
  return items
    .filter((it) => it.entity_type === "pin" && it.media?.images?.large?.url)
    .map((it) => ({
      url: it.url ?? "",
      image_url: it.media.images.large.url,
      title: it.pin?.description ?? it.pin?.alt_text ?? it.title ?? "",
      source: "pinterest",
    }));
}

// 로컬 dataset에서 콘텐츠별로 다른 핀을 보여주기 위한 시드 기반 샘플 (재현성).
function samplePins(pins, n, content) {
  if (pins.length <= n) return pins;
  const seed = (content?.content_id || content?.trend_name || "x")
    .split("")
    .reduce((h, ch) => ((h * 31 + ch.charCodeAt(0)) >>> 0), 0x811c9dc5);
  const start = seed % Math.max(1, pins.length - n);
  return pins.slice(start, start + n);
}
