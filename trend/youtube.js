import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
fs.mkdirSync("trend/data", { recursive: true });
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

// 수집 결과 캐시 경로 + 새로고침 플래그
// 평소엔 기존 youtube_raw.json을 재사용해 YouTube 일일 할당량을 아낀다.
// 서버가 ?fresh=1 요청 시 YOUTUBE_FRESH=1을 넘겨주며, 그때만 새로 수집한다.
const CACHE_PATH = "trend/data/youtube_cache.json"; // 키워드별 캐시 (출력 파일과 분리)
const OUT_PATH = "trend/data/youtube_raw.json";     // merge.js가 읽는 출력 (브랜드별로 매번 재조립)
const FRESH = process.env.YOUTUBE_FRESH === "1";

// apify와 동일한 7일 버킷
function weekBucket() { return Math.floor(Date.now() / (7 * 864e5)); }
function cacheKey(keyword) { return `${keyword}__${weekBucket()}`; }
function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")); } catch { return {}; } }
function saveCache(c) { fs.writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2), "utf-8"); }

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

  const cache = loadCache();
  const results = [];
  try {
    for (const query of QUERIES) {
      const key = cacheKey(query);
      // 이번 주 같은 키워드면 API 호출 없이 캐시 재사용
      if (!FRESH && cache[key]) {
        console.log(`"${query}" → (이번 주 캐시 사용)`);
        results.push(...cache[key]);
        continue;
      }
      console.log(`"${query}" 검색 중...`);
      const videos = await fetchTrendingVideos(query);
      console.log(`  → ${videos.length}개 수집`);
      cache[key] = videos;
      saveCache(cache); // 키워드마다 저장 → 중간에 할당량 끊겨도 받은 만큼 보존
      results.push(...videos);
    }
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || err.message;
    console.warn(`\n⚠️ YouTube 수집 실패${status ? ` (${status})` : ""}: ${msg}`);
    console.warn("→ 이번 주 캐시에 있던 키워드만으로 계속 진행합니다.");
  }

  // 이번 실행에서 모은 게 하나도 없으면 기존 출력을 덮어쓰지 않고 그대로 둠
  if (results.length === 0) {
    if (fs.existsSync(OUT_PATH)) {
      console.warn("⚠️ 새로 모은 데이터 없음 — 기존 youtube_raw.json 유지.");
      return;
    }
    console.error("❌ 데이터·기존 출력 모두 없어 진행 불가. 할당량 리셋 후 재시도하세요.");
    process.exitCode = 1;
    return;
  }

  // 출력은 매번 "현재 브랜드의 키워드 + 현재 brand_context"로 재조립 → 브랜드 섞임 방지
  const output = {
    collected_at: new Date().toISOString(),
    brand_context: brandContext,
    raw_data: results
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 영상 수집됨`);
  results.slice(0, 3).forEach(v => {
    console.log(`"${v.title.slice(0, 30)}..." 조회수: ${v.view_count.toLocaleString()}회`);
  });
  console.log(`${OUT_PATH} 파일로 저장됐어!`);
}

main();
