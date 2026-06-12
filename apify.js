/**
 * apify.js — 채널별 활성도(channel_activity) 수집·계산 스크립트 (proper version)
 * 설치:  npm install apify-client dotenv   /  토큰: .env 에 APIFY_TOKEN=...
 * 실행:  1) node trend/youtube.js   2) node apify.js
 *        (빠른 테스트: node apify.js 글로우메이크업 물광틴트  ← 인스타+틱톡만)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { ApifyClient } from 'apify-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const CACHE_PATH = path.join(__dirname, 'trend', 'data', 'apify_cache.json');
const ACTOR_TIKTOK = 'clockworks/tiktok-hashtag-scraper';
const ACTOR_INSTAGRAM = 'apify/instagram-hashtag-scraper';
const RESULTS_PER_KEYWORD = 20;

function today() { return new Date().toISOString().slice(0, 10); }
function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; } }
function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}
function cacheKey(platform, keyword) { return `${platform}__${keyword}__${today()}`; }

function median(nums) {
  const arr = nums.filter(n => typeof n === 'number' && !isNaN(n)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
function toHashtag(keyword) {
  return keyword.replace(/[\s!?.,:;\-+=*&%$#@/\\~^|<>()[\]{}"'`]/g, '');
}

async function fetchTiktok(keyword, hashtag = toHashtag(keyword), fresh = false) {
  const cache = loadCache();
  const key = cacheKey('tiktok', keyword);
  if (!fresh && cache[key]) return cache[key];
  const run = await client.actor(ACTOR_TIKTOK).call({
    hashtags: [hashtag],
    resultsPerPage: RESULTS_PER_KEYWORD,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const views = items.map(v => v.playCount ?? v.stats?.playCount ?? 0);
  const raw = { hashtag, post_count: items.length, median_views: Math.round(median(views)) };
  cache[key] = raw; saveCache(cache);
  return raw;
}

async function fetchInstagram(keyword, hashtag = toHashtag(keyword), fresh = false) {
  const cache = loadCache();
  const key = cacheKey('instagram', keyword);
  if (!fresh && cache[key]) return cache[key];
  const run = await client.actor(ACTOR_INSTAGRAM).call({
    hashtags: [hashtag],
    resultsLimit: RESULTS_PER_KEYWORD,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const eng = items.map(p => (p.likesCount ?? 0) + (p.commentsCount ?? 0));
  const raw = { hashtag, post_count: items.length, median_engagement: Math.round(median(eng)) };
  cache[key] = raw; saveCache(cache);
  return raw;
}

function normalizePool(values, pick) {
  const logs = values.map(v => Math.log10((pick(v.raw) || 0) + 1));
  const min = Math.min(...logs), max = Math.max(...logs);
  const span = max - min;
  return values.map((v, i) => ({
    keyword: v.keyword,
    score: span === 0 ? 50 : Math.round(((logs[i] - min) / span) * 100),
  }));
}

async function buildChannelActivity(keywords, opts = {}, fresh = false) {
  const { youtubeRawByKw = {}, hashtagByKw = {} } = opts;
  const tiktokRaw = {}, instaRaw = {};
  for (const kw of keywords) {
    const tag = hashtagByKw[kw] || toHashtag(kw);
    tiktokRaw[kw] = await fetchTiktok(kw, tag, fresh);
    instaRaw[kw] = await fetchInstagram(kw, tag, fresh);
  }
  const ytScores = normalizePool(keywords.map(kw => ({ keyword: kw, raw: youtubeRawByKw[kw] || {} })), r => r.median_views);
  const ttScores = normalizePool(keywords.map(kw => ({ keyword: kw, raw: tiktokRaw[kw] })), r => r.median_views);
  const igScores = normalizePool(keywords.map(kw => ({ keyword: kw, raw: instaRaw[kw] })), r => r.median_engagement);
  const byKw = (arr, kw) => arr.find(x => x.keyword === kw)?.score ?? null;

  const result = {};
  for (const kw of keywords) {
    const scores = {};
    if (youtubeRawByKw[kw]) {
      const r = youtubeRawByKw[kw];
      scores.youtube = {
        score: byKw(ytScores, kw),
        raw: { recent_count: r.recent_count ?? null, median_views: r.median_views ?? null },
        evidence: `최근 관련 영상 ${r.recent_count ?? '-'}개, 중앙 조회수 ${fmt(r.median_views)}`,
        source: 'youtube_official',
      };
    }
    scores.instagram = {
      score: byKw(igScores, kw),
      raw: instaRaw[kw],
      evidence: `#${instaRaw[kw].hashtag} 게시물 ${instaRaw[kw].post_count}개, 중앙 인게이지먼트 ${fmt(instaRaw[kw].median_engagement)}`,
      source: 'apify_instagram',
    };
    scores.tiktok = {
      score: byKw(ttScores, kw),
      raw: tiktokRaw[kw],
      evidence: `#${tiktokRaw[kw].hashtag} 영상 ${tiktokRaw[kw].post_count}개, 중앙 조회수 ${fmt(tiktokRaw[kw].median_views)}`,
      source: 'apify_tiktok_hashtag',
    };
    const top = Object.entries(scores).filter(([, v]) => v.score != null).sort((a, b) => b[1].score - a[1].score)[0];
    result[kw] = { scores, top_channel: top ? top[0] : null, interpretation: 'relative_to_pool' };
  }
  return result;
}

function fmt(n) {
  if (n == null) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '만';
  return String(n);
}

function loadBrandKeywords() {
  const b = JSON.parse(fs.readFileSync('shared/data/brand-analysis.json', 'utf-8'));
  const search = b.data.search_keywords || [];
  const tags = b.data.hashtag_keywords || [];
  const hashtagByKw = {};
  if (tags.length) {
    search.forEach((kw, i) => { if (tags[i]) hashtagByKw[kw] = tags[i]; });
  } else {
    console.warn('⚠️ hashtag_keywords 없음 → search_keywords 자동 정제로 폴백 (SNS 결과 빈약할 수 있음)');
  }
  return { keywords: search, hashtagByKw };
}
function loadYoutubeRaw() {
  let data;
  try { data = JSON.parse(fs.readFileSync('trend/data/youtube_raw.json', 'utf-8')); }
  catch { console.warn('⚠️ youtube_raw.json 없음 → 유튜브 점수 생략 (node trend/youtube.js 먼저 실행)'); return {}; }
  const byKw = {};
  for (const v of (data.raw_data || [])) (byKw[v.query] = byKw[v.query] || []).push(v.view_count || 0);
  const out = {};
  for (const [kw, views] of Object.entries(byKw)) out[kw] = { recent_count: views.length, median_views: Math.round(median(views)) };
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.length) {
    buildChannelActivity(argv, {}, false)
      .then(out => console.log(JSON.stringify(out, null, 2)))
      .catch(err => { console.error('❌ 오류:', err.message); process.exit(1); });
  } else {
    const { keywords, hashtagByKw } = loadBrandKeywords();
    const youtubeRawByKw = loadYoutubeRaw();
    buildChannelActivity(keywords, { youtubeRawByKw, hashtagByKw }, false)
      .then(out => {
        fs.writeFileSync('trend/data/channel-activity.json', JSON.stringify(out, null, 2), 'utf-8');
        console.log(JSON.stringify(out, null, 2));
        console.log('\n저장됨: trend/data/channel-activity.json');
      })
      .catch(err => { console.error('❌ 오류:', err.message); process.exit(1); });
  }
}

export { buildChannelActivity, fetchTiktok, fetchInstagram };
