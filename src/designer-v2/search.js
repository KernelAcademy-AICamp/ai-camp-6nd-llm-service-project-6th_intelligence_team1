import "dotenv/config";
import { tavily } from "@tavily/core";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmSearchQueriesSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });
const anthropic = new Anthropic();

const searchSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/search.md"),
  "utf-8",
);

// 1단계 — 트렌드·브랜드 콘텐츠로 영문 검색 쿼리 N개 생성 + Tavily 이미지 검색.
//   1-1. Haiku에 (브랜드+콘텐츠) 던져 쿼리 3개 받기
//   1-2. 쿼리별로 Tavily 이미지 검색 (includeImages: true) → references 모음
export async function generateQueriesAndSearch({ brand, content }) {
  // 1-1. LLM 호출 — 검색 쿼리 생성
  const userMessage = `브랜드와 트렌드 콘텐츠로 영문 검색 쿼리 3개를 만드세요.

## 브랜드
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept}${content.mood ? `\n- mood: ${content.mood}` : ""}${content.key_message ? `\n- key_message: ${content.key_message}` : ""}

영문 쿼리 3개를 \`queries\` 배열에 담아 반환하세요.`;

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
  if (!data) {
    throw new Error("[1단계] 검색 쿼리 생성 실패 (LLM 응답 파싱 실패)");
  }

  // 1-2. Tavily 이미지 검색 — 쿼리별
  // ⚠️ 인스타·페북 등 robots.txt 차단 사이트는 제외 — 2단계 Claude Vision이 못 가져옴.
  //    핀터레스트·블로그·매거진 같은 공개 인덱싱 사이트 위주로 모이게 한다.
  const EXCLUDE_DOMAINS = [
    "instagram.com",
    "lookaside.instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
  ];

  const references = [];
  for (const q of data.queries) {
    try {
      const r = await tavilyClient.search(q, {
        searchDepth: "advanced",
        maxResults: 5,
        includeImages: true,
        includeImageDescriptions: true,
        includeAnswer: false,
        excludeDomains: EXCLUDE_DOMAINS,
      });

      // images 배열 (Tavily가 이미지 검색 시 채움) — 차단 도메인 한 번 더 필터.
      const imgs = (r.images ?? [])
        .map((img) => {
          const url = typeof img === "string" ? img : img.url;
          const desc = typeof img === "string" ? null : img.description;
          return { url, image_url: url, title: desc || q };
        })
        .filter((ref) => !EXCLUDE_DOMAINS.some((d) => ref.image_url.includes(d)));

      // 일반 results (페이지 URL — 보조 정보로 일부만)
      const txt = (r.results ?? []).slice(0, 2).map((res) => ({
        url: res.url,
        image_url: null,
        title: res.title,
      }));

      references.push(...imgs, ...txt);
    } catch (err) {
      console.warn(`  ⚠️ Tavily 검색 실패 (${q}): ${err.message}`);
    }
  }

  return {
    queries: data.queries,
    references,
    usage: response.usage,
  };
}
