import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { localUrlFor } from './localurl.js';
import { allItems, folderPath, loadStore, tagCounts } from './store.js';

const PAGE_CSS = readFileSync(new URL('./viewer/page.css', import.meta.url), 'utf8');
const PAGE_JS = readFileSync(new URL('./viewer/page.js', import.meta.url), 'utf8');

function postData(post) {
  return {
    id: post.id ?? null,
    username: post.author?.username ?? null,
    name: post.author?.name ?? null,
    createdAt: post.createdAt ?? null,
    text: post.text ?? '',
    url: post.url ?? null,
    likes: post.likes ?? 0,
    media: (post.media ?? []).map((entry) => ({ type: entry.type, url: entry.url, preview: entry.preview ?? null, alt: entry.alt ?? null })),
    links: (post.links ?? []).map((link) => ({ url: link.url, display: link.display ?? link.url })),
    inReplyTo: post.inReplyTo ? { username: post.inReplyTo.author?.username ?? null, text: post.inReplyTo.text ?? '' } : null,
  };
}

function conversationData(convo) {
  if (!convo) return {};
  return {
    above: convo.above.map(postData),
    thread: convo.thread.map(postData),
    authorReplies: convo.authorReplies.map(postData),
    replies: convo.replies.map(postData),
  };
}

function articleData(article) {
  if (!article) return null;
  return { title: article.title, url: article.url, cover: article.cover, text: article.markdown ?? article.preview ?? '' };
}

function buildData(store, viewerPath) {
  const folders = Object.values(store.folders)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      kind: folder.kind ?? 'x',
      path: folderPath(store, folder.id),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const items = allItems(store).map((item) => ({
    id: item.id,
    localUrl: localUrlFor(item.id, viewerPath),
    author: { username: item.author?.username ?? null, name: item.author?.name ?? null, avatar: item.author?.avatar ?? null },
    text: item.text ?? '',
    createdAt: item.createdAt ?? null,
    url: item.url ?? null,
    media: (item.media ?? []).map((entry) => ({
      type: entry.type,
      url: entry.url,
      preview: entry.preview ?? null,
      alt: entry.alt ?? null,
    })),
    links: (item.links ?? []).map((link) => ({
      url: link.url,
      display: link.display ?? link.url,
      title: link.title ?? null,
      description: link.description ?? null,
      site: link.site ?? null,
      preview: link.preview ?? null,
    })),
    quoted: item.quoted ? { username: item.quoted.author?.username ?? null, text: item.quoted.text ?? '' } : null,
    article: articleData(item.article ?? item.quoted?.article),
    ...conversationData(item.expanded?.conversation),
    folderIds: item.folderIds ?? [],
    tags: item.tags ?? [],
  }));

  return {
    generatedAt: new Date().toISOString(),
    account: store.account?.username ?? null,
    folders,
    tags: Object.entries(tagCounts(store))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count })),
    items,
  };
}

const X_LOGO =
  '<svg class="xlogo" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>';
const MENU_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';
const SEARCH_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';

function builtLabel(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function pageHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>X bookmarks${data.account ? ` (@${data.account})` : ''}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="app" id="app">
<aside id="side" aria-label="Folders and tags">
  <h1>${X_LOGO}bookmarks</h1>
  <nav class="group" aria-labelledby="h-folders"><h2 id="h-folders">Folders</h2><div id="folders"></div></nav>
  <section class="group" id="tags-group" aria-labelledby="h-tags"><h2 id="h-tags">Tags</h2><div id="tags" class="chips"></div></section>
  <p class="built">Built ${builtLabel(data.generatedAt)}</p>
</aside>
<main class="feed">
  <div class="bar">
    <button id="side-open" class="ibtn only-narrow" type="button" aria-label="Folders and tags">${MENU_ICON}</button>
    <label class="search">${SEARCH_ICON}<input id="search" type="search" placeholder="Search bookmarks" aria-label="Search bookmarks" autocomplete="off"><kbd>/</kbd></label>
    <select id="sort" aria-label="Sort">
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="author">Author</option>
    </select>
    <button id="media" class="pill" type="button" aria-pressed="false">Media</button>
  </div>
  <div id="status" class="status" hidden></div>
  <div id="list" role="listbox" aria-label="Bookmarks"></div>
  <div id="more" aria-hidden="true"></div>
</main>
<section id="reader" class="reader" aria-label="Post" tabindex="-1"></section>
</div>
<div id="scrim" class="scrim"></div>
<div id="lb" class="lb" hidden></div>
<script type="application/json" id="data">${json}</script>
<script>${PAGE_JS}</script>
</body>
</html>
`;
}

export function viewBookmarks({ out = null } = {}) {
  const store = loadStore();
  const target = out ?? path.join(paths.dataDir, 'view.html');
  const data = buildData(store, target);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, pageHtml(data), 'utf8');
  return { path: target, items: data.items.length, folders: data.folders.length, tags: data.tags.length };
}

export function openViewer(target) {
  const command =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
