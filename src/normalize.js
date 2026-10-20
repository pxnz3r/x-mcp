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

export function toMarkdown(item, folderNames = [], tags = []) {
  const lines = [];
  const date = item.createdAt ? item.createdAt.slice(0, 10) : 'unknown date';
  lines.push(`## @${item.author.username || 'unknown'} (${item.author.name || ''}) - ${date}`);
  lines.push('');
  lines.push(item.text || '_(no text)_');
  lines.push('');

  for (const link of item.links) lines.push(`- link: ${link.url}`);
  for (const media of item.media) {
    lines.push(`- media (${media.type}): ${media.url}`);
    if (media.alt) lines.push(`  alt: ${media.alt}`);
  }
  if (item.quoted) {
    lines.push('');
    lines.push(`> quoted @${item.quoted.author.username}: ${item.quoted.text}`);
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
