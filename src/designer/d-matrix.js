// [D 자세 및 구도] 매트릭스 — 코드가 직접 룩업 (LLM 재량 없음).
// 두 시안 타입(인물 샷·제품 샷)별로 별도 매트릭스.
//
// 입력에서 카테고리는 "대분류 > 소분류" 형식 (예: "메이크업 > 립", "클렌징 > 클렌징오일")
// - 인물 샷: 소분류로 룩업 (소분류 없으면 대분류 기본값)
// - 제품 샷: 대분류로 룩업, 소분류가 옵션의 "추천" 리스트에 있으면 그 옵션 우선

// 시안가가 지원하는 5대분류만 허용. 그 외(바디·헤어·기타)는 입력 단계에서 거부.
export const SUPPORTED_MAJOR_CATEGORIES = ["클렌징", "스킨케어", "메이크업"];
// 메이크업 묶음("베이스" 등)은 입력으로 안 옴 — 입력은 항상 소분류 단위.
// 매트릭스에 키가 존재하는 소분류만 허용 (isCategorySupported가 PERSON_POSE_MATRIX로 직접 확인).
export const SUPPORTED_MAKEUP_MINOR = [
  "립", "치크", "파운데이션", "비비", "쿠션", "아이",
];

// ─── 인물 샷 [A: 모델 특징] 매트릭스 (톤앤매너 기반) ─────────────────
// 톤별 1개 고정 — 같은 브랜드면 카테고리 무관하게 모델·헤어·메이크업 무드 동일.
// 표정·시선·자세는 [D]에서 처리, 구체 립 컬러는 [B]에서 처리하므로 여기선 제외.
// 조명·배경·마무리 어구는 고정 틀과 [C]에서 처리하므로 여기선 제외.
export const PERSON_A_MATRIX = {
  "클린뷰티":
    "20-year-old korean beauty model, long straight natural black hair cascading softly down her shoulders with gentle flyaways, minimalist clean beauty makeup, ultra-transparent and hydrated glass skin, bare shoulders",
  "로맨틱·감성":
    "23-year-old korean model, loose messy low bun with soft curly tendrils framing her face, milk tea brown hair color, soft-focus romantic makeup, muted rose watercolor blush",
  "럭셔리·프리미엄":
    "25-year-old elegant korean high-fashion model, sharp sleek chin-length black bob haircut tucked neatly behind her ears, high-contrast premium luxury cosmetics makeup, perfectly sculpted face contour, satin-finish flawless skin",
  "키치·플레이풀":
    "19-year-old energetic vibrant korean influencer, high bouncy ponytail with colorful hair clips, playful aesthetic bright makeup, neon peach blush on the bridge of the nose, faux freckles on cheeks",
  "더마·과학적":
    "26-year-old intellectual korean model, dark hair perfectly tied back into a sleek low ponytail, professional derma skincare advertisement makeup, semi-matte skin focus, no-makeup makeup look emphasizing natural healthy skin barrier",
  "Z세대·트렌디":
    "21-year-old cool gen-z korean influencer, messy wet-hair look with long undone hippie curls and micro-braids, trendy Y2K beauty makeup, icy metallic eyeshadow highlight, sharp cat-eye eyeliner",
  "비건":
    "22-year-old natural-looking korean model, light brown wavy hair styled in a loose side-braid with organic texture, eco-friendly vegan beauty makeup, sun-kissed dewy skin sheen, soft earth-tone terracotta makeup",
};

// 브랜드 tone_and_manner 첫 항목으로 [A] 결정. 매핑 없으면 null (코드 게이트에서 거부).
export function pickPersonA(toneAndManner) {
  const firstTone = Array.isArray(toneAndManner) ? toneAndManner[0] : toneAndManner;
  return PERSON_A_MATRIX[firstTone] ?? null;
}

// ─── 인물 샷 [D] 매트릭스 (소분류 기반) ─────────────────────────────
// 키: 소분류 이름 — 입력 "클렌징 > 클렌징폼"의 "클렌징폼" 부분 매칭
// 값: 자세·구도 옵션 3개 (인물 자세 + 손동작 + 제품 동작이 한 줄로)
export const PERSON_POSE_MATRIX = {
  // 클렌징
  "클렌징폼": [
    "massage pose with soft white foam on fingertips",
    "holding a squeeze tube, small dollop of foam on palm",
    "showing creamy lather on cheeks with a playful smile",
  ],
  "클렌징오일": [
    "pressing a transparent oil pump bottle with one hand",
    "rubbing hands gently with a glossy oil texture",
    "holding a bottle near the cheek, showing glowing skin",
  ],
  "클렌징밤": [
    "holding a small cosmetic spatula with a scoop of balm",
    "touching a soft sherbet-textured balm inside the jar",
    "applying melting balm onto the forehead gently",
  ],
  "클렌징밀크": [
    "holding a white dispenser bottle with a clean hand",
    "showing a smooth milky lotion texture on fingers",
    "resting chin on hand next to a clean white bottle",
  ],
  "클렌징워터": [
    "soaking a round cosmetic cotton pad with clear liquid",
    "holding a clear water bottle, looking at camera",
    "tilting a large water bottle slightly forward",
  ],
  "클렌징티슈": [
    "wiping makeup gently from the cheek with a tissue pad",
    "holding a soft cleansing tissue unfolded with both hands",
    "resting a folded white tissue pad on a bare shoulder",
  ],
  "필링제품": [
    "holding a peeling gel tube, showing a smooth exfoliating gel",
    "massaging the nose area gently with bare fingertips",
    "showing clean translucent gel texture on a hand back",
  ],
  "립앤아이리무버": [
    "shaking a bi-phase dual-layered liquid bottle gently",
    "pressing a soaked cotton pad gently against one eye",
    "holding a small remover bottle near pouty lips",
  ],

  // 스킨케어
  "선케어": [
    "holding a sun cream tube, small amount of white sunscreen on a fingertip",
    "dotting white sunscreen cream on cheek and nose",
    "shading eyes with one hand, holding a sun stick in the other",
  ],
  "토너": [
    "holding a clear bottle, gently dabbing a cotton pad on skin",
    "pouring clear liquid toner onto a cupped palm",
    "resting cheek against a cool glass toner bottle",
  ],
  "에센스": [
    "holding a glass serum dropper with a clear hanging droplet",
    "squeezing a dropper gently over the cheek",
    "cupping a luxurious serum bottle with both hands close to the chest",
  ],
  "세럼": [
    "holding a glass serum dropper with a clear hanging droplet",
    "squeezing a dropper gently over the cheek",
    "cupping a luxurious serum bottle with both hands close to the chest",
  ],
  "오일": [
    "holding a glass serum dropper with a clear hanging droplet",
    "squeezing a dropper gently over the cheek",
    "cupping a luxurious serum bottle with both hands close to the chest",
  ],
  "크림": [
    "holding a premium cosmetic cream jar, rich texture visible",
    "scooping a tiny amount of white cream with an index finger",
    "applying a thick layer of cream onto the cheek smoothly",
  ],
  "미스트": [
    "holding a sleek mist spray bottle, eyes gently closed",
    "spraying fine mist particles around the face",
    "extending one arm forward holding a glossy spray bottle",
  ],
  "로션": [
    "holding a neat lotion pump bottle, pressing the top",
    "rubbing smooth lotion texture into the palms",
    "holding a bottle near the collarbone line",
  ],
  "에멀전": [
    "holding a neat lotion pump bottle, pressing the top",
    "rubbing smooth lotion texture into the palms",
    "holding a bottle near the collarbone line",
  ],
  "마스크팩": [
    "wearing a translucent wet sheet mask on face, lying back loosely",
    "peeling off a corner of a hydrating sheet mask from the cheek",
    "holding a sealed colorful mask sheet pouch near the face",
  ],

  // 메이크업
  "립": [
    "holding a sleek lipstick tube close to smiling lips",
    "applying lip gloss with an applicator, soft pouty lips",
    "biting a clear lip tint gloss tube gently with teeth",
  ],
  "치크": [
    "holding a blush compact with a fluffy makeup brush",
    "sweeping a powder brush gently across the rosy cheek",
    "holding a liquid blush dropper near the high cheekbone",
  ],
  "파운데이션": [
    "holding a luxury glass liquid foundation bottle elegantly",
    "pumping a small droplet of beige foundation onto the back of hand",
    "holding a wet beauty blender sponge near the jawline",
  ],
  "비비": [
    "holding a luxury glass liquid foundation bottle elegantly",
    "pumping a small droplet of beige foundation onto the back of hand",
    "holding a wet beauty blender sponge near the jawline",
  ],
  "쿠션": [
    "holding an open premium cushion compact with a reflection in the mirror",
    "dabbing a brand powder puff gently onto the center of cheek",
    "slipping two fingers into the cushion puff strap, looking proud",
  ],
  "아이": [
    "holding a multi-color eyeshadow palette open under the chin",
    "holding a black mascara wand close to long fluttering eyelashes",
    "drawing a sharp line with a sleek liquid eyeliner pen",
  ],
};

// ─── 제품 샷 [D] 매트릭스 (대분류 기반, 추천 소분류 우선) ──────────────
// 각 대분류마다 3옵션, 옵션에 "추천" 소분류 목록이 있으면 매칭 우선.
// recommends가 비어있으면 모든 소분류에 동일 가중치.
//
// 옵션 객체: { recommends: [...소분류], a_slot, d_slot }
//   - a_slot: 제품 용기/제형 묘사 (인물 샷의 [A]와 달리 매트릭스가 직접 채움)
//   - d_slot: 배치/카메라 앵글
export const PRODUCT_SHOT_MATRIX = {
  "클렌징": [
    {
      recommends: ["클렌징오일", "클렌징워터", "립앤아이리무버"],
      a_slot: "a transparent glass cleansing bottle with clear liquid inside",
      d_slot:
        "resting on a wet glass surface with realistic water splashes, close-up shot, eye-level angle, sharp focus",
    },
    {
      recommends: ["클렌징폼", "클렌징밀크", "필링제품"],
      a_slot:
        "a minimalist squeeze tube package, a dollop of rich fluffy white cream lather next to the product",
      d_slot:
        "centered composition, top-down flat lay view, clean white studio background",
    },
    {
      recommends: ["클렌징밤", "클렌징티슈"],
      a_slot:
        "a neat cosmetic jar with its lid slightly open, revealing smooth sherbet texture balm inside",
      d_slot:
        "placed on a smooth travertine stone pedestal, side angle shot, soft directional sunlight with harsh shadows",
    },
  ],
  "스킨케어": [
    {
      recommends: ["세럼", "에센스", "오일"],
      a_slot:
        "a luxurious frosted glass serum bottle, a glass dropper hovering above with a single thick clear droplet hanging",
      d_slot:
        "macro close-up shot, centered layout, floating particles of light, extremely shallow depth of field",
    },
    {
      recommends: ["크림", "마스크팩"],
      a_slot:
        "an elegant luxury cream jar, an artistic smear of thick white moisturizing cream texture on the floor next to it",
      d_slot:
        "three-quarter angle view, elegant high-fashion product layout, clean minimalist background",
    },
    {
      recommends: ["미스트", "토너", "선케어", "로션", "에멀전"],
      a_slot: "a sleek translucent facial spray bottle",
      d_slot:
        "captured at the exact moment of spraying ultra-fine mist particles in the air, backlit commercial lighting, dramatic look",
    },
  ],
  "메이크업 > 립": [
    {
      recommends: [],
      a_slot:
        "a sleek metallic lipstick tube open, revealing a sharp-cut vibrant red lipstick bullet",
      d_slot:
        "lying diagonally on a smooth reflective mirror surface, extreme close-up shot, dramatic studio lighting",
    },
    {
      recommends: [],
      a_slot:
        "a clear acrylic lip gloss container with a brand applicator wand resting beside it",
      d_slot:
        "surrounded by glossy colorful liquid puddles, top-down view, bright pop lighting with clear reflections",
    },
    {
      recommends: [],
      a_slot:
        "three different shades of sleek lip tint tubes standing in a neat diagonal row",
      d_slot:
        "rhythmic composition, low-angle shot looking up, clean negative space for brand logo",
    },
  ],
  // 베이스 — 액체 제형 (파운데이션·비비). 치크는 별도 그룹으로 분리.
  "메이크업 > 베이스-액체": [
    {
      recommends: [],
      a_slot: "a heavy luxury glass liquid foundation bottle standing elegantly",
      d_slot:
        "a smooth artistic swirl of beige liquid foundation texture wrapping around the base of the bottle, soft commercial lighting",
    },
    {
      recommends: [],
      a_slot: "a minimalist square foundation bottle",
      d_slot:
        "placed on top of stacked transparent geometric acrylic blocks, refracting soft studio lights, cinematic depth of field",
    },
  ],
  // 베이스 — 팩트/쿠션 (쿠션 전용). 가루·팩트 형태.
  "메이크업 > 베이스-팩트": [
    {
      recommends: [],
      a_slot:
        "an open premium cushion compact, showing the internal mirror and a pristine cushion puff with brand logo",
      d_slot:
        "perfectly centered symmetrical composition, eye-level shot, sharp focus on the puff strap",
    },
  ],
  // 치크 (블러셔) — 팩트/리퀴드 두 옵션. 사용자 정의 시안.
  "메이크업 > 치크": [
    {
      recommends: [],
      a_slot:
        "an open premium blush compact, revealing a pristine soft rosy pink powder textured pan with a subtle splash of fine blush powder next to it",
      d_slot:
        "asymmetrical composition, high-angle view, a fluffy aesthetic makeup brush resting beside the product, soft diffusion studio lighting",
    },
    {
      recommends: [],
      a_slot:
        "a minimalist aesthetic liquid blush dropper bottle standing elegantly, an artistic translucent smear of soft coral blush texture on the floor",
      d_slot:
        "centered composition, eye-level shot, casting soft organic leaf shadows on the background, bright commercial studio lighting",
    },
  ],
  "메이크업 > 아이": [
    {
      recommends: [],
      a_slot:
        "a multi-color eyeshadow palette wide open, showing pristine colorful powder textured pans",
      d_slot:
        "isometric high-angle view, minimalist layout, sharp focus on all corners, hard studio light",
    },
    {
      recommends: [],
      a_slot:
        "a sleek black mascara tube lying horizontally with its spiral wand applicator resting on top",
      d_slot:
        "extreme macro shot focusing on the fine bristles of the wand, creamy bokeh background, dark sophisticated mood",
    },
    {
      recommends: [],
      a_slot: "an eye makeup palette standing vertically on its edge",
      d_slot:
        "asymmetrical composition, dramatic elongated shadow stretching across a warm beige backdrop, artistic layout",
    },
  ],
};

// ─── 시드 기반 의사랜덤 (b안) ────────────────────────────────────────
// 같은 입력 → 같은 옵션. trend_name·content_id 등 안정 식별자를 시드로.
// 작은 FNV-1a 해시로 충분 (균일성·재현성).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
function pickBySeed(arr, seed) {
  if (!arr || arr.length === 0) return null;
  return arr[fnv1a(seed) % arr.length];
}

// ─── 카테고리 파싱·검증 ─────────────────────────────────────────────
export function parseCategory(category) {
  const [major = "", minor = ""] = String(category ?? "")
    .split(">")
    .map((s) => s.trim());
  return { major, minor };
}
export function isCategorySupported(category) {
  const { major, minor } = parseCategory(category);
  if (!SUPPORTED_MAJOR_CATEGORIES.includes(major)) return false;
  if (major === "메이크업" && !SUPPORTED_MAKEUP_MINOR.includes(minor)) return false;
  return true;
}

// ─── 인물 샷 [D] 결정 ───────────────────────────────────────────────
// seed에는 트렌드명·콘텐츠ID 등 안정 식별자 사용 (재현성·다양성 양립).
// 입력은 항상 소분류 단위 (예: "메이크업 > 립", "메이크업 > 쿠션").
// 묶음 라벨(예: "메이크업 > 베이스")은 입력 단계에서 거부됨.
export function pickPersonPose(category, seed) {
  const { major, minor } = parseCategory(category);
  const key = minor || major;
  const options = PERSON_POSE_MATRIX[key];
  if (!options) return null;
  return pickBySeed(options, `person::${key}::${seed}`);
}

// 메이크업 소분류 → 제품 샷 매트릭스 그룹 키 매핑.
// 제형이 달라 시각적으로 충돌하지 않도록 베이스를 액체/팩트로 분리, 치크는 별도 그룹.
const PRODUCT_GROUP_KEY = {
  "립":       "메이크업 > 립",
  "파운데이션": "메이크업 > 베이스-액체",
  "비비":     "메이크업 > 베이스-액체",
  "쿠션":     "메이크업 > 베이스-팩트",
  "치크":     "메이크업 > 치크",
  "아이":     "메이크업 > 아이",
};

// 비비는 액체 제형 그룹을 공유하지만 제품명은 BB cream으로 표기돼야 함.
// 정확한 단어만 치환 (foundation → BB cream). 다른 표현 안 깨짐.
const PRODUCT_TEXT_REPLACE = {
  "비비": [{ from: /\bfoundation\b/gi, to: "BB cream" }],
};
function applyTextReplace(text, rules) {
  if (!text || !rules) return text;
  return rules.reduce((acc, r) => acc.replace(r.from, r.to), text);
}

// ─── 제품 샷 [D]+[A] 결정 ───────────────────────────────────────────
// 대분류 기반 + 옵션의 recommends에 소분류 있으면 그 옵션 우선 (있으면 후보 좁힘).
// 좁힌 후보 안에서 시드 기반 선택. 좁힐 게 없으면 전체 옵션에서 시드 선택.
export function pickProductShot(category, seed) {
  const { major, minor } = parseCategory(category);
  // 메이크업은 소분류를 그룹 키("메이크업 > 베이스" 등)로 변환, 그 외는 대분류 그대로.
  const key =
    major === "메이크업" ? PRODUCT_GROUP_KEY[minor] : major;
  if (!key) return null;
  const options = PRODUCT_SHOT_MATRIX[key];
  if (!options) return null;
  // 소분류로 후보 좁히기 (옵션 recommends에 minor 있으면 그 옵션만)
  const narrowed = minor
    ? options.filter((o) => o.recommends.includes(minor))
    : [];
  const pool = narrowed.length > 0 ? narrowed : options;
  const chosen = pickBySeed(pool, `product::${key}::${seed}`);
  if (!chosen) return null;
  // 소분류별 단어 치환 (비비 → BB cream 등)
  const rules = PRODUCT_TEXT_REPLACE[minor];
  return rules
    ? { a_slot: applyTextReplace(chosen.a_slot, rules), d_slot: applyTextReplace(chosen.d_slot, rules) }
    : chosen;
}
