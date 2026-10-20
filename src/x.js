import { bearerToken, requireAuth, userAgent } from './config.js';
import { AUTH_HINT, XAccessError } from './errors.js';
import { BASE_FEATURES, bookmarkFeatures, bookmarkFolderFeatures, compactFeatures, tweetFeatures } from './features.js';
import { normalizeTweet, parseFolderList, parseTimeline } from './normalize.js';
import { getQueryId, invalidateQueryId, candidatesFor, rememberQueryId } from './queryids.js';
import { backoff, noteRateLimit, schedule } from './safety.js';
import { transactionId } from './tid.js';

function retryAfterSeconds(res) {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter);
  const reset = res.headers.get('x-rate-limit-reset');
  if (reset && /^\d+$/.test(reset)) {
    return Math.max(30, Number(reset) - Math.floor(Date.now() / 1000));
  }
  return 900;
}

function assertNoErrors(payload, label) {
  if (payload?.errors?.length) {
    const message = payload.errors[0]?.message ?? 'unknown error';
    if (/not authorized to use bookmark collections/i.test(message)) {
      throw new XAccessError('This X account cannot use bookmark folders.', {
        code: 'FOLDERS_UNAVAILABLE',
        hint: 'Bookmark folders are an X Premium feature, so this account either lacks Premium or has not been given access yet. Reading, searching, and exporting bookmarks still work.',
      });
    }
    if (/could not authenticate|bad authentication data/i.test(message)) {
      throw new XAccessError('X rejected the saved cookies.', { code: 'AUTH_FAILED', status: 401, hint: AUTH_HINT });
    }
    throw new XAccessError(`${label} failed: ${message}`, { code: 'GRAPHQL_ERROR' });
  }
  return payload?.data ?? {};
}

export class XClient {
  constructor(auth = requireAuth()) {
    this.auth = auth;
  }

  headers(kind = 'read') {
    const headers = {
      authorization: `Bearer ${bearerToken()}`,
      'x-csrf-token': this.auth.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      cookie: `auth_token=${this.auth.authToken}; ct0=${this.auth.ct0}`,
      'user-agent': userAgent,
      referer: 'https://x.com/i/bookmarks',
      accept: '*/*',
    };
    if (kind === 'write') {
      headers.origin = 'https://x.com';
      headers['content-type'] = 'application/json';
    }
    return headers;
  }

  async request(operationName, { variables, features, fieldToggles, method = 'GET' } = {}) {
    const maxAttempts = 3;
    const isWrite = method !== 'GET';
    let refreshedQueryId = false;
    const triedIds = new Set();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const queryId = await getQueryId(operationName, { fresh: refreshedQueryId });
      triedIds.add(queryId);
      const apiPath = `/i/api/graphql/${queryId}/${operationName}`;
      const params = new URLSearchParams({ variables: JSON.stringify(variables ?? {}) });
      if (features) params.set('features', JSON.stringify(compactFeatures(features)));
      if (fieldToggles) params.set('fieldToggles', JSON.stringify(fieldToggles));

      const headers = this.headers(isWrite ? 'write' : 'read');
      let body;
      if (isWrite) {
        const ticket = await transactionId(method, `/graphql/${queryId}/${operationName}`);
        if (!ticket) {
          throw new XAccessError('Could not build the x-client-transaction-id header, so the write was not sent.', {
            hint: 'This avoids sending a malformed write to X. Retry in a minute, or set X_CLIENT_TRANSACTION_ID from a captured browser request.',
          });
        }
        headers['x-client-transaction-id'] = ticket;
        body = JSON.stringify({
          variables: variables ?? {},
          queryId,
          ...(features ? { features: compactFeatures(features) } : {}),
          ...(fieldToggles ? { fieldToggles } : {}),
        });
      }

      const url = isWrite ? `https://x.com${apiPath}` : `https://x.com${apiPath}?${params}`;
      let res;
      try {
        res = await schedule(isWrite ? 'write' : 'read', () =>
          fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) }),
        );
      } catch (error) {
        if (error instanceof XAccessError) throw error;
        throw new XAccessError('Could not reach x.com.', {
          code: 'NETWORK',
          hint: `Check your connection, VPN, or proxy, then retry. (${error?.message ?? error})`,
        });
      }
      const text = await res.text();

      if (res.status === 429) {
        const until = noteRateLimit(retryAfterSeconds(res));
        throw new XAccessError(`X rate limited this account (429). All requests paused until ${new Date(until).toLocaleString()}.`, {
          status: 429,
          hint: 'The tool now refuses to send anything until the cooldown ends, which is the safest response to a 429.',
        });
      }

      if (res.status === 401) {
        throw new XAccessError('X rejected the saved cookies (401).', { status: 401, hint: AUTH_HINT });
      }

      if (res.status === 403) {
        throw new XAccessError('X refused the request (403).', {
          status: 403,
          hint: 'The account may be locked, the session stale, or this account lacks the feature. Log in on x.com again and refresh auth_token/ct0.',
        });
      }

      if (res.status === 400 || res.status === 404) {
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {
        }
        const message = payload?.errors?.[0]?.message ?? text.slice(0, 300);
        const staleQuery = res.status === 404 || /query|operation|graphql/i.test(message);

        if (staleQuery && attempt < maxAttempts) {
          if (!refreshedQueryId) {
            refreshedQueryId = true;
            invalidateQueryId(operationName);
            continue;
          }
          const alternate = candidatesFor(operationName).find((id) => !triedIds.has(id));
          if (alternate) {
            rememberQueryId(operationName, alternate);
            continue;
          }
        }

        const envName = 'X_QUERY_ID_' + operationName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
        throw new XAccessError(`X rejected the ${operationName} request (${res.status}): ${message}`, {
          status: res.status,
          hint:
            res.status === 404
              ? `The ${operationName} endpoint or its query id is no longer recognized (404). Run node src/cli.js doctor; if it persists, copy the current id from a browser request into ${envName}.`
              : `Set ${envName} from a current x.com request if this keeps happening.`,
        });
      }

      if (res.status >= 500 && attempt < maxAttempts) {
        await backoff(attempt);
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new XAccessError(`X returned a non-JSON response for ${operationName} (${res.status}).`, {
          status: res.status,
          hint: text.slice(0, 300),
        });
      }

      return payload;
    }

    throw new XAccessError(`Gave up on ${operationName} after ${maxAttempts} attempts.`);
  }

  async getBookmarksPage({ cursor = null, count = 20 } = {}) {
    const variables = { count, includePromotedContent: true };
    if (cursor) variables.cursor = cursor;

    const payload = await this.request('Bookmarks', { variables, features: bookmarkFeatures() });
    const data = assertNoErrors(payload, 'Bookmarks');
    return { ...parseTimeline(data), errors: payload.errors ?? [] };
  }

  async getFolderPage({ folderId, cursor = null, count = 20 } = {}) {
    const variables = { count, includePromotedContent: true, bookmark_collection_id: String(folderId) };
    if (cursor) variables.cursor = cursor;

    const payload = await this.request('BookmarkFolderTimeline', {
      variables,
      features: bookmarkFolderFeatures(),
    });
    const data = assertNoErrors(payload, 'BookmarkFolderTimeline');
    return { ...parseTimeline(data), errors: payload.errors ?? [] };
  }

  async listFolders({ cursor = null } = {}) {
    const variables = cursor ? { cursor } : {};
    const payload = await this.request('BookmarkFoldersSlice', { variables });
    const data = assertNoErrors(payload, 'BookmarkFoldersSlice');
    return parseFolderList(data);
  }

  async getTweet(id) {
    const variables = { tweetId: String(id), withCommunity: false, includePromotedContent: false, withVoice: false };
    const fieldToggles = { withArticleRichContentState: true, withArticlePlainText: false, withGrokAnalyze: false };
    const payload = await this.request('TweetResultByRestId', {
      variables,
      features: tweetFeatures(),
      fieldToggles,
    });
    const result = payload.data?.tweetResult?.result;
    return result ? normalizeTweet(result) : null;
  }

  async addToFolder(tweetId, folderId) {
    const payload = await this.request('bookmarkTweetToFolder', {
      method: 'POST',
      variables: { tweet_id: String(tweetId), bookmark_collection_id: String(folderId) },
    });
    return assertNoErrors(payload, 'bookmarkTweetToFolder');
  }

  async createFolder(name) {
    const payload = await this.request('createBookmarkFolder', {
      method: 'POST',
      variables: { name: String(name) },
    });
    return assertNoErrors(payload, 'createBookmarkFolder');
  }

  async getViewer() {
    const payload = await this.request('Viewer', { variables: {}, features: BASE_FEATURES });
    const result = payload?.data?.viewer?.user_results?.result;
    if (!result) {
      throw new XAccessError('X answered the account lookup but returned no account.', {
        hint: 'The Viewer response shape may have changed. Run node src/cli.js doctor and open an issue with the output.',
      });
    }
    const core = result.core ?? {};
    const legacy = result.legacy ?? {};
    return {
      id: result.rest_id ?? null,
      name: core.name ?? legacy.name ?? null,
      username: core.screen_name ?? legacy.screen_name ?? null,
      verified: Boolean(result.is_blue_verified ?? legacy.verified),
    };
  }
}

let shared = null;

export function getClient() {
  if (!shared) shared = new XClient();
  return shared;
}
