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

export const TEXTURE_KEYWORDS = [
  "글로우",
  "매트",
  "약산성",
  "알칼리성",
  "누드립",
];

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

// 매칭가가 받는 age_groups 정규식 (20대·Z세대·MZ세대·밀레니얼)과 동일
const AGE_GROUP_RE = /^(\d+대|Z세대|MZ세대|밀레니얼)$/;

const TargetSchema = z.object({
  gender: z.enum(["여성", "남성", "공용"]),
  age_groups: z
    .array(z.string().regex(AGE_GROUP_RE, "age_groups 원소: '20대' 또는 'Z세대/MZ세대/밀레니얼'"))
    .min(1),
  involvement: z.enum(INVOLVEMENT),
  motivation: z.array(z.enum(MOTIVATION)).min(1),
});

export const BrandInputSchema = z.object({
  brand_name: z.string().min(1),
  current_channels: z.array(z.string()).optional().default([]),
  brand_channel_url: z.string().url().optional().or(z.literal("")).optional(),

  product_name: z.string().min(1),
  category: z.string().min(1),
  texture_keywords: z.array(z.enum(TEXTURE_KEYWORDS)).min(1),
  tone_and_manner: z.array(z.enum(TONE_AND_MANNER)).min(1),

  target: TargetSchema,
  mood_image_url: z.string().url().optional().or(z.literal("")).optional(),

  campaign_kpi: z.enum(CAMPAIGN_KPI),
  campaign_period: z.enum(CAMPAIGN_PERIOD),
  campaign_budget: z.enum(CAMPAIGN_BUDGET),
  media_channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1),

  reference_campaign_url: z.string().url().optional().or(z.literal("")).optional(),
  competitors: z.array(z.string()).max(2).optional().default([]),
});
