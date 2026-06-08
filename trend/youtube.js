import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import { fileURLToPath } from "url"; // [추가] 터미널 직접 실행인지 감지용
fs.mkdirSync("trend/data", { recursive: true });
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

// ── 캐시 설정 ─────────────────────────────────────────────────
const CACHE_PATH = "trend/data/youtube_cache.json";
const TODAY = new Date().toISOString().slice(0, 10); // 예: "2026-06-08"

// 디스크에서 캐시 읽기 (없으면 빈 객체)
function loadCacheFromDisk() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

// 실행 중 상태 (main에서 초기화)
let cache = {};
let unitsUsed = 0;
// ──────────────────────────────────────────────────────────────

// 브랜드 분석가가 만든 brand-analysis.json을 읽어옴
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
  // ── 캐시 확인 ──────────────────────────────────────────────
  // (--fresh / fresh:true 로 실행하면 main에서 cache를 비워두므로 여기서 항상 통과)
  const cacheKey = `${query}__${TODAY}`;
  if (cache[cacheKey]) {
    console.log(`  └ (캐시 사용 — units 0) "${query}"`);
    return cache[cacheKey];
  }
  // ──────────────────────────────────────────────────────────

  // 1단계: search.list로 영상 ID 수집 (100 units)
  const searchResponse = await axios.get(`${BASE_URL}/search`, {
    params: {
      key: API_KEY,
      q: query,
      part: "snippet",
      type: "video",
      order: "viewCount",
      maxResults: 5,
      relevanceLanguage: "ko",
      publishedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
  unitsUsed += 100;

  const items = searchResponse.data.items;
  if (!items || items.length === 0) {
    cache[cacheKey] = []; // 빈 결과도 캐싱 (재호출 방지)
    return [];
  }

  const videoIds = items.map(item => item.id.videoId).join(",");

  // 2단계: videos.list로 실제 조회수 수집 (1 unit)
  const statsResponse = await axios.get(`${BASE_URL}/videos`, {
    params: {
      key: API_KEY,
      id: videoIds,
      part: "statistics"
    }
  });
  unitsUsed += 1;

  const statsMap = {};
  statsResponse.data.items.forEach(item => {
    statsMap[item.id] = item.statistics;
  });

  const result = items.map(item => ({
    query: query,
    source: "youtube",
    title: item.snippet.title,
    description: item.snippet.description,
    view_count: parseInt(statsMap[item.id.videoId]?.viewCount || 0),
    like_count: parseInt(statsMap[item.id.videoId]?.likeCount || 0),
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`
  }));

  cache[cacheKey] = result; // 결과를 캐시에 저장
  return result;
}

// [변경] main이 fresh 옵션을 받음. 백엔드에서 main({ fresh: true })로 부를 수 있음.
async function main({ fresh = false } = {}) {
  // ── 실행 시작 시 초기화 ────────────────────────────────────
  unitsUsed = 0;
  cache = fresh ? {} : loadCacheFromDisk(); // fresh면 캐시를 통째로 무시
  if (fresh) console.log("⚡ FRESH 모드: 캐시 무시하고 새로 받습니다\n");
  // ──────────────────────────────────────────────────────────

  console.log("YouTube 트렌드 수집 시작...\n");
  console.log(`검색어 ${QUERIES.length}개를 brand-analysis.json에서 읽어왔어!\n`);

  const results = [];
  for (const query of QUERIES) {
    console.log(`"${query}" 검색 중...`);
    const videos = await fetchTrendingVideos(query);
    results.push(...videos);
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");

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

  console.log(`\n💰 이번 실행 사용량: 약 ${unitsUsed} units (하루 한도 10,000)`);
  if (unitsUsed === 0) {
    console.log("   → 전부 캐시에서 가져와서 units을 하나도 안 썼어!");
  }

  return output; // [추가] 백엔드가 결과를 바로 받아 쓸 수 있게 반환
}

// ── 실행 방식 분기 ────────────────────────────────────────────
// fresh를 켜는 두 경로 (둘 중 하나라도 있으면 캐시 무시):
//   ① 터미널 인자:   node youtube.js --fresh
//   ② 환경변수:      YOUTUBE_FRESH=1  ← server.js가 이 방식으로 넘김
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const fresh =
    process.argv.includes("--fresh") || process.env.YOUTUBE_FRESH === "1";
  main({ fresh });
}

// (참고) 백엔드에서 직접 import해서 쓸 수도 있게 함수도 열어둠
export { main as collectYoutubeTrends };
// ──────────────────────────────────────────────────────────────