import { wrap } from "../../shared/envelope.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 트렌드 분석가 산출 데이터
const data = {
  analyzed_at: "2026-05-26T10:00:00+09:00",
  trend_count: 1,
  trends: [
    {
      trend_id: "T001",
      trend_name: "무드 누드립 (MLBB)",
      keywords: ["누드립", "무드립", "MLBB", "벨벳틴트"],
      summary: "20-30대 여성 무드 누드립 검색 38% 상승",
      headline_metric: {
        metric: "검색량 지수",
        value: "78",
        delta: "+38% vs 전월",
      },
      meaning:
        "무드 누드립은 단순한 컬러 트렌드를 넘어 '입술 본연의 톤에 분위기를 더한다'는 Z세대의 자기표현 코드와 연결되어, 립 카테고리의 핵심 구매 동기로 자리잡고 있습니다.",
      status:
        "Naver 검색 지수가 전월 대비 38% 상승했고, YouTube의 무드 누드립 튜토리얼 영상은 평균 9.4만 조회수를 기록 중입니다. 캐릿·대학내일 등 정성 매체에서도 2026년 상반기 립 코어 키워드로 명시되고 있습니다.",
      metrics: {
        score: 78,
        growth_rate: 0.38,
        period: "2026-04 ~ 2026-05",
      },
      evidence: [
        {
          source: "Naver DataLab",
          source_type: "search_api",
          metric: "검색량 지수",
          value: "78 (전월 대비 +38%)",
          raw_value: 78,
          period: "2026-04 ~ 2026-05",
        },
        {
          source: "YouTube Data API",
          source_type: "sns_api",
          metric: "튜토리얼 영상 평균 조회수",
          value: "94,000회",
          raw_value: 94000,
          period: "최근 30일",
        },
        {
          source: "캐릿",
          source_type: "rag",
          metric: "트렌드 해설 인용",
          value: "2026 상반기 립 코어 키워드로 'MLBB' 부상",
        },
      ],
      audience_distribution: {
        primary_gender: "female",
        primary_age: ["20s", "30s"],
        gender_ratio: {
          female: 0.87,
          male: 0.13,
        },
        age_ratio: {
          "10s": 0.11,
          "20s": 0.39,
          "30s": 0.29,
          "40s": 0.15,
          "50s+": 0.06,
        },
        source: "Naver DataLab 성별·연령 분해 + YouTube Audience",
      },
      media_channel_status: [
        {
          media_channel: "YouTube",
          status: "무드 누드립 튜토리얼·립 비교 영상 급증",
        },
        {
          media_channel: "Instagram",
          status: "벨벳틴트 클로즈업 릴스·립 스와치 카드뉴스 인게이지먼트 상승",
        },
        {
          media_channel: "TikTok",
          status: "#무드누드립 해시태그 누적 조회 2.1억회",
        },
      ],
    },
  ],
};

// envelope으로 감싸 매칭가에게 전달
const output = wrap(data);

// 파일 기준 절대경로로 저장 (실행 위치 무관)
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../../shared/data/trend-analysis.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

export default output;
