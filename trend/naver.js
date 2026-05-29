import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
dotenv.config();

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const BASE_URL = "https://openapi.naver.com/v1/datalab/search";

const KEYWORD_GROUPS = [
  {
    groupName: "매트 쿠션",
    keywords: ["매트쿠션", "커버쿠션", "세미매트쿠션"]
  },
  {
    groupName: "베이스 메이크업",
    keywords: ["쿠션추천", "데일리쿠션", "20대쿠션"]
  },
  {
    groupName: "커버 베이스 트렌드",
    keywords: ["커버력쿠션", "지속력쿠션", "모공커버"]
  }
];

async function fetchSearchTrend() {
  const response = await axios.post(BASE_URL,
    {
      startDate: "2026-01-01",  // 올해 1월부터
      endDate: new Date().toISOString().split("T")[0],  // 오늘까지
      timeUnit: "month",        // 월별 데이터
      keywordGroups: KEYWORD_GROUPS
    },
    {
      headers: {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}

async function main() {
  console.log("네이버 데이터랩 트렌드 수집 시작...\n");

  const result = await fetchSearchTrend();

  // 트렌드 분석가 B에게 넘길 형태로 포맷 구성
  const output = {
    collected_at: new Date().toISOString(),
    brand_context: {
      target_gender: "여성",
      target_age: "20대",
      tone: "Z세대·트렌디"
    },
    raw_data: result.results.map(group => ({
      query: group.title,
      source: "naver_datalab",
      keywords: group.keywords,
      // 가장 최근 달의 검색량 지수를 evidence로 활용
      latest_ratio: group.data[group.data.length - 1]?.ratio || 0,
      trend_data: group.data,  // 월별 검색량 추이 전체
      url: null
    }))
  };

  // JSON 파일로 저장
  fs.writeFileSync("trend/data/naver_raw.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("=== 수집 완료 ===");
  console.log(`총 ${output.raw_data.length}개 키워드 그룹 수집됨`);
  result.results.forEach(group => {
    const latest = group.data[group.data.length - 1];
    console.log(`"${group.title}" 최근 검색량 지수: ${latest?.ratio || 0}`);
  });
  console.log("trend/data/naver_raw.json 파일로 저장됐어!");
}

main();