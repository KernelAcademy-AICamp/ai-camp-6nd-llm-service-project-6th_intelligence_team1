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

// ── 수집 기간 창: 다른 소스(유튜브 등)와 동일하게 최근 180일(6개월)로 통일 ──
//    Tavily SDK는 startDate(YYYY-MM-DD)로 발행일 필터를 지원한다.
//    general 토픽은 publishedDate가 없는 결과가 일부 있어, 아래 안전망 필터로 보강한다.
const WINDOW_DAYS = 180;
const START_DATE = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);

async function fetchTrendArticles(query) {
  const response = await client.search(query, {
    searchDepth: "basic",
    maxResults: 10,
    includeAnswer: false,
    startDate: START_DATE,   // 최근 180일만 요청 (카드 표기 "최근 6개월"과 일치)
  });

  const cutoff = Date.now() - WINDOW_DAYS * 864e5;
  return response.results
    // 발행일이 있으면 180일 안쪽인지 한 번 더 확인 (없으면 통과 — general 토픽은 발행일 누락 가능)
    .filter(result => !result.publishedDate || new Date(result.publishedDate).getTime() >= cutoff)
    .map(result => ({
      query: query,
      source: "tavily",
      title: result.title,
      description: result.content,
      published_at: result.publishedDate || null,   // 실제 발행일 확보 → 신뢰도 최신성 집계 합류
      url: result.url
    }));
}

// ── 캐시 재사용 조건: ① 7일 이내 ② 입력 검색 키워드가 캐시 생성 당시와 동일 ──
//    (입력이 바뀌면 키워드가 달라져 캐시가 안 맞으므로 자동으로 새로 수집한다)
const CACHE_PATH = "trend/data/tavily_raw.json";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const FRESH = process.env.TAVILY_FRESH === "1";   // 강제 새로고침 플래그

// 키워드 목록을 순서와 무관하게 비교하기 위한 지문(fingerprint)
function keywordFingerprint(keywords) {
  return JSON.stringify([...(keywords ?? [])].sort());
}

function cacheIsFresh() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    const ts = cached.collected_at ? new Date(cached.collected_at).getTime() : 0;
    const age = Date.now() - ts;
    if (!(age >= 0 && age < CACHE_MAX_AGE_MS)) return false;
    // 입력(검색 키워드)이 캐시 생성 당시와 동일할 때만 재사용
    return keywordFingerprint(cached.search_keywords) === keywordFingerprint(QUERIES);
  } catch { return false; }
}

async function main() {
  if (!FRESH && cacheIsFresh()) {
    // 캐시를 쓰더라도 로딩 피드에 키워드가 보이도록 한 줄씩 찍어준다 (API 재호출 없음).
    console.log("Tavily 트렌드 기사 수집 시작 (캐시 재사용)...");
    for (const query of QUERIES) console.log(`"${query}" 검색 중... (캐시)`);
    console.log("Tavily: 7일 이내 + 동일 키워드 캐시(tavily_raw.json) 재사용 — API 호출 건너뜀. (새로 받으려면 TAVILY_FRESH=1)");
    return;
  }
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
    search_keywords: QUERIES,   // 캐시 재사용 판단용 — 다음 실행 때 입력 키워드와 비교
    brand_context: brandContext,
    raw_data: results
  };

  fs.writeFileSync("trend/data/tavily_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 기사 수집됨`);
  console.log("trend/data/tavily_raw.json 파일로 저장됐어!");
}

main();