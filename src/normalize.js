function unwrap(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.__typename === 'TweetWithVisibilityResults') return unwrap(result.tweet);
  if (result.__typename === 'TweetUnavailable' || result.__typename === 'TweetTombstone') return null;
  return result;
}

function normalizeUser(result) {
  const user = result?.core?.user_results?.result ?? {};
  const core = user.core ?? {};
  const legacy = user.legacy ?? {};
  const username = core.screen_name ?? legacy.screen_name ?? '';
  return {
    id: user.rest_id ?? legacy.id_str ?? null,
    name: core.name ?? legacy.name ?? '',
    username,
    verified: Boolean(user.is_blue_verified ?? legacy.verified),
    avatar: user.avatar?.image_url ?? legacy.profile_image_url_https ?? null,
  };
}

function normalizeMedia(media) {
  if (!media) return null;
  const original = media.original_info ?? {};
  const base = {
    width: original.width ?? null,
    height: original.height ?? null,
    alt: media.ext_alt_text ?? null,
  };

  if (media.type === 'photo') {
    return {
      type: 'photo',
      url: `${media.media_url_https}?name=orig`,
      preview: media.media_url_https ?? null,
      ...base,
    };
  }

  const variants = (media.video_info?.variants ?? []).filter((v) => v.url && v.content_type === 'video/mp4');
  variants.sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
  const best = variants[0] ?? (media.video_info?.variants ?? []).find((v) => v.url) ?? null;

  return {
    type: media.type === 'animated_gif' ? 'gif' : 'video',
    url: best?.url ?? null,
    preview: media.media_url_https ?? media.preview_image_url ?? null,
    durationMs: media.video_info?.duration_millis ?? null,
    bitrate: best?.bit_rate ?? null,
    ...base,
  };
}

function collectEntities(legacy, noteResult) {
  const sources = [legacy?.entities, noteResult?.entity_set].filter(Boolean);
  const urls = sources.flatMap((e) => e.urls ?? []);
  return {
    urls,
    mediaUrls: sources.flatMap((e) => e.media ?? []).map((m) => m.url).filter(Boolean),
    hashtags: sources.flatMap((e) => e.hashtags ?? []).map((h) => h.text),
    mentions: sources.flatMap((e) => e.user_mentions ?? []).map((m) => m.screen_name),
  };
}

function expandText(text, urls, mediaUrls) {
  let out = text ?? '';
  for (const entry of urls) {
    if (entry?.url && entry?.expanded_url) out = out.split(entry.url).join(entry.expanded_url);
  }
  for (const mediaUrl of mediaUrls) out = out.split(mediaUrl).join('');
  return out.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// ---- X articles: Draft.js content_state -> Markdown.
// Ported from x-md (https://github.com/pc-style/x-md, lib/article-markdown.ts, MIT).
function escapeMd(text) {
  return text.replace(/[\\`*_[\]<>~]/g, '\\$&');
}

function destination(value) {
  if (!value || !/^https?:\/\//i.test(value)) return undefined;
  return value.replace(/[\s()<>\\]/g, (char) => encodeURIComponent(char).replace(/[()]/g, (paren) => `%${paren.charCodeAt(0).toString(16)}`));
}

function inlineText(block, entities) {
  const text = block.text ?? '';
  const spans = [];
  const add = (offset, length, open, close) => {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0 || offset + length > text.length) return;
    let start = offset;
    let end = offset + length;
    // Draft style ranges often include trailing spaces; Markdown delimiters cannot.
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (start < end) spans.push({ start, end, open, close });
  };
  for (const range of block.entityRanges ?? []) {
    const entity = entities.get(String(range.key));
    const url = entity?.type === 'LINK' ? destination(entity.data?.url) : undefined;
    if (url) add(range.offset, range.length, '[', `](${url})`);
  }
  for (const range of block.inlineStyleRanges ?? []) {
    const style = String(range.style).toLowerCase();
    const marker = style === 'bold' ? '**' : style === 'italic' ? '*' : style === 'strikethrough' ? '~~' : undefined;
    if (marker) add(range.offset, range.length, marker, marker);
  }
  // Keep enclosing formatting open when an inner link or style starts or ends.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const points = [...new Set([0, text.length, ...spans.flatMap((span) => [span.start, span.end])])].sort((a, b) => a - b);
  let active = [];
  let result = '';
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const next = spans.filter((span) => span.start <= start && span.end > start);
    let shared = 0;
    while (shared < active.length && active[shared] === next[shared]) shared += 1;
    result += active.slice(shared).reverse().map((span) => span.close).join('');
    result += next.slice(shared).map((span) => span.open).join('');
    if (i + 1 < points.length) result += escapeMd(text.slice(start, points[i + 1]));
    active = next;
  }
  return result.trim();
}

const HEADINGS = ['header-one', 'header-two', 'header-three', 'header-four', 'header-five', 'header-six'];

export function articleToMarkdown(article) {
  const lines = [];
  // X sends entityMap as a keyed array; older Draft payloads use an object map. Accept both.
  const rawMap = article.content_state?.entityMap ?? [];
  const entities = new Map(Array.isArray(rawMap)
    ? rawMap.map((entry) => [String(entry.key), entry.value])
    : Object.entries(rawMap).map(([key, value]) => [String(key), value]));
  const media = new Map((article.media_entities ?? []).map((item) => [String(item.media_id), item]));
  for (const block of article.content_state?.blocks ?? []) {
    if (block.type === 'atomic') {
      for (const range of block.entityRanges ?? []) {
        const entity = entities.get(String(range.key));
        if (entity?.type === 'MEDIA') {
          for (const item of entity.data?.mediaItems ?? []) {
            const url = destination(media.get(String(item.mediaId))?.media_info?.original_img_url);
            if (url) lines.push(`![image](${url})`, '');
          }
        } else if (entity?.type === 'TWEET' && entity.data?.tweetId) {
          lines.push(`> embedded post: https://x.com/i/status/${entity.data.tweetId}`, '');
        } else if (entity?.type === 'MARKDOWN' && entity.data?.markdown) {
          lines.push(entity.data.markdown.trim(), '');
        } else if (entity?.type === 'DIVIDER') {
          lines.push('---', '');
        }
      }
      continue;
    }
    const text = inlineText(block, entities);
    if (!text) continue;
    const heading = HEADINGS.indexOf(block.type ?? '');
    if (heading >= 0) lines.push(`${'#'.repeat(heading + 1)} ${text}`);
    else if (block.type === 'blockquote') lines.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
    else if (block.type === 'unordered-list-item' || block.type === 'ordered-list-item') {
      const indent = '    '.repeat(Math.min(10, Math.max(0, Math.trunc(block.depth ?? 0) || 0)));
      const marker = block.type === 'ordered-list-item' ? '1. ' : '- ';
      lines.push(`${indent}${marker}${text.replace(/\n/g, `\n${indent}${' '.repeat(marker.length)}`)}`);
    } else lines.push(text);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function normalizeArticle(result) {
  const article = result?.article?.article_results?.result;
  if (!article) return null;
  const id = article.rest_id ?? null;
  return {
    id,
    url: id ? `https://x.com/i/article/${id}` : null,
    title: article.title ?? null,
    preview: article.preview_text ?? null,
    cover: article.cover_media?.media_info?.original_img_url ?? null,
    markdown: article.content_state ? articleToMarkdown(article) || null : null,
  };
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeTweet(input, depth = 0) {
  const result = unwrap(input);
  if (!result) return null;

  const legacy = result.legacy ?? {};
  const noteResult = result.note_tweet?.note_tweet_results?.result ?? null;
  const author = normalizeUser(result);
  const entities = collectEntities(legacy, noteResult);
  const text = expandText(noteResult?.text ?? legacy.full_text ?? '', entities.urls, entities.mediaUrls);
  const media = [...(legacy.extended_entities?.media ?? legacy.entities?.media ?? [])]
    .map(normalizeMedia)
    .filter(Boolean);

  const item = {
    id: result.rest_id ?? legacy.id_str ?? null,
    url: author.username ? `https://x.com/${author.username}/status/${result.rest_id}` : null,
    author,
    text,
    createdAt: isoDate(legacy.created_at),
    lang: legacy.lang ?? null,
    isReply: Boolean(legacy.in_reply_to_status_id_str),
    replyToId: legacy.in_reply_to_status_id_str ?? null,
    conversationId: legacy.conversation_id_str ?? null,
    sensitive: Boolean(legacy.possibly_sensitive),
    metrics: {
      likes: legacy.favorite_count ?? 0,
      reposts: legacy.retweet_count ?? 0,
      replies: legacy.reply_count ?? 0,
      quotes: legacy.quote_count ?? 0,
      bookmarks: legacy.bookmark_count ?? 0,
      views: result.views?.count ? Number(result.views.count) : null,
    },
    media,
    links: entities.urls.map((u) => ({
      url: u.expanded_url ?? u.url,
      display: u.display_url ?? u.expanded_url ?? u.url,
    })),
    hashtags: entities.hashtags,
    mentions: entities.mentions,
    article: normalizeArticle(result),
    quoted: null,
    retweetedFrom: null,
  };

  if (!item.id) return null;

  if (depth < 2) {
    const quoted = legacy.quoted_status_result?.result;
    if (quoted) {
      const nested = normalizeTweet(quoted, depth + 1);
      if (nested) {
        item.quoted = {
          id: nested.id,
          url: nested.url,
          author: nested.author,
          text: nested.text,
          createdAt: nested.createdAt,
          media: nested.media,
          article: nested.article,
        };
      }
    }
    const retweeted = legacy.retweeted_status_result?.result;
    if (retweeted) {
      const nested = normalizeTweet(retweeted, depth + 1);
      if (nested) {
        item.retweetedFrom = {
          id: nested.id,
          url: nested.url,
          author: nested.author,
          text: nested.text,
          createdAt: nested.createdAt,
          media: nested.media,
        };
      }
    }
  }

  return item;
}

export function parseFolderList(payload) {
  const root = payload?.data?.viewer ? payload.data : payload;
  const slice = root?.viewer?.user_results?.result?.bookmark_collections_slice;
  const items = Array.isArray(slice?.items) ? slice.items : [];
  const folders = items
    .map((item) => ({
      id: item?.id ?? item?.collection_id ?? item?.bookmark_collection_id ?? null,
      name: item?.name ?? null,
    }))
    .filter((folder) => typeof folder.id === 'string' && folder.id && typeof folder.name === 'string');

  return {
    folders,
    nextCursor: slice?.slice_info?.next_cursor ?? null,
    valid: Boolean(slice),
  };
}

export function parseTimeline(data) {
  const items = new Map();
  let nextCursor = null;

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const value of node) visit(value);
      return;
    }

    const result = node.itemContent?.tweet_results?.result;
    if (result) {
      const item = normalizeTweet(result);
      if (item) items.set(item.id, item);
    }

    const cursorType = node.cursorType ?? node.content?.cursorType;
    const cursorValue = node.value ?? node.content?.value;
    if (typeof cursorType === 'string' && cursorType.toLowerCase() === 'bottom' && typeof cursorValue === 'string') {
      nextCursor = cursorValue;
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(data);
  return { items: [...items.values()], nextCursor };
}

// ---- Conversation around a bookmark (from TweetDetail): where the real content often lives.
function mini(item) {
  return {
    id: item.id,
    url: item.url,
    author: { username: item.author.username, name: item.author.name },
    text: item.text,
    createdAt: item.createdAt,
    replyToId: item.replyToId,
    likes: item.metrics?.likes ?? 0,
    media: item.media,
    links: item.links,
    article: item.article,
    quoted: item.quoted,
  };
}

const byTime = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));

/**
 * Split a conversation into what a reader of the bookmark needs:
 * above: the posts it replies to, root first (context when a reply was bookmarked);
 * thread: the author's continuation (posts reachable from the bookmark through the author's own replies);
 * authorReplies: the author answering other people (links and details often land here), with the post answered;
 * replies: other people's replies to the bookmark or its thread, most liked first.
 */
export function buildConversation(tweets, focalId, { maxReplies = 8 } = {}) {
  const byId = new Map(tweets.map((t) => [t.id, t]));
  const focal = byId.get(String(focalId));
  if (!focal) return null;
  const author = (focal.author.username ?? '').toLowerCase();
  const isAuthor = (t) => (t.author.username ?? '').toLowerCase() === author;

  const used = new Set([focal.id]);
  const above = [];
  for (let id = focal.replyToId; id && byId.has(id) && !used.has(id); id = byId.get(id).replyToId) {
    used.add(id);
    above.unshift(byId.get(id));
  }

  const children = new Map();
  for (const t of tweets) {
    if (!t.replyToId) continue;
    if (!children.has(t.replyToId)) children.set(t.replyToId, []);
    children.get(t.replyToId).push(t);
  }
  const thread = [];
  for (const queue = [focal.id]; queue.length;) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (!isAuthor(child) || used.has(child.id)) continue;
      used.add(child.id);
      thread.push(child);
      queue.push(child.id);
    }
  }
  thread.sort(byTime);

  // keep answers that carry something (a link, media, an article or a real explanation), not "have fun"
  const substantive = (t) => t.links?.length || t.media?.length || t.article
    || t.text.replace(/(^|\s)@\w+/g, '').trim().length >= 100;
  const authorReplies = tweets
    .filter((t) => isAuthor(t) && !used.has(t.id) && substantive(t))
    .sort(byTime)
    .map((t) => ({ ...mini(t), inReplyTo: byId.has(t.replyToId) ? mini(byId.get(t.replyToId)) : null }));
  const answered = new Set(authorReplies.map((t) => t.replyToId));

  const threadIds = new Set([focal.id, ...thread.map((t) => t.id)]);
  const replies = tweets
    .filter((t) => !isAuthor(t) && threadIds.has(t.replyToId) && !answered.has(t.id))
    .sort((a, b) => (b.metrics?.likes ?? 0) - (a.metrics?.likes ?? 0))
    .slice(0, maxReplies);

  return {
    above: above.map(mini),
    thread: thread.map(mini),
    authorReplies,
    replies: replies.map(mini),
  };
}

function quoteBlock(text) {
  return (text || '').split('\n').map((line) => `> ${line}`).join('\n');
}

function miniMarkdown(post) {
  const lines = [post.text || '_(no text)_'];
  for (const link of post.links ?? []) lines.push(`- link: ${link.url}`);
  for (const media of post.media ?? []) lines.push(`- media (${media.type}): ${media.url}`);
  if (post.article?.url) lines.push(`- article: ${post.article.title ?? ''} ${post.article.url}`);
  return lines.join('\n');
}

export function toMarkdown(item, folderNames = [], tags = []) {
  const lines = [];
  const date = item.createdAt ? item.createdAt.slice(0, 10) : 'unknown date';
  lines.push(`## @${item.author.username || 'unknown'} (${item.author.name || ''}) - ${date}`);
  lines.push('');
  const convo = item.expanded?.conversation;
  if (convo?.above?.length) {
    lines.push('Replying to:');
    for (const post of convo.above) lines.push(quoteBlock(`@${post.author.username}: ${post.text}`));
    lines.push('');
  }
  lines.push(item.text || '_(no text)_');
  lines.push('');

  for (const link of item.links) lines.push(`- link: ${link.url}`);
  for (const media of item.media) {
    lines.push(`- media (${media.type}): ${media.url}`);
    if (media.alt) lines.push(`  alt: ${media.alt}`);
  }
  const article = item.article ?? item.quoted?.article;
  if (article) {
    lines.push('');
    lines.push(`### Article: ${article.title ?? 'untitled'}`);
    if (article.url) lines.push(article.url);
    lines.push('');
    lines.push(article.markdown ?? article.preview ?? '_(article text not fetched yet: run expand)_');
  }
  if (item.quoted) {
    lines.push('');
    lines.push(`> quoted @${item.quoted.author.username}: ${item.quoted.text}`);
  }
  if (convo?.thread?.length) {
    lines.push('');
    lines.push(`### Thread (${convo.thread.length} more)`);
    for (const post of convo.thread) lines.push('', miniMarkdown(post));
  }
  if (convo?.authorReplies?.length) {
    lines.push('');
    lines.push('### Author in the replies');
    for (const post of convo.authorReplies) {
      lines.push('');
      if (post.inReplyTo) lines.push(quoteBlock(`@${post.inReplyTo.author.username}: ${post.inReplyTo.text}`));
      lines.push(miniMarkdown(post));
    }
  }
  if (convo?.replies?.length) {
    lines.push('');
    lines.push('### Top replies');
    for (const post of convo.replies) lines.push(`- @${post.author.username} (${post.likes} likes): ${post.text.replace(/\n+/g, ' ')}`);
  }
  if (folderNames.length) {
    lines.push('');
    lines.push(`Folders: ${folderNames.join(', ')}`);
  }
  if (tags.length) {
    lines.push(`Tags: ${tags.map((tag) => `#${tag}`).join(' ')}`);
  }
  lines.push('');
  lines.push(`Source: ${item.url}`);
  lines.push('');
  return lines.join('\n');
}
