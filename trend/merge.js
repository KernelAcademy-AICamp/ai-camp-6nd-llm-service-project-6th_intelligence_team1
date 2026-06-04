import fs from "fs";

// 수집 raw 파일을 안전하게 읽기 (없으면 빈 배열로)
const readRaw = (p) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : { raw_data: [] };

// YouTube, Tavily, 네이버 데이터랩, 네이버 검색 raw 데이터 읽어오기
const youtube = readRaw("trend/data/youtube_raw.json");
const tavily = readRaw("trend/data/tavily_raw.json");
const naver = readRaw("trend/data/naver_raw.json");
const naverSearch = readRaw("trend/data/naver_search_raw.json"); // 네이버 검색 API (블로그·뉴스, 근거 url 포함)

// 네 소스를 하나로 합치기
const merged = {
  collected_at: new Date().toISOString(),
  brand_context: youtube.brand_context,
  raw_data: [
    ...youtube.raw_data,      // YouTube 영상 데이터 (url 포함)
    ...tavily.raw_data,       // Tavily 기사 데이터 (url 포함)
    ...naver.raw_data,        // 네이버 검색량(DataLab) 데이터 (url 없음, 수치용)
    ...naverSearch.raw_data   // 네이버 검색 API (블로그·뉴스, url 포함)
  ]
};

// 트렌드 분석가 B에게 넘길 파일로 저장
fs.writeFileSync("trend/data/trend_raw.json", JSON.stringify(merged, null, 2), "utf-8");

console.log("=== 병합 완료 ===");
console.log(`YouTube: ${youtube.raw_data.length}개`);
console.log(`Tavily: ${tavily.raw_data.length}개`);
console.log(`Naver DataLab: ${naver.raw_data.length}개`);
console.log(`Naver 검색: ${naverSearch.raw_data.length}개`);
console.log(`총 합계: ${merged.raw_data.length}개`);
console.log("trend/data/trend_raw.json 파일로 저장됐어!");