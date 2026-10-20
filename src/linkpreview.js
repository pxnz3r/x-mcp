import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';

const CACHE_FILE = path.join(paths.dataDir, 'link-previews.json');
const TTL = 1000 * 60 * 60 * 24 * 14;
const MISS_TTL = 1000 * 60 * 60 * 24 * 3;
const MAX_BYTES = 400_000;
const UA = 'Mozilla/5.0 (compatible; xbm-link-preview/1.0)';

let cache = null;

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache() {
  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i');
  const second = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i');
  const match = html.match(first) ?? html.match(second);
  return match ? decodeEntities(match[1]).trim() : null;
}

function absolve(value, base) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function youtubeThumb(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
    }
    if (/(^|\.)youtube\.com$/i.test(parsed.hostname)) {
      const id = parsed.searchParams.get('v') ?? (parsed.pathname.startsWith('/shorts/') ? parsed.pathname.split('/')[2] : null);
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function shouldFetchPreview(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (/(^|\.)(x|twitter)\.com$/i.test(parsed.hostname)) return false;
    if (/^localhost$|^127\.|^\[::1\]$/.test(parsed.hostname)) return false;
    if (/\.(png|jpe?g|gif|webp|avif|svg|mp4|mp3|pdf|zip)$/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchPreview(url) {
  const thumb = youtubeThumb(url);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(7000),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) {
    return thumb ? { image: thumb, title: null, description: null, site: new URL(url).hostname } : null;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('html') && !contentType.includes('xml')) {
    return thumb ? { image: thumb, title: null, description: null, site: new URL(url).hostname } : null;
  }
  const html = (await response.text()).slice(0, MAX_BYTES);
  const base = response.url || url;
  const image = absolve(metaContent(html, 'og:image:secure_url') ?? metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image') ?? metaContent(html, 'twitter:image:src'), base) ?? thumb;
  const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]).trim() : null);
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description');
  return { image, title, description, site: new URL(base).hostname };
}

export async function enrichLinkPreviews(urls, { limit = 400, refresh = false, concurrency = 6, onProgress = null } = {}) {
  const store = loadCache();
  const now = Date.now();
  const results = new Map();
  const queue = [];

  for (const url of urls) {
    const hit = store[url];
    const ttl = hit?.miss ? MISS_TTL : TTL;
    if (!refresh && hit && now - hit.at < ttl) {
      results.set(url, hit);
      continue;
    }
    if (shouldFetchPreview(url)) queue.push(url);
  }

  const jobs = queue.slice(0, limit);
  let cursor = 0;
  let done = 0;
  let found = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const url = jobs[cursor++];
      let data = null;
      try {
        data = await fetchPreview(url);
      } catch {
        data = null;
      }
      const entry = data
        ? { at: now, image: data.image ?? null, title: data.title ?? null, description: data.description ?? null, site: data.site ?? null }
        : { at: now, image: null, title: null, description: null, site: null, miss: true };
      store[url] = entry;
      results.set(url, entry);
      done += 1;
      if (entry.image) found += 1;
      if (onProgress) onProgress({ done, total: jobs.length, found });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  saveCache();

  return { results, checked: done, found, queued: jobs.length, cached: results.size - done };
}

export function clearPreviewCache() {
  cache = {};
  saveCache();
}
