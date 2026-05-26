import dotenv from "dotenv";
import axios from "axios";
import fs from "fs"; // 파일 저장을 위해 추가
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3/search";

// 브랜드 입력값 기준으로 설계한 쿼리
// 입력값: 성별(여자) / 나이(20대) / 톤앤매너(로맨틱, 감성)
const QUERIES = [
  "로맨틱 메이크업 트렌드",
  "감성 뷰티 룩",
  "무드 메이크업",
  "20대 여자 메이크업",
  "여자 뷰티 추천 2026"
];

async function fetchTrendingVideos(query) {
  const response = await axios.get(BASE_URL, {
    params: {
      key: API_KEY,
      q: query,
      part: "snippet",
      type: "video",
      order: "viewCount",
      maxResults: 5,
      relevanceLanguage: "ko",
      publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  });

  return response.data.items.map(item => ({
    query: query,
    source: "youtube",
    title: item.snippet.title,
    description: item.snippet.description,
  }));
}

async function main() {
  console.log("YouTube 트렌드 수집 시작...\n");

  const results = [];

  for (const query of QUERIES) {
    console.log(`"${query}" 검색 중...`);
    const videos = await fetchTrendingVideos(query);
    results.push(...videos);
  }

  // 트렌드 분석가 B에게 넘길 형태로 포맷 구성
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
  fs.writeFileSync("trend/data/youtube_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 영상 수집됨`);
  console.log("trend/data/youtube_raw.json 파일로 저장됐어!");
}

main();