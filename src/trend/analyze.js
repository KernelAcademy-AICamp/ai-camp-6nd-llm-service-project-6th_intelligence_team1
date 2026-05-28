import { wrap } from "../../shared/envelope.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 트렌드 분석가 산출 데이터
const data = {
  // ========== 메타 정보 ==========
  source: "트렌드 분석", // 산출 라벨 (브랜드 분석가의 source 필드와 대응)
  analyzed_at: "2026-05-26T10:00:00+09:00", // 분석 시점 (ISO 8601)
  trend_count: 1, // 트렌드 개수

  trends: [
    {
      // ========== A. 식별·메타 블록 ==========
      trend_id: "T001",
      trend_name: "글로우 누드립",
      category: "메이크업 > 립", // 매칭가 카테고리 게이트용. 브랜드와 "대분류 > 소분류" 표기 동일
      keywords: ["글로우립", "물광 틴트", "촉촉 누드", "젤 텍스처"],

      // ========== B. 요약 블록 ==========
      summary: "20-30대 여성 글로우 누드립 검색 38% 상승", // 50자 이내
      headline_metric: {
        metric: "검색량 지수",
        value: "84",
        delta: "+38% vs 전월",
      },

      // ========== C. 심층 분석 블록 ==========
      meaning:
        "글로우 누드립은 단순 컬러 트렌드를 넘어 '입술 본연의 톤에 윤기를 더한다'는 Z세대 자기표현 코드와 연결되어, 데일리 메이크업의 마무리 한 끗을 책임지는 립 카테고리의 코어 코드로 자리잡고 있습니다.",
      status:
        "Naver 검색 지수가 전월 대비 38% 상승했고, YouTube 립 튜토리얼·틴트 비교 영상은 평균 11만 조회수를 기록 중입니다. 캐릿·대학내일 등 정성 매체에서도 글로우 누드립을 2026 상반기 립 코어 키워드로 명시하고 있습니다.",
      metrics: {
        score: 84,
        growth_rate: 0.38,
        period: "2026-04 ~ 2026-05",
      },
      evidence: [
        {
          source: "Naver DataLab",
          source_type: "search_api",
          metric: "검색량 지수",
          value: "84 (전월 대비 +38%)",
          raw_value: 84,
          period: "2026-04 ~ 2026-05",
        },
        {
          source: "YouTube Data API",
          source_type: "sns_api",
          metric: "립 튜토리얼·틴트 비교 영상 평균 조회수",
          value: "110,000회",
          raw_value: 110000,
          period: "최근 30일",
        },
        {
          source: "캐릿",
          source_type: "rag",
          metric: "트렌드 해설 인용",
          value: "2026 상반기 립 코어 키워드로 '글로우 누드립' 부상",
        },
      ],

      // ========== (매칭가 2-A 입력) audience_distribution ==========
      audience_distribution: {
        primary_gender: "female",
        primary_age: ["20s", "30s"],
        gender_ratio: { female: 0.91, male: 0.09 },
        age_ratio: {
          "10s": 0.13,
          "20s": 0.45,
          "30s": 0.28,
          "40s": 0.1,
          "50s+": 0.04,
        },
        source: "Naver DataLab 성별·연령 분해 + YouTube Audience",
      },

      // ========== D. 주요 채널 현황 (주력채널 유튜브 최상단) ==========
      media_channel_status: [
        {
          media_channel: "YouTube",
          status: "글로우 틴트 비교·누드립 튜토리얼 영상 급증",
        },
        {
          media_channel: "Instagram",
          status: "젤 틴트 스와치 카드뉴스·립 클로즈업 릴스 인게이지먼트 상승",
        },
        {
          media_channel: "TikTok",
          status: "#글로우누드립 해시태그 누적 조회 3.5억회",
        },
      ],
    },
  ],
};

// envelope으로 감싸 매칭가에게 전달
const output = wrap(data);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../../shared/data/trend-analysis.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

export default output;
