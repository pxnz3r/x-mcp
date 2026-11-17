(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var state = { folder: null, tags: new Set(), q: '', media: false, sort: 'newest', post: null };
  var shown = [];
  var current = null;
  var byId = {};
  var avatars = {};
  DATA.items.forEach(function (item) {
    byId[item.id] = item;
    if (item.author && item.author.username && item.author.avatar) avatars[item.author.username] = item.author.avatar;
  });

  var $ = function (id) { return document.getElementById(id); };
  var list = $('list'), reader = $('reader'), search = $('search');
  var wideQuery = window.matchMedia('(min-width: 1200px)');
  var THIS_YEAR = new Date().getFullYear();

  // static icon markup only; never user data
  var ICON = {
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>',
    article: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    thread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="5.5" r="2.5"/><circle cx="6" cy="18.5" r="2.5"/><path d="M6 8v8M11 5.5h9M11 18.5h9M11 12h6"/></svg>',
    reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 4.5V16h0a2 2 0 0 1-2-2z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.5L5 21V4.5A1.5 1.5 0 0 1 6.5 3z"/></svg>',
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name, cls) { var s = el('span', cls); s.innerHTML = ICON[name]; return s.firstChild; }
  function external(a, href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var opts = d.getFullYear() === THIS_YEAR ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
    return d.toLocaleDateString(undefined, opts);
  }
  function longDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' · ' +
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---- folders, filters, hash
  var scopes = {};
  function scope(id) {
    if (scopes[id]) return scopes[id];
    var out = new Set([id]); var grew = true;
    while (grew) {
      grew = false;
      DATA.folders.forEach(function (f) {
        if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
      });
    }
    return (scopes[id] = out);
  }
  function folderById(id) { return DATA.folders.filter(function (f) { return f.id === id; })[0] || null; }
  function folderByPath(name) {
    var needle = String(name || '').toLowerCase();
    return DATA.folders.filter(function (f) { return f.path.toLowerCase() === needle; })[0] || null;
  }
  function inFolder(item, id) { var s = scope(id); return (item.folderIds || []).some(function (f) { return s.has(f); }); }

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = decodeURIComponent(kv[0] || ''), v = decodeURIComponent(kv[1] || '');
      if (k === 'folder' && v) {
        if (v === '__none') state.folder = '__none';
        else { var found = folderByPath(v); if (found) state.folder = found.id; }
      }
      if (k === 'q') state.q = v;
      if (k === 'tags' && v) v.split(',').filter(Boolean).forEach(function (t) { state.tags.add(t); });
      if (k === 'media') state.media = true;
      if (k === 'sort') state.sort = v;
      if (k === 'post') state.post = v;
    });
  }
  function writeHash() {
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
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
  }
  function filtersActive() { return Boolean(state.folder || state.tags.size || state.q || state.media); }

  function haystack(item) {
    if (item._hay) return item._hay;
    var extra = [].concat(item.above || [], item.thread || [], item.authorReplies || []);
    item._hay = [item.text, item.author && item.author.name, item.author && item.author.username]
      .concat(item.article ? [item.article.title, item.article.text] : [])
      .concat(extra.map(function (p) { return p.text + ' ' + (p.links || []).map(function (l) { return l.url; }).join(' '); }))
      .concat(item.tags || [])
      .concat((item.links || []).map(function (l) { return l.url + ' ' + (l.title || ''); }))
      .concat((item.media || []).map(function (m) { return m.alt || ''; }))
      .filter(Boolean).join(' ').toLowerCase();
    return item._hay;
  }
  function filtered() {
    var items = DATA.items.slice();
    if (state.folder === '__none') items = items.filter(function (i) { return !(i.folderIds || []).length; });
    else if (state.folder) items = items.filter(function (i) { return inFolder(i, state.folder); });
    if (state.tags.size) {
      var wanted = Array.from(state.tags);
      items = items.filter(function (i) { return wanted.every(function (t) { return (i.tags || []).indexOf(t) >= 0; }); });
    }
    if (state.media) items = items.filter(function (i) { return (i.media || []).length > 0; });
    if (state.q) {
      var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      items = items.filter(function (i) { var hay = haystack(i); return terms.every(function (t) { return hay.indexOf(t) >= 0; }); });
    }
    items.sort(function (a, b) {
      var left = a.createdAt || '', right = b.createdAt || '';
      if (state.sort === 'oldest') return left.localeCompare(right);
      if (state.sort === 'author') return String(a.author && a.author.username).localeCompare(String(b.author && b.author.username));
      return right.localeCompare(left);
    });
    return items;
  }

  // ---- sidebar
  function frow(label, count, active, onClick, depth) {
    var b = el('button', 'frow');
    b.type = 'button';
    if (depth) b.style.paddingLeft = (12 + depth * 16) + 'px';
    b.setAttribute('aria-current', active ? 'true' : 'false');
    b.appendChild(el('span', 'name', label));
    b.appendChild(el('span', 'n', String(count)));
    b.onclick = onClick;
    return b;
  }
  function buildAside() {
    var host = $('folders');
    host.textContent = '';
    host.appendChild(frow('All bookmarks', DATA.items.length, !state.folder, function () { state.folder = null; refresh(); }));
    if (DATA.folders.length) {
      var none = DATA.items.filter(function (i) { return !(i.folderIds || []).length; }).length;
      host.appendChild(frow('Unfiled', none, state.folder === '__none', function () { state.folder = '__none'; refresh(); }));
    }
    DATA.folders.forEach(function (f) {
      var count = DATA.items.filter(function (i) { return inFolder(i, f.id); }).length;
      var row = frow(f.name, count, state.folder === f.id, function () { state.folder = f.id; refresh(); }, f.path.split('/').length - 1);
      if (f.kind === 'x') row.title = 'X folder';
      host.appendChild(row);
    });

    var tags = $('tags');
    tags.textContent = '';
    $('tags-group').hidden = !DATA.tags.length;
    DATA.tags.forEach(function (t) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', state.tags.has(t.tag) ? 'true' : 'false');
      b.appendChild(el('span', null, '#' + t.tag));
      b.appendChild(el('span', 'n', String(t.count)));
      b.onclick = function () { toggleTag(t.tag); };
      tags.appendChild(b);
    });
  }
  function toggleTag(tag) {
    if (state.tags.has(tag)) state.tags.delete(tag); else state.tags.add(tag);
    refresh();
  }

  // ---- shared post pieces
  function avatar(author, small) {
    var cls = 'av' + (small ? ' sm' : '');
    var src = author && (author.avatar || avatars[author.username]);
    if (src) {
      var img = el('img', cls); img.src = src; img.alt = ''; img.loading = 'lazy';
      return img;
    }
    var name = (author && (author.name || author.username)) || '?';
    return el('div', cls, name.slice(0, 1).toUpperCase());
  }
  function whoLine(author, iso) {
    var w = el('div', 'who');
    w.appendChild(el('b', null, (author && author.name) || (author && author.username) || 'unknown'));
    if (author && author.username) w.appendChild(el('span', null, '@' + author.username));
    if (iso) { var t = el('time', null, shortDate(iso)); t.dateTime = iso; w.appendChild(t); }
    return w;
  }
  function linkify(target, text) {
    var re = /https?:\/\/[^\s]+/g, last = 0, m;
    while ((m = re.exec(text))) {
      target.appendChild(document.createTextNode(text.slice(last, m.index)));
      var url = m[0].replace(/[).,;:!?]+$/, '');
      var label = url.replace(/^https?:\/\/(www\.)?/, '');
      target.appendChild(external(el('a', null, label.length > 44 ? label.slice(0, 42) + '…' : label), url));
      last = m.index + url.length;
      re.lastIndex = last;
    }
    target.appendChild(document.createTextNode(text.slice(last)));
    return target;
  }
  function mosaic(media, interactive) {
    var shownMedia = media.slice(0, 4);
    var box = el('div', 'mosaic' + (shownMedia.length === 1 ? ' one' : ''));
    box.style.setProperty('--cols', shownMedia.length > 1 ? 2 : 1);
    shownMedia.forEach(function (m, index) {
      var cell = el(interactive ? 'button' : 'div', 'm');
      if (interactive) { cell.type = 'button'; cell.setAttribute('aria-label', m.alt || ('Open ' + (m.type || 'media'))); }
      if (m.preview || m.url) {
        var img = el('img'); img.loading = 'lazy'; img.alt = m.alt || ''; img.src = m.preview || m.url;
        cell.appendChild(img);
      }
      if (m.type === 'video' || m.type === 'gif') { var p = el('span', 'play'); p.innerHTML = ICON.play; cell.appendChild(p); }
      if (index === 3 && media.length > 4) cell.appendChild(el('span', 'extra', '+' + (media.length - 4)));
      cell.addEventListener('click', function (e) { e.stopPropagation(); openLightbox(m); });
      box.appendChild(cell);
    });
    if (shownMedia.length === 3) box.firstChild.style.gridRow = 'span 2';
    return box;
  }
  function quoteBox(quoted) {
    var q = el('div', 'quote');
    q.appendChild(el('div', 'qwho', '@' + (quoted.username || 'unknown')));
    q.appendChild(el('p', 'ptext', quoted.text));
    return q;
  }
  function hostOf(url) {
    try { var u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, ''); } catch (e) { return url; }
  }
  // links from the post and from the author's own thread and replies: where the repo or demo usually is
  function keyLinks(item) {
    var seen = {}, out = [];
    [item].concat(item.thread || [], item.authorReplies || []).forEach(function (p) {
      (p.links || []).forEach(function (l) {
        if (!l.url || /^https?:\/\/(x|twitter)\.com\//.test(l.url) || seen[l.url]) return;
        seen[l.url] = true;
        out.push(l.url);
      });
    });
    return out;
  }

  // ---- feed
  function insideLine(item) {
    var line = el('div', 'inside');
    function add(name, cls, label, count) {
      var s = el('span', cls);
      s.appendChild(icon(name));
      s.appendChild(el('em', null, label));
      if (count) s.appendChild(document.createTextNode(String(count)));
      line.appendChild(s);
    }
    if ((item.thread || []).length) add('thread', null, 'Thread', '+' + item.thread.length);
    if ((item.authorReplies || []).length) add('reply', null, 'Author replied', item.authorReplies.length);
    keyLinks(item).slice(0, 2).forEach(function (url) { add('link', 'lnk', hostOf(url)); });
    return line.childNodes.length ? line : null;
  }
  // an article bookmark's text is usually just the article URL, which the article card replaces
  function bodyText(item) {
    if (!item.article) return item.text || '';
    return (item.text || '').replace(/https?:\/\/(x|twitter)\.com\/i\/article\/\d+\S*/g, '').trim();
  }
  function articleCard(article) {
    var a = el('div', 'acard');
    if (article.cover) { var im = el('img'); im.loading = 'lazy'; im.alt = ''; im.src = article.cover; a.appendChild(im); }
    var t = el('div', 'acard-t');
    t.appendChild(el('b', null, article.title || 'Article'));
    var lead = (article.text || '').replace(/\\(.)/g, '$1').replace(/[#>*`\[\]!]|\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (lead) t.appendChild(el('span', null, lead.slice(0, 220)));
    a.appendChild(t);
    return a;
  }
  function filedLine(item) {
    var parts = (item.folderIds || []).map(function (id) { var f = folderById(id); return f ? f.path : id; })
      .concat((item.tags || []).map(function (t) { return '#' + t; }));
    return parts.length ? el('div', 'filed', parts.join('  ·  ')) : null;
  }
  function row(item) {
    var r = el('article', 'post');
    r.id = 'p-' + item.id;
    r.dataset.id = item.id;
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', 'false');
    r.tabIndex = -1;
    r.appendChild(avatar(item.author));
    var body = el('div');
    body.appendChild(whoLine(item.author, item.createdAt));
    (item.above || []).slice(-1).forEach(function (p) {
      body.appendChild(el('div', 'filed', 'Replying to @' + (p.username || '?')));
    });
    var text = bodyText(item);
    if (text) body.appendChild(el('p', 'ptext', text));
    if ((item.media || []).length) body.appendChild(mosaic(item.media, false));
    if (item.article) body.appendChild(articleCard(item.article));
    if (item.quoted && item.quoted.text) body.appendChild(quoteBox(item.quoted));
    var inside = insideLine(item);
    if (inside) body.appendChild(inside);
    var filed = filedLine(item);
    if (filed) body.appendChild(filed);
    r.appendChild(body);
    return r;
  }
  function renderFeed() {
    shown = filtered();
    list.textContent = '';
    var status = $('status');
    status.hidden = !filtersActive();
    if (!status.hidden) {
      status.textContent = '';
      status.appendChild(el('span', null, shown.length + ' of ' + DATA.items.length));
      var reset = el('button', null, 'Reset filters');
      reset.type = 'button';
      reset.onclick = resetFilters;
      status.appendChild(reset);
    }
    if (!shown.length) {
      var empty = el('div', 'empty');
      empty.innerHTML = ICON.empty;
      empty.appendChild(el('p', null, 'No bookmarks match'));
      var b = el('button', 'pill', 'Reset filters');
      b.type = 'button';
      b.onclick = resetFilters;
      empty.appendChild(b);
      list.appendChild(empty);
      return;
    }
    renderMore(0);
  }
  // rows are appended in batches as the feed nears the end, so a 1,000-post cache opens instantly
  var BATCH = 60, rendered = 0;
  function renderMore(upto) {
    if (upto === 0) rendered = 0;
    var end = Math.min(shown.length, Math.max(rendered + BATCH, upto || 0));
    var frag = document.createDocumentFragment();
    for (var i = rendered; i < end; i += 1) frag.appendChild(row(shown[i]));
    list.appendChild(frag);
    rendered = end;
  }
  function ensureRow(id) {
    var index = shown.findIndex(function (i) { return i.id === id; });
    if (index >= rendered) { renderMore(index + 1); markSelected(); }
    return $('p-' + id);
  }
  new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting && rendered < shown.length) renderMore();
  }, { rootMargin: '1500px 0px' }).observe($('more'));
  function resetFilters() {
    state.folder = null; state.tags.clear(); state.q = ''; state.media = false; state.sort = 'newest';
    refresh();
  }

  // ---- reader
  function threadPost(p, linked, opts) {
    var tp = el('div', 'tp' + (linked ? ' linked' : ''));
    var rail = el('div', 'rail');
    rail.appendChild(avatar({ name: p.name, username: p.username }));
    tp.appendChild(rail);
    var body = el('div');
    body.appendChild(whoLine({ name: p.name, username: p.username }, p.createdAt));
    if (p.inReplyTo) {
      var re = el('div', 'reto');
      re.appendChild(document.createTextNode('Replying to @' + (p.inReplyTo.username || '?')));
      re.appendChild(el('p', 'ptext', p.inReplyTo.text));
      body.appendChild(re);
    }
    // X hides the leading @mentions of a reply; "Replying to" already says who
    var text = (p.text || '').replace(/^(@\w+\s+)+/, '') || p.text;
    if (text) body.appendChild(linkify(el('p', 'ptext'), text));
    if ((p.media || []).length) body.appendChild(mosaic(p.media, true));
    if ((p.links || []).length) body.appendChild(linkCards(p.links, p.text));
    if (opts && opts.likes && p.likes) {
      var lk = el('div', 'likes'); lk.appendChild(icon('heart')); lk.appendChild(document.createTextNode(String(p.likes)));
      body.appendChild(lk);
    }
    tp.appendChild(body);
    return tp;
  }
  // a card only when there is a preview to show; a bare URL already linked in the text adds nothing
  function linkCards(links, text) {
    var box = el('div', 'cards');
    links.filter(function (l) {
      if (!l.url || /\/i\/article\//.test(l.url)) return false;
      return Boolean(l.title || l.preview) || (text || '').indexOf(l.url) < 0;
    }).forEach(function (l) {
      var a = external(el('a', 'lc'), l.url);
      if (l.preview) { var im = el('img'); im.loading = 'lazy'; im.alt = ''; im.src = l.preview; a.appendChild(im); }
      var t = el('div', 'lb-t');
      t.appendChild(el('div', 'site', l.site || hostOf(l.url)));
      if (l.title) t.appendChild(el('div', 'title', l.title));
      if (l.description) t.appendChild(el('div', 'desc', l.description));
      a.appendChild(t);
      box.appendChild(a);
    });
    return box.childNodes.length ? box : document.createDocumentFragment();
  }
  function section(title) {
    var s = el('section', 'rsec');
    s.appendChild(el('h3', null, title));
    return s;
  }

  // Markdown from articleToMarkdown: headings, paragraphs, lists, quotes, images, code, dividers, embedded posts
  var INLINE = /\[([^\]]+)\]\((https?:[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g;
  function unescape(s) { return s.replace(/\\([\\`*_{}\[\]()#+\-.!|<>~])/g, '$1'); }
  function inline(target, text) {
    var last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
      target.appendChild(document.createTextNode(unescape(text.slice(last, m.index))));
      if (m[1]) target.appendChild(external(el('a', null, unescape(m[1].replace(/\*\*/g, ''))), m[2]));
      else if (m[3]) target.appendChild(el('strong', null, unescape(m[3])));
      else if (m[4]) target.appendChild(el('code', null, m[4]));
      else target.appendChild(el('em', null, unescape(m[5])));
      last = INLINE.lastIndex;
    }
    target.appendChild(document.createTextNode(unescape(text.slice(last))));
    return target;
  }
  function markdown(host, md) {
    var lines = md.split('\n'), i = 0, para = [], listEl = null, listType = null, m;
    function flush() { if (para.length) { host.appendChild(inline(el('p'), para.join('\n'))); para = []; } }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        flush(); listEl = null;
        var code = []; i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i += 1; }
        i += 1;
        var pre = el('pre'); pre.appendChild(el('code', null, code.join('\n'))); host.appendChild(pre);
        continue;
      }
      if (!line.trim()) { flush(); i += 1; continue; }
      if ((m = /^\s*(-|\d+\.) (.*)$/.exec(line))) {
        flush();
        var type = m[1] === '-' ? 'ul' : 'ol';
        if (!listEl || listType !== type) { listEl = el(type); listType = type; host.appendChild(listEl); }
        listEl.appendChild(inline(el('li'), m[2]));
        i += 1; continue;
      }
      listEl = null;
      if ((m = /^(#{1,6}) (.*)$/.exec(line))) { flush(); host.appendChild(inline(el(m[1].length <= 2 ? 'h3' : 'h4'), m[2])); i += 1; continue; }
      if ((m = /^!\[[^\]]*\]\((https?:[^)\s]+)\)$/.exec(line.trim()))) {
        flush(); var im = el('img'); im.loading = 'lazy'; im.alt = ''; im.src = m[1]; host.appendChild(im); i += 1; continue;
      }
      if (/^-{3,}$/.test(line.trim())) { flush(); host.appendChild(el('hr')); i += 1; continue; }
      if ((m = /^> embedded post: (https:\/\/x\.com\/\S+)$/.exec(line))) {
        flush();
        var p = el('p'), a = external(el('a', 'embed'), m[1]);
        a.innerHTML = ICON.x; a.appendChild(document.createTextNode('Embedded post'));
        p.appendChild(a); host.appendChild(p); i += 1; continue;
      }
      if (/^>/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^> ?/, '')); i += 1; }
        host.appendChild(inline(el('blockquote'), q.join('\n')));
        continue;
      }
      para.push(line); i += 1;
    }
    flush();
    return host;
  }
  function articleSection(article) {
    var s = el('section', 'rsec article');
    if (article.cover) { var cv = el('img', 'cover'); cv.loading = 'lazy'; cv.alt = ''; cv.src = article.cover; s.appendChild(cv); }
    s.appendChild(el('h2', null, article.title || 'Article'));
    s.appendChild(markdown(el('div', 'prose'), article.text || ''));
    if (article.url) s.appendChild(external(el('a', 'more-on-x', 'Read on X'), article.url));
    return s;
  }

  function readerBar(item) {
    var bar = el('div', 'rbar');
    var back = el('button', 'ibtn only-narrow');
    back.type = 'button'; back.setAttribute('aria-label', 'Close'); back.dataset.tip = 'Close';
    back.innerHTML = ICON.back;
    back.onclick = closeReader;
    bar.appendChild(back);
    bar.appendChild(el('span', 'sp'));
    if (!item) return bar;
    var copy = el('button', 'ibtn');
    copy.type = 'button'; copy.setAttribute('aria-label', 'Copy local link'); copy.dataset.tip = 'Copy local link';
    copy.innerHTML = ICON.link;
    copy.onclick = function () {
      navigator.clipboard.writeText(item.localUrl || location.href).then(function () {
        copy.innerHTML = ICON.check; copy.dataset.tip = 'Copied';
        setTimeout(function () { copy.innerHTML = ICON.link; copy.dataset.tip = 'Copy local link'; }, 1400);
      }, function (error) {
        copy.dataset.tip = 'Copy failed';
        console.error('Copy failed', error);
      });
    };
    bar.appendChild(copy);
    var open = external(el('a', 'ibtn'), item.url || ('https://x.com/i/status/' + item.id));
    open.setAttribute('aria-label', 'Open on X'); open.dataset.tip = 'Open on X';
    open.innerHTML = ICON.out;
    bar.appendChild(open);
    return bar;
  }
  function renderReader() {
    var item = current ? byId[current] : null;
    reader.textContent = '';
    reader.appendChild(readerBar(item));
    if (!item) {
      var blank = el('div', 'rblank'); blank.innerHTML = ICON.x; reader.appendChild(blank);
      return;
    }
    var body = el('div', 'rbody');
    var above = item.above || [];
    above.forEach(function (p) { body.appendChild(threadPost(p, true)); });

    var focal = el('div', 'focal');
    var head = el('div', 'fhead');
    head.appendChild(avatar(item.author));
    var who = whoLine(item.author, null);
    head.appendChild(who);
    focal.appendChild(head);
    var text = bodyText(item);
    if (text) focal.appendChild(linkify(el('p', 'ptext'), text));
    if ((item.media || []).length) focal.appendChild(mosaic(item.media, true));
    if (item.quoted && item.quoted.text) focal.appendChild(quoteBox(item.quoted));
    if ((item.links || []).length) focal.appendChild(linkCards(item.links, item.text));
    focal.appendChild(el('div', 'stamp', longDate(item.createdAt)));
    body.appendChild(focal);

    if (item.article) body.appendChild(articleSection(item.article));
    if ((item.thread || []).length) {
      var t = section('Thread');
      item.thread.forEach(function (p, index) { t.appendChild(threadPost(p, index < item.thread.length - 1)); });
      body.appendChild(t);
    }
    if ((item.authorReplies || []).length) {
      var ar = section('Author in the replies');
      item.authorReplies.forEach(function (p) { ar.appendChild(threadPost(p, false)); });
      body.appendChild(ar);
    }
    if ((item.replies || []).length) {
      var rp = section('Top replies');
      item.replies.forEach(function (p) { rp.appendChild(threadPost(p, false, { likes: true })); });
      body.appendChild(rp);
    }

    var filed = el('div', 'tags');
    (item.folderIds || []).forEach(function (id) {
      var f = folderById(id);
      var b = el('button', 'chip', f ? f.path : id);
      b.type = 'button';
      b.onclick = function () { state.folder = id; closeReader(); refresh(); };
      filed.appendChild(b);
    });
    (item.tags || []).forEach(function (tag) {
      var b = el('button', 'chip', '#' + tag);
      b.type = 'button';
      b.setAttribute('aria-pressed', state.tags.has(tag) ? 'true' : 'false');
      b.onclick = function () { closeReader(); toggleTag(tag); };
      filed.appendChild(b);
    });
    if (filed.childNodes.length) body.appendChild(filed);
    reader.appendChild(body);
    reader.scrollTop = 0;
  }

  // ---- selection and panels
  function markSelected() {
    list.querySelectorAll('.post[aria-selected="true"]').forEach(function (r) { r.setAttribute('aria-selected', 'false'); r.tabIndex = -1; });
    var r = current ? $('p-' + current) : null;
    if (r) { r.setAttribute('aria-selected', 'true'); r.tabIndex = 0; }
    else if (list.firstChild && list.firstChild.classList.contains('post')) list.firstChild.tabIndex = 0;
    return r;
  }
  function select(id, opts) {
    opts = opts || {};
    current = id;
    state.post = id;
    ensureRow(id);
    var r = markSelected();
    if (r && opts.focus) { r.focus({ preventScroll: true }); r.scrollIntoView({ block: 'nearest' }); }
    renderReader();
    if (opts.open && !wideQuery.matches) openReader();
    writeHash();
  }
  // while a panel covers the page, what's under it can't take focus
  function cover(on, nodes) { nodes.forEach(function (n) { n.inert = on; }); }
  function openReader() {
    document.body.classList.add('reading');
    cover(true, [$('side'), list.parentNode]);
    reader.focus({ preventScroll: true });
  }
  function closeReader() {
    if (!document.body.classList.contains('reading')) return;
    document.body.classList.remove('reading');
    cover(false, [$('side'), list.parentNode]);
    var r = current ? $('p-' + current) : null;
    if (r) r.focus({ preventScroll: true });
  }
  function openSide() {
    document.body.classList.add('siding');
    cover(true, [list.parentNode]);
    $('folders').querySelector('button').focus();
  }
  function closeSide() {
    if (!document.body.classList.contains('siding')) return;
    document.body.classList.remove('siding');
    cover(false, [list.parentNode]);
    $('side-open').focus({ preventScroll: true });
  }
  function move(step) {
    if (!shown.length) return;
    var index = shown.findIndex(function (i) { return i.id === current; });
    var next = shown[Math.max(0, Math.min(shown.length - 1, index + step))];
    if (next) select(next.id, { focus: true });
  }

  function refresh() {
    buildAside();
    renderFeed();
    var keep = current && shown.some(function (i) { return i.id === current; });
    current = keep ? current : (shown[0] ? shown[0].id : null);
    if (!keep) state.post = null;
    markSelected();
    renderReader();
    search.value = state.q;
    $('media').setAttribute('aria-pressed', state.media ? 'true' : 'false');
    $('sort').value = state.sort;
    writeHash();
  }

  // ---- lightbox
  var lbReturn = null;
  function closeLightbox() {
    var lb = $('lb');
    if (lb.hidden) return;
    lb.textContent = ''; lb.hidden = true;
    $('app').inert = false;
    if (lbReturn) lbReturn.focus({ preventScroll: true });
  }
  function openLightbox(m) {
    if (!m || !(m.url || m.preview)) return;
    var lb = $('lb');
    lbReturn = document.activeElement;
    lb.textContent = '';
    var node;
    if ((m.type === 'video' || m.type === 'gif') && m.url) {
      node = el('video');
      node.src = m.url; node.controls = true; node.autoplay = true; node.playsInline = true; node.loop = m.type === 'gif';
    } else {
      node = el('img');
      node.src = m.url || m.preview; node.alt = m.alt || '';
    }
    node.tabIndex = -1;
    lb.appendChild(node);
    lb.hidden = false;
    $('app').inert = true;
    node.focus();
  }

  // ---- events
  list.addEventListener('click', function (e) {
    var r = e.target.closest('.post');
    if (r) select(r.dataset.id, { open: true });
  });
  list.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); move(-shown.length); }
    else if (e.key === 'End') { e.preventDefault(); move(shown.length); }
    else if (e.key === 'Enter' && current) { e.preventDefault(); if (!wideQuery.matches) openReader(); else reader.focus(); }
  });
  var typing = null;
  search.addEventListener('input', function () {
    clearTimeout(typing);
    typing = setTimeout(function () { state.q = search.value.trim(); refresh(); window.scrollTo(0, 0); }, 90);
  });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; refresh(); });
  $('media').addEventListener('click', function () { state.media = !state.media; refresh(); });
  $('side-open').addEventListener('click', openSide);
  $('folders').addEventListener('click', closeSide);
  $('scrim').addEventListener('click', function () { closeSide(); closeReader(); });
  $('lb').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    var inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (!$('lb').hidden) { closeLightbox(); return; }
      if (document.body.classList.contains('reading')) { closeReader(); return; }
      if (document.body.classList.contains('siding')) { closeSide(); return; }
      if (state.q) { state.q = ''; refresh(); }
      return;
    }
    if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); search.focus(); }
    else if (e.key === 'j') move(1);
    else if (e.key === 'k') move(-1);
    else if (e.key === 'o' && current) window.open(byId[current].url || ('https://x.com/i/status/' + current), '_blank', 'noopener');
  });
  wideQuery.addEventListener('change', function () { if (wideQuery.matches) closeReader(); });

  parseHash();
  var linked = state.post && byId[state.post] ? state.post : null;
  if (linked) current = linked;
  refresh();
  if (linked) {
    var target = ensureRow(linked);
    if (target) {
      // rows below the fold have estimated heights until rendered, so settle the scroll a few times
      var jump = function () { target.scrollIntoView({ block: 'center' }); };
      jump(); setTimeout(jump, 300); setTimeout(jump, 900);
    }
    if (!wideQuery.matches) openReader();
  }
})();
