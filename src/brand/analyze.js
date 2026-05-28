import { wrap } from "../../shared/envelope.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 산출 데이터
const data = {
  source: "브랜드 분석",
  brand_name: "",
  category: "",
  tone_and_manner: [],
  texture_keywords: [],
  target: {
    gender: "",
    age_groups: [],
    involvement: "",
    motivation: [],
  },
  campaign_kpi: "",
  media_channels: [],
  match_keywords: {
    character: [],
    benefit_texture: [],
    target: [],
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
