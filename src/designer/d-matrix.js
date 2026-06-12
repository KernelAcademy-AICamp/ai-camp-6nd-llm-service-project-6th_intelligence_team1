// [D 자세 및 구도] 매트릭스 — 코드가 직접 룩업 (LLM 재량 없음).
// 두 시안 타입(인물 샷·제품 샷)별로 별도 매트릭스.
//
// 입력에서 카테고리는 "대분류 > 소분류" 형식 (예: "메이크업 > 립", "클렌징 > 클렌징오일")
// - 인물 샷: 소분류로 룩업 (소분류 없으면 대분류 기본값)
// - 제품 샷: 대분류로 룩업, 소분류가 옵션의 "추천" 리스트에 있으면 그 옵션 우선
//
// ⚠️ 제품 형태·재질·색 어휘 금지 (튜브·병·컴팩트·스틱·foam·gel·beige·rosy 등).
//    제품 외형은 첨부 사진이 담당. 매트릭스는 동작·자세·구도·앵글·환경·라이팅만.

// 시안가가 지원하는 5대분류만 허용. 그 외(바디·헤어·기타)는 입력 단계에서 거부.
export const SUPPORTED_MAJOR_CATEGORIES = ["클렌징", "스킨케어", "메이크업"];
// 메이크업 묶음("베이스" 등)은 입력으로 안 옴 — 입력은 항상 소분류 단위.
// 매트릭스에 키가 존재하는 소분류만 허용 (isCategorySupported가 PERSON_POSE_MATRIX로 직접 확인).
export const SUPPORTED_MAKEUP_MINOR = [
  "립", "치크", "파운데이션", "비비", "쿠션", "아이",
];

// ─── 인물 샷 [A: 모델 특징] 매트릭스 (톤앤매너 기반) ─────────────────
// 톤별 1개 고정 — 같은 브랜드면 카테고리 무관하게 모델·헤어·메이크업 무드 동일.
// 표정·시선·자세는 [D]에서, 제품 자체는 첨부 사진(reference_image_path)이 담당하므로 여기선 제외.
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
// 값: 자세·구도 옵션 3개 (자세 + 손동작·표정).
// ⚠️ 제품 형태·재질·색 어휘 금지. "the product"로 일반화.
export const PERSON_POSE_MATRIX = {
  // 클렌징
  "클렌징폼": [
    "gentle massaging motion with both hands on the cheeks, soft smile",
    "scooping the product into the cupped palm with one hand, looking down softly",
    "raising the product near the chin with a fresh confident expression",
  ],
  "클렌징오일": [
    "pressing the top of the product with one hand near the cheek",
    "rubbing both palms gently together near the chin, soft smile",
    "holding the product near the cheek with a calm glowing expression",
  ],
  "클렌징밤": [
    "scooping a small amount with a cosmetic spatula, looking down delicately",
    "touching the inside of the product softly with a fingertip",
    "gently applying onto the forehead with light fingertip pressure",
  ],
  "클렌징밀크": [
    "holding the product with one clean hand near the cheek",
    "fingertip touching the cheek with a smooth wiping motion",
    "resting chin on hand next to the product, calm serene expression",
  ],
  "클렌징워터": [
    "soaking a round cosmetic cotton pad with the product",
    "holding the product in one hand, looking softly at the camera",
    "tilting the product slightly forward in one hand, fresh expression",
  ],
  "클렌징티슈": [
    "wiping the cheek gently with the product, eyes softly closed",
    "holding the product unfolded with both hands close to the chin",
    "resting the product on a bare shoulder, looking sideways",
  ],
  "필링제품": [
    "holding the product with one hand near the temple, gentle expression",
    "massaging the nose area gently with bare fingertips",
    "one hand resting on the cheek with a clean fresh expression",
  ],
  "립앤아이리무버": [
    "shaking the product gently with one hand near the face",
    "pressing a soaked cotton pad gently against one eye",
    "holding the product near pouty lips, soft gaze",
  ],

  // 스킨케어
  "선케어": [
    "fingertip touching the cheek with a delicate dabbing motion",
    "smoothing the cheek with the back of two fingers in a delicate motion",
    "shading her eyes with one hand and holding the product softly in the other",
  ],
  "토너": [
    "holding the product, gently dabbing a cotton pad on the skin",
    "pouring the product onto a cupped palm carefully",
    "resting cheek against the product with a soft sleepy expression",
  ],
  "에센스": [
    "holding the product close to the cheek with one hand",
    "gentle dropping motion with one hand over the cheek",
    "cupping the product with both hands close to the chest",
  ],
  "세럼": [
    "holding the product close to the cheek with one hand",
    "gentle dropping motion with one hand over the cheek",
    "cupping the product with both hands close to the chest",
  ],
  "오일": [
    "holding the product close to the cheek with one hand",
    "gentle dropping motion with one hand over the cheek",
    "cupping the product with both hands close to the chest",
  ],
  "크림": [
    "holding the product elegantly with one hand near the cheek",
    "applying a small amount on an index finger with a gentle motion",
    "applying onto the cheek smoothly with two fingertips",
  ],
  "미스트": [
    "holding the product with eyes gently closed, peaceful expression",
    "spraying motion around the face with one hand",
    "extending one arm forward holding the product, confident gaze",
  ],
  "로션": [
    "holding the product with one hand, pressing the top",
    "rubbing both palms together softly with a gentle motion",
    "holding the product near the collarbone line with a calm gaze",
  ],
  "에멀전": [
    "holding the product with one hand, pressing the top",
    "rubbing both palms together softly with a gentle motion",
    "holding the product near the collarbone line with a calm gaze",
  ],
  "마스크팩": [
    "wearing the product on the face, lying back loosely with eyes closed",
    "peeling off a corner from the cheek, looking at the camera",
    "holding the product near the face with a fresh expression",
  ],

  // 메이크업
  "립": [
    "holding the product close to smiling lips",
    "applying gently onto soft pouty lips, focused gaze",
    "biting the product gently between the teeth, playful expression",
  ],
  "치크": [
    "holding the product with a fluffy makeup brush in one hand",
    "sweeping a powder brush gently across the cheek, soft focused expression",
    "holding the product near the high cheekbone with a confident gaze",
  ],
  "파운데이션": [
    "holding the product elegantly with one hand near the jaw",
    "tapping a small amount onto the back of the hand with a focused gaze",
    "holding a wet beauty blender sponge near the jawline",
  ],
  "비비": [
    "holding the product elegantly with one hand near the jaw",
    "tapping a small amount onto the back of the hand with a focused gaze",
    "holding a wet beauty blender sponge near the jawline",
  ],
  "쿠션": [
    "holding the product open with a soft reflection in the mirror",
    "dabbing a powder puff gently onto the center of the cheek",
    "slipping two fingers into the puff strap, looking proud",
  ],
  "아이": [
    "holding the product open under the chin, looking up gently",
    "holding the product close to long fluttering eyelashes",
    "drawing a sharp line near the eye with the product",
  ],
};

// ─── 제품 샷 [D] 매트릭스 (대분류 기반, 추천 소분류 우선) ──────────────
// 각 대분류마다 옵션 1-3개, 옵션에 "추천" 소분류 목록이 있으면 매칭 우선.
// recommends가 비어있으면 모든 소분류에 동일 가중치.
//
// 옵션 객체: { recommends: [...소분류], a_slot, d_slot }
//   - a_slot: 제품 자체는 사진이 담당하므로 "the product as the focal point"로 통일.
//   - d_slot: 배치·카메라 앵글·환경·라이팅. 제품 형태·재질·색 어휘 금지.
const A_SLOT_PRODUCT = "the product as the focal point";

export const PRODUCT_SHOT_MATRIX = {
  "클렌징": [
    {
      recommends: ["클렌징오일", "클렌징워터", "립앤아이리무버"],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "resting on a wet glass surface with realistic water splashes around, close-up shot, eye-level angle, sharp focus",
    },
    {
      recommends: ["클렌징폼", "클렌징밀크", "필링제품"],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "centered composition, top-down flat lay view, clean white studio background",
    },
    {
      recommends: ["클렌징밤", "클렌징티슈"],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "placed on a smooth travertine stone pedestal, side angle shot, hard sunlight casting dramatic shadows",
    },
  ],
  "스킨케어": [
    {
      recommends: ["세럼", "에센스", "오일"],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "macro close-up shot, centered layout, floating particles of light around, extremely shallow depth of field",
    },
    {
      recommends: ["크림", "마스크팩"],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "three-quarter angle view, elegant high-fashion product layout, clean minimalist background",
    },
    {
      recommends: ["미스트", "토너", "선케어", "로션", "에멀전"],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "clean front-facing composition, subtle dewy water droplets scattered around for a hydrated mood, calm bright studio environment",
    },
  ],
  "메이크업 > 립": [
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "lying diagonally on a smooth reflective mirror surface, extreme close-up shot, dramatic studio mood",
    },
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "surrounded by glossy colorful liquid puddles on the floor, top-down view, bright pop studio environment with clear reflections",
    },
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "rhythmic composition with multiple repeated arrangements, low-angle shot looking up, clean negative space for brand logo",
    },
  ],
  // 베이스 — 액체 제형(파운데이션·비비)·팩트(쿠션) 그룹 분리 유지.
  // a_slot은 통일됐지만 d_slot의 무드·구도가 카테고리별로 다름.
  "메이크업 > 베이스-액체": [
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "elegant centered upright composition, soft commercial highlights and gentle reflections, sophisticated studio environment",
    },
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "placed on top of stacked transparent geometric acrylic blocks, refracting studio lights subtly, cinematic depth of field",
    },
  ],
  "메이크업 > 베이스-팩트": [
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "perfectly centered symmetrical composition, eye-level shot, balanced clean studio environment",
    },
  ],
  "메이크업 > 치크": [
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "asymmetrical composition, high-angle view, a fluffy aesthetic makeup brush resting beside, soft studio environment",
    },
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "centered composition, eye-level shot, soft organic leaf shadows cast across the background, bright commercial studio environment",
    },
  ],
  "메이크업 > 아이": [
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "isometric high-angle view, minimalist layout, sharp focus across all corners, crisp studio environment",
    },
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
      d_slot:
        "extreme macro shot focusing on the fine details, creamy bokeh background, dark sophisticated mood",
    },
    {
      recommends: [],
      a_slot: A_SLOT_PRODUCT,
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
// 제형이 달라 d_slot 무드·구도가 다르도록 베이스를 액체/팩트로 분리, 치크는 별도 그룹.
const PRODUCT_GROUP_KEY = {
  "립":       "메이크업 > 립",
  "파운데이션": "메이크업 > 베이스-액체",
  "비비":     "메이크업 > 베이스-액체",
  "쿠션":     "메이크업 > 베이스-팩트",
  "치크":     "메이크업 > 치크",
  "아이":     "메이크업 > 아이",
};

// ─── 제품 샷 [D]+[A] 결정 ───────────────────────────────────────────
// 대분류 기반 + 옵션의 recommends에 소분류 있으면 그 옵션 우선 (있으면 후보 좁힘).
// 좁힌 후보 안에서 시드 기반 선택. 좁힐 게 없으면 전체 옵션에서 시드 선택.
// a_slot은 모든 옵션에서 통일됐고, d_slot이 구도·무드·환경을 결정한다.
export function pickProductShot(category, seed) {
  const { major, minor } = parseCategory(category);
  // 메이크업은 소분류를 그룹 키("메이크업 > 베이스-액체" 등)로 변환, 그 외는 대분류 그대로.
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
  return pickBySeed(pool, `product::${key}::${seed}`);
}
