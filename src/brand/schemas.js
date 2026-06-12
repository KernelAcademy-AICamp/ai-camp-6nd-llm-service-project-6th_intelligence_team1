import { z } from "zod";

// 브랜드 분석가 입력 스키마 — 마케터 폼이 채울 필드를 정의.
// 매칭가의 schemas.js의 톤앤매너 enum과 일치시켜야 함 (변경 시 양쪽 같이 갱신).

export const TONE_AND_MANNER = [
  "클린뷰티",
  "로맨틱·감성",
  "럭셔리·프리미엄",
  "키치·플레이풀",
  "더마·과학적",
  "Z세대·트렌디",
  "비건",
];

// ─── 카테고리 ─────────────────────────────────────────────────────
// "대분류 > 중분류" 형식. UI 드롭다운 2단계로 구성될 것.
// 메이크업은 베이스·립·아이별 소분류를 별도로 둠 (예: "메이크업 > 립 > 틴트").
export const CATEGORY_TREE = {
  클렌징: ["클렌징폼", "클렌징오일", "클렌징밤", "클렌징밀크", "클렌징워터"],
  스킨케어: ["선크림", "토너", "에센스", "세럼", "오일", "크림"],
  "메이크업 > 립": ["틴트", "립스틱", "립글로스", "립밤", "립라이너"],
  "메이크업 > 베이스": [
    "파운데이션", "쿠션", "컨실러", "프라이머",
    "파우더", "하이라이터", "셰이딩", "블러셔",
  ],
  "메이크업 > 아이": ["아이섀도", "아이라이너", "마스카라", "아이브로우"],
  기타: ["기타"],
};

// 전체 카테고리 키 ("대분류 > 중분류[ > 소분류]") — Zod enum 생성용
export const CATEGORIES = Object.entries(CATEGORY_TREE).flatMap(
  ([major, minors]) => minors.map((minor) => `${major} > ${minor}`),
);

// ─── 카테고리별 텍스처 매핑 ──────────────────────────────────────
// 트렌드 데이터(YouTube·Naver·Tavily)에서 실제 가장 많이 등장한
// 텍스처·효능·성분 키워드 TOP 5로 정의. 트렌드분석가 검증 완료.
export const TEXTURE_BY_CATEGORY = {
  // 클렌징
  "클렌징 > 클렌징폼": ["약산성", "민감", "알칼리성", "저자극", "진정"],
  "클렌징 > 클렌징오일": ["딥클렌징", "약산성", "촉촉", "저자극", "보습"],
  "클렌징 > 클렌징밤": ["딥클렌징", "저자극", "각질", "모공", "보습"],
  "클렌징 > 클렌징밀크": ["민감", "저자극", "약산성", "촉촉", "모공"],
  "클렌징 > 클렌징워터": ["산뜻한", "수분", "약산성", "보습", "트러블"],

  // 스킨케어
  "스킨케어 > 선크림": ["민감", "산뜻한", "세라마이드", "촉촉", "수분"],
  "스킨케어 > 토너": ["수분", "보습", "진정", "톤업", "촉촉"],
  "스킨케어 > 에센스": ["수분", "보습", "진정", "촉촉", "탄력"],
  "스킨케어 > 세럼": ["안티에이징", "탄력", "수분", "주름", "레티놀"],
  "스킨케어 > 오일": ["보습", "수분", "PDRN", "재생", "탄력"],
  "스킨케어 > 크림": ["보습", "수분", "레티놀", "각질", "히알루론산"],

  // 메이크업 > 립
  "메이크업 > 립 > 틴트": ["글로우", "촉촉", "글로시", "벨벳", "누드"],
  "메이크업 > 립 > 립스틱": ["벨벳", "매트", "글로우", "누드", "글로시"],
  "메이크업 > 립 > 립글로스": ["글로시", "촉촉", "매트", "글로우", "누드"],
  "메이크업 > 립 > 립밤": ["글로우", "촉촉", "글로시", "볼륨", "누드"],
  "메이크업 > 립 > 립라이너": ["매트", "글로시", "누드", "글로우", "촉촉"],

  // 메이크업 > 베이스
  "메이크업 > 베이스 > 파운데이션": ["매트", "글로우", "촉촉", "지속력", "밀착"],
  "메이크업 > 베이스 > 쿠션": ["매트", "커버력", "세미매트", "촉촉", "밀착"],
  "메이크업 > 베이스 > 컨실러": ["글로우", "촉촉", "톤업", "매트", "커버력"],
  "메이크업 > 베이스 > 프라이머": ["매트", "지속력", "톤업", "밀착", "글로우"],
  "메이크업 > 베이스 > 파우더": ["매트", "촉촉", "지속력", "벨벳", "밀착"],
  "메이크업 > 베이스 > 하이라이터": ["글로우", "광채", "촉촉", "벨벳", "누드"],
  "메이크업 > 베이스 > 셰이딩": ["매트", "촉촉", "글로우", "지속력", "벨벳"],
  "메이크업 > 베이스 > 블러셔": ["글로우", "매트", "지속력", "톤업", "촉촉"],

  // 메이크업 > 아이
  "메이크업 > 아이 > 아이섀도": ["매트", "글로우", "누드", "글리터", "시어"],
  "메이크업 > 아이 > 아이라이너": ["글리터", "지속력", "매트", "펄", "촉촉"],
  "메이크업 > 아이 > 마스카라": ["볼륨", "매트"],
  "메이크업 > 아이 > 아이브로우": ["매트", "지속력", "픽싱"],

  // 기타 — 자유 입력 (검증 면제)
  "기타 > 기타": [],
};

// 전체 텍스처 집합 (UI에서 카테고리 안 정해진 상태 등에 대비)
export const ALL_TEXTURES = [
  ...new Set(Object.values(TEXTURE_BY_CATEGORY).flat()),
];

// 카테고리로 허용 텍스처 조회. "기타"는 빈 배열 → 모든 값 허용.
export function getTexturesForCategory(category) {
  return TEXTURE_BY_CATEGORY[category] ?? [];
}

// ─── 그 외 enum ───────────────────────────────────────────────────
export const INVOLVEMENT = ["입문자", "일상사용자", "얼리어답터"];

export const MOTIVATION = [
  "자기표현",
  "관리·케어",
  "사회적 인정",
  "가성비·가심비",
];

export const CAMPAIGN_KPI = ["신제품 런칭", "시즌 프로모션", "재구매 유도"];

export const CAMPAIGN_PERIOD = ["1주", "한달", "3개월", "1년"];

export const CAMPAIGN_BUDGET = [
  "200만원 미만",
  "200~500만원",
  "500~1000만원",
  "1000만원 초과",
];

export const CAMPAIGN_CHANNELS = ["인스타그램", "유튜브", "틱톡", "자사몰", "네이버 스토어", "오프라인 스토어"];

// 브랜드가 평소 운영 중인 매체 (현재 활용 채널) — 이번 캠페인 주력 채널과는 별개.
// UI는 이 enum 6개를 체크박스로 노출하고, 마케터가 자유 입력하지 않도록 제한.
export const CURRENT_CHANNELS = [
  "인스타그램",
  "유튜브",
  "틱톡",
  "자사몰",
  "네이버 스토어",
  "오프라인 스토어",
];

// 마케터 폼이 노출할 연령 그룹 4개. UI 드롭다운/체크박스는 이 enum만 사용.
// "40+"는 매칭가로 넘기기 전 "40대"·"50대"·"60대"로 자동 확장됨.
export const AGE_GROUPS = ["10대", "20대", "30대", "40+"];

// ─── product_features 합성용 톤별 표현 사전 ──────────────────────
// 매칭가의 Ingred-Fit 입력 product_features를 룰베이스로 만들 때 사용.
// 톤앤매너별로 카테고리 무관·안전한 표현 2개씩. LLM 환각·카테고리 위반 위험 0.
// (톤 enum과 키 동기화 필수 — 톤 추가/변경 시 여기도 같이 갱신)
export const TONE_FEATURE_PHRASES = {
  "클린뷰티":       ["저자극", "민감 피부 친화"],
  "로맨틱·감성":     ["촉촉한 발색", "은은한 마무리"],
  "럭셔리·프리미엄": ["고급 텍스처", "장시간 지속"],
  "키치·플레이풀":   ["트렌디한 컬러", "데일리 발색"],
  "더마·과학적":     ["기능성 성분", "피부 친화"],
  "Z세대·트렌디":    ["바이럴 핫템", "셀카용"],
  "비건":           ["식물성 성분", "크루얼티프리"],
};

// 검증된 입력(input)에서 매칭가의 Ingred-Fit 핵심 입력인 product_features를
// 합성. LLM 호출 없이 입력 필드만으로 만들어 카테고리 위반·환각 위험 0.
//
// 합성 규칙:
//   1) texture_keywords — 마케터가 명시한 정확한 텍스처
//   2) category 소분류 — "메이크업 > 립 > 틴트" → "틴트"
//   3) tone별 안전 표현 — TONE_FEATURE_PHRASES에서 톤마다 2개씩
// 모든 결과는 Set으로 중복 제거 후 배열로 반환.
export function buildProductFeatures(input) {
  const features = [];

  // 1) 텍스처 키워드 (마케터 명시)
  if (Array.isArray(input.texture_keywords)) {
    features.push(...input.texture_keywords);
  }

  // 2) 카테고리 소분류 명사 — "메이크업 > 립 > 틴트" → "틴트"
  if (typeof input.category === "string") {
    const parts = input.category.split(">").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) features.push(parts[parts.length - 1]);
  }

  // 3) 톤별 안전 표현
  if (Array.isArray(input.tone_and_manner)) {
    for (const tone of input.tone_and_manner) {
      const phrases = TONE_FEATURE_PHRASES[tone];
      if (Array.isArray(phrases)) features.push(...phrases);
    }
  }

  return [...new Set(features)];
}

// 매칭가가 기대하는 age_groups 포맷("20대"·"Z세대" 등)으로 확장. 폼이 보낸
// "40+"는 매칭가가 모르는 값이므로 여기서 ["40대","50대","60대"]로 풀어줌.
export function expandAgeGroupForMatching(group) {
  if (group === "40+") return ["40대", "50대", "60대"];
  return [group];
}

// ─── 스키마 ───────────────────────────────────────────────────────

const TargetSchema = z.object({
  gender: z.enum(["여성", "남성", "공용"]),
  age_groups: z.array(z.enum(AGE_GROUPS)).min(1),
  involvement: z.enum(INVOLVEMENT),
  motivation: z.array(z.enum(MOTIVATION)).min(1),
});

export const BrandInputSchema = z
  .object({
    brand_name: z.string().min(1),
    current_channels: z.array(z.enum(CURRENT_CHANNELS)).optional().default([]),
    // 브랜드가 운영하는 채널 URL을 여러 개 받음 — 인스타·유튜브·자사몰 등 동시 보유
    // 가능. 빈 문자열은 제거 후 배열로 보관. 누락은 OK (default []).
    brand_channel_url: z
      .array(z.string().url())
      .optional()
      .default([]),

    product_name: z.string().min(1),
    category: z.enum(CATEGORIES, {
      message: `category는 ${CATEGORIES.length}개 중 하나여야 합니다`,
    }),
    texture_keywords: z.array(z.string()).min(1, "texture_keywords 최소 1개"),
    tone_and_manner: z.array(z.enum(TONE_AND_MANNER)).min(1),

    target: TargetSchema,
    mood_image_url: z.string().url().optional().or(z.literal("")).optional(),

    campaign_kpi: z.enum(CAMPAIGN_KPI),
    campaign_period: z.enum(CAMPAIGN_PERIOD),
    campaign_budget: z.enum(CAMPAIGN_BUDGET),
    media_channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1),

    reference_campaign_url: z.string().url().optional().or(z.literal("")).optional(),
    competitors: z.array(z.string()).max(2).optional().default([]),
  })
  // 카테고리별로 허용된 텍스처인지 검증 — 트렌드 검색어 품질 보장
  .refine(
    (data) => {
      const allowed = getTexturesForCategory(data.category);
      // "기타 > 기타"는 빈 배열로 → 모든 텍스처 허용
      if (allowed.length === 0) return true;
      return data.texture_keywords.every((t) => allowed.includes(t));
    },
    (data) => ({
      message: `texture_keywords가 카테고리 '${data.category}'에 안 맞습니다. 허용: ${getTexturesForCategory(data.category).join(", ")}`,
      path: ["texture_keywords"],
    }),
  );

// ─── LLM 출력 스키마 (3종 키워드) ───────────────────────────────
// 트렌드 수집가가 API별로 다른 형식의 키워드를 받음:
//   1) search_keywords  — Tavily용 자연 문장형 쿼리 5~6개
//   2) short_keywords   — YouTube용 짧은 평면 배열 (띄어쓰기 OK) 4~6개
//   3) datalab_keywords — Naver DataLab용 그룹 구조 (붙여쓰기) 2~3 그룹
const DatalabGroupSchema = z.object({
  groupName: z.string().min(2, "groupName은 2글자 이상"),
  keywords: z
    .array(z.string().min(2, "키워드 2글자 이상").max(20, "키워드 20글자 이하"))
    .min(2, "그룹당 키워드 최소 2개")
    .max(5, "그룹당 키워드 최대 5개"),
});

// search_keywords와 hashtag_keywords의 짝짓기를 코드 레벨에서 강제하기 위한
// 묶음 스키마. LLM이 i번째 쌍이 같은 트렌드를 가리키도록 한 객체에 묶어 출력.
// 트렌드 분석가 합의 — 짝 어긋남 문제 방지(예: search="실키 파운데이션 리뷰"인데
// hashtag="#30대메이크업"으로 잘못 매칭되던 케이스).
const SearchHashtagPairSchema = z.object({
  search: z
    .string()
    .min(2, "검색 쿼리는 2글자 이상")
    .max(50, "검색 쿼리는 50글자 이하"),
  hashtag: z
    .string()
    .min(2, "해시태그는 2글자 이상")
    .max(15, "해시태그는 15글자 이하")
    .refine((s) => !/\s/.test(s), "해시태그는 공백 없는 한 덩어리여야 함"),
});

export const BrandKeywordsLlmSchema = z.object({
  // Tavily(자연 문장)·Instagram·TikTok(해시태그) 짝 5~6쌍.
  // analyze.js가 search_keywords/hashtag_keywords 두 배열로 분리해 envelope에 노출.
  keyword_pairs: z
    .array(SearchHashtagPairSchema)
    .min(5, "최소 5쌍")
    .max(6, "최대 6쌍"),
  short_keywords: z
    .array(z.string().min(2, "키워드 2글자 이상").max(15, "키워드 15글자 이하"))
    .min(4, "YouTube용 최소 4개")
    .max(6, "YouTube용 최대 6개"),
  datalab_keywords: z
    .array(DatalabGroupSchema)
    .min(2, "Naver DataLab 그룹 최소 2개")
    .max(3, "Naver DataLab 그룹 최대 3개"),
});

// 하위 호환 alias (이름만 바꾼 거)
export const SearchKeywordsLlmSchema = BrandKeywordsLlmSchema;
