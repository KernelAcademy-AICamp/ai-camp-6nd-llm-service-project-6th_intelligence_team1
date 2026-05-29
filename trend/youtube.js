import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
fs.mkdirSync("trend/data", { recursive: true });
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

const QUERIES = [
  "로맨틱 메이크업 트렌드",
  "감성 뷰티 룩",
  "무드 메이크업",
  "20대 여자 메이크업",
  "여자 뷰티 추천 2026"
];

async function fetchTrendingVideos(query) {
  // 1단계: search.list로 영상 ID 수집
  // search.list는 검색 결과를 가져오는 엔드포인트인데,
  // 조회수 같은 통계 정보는 포함하지 않아서 video ID만 뽑아내는 용도로 씀
  const searchResponse = await axios.get(`${BASE_URL}/search`, {
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

  const items = searchResponse.data.items;
  
  // 검색 결과가 없으면 빈 배열 반환
  if (!items || items.length === 0) return [];

  // video ID 목록 추출
  const videoIds = items.map(item => item.id.videoId).join(",");

  // 2단계: videos.list로 실제 조회수 수집
  // search.list로 가져온 ID를 한 번에 묶어서 statistics 엔드포인트에 던지면
  // 조회수, 좋아요 수 등 실제 수치를 가져올 수 있어
  const statsResponse = await axios.get(`${BASE_URL}/videos`, {
    params: {
      key: API_KEY,
      id: videoIds,
      part: "statistics"
    }
  });

  // statistics 결과를 video ID 기준으로 매핑해두면
  // 나중에 검색 결과랑 조회수를 쉽게 합칠 수 있어
  const statsMap = {};
  statsResponse.data.items.forEach(item => {
    statsMap[item.id] = item.statistics;
  });

  // 검색 결과(제목, 설명)와 조회수를 하나의 객체로 합치기
  return items.map(item => ({
    query: query,
    source: "youtube",
    title: item.snippet.title,
    description: item.snippet.description,
    view_count: parseInt(statsMap[item.id.videoId]?.viewCount || 0), // 실제 조회수
    like_count: parseInt(statsMap[item.id.videoId]?.likeCount || 0), // 좋아요 수
    url: null
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

  const output = {
    collected_at: new Date().toISOString(),
    brand_context: {
      target_gender: "여성",
      target_age: "20대",
      tone: "로맨틱·감성"
    },
    raw_data: results
  };

  fs.writeFileSync("trend/data/youtube_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 영상 수집됨`);
  // 실제 조회수가 들어오는지 확인하기 위해 상위 3개를 출력해봄
  results.slice(0, 3).forEach(v => {
    console.log(`"${v.title.slice(0, 30)}..." 조회수: ${v.view_count.toLocaleString()}회`);
  });
  console.log("trend/data/youtube_raw.json 파일로 저장됐어!");
}

main();