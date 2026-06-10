import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
fs.mkdirSync("trend/data", { recursive: true });
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

// ── 품질 튜닝 다이얼 ──────────────────────────────
const RECENT_DAYS = 180;   // 최근 N일 (30 → 180: 표본 확보. 더 최신만 원하면 90)
const MAX_RESULTS = 25;    // 키워드당 영상 수 (search.list 비용은 결과수와 무관)
// ────────────────────────────────────────────────

const brandAnalysis = JSON.parse(
  fs.readFileSync("shared/data/brand-analysis.json", "utf-8")
);

const QUERIES = brandAnalysis.data.search_keywords;

const brandContext = {
  target_gender: brandAnalysis.data.target.gender,
  target_age: brandAnalysis.data.target.age_groups.join(", "),
  tone: brandAnalysis.data.tone_and_manner.join(", ")
};

async function fetchTrendingVideos(query) {
  // 1단계: search.list로 영상 ID 수집 (관련도순)
  const searchResponse = await axios.get(`${BASE_URL}/search`, {
    params: {
      key: API_KEY,
      q: query,
      part: "snippet",
      type: "video",
      order: "relevance",   // viewCount → relevance: 주제에 맞는 영상이 옴
      maxResults: MAX_RESULTS,
      relevanceLanguage: "ko",
      regionCode: "KR",
      publishedAfter: new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
    }
  });

  const items = searchResponse.data.items;
  if (!items || items.length === 0) return [];

  const videoIds = items.map(item => item.id.videoId).join(",");

  // 2단계: videos.list로 실제 조회수 수집
  const statsResponse = await axios.get(`${BASE_URL}/videos`, {
    params: {
      key: API_KEY,
      id: videoIds,
      part: "statistics"
    }
  });

  const statsMap = {};
  statsResponse.data.items.forEach(item => {
    statsMap[item.id] = item.statistics;
  });

  return items.map(item => ({
    query: query,
    source: "youtube",
    title: item.snippet.title,
    description: item.snippet.description,
    view_count: parseInt(statsMap[item.id.videoId]?.viewCount || 0),
    like_count: parseInt(statsMap[item.id.videoId]?.likeCount || 0),
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`
  }));
}

async function main() {
  console.log("YouTube 트렌드 수집 시작...\n");
  console.log(`검색어 ${QUERIES.length}개를 brand-analysis.json에서 읽어왔어!\n`);

  const results = [];
  for (const query of QUERIES) {
    console.log(`"${query}" 검색 중...`);
    const videos = await fetchTrendingVideos(query);
    console.log(`  → ${videos.length}개 수집`);
    results.push(...videos);
  }

  const output = {
    collected_at: new Date().toISOString(),
    brand_context: brandContext,
    raw_data: results
  };

  fs.writeFileSync("trend/data/youtube_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 영상 수집됨`);
  results.slice(0, 3).forEach(v => {
    console.log(`"${v.title.slice(0, 30)}..." 조회수: ${v.view_count.toLocaleString()}회`);
  });
  console.log("trend/data/youtube_raw.json 파일로 저장됐어!");
}

main();
