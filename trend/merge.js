import fs from "fs";

// YouTube, Tavily, 네이버 데이터랩에서 각각 수집한 raw 데이터를 읽어오기
const youtube = JSON.parse(fs.readFileSync("trend/data/youtube_raw.json", "utf-8"));
const tavily = JSON.parse(fs.readFileSync("trend/data/tavily_raw.json", "utf-8"));
const naver = JSON.parse(fs.readFileSync("trend/data/naver_raw.json", "utf-8"));
const naverSearch = JSON.parse(fs.readFileSync("trend/data/naver_search_raw.json", "utf-8"));

// 세 파일을 하나로 합치기
const merged = {
  collected_at: new Date().toISOString(),
  brand_context: youtube.brand_context,
  raw_data: [
    ...youtube.raw_data,   // YouTube 영상 데이터
    ...tavily.raw_data,    // Tavily 기사 데이터
    ...naver.raw_data,        // 네이버 검색량 데이터 (데이터랩)
    ...naverSearch.raw_data   // 네이버 블로그·뉴스 검색 데이터
  ]
};

// 트렌드 분석가 B에게 넘길 파일로 저장
fs.writeFileSync("trend/data/trend_raw.json", JSON.stringify(merged, null, 2), "utf-8");

console.log("=== 병합 완료 ===");
console.log(`YouTube: ${youtube.raw_data.length}개`);
console.log(`Tavily: ${tavily.raw_data.length}개`);
console.log(`Naver DataLab: ${naver.raw_data.length}개`);
console.log(`Naver Search: ${naverSearch.raw_data.length}개`);
console.log(`총 합계: ${merged.raw_data.length}개`);
console.log("trend/data/trend_raw.json 파일로 저장됐어!");