// 로컬 데모 서버 — 입력 폼 → 파이프라인 실행 → 리포트/시안 화면
// 실행: node server.js  →  http://localhost:3000
//
// 하는 일:
//   GET  /            → web/index.html (입력 폼)
//   GET  /<파일>      → repo 안 정적 파일 서빙 (report-mockup.html, writer-output.json 등)
//   POST /run         → 받은 입력을 inputs/brand-input.json 에 쓰고 파이프라인 실행
//
// 환경변수:
//   PORT      기본 3000
//   RUN_CMD   기본 "npm run pipeline" (테스트 시 가벼운 명령으로 바꿔치기 가능)

import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, extname, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // repo 루트
const PORT = process.env.PORT || 3000;
const RUN_CMD = process.env.RUN_CMD || "npm run pipeline";

// 단계별 실행 명령 (화면 메시지를 실제 단계와 맞추기 위해 하나씩 호출)
const STAGE_CMDS = {
  brand: "npm run brand",
  trend: "npm run trend",
  match: "npm run match",
  write: "npm run write"
};
// 테스트용: 설정하면 모든 단계를 이 명령으로 대체 (실제 API 호출 없이 배관만 점검)
const STAGE_OVERRIDE = process.env.STAGE_CMD_OVERRIDE || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// 요청 본문(JSON) 모으기
function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

// 콤마 문자열 또는 배열 → 배열로 정규화
function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

// UI의 collect()가 보내는 nested 구조를 brand-input.json 형태로 정규화
function buildBrandInput(f) {
  const t = f.target || {};
  return {
    brand_name: f.brand_name || "",
    current_channels: toArray(f.current_channels),
    // collect()는 배열로 보냄 → 첫 URL만 사용 (스키마는 문자열)
    brand_channel_url: Array.isArray(f.brand_channel_url) ? (f.brand_channel_url[0] || "") : (f.brand_channel_url || ""),
    product_name: f.product_name || "",
    category: f.category || "",
    texture_keywords: toArray(f.texture_keywords),
    tone_and_manner: toArray(f.tone_and_manner),
    target: {
      gender: t.gender || "",
      age_groups: toArray(t.age_groups),
      involvement: t.involvement || "",
      motivation: toArray(t.motivation)
    },
    mood_image_url: f.mood_image_url || "",
    campaign_kpi: f.campaign_kpi || "",
    campaign_period: f.campaign_period || "",
    campaign_budget: f.campaign_budget || "",
    media_channels: toArray(f.media_channels),
    reference_campaign_url: f.reference_campaign_url || "",
    competitors: toArray(f.competitors)
  };
}

// 명령 실행 (시간이 오래 걸리므로 timeout 넉넉히)
// [변경] extraEnv 인자 추가 → 자식 프로세스(npm run trend → node youtube.js)에 환경변수 전달
function runCmd(cmd, extraEnv = {}) {
  return new Promise((res) => {
    exec(cmd, {
      cwd: ROOT,
      maxBuffer: 1024 * 1024 * 50,
      timeout: 15 * 60 * 1000,
      env: { ...process.env, ...extraEnv } // 기존 환경변수 + 이번에 추가할 것(YOUTUBE_FRESH 등)
    },
      (err, stdout, stderr) => {
        res({ ok: !err, code: err?.code ?? 0, stdout, stderr: stderr || (err?.message ?? "") });
      });
  });
}

// 정적 파일 서빙 (repo 밖 접근 차단)
async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/web/UI_v1.html"; // 입력 화면 = 사용자가 만든 UI
  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"  // 로컬 데모 — 항상 최신 파일/데이터 제공 (캐시로 옛 리포트 뜨는 것 방지)
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found: " + rel);
  }
}

const server = http.createServer(async (req, res) => {
  // CORS (같은 출처라 사실 불필요하지만 안전하게)
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST" && req.url === "/run") {
    try {
      const body = await readBody(req);
      const form = body ? JSON.parse(body) : {};
      const stage = form.stage || "";  // "brand"|"trend"|"match"|"write" 또는 빈값(전체)

      // 브랜드 단계(또는 stage 없이 입력이 온 경우)에 입력을 저장
      if (stage === "brand" || (!stage && form.brand_name)) {
        const brandInput = buildBrandInput(form);
        await writeFile(
          resolve(ROOT, "inputs/brand-input.json"),
          JSON.stringify(brandInput, null, 2),
          "utf-8"
        );
        console.log(`[run] 입력 저장: ${brandInput.brand_name} / ${brandInput.product_name}`);
      }

      // 단계별 명령 선택 (stage 없으면 전체 파이프라인)
      const cmd = STAGE_OVERRIDE || STAGE_CMDS[stage] || RUN_CMD;

      // [변경] fresh가 켜져 있으면 YouTube 수집이 캐시를 무시하도록 환경변수로 전달
      // (form.fresh 는 UI가 fetch body에 실어 보냄. true일 때만 YOUTUBE_FRESH=1)
      const extraEnv = form.fresh ? { YOUTUBE_FRESH: "1" } : {};
      console.log(`[run] stage=${stage || "(full)"} → ${cmd}${form.fresh ? "  ⚡FRESH" : ""}`);

      const result = await runCmd(cmd, extraEnv);
      console.log(`[run] stage=${stage || "(full)"} 완료 (ok=${result.ok})`);

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: result.ok,
        stage,
        log: (result.stdout + "\n" + result.stderr).slice(-4000)
      }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // 그 외는 정적 파일
  await serveStatic(req, res, req.url);
});

server.listen(PORT, () => {
  console.log(`\n🚀 데모 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`   입력 폼: http://localhost:${PORT}/`);
  console.log(`   실행 명령(RUN_CMD): ${RUN_CMD}`);
  console.log(`   (끄려면 Ctrl+C)\n`);
});
