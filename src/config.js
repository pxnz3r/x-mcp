import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { AUTH_HINT, XAccessError } from './errors.js';

export const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
}

export const paths = {
  dataDir: path.join(rootDir, 'data'),
  store: path.join(rootDir, 'data', 'bookmarks.json'),
  queryIds: path.join(rootDir, 'data', 'queryids.json'),
  mediaDir: path.join(rootDir, 'data', 'media'),
};

mkdirSync(paths.dataDir, { recursive: true });

export const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const webBearer =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export function bearerToken() {
  return process.env.X_BEARER || webBearer;
}

function parseCookieString(raw) {
  const out = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function readAuthFile() {
  const candidates = [
    process.env.X_AUTH_FILE,
    path.join(rootDir, 'auth.json'),
    path.join(os.homedir(), '.config', 'x-access', 'auth.json'),
  ].filter(Boolean);

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      return { ...JSON.parse(readFileSync(file, 'utf8')), source: file };
    } catch (err) {
      throw new XAccessError(`Could not parse auth file ${file}: ${err.message}`, { hint: AUTH_HINT });
    }
  }
  return {};
}

export function getAuth() {
  const file = readAuthFile();

  let authToken = process.env.X_AUTH_TOKEN || file.auth_token || file.authToken || '';
  let ct0 = process.env.X_CT0 || file.ct0 || '';

  const cookieHeader = process.env.X_COOKIE || file.cookie || file.cookies;
  if (cookieHeader) {
    const parsed = parseCookieString(cookieHeader);
    authToken = authToken || parsed.auth_token || '';
    ct0 = ct0 || parsed.ct0 || '';
  }

  const fromEnv = Boolean(process.env.X_AUTH_TOKEN || process.env.X_CT0 || process.env.X_COOKIE);

  return {
    authToken: authToken.trim(),
    ct0: ct0.trim(),
    source: fromEnv ? 'environment' : (file.source ?? null),
  };
}

export function requireAuth() {
  const auth = getAuth();
  if (!auth.authToken || !auth.ct0) {
    const missing = [!auth.authToken && 'auth_token', !auth.ct0 && 'ct0'].filter(Boolean).join(' and ');
    throw new XAccessError(`Missing ${missing}.`, { hint: AUTH_HINT });
  }
  return auth;
}

export function getCobalt() {
  return {
    url: (process.env.COBALT_API_URL || 'https://api.cobalt.tools').replace(/\/+$/, ''),
    apiKey: process.env.COBALT_API_KEY || '',
  };
}
