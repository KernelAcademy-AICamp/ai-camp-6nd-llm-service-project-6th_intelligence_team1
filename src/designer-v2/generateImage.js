import { GoogleGenAI } from "@google/genai";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

export async function generateImage({ prompt, outputPath, aspectRatio = "3:4" }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio,
    },
  });

  const generated = response.generatedImages?.[0];
  if (!generated?.image?.imageBytes) {
    throw new Error("이미지 생성 실패 — 응답에 이미지 없음");
  }

  const absOutputPath = resolve(PROJECT_ROOT, outputPath);
  mkdirSync(dirname(absOutputPath), { recursive: true });
  writeFileSync(absOutputPath, Buffer.from(generated.image.imageBytes, "base64"));

  return outputPath;
}
