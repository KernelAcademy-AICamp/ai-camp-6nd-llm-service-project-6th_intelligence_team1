// 트렌드 분석가: 브랜드 입력을 받아 트렌드 분석 결과를 매칭가에게 전달
// 산출 JSON은 shared/envelope.js의 wrap()으로 감싸 공통 envelope 구조를 보장한다.

import { fileURLToPath } from "url";
import { realpathSync } from "fs";
import { wrap, wrapError } from "../../shared/envelope.js";

/**
 * 트렌드 분석 메인 함수
 * @param {object} brandInput - 브랜드 분석가가 넘긴 브랜드 정보
 * @returns {object} envelope으로 감싼 트렌드 분석 결과
 */
export async function analyzeTrends(brandInput) {
  try {
    // TODO: Naver DataLab, YouTube Data API, 캐릿 RAG 등 실제 호출로 교체
    const data = buildMockTrendData(brandInput);
    return wrap(data);
  } catch (e) {
    return wrapError(`트렌드 분석 실패: ${e.message}`);
  }
}

// 임시 mock 데이터 (실제 API 연동 전 단계, hince 시나리오 기준)
function buildMockTrendData(_brandInput) {
  return {
    analyzed_at: new Date().toISOString(),
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
          gender_ratio: { female: 0.87, male: 0.13 },
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
}

// 단독 실행 시 샘플 출력 (디버그 용도)
const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = await analyzeTrends({
    brand_name: "hince",
    media: ["Instagram", "YouTube"],
    target_demo: { gender: "female", age: ["20s", "30s"] },
    tone: ["Z세대·트렌디"],
  });
  console.log(JSON.stringify(result, null, 2));
}
