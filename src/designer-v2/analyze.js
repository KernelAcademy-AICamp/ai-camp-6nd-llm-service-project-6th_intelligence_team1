import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmSourceAnalysisSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic();

const analyzeSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/analyze.md"),
  "utf-8",
);

const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchImageAsBase64(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL 형식 아님");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) throw new Error(`content-type=${ct}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`크기 초과 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB`);
    }
    return {
      media_type: ct.split(";")[0].trim(),
      data: Buffer.from(buf).toString("base64"),
    };
  } finally {
    clearTimeout(timer);
  }
}

// 한 매체의 references를 받아 선별+분석 1회.
// 반환: { source, best_reference, shot_type, mood, composition, color_palette, key_objects, source_specific, usage }
export async function analyzeOneSource({ brand, content, source, references }) {
  if (!references?.length) {
    return {
      source,
      best_reference: null,
      shot_type: "(레퍼런스 없음)",
      mood: "",
      composition: "",
      lighting: "",
      pose: "",
      texture: "",
      hair: "",
      makeup: "",
      styling: "",
      color_palette: [],
      key_objects: [],
      background: "",
      source_specific: "",
      usage: null,
    };
  }

  // 이미지 다운로드 (실패한 건 skip)
  const downloaded = [];
  const survivedRefs = [];
  for (const ref of references) {
    try {
      const blob = await fetchImageAsBase64(ref.image_url);
      downloaded.push(blob);
      survivedRefs.push(ref);
    } catch {
      /* skip */
    }
  }

  if (downloaded.length === 0) {
    return {
      source,
      best_reference: null,
      shot_type: "(이미지 다운로드 실패)",
      mood: "",
      composition: "",
      lighting: "",
      pose: "",
      texture: "",
      hair: "",
      makeup: "",
      styling: "",
      color_palette: [],
      key_objects: [],
      background: "",
      source_specific: "",
      usage: null,
    };
  }

  const userText = `다음 ${downloaded.length}장은 **${sourceLabel(source)}** 매체에서 수집한 레퍼런스입니다.

## 브랜드 컨텍스트
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept}

${sourceLabel(source)}의 강점(${sourceStrength(source)})에 가장 잘 부합하는 1장의 인덱스(\`best_index\`)와, 전체 종합 분석을 추출하세요.`;

  const contentBlocks = [
    { type: "text", text: userText },
    ...downloaded.map((blob) => ({
      type: "image",
      source: { type: "base64", media_type: blob.media_type, data: blob.data },
    })),
  ];

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    temperature: 0,
    system: [
      { type: "text", text: analyzeSystemPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: contentBlocks }],
    output_config: { format: zodOutputFormat(LlmSourceAnalysisSchema) },
  });

  const data = response.parsed_output;
  if (!data) throw new Error(`[${source}] 비전 분석 실패`);

  const bestIdx = Math.min(Math.max(data.best_index, 0), survivedRefs.length - 1);
  return {
    source,
    best_reference: survivedRefs[bestIdx] ?? null,
    shot_type: data.shot_type,
    mood: data.mood,
    composition: data.composition,
    color_palette: data.color_palette ?? [],
    key_objects: data.key_objects ?? [],
    lighting: data.lighting ?? "",
    pose: data.pose ?? "",
    texture: data.texture ?? "",
    hair: data.hair ?? "",
    makeup: data.makeup ?? "",
    styling: data.styling ?? "",
    background: data.background ?? "",
    source_specific: data.source_specific,
    usage: response.usage,
  };
}

function sourceLabel(source) {
  return { pinterest: "Pinterest", instagram: "Instagram", mintoiro: "Mintoiro" }[source] ?? source;
}
function sourceStrength(source) {
  return {
    pinterest: "구도·앵글·연출",
    instagram: "트렌드 무드·인물·라이프스타일",
    mintoiro: "패키지 디테일·컬러·타이포",
  }[source] ?? "비주얼 무드";
}
