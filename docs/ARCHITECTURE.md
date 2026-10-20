# Architecture

`x-bookmarks-mcp` is a single-process Node tool. It talks to the same private GraphQL endpoints as the x.com web client, using the cookies you export from a logged-in browser. No browser automation, no official API, no server.

```
CLI (src/cli.js)          MCP server (src/mcp.js)
        \                       /
         \                     /
          actions.js  ──  viewer.js
               |
     ┌─────────┼───────────┬────────────┐
   x.js    store.js     cobalt.js    queryids.js
     |         |            |             |
  safety.js  data/*.json  cobalt API   x.com/i/jf bundles
  tid.js
```

## Modules

| File | Responsibility |
| --- | --- |
| `src/config.js` | Loads `.env`, resolves auth (`.env` or `auth.json`), bearer token, cobalt settings, data paths |
| `src/errors.js` | `XAccessError` with `code`, `status`, `hint`; shared auth and cobalt hints |
| `src/features.js` | GraphQL feature flags per operation (`BASE_FEATURES`, `bookmarkFeatures`, `bookmarkFolderFeatures`, `tweetFeatures`, `compactFeatures`) |
| `src/queryids.js` | Resolves and caches GraphQL query ids, then retries alternates when X rejects one |
| `src/x.js` | `XClient`: headers, request loop, status handling, timeline/folder/tweet/viewer calls |
| `src/normalize.js` | Turns raw GraphQL payloads into the stable item shape, parses folder lists, renders markdown |
| `src/store.js` | JSON store: items, folders (nested), tags, counts, search |
| `src/safety.js` | Serialized queue, spacing, cooldown, write budget, write gate |
| `src/tid.js` | Generates `x-client-transaction-id` for writes, with an env override and a failure cache |
| `src/actions.js` | Use-case layer shared by CLI and MCP: sync, list, search, folders, tags, media, export, doctor |
| `src/cobalt.js` | cobalt client for video and GIF URLs, file download and filename sanitizing |
| `src/linkpreview.js` | Fetches OG metadata for external links, caches it for 14 days |
| `src/viewer.js` | Generates the standalone `data/view.html` viewer |
| `src/mcp.js` | Registers the MCP tools and maps errors to text results |
| `src/cli.js` | Command-line interface |

## Request pipeline

Every X request goes through `XClient.request`:

1. `schedule(kind, task)` puts the request in one global queue. Reads wait `900 ms + jitter(400)`, writes `6000 ms + jitter(3000)`. If a cooldown is active, it throws before sending.
2. `getQueryId(operation)` resolves the query id (see below).
3. Writes build the URL `/graphql/{queryId}/{operation}`, generate a transaction id, and send a JSON body. Reads send `variables`, `features`, and `fieldToggles` as query params.
4. Status handling:
   - `429`: persist a cooldown (`data/rate.json`), throw, never retry.
   - `401`: auth error with cookie instructions.
   - `403`: account, session, or entitlement error.
   - `400`/`404`: treat as a stale query id when the body mentions the query or the status is `404`. Invalidate the cache, refresh it, retry. If it fails again, swap in the next known candidate. Give up after 3 attempts.
   - `5xx` on reads: exponential backoff, max 3 attempts. Writes never auto-retry.
5. `assertNoErrors` translates GraphQL `errors[]` into `XAccessError` with codes such as `FOLDERS_UNAVAILABLE` and `AUTH_FAILED`.

## Query id resolution

Order in `getQueryId`:

1. `X_QUERY_ID_<OPERATION>` env override.
2. `data/queryids.json` cache, valid for 24 hours.
3. `fa0311/twitter-openapi` placeholder registry (one request, covers common operations).
4. Bundle scan of `https://x.com/i/jf/`: the responsive web bundles still list `queryId` and `operationName` pairs. All found ids are cached, and the scan is skipped for 24 hours unless invalidated.
5. Hardcoded candidates in `queryids.js`.

`invalidateQueryId` also clears the scan marker so a rejected id triggers a fresh scan.

## Storage

`data/bookmarks.json` (schema version 2):

```json
{
  "version": 2,
  "updatedAt": "2026-10-21T12:00:00.000Z",
  "foldersUpdatedAt": null,
  "xFoldersAvailable": false,
  "account": { "id": "...", "username": "...", "name": "...", "verified": false },
  "folders": {
    "local:design": { "id": "local:design", "name": "Design", "kind": "local", "parentId": null, "createdAt": "..." },
    "local:design-frontend": { "id": "local:design-frontend", "name": "Frontend", "kind": "local", "parentId": "local:design" }
  },
  "items": {
    "1759123456789012345": {
      "id": "1759123456789012345",
      "author": { "username": "someone", "name": "Someone" },
      "text": "...",
      "createdAt": "2026-10-01T00:00:00.000Z",
      "url": "https://x.com/someone/status/1759123456789012345",
      "media": [],
      "links": [],
      "quoted": null,
      "folderIds": ["local:design-frontend"],
      "tags": ["claude"],
      "firstSeenAt": "...",
      "lastSeenAt": "..."
    }
  }
}
```

Other files under `data/`:

| File | Purpose |
| --- | --- |
| `queryids.json` | Query id cache plus `__scannedAt` marker |
| `rate.json` | Cooldown timestamp and write timestamps for the hourly budget |
| `view.html` | Generated viewer, embeds a snapshot of the store |
| `media/` | Downloaded photos, videos, GIFs |

`data/` is gitignored. It contains personal content and must never be published.

## Flows

**Sync**: paged `Bookmarks` reads, newest first, merged into `items`. Incremental mode stops at the first page that adds nothing. Local folder and tag membership survive merges because `upsertItems` keeps existing `folderIds` and `tags` when a fresh item omits them.

**List**: live page from X for the main timeline or an X folder; cached read for local folders, where a parent selects its whole subtree. Local listing uses a numeric cursor (offset), X uses the GraphQL cursor.

**Search**: pure cache. Substring terms over text, author, tags, link URLs, and media alt text; optional author, date range, media type, folder subtree, and tag filters.

**Folders**: local folders live only in the store, support nesting through `parentId`, and can hold a post in several places. X folders go through the gated write path and are mirrored into the same `folders` map with `kind: "x"`.

**Tags**: a separate array on each item, normalized to lowercase with dashes. Free and instant.

**Export**: markdown with author, date, text, links, media, quoted post, folder paths, tags, and source URL; or raw JSON of the store plus items.

**Viewer**: builds the same data into one HTML file with embedded JSON. Filtering, sorting, and search run in the browser. No network calls except image loads from `pbs.twimg.com`.

## Error model

All expected failures are `XAccessError`:

```js
new XAccessError(message, { hint, code, status })
```

Codes currently used: `AUTH_FAILED`, `FOLDERS_UNAVAILABLE`, `GRAPHQL_ERROR`, `NETWORK`. The CLI prints `message` then `hint`; MCP returns the same text with `isError: true`.

## Non-goals

- No likes, follows, retweets, posts, or DMs.
- No browser automation, no headless login, no password handling.
- No official API keys, no paid tier assumptions.
- No background daemon. Every run is a one-shot process.
