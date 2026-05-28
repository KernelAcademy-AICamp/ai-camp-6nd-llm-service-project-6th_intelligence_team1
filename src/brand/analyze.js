import { wrap } from "../../shared/envelope.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 산출 데이터
const data = {
  source: "브랜드 분석",
  brand_name: "hince",
  category: "",
  tone_and_manner: ["Z세대·트렌디"],
  texture_keywords: [],
  target: {
    gender: "여성",
    age_groups: ["20대", "30대"],
    involvement: "",
    motivation: [],
  },
  campaign_kpi: "",
  media_channels: [],
  match_keywords: {
    character: ["Z세대·트렌디"],
    benefit_texture: [],
    target: ["여성", "20대", "30대"],
  },
};

// envelope으로 감싸 매칭가에게 전달
const output = wrap(data);

// 파일 기준 절대경로로 저장 (실행 위치 무관)
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../../shared/data/brand-analysis.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

export default output;
