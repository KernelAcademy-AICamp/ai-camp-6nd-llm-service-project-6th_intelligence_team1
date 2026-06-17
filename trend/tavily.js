import dotenv from "dotenv";
import { tavily } from "@tavily/core";
import fs from "fs";
dotenv.config();
fs.mkdirSync("trend/data", { recursive: true });

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

const brandAnalysis = JSON.parse(
  fs.readFileSync("shared/data/brand-analysis.json", "utf-8")
);

const QUERIES = brandAnalysis.data.search_keywords;

const brandContext = {
  target_gender: brandAnalysis.data.target.gender,
  target_age: brandAnalysis.data.target.age_groups.join(", "),
  tone: brandAnalysis.data.tone_and_manner.join(", ")
};

async function fetchTrendArticles(query) {
  const response = await client.search(query, {
    searchDepth: "basic",
    maxResults: 10,
    includeAnswer: false,
  });

  return response.results.map(result => ({
    query: query,
    source: "tavily",
    title: result.title,
    description: result.content,
    url: result.url
  }));
}

async function main() {
  console.log("Tavily 트렌드 기사 수집 시작...\n");
  console.log(`검색어 ${QUERIES.length}개를 brand-analysis.json에서 읽어왔어!\n`);

  const results = [];
  for (const query of QUERIES) {
    console.log(`"${query}" 검색 중...`);
    const articles = await fetchTrendArticles(query);
    results.push(...articles);
  }

  const output = {
    collected_at: new Date().toISOString(),
    brand_context: brandContext,
    raw_data: results
  };

  fs.writeFileSync("trend/data/tavily_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 기사 수집됨`);
  console.log("trend/data/tavily_raw.json 파일로 저장됐어!");
}

main();