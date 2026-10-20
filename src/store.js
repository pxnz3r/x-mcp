import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { paths } from './config.js';

function emptyStore() {
  return { version: 2, updatedAt: null, foldersUpdatedAt: null, account: null, folders: {}, items: {} };
}

export function loadStore() {
  if (!existsSync(paths.store)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(paths.store, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.items !== 'object') return emptyStore();
    const store = { ...emptyStore(), ...parsed };
    if (!store.folders || typeof store.folders !== 'object') store.folders = {};
    return store;
  } catch {
    return emptyStore();
  }
}

export function saveStore(store) {
  store.updatedAt = new Date().toISOString();
  const tmp = `${paths.store}.tmp`;
  writeFileSync(tmp, JSON.stringify(store));
  renameSync(tmp, paths.store);
}

export function upsertItems(store, items) {
  const now = new Date().toISOString();
  let added = 0;
  let refreshed = 0;

  for (const item of items) {
    const previous = store.items[item.id];
    if (previous) {
      store.items[item.id] = {
        ...previous,
        ...item,
        folderIds: item.folderIds ?? previous.folderIds ?? [],
        tags: item.tags ?? previous.tags ?? [],
        firstSeenAt: previous.firstSeenAt ?? now,
        lastSeenAt: now,
      };
      refreshed += 1;
    } else {
      store.items[item.id] = {
        ...item,
        folderIds: item.folderIds ?? [],
        tags: item.tags ?? [],
        firstSeenAt: now,
        lastSeenAt: now,
      };
      added += 1;
    }
  }

  return { added, refreshed };
}

export function upsertFolders(store, folders) {
  const now = new Date().toISOString();
  for (const folder of folders) {
    store.folders[folder.id] = { ...store.folders[folder.id], ...folder, updatedAt: now };
  }
  store.foldersUpdatedAt = now;
}

export function replaceFolderMembership(store, folderId, ids, { complete = false } = {}) {
  if (complete) {
    for (const item of Object.values(store.items)) {
      if (item.folderIds?.includes(folderId)) {
        item.folderIds = item.folderIds.filter((id) => id !== folderId);
      }
    }
  }

  for (const id of ids) {
    const item = store.items[id];
    if (!item) continue;
    const set = new Set(item.folderIds ?? []);
    set.add(folderId);
    item.folderIds = [...set];
  }
}

export function moveToFolderLocally(store, tweetId, folderId) {
  const item = store.items[tweetId];
  if (!item) return;
  const local = (item.folderIds ?? []).filter((id) => store.folders[id]?.kind === 'local');
  item.folderIds = folderId ? [...new Set([...local, folderId])] : local;
}

export function ensureLocalFolder(store, path) {
  const segments = String(path ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return null;

  let parentId = null;
  let folder = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const existing = Object.values(store.folders).find(
      (entry) =>
        entry.kind === 'local' &&
        (entry.parentId ?? null) === parentId &&
        (entry.name ?? '').toLowerCase() === segment.toLowerCase(),
    );

    if (existing) {
      folder = existing;
      parentId = existing.id;
      continue;
    }

    const slug = segments
      .slice(0, index + 1)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    let id = `local:${slug || 'folder'}`;
    let suffix = 2;
    while (store.folders[id]) {
      id = `local:${slug}-${suffix}`;
      suffix += 1;
    }

    folder = {
      id,
      name: segment,
      kind: 'local',
      parentId,
      createdAt: new Date().toISOString(),
    };
    store.folders[id] = folder;
    parentId = id;
  }

  return folder;
}

export function folderPath(store, folderId) {
  const parts = [];
  let cursor = store.folders[folderId];
  let guard = 0;
  while (cursor && guard < 32) {
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? store.folders[cursor.parentId] : null;
    guard += 1;
  }
  return parts.join('/');
}

export function descendantFolderIds(store, folderId) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of Object.values(store.folders)) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function addFolderMembership(store, folderId, ids) {
  const changed = [];
  for (const id of ids) {
    const item = store.items[id];
    if (!item) continue;
    const set = new Set(item.folderIds ?? []);
    if (set.has(folderId)) continue;
    set.add(folderId);
    item.folderIds = [...set];
    changed.push(item.id);
  }
  return changed;
}

export function removeFolderMembership(store, folderId, ids) {
  const changed = [];
  for (const id of ids) {
    const item = store.items[id];
    if (!item?.folderIds?.includes(folderId)) continue;
    item.folderIds = item.folderIds.filter((entry) => entry !== folderId);
    changed.push(item.id);
  }
  return changed;
}

export function removeFolder(store, folderId) {
  delete store.folders[folderId];
  for (const item of Object.values(store.items)) {
    if (item.folderIds?.includes(folderId)) {
      item.folderIds = item.folderIds.filter((id) => id !== folderId);
    }
  }
}

export function findFolder(store, reference) {
  const raw = String(reference ?? '').trim();
  if (!raw) return null;
  if (store.folders[raw]) return store.folders[raw];

  const needle = raw.replace(/^@/, '').replace(/\s*\/\s*/g, '/').toLowerCase();
  const folders = Object.values(store.folders);
  const paths = new Map(folders.map((folder) => [folder.id, folderPath(store, folder.id).toLowerCase()]));

  return (
    folders.find((folder) => folder.id.toLowerCase() === needle) ??
    folders.find((folder) => (paths.get(folder.id) ?? '') === needle) ??
    folders.find((folder) => (folder.name ?? '').toLowerCase() === needle) ??
    folders.find((folder) => (paths.get(folder.id) ?? '').includes(needle)) ??
    null
  );
}

export function normalizeTag(tag) {
  return String(tag ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 40);
}

export function addTags(store, ids, tags) {
  const wanted = [...new Set(tags.map(normalizeTag).filter(Boolean))];
  const changed = [];
  for (const id of ids) {
    const item = store.items[id];
    if (!item) continue;
    const set = new Set(item.tags ?? []);
    const before = set.size;
    for (const tag of wanted) set.add(tag);
    if (set.size !== before) {
      item.tags = [...set];
      changed.push(item.id);
    }
  }
  return changed;
}

export function removeTags(store, ids, tags) {
  const unwanted = new Set(tags.map(normalizeTag).filter(Boolean));
  const changed = [];
  for (const id of ids) {
    const item = store.items[id];
    if (!item?.tags?.length) continue;
    const next = item.tags.filter((tag) => !unwanted.has(tag));
    if (next.length !== item.tags.length) {
      item.tags = next;
      changed.push(item.id);
    }
  }
  return changed;
}

export function tagCounts(store) {
  const counts = {};
  for (const item of Object.values(store.items)) {
    for (const tag of item.tags ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

export function folderCounts(store) {
  const counts = {};
  for (const item of Object.values(store.items)) {
    for (const id of item.folderIds ?? []) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export function allItems(store) {
  return Object.values(store.items).sort((a, b) => {
    const left = a.createdAt ?? '';
    const right = b.createdAt ?? '';
    if (left === right) return String(b.id).localeCompare(String(a.id));
    return right.localeCompare(left);
  });
}

function haystack(item) {
  return [
    item.text,
    item.author?.name,
    item.author?.username,
    item.quoted?.text,
    item.quoted?.author?.username,
    ...(item.hashtags ?? []),
    ...(item.tags ?? []),
    ...(item.links ?? []).map((link) => link.url),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function folderMatches(store, item, needle) {
  const target = findFolder(store, needle);
  if (target) {
    const allowed = descendantFolderIds(store, target.id);
    return (item.folderIds ?? []).some((id) => allowed.has(id));
  }
  return (item.folderIds ?? []).some((id) => {
    const folder = store.folders[id];
    return (folder?.name ?? '').toLowerCase().includes(needle);
  });
}

export function searchItems(store, { q, author, since, until, media, folder, tag, limit = 50 } = {}) {
  const terms = (q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const authorTerm = (author ?? '').replace(/^@/, '').toLowerCase();
  const folderTerm = String(folder ?? '').replace(/^@/, '').trim().toLowerCase();
  const tagTerm = normalizeTag(tag);
  const sinceTime = since ? Date.parse(since) : null;
  const untilTime = until ? Date.parse(until) : null;
  const mediaFilter = media === true ? 'any' : media;

  const results = [];
  for (const item of allItems(store)) {
    if (authorTerm) {
      const who = `${item.author?.username ?? ''} ${item.author?.name ?? ''}`.toLowerCase();
      if (!who.includes(authorTerm)) continue;
    }

    if (folderTerm && !folderMatches(store, item, folderTerm)) continue;

    if (tagTerm && !(item.tags ?? []).includes(tagTerm)) continue;

    if (mediaFilter) {
      if (!item.media?.length) continue;
      if (mediaFilter !== 'any' && !item.media.some((entry) => entry.type === mediaFilter)) continue;
    }

    if (sinceTime || untilTime) {
      const created = item.createdAt ? Date.parse(item.createdAt) : NaN;
      if (Number.isNaN(created)) continue;
      if (sinceTime && created < sinceTime) continue;
      if (untilTime && created > untilTime) continue;
    }

    if (terms.length) {
      const hay = haystack(item);
      if (!terms.every((term) => hay.includes(term))) continue;
    }

    results.push(item);
    if (results.length >= limit) break;
  }

  return results;
}
