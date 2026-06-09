import { GoogleGenAI, SubjectReferenceImage, SubjectReferenceType } from "@google/genai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// 제품 사진 있으면 editImage(Img2Img), 없으면 generateImages(텍스트→이미지) 폴백
export async function generateImage({ prompt, outputPath, aspectRatio = "3:4", referenceImagePath }) {
  const absRef = referenceImagePath ? resolve(PROJECT_ROOT, referenceImagePath) : null;
  const hasRef = absRef && existsSync(absRef);

  let imageBytes;

  if (hasRef) {
    // 제품 사진 → SubjectReferenceImage(SUBJECT_TYPE_PRODUCT) + editImage
    const ext = absRef.split(".").pop().toLowerCase();
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";
    const imageData = readFileSync(absRef).toString("base64");

    const subjectRef = new SubjectReferenceImage({
      referenceId: 1,
      referenceImage: { imageBytes: imageData, mimeType },
      config: { subjectType: SubjectReferenceType.SUBJECT_TYPE_PRODUCT },
    });

    const response = await ai.models.editImage({
      model: "imagen-3.0-capability-001",
      prompt: `${prompt} The product [1] should be prominently featured.`,
      referenceImages: [subjectRef],
      config: { numberOfImages: 1, aspectRatio },
    });

    imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  } else {
    // 제품 사진 없음 → 텍스트→이미지
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
