import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getCobalt, userAgent } from './config.js';
import { COBALT_HINT, XAccessError } from './errors.js';

function cobaltHeaders() {
  const { apiKey } = getCobalt();
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Api-Key ${apiKey}`;
  return headers;
}

export async function cobaltResolve(url, { quality = 'max' } = {}) {
  const { url: base } = getCobalt();
  const body = {
    url,
    videoQuality: quality,
    downloadMode: 'auto',
    filenameStyle: 'basic',
  };

  let res;
  try {
    res = await fetch(`${base}/`, {
      method: 'POST',
      headers: cobaltHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    throw new XAccessError(`Could not reach cobalt at ${base}: ${err.message}`, { hint: COBALT_HINT });
  }

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new XAccessError(`cobalt returned a non-JSON response (${res.status}).`, {
      status: res.status,
      hint: `${text.slice(0, 200)} ${COBALT_HINT}`,
    });
  }

  switch (payload.status) {
    case 'tunnel':
    case 'redirect':
      return { url: payload.url, filename: payload.filename ?? null, status: payload.status };
    case 'picker':
      throw new XAccessError('cobalt needs one specific item from this post.', {
        hint: JSON.stringify(payload.picker?.slice(0, 10) ?? payload).slice(0, 500),
      });
    case 'local-processing':
      throw new XAccessError('This cobalt instance requires local processing (ffmpeg missing).', {
        hint: COBALT_HINT,
      });
    case 'error':
    default:
      throw new XAccessError(`cobalt error: ${payload.error?.code ?? payload.status ?? res.status}`, {
        status: res.status,
        hint: payload.error?.code === 'api.auth' ? 'This instance needs COBALT_API_KEY.' : COBALT_HINT,
      });
  }
}

export function sanitizeFilename(name, fallback = 'file') {
  const cleaned = String(name || '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function filenameFromUrl(url, fallback) {
  try {
    const base = path.basename(new URL(url).pathname);
    return sanitizeFilename(base, fallback);
  } catch {
    return fallback;
  }
}

export async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: { 'user-agent': userAgent, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok || !res.body) {
    throw new XAccessError(`Download failed (${res.status}) for ${url}`, { status: res.status });
  }

  await mkdir(path.dirname(destPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  return destPath;
}

export async function cobaltCheck() {
  const { url: base } = getCobalt();
  let res;
  try {
    res = await fetch(`${base}/`, { headers: cobaltHeaders(), signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new XAccessError(`Could not reach cobalt at ${base}: ${err.message}`, { hint: COBALT_HINT });
  }
  if (!res.ok) {
    throw new XAccessError(`cobalt instance answered ${res.status} at ${base}.`, { hint: COBALT_HINT });
  }
  const text = await res.text();
  try {
    return { instance: base, info: JSON.parse(text) };
  } catch {
    return { instance: base, info: text.slice(0, 300) };
  }
}

export function exportFilenameHint(url, type) {
  const fallback = type === 'photo' ? 'image.jpg' : type === 'gif' ? 'animation.gif' : 'video.mp4';
  return filenameFromUrl(url, fallback);
}
