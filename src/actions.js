import { statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getAuth, paths } from './config.js';
import { cobaltCheck, cobaltResolve, downloadFile, exportFilenameHint, sanitizeFilename } from './cobalt.js';
import { XAccessError } from './errors.js';
import { toMarkdown } from './normalize.js';
import { MAX_WRITES_PER_CALL, describeSafety, mutationBudget, requireWrites, spendMutation } from './safety.js';
import {
  addFolderMembership,
  addTags,
  allItems,
  descendantFolderIds,
  ensureLocalFolder,
  findFolder,
  folderCounts,
  folderPath,
  loadStore,
  moveToFolderLocally,
  normalizeTag,
  removeFolder,
  removeFolderMembership,
  removeTags,
  replaceFolderMembership,
  saveStore,
  searchItems,
  tagCounts,
  upsertFolders,
  upsertItems,
} from './store.js';
import { enrichLinkPreviews } from './linkpreview.js';
import { localUrlFor } from './localurl.js';
import { getClient } from './x.js';

const MAX_PAGE = 100;
const PAGE_DELAY_MS = 400;
const FOLDER_TTL_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withLocalUrl(item) {
  if (!item?.id) return item;
  return { ...item, localUrl: localUrlFor(item.id) };
}

export async function whoami() {
  const user = await getClient().getViewer();
  const store = loadStore();
  store.account = user;
  saveStore(store);
  return user;
}

export async function doctor() {
  const checks = [];
  const describeError = (error) => (typeof error?.format === 'function' ? error.format() : String(error?.message ?? error));

  const auth = getAuth();
  checks.push({
    name: 'cookies',
    ok: Boolean(auth.authToken && auth.ct0),
    detail: auth.authToken && auth.ct0 ? `auth_token ${auth.authToken.length} chars, ct0 ${auth.ct0.length} chars` : 'missing',
  });
  if (!checks[0].ok) {
    return {
      ok: false,
      checks,
      hint: 'Copy auth_token and ct0 from DevTools > Application > Cookies > https://x.com into .env, then retry.',
    };
  }

  try {
    const user = await whoami();
    checks.push({ name: 'identity', ok: true, detail: `@${user.username} (${user.name}) id=${user.id}` });
  } catch (error) {
    checks.push({ name: 'identity', ok: false, detail: describeError(error) });
  }

  if (checks.at(-1).ok) {
    try {
      const page = await getClient().getBookmarksPage({ count: 2 });
      checks.push({
        name: 'bookmarks',
        ok: true,
        detail: `${page.items.length} post(s) in one page, next cursor ${page.nextCursor ? 'present' : 'absent'}`,
      });
    } catch (error) {
      checks.push({ name: 'bookmarks', ok: false, detail: describeError(error) });
    }
  }

  if (checks.at(-1)?.ok) {
    try {
      const { folders, xFoldersAvailable } = await foldersList({ refresh: true });
      const local = folders.filter((folder) => folder.kind === 'local').length;
      checks.push({
        name: 'folders',
        ok: true,
        detail: `${local} local folder(s), ${folders.length - local} X folder(s)${
          xFoldersAvailable ? '' : ' (X folders unavailable: Premium required)'
        }`,
      });
    } catch (error) {
      if (error?.code === 'FOLDERS_UNAVAILABLE') {
        checks.push({ name: 'folders', ok: true, detail: 'not available on this account (X Premium feature)' });
      } else {
        checks.push({ name: 'folders', ok: false, detail: describeError(error) });
      }
    }
  }

  const safety = describeSafety();
  checks.push({
    name: 'writes',
    ok: true,
    detail:
      (safety.writesEnabled
        ? `enabled, ${safety.mutationBudget.used}/${safety.mutationBudget.limit} used this hour, writes ${safety.writeGapSeconds}s apart`
        : 'disabled (reads only, set X_ALLOW_WRITES=true to allow filing posts)') +
      (safety.cooldownRemainingSeconds ? `, cooling down ${safety.cooldownRemainingSeconds}s` : ''),
  });

  try {
    const cobalt = await cobaltCheck();
    checks.push({ name: 'cobalt', ok: true, detail: cobalt.instance });
  } catch (error) {
    checks.push({ name: 'cobalt', ok: false, detail: describeError(error) });
  }

  const core = checks.filter((check) => ['cookies', 'identity', 'bookmarks'].includes(check.name));
  return { ok: core.every((check) => check.ok), checks };
}

export async function listBookmarks({ limit = 20, cursor = null, folder = null } = {}) {
  const store = loadStore();
  const client = getClient();
  const count = Math.min(Math.max(Number(limit) || 20, 1), MAX_PAGE);

  let page;
  let target = null;
  if (folder) {
    target = findFolder(store, folder);
    if (!target) {
      try {
        await refreshFolders(store);
      } catch (error) {
        if (error?.code !== 'FOLDERS_UNAVAILABLE') throw error;
      }
      target = findFolder(store, folder);
    }
    if (!target) {
      throw new XAccessError(`No bookmark folder matches "${folder}".`, {
        hint: 'Local folders are created automatically by folder_assign, or use folder_create. X folders need a Premium account.',
      });
    }

    if (target.kind === 'local') {
      const scope = descendantFolderIds(store, target.id);
      const items = allItems(store).filter((item) => (item.folderIds ?? []).some((id) => scope.has(id)));
      const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
      const pageItems = items.slice(offset, offset + count);
      const nextOffset = offset + pageItems.length;
      return {
        account: store.account?.username ?? null,
        folder: { id: target.id, name: target.name, kind: 'local', path: folderPath(store, target.id) },
        count: pageItems.length,
        nextCursor: nextOffset < items.length ? String(nextOffset) : null,
        items: pageItems.map(withLocalUrl),
      };
    }

    page = await client.getFolderPage({ folderId: target.id, cursor, count });
  } else {
    page = await client.getBookmarksPage({ cursor, count });
  }

  const items = page.items.slice(0, limit);
  upsertItems(store, items);
  if (target) replaceFolderMembership(store, target.id, items.map((item) => item.id), { complete: false });
  saveStore(store);

  return {
    account: store.account?.username ?? null,
    folder: target ? { id: target.id, name: target.name, kind: target.kind ?? 'x' } : null,
    count: items.length,
    nextCursor: page.nextCursor,
    items: items.map(withLocalUrl),
  };
}

export async function syncBookmarks({ maxPages = 50, pageSize = 20, incremental = true } = {}) {
  const client = getClient();
  const store = loadStore();
  const seenCursors = new Set();
  let cursor = null;
  let pages = 0;
  let added = 0;
  let refreshed = 0;
  let stoppedReason = null;

  while (pages < maxPages) {
    let page;
    try {
      page = await client.getBookmarksPage({ cursor, count: pageSize });
    } catch (error) {
      if (error?.status === 429) {
        stoppedReason = 'rate-limited';
        break;
      }
      if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH_FAILED') {
        stoppedReason = 'auth';
        break;
      }
      throw error;
    }

    const delta = upsertItems(store, page.items);
    added += delta.added;
    refreshed += delta.refreshed;
    pages += 1;
    saveStore(store);

    if (!page.nextCursor || page.items.length === 0 || seenCursors.has(page.nextCursor)) break;
    if (incremental && delta.added === 0) break;

    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
    await sleep(PAGE_DELAY_MS);
  }

  saveStore(store);

  return {
    pages,
    added,
    refreshed,
    incremental,
    total: Object.keys(store.items).length,
    syncedAt: store.updatedAt,
    stoppedEarly: pages >= maxPages,
    stoppedReason,
  };
}

export function searchBookmarks({ query, author, since, until, media, folder, tag, limit = 50 } = {}) {
  const store = loadStore();
  const items = searchItems(store, { q: query, author, since, until, media, folder, tag, limit });
  const cached = Object.keys(store.items).length;
  return {
    count: items.length,
    totalCached: cached,
    cachedAt: store.updatedAt,
    hint: cached === 0 ? 'The local cache is empty. Run bookmarks_sync (CLI: node src/cli.js sync) first.' : undefined,
    items: items.map(withLocalUrl),
  };
}

export async function getBookmark(id) {
  const key = String(id);
  const store = loadStore();
  if (store.items[key]) return withLocalUrl(store.items[key]);

  const item = await getClient().getTweet(key);
  if (!item) throw new XAccessError(`Post ${key} was not found or is not accessible.`);

  upsertItems(store, [item]);
  saveStore(store);
  return withLocalUrl(item);
}

async function refreshFolders(store) {
  const client = getClient();
  const seen = new Set();
  const collected = [];
  let cursor = null;

  for (let page = 0; page < 20; page += 1) {
    const result = await client.listFolders({ cursor });
    if (!result.valid) {
      throw new XAccessError('X returned an unexpected bookmark folder response.', {
        hint: 'Bookmark folders are an X Premium feature, and the BookmarkFoldersSlice operation may have changed. Set X_QUERY_ID_BOOKMARK_FOLDERS_SLICE if you have a current id.',
      });
    }
    collected.push(...result.folders);
    if (!result.nextCursor || seen.has(result.nextCursor)) break;
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  upsertFolders(store, collected.map((folder) => ({ ...folder, kind: 'x' })));
  store.xFoldersAvailable = true;
  saveStore(store);
  return collected;
}

async function syncFolderContents(store, { maxPagesPerFolder = 25 } = {}) {
  const client = getClient();
  const summary = [];

  for (const folder of Object.values(store.folders)) {
    if (folder.kind === 'local') continue;
    const seen = new Set();
    const ids = [];
    let cursor = null;
    let pages = 0;
    let complete = false;

    while (pages < maxPagesPerFolder) {
      const page = await client.getFolderPage({ folderId: folder.id, cursor });
      upsertItems(store, page.items);
      ids.push(...page.items.map((item) => item.id));
      pages += 1;

      if (!page.nextCursor || page.items.length === 0 || seen.has(page.nextCursor)) {
        complete = true;
        break;
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
      await sleep(PAGE_DELAY_MS);
    }

    replaceFolderMembership(store, folder.id, ids, { complete });
    saveStore(store);
    summary.push({ id: folder.id, name: folder.name, bookmarks: ids.length, pages, complete });
  }

  return summary;
}

export async function foldersList({ refresh = false, syncContents = false } = {}) {
  const store = loadStore();
  const age = store.foldersUpdatedAt ? Date.now() - Date.parse(store.foldersUpdatedAt) : Infinity;
  const skippedX = store.xFoldersAvailable === false;

  if (!skippedX && (refresh || age > FOLDER_TTL_MS)) {
    try {
      await refreshFolders(store);
    } catch (error) {
      if (error?.code !== 'FOLDERS_UNAVAILABLE') throw error;
      store.xFoldersAvailable = false;
      saveStore(store);
    }
  }

  const synced = syncContents && store.xFoldersAvailable !== false ? await syncFolderContents(store) : null;
  const counts = folderCounts(store);
  const folders = Object.values(store.folders)
    .map((folder) => {
      const scope = descendantFolderIds(store, folder.id);
      let totalBookmarks = 0;
      for (const id of scope) totalBookmarks += counts[id] ?? 0;
      return {
        id: folder.id,
        name: folder.name,
        kind: folder.kind ?? 'x',
        parentId: folder.parentId ?? null,
        path: folderPath(store, folder.id),
        cachedBookmarks: counts[folder.id] ?? 0,
        totalBookmarks,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    folders,
    tags: Object.entries(tagCounts(store))
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count })),
    xFoldersAvailable: store.xFoldersAvailable !== false,
    cachedAt: store.foldersUpdatedAt,
    synced,
    safety: describeSafety(),
  };
}

export async function assignToFolder({ ids, folder, confirm = false, dryRun = false, scope = 'local', remove = false } = {}) {
  const requested = [...new Set((ids ?? []).map(String).filter(Boolean))];
  if (requested.length === 0) throw new XAccessError('No post ids were given.');

  const useX = scope === 'x';
  const cap = useX ? MAX_WRITES_PER_CALL : 500;
  if (requested.length > cap) {
    throw new XAccessError(`Too many posts in one call (${requested.length}).`, {
      hint: useX
        ? `The X write cap is ${cap} per call to avoid bursts that look automated. Split the batch.`
        : `The local cap is ${cap} per call. Split the batch.`,
    });
  }

  const store = loadStore();
  let target = findFolder(store, folder);

  if (!target && useX) {
    try {
      await refreshFolders(store);
    } catch (error) {
      if (error?.code !== 'FOLDERS_UNAVAILABLE') throw error;
    }
    target = findFolder(store, folder);
    if (!target) {
      throw new XAccessError(`No X bookmark folder matches "${folder}".`, {
        hint: 'Run folders_list to see the available X folders, or use folder_create with scope="x".',
      });
    }
  }

  if (!target) {
    const clean = String(folder ?? '').trim();
    if (!clean) throw new XAccessError('Folder name is empty.');
    target = ensureLocalFolder(store, clean);
  }

  if ((target.kind ?? 'x') === 'local') {
    const known = requested.filter((id) => store.items[id]);
    const missing = requested.filter((id) => !store.items[id]);
    const changed = remove
      ? removeFolderMembership(store, target.id, known)
      : addFolderMembership(store, target.id, known);
    saveStore(store);

    return {
      kind: 'local',
      folder: { id: target.id, name: target.name, kind: 'local', path: folderPath(store, target.id) },
      action: remove ? 'removed' : 'added',
      changed,
      mixed: requested.filter((id) => !changed.includes(id) && !missing.includes(id)),
      missing,
      cachedBookmarks: folderCounts(store)[target.id] ?? 0,
      note: missing.length
        ? 'Posts not in the local cache were skipped. Run bookmarks_sync (or bookmarks_list) first, then assign again.'
        : undefined,
    };
  }

  const preview = requested.map((id) => {
    const item = store.items[id];
    const folderIds = item?.folderIds ?? [];
    return {
      id,
      text: item?.text ? item.text.slice(0, 100) : null,
      author: item?.author?.username ?? null,
      currentFolders: folderIds.map((folderId) => store.folders[folderId]?.name ?? folderId),
      alreadyInFolder: folderIds.includes(target.id),
    };
  });

  const writesEnabled = process.env.X_ALLOW_WRITES === 'true';
  const plan = {
    folder: { id: target.id, name: target.name },
    count: requested.length,
    preview,
    budget: mutationBudget(),
  };

  if (dryRun || !confirm || !writesEnabled) {
    return {
      confirmationRequired: true,
      writesEnabled,
      hint: writesEnabled
        ? 'Nothing changed. Call again with confirm=true to move these bookmarks.'
        : 'Nothing changed. Set X_ALLOW_WRITES=true in .env to allow folder writes.',
      ...plan,
    };
  }

  requireWrites();

  const pending = preview.filter((entry) => !entry.alreadyInFolder);
  const budget = mutationBudget();
  if (budget.remaining < pending.length) {
    throw new XAccessError(`Write budget too low for this call (${budget.remaining} left, ${pending.length} needed).`, {
      hint: `The budget is ${budget.limit} writes per hour. Wait, or lower the batch size.`,
    });
  }

  const moved = [];
  const skipped = [];
  const failed = [];

  for (const entry of preview) {
    if (entry.alreadyInFolder) {
      skipped.push(entry.id);
      continue;
    }
    try {
      spendMutation();
      await getClient().addToFolder(entry.id, target.id);
      moveToFolderLocally(store, entry.id, target.id);
      saveStore(store);
      moved.push(entry.id);
    } catch (error) {
      failed.push({ id: entry.id, error: error instanceof XAccessError ? error.format() : String(error) });
      if (error?.status === 401 || error?.status === 403 || error?.status === 429) break;
    }
  }

  return {
    folder: { id: target.id, name: target.name },
    moved,
    skipped,
    failed,
    safety: describeSafety(),
  };
}

export async function createFolder({ name, confirm = false, scope = 'local' } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new XAccessError('Folder name is empty.');
  if (clean.length > 100) throw new XAccessError('Folder name is too long (max 100 characters).');

  if (scope !== 'x') {
    const store = loadStore();
    const existing = findFolder(store, clean);
    const folder = ensureLocalFolder(store, clean);
    if (!folder) throw new XAccessError('Folder name is empty.');
    saveStore(store);
    return {
      kind: 'local',
      created: { ...folder, path: folderPath(store, folder.id) },
      existed: Boolean(existing && existing.id === folder.id),
      folders: Object.values(store.folders)
        .map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind ?? 'x', path: folderPath(store, entry.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  const writesEnabled = process.env.X_ALLOW_WRITES === 'true';
  if (!writesEnabled || !confirm) {
    return {
      confirmationRequired: true,
      writesEnabled,
      folderName: clean,
      hint: writesEnabled
        ? 'Nothing created. Call again with confirm=true.'
        : 'Nothing created. Set X_ALLOW_WRITES=true in .env to allow folder writes.',
    };
  }

  requireWrites();
  spendMutation();
  const result = await getClient().createFolder(clean);

  const store = loadStore();
  await refreshFolders(store);
  const created = Object.values(store.folders).find((folder) => folder.name.toLowerCase() === clean.toLowerCase());

  return {
    created: created ?? { name: clean, raw: result },
    folders: Object.values(store.folders).map((folder) => ({ id: folder.id, name: folder.name })),
    safety: describeSafety(),
  };
}

export function tagBookmarks({ ids, tags, remove = false } = {}) {
  const requested = [...new Set((ids ?? []).map(String).filter(Boolean))];
  const wanted = [...new Set((tags ?? []).map(normalizeTag).filter(Boolean))];
  if (!requested.length) throw new XAccessError('No post ids were given.');
  if (!wanted.length) throw new XAccessError('No tags were given.');

  const store = loadStore();
  const known = requested.filter((id) => store.items[id]);
  const missing = requested.filter((id) => !store.items[id]);
  const changed = remove ? removeTags(store, known, wanted) : addTags(store, known, wanted);
  saveStore(store);

  return {
    action: remove ? 'removed' : 'added',
    tags: wanted,
    changed,
    mixed: requested.filter((id) => !changed.includes(id) && !missing.includes(id)),
    missing,
    allTags: Object.entries(tagCounts(store))
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count })),
  };
}

export function tagsList() {
  const store = loadStore();
  return {
    tags: Object.entries(tagCounts(store))
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count })),
    cached: Object.keys(store.items).length,
  };
}

export function deleteLocalFolder({ folder } = {}) {
  const store = loadStore();
  const target = findFolder(store, folder);
  if (!target) {
    throw new XAccessError(`No folder matches "${folder}".`, {
      hint: 'Run folders_list to see the current folders.',
    });
  }
  if ((target.kind ?? 'x') !== 'local') {
    throw new XAccessError('This tool only deletes local folders.', {
      hint: 'X folders are deleted on x.com. Assigning an X post elsewhere moves it.',
    });
  }

  const scope = descendantFolderIds(store, target.id);
  const deleted = [...scope].map((id) => ({ id, path: folderPath(store, id) }));
  for (const id of scope) removeFolder(store, id);
  saveStore(store);

  return {
    deleted: { id: target.id, name: target.name, path: folderPath(store, target.id) || target.name, folders: deleted },
    folders: Object.values(store.folders)
      .map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind ?? 'x', path: folderPath(store, entry.id) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function resolveMedia({ tweetId, index = null } = {}) {
  const item = await getBookmark(tweetId);
  if (!item.media?.length) throw new XAccessError(`Post ${item.id} has no media.`);

  const indexes = index == null ? item.media.map((_, i) => i) : [Number(index)];
  const media = [];

  for (const i of indexes) {
    const entry = item.media[i];
    if (!entry) throw new XAccessError(`No media at index ${i}. This post has ${item.media.length} item(s).`);

    if (entry.type === 'photo') {
      media.push({
        index: i,
        type: 'photo',
        source: entry.url,
        url: entry.url,
        filename: exportFilenameHint(entry.url, 'photo'),
        alt: entry.alt,
      });
      continue;
    }

    const resolved = await cobaltResolve(item.url ?? entry.url);
    media.push({
      index: i,
      type: entry.type,
      source: entry.url,
      url: resolved.url,
      filename: resolved.filename ?? exportFilenameHint(resolved.url, entry.type),
      alt: entry.alt,
    });
  }

  return { id: item.id, url: item.url, media };
}

export async function downloadMedia({ tweetId, index = null, outDir = paths.mediaDir } = {}) {
  const resolved = await resolveMedia({ tweetId, index });
  const dir = path.join(outDir, resolved.id);
  const saved = [];

  for (const entry of resolved.media) {
    const name = sanitizeFilename(entry.filename ?? exportFilenameHint(entry.url, entry.type));
    const dest = path.join(dir, `${String(entry.index).padStart(2, '0')}-${name}`);
    await downloadFile(entry.url, dest);
    saved.push({ path: dest, type: entry.type, bytes: statSync(dest).size, source: entry.source });
  }

  return { id: resolved.id, dir, saved };
}

export async function exportBookmarks({ format = 'markdown', out = null } = {}) {
  const store = loadStore();
  const items = allItems(store);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = out ?? path.join(paths.dataDir, `bookmarks-${stamp}.${format === 'json' ? 'json' : 'md'}`);

  await mkdir(path.dirname(target), { recursive: true });

  if (format === 'json') {
    await writeFile(
      target,
      JSON.stringify(
        { exportedAt: new Date().toISOString(), account: store.account, folders: store.folders, count: items.length, items },
        null,
        2,
      ),
    );
  } else {
    const header = [
      `# X bookmarks (${items.length})`,
      '',
      `Exported ${new Date().toISOString()}`,
      store.account?.username ? `Account: @${store.account.username}` : '',
      '',
    ].filter(Boolean);
    const body = items.map((item) =>
      toMarkdown(
        item,
        (item.folderIds ?? []).map((folderId) => folderPath(store, folderId) || folderId).filter(Boolean),
        item.tags ?? [],
      ),
    );
    await writeFile(target, `${header.join('\n')}\n${body.join('\n')}`);
  }

  return { path: target, count: items.length, format: format === 'json' ? 'json' : 'markdown' };
}

export { cobaltCheck };

export async function enrichLinks({ limit = 400, refresh = false, onProgress = null } = {}) {
  const store = loadStore();
  const urls = new Set();
  for (const item of Object.values(store.items)) {
    for (const link of item.links ?? []) if (link?.url) urls.add(link.url);
  }

  const { results, checked, found, queued, cached } = await enrichLinkPreviews([...urls], { limit, refresh, onProgress });
  let updated = 0;
  for (const item of Object.values(store.items)) {
    for (const link of item.links ?? []) {
      const hit = results.get(link.url);
      if (!hit || (!hit.image && !hit.title)) continue;
      if (link.preview !== (hit.image ?? null) || link.title !== (hit.title ?? null)) updated += 1;
      link.preview = hit.image ?? null;
      link.title = hit.title ?? null;
      link.description = hit.description ?? null;
      link.site = hit.site ?? null;
    }
  }

  saveStore(store);
  return { links: urls.size, checked, found, queued, cached, updated };
}
