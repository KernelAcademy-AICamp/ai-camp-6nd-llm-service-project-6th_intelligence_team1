import { GoogleGenAI, Modality } from "@google/genai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// 이미지 생성 호출 타임아웃 — 무한 대기/장시간 hang으로 데모가 멈추는 것 방지.
// 초과 시 'timeout'·'네트워크'·'시간 초과' 키워드를 포함한 에러로 throw →
// UI(generateMockups)가 그 단어를 보고 "네트워크가 불안정해요. 다시 시도해주세요."를 띄움.
// 빠르게 실패시켜 재시도/폴백으로 넘어가게 함.
const IMAGE_TIMEOUT_MS = 300_000; // 5분

function imageTimeoutError(label) {
  return new Error(`timeout: ${label} 5분 초과 (네트워크 불안정 — 시간 초과)`);
}

// SDK 호출 promise를 5분 타임아웃과 race. abortSignal로 실제 요청도 취소하고,
// 타이머·abort 어느 쪽이 먼저든 키워드 포함 에러로 정규화해 throw.
function withImageTimeout(promise, label, signal) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(imageTimeoutError(label)), IMAGE_TIMEOUT_MS);
  });
  const guarded = promise.catch((err) => {
    if (signal?.aborted) throw imageTimeoutError(label); // abort → generic 메시지를 키워드 포함으로
    throw err;
  });
  return Promise.race([guarded, timeout]).finally(() => clearTimeout(timer));
}

// 제품 이미지를 3:4 비율로 리사이즈 (출력 비율 고정용)
async function resizeTo3x4(absPath) {
  const ext = absPath.split(".").pop().toLowerCase();
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";

  const buf = await sharp(absPath)
    .resize(768, 1024, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();

  return { data: buf.toString("base64"), mimeType };
}

export async function generateImage({ prompt, outputPath, aspectRatio = "3:4", referenceImagePath }) {
  const absRef = referenceImagePath ? resolve(PROJECT_ROOT, referenceImagePath) : null;
  const hasRef = absRef && existsSync(absRef);

  let imageBytes;

  if (hasRef) {
    const { data, mimeType } = await resizeTo3x4(absRef);
    const geminiParts = [
      {
        text: `You are a beauty advertising creative director. Create a high-quality beauty advertisement image based on this description:\n\n${prompt}\n\nThe reference image shows the product. Incorporate it naturally into the scene.`,
      },
      { inlineData: { mimeType, data } },
    ];

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
        const response = await withImageTimeout(
          ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ role: "user", parts: geminiParts }],
            config: { responseModalities: [Modality.IMAGE], abortSignal: signal },
          }),
          "Gemini 이미지 생성",
          signal,
        );
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
        imageBytes = imagePart?.inlineData?.data;
        if (imageBytes) break;
        console.warn(`  ⚠️ Gemini 시도 ${attempt}: 이미지 응답 없음`);
      } catch (err) {
        console.warn(`  ⚠️ Gemini 시도 ${attempt} 실패 (${err?.message ?? err})`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!imageBytes) console.warn("  ⚠️ Gemini 3회 실패, Imagen 폴백");
  }

  if (!imageBytes) {
    const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
    const response = await withImageTimeout(
      ai.models.generateImages({
        model: "imagen-4.0-generate-001",
        prompt,
        config: { numberOfImages: 1, aspectRatio, abortSignal: signal },
      }),
      "Imagen 이미지 생성",
      signal,
    );
    imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  }

  if (!imageBytes) throw new Error("이미지 생성 실패 — 응답에 이미지 없음");

  const absOutputPath = resolve(PROJECT_ROOT, outputPath);
  mkdirSync(dirname(absOutputPath), { recursive: true });
  writeFileSync(absOutputPath, Buffer.from(imageBytes, "base64"));

  return outputPath;
}
