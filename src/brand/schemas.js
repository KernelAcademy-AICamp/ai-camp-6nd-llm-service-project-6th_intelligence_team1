import { z } from "zod";

// 브랜드 분석가 입력 스키마 v2 — 카테고리 4단계 분리 구조.
//
// 입력 형식 (마케터 폼):
//   - category_major  (대분류, 4종)
//   - category_mid    (중분류, 대분류별 다름)
//   - category_sub    (소분류, 메이크업만 필수)
//   - product_features         (옵션 선택, 최대 3개)
//   - product_features_custom  (자유 입력, 최대 3개)
//
// 출력 형식 (envelope, 외부 호환):
//   - category  ← buildCategoryString으로 "대분류 > 중분류[ > 소분류]" 자동 합성
//   - texture_keywords  ← product_features + product_features_custom 합쳐서 노출
//
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

// ─── 카테고리 4단계 enum ──────────────────────────────────────────

// 대분류 (4종)
export const CATEGORY_MAJOR = ["클렌징", "기초제품", "선케어", "메이크업"];

// 대분류별 중분류
export const CATEGORY_MID_BY_MAJOR = {
  클렌징: ["클렌징폼", "클렌징오일", "클렌징밤", "클렌징밀크", "클렌징워터", "클렌징티슈"],
  기초제품: ["토너", "에센스", "세럼", "오일", "크림"],
  선케어: ["선크림", "선스틱", "선쿠션"],
  메이크업: ["립", "베이스", "아이"],
};

// 메이크업 중분류별 소분류 (메이크업만 소분류 존재)
export const CATEGORY_SUB_BY_MID = {
  립: ["틴트", "립스틱", "립글로스", "립밤", "립라이너"],
  베이스: ["파운데이션", "쿠션", "컨실러", "프라이머", "파우더", "하이라이터", "쉐딩", "블러셔"],
  아이: ["섀도우", "아이라이너", "마스카라", "아이브로우"],
};

// ─── 제품특징 옵션 매핑 ──────────────────────────────────────────
// 키 규칙: 메이크업은 *소분류* 이름, 나머지는 *중분류* 이름.
// 빈 배열 = 검증 면제 (자유 입력만 받음)
export const PRODUCT_FEATURES_BY_CATEGORY = {
  // 클렌징 (중분류 키)
  클렌징폼: ["약산성", "민감성", "알칼리성"],
  클렌징오일: ["딥클렌징", "약산성", "민감성", "보습"],
  클렌징밤: ["딥클렌징", "민감성", "모공", "보습"],
  클렌징밀크: ["민감성", "약산성", "보습"],
  클렌징워터: ["산뜻한", "수분", "약산성"],
  클렌징티슈: [],

  // 기초제품 (중분류 키)
  토너: ["수분", "보습", "진정", "각질", "모공", "미백"],
  에센스: ["수분", "보습", "광채", "미백", "진정", "주름"],
  세럼: ["수분", "보습", "진정", "미백", "탄력", "주름"],
  오일: ["보습", "영양", "윤광", "장벽"],
  크림: ["수분", "보습", "장벽", "진정", "탄력", "미백", "영양"],

  // 선케어 (중분류 키)
  선크림: ["무기자차", "유기자차", "혼합자차"],
  선스틱: ["무기자차", "유기자차", "혼합자차"],
  선쿠션: ["무기자차", "유기자차", "혼합자차"],

  // 메이크업 > 립 (소분류 키)
  틴트: ["워터", "잉크", "글로우", "벨벳"],
  립스틱: ["벨벳", "매트", "글로우", "누드"],
  립글로스: ["글로시", "시머", "글리터", "플럼핑"],
  립밤: [],
  립라이너: [],

  // 메이크업 > 베이스 (소분류 키)
  파운데이션: ["매트", "글로우", "촉촉", "커버력"],
  쿠션: ["촉촉", "매트", "밀착", "수부지", "톤업"],
  컨실러: [],
  프라이머: ["매트", "톤업", "젤", "크림", "밤", "스틱"],
  파우더: ["루스", "프레스드", "베이크드"],
  하이라이터: ["프레스드", "젤리", "리퀴드", "베이크드", "스틱", "피그먼트"],
  쉐딩: ["프레스드", "스틱", "크림"],
  블러셔: ["프레스드", "베이크드", "크림", "스틱", "리퀴드", "쿠션", "밤"],

  // 메이크업 > 아이 (소분류 키)
  섀도우: ["매트", "글로우", "누드", "글리터", "시어", "팔레트"],
  아이라이너: ["펜슬", "리퀴드", "젤"],
  마스카라: ["컬링", "볼륨", "롱래쉬", "픽서"],
  아이브로우: ["펜슬", "파우더", "젤", "펜", "타투"],
};

// ─── 카테고리 헬퍼 ───────────────────────────────────────────────

// 4단계 입력을 단일 문자열로 합성 (외부 호환 포맷)
//   ("메이크업", "베이스", "블러셔") → "메이크업 > 베이스 > 블러셔"
//   ("클렌징", "클렌징폼", null)     → "클렌징 > 클렌징폼"
export function buildCategoryString(major, mid, sub) {
  const parts = [major, mid];
  if (sub) parts.push(sub);
  return parts.filter(Boolean).join(" > ");
}

// 카테고리 → 허용 제품특징 옵션 목록. 메이크업은 소분류, 그 외엔 중분류 기준.
export function getFeaturesForCategory(major, mid, sub) {
  const key = major === "메이크업" ? sub : mid;
  return PRODUCT_FEATURES_BY_CATEGORY[key] ?? [];
}

// 모든 카테고리 명사 평탄화 — product_name이 어떤 카테고리든 카테고리 명사면
// sanitize forbidden에서 제외하기 위한 전역 화이트리스트.
export const ALL_CATEGORY_NOUNS = new Set([
  ...CATEGORY_MAJOR,
  ...Object.values(CATEGORY_MID_BY_MAJOR).flat(),
  ...Object.values(CATEGORY_SUB_BY_MID).flat(),
]);

// ─── 카테고리 검색 동의어 표 ─────────────────────────────────────────
// 카테고리 명사(중·소분류) → 실제로 검색되는 동의어. 두 곳에서 사용:
//   1) 키워드 생성 시 LLM에 "이 동의어도 핵심 명사로 써도 된다"고 알려줌
//   2) sanitize 필터에서 정식 카테고리 명사처럼 취급 → 제품명에서 새어 나온
//      단어는 막되, 등록된 동의어(예: 블러셔→치크)는 통과시킴
// 키는 CATEGORY_*에 등록된 명사여야 하고, 값은 검색량이 보장되는 일반 표현만.
// 팀원이 카탈로그에 맞춰 자유롭게 행을 추가하면 됨.
export const CATEGORY_SYNONYMS = {
  블러셔: ["치크"],
  파운데이션: ["파데"],
};

// 주어진 카테고리 명사 목록의 동의어를 모두 모아 평탄 배열로 반환.
//   getSynonymsForCategoryNouns(["블러셔", "베이스"]) → ["치크"]
export function getSynonymsForCategoryNouns(nouns) {
  const out = [];
  for (const n of nouns ?? []) {
    const syns = CATEGORY_SYNONYMS[n];
    if (syns) out.push(...syns);
  }
  return out;
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
// 톤앤매너별로 카테고리 무관·안전한 표현 2개씩.
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
//   1) texture_keywords — schema.transform이 product_features+custom 합성한 결과
//   2) category 소분류 — "메이크업 > 립 > 틴트" → "틴트"
//   3) tone별 안전 표현 — TONE_FEATURE_PHRASES에서 톤마다 2개씩
// 모든 결과는 Set으로 중복 제거 후 배열로 반환.
export function buildProductFeatures(input) {
  const features = [];

  // 1) 텍스처 키워드 (스키마가 합성한 product_features + custom)
  if (Array.isArray(input.texture_keywords)) {
    features.push(...input.texture_keywords);
  }

  // 2) 카테고리 소분류 명사
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

// 매칭가가 기대하는 age_groups 포맷으로 확장. "40+" → ["40대","50대","60대"].
export function expandAgeGroupForMatching(group) {
  if (group === "40+") return ["40대", "50대", "60대"];
  return [group];
}

// ─── 스키마 ───────────────────────────────────────────────────────

const TargetSchema = z.object({
  gender: z.enum(["여성", "남성"]),
  age_groups: z.array(z.enum(AGE_GROUPS)).min(1),
  involvement: z.enum(INVOLVEMENT),
  motivation: z.array(z.enum(MOTIVATION)).min(1),
});

// 카테고리 4단계 입력 + 조합 검증
// 단계별로 .refine 3개로 검증해 에러 메시지를 구체적으로 분리
const CategoryInputSchema = z
  .object({
    category_major: z.enum(CATEGORY_MAJOR),
    category_mid: z.string().min(1, "category_mid 필수"),
    category_sub: z.string().optional(),
  })
  // 1) 중분류가 대분류에 속하는지
  .refine(
    (d) => (CATEGORY_MID_BY_MAJOR[d.category_major] ?? []).includes(d.category_mid),
    (d) => ({
      message: `category_mid '${d.category_mid}'가 category_major '${d.category_major}'에 속하지 않음. 허용: ${(CATEGORY_MID_BY_MAJOR[d.category_major] ?? []).join(", ")}`,
      path: ["category_mid"],
    }),
  )
  // 2) 메이크업이면 소분류 필수 + 중분류에 속하는지. 그 외엔 소분류 비어야.
  .refine(
    (d) => {
      if (d.category_major === "메이크업") {
        if (!d.category_sub) return false;
        return (CATEGORY_SUB_BY_MID[d.category_mid] ?? []).includes(d.category_sub);
      }
      // 메이크업 아닌데 소분류 들어오면 무효 (빈 문자열은 OK)
      return !d.category_sub;
    },
    (d) => {
      if (d.category_major === "메이크업") {
        const allowed = (CATEGORY_SUB_BY_MID[d.category_mid] ?? []).join(", ");
        return {
          message: `메이크업은 category_sub 필수. 허용 (${d.category_mid}): ${allowed}`,
          path: ["category_sub"],
        };
      }
      return {
        message: `category_major '${d.category_major}'는 category_sub를 비워야 함`,
        path: ["category_sub"],
      };
    },
  );

export const BrandInputSchema = z
  .object({
    brand_name: z.string().min(1),
    current_channels: z.array(z.enum(CURRENT_CHANNELS)).optional().default([]),
    brand_channel_url: z.array(z.string().url()).optional().default([]),

    product_name: z.string().min(1),

    // 카테고리 4단계 분리
    category_major: z.enum(CATEGORY_MAJOR),
    category_mid: z.string().min(1, "category_mid 필수"),
    category_sub: z.string().optional(),

    // 제품특징 — 옵션 선택 (해당 카테고리 enum 안 값만, 최대 3개)
    product_features: z.array(z.string()).max(3, "product_features 최대 3개").optional().default([]),
    // 제품특징 — 자유 입력 (최대 3개)
    product_features_custom: z
      .array(z.string().min(1).max(20, "자유 입력 키워드 20자 이하"))
      .max(3, "product_features_custom 최대 3개")
      .optional()
      .default([]),

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
  // 카테고리 조합 검증 1: 중분류가 대분류에 속하는지
  .refine(
    (d) => (CATEGORY_MID_BY_MAJOR[d.category_major] ?? []).includes(d.category_mid),
    (d) => ({
      message: `category_mid '${d.category_mid}'가 category_major '${d.category_major}'에 속하지 않음. 허용: ${(CATEGORY_MID_BY_MAJOR[d.category_major] ?? []).join(", ")}`,
      path: ["category_mid"],
    }),
  )
  // 카테고리 조합 검증 2: 메이크업이면 소분류 필수 + 중분류에 속하는지
  .refine(
    (d) => {
      if (d.category_major === "메이크업") {
        if (!d.category_sub) return false;
        return (CATEGORY_SUB_BY_MID[d.category_mid] ?? []).includes(d.category_sub);
      }
      return !d.category_sub;
    },
    (d) => {
      if (d.category_major === "메이크업") {
        const allowed = (CATEGORY_SUB_BY_MID[d.category_mid] ?? []).join(", ");
        return {
          message: `메이크업은 category_sub 필수. 허용 (${d.category_mid}): ${allowed}`,
          path: ["category_sub"],
        };
      }
      return {
        message: `category_major '${d.category_major}'는 category_sub를 비워야 함`,
        path: ["category_sub"],
      };
    },
  )
  // 제품특징 옵션 검증: 해당 카테고리 허용 목록 안의 값만 사용
  .refine(
    (d) => {
      const allowed = getFeaturesForCategory(d.category_major, d.category_mid, d.category_sub);
      if (allowed.length === 0) return true; // 검증 면제 카테고리
      return d.product_features.every((f) => allowed.includes(f));
    },
    (d) => {
      const allowed = getFeaturesForCategory(d.category_major, d.category_mid, d.category_sub);
      return {
        message: `product_features가 카테고리에 안 맞습니다. 허용: ${allowed.join(", ")}`,
        path: ["product_features"],
      };
    },
  )
  // 출력 변환: 외부 호환 위해 category 단일 문자열 + texture_keywords 합성 필드 추가
  .transform((d) => ({
    ...d,
    category: buildCategoryString(d.category_major, d.category_mid, d.category_sub),
    texture_keywords: [...d.product_features, ...d.product_features_custom],
  }));

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
// 묶음 스키마.
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

// 하위 호환 alias
export const SearchKeywordsLlmSchema = BrandKeywordsLlmSchema;
