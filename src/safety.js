import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { XAccessError } from './errors.js';

const statePath = path.join(paths.dataDir, 'rate.json');
const READ_GAP_MS = 900;
const WRITE_GAP_MS = 6000;
const READ_JITTER_MS = 400;
const WRITE_JITTER_MS = 3000;
const COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_WRITE_BUDGET = 30;

let state = null;
let lastRequestAt = 0;
let tail = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (max) => Math.floor(Math.random() * max);

function loadState() {
  if (state) return state;
  state = { cooldownUntil: 0, mutations: [] };
  try {
    if (existsSync(statePath)) {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        state.cooldownUntil = Number(parsed.cooldownUntil) || 0;
        state.mutations = Array.isArray(parsed.mutations) ? parsed.mutations.filter(Number.isFinite) : [];
      }
    }
  } catch {
  }
  return state;
}

function saveState() {
  const target = loadState();
  try {
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(target));
    renameSync(tmp, statePath);
  } catch {
  }
}

export function writeBudgetPerHour() {
  const configured = Number(process.env.X_MAX_WRITES_PER_HOUR);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WRITE_BUDGET;
}

export const MAX_WRITES_PER_CALL = 25;

export function requireWrites() {
  if (process.env.X_ALLOW_WRITES !== 'true') {
    throw new XAccessError('Writes are disabled.', {
      hint: 'Folder changes are off by default to protect the account. Set X_ALLOW_WRITES=true in .env, then pass confirm=true on each write.',
    });
  }
}

export function cooldownRemainingMs() {
  return Math.max(0, (loadState().cooldownUntil ?? 0) - Date.now());
}

export function noteRateLimit(seconds = COOLDOWN_MS / 1000) {
  const target = loadState();
  const waitMs = Math.max(60, Math.min(Number(seconds) || 0, 3600)) * 1000;
  target.cooldownUntil = Date.now() + waitMs;
  saveState();
  return target.cooldownUntil;
}

function budgetUsed() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const target = loadState();
  target.mutations = target.mutations.filter((at) => at > cutoff);
  return target.mutations.length;
}

export function mutationBudget() {
  const used = budgetUsed();
  return { used, limit: writeBudgetPerHour(), remaining: Math.max(0, writeBudgetPerHour() - used) };
}

export function spendMutation(count = 1) {
  const available = mutationBudget();
  if (available.remaining < count) {
    throw new XAccessError(`Local write budget reached (${available.used}/${available.limit} in the last hour).`, {
      hint: 'This cap keeps automated writes from looking abusive. Raise X_MAX_WRITES_PER_HOUR if you really need more, or wait.',
    });
  }
  const target = loadState();
  const now = Date.now();
  for (let i = 0; i < count; i += 1) target.mutations.push(now);
  saveState();
}

export function describeSafety() {
  const budget = mutationBudget();
  return {
    writesEnabled: process.env.X_ALLOW_WRITES === 'true',
    readsPerSecond: 1,
    writeGapSeconds: WRITE_GAP_MS / 1000,
    cooldownRemainingSeconds: Math.ceil(cooldownRemainingMs() / 1000),
    mutationBudget: budget,
    maxWritesPerCall: MAX_WRITES_PER_CALL,
  };
}

export function schedule(kind, task) {
  const job = tail.then(async () => {
    const pausedFor = cooldownRemainingMs();
    if (pausedFor > 0) {
      throw new XAccessError(`Requests are paused after a rate limit for another ${Math.ceil(pausedFor / 1000)}s.`, {
        hint: 'This cooldown is shared by every tool so a burst cannot turn into a flagged account. Just wait it out.',
      });
    }

    const gap = kind === 'write'
      ? WRITE_GAP_MS + jitter(WRITE_JITTER_MS)
      : READ_GAP_MS + jitter(READ_JITTER_MS);
    const wait = lastRequestAt + gap - Date.now();
    if (wait > 0) await sleep(wait);

    lastRequestAt = Date.now();
    return task();
  });

  tail = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

export async function backoff(attempt) {
  await sleep(1200 * 2 ** (attempt - 1) + jitter(700));
}
