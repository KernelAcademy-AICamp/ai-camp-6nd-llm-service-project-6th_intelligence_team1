import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
dotenv.config();
fs.mkdirSync("trend/data", { recursive: true });

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const BASE_URL = "https://openapi.naver.com/v1/datalab/search";

// 브랜드 분석가가 만든 brand-analysis.json을 읽어옴
const brandAnalysis = JSON.parse(
  fs.readFileSync("shared/data/brand-analysis.json", "utf-8")
);

// datalab_keywords를 키워드 그룹으로 사용 (하드코딩 대신 동적으로)
const KEYWORD_GROUPS = brandAnalysis.data.datalab_keywords;

// brand_context도 brand-analysis.json에서 가져옴
const brandContext = {
  target_gender: brandAnalysis.data.target.gender,
  target_age: brandAnalysis.data.target.age_groups.join(", "),
  tone: brandAnalysis.data.tone_and_manner.join(", ")
};

async function fetchSearchTrend() {
  const response = await axios.post(BASE_URL,
    {
      startDate: "2026-01-01",
      endDate: new Date().toISOString().split("T")[0],
      timeUnit: "month",
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
  console.log(`키워드 그룹 ${KEYWORD_GROUPS.length}개를 brand-analysis.json에서 읽어왔어!\n`);

  const result = await fetchSearchTrend();

  const output = {
    collected_at: new Date().toISOString(),
    brand_context: brandContext,
    raw_data: result.results.map(group => ({
      query: group.title,
      source: "naver_datalab",
      keywords: group.keywords,
      latest_ratio: group.data[group.data.length - 1]?.ratio || 0,
      trend_data: group.data,
      published_at: null,   // DataLab은 항목별 발행일 없음 → 최신성 미집계(정상)
      url: null
    }))
  };

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