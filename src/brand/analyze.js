import { wrap } from "../../shared/envelope.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 산출 데이터 (cycle 2)
const data = {
  source: "브랜드 분석",
  brand_name: "힌스 (hince)",
  product_name: "커버 마스터 핑크 쿠션",
  category: "메이크업 > 베이스",
  tone_and_manner: ["Z세대·트렌디"],
  texture_keywords: ["매트"],
  target: {
    gender: "여성",
    age_groups: ["20대"],
    involvement: "일상사용자",
    motivation: ["자기표현"],
  },
  campaign_kpi: "재구매 유도",
  campaign_period: "한달",
  campaign_budget: "200~500만원",
  media_channels: ["유튜브"],
  match_keywords: {
    character: ["Z세대·트렌디"],
    benefit_texture: ["베이스", "메이크업", "매트"],
    target: ["여성", "20대", "일상사용자", "자기표현"],
    campaign: ["재구매 유도", "한달", "200~500만원", "유튜브"],
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
