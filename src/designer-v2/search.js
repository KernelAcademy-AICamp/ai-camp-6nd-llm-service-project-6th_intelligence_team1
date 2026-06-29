import "dotenv/config";
import { ApifyClient } from "apify-client";
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

const apify = new ApifyClient({ token: process.env.APIFY_TOKEN });
const anthropic = new Anthropic();

const searchSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/search.md"),
  "utf-8",
);

// ─── 1단계: 트렌드별 Pinterest 검색 ──────────────────────────────────
//   1-1. Haiku에 트렌드 던져 Pinterest 영문 쿼리 3개 받기
//   1-2. Pinterest (silentflow) 검색 — 쿼리 3개 × 7핀 = 21, cap 20 적용
//   1-3. references_by_source.pinterest 로 반환 (analyze.js가 처리)
// (Instagram·Mintoiro는 db076f9에서 품질 개선 위해 제거됨 — Pinterest 단일 소스)

const PINTEREST_ACTOR = "silentflow/pinterest-scraper-ppr";
const PINTEREST_PER_QUERY = 7; // 3쿼리 × 7 = 21. cap 20 적용
const MAX_PER_SOURCE = 20; // Pinterest 최대 (analyze에서 다 활용)

// 톤앤매너 7종(매칭가 enum) → 핀터레스트 영문 무드 앵커(동의어 세트).
// 트렌드 단어는 핀터레스트 무드 앵커로 약하지만 톤앤매너 어휘는 인덱스가 풍부·일관 →
// 쿼리 맨 앞에 이 앵커를 고정해 무드를 통일하고, 트렌드는 변주로만 얹는다.
// 세트가 3개인 이유: 쿼리 3개에 서로 다른 앵커를 회전시켜 동질화(다 비슷한 핀)를 막기 위함.
const TONE_ANCHOR = {
  "클린뷰티": ["clean beauty", "minimal natural", "pure skincare"],
  "로맨틱·감성": ["romantic soft", "dreamy pastel", "soft feminine"],
  "럭셔리·프리미엄": ["luxury premium", "elegant editorial", "high-end minimal"],
  "키치·플레이풀": ["playful colorful", "kitsch pop", "vibrant fun"],
  "더마·과학적": ["clinical", "derma cosmetic", "clean lab"],
  "Z세대·트렌디": ["trendy y2k", "bold streetwear", "gen-z aesthetic"],
  "비건": ["vegan botanical", "earthy natural", "organic green"],
};

// tone_and_manner(배열, 보통 1개)에서 첫 매칭 라벨의 앵커 세트 반환. 매핑 없으면 null(기존 동작 유지).
function toneAnchors(tone_and_manner) {
  const labels = Array.isArray(tone_and_manner) ? tone_and_manner : [];
  for (const label of labels) {
    if (TONE_ANCHOR[label]) return TONE_ANCHOR[label];
  }
  return null;
}

export async function generateQueriesAndSearch({ brand, content, usedQueries = [], shot_direction = null }) {
  // 1-1. LLM 호출 — 쿼리 생성
  const usedBlock = usedQueries.length
    ? `\n## 이미 사용된 쿼리 (중복 금지)\n${usedQueries.map((q) => `- "${q}"`).join("\n")}\n위 쿼리와 겹치지 않는 새로운 쿼리 3개를 만드세요.`
    : "";

  const directionBlock = shot_direction
    ? `\n## 샷 방향\nshot_direction: **${shot_direction}** — 위 표 기준으로 이 방향에 맞는 이미지가 걸리도록 쿼리 3개를 작성하세요.`
    : "";

  const compositionBlock = content.composition_hint
    ? `\n## 구도 (필수 반영)\ncomposition: **${content.composition_hint}** — 이 구도에 맞는 레퍼런스가 걸리도록 쿼리에 구도 어휘를 반영하세요.`
    : "";

  // 톤앤매너 → 영문 무드 앵커. 매핑되면 쿼리 맨 앞 고정 앵커로 강제, 안 되면 빈 블록(기존 동작).
  const anchors = toneAnchors(brand.tone_and_manner);
  const anchorBlock = anchors
    ? `\n## 톤앤매너 무드 앵커 (최우선 — 모든 쿼리 맨 앞에 1개)\n핀터레스트 무드 앵커: ${anchors.map((a) => `"${a}"`).join(", ")}\n쿼리 3개 각각 **맨 앞에 위 앵커 중 서로 다른 1개**를 놓고, 나머지 단어로 변주(구도·오브제·트렌드)하세요. 트렌드 concept은 앵커를 밀어내지 말고 변주로만 얹으세요.`
    : "";

  const userMessage = `브랜드와 트렌드 콘텐츠로 Pinterest 영문 쿼리 3개를 만드세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept ?? "(없음)"}${content.mood ? `\n- mood: ${content.mood}` : ""}${content.key_message ? `\n- key_message: ${content.key_message}` : ""}${anchorBlock}${directionBlock}${compositionBlock}${usedBlock}

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
