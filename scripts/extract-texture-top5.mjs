// 카테고리별 텍스처 키워드 TOP 5 추출 (임시 분석 스크립트)
//
// 동작:
//   1. 카테고리 키워드("쉐이딩"·"하이라이터"·"블러셔")를 네이버 검색광고 API에
//      hintKeywords로 던져 연관 키워드 + 월 검색량(monthlyPcQcCnt + Mobile)을 받는다
//   2. 응답에서 텍스처/제형 후보 어휘를 정규식으로 토큰 추출
//   3. 텍스처별로 검색량 합산해 내림차순 정렬, TOP 5 출력
//
// 실행:
//   NODE_OPTIONS=--use-system-ca node scripts/extract-texture-top5.mjs

import "dotenv/config";
import axios from "axios";
import crypto from "crypto";

const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;
const ACCESS_LICENSE = process.env.NAVER_AD_ACCESS_LICENSE;
const SECRET_KEY = process.env.NAVER_AD_SECRET_KEY;
const BASE_URL = "https://api.searchad.naver.com";

// 후보 텍스처 어휘 — 기존 schemas.js의 ALL_TEXTURES 기반 + 베이스 메이크업 빈출어
const TEXTURE_VOCAB = [
  "매트", "글로우", "광채", "촉촉", "벨벳", "누드", "세미매트", "글로시",
  "지속력", "톤업", "밀착", "커버력", "시어", "글리터", "펄", "픽싱",
  "볼륨", "보습", "수분", "탄력", "쿨톤", "웜톤", "내추럴", "자연스러운",
  "고발색", "발색", "쉬머", "데일리",
];

const CATEGORIES = ["쉐이딩", "하이라이터", "블러셔"];

function buildHeaders(method, apiPath) {
  const timestamp = String(Date.now());
  const message = `${timestamp}.${method}.${apiPath}`;
  const signature = crypto.createHmac("sha256", SECRET_KEY).update(message).digest("base64");
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "X-Timestamp": timestamp,
    "X-API-KEY": ACCESS_LICENSE,
    "X-Customer": CUSTOMER_ID,
    "X-Signature": signature,
  };
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).replace(/[<>]/g, "").trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

async function fetchRelatedKeywords(seed) {
  const apiPath = "/keywordstool";
  const headers = buildHeaders("GET", apiPath);
  const res = await axios.get(`${BASE_URL}${apiPath}`, {
    headers,
    params: { hintKeywords: seed, showDetail: "1" },
  });
  return res.data?.keywordList ?? [];
}

// 키워드 문자열에서 텍스처 어휘 토큰 추출
function findTexturesInKeyword(keyword) {
  const hits = [];
  for (const t of TEXTURE_VOCAB) {
    if (keyword.includes(t)) hits.push(t);
  }
  return hits;
}

async function extractTop5(seed) {
  const list = await fetchRelatedKeywords(seed);
  const textureScore = new Map(); // texture → 누적 월 검색량
  const textureHitCount = new Map(); // texture → 등장 키워드 수

  for (const item of list) {
    const keyword = item.relKeyword ?? "";
    const monthlyVolume = toNumber(item.monthlyPcQcCnt) + toNumber(item.monthlyMobileQcCnt);
    if (monthlyVolume <= 0) continue;
    const textures = findTexturesInKeyword(keyword);
    for (const t of textures) {
      textureScore.set(t, (textureScore.get(t) ?? 0) + monthlyVolume);
      textureHitCount.set(t, (textureHitCount.get(t) ?? 0) + 1);
    }
  }

  const sorted = [...textureScore.entries()]
    .map(([t, v]) => ({ texture: t, totalVolume: v, hits: textureHitCount.get(t) ?? 0 }))
    .sort((a, b) => b.totalVolume - a.totalVolume);

  return { seed, total: list.length, top: sorted };
}

(async () => {
  for (const cat of CATEGORIES) {
    process.stdout.write(`\n=== ${cat} ===\n`);
    try {
      const r = await extractTop5(cat);
      console.log(`연관 키워드 ${r.total}개 분석`);
      console.log(`텍스처별 누적 검색량 정렬:`);
      r.top.slice(0, 10).forEach((row, i) => {
        const mark = i < 5 ? "★" : " ";
        console.log(`  ${mark} ${(i + 1).toString().padStart(2)}. ${row.texture.padEnd(8)} — 검색량 ${row.totalVolume.toLocaleString()} (등장 ${row.hits}회)`);
      });
      console.log(`\nTOP 5: [${r.top.slice(0, 5).map(x => `"${x.texture}"`).join(", ")}]`);
    } catch (err) {
      console.error(`❌ ${cat} 조회 실패:`, err?.response?.data ?? err.message);
    }
  }
})();
