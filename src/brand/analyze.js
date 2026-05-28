import { wrap } from "../../shared/envelope.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 브랜드 분석가 산출 데이터
const data = {
  source: "브랜드 분석",
  brand_name: "힌스 (hince)",
  product_name: "로 글로우 젤 틴트 미니",
  category: "메이크업 > 립",
  tone_and_manner: ["Z세대·트렌디"],
  texture_keywords: ["글로우"],
  target: {
    gender: "여성",
    age_groups: ["Z세대"],
    involvement: "일상사용자",
    motivation: ["자기표현"],
  },
  campaign_kpi: "재구매 유도",
  campaign_period: "한달",
  campaign_budget: "200~500만원",
  media_channels: ["유튜브"],
  match_keywords: {
    character: ["Z세대·트렌디"],
    benefit_texture: ["립", "메이크업", "글로우"],
    target: ["여성", "Z세대", "일상사용자", "자기표현"],
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
