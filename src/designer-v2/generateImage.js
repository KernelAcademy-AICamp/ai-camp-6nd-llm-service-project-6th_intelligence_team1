import { GoogleGenAI, Modality } from "@google/genai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// 제품 사진 있으면 Gemini 멀티모달(이미지 입력→이미지 출력), 없으면 Imagen 텍스트→이미지 폴백
export async function generateImage({ prompt, outputPath, aspectRatio = "3:4", referenceImagePath }) {
  const absRef = referenceImagePath ? resolve(PROJECT_ROOT, referenceImagePath) : null;
  const hasRef = absRef && existsSync(absRef);

  let imageBytes;

  if (hasRef) {
    // Gemini 멀티모달: 제품 사진 + 텍스트 프롬프트 → 이미지 생성
    try {
      const ext = absRef.split(".").pop().toLowerCase();
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      const imageData = readFileSync(absRef).toString("base64");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a beauty advertising photographer. Using the product in the reference image, create a high-quality beauty advertisement photo based on this description:\n\n${prompt}\n\nThe product from the reference image must appear prominently in the generated image.`,
              },
              {
                inlineData: { mimeType, data: imageData },
              },
            ],
          },
        ],
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
      imageBytes = imagePart?.inlineData?.data;
    } catch (err) {
      console.warn(`  ⚠️ Gemini 멀티모달 실패 (${err?.message ?? err}), Imagen 폴백`);
    }
  }

  if (!imageBytes) {
    // 폴백: Imagen 4.0 텍스트→이미지
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
