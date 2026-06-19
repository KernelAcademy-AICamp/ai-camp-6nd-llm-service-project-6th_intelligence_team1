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
const CACHE_PATH = "trend/data/youtube_raw.json";
const FRESH = process.env.YOUTUBE_FRESH === "1";

// ── 품질 튜닝 다이얼 ──────────────────────────────
const RECENT_DAYS = 180;   // 최근 N일 (30 → 180: 표본 확보. 더 최신만 원하면 90)
const MAX_RESULTS = 25;    // 키워드당 영상 수 (search.list 비용은 결과수와 무관)
// ────────────────────────────────────────────────

const brandAnalysis = JSON.parse(
  fs.readFileSync("shared/data/brand-analysis.json", "utf-8")
);

const QUERIES = brandAnalysis.data.search_keywords;

// 키워드 목록을 순서와 무관하게 비교하기 위한 지문(fingerprint)
function keywordFingerprint(keywords) {
  return JSON.stringify([...(keywords ?? [])].sort());
}

// 기존 캐시 파일이 "지금 입력 키워드"로 수집된 것인지 확인
function cachedKeywordsMatch() {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    return keywordFingerprint(cached.search_keywords) === keywordFingerprint(QUERIES);
  } catch { return false; }
}

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
  // ① 캐시 재사용: FRESH가 아니고 + 기존 파일이 + 지금 입력 키워드로 수집된 것이면 그대로 사용.
  //    (YouTube Data API 일일 할당량 절약. 입력 키워드가 바뀌면 캐시가 안 맞아 자동으로 새로 수집.
  //     강제로 새로 받고 싶으면 ?fresh=1 로 실행)
  if (!FRESH && fs.existsSync(CACHE_PATH) && cachedKeywordsMatch()) {
    // 캐시를 쓰더라도 로딩 피드에 키워드가 보이도록 한 줄씩 찍어준다 (API 재호출 없음).
    console.log("YouTube 트렌드 수집 시작 (캐시 재사용)...");
    for (const query of QUERIES) console.log(`"${query}" 검색 중... (캐시)`);
    console.log("YouTube: 동일 키워드 캐시(youtube_raw.json) 재사용 (새로 받으려면 ?fresh=1 / YOUTUBE_FRESH=1).");
    return;
  }

  console.log("YouTube 트렌드 수집 시작...\n");
  console.log(`검색어 ${QUERIES.length}개를 brand-analysis.json에서 읽어왔어!\n`);

  // ② 수집 시도. 할당량 초과(429) 등으로 실패하면 부분 결과로 덮어쓰지 않고
  //    기존 캐시를 유지한 채 정상 종료(exit 0) → 파이프라인이 멈추지 않는다.
  const results = [];
  try {
    for (const query of QUERIES) {
      console.log(`"${query}" 검색 중...`);
      const videos = await fetchTrendingVideos(query);
      console.log(`  → ${videos.length}개 수집`);
      results.push(...videos);
    }
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || err.message;
    console.warn(`\n⚠️ YouTube 수집 실패${status ? ` (${status})` : ""}: ${msg}`);
    if (fs.existsSync(CACHE_PATH)) {
      console.warn("→ 기존 youtube_raw.json을 유지하고 계속 진행합니다.");
      return;
    }
    console.error("→ 캐시도 없어 진행 불가. 할당량 리셋 후 재시도하거나 새 YOUTUBE_API_KEY를 사용하세요.");
    process.exitCode = 1;
    return;
  }

  const output = {
    collected_at: new Date().toISOString(),
    search_keywords: QUERIES,   // 캐시 재사용 판단용 — 다음 실행 때 입력 키워드와 비교
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
