import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const EMBED_DELAY_MS = 500;

async function embedTexts(texts) {
  const vecs = [];
  for (const text of texts) {
    const result = await ai.models.embedContent({ model: "gemini-embedding-001", contents: text });
    vecs.push(result.embeddings[0].values);
    await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
  }
  return vecs;
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

const MATCH_THRESHOLD = 0.7;

// 브랜드 features ↔ 트렌드 keywords 임베딩 유사도 기반 Ingred-Fit 판정.
// features 각각이 keywords 중 하나와 MATCH_THRESHOLD 이상이면 일치 카운트.
// 2개↑ → ✅, 1개 → ⚠️, 0개 → ❌
export async function computeIngredFit(features, keywords) {
  if (!features?.length || !keywords?.length) return null;
  // GOOGLE_API_KEY 없으면 임베딩 보정 생략 (선택 키 — 가이드상 필수 4종만으로 동작).
  // null 반환 시 match.js는 LLM의 ingred_fit 판정을 그대로 사용.
  if (!process.env.GOOGLE_API_KEY) return null;

  const [featureVecs, keywordVecs] = await Promise.all([
    embedTexts(features),
    embedTexts(keywords),
  ]);

  let matchCount = 0;
  for (const fv of featureVecs) {
    const maxSim = Math.max(...keywordVecs.map((kv) => cosineSimilarity(fv, kv)));
    if (maxSim >= MATCH_THRESHOLD) matchCount++;
  }

  if (matchCount >= 1) return { result: "✅", reason: `성분 키워드 ${matchCount}개 트렌드와 일치 (임베딩 유사도 기반)` };
  return { result: "❌", reason: "성분 키워드 트렌드와 겹치지 않음 (임베딩 유사도 기반)" };
}
