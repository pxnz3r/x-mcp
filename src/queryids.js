import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { paths, userAgent } from './config.js';
import { XAccessError } from './errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const JF_URL = 'https://x.com/i/jf/';
const REMOTE_PLACEHOLDER =
  'https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json';

const CANDIDATES = {
  Bookmarks: ['VjWsfItbiMLeajpZ90NJeg'],
  Viewer: ['TpQxQtWMTMnIAMPlMGMqNw'],
  TweetResultByRestId: ['xZfFqfOmKQu_OXekGI59mg'],
  TweetDetail: ['xd_EMdYvB9hfZsZ6Idri0w'],
  BookmarkFoldersSlice: ['i78YDd0Tza-dV4SYs58kRg'],
  BookmarkFolderTimeline: ['8HoabOvl7jl9IC1Aixj-vg', 'e1T8IKkMr-8iQk7tNOyD_g'],
  bookmarkTweetToFolder: ['4KHZvvNbHNf07bsgnL9gWA'],
  createBookmarkFolder: ['6Xxqpq8TM_CREYiuof_h5w'],
  editBookmarkFolder: ['a6kPp1cS1Dgbsjhapz1PNw'],
  deleteBookmarkFolder: ['2UTTsO-6zs93XqlEUZPsSg'],
};

const FALLBACK = Object.fromEntries(Object.entries(CANDIDATES).map(([name, ids]) => [name, ids[0]]));

let cache = null;
let scanPromise = null;

function loadCache() {
  if (cache) return cache;
  cache = {};
  if (!existsSync(paths.queryIds)) return cache;
  try {
    const parsed = JSON.parse(readFileSync(paths.queryIds, 'utf8'));
    if (parsed && typeof parsed === 'object') cache = parsed;
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache() {
  try {
    writeFileSync(paths.queryIds, JSON.stringify(cache, null, 2));
  } catch {
  }
}

function envName(operationName) {
  return `X_QUERY_ID_${operationName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

async function fromRemotePlaceholder(operationName) {
  try {
    const res = await fetch(REMOTE_PLACEHOLDER, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const parsed = await res.json();
    const queryId = parsed?.[operationName]?.queryId;
    return typeof queryId === 'string' && queryId ? queryId : null;
  } catch {
    return null;
  }
}

function collectBundle(text, found) {
  for (const m of text.matchAll(/queryId\s*:\s*"([A-Za-z0-9_-]{8,})"[\s\S]{0,600}?operationName\s*:\s*"([A-Za-z0-9_]+)"/g)) {
    found[m[2]] = m[1];
  }
  for (const m of text.matchAll(/operationName\s*:\s*"([A-Za-z0-9_]+)"[\s\S]{0,600}?queryId\s*:\s*"([A-Za-z0-9_-]{8,})"/g)) {
    if (!found[m[1]]) found[m[1]] = m[2];
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': userAgent, accept: '*/*' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return '';
  return res.text();
}

async function scanBundles() {
  const store = loadCache();
  if (Date.now() - (store.__scannedAt ?? 0) < TTL_MS) return {};

  if (!scanPromise) {
    scanPromise = (async () => {
      const found = {};
      try {
        const html = await fetchText(JF_URL);
        const urls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((src) => src.split('?')[0].endsWith('.js'))
          .slice(0, 8)
          .map((src) => new URL(src, 'https://x.com').href);
        for (const url of urls) {
          const js = await fetchText(url);
          if (js) collectBundle(js, found);
        }
      } catch {
      }

      if (Object.keys(found).length) {
        const target = loadCache();
        for (const [name, queryId] of Object.entries(found)) {
          if (!target[name]?.queryId) target[name] = { queryId, at: Date.now() };
        }
        target.__scannedAt = Date.now();
        saveCache();
      }
      return found;
    })().finally(() => {
      scanPromise = null;
    });
  }
  return scanPromise;
}

export function invalidateQueryId(operationName) {
  const store = loadCache();
  delete store[operationName];
  delete store.__scannedAt;
  saveCache();
}

export function candidatesFor(operationName) {
  return CANDIDATES[operationName] ?? (FALLBACK[operationName] ? [FALLBACK[operationName]] : []);
}

export function rememberQueryId(operationName, queryId) {
  const store = loadCache();
  store[operationName] = { queryId, at: Date.now() };
  saveCache();
}

export async function getQueryId(operationName, { fresh = false } = {}) {
  const override = process.env[envName(operationName)];
  if (override) return override;

  const store = loadCache();
  const cached = store[operationName];
  if (!fresh && cached?.queryId && Date.now() - (cached.at ?? 0) < TTL_MS) return cached.queryId;

  const remote = await fromRemotePlaceholder(operationName);
  if (remote) {
    store[operationName] = { queryId: remote, at: Date.now() };
    saveCache();
    return remote;
  }

  const scanned = await scanBundles();
  if (scanned[operationName]) {
    store[operationName] = { queryId: scanned[operationName], at: Date.now() };
    saveCache();
    return scanned[operationName];
  }

  if (cached?.queryId) return cached.queryId;

  const fallback = FALLBACK[operationName];
  if (fallback) {
    store[operationName] = { queryId: fallback, at: Date.now() };
    saveCache();
    return fallback;
  }

  throw new XAccessError(`Could not resolve a GraphQL query id for ${operationName}.`, {
    hint: `Set ${envName(operationName)} in .env to the current id from an x.com network request.`,
  });
}
