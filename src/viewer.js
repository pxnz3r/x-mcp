import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { localUrlFor } from './localurl.js';
import { allItems, folderPath, loadStore, tagCounts } from './store.js';

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
    author: { username: item.author?.username ?? null, name: item.author?.name ?? null },
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

const PAGE_CSS = `
:root{color-scheme:dark;--bg:#000;--panel:#0d0d0d;--panel2:#161616;--line:#262626;--text:#e6edf3;--muted:#8b98a5;--accent:#1d9bf0;--chip:#1e1e1e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.layout{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:100vh}
aside{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--line);background:var(--panel);padding:16px}
aside h1{font-size:15px;margin:0 0 4px;letter-spacing:.2px}
aside .sub{color:var(--muted);font-size:12px;margin-bottom:16px}
.sec{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:18px 0 6px}
.row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--text)}
.row:hover{background:var(--panel2)}
.row.active{background:var(--chip);color:#fff}
.row .n{margin-left:auto;color:var(--muted);font-size:11px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:2px 9px;font-size:12px;cursor:pointer}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.chip .c{opacity:.65;margin-left:4px}
main{width:100%;padding:18px 22px 60px;max-width:900px;margin:0 auto}
.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
input[type=search]{flex:1;min-width:220px;background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 12px;font-size:14px}
input[type=search]:focus{outline:1px solid var(--accent);border-color:var(--accent)}
select{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px}
.toggle{background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:8px 10px;cursor:pointer}
.toggle.on{color:#fff;border-color:var(--accent)}
.meta{color:var(--muted);font-size:12px;margin:0 0 14px;display:flex;gap:12px;flex-wrap:wrap}
.card{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:14px 16px;margin-bottom:12px}
.card.flash{outline:2px solid var(--accent)}
.foot .local{color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.foot .local:hover{border-color:var(--accent);color:var(--text)}
.head{display:flex;gap:10px;align-items:center;margin-bottom:8px}
.av{width:32px;height:32px;border-radius:50%;background:var(--chip);display:grid;place-items:center;font-size:12px;color:var(--muted);text-transform:uppercase;flex:0 0 auto}
.who{font-weight:600;font-size:14px}
.who span{color:var(--muted);font-weight:400;margin-left:6px;font-size:13px}
.when{margin-left:auto;color:var(--muted);font-size:12px;white-space:nowrap}
.text{white-space:pre-wrap;word-wrap:break-word;font-size:14px;margin:0 0 8px}
.media{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.thumb{position:relative;width:132px;height:100px;border-radius:8px;overflow:hidden;background:#0a0c0f;border:1px solid var(--line);cursor:pointer;flex:0 0 auto}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb .play{position:absolute;inset:0;display:grid;place-items:center;font-size:20px;color:#fff;background:rgba(0,0,0,.25)}
.thumb{cursor:zoom-in}
.lb{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:transparent;cursor:zoom-out}
.lb[hidden]{display:none}
.lb img,.lb video{display:block;max-width:94vw;max-height:88vh;border-radius:10px;background:#000;box-shadow:0 12px 60px rgba(0,0,0,.55);cursor:default}
.lb video{min-width:min(520px,90vw)}
.more{width:96px;height:100px;border-radius:8px;border:1px dashed var(--line);display:grid;place-items:center;color:var(--muted);font-size:12px}
.links{margin:6px 0;font-size:13px;display:grid;gap:6px}
.links a{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.links .lc{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--panel2);color:var(--text)}
.links .lc:hover{border-color:var(--accent)}
.links .lc img{width:88px;height:60px;object-fit:cover;border-radius:6px;flex:0 0 auto;background:#000}
.lc-b{min-width:0;display:flex;flex-direction:column;gap:2px}
.lc-t{font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-d{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;font-size:12px;color:var(--muted)}
.foot .tag{border:1px solid var(--line);border-radius:999px;padding:1px 8px;cursor:pointer;color:var(--muted)}
.foot .tag:hover{border-color:var(--accent);color:var(--text)}
.foot .sp{margin-left:auto}
.quote{border-left:2px solid var(--line);padding:2px 0 2px 10px;color:var(--muted);font-size:13px;margin:8px 0;white-space:pre-wrap}
.empty{color:var(--muted);text-align:center;padding:60px 20px}
.note{color:var(--muted);font-size:12px;margin-top:30px}
@media(max-width:760px){.layout{grid-template-columns:1fr}aside{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line)}main{padding:14px}}
`.trim();

const PAGE_JS = `
(function(){
var DATA = JSON.parse(document.getElementById('data').textContent);
var state = { folder: null, tags: new Set(), q: '', media: false, sort: 'newest', post: null };
var scopes = {};
function scope(id){
  if (scopes[id]) return scopes[id];
  var out = new Set([id]); var grew = true;
  while (grew) { grew = false;
    DATA.folders.forEach(function(f){
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
    });
  }
  scopes[id] = out; return out;
}
function folderById(id){ return DATA.folders.filter(function(f){ return f.id === id; })[0] || null; }
function folderByPath(name){
  var needle = String(name || '').toLowerCase();
  return DATA.folders.filter(function(f){ return f.path.toLowerCase() === needle; })[0] || null;
}
function parseHash(){
  var h = location.hash.replace(/^#/, ''); if (!h) return;
  h.split('&').forEach(function(part){
    var kv = part.split('='); var k = decodeURIComponent(kv[0] || ''); var v = decodeURIComponent(kv[1] || '');
    if (k === 'folder' && v) {
      if (v === '__none') state.folder = '__none';
      else { var found = folderByPath(v); if (found) state.folder = found.id; }
    }
    if (k === 'q') state.q = v;
    if (k === 'tags' && v) v.split(',').filter(Boolean).forEach(function(t){ state.tags.add(t); });
    if (k === 'media') state.media = true;
    if (k === 'sort') state.sort = v;
    if (k === 'post') state.post = v;
  });
}
function writeHash(){
  var parts = [];
  if (state.folder) {
    var folder = folderById(state.folder);
    parts.push('folder=' + encodeURIComponent(state.folder === '__none' ? '__none' : (folder ? folder.path : state.folder)));
  }
  if (state.q) parts.push('q=' + encodeURIComponent(state.q));
  if (state.tags.size) parts.push('tags=' + encodeURIComponent(Array.from(state.tags).join(',')));
  if (state.media) parts.push('media=1');
  if (state.sort !== 'newest') parts.push('sort=' + encodeURIComponent(state.sort));
  if (state.post) parts.push('post=' + encodeURIComponent(state.post));
  try { history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname); } catch (e) {}
}
function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function closeLightbox(){
  var lb = document.getElementById('lb');
  if (lb.hidden) return;
  lb.innerHTML = ''; lb.hidden = true; document.body.style.overflow = '';
}
function openLightbox(m){
  if (!m || !(m.url || m.preview)) return;
  var lb = document.getElementById('lb');
  lb.innerHTML = '';
  var node;
  if ((m.type === 'video' || m.type === 'gif') && m.url) {
    node = document.createElement('video');
    node.src = m.url; node.controls = true; node.autoplay = true; node.playsInline = true; node.loop = m.type === 'gif';
  } else {
    node = document.createElement('img');
    node.src = m.url || m.preview; node.alt = m.alt || '';
  }
  lb.appendChild(node);
  lb.hidden = false; document.body.style.overflow = 'hidden';
}
function countFor(folderId){
  var s = scope(folderId);
  return DATA.items.filter(function(i){ return (i.folderIds || []).some(function(id){ return s.has(id); }); }).length;
}
function buildAside(){
  var host = document.getElementById('folders');
  host.innerHTML = '';
  var all = el('div', 'row' + (state.folder ? '' : ' active'));
  all.appendChild(el('span', null, 'All bookmarks'));
  all.appendChild(el('span', 'n', String(DATA.items.length)));
  all.onclick = function(){ state.folder = null; render(); };
  host.appendChild(all);

  var unfiled = el('div', 'row' + (state.folder === '__none' ? ' active' : ''));
  unfiled.appendChild(el('span', null, 'Unfiled'));
  var noneCount = DATA.items.filter(function(i){ return !(i.folderIds || []).length; }).length;
  unfiled.appendChild(el('span', 'n', String(noneCount)));
  unfiled.onclick = function(){ state.folder = '__none'; render(); };
  host.appendChild(unfiled);

  DATA.folders.forEach(function(f){
    var depth = f.path.split('/').length - 1;
    var row = el('div', 'row' + (state.folder === f.id ? ' active' : ''));
    row.style.paddingLeft = (6 + depth * 14) + 'px';
    row.title = f.path + (f.kind === 'x' ? ' (X folder)' : '');
    row.appendChild(el('span', null, f.name));
    row.appendChild(el('span', 'n', String(countFor(f.id))));
    row.onclick = function(){ state.folder = f.id; render(); };
    host.appendChild(row);
  });

  var tags = document.getElementById('tags');
  tags.innerHTML = '';
  DATA.tags.forEach(function(t){
    var b = el('button', 'chip' + (state.tags.has(t.tag) ? ' on' : ''));
    b.appendChild(el('span', null, '#' + t.tag));
    b.appendChild(el('span', 'c', String(t.count)));
    b.onclick = function(){ if (state.tags.has(t.tag)) state.tags.delete(t.tag); else state.tags.add(t.tag); render(); };
    tags.appendChild(b);
  });
}
function filtered(){
  var items = DATA.items.slice();
  if (state.folder === '__none') items = items.filter(function(i){ return !(i.folderIds || []).length; });
  else if (state.folder) {
    var s = scope(state.folder);
    items = items.filter(function(i){ return (i.folderIds || []).some(function(id){ return s.has(id); }); });
  }
  if (state.tags.size) {
    var wanted = Array.from(state.tags);
    items = items.filter(function(i){ return wanted.every(function(t){ return (i.tags || []).indexOf(t) >= 0; }); });
  }
  if (state.media) items = items.filter(function(i){ return (i.media || []).length > 0; });
  if (state.q) {
    var terms = state.q.toLowerCase().split(/\\s+/).filter(Boolean);
    items = items.filter(function(i){
      var hay = [i.text, i.author && i.author.name, i.author && i.author.username]
        .concat(i.tags || [])
        .concat((i.links || []).map(function(l){ return l.url; }))
        .concat((i.media || []).map(function(m){ return m.alt || ''; }))
        .filter(Boolean).join(' ').toLowerCase();
      return terms.every(function(t){ return hay.indexOf(t) >= 0; });
    });
  }
  items.sort(function(a, b){
    var left = a.createdAt || '', right = b.createdAt || '';
    if (state.sort === 'oldest') return left.localeCompare(right);
    if (state.sort === 'author') return String(a.author && a.author.username).localeCompare(String(b.author && b.author.username));
    return right.localeCompare(left);
  });
  return items;
}
function folderLabels(ids){
  return (ids || []).map(function(id){
    var f = DATA.folders.filter(function(x){ return x.id === id; })[0];
    return f ? f.path : id;
  });
}
function mediaRow(item){
  var wrap = el('div', 'media');
  var shown = (item.media || []).slice(0, 4);
  shown.forEach(function(m){
    var t = el('div', 'thumb');
    t.dataset.type = m.type || '';
    if (m.preview) {
      var img = el('img'); img.loading = 'lazy'; img.src = m.preview; img.alt = m.alt || '';
      t.appendChild(img);
    }
    if (m.type === 'video' || m.type === 'gif') t.appendChild(el('div', 'play', '\\u25B6'));
    t.title = m.alt || (m.type + (item.author && item.author.username ? ' by @' + item.author.username : ''));
    t.onclick = function(e){ e.stopPropagation(); openLightbox(m); };
    wrap.appendChild(t);
  });
  if ((item.media || []).length > 4) wrap.appendChild(el('div', 'more', '+' + (item.media.length - 4) + ' more'));
  return wrap;
}
function card(item){
  var c = el('article', 'card');
  c.dataset.id = item.id;
  var head = el('div', 'head');
  var av = el('div', 'av', (item.author && item.author.username ? item.author.username.slice(0, 2) : '?'));
  var who = el('div', 'who');
  who.appendChild(el('span', null, item.author && item.author.name ? item.author.name : 'unknown'));
  who.appendChild(document.createElement('span')).textContent = item.author && item.author.username ? '@' + item.author.username : '';
  var when = el('div', 'when', item.createdAt ? item.createdAt.slice(0, 16).replace('T', ' ') : '');
  head.appendChild(av); head.appendChild(who); head.appendChild(when);
  c.appendChild(head);

  if (item.text) c.appendChild(el('p', 'text', item.text));
  if ((item.media || []).length) c.appendChild(mediaRow(item));
  if (item.quoted && item.quoted.text) {
    var q = el('div', 'quote', '@' + (item.quoted.username || 'unknown') + ': ' + item.quoted.text);
    c.appendChild(q);
  }
  var links = (item.links || []).filter(function(l){ return l.url; });
  if (links.length) {
    var box = el('div', 'links');
    links.forEach(function(l){
      if (l.preview || l.title) {
        var lc = el('a', 'lc');
        lc.href = l.url; lc.target = '_blank'; lc.rel = 'noopener';
        if (l.preview) {
          var im = el('img'); im.loading = 'lazy'; im.src = l.preview; im.alt = '';
          lc.appendChild(im);
        }
        var body = el('div', 'lc-b');
        body.appendChild(el('div', 'lc-t', l.title || l.display || l.url));
        body.appendChild(el('div', 'lc-d', (l.site || l.display || '') + (l.description ? '  ' + l.description : '')));
        lc.appendChild(body);
        box.appendChild(lc);
      } else {
        var a = el('a', null, l.display || l.url); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a);
      }
    });
    c.appendChild(box);
  }

  var foot = el('div', 'foot');
  folderLabels(item.folderIds).forEach(function(label){
    var span = el('span', null, label);
    foot.appendChild(span);
  });
  (item.tags || []).forEach(function(t){
    var b = el('span', 'tag', '#' + t);
    b.onclick = function(){ state.tags.add(t); render(); };
    foot.appendChild(b);
  });
  var open = el('a', null, 'open on x');
  open.href = item.url || ('https://x.com/i/status/' + item.id);
  open.target = '_blank'; open.rel = 'noopener';
  foot.appendChild(open);
  var local = el('a', 'local', 'local link');
  local.href = item.localUrl || ('#post=' + item.id);
  local.title = item.localUrl || '';
  foot.appendChild(local);
  c.appendChild(foot);
  return c;
}
function render(){
  buildAside();
  var items = filtered();
  document.getElementById('total').textContent = items.length + ' post' + (items.length === 1 ? '' : 's');
  var label = state.folder === '__none' ? 'Unfiled' : state.folder ? (DATA.folders.filter(function(f){ return f.id === state.folder; })[0] || {}).path || state.folder : 'All bookmarks';
  document.getElementById('where').textContent = label;
  var active = Array.from(state.tags).map(function(t){ return '#' + t; }).join(' ');
  document.getElementById('filtertags').textContent = active;
  var list = document.getElementById('list');
  list.innerHTML = '';
  if (!items.length) { list.appendChild(el('div', 'empty', 'Nothing here. Change the filters or run bookmarks_sync.')); }
  else items.forEach(function(item){ list.appendChild(card(item)); });
  document.getElementById('search').value = state.q;
  document.getElementById('media').className = 'toggle' + (state.media ? ' on' : '');
  document.getElementById('sort').value = state.sort;
  if (state.post) {
    var target = list.querySelector('.card[data-id="' + state.post + '"]');
    if (target) {
      target.classList.add('flash');
      var jump = function(){
        var y = target.getBoundingClientRect().top + window.scrollY - 160;
        window.scrollTo(0, Math.max(0, y));
      };
      jump();
      setTimeout(jump, 300);
      setTimeout(jump, 900);
      setTimeout(jump, 2200);
    } else {
      document.getElementById('where').textContent = label + '  (post ' + state.post + ' not in this view)';
    }
  }
  writeHash();
}
document.getElementById('search').addEventListener('input', function(e){ state.q = e.target.value.trim(); render(); });
document.getElementById('sort').addEventListener('change', function(e){ state.sort = e.target.value; render(); });
document.getElementById('media').addEventListener('click', function(){ state.media = !state.media; render(); });
document.getElementById('clear').addEventListener('click', function(){
  state.folder = null; state.tags.clear(); state.q = ''; state.media = false; state.sort = 'newest'; state.post = null; render();
});
document.getElementById('lb').addEventListener('click', function(e){ if (e.target === this) closeLightbox(); });
document.addEventListener('keydown', function(e){
  if (e.key === '/' && document.activeElement !== document.getElementById('search')) { e.preventDefault(); document.getElementById('search').focus(); }
  if (e.key === 'Escape') {
    if (!document.getElementById('lb').hidden) { closeLightbox(); return; }
    state.q = ''; render();
  }
});
parseHash();
render();
})();
`.trim();

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
<div class="layout">
<aside>
  <h1>X bookmarks</h1>
  <div class="sub">${data.items.length} cached${data.account ? ` for @${data.account}` : ''}</div>
  <div class="sec">Folders</div>
  <div id="folders"></div>
  <div class="sec">Tags</div>
  <div id="tags" class="chips"></div>
</aside>
<main>
  <div class="tools">
    <input id="search" type="search" placeholder="Search text, author, tag, link   ( / )" autocomplete="off">
    <select id="sort">
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="author">Author</option>
    </select>
    <button id="media" class="toggle" title="Only posts with media">Media</button>
    <button id="clear" class="toggle" title="Reset filters">Reset</button>
  </div>
  <div class="meta">
    <span id="total"></span>
    <span id="where"></span>
    <span id="filtertags"></span>
  </div>
  <div id="list"></div>
  <div class="note">Generated ${data.generatedAt.slice(0, 16).replace('T', ' ')}. Re-run <code>node src/cli.js view</code> after syncing or editing folders.</div>
</main>
</div>
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
