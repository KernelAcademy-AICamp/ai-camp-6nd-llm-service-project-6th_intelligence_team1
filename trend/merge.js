import fs from "fs";

// YouTube와 Tavily에서 각각 수집한 raw 데이터를 읽어오기
const youtube = JSON.parse(fs.readFileSync("trend/data/youtube_raw.json", "utf-8"));
const tavily = JSON.parse(fs.readFileSync("trend/data/tavily_raw.json", "utf-8"));

// 두 파일을 하나로 합치기
// brand_context는 두 파일이 동일하니까 youtube 파일 것을 그대로 쓰면 돼
const merged = {
  collected_at: new Date().toISOString(),
  brand_context: youtube.brand_context,
  raw_data: [
    ...youtube.raw_data,   // YouTube 영상 데이터
    ...tavily.raw_data     // Tavily 기사 데이터
  ]
};

// 합친 결과를 트렌드 분석가 B에게 넘길 파일로 저장
fs.writeFileSync("trend/data/trend_raw.json", JSON.stringify(merged, null, 2), "utf-8");

console.log("=== 병합 완료 ===");
console.log(`YouTube: ${youtube.raw_data.length}개`);
console.log(`Tavily: ${tavily.raw_data.length}개`);
console.log(`총 합계: ${merged.raw_data.length}개`);
console.log("trend/data/trend_raw.json 파일로 저장됐어!");