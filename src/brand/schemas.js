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
export const CATEGORY_TREE = {
  클렌징: ["클렌징폼", "클렌징오일", "클렌징밤", "클렌징밀크", "클렌징워터"],
  스킨케어: ["선케어", "토너", "에센스", "세럼", "오일", "크림"],
  메이크업: ["립", "베이스", "아이"],
  바디: ["로션", "워시", "오일"],
  헤어: ["샴푸", "트리트먼트", "에센스"],
  기타: ["기타"],
};

// 전체 카테고리 키 ("대분류 > 중분류") — Zod enum 생성용
export const CATEGORIES = Object.entries(CATEGORY_TREE).flatMap(
  ([major, minors]) => minors.map((minor) => `${major} > ${minor}`),
);

// ─── 카테고리별 텍스처 매핑 ──────────────────────────────────────
// 트렌드분석가 요청 반영: 카테고리에 안 맞는 텍스처가 섞이면 검색 쿼리
// 품질이 떨어지므로 카테고리별로 의미 있는 텍스처만 노출.
export const TEXTURE_BY_CATEGORY = {
  // 메이크업
  "메이크업 > 립": ["글로우", "매트", "벨벳", "시어", "누드립", "틴트", "글로시"],
  "메이크업 > 베이스": ["매트", "글로우", "톤업", "커버력", "세미매트", "광채"],
  "메이크업 > 아이": ["매트", "펄", "시머", "글리터", "글로우"],

  // 클렌징 (서브카테고리 공통)
  "클렌징 > 클렌징폼": ["약산성", "알칼리성", "저자극", "딥클렌징", "부드러운"],
  "클렌징 > 클렌징오일": ["딥클렌징", "산뜻한", "끈적임 없는", "저자극"],
  "클렌징 > 클렌징밤": ["딥클렌징", "보습", "부드러운"],
  "클렌징 > 클렌징밀크": ["저자극", "보습", "부드러운"],
  "클렌징 > 클렌징워터": ["산뜻한", "저자극", "끈적임 없는"],

  // 스킨케어
  "스킨케어 > 선케어": ["산뜻한", "끈적임 없는", "톤업", "보습"],
  "스킨케어 > 토너": ["수분", "진정", "약산성", "산뜻한"],
  "스킨케어 > 에센스": ["수분", "진정", "보습", "광채"],
  "스킨케어 > 세럼": ["수분", "안티에이징", "미백", "진정"],
  "스킨케어 > 오일": ["보습", "광채", "안티에이징"],
  "스킨케어 > 크림": ["보습", "수분", "안티에이징", "진정"],

  // 바디
  "바디 > 로션": ["보습", "산뜻한", "끈적임 없는"],
  "바디 > 워시": ["산뜻한", "보습", "부드러운"],
  "바디 > 오일": ["보습", "광채", "부드러운"],

  // 헤어
  "헤어 > 샴푸": ["산뜻한", "보습", "두피케어"],
  "헤어 > 트리트먼트": ["보습", "윤기", "매끈"],
  "헤어 > 에센스": ["윤기", "매끈", "보습"],

  // 기타 — 모든 텍스처 허용용 (자유 입력)
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

export const CAMPAIGN_CHANNELS = ["유튜브", "메타", "카카오"];

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
    brand_channel_url: z.string().url().optional().or(z.literal("")).optional(),

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

export const BrandKeywordsLlmSchema = z.object({
  search_keywords: z
    .array(z.string().min(2, "검색 쿼리는 2글자 이상").max(50, "검색 쿼리는 50글자 이하"))
    .min(5, "최소 5개")
    .max(6, "최대 6개"),
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
