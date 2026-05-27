import dotenv from "dotenv";
import { tavily } from "@tavily/core";
import fs from "fs";
dotenv.config();

// Tavily 클라이언트 초기화
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

// YouTube와 동일한 브랜드 입력값 기준으로 설계한 쿼리
// 입력값: 성별(여자) / 나이(20대) / 톤앤매너(로맨틱, 감성)
// YouTube가 영상 기반 트렌드를 수집한다면, Tavily는 텍스트 기반 기사를 수집하는 역할이야
const QUERIES = [
  "로맨틱 메이크업 트렌드 2026",   // 톤앤매너(로맨틱) 기반
  "감성 뷰티 트렌드",              // 톤앤매너(감성) 기반
  "20대 여성 메이크업 트렌드"       // 타겟(20대 여자) 기반
];

async function fetchTrendArticles(query) {
  const response = await client.search(query, {
    searchDepth: "basic",   // basic은 크레딧을 적게 써서 테스트 단계에 적합해
    maxResults: 5,          // 쿼리당 5개씩
    includeAnswer: false,   // 기사 원문만 가져오고 AI 요약은 필요 없어
  });

  // API 응답에서 필요한 정보만 뽑아내기
  return response.results.map(result => ({
    query: query,
    source: "tavily",
    title: result.title,
    description: result.content,  // 기사 본문 요약
    url: result.url
  }));
}

async function main() {
  console.log("Tavily 트렌드 기사 수집 시작...\n");

  const results = [];

  for (const query of QUERIES) {
    console.log(`"${query}" 검색 중...`);
    const articles = await fetchTrendArticles(query);
    results.push(...articles);
  }

  // 트렌드 분석가 B에게 넘길 형태로 포맷 구성
  // YouTube raw 데이터와 동일한 구조로 맞춰서 나중에 합치기 쉽게 해둔 거야
  const output = {
    collected_at: new Date().toISOString(),
    brand_context: {
      target_gender: "여성",
      target_age: "20대",
      tone: "로맨틱·감성"
    },
    raw_data: results
  };

  // 결과를 JSON 파일로 저장
  fs.writeFileSync("trend/data/tavily_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 기사 수집됨`);
  console.log("trend/data/tavily_raw.json 파일로 저장됐어!");
}

main();