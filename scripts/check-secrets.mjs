#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'data', '.vscode', '.idea', 'coverage']);
const IGNORED_FILES = new Set(['.env', 'auth.json', 'credentials.json', 'package-lock.json']);
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml', '.toml', '.example', '.gitignore', '.env', '',
]);
const MAX_BYTES = 2 * 1024 * 1024;

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) values[key] = value;
  }
  return values;
}

function loadSecrets() {
  const secrets = [];
  const envPath = path.join(root, '.env');
  if (existsSync(envPath)) {
    const env = parseEnv(readFileSync(envPath, 'utf8'));
    for (const key of ['X_AUTH_TOKEN', 'X_CT0', 'X_COOKIE', 'COBALT_API_KEY', 'X_BEARER']) {
      if (env[key] && env[key].length >= 8) secrets.push({ label: key, value: env[key] });
    }
    if (env.X_COOKIE) {
      for (const part of env.X_COOKIE.split(';')) {
        const value = part.split('=').slice(1).join('=').trim();
        if (value.length >= 8) secrets.push({ label: 'X_COOKIE part', value });
      }
    }
  }

  const authPath = path.join(root, 'auth.json');
  if (existsSync(authPath)) {
    try {
      const auth = JSON.parse(readFileSync(authPath, 'utf8'));
      for (const [key, value] of Object.entries(auth)) {
        if (typeof value === 'string' && value.length >= 8) secrets.push({ label: `auth.json:${key}`, value });
      }
    } catch {
    }
  }

  const storePath = path.join(root, 'data', 'bookmarks.json');
  if (existsSync(storePath)) {
    try {
      const store = JSON.parse(readFileSync(storePath, 'utf8'));
      for (const key of ['username', 'name']) {
        const value = store.account?.[key];
        if (typeof value === 'string' && value.length >= 3) secrets.push({ label: `account.${key}`, value });
      }
    } catch {
    }
  }

  const seen = new Set();
  return secrets.filter((entry) => {
    if (seen.has(entry.value)) return false;
    seen.add(entry.value);
    return true;
  });
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (IGNORED_FILES.has(entry.name)) continue;
    if (entry.name.startsWith('.env.') && entry.name !== '.env.example') continue;
    files.push(path.join(dir, entry.name));
  }
  return files;
}

function isText(file) {
  const ext = path.extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  try {
    return statSync(file).size <= MAX_BYTES;
  } catch {
    return false;
  }
}

const secrets = loadSecrets();
const files = walk(root).filter(isText);
const hits = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  for (const secret of secrets) {
    if (text.includes(secret.value)) hits.push(`${relative}: contains ${secret.label}`);
  }
  text.split(/\r?\n/).forEach((line, index) => {
    if (/auth_token=[0-9a-f]{30,}/i.test(line)) hits.push(`${relative}:${index + 1}: hardcoded auth_token`);
    if (/ct0=[0-9a-f]{30,}/i.test(line)) hits.push(`${relative}:${index + 1}: hardcoded ct0`);
  });
}

const gitignore = existsSync(path.join(root, '.gitignore')) ? readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
const requiredIgnores = ['.env', 'auth.json', 'data/'];
const missing = requiredIgnores.filter((entry) => !gitignore.split(/\r?\n/).some((line) => line.trim() === entry));
if (missing.length) hits.push(`.gitignore: missing ${missing.join(', ')}`);

if (hits.length) {
  console.error('Leak check failed. Do not publish until these are fixed:');
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(`\nChecked ${files.length} files against ${secrets.length} known secret or personal values.`);
  process.exit(1);
}

console.log(`Leak check passed: ${files.length} files, ${secrets.length} secret or personal values, none found.`);
