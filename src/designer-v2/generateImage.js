import { GoogleGenAI, Modality } from "@google/genai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

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
    try {
      const { data, mimeType } = await resizeTo3x4(absRef);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a beauty advertising creative director. Create a high-quality beauty advertisement image based on this description:\n\n${prompt}\n\nThe reference image shows the product. Incorporate it naturally into the scene.`,
              },
              { inlineData: { mimeType, data } },
            ],
          },
        ],
        config: { responseModalities: [Modality.IMAGE] },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
      imageBytes = imagePart?.inlineData?.data;
    } catch (err) {
      console.warn(`  ⚠️ Gemini 멀티모달 실패 (${err?.message ?? err}), Imagen 폴백`);
    }
  }

  if (!imageBytes) {
    const response = await ai.models.generateImages({
      model: "imagen-4.0-generate-001",
      prompt,
      config: { numberOfImages: 1, aspectRatio },
    });
    imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  }

  if (!imageBytes) throw new Error("이미지 생성 실패 — 응답에 이미지 없음");

  const absOutputPath = resolve(PROJECT_ROOT, outputPath);
  mkdirSync(dirname(absOutputPath), { recursive: true });
  writeFileSync(absOutputPath, Buffer.from(imageBytes, "base64"));

  return outputPath;
}
