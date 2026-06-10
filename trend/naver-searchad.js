import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";
fs.mkdirSync("trend/data", { recursive: true });
dotenv.config();

// ── 인증 정보 (.env에서 읽음) ──────────────────────────────────
const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;     // 내 계정 ID
const ACCESS_LICENSE = process.env.NAVER_AD_ACCESS_LICENSE; // 액세스라이선스 (API_KEY)
const SECRET_KEY = process.env.NAVER_AD_SECRET_KEY;        // 비밀키
const BASE_URL = "https://api.searchad.naver.com";
// ──────────────────────────────────────────────────────────────

// ── 니치 판정 기준 (★ 매칭가가 정할 값 — 이 숫자만 바꾸면 조정됨) ──
// 월간 검색수(PC+모바일)가 이 값 미만이면 is_niche = true
const NICHE_THRESHOLD = 5000;

// ── 검색어 부적합 기준 (안전장치) ──────────────────────────────
// 검색량이 이 값 미만이면 "니치"가 아니라 "검색어 자체가 부적합"으로 분리.
// 키워드 생성이 가끔 만들어내는 불량 키워드(예: "30대 파운데이션" 월 20)를
// 매칭가가 "니치 시장"으로 오해하지 않도록 막는 그물.
// 키워드 생성이 개선되면 거의 안 걸림 (조용히 대기).
const INVALID_THRESHOLD = 50;
// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────

// ── 캐시 설정 (youtube.js와 동일 패턴) ─────────────────────────
const CACHE_PATH = "trend/data/searchad_cache.json";
const TODAY = new Date().toISOString().slice(0, 10); // "2026-06-08"

function loadCacheFromDisk() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

let cache = {};
// ──────────────────────────────────────────────────────────────

// brand-analysis.json에서 short_keywords 읽어옴
const brandAnalysis = JSON.parse(
  fs.readFileSync("shared/data/brand-analysis.json", "utf-8")
);
const KEYWORDS = brandAnalysis.data.short_keywords;

// ── HMAC-SHA256 서명 생성 (네이버 공식 인증 방식) ──────────────
// 네이버 검색광고 API는 키를 URL에 붙이는 게 아니라,
// 타임스탬프 + 메서드 + 경로를 비밀키로 서명해서 헤더에 넣어야 함.
function buildHeaders(method, apiPath) {
  const timestamp = String(Date.now());
  const message = `${timestamp}.${method}.${apiPath}`;
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(message)
    .digest("base64");

  return {
    "Content-Type": "application/json; charset=UTF-8",
    "X-Timestamp": timestamp,
    "X-API-KEY": ACCESS_LICENSE,
    "X-Customer": CUSTOMER_ID,
    "X-Signature": signature
  };
}
// ──────────────────────────────────────────────────────────────

// 숫자 변환 헬퍼 (네이버는 검색수가 적으면 "< 10" 문자열로 옴)
function toNumber(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const cleaned = String(v).replace(/[^0-9]/g, ""); // "< 10" → "10"
  return parseInt(cleaned) || 0;
}

// 만 단위 한국어 표기 (48000 → "4.8만")
function toManUnit(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "만";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "천";
  return String(n);
}

// ── 검색수 → 0~100 점수 (로그 스케일) ─────────────────────────
// 검색량은 편차가 커서 단순 비례보다 로그가 적합.
// 월 10만 이상 ≈ 100점, 월 100 ≈ 0점 근처.
function demandScore(monthly) {
  if (monthly <= 0) return 0;
  const score = (Math.log10(monthly) / Math.log10(100000)) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── 경쟁 등급 → 0~100 점수 (낮을수록 고득점 = 선점 유리) ───────
function competitionScore(level) {
  const map = { "낮음": 85, "중간": 50, "높음": 20 };
  return map[level] ?? 50;
}

async function fetchKeywordDemand(keyword) {
  // 캐시 확인 (같은 날 같은 키워드면 재사용)
  const cacheKey = `${keyword}__${TODAY}`;
  if (cache[cacheKey]) {
    console.log(`  └ (캐시 사용) "${keyword}"`);
    return cache[cacheKey];
  }

  const apiPath = "/keywordstool";
  const headers = buildHeaders("GET", apiPath);

  // 네이버 키워드도구는 hintKeywords에 공백이 있으면 400(invalid parameters) 발생.
  // → 공백을 제거해서 보냄. "실키 파운데이션" → "실키파운데이션"
  const hint = keyword.replace(/\s/g, "");

  let resData;
  try {
    const res = await axios.get(`${BASE_URL}${apiPath}`, {
      headers,
      params: {
        hintKeywords: hint,
        showDetail: 1
      }
    });
    resData = res.data;
  } catch (e) {
    console.log(`  ⚠️ "${keyword}" 조회 실패: ${e.response?.status || e.message}`);
    if (e.response?.data) {
      console.log(`     상세: ${JSON.stringify(e.response.data)}`);
    }
    return null;
  }

  // keywordList에서 입력 키워드와 정확히 일치하는 항목 찾기
  // (네이버는 공백 제거 + 대문자로 키워드를 돌려줌)
  const list = resData.keywordList || [];
  const normalized = keyword.replace(/\s/g, "").toUpperCase();
  const exact = list.find(
    item => item.relKeyword.replace(/\s/g, "").toUpperCase() === normalized
  );
  const target = exact || list[0]; // 정확 매칭 없으면 첫 연관어로 대체
  if (!target) {
    console.log(`  ⚠️ "${keyword}" 결과 없음`);
    return null;
  }

  const pc = toNumber(target.monthlyPcQcCnt);
  const mobile = toNumber(target.monthlyMobileQcCnt);
  const total = pc + mobile;
  const compLevel = target.compIdx || "중간"; // 높음/중간/낮음

  // 검색량 극소 → "검색어 부적합"으로 분리 (니치와 구분)
  const isInvalid = total < INVALID_THRESHOLD;
  // 부적합이 아니면서 임계값 미만이면 → 진짜 니치
  const isNiche = !isInvalid && total < NICHE_THRESHOLD;

  // demand_fit.evidence를 3가지 상태로 분기
  let demandEvidence;
  if (isInvalid) {
    demandEvidence = `월간 검색 ${toManUnit(total)} — 검색량 극소(검색어 부적합 가능성), 매칭 판단 보류 권장`;
  } else if (isNiche) {
    demandEvidence = `월간 검색 ${toManUnit(total)} (PC ${toManUnit(pc)} / 모바일 ${toManUnit(mobile)}) — 수요 작게 잡힘, 참고`;
  } else {
    demandEvidence = `월간 검색 ${toManUnit(total)} (PC ${toManUnit(pc)} / 모바일 ${toManUnit(mobile)})`;
  }

  const result = {
    demand_fit: {
      monthly_searches: total,
      score: demandScore(total),
      invalid_keyword: isInvalid, // true면 검색어 자체가 부적합 (니치 아님)
      is_niche: isNiche,          // true면 진짜 니치 시장
      evidence: demandEvidence
    },
    competition_fit: {
      level: compLevel,
      score: competitionScore(compLevel),
      evidence:
        compLevel === "낮음"
          ? "경쟁 낮음 — 선점 유리"
          : compLevel === "높음"
          ? "경쟁 높음 — 차별화 필요"
          : "경쟁 중간"
    }
  };

  cache[cacheKey] = result;
  return result;
}

async function main({ fresh = false } = {}) {
  cache = fresh ? {} : loadCacheFromDisk();
  if (fresh) console.log("⚡ FRESH 모드: 캐시 무시하고 새로 받습니다\n");

  console.log("네이버 검색광고 수요 수집 시작...\n");
  console.log(`short_keywords ${KEYWORDS.length}개 조회\n`);

  const output = {};
  for (const keyword of KEYWORDS) {
    console.log(`"${keyword}" 조회 중...`);
    const data = await fetchKeywordDemand(keyword);
    if (data) output[keyword] = data;
    // 네이버 API 호출 간격 (과도한 연속 호출 방지)
    await new Promise(r => setTimeout(r, 300));
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
  fs.writeFileSync(
    "trend/data/search-demand.json",
    JSON.stringify(output, null, 2),
    "utf-8"
  );

  console.log("\n=== 수집 완료 ===");
  const nicheCount = Object.values(output).filter(v => v.demand_fit.is_niche).length;
  const invalidCount = Object.values(output).filter(v => v.demand_fit.invalid_keyword).length;
  console.log(`총 ${Object.keys(output).length}개 키워드 수집 (니치: ${nicheCount}개 / 검색어 부적합: ${invalidCount}개)`);
  if (invalidCount > 0) {
    console.log(`  ⚠️ 검색어 부적합 ${invalidCount}개 — 키워드 생성 점검 필요할 수 있음`);
  }
  Object.entries(output).slice(0, 3).forEach(([k, v]) => {
    console.log(`  "${k}" — ${v.demand_fit.evidence} / ${v.competition_fit.evidence}`);
  });
  console.log("trend/data/search-demand.json 저장됨");
  console.log(`\n(니치 기준: 월 ${NICHE_THRESHOLD.toLocaleString()} 미만 — 매칭가가 조정 가능)`);

  return output;
}

// ── 실행 방식 분기 (youtube.js와 동일) ────────────────────────
//   터미널:  node naver-searchad.js  /  node naver-searchad.js --fresh
//   서버경유: 환경변수 NAVER_FRESH=1
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const fresh =
    process.argv.includes("--fresh") || process.env.NAVER_FRESH === "1";
  main({ fresh });
}

export { main as collectSearchDemand };