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

import "dotenv/config"; // .env 로드 (SLACK_WEBHOOK_URL 등)
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { exec, spawn } from "node:child_process";
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
  write: "npm run write",
  design: "npm run design-v2"
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
    // collect()는 배열로 보냄 → 스키마도 배열(z.array)이므로 배열 그대로 보관 (빈 값 제거)
    brand_channel_url: Array.isArray(f.brand_channel_url) ? f.brand_channel_url.filter(Boolean) : (f.brand_channel_url ? [f.brand_channel_url] : []),
    product_name: f.product_name || "",
    // 카테고리 4단계 분리 (브랜드분석가 BrandInputSchema v2)
    category_major: f.category_major || "",
    category_mid: f.category_mid || "",
    category_sub: f.category_sub || "",
    // 제품특징: 옵션 선택 + 자유 입력 (각 최대 3개)
    product_features: toArray(f.product_features),
    product_features_custom: toArray(f.product_features_custom),
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
    media_channels: (toArray(f.media_channels).length ? toArray(f.media_channels) : toArray(f.current_channels)).filter((c) => c !== "없음"),
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
      // npm 업데이트 안내문(npm notice)·fund 광고를 끔 → 에러 로그가 안내문에 묻히지 않게
      env: { ...process.env, NO_UPDATE_NOTIFIER: "1", NPM_CONFIG_UPDATE_NOTIFIER: "false", NPM_CONFIG_FUND: "false", ...extraEnv } // + 이번에 추가할 것(YOUTUBE_FRESH 등)
    },
      (err, stdout, stderr) => {
        res({ ok: !err, code: err?.code ?? 0, stdout, stderr: stderr || (err?.message ?? "") });
      });
  });
}

// 실행 로그에서 '진짜 에러'를 앞으로 뽑아냄.
// npm 안내문(notice/warn/fund) 같은 잡음을 걷어내고, 'Error'·'Cannot find' 등
// 실제 오류 줄부터 보여준다. (로그를 끝에서 자르면 npm notice만 보이던 문제 해결)
function focusError(stdout, stderr) {
  const clean = ((stdout || "") + "\n" + (stderr || ""))
    .split("\n")
    .filter((l) => !/^\s*npm (notice|warn|fund|WARN)/i.test(l))
    .join("\n")
    .trim();
  const lines = clean.split("\n");
  const idx = lines.findIndex((l) => /(Error|Cannot find|ERR_[A-Z_]+|throw |✖|❌)/.test(l));
  const focused = idx >= 0 ? lines.slice(idx).join("\n") : clean;
  return focused.slice(0, 1500); // 앞부분(=진짜 에러)부터
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

  // 제품 사진 업로드: UI가 보낸 base64 이미지를 inputs/product-images/<브랜드명>.<확장자> 로 저장
  // → design(시안가) 단계가 이 파일을 찾아 시안을 생성한다.
  if (req.method === "POST" && req.url === "/upload-product-image") {
    try {
      const body = await readBody(req);
      const form = body ? JSON.parse(body) : {};
      const brand = (form.brand_name || "").trim();
      const dataUrl = form.data_url || "";
      const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
      if (!brand || !m) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "브랜드명 또는 이미지 형식 오류 (jpg/png/webp만)" }));
        return;
      }
      let ext = m[1].toLowerCase();
      if (ext === "jpeg") ext = "jpg";
      const buf = Buffer.from(m[2], "base64");
      const dir = resolve(ROOT, "inputs/product-images");
      await mkdir(dir, { recursive: true });
      // 같은 브랜드의 기존 사진(다른 확장자 포함) 제거 → 옛 사진이 남아 잘못 잡히는 것 방지
      for (const e of ["jpg", "jpeg", "png", "webp"]) {
        try { await unlink(resolve(dir, `${brand}.${e}`)); } catch { /* 없으면 무시 */ }
      }
      await writeFile(resolve(dir, `${brand}.${ext}`), buf);
      console.log(`[upload] 제품 사진 저장: inputs/product-images/${brand}.${ext} (${buf.length} bytes)`);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, path: `inputs/product-images/${brand}.${ext}` }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // 스트리밍 실행: 단계를 spawn으로 돌리며 stdout/stderr를 줄 단위로 SSE 전송.
  // → UI가 "수집되는 키워드"나 "시안 진행 단계"를 마지막에 몰아서가 아니라 실시간으로 표시할 수 있다.
  // EventSource(GET)로 호출: /run-stream?stage=trend&fresh=1
  if (req.method === "GET" && req.url.startsWith("/run-stream")) {
    const u = new URL(req.url, "http://localhost");
    const stage = u.searchParams.get("stage") || "";
    const fresh = u.searchParams.get("fresh") === "1";
    const cmd = STAGE_OVERRIDE || STAGE_CMDS[stage] || RUN_CMD;
    const extraEnv = { GEN_IMAGE: "1", ...(fresh ? { YOUTUBE_FRESH: "1" } : {}) };

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no" // 프록시 버퍼링 방지 (실시간 전송 보장)
    });
    const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* 연결 종료됨 */ } };
    console.log(`[run-stream] stage=${stage || "(full)"} → ${cmd}${fresh ? "  ⚡FRESH" : ""}`);

    const child = spawn(cmd, {
      cwd: ROOT,
      shell: true,
      env: { ...process.env, NO_UPDATE_NOTIFIER: "1", NPM_CONFIG_UPDATE_NOTIFIER: "false", NPM_CONFIG_FUND: "false", ...extraEnv }
    });

    let full = "";   // 전체 로그(완료 시 요약/에러 추출용)
    let buf = "";    // 아직 줄바꿈이 안 끝난 마지막 조각
    const onData = (chunk) => {
      const text = chunk.toString();
      full += text;
      buf += text;
      const lines = buf.split("\n");
      buf = lines.pop(); // 미완성 줄은 다음 청크와 합치기 위해 남겨둠
      for (const line of lines) send({ type: "log", line });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    // exec와 동일하게 15분 타임아웃
    const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 무시 */ } }, 15 * 60 * 1000);

    let ended = false;
    const finish = (ok) => {
      if (ended) return;
      ended = true;
      clearTimeout(killTimer);
      if (buf) send({ type: "log", line: buf }); // 남은 마지막 줄 flush
      const log = ok ? full.slice(-4000) : focusError(full, "");
      send({ type: "done", ok, stage, log });
      try { res.end(); } catch { /* 무시 */ }
      console.log(`[run-stream] stage=${stage || "(full)"} 완료 (ok=${ok})`);
    };
    child.on("close", (code) => finish(code === 0));
    child.on("error", (err) => { send({ type: "log", line: "spawn error: " + err.message }); finish(false); });

    // 브라우저가 도중에 연결을 끊으면 자식 프로세스도 정리
    req.on("close", () => { if (!ended) { try { child.kill("SIGKILL"); } catch { /* 무시 */ } clearTimeout(killTimer); } });
    return;
  }

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
      // GEN_IMAGE=1 상시 ON — UI 실행 시 design-v2가 시안 이미지까지 생성하도록 (기본은 프롬프트만)
      const extraEnv = { GEN_IMAGE: "1", ...(form.fresh ? { YOUTUBE_FRESH: "1" } : {}) };
      console.log(`[run] stage=${stage || "(full)"} → ${cmd}${form.fresh ? "  ⚡FRESH" : ""}`);

      const result = await runCmd(cmd, extraEnv);
      console.log(`[run] stage=${stage || "(full)"} 완료 (ok=${result.ok})`);

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: result.ok,
        stage,
        log: result.ok
          ? (result.stdout + "\n" + result.stderr).slice(-4000) // 성공 로그는 기존대로(꼬리)
          : focusError(result.stdout, result.stderr)             // 실패 로그는 진짜 에러를 앞으로
      }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // Slack 공유: UI가 보낸 텍스트 요약을 .env의 웹훅으로 게시 (웹훅 URL은 서버에만 보관)
  if (req.method === "POST" && req.url === "/share/slack") {
    try {
      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (!webhook) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "SLACK_WEBHOOK_URL 미설정 (.env 확인 후 서버 재시작)" }));
        return;
      }
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const text = (payload.text || "").toString().trim();
      const blocks = Array.isArray(payload.blocks) ? payload.blocks : null;
      if (!text && !blocks) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "보낼 내용이 비어 있어요" }));
        return;
      }
      // blocks가 있으면 이미지 포함 게시, text는 알림/폴백용으로 함께 전달
      const slackPayload = blocks ? { text: text || "TrendFit 제안서", blocks } : { text };
      const slackRes = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload)
      });
      const respText = await slackRes.text();
      if (!slackRes.ok) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: `Slack 응답 ${slackRes.status}: ${respText}` }));
        return;
      }
      console.log("[share/slack] 게시 완료");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
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