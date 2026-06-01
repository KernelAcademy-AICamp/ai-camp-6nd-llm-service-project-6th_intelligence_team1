import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmAnalysisSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic();

const analyzeSystemPrompt = readFileSync(
  resolve(__dirname, "prompts/analyze.md"),
  "utf-8",
);

// 2단계 — 수집된 레퍼런스 이미지를 Claude Haiku Vision으로 분석.
//   입력: references[] (이미지 URL 포함)
//   출력: LlmAnalysisSchema 형태 { shot_type, mood, color_palette, composition, key_objects }
//   shot_type은 LLM이 동적 결정 (인물 광고·제품 단독·통합·무드 보드 등 자유 작성).
//
// 비용·시간 관리를 위해 앞에서 N장만 분석. 일부 URL은 접근 불가일 수 있어
// LLM이 보이는 것만으로 분석하도록 안내(analyze.md에 명시).
const MAX_IMAGES_PER_ANALYSIS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB Claude API 한도
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 이미지 URL을 직접 fetch해서 base64로 변환.
// Claude에 URL 그대로 보내면 robots.txt 차단 사이트(인스타·일부 블로그 등)에서 거부됨.
// 우리가 다운로드해서 base64로 전달하면 Claude는 fetch 안 함 → 차단 우회.
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

export async function analyzeReferences({ brand, content, references }) {
  // 이미지 URL 후보 — 시도하다 실패하면 다음으로, MAX_IMAGES_PER_ANALYSIS 채울 때까지.
  const candidates = references.filter((r) => r.image_url);
  if (candidates.length === 0) {
    throw new Error("분석할 이미지 URL이 없습니다");
  }

  const downloaded = [];
  const failures = [];
  for (const ref of candidates) {
    if (downloaded.length >= MAX_IMAGES_PER_ANALYSIS) break;
    try {
      const blob = await fetchImageAsBase64(ref.image_url);
      downloaded.push({ ref, blob });
    } catch (err) {
      failures.push(`${ref.image_url.slice(0, 60)}… → ${err.message}`);
    }
  }

  if (downloaded.length === 0) {
    throw new Error(
      `이미지 다운로드 0건 (시도 ${candidates.length}건 모두 실패). 첫 실패: ${failures[0] ?? "(없음)"}`,
    );
  }

  const userText = `다음 ${downloaded.length}장의 레퍼런스 이미지를 분석하세요.

## 브랜드 컨텍스트
- brand_name: ${brand.brand_name ?? "(없음)"}
- product_name: ${brand.product_name ?? "(없음)"}
- category: ${brand.category ?? "(없음)"}
- tone_and_manner: ${JSON.stringify(brand.tone_and_manner ?? [])}

## 트렌드 콘텐츠
- trend_name: ${content.trend_name}
- concept: ${content.concept}

위 콘텐츠로 시안 1장을 만들 때 참고할 비주얼 무드를 추출하세요.`;

  const contentBlocks = [
    { type: "text", text: userText },
    ...downloaded.map(({ blob }) => ({
      type: "image",
      source: { type: "base64", media_type: blob.media_type, data: blob.data },
    })),
  ];

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    temperature: 0,
    system: [
      { type: "text", text: analyzeSystemPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: contentBlocks }],
    output_config: { format: zodOutputFormat(LlmAnalysisSchema) },
  });

  const data = response.parsed_output;
  if (!data) {
    throw new Error("비전 분석 실패 (LLM 응답 파싱 실패)");
  }

  return {
    analysis: data,
    analyzed_count: downloaded.length,
    failed_count: failures.length,
    usage: response.usage,
  };
}
