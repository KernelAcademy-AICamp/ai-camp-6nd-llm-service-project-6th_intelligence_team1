import "dotenv/config";
import { ApifyClient } from "apify-client";
import { tavily } from "@tavily/core";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmSearchQueriesSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const CACHE_PATH = resolve(PROJECT_ROOT, "shared/data/search-cache.json");

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, "utf-8")); } catch { return {}; }
}

function saveCache(cache) {
  mkdirSync(resolve(PROJECT_ROOT, "shared/data"), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });
const anthropic = new Anthropic();

const searchSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/search.md"),
  "utf-8",
);

// ─── 1단계: 트렌드별 매체별 검색 ──────────────────────────────────────
//   1-1. Haiku에 트렌드 던져 영문 쿼리 3개 + 인스타 해시태그 3개 받기
//   1-2. 매체별로 검색 — 트렌드당 매체당 10장 목표
//        - Pinterest (silentflow): 쿼리 3개 × 3-4핀 = 9-12핀 (영문 쿼리)
//        - Instagram (apify): 해시태그 3개 × 4 = 12 (해시태그)
//        - Mintoiro (Tavily site:): 쿼리 3개 × 4 = 12 (영문 쿼리)
//   1-3. 매체별 references[]를 분리해서 반환 (analyze.js가 매체별로 처리)

const PINTEREST_ACTOR = "silentflow/pinterest-scraper-ppr";
const INSTAGRAM_ACTOR = "apify/instagram-scraper";
const PINTEREST_PER_QUERY = 7; // 3쿼리 × 7 = 21. cap 20 적용
const INSTAGRAM_PER_HASHTAG = 4;
const MINTOIRO_PER_QUERY = 4;
const MAX_PER_SOURCE = 20; // 매체별 최대 (analyze에서 다 활용)

export async function generateQueriesAndSearch({ brand, content, usedQueries = [], shot_direction = null }) {
  // 1-1. LLM 호출 — 쿼리 생성
  const usedBlock = usedQueries.length
    ? `\n## 이미 사용된 쿼리 (중복 금지)\n${usedQueries.map((q) => `- "${q}"`).join("\n")}\n위 쿼리와 겹치지 않는 새로운 쿼리 3개를 만드세요.`
    : "";

  const directionBlock = shot_direction
    ? `\n## 샷 방향\nshot_direction: **${shot_direction}** — 위 표 기준으로 이 방향에 맞는 이미지가 걸리도록 쿼리 3개를 작성하세요.`
    : "";

  const userMessage = `브랜드와 트렌드 콘텐츠로 Pinterest 영문 쿼리 3개를 만드세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept ?? "(없음)"}${content.mood ? `\n- mood: ${content.mood}` : ""}${content.key_message ? `\n- key_message: ${content.key_message}` : ""}${directionBlock}${usedBlock}

\`queries\` (Pinterest용) 3개 반환.`;

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
  const pinterestRefs = await searchPinterest(data.queries).catch((err) => {
    console.warn(`  ⚠️ Pinterest 실패: ${err.message}`);
    return [];
  });

  return {
    queries: data.queries,
    references_by_source: {
      pinterest: pinterestRefs.slice(0, MAX_PER_SOURCE),
    },
    usage: response.usage,
  };
}

// ─── Pinterest (silentflow/pinterest-scraper-ppr) ─────────────────────
// 쿼리별 actor 호출. 캐시 히트 시 Apify 건너뜀.
async function searchPinterest(queries) {
  if (!queries?.length) return [];
  const cache = loadCache();
  let cacheUpdated = false;

  const byQuery = await Promise.all(
    queries.map(async (q) => {
      if (cache[q]) {
        console.log(`  [캐시] Pinterest "${q}"`);
        return cache[q];
      }
      const run = await apify.actor(PINTEREST_ACTOR).call({
        search: q,
        maxItems: PINTEREST_PER_QUERY,
        includeDetails: false,
        includeUserInfoOnly: false,
      });
      const { items } = await apify.dataset(run.defaultDatasetId).listItems();
      const refs = mapPinterestItems(items);
      cache[q] = refs;
      cacheUpdated = true;
      return refs;
    }),
  );

  if (cacheUpdated) saveCache(cache);
  return interleave(byQuery);
}

function mapPinterestItems(items) {
  return items
    .map((it) => ({
      url: it.url ?? it.link ?? "",
      image_url:
        it.media?.images?.large?.url ??
        it.media?.images?.medium?.url ??
        it.imageUrl ??
        it.image ??
        it.images?.[0]?.url ??
        null,
      title:
        it.pin?.description ??
        it.pin?.alt_text ??
        it.title ??
        it.description ??
        "",
      source: "pinterest",
    }))
    .filter((r) => r.image_url);
}

// ─── Instagram (apify/instagram-scraper) ──────────────────────────────
async function searchInstagram(hashtags) {
  if (!hashtags?.length) return [];
  const directUrls = hashtags.map((h) => {
    const tag = encodeURIComponent(h.replace(/^#/, "").trim());
    return `https://www.instagram.com/explore/tags/${tag}/`;
  });
  const run = await apify.actor(INSTAGRAM_ACTOR).call({
    directUrls,
    resultsType: "posts",
    resultsLimit: INSTAGRAM_PER_HASHTAG,
    addParentData: false,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return mapInstagramItems(items);
}

function mapInstagramItems(items) {
  return items
    .map((it) => ({
      url:
        it.url ??
        (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : ""),
      image_url:
        it.displayUrl ??
        it.thumbnailUrl ??
        it.images?.[0] ??
        it.image ??
        null,
      title: it.caption ?? it.description ?? "",
      source: "instagram",
    }))
    .filter((r) => r.image_url);
}

// ─── Mintoiro (mintoiro.com) — Tavily site: 검색 ──────────────────────
async function searchMintoiro(queries) {
  if (!queries?.length) return [];
  const refs = [];
  for (const q of queries) {
    const r = await tavilyClient.search(q, {
      searchDepth: "advanced",
      maxResults: MINTOIRO_PER_QUERY,
      includeImages: true,
      includeImageDescriptions: true,
      includeAnswer: false,
      includeDomains: ["mintoiro.com"],
    });
    const imgs = (r.images ?? []).map((img) => {
      const url = typeof img === "string" ? img : img.url;
      const desc = typeof img === "string" ? null : img.description;
      return { url, image_url: url, title: desc || q, source: "mintoiro" };
    });
    refs.push(...imgs);
  }
  return refs.filter((r) => r.image_url);
}

// ─── 헬퍼: 라운드로빈 ─────────────────────────────────────────────────
function interleave(arrays) {
  const result = [];
  const maxLen = Math.max(...arrays.map((a) => a?.length ?? 0), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (arr?.[i]) result.push(arr[i]);
    }
  }
  return result;
}
