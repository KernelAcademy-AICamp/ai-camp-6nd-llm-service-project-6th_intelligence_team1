import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
dotenv.config();
fs.mkdirSync("trend/data", { recursive: true });

const VERSION = "v2 (필터 + 속도제한 대응)";

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// ===== 필터 설정 (여기 숫자/단어만 바꾸면 됨) =====
const MONTHS_BACK = 18;   // 최근 N개월 안에 작성된 글만 남김
const DISPLAY = 30;       // 필터 전에 넉넉히 가져올 개수 (최대 100)
const MAX_RESULTS = 5;    // 필터 후 검색어·타입당 최종 개수
const DELAY_MS = 400;     // 요청 사이 간격 (속도 제한 방지)

const BEAUTY_TERMS = [
  "쿠션", "메이크업", "베이스", "파운데이션", "파데", "뷰티",
  "화장", "피부", "립", "섀도", "코스메틱", "톤업", "커버", "컬러"
];
const EXCLUDE_TERMS = [
  "매트리스", "침대", "숙면", "고데기", "매직기",
  "사복", "데일리앱", "기록앱", "일기앱", "스케줄러"
];
// ================================================

const brandAnalysis = JSON.parse(
  fs.readFileSync("shared/data/brand-analysis.json", "utf-8")
);
const QUERIES = brandAnalysis.data.search_keywords;
const brandContext = {
  target_gender: brandAnalysis.data.target.gender,
  target_age: brandAnalysis.data.target.age_groups.join(", "),
  tone: brandAnalysis.data.tone_and_manner.join(", ")
};

const cutoffDate = new Date();
cutoffDate.setMonth(cutoffDate.getMonth() - MONTHS_BACK);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseDate(item, type) {
  if (type === "blog" && item.postdate) {
    const d = item.postdate;
    return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  }
  if (type === "news" && item.pubDate) return new Date(item.pubDate);
  return null;
}

function isRelevant(text) {
  return BEAUTY_TERMS.some(w => text.includes(w)) && !EXCLUDE_TERMS.some(w => text.includes(w));
}

// 429(속도 제한) 등 일시적 실패 시 잠깐 기다렸다 최대 3번 재시도
async function requestWithRetry(query, type, attempt = 1) {
  try {
    return await axios.get(
      `https://openapi.naver.com/v1/search/${type}.json`,
      {
        params: { query, display: DISPLAY, sort: "sim" },
        headers: {
          "X-Naver-Client-Id": CLIENT_ID,
          "X-Naver-Client-Secret": CLIENT_SECRET
        }
      }
    );
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 && attempt <= 3) {
      const wait = 2000 * attempt;
      console.log(`  ⏳ 속도 제한(429). ${wait / 1000}초 쉬고 재시도... (${attempt}/3)`);
      await sleep(wait);
      return requestWithRetry(query, type, attempt + 1);
    }
    // 그 외 에러는 짧은 메시지만 출력하고 건너뜀
    console.log(`  ⚠️  "${query}" (${type}) 실패: ${status || err.code || err.message}`);
    return null;
  }
}

async function fetchNaverSearch(query, type) {
  const response = await requestWithRetry(query, type);
  if (!response) return [];

  const filtered = [];
  for (const item of response.data.items) {
    const title = cleanText(item.title);
    const description = cleanText(item.description);
    if (!isRelevant(title + " " + description)) continue;
    const date = parseDate(item, type);
    if (date && date < cutoffDate) continue;
    filtered.push({ query, source: `naver_${type}`, title, description, url: item.link });
    if (filtered.length >= MAX_RESULTS) break;
  }
  return filtered;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 가 .env 에 없어!");
    process.exit(1);
  }

  console.log(`\n=== naver-search ${VERSION} ===`);
  console.log(`검색어 ${QUERIES.length}개 / 필터: 최근 ${MONTHS_BACK}개월 + 뷰티 관련 글만\n`);

  const results = [];
  for (const query of QUERIES) {
    console.log(`"${query}" 검색 중...`);
    const blog = await fetchNaverSearch(query, "blog");
    await sleep(DELAY_MS);                 // 요청 사이 간격
    const news = await fetchNaverSearch(query, "news");
    await sleep(DELAY_MS);
    results.push(...blog, ...news);
  }

  const output = {
    collected_at: new Date().toISOString(),
    brand_context: brandContext,
    raw_data: results
  };

  fs.writeFileSync("trend/data/naver_search_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("\n=== 수집 완료 ===");
  console.log(`총 ${results.length}개 기사 수집됨 (필터 적용 후)`);
  console.log("trend/data/naver_search_raw.json 파일로 저장됐어!");
}

main();
