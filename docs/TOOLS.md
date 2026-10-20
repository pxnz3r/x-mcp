# MCP tool reference

Server entry point: `src/mcp.js`. Tools are read-mostly; the only X writes are `folder_assign` and `folder_create` with `scope: "x"`.

## Client setup

opencode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "x-bookmarks": {
      "type": "local",
      "command": ["node", "/absolute/path/to/x-access-tool/src/mcp.js"],
      "enabled": true
    }
  }
}
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "x-bookmarks": {
      "command": "node",
      "args": ["/absolute/path/to/x-access-tool/src/mcp.js"]
    }
  }
}
```

Windows JSON needs escaped backslashes, for example `C:\\tools\\x-access-tool\\src\\mcp.js`.

## Tools

### `x_doctor`

No arguments. Runs read-only checks in order: cookies, identity, one bookmark page, folder access, write settings, cobalt. Returns `{ ok, checks[], hint? }`. `ok` covers cookies, identity, and bookmarks only.

### `x_whoami`

No arguments. Returns `{ id, name, username, verified }` from the `Viewer` operation.

### `bookmarks_list`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | int 1-100 | 20 | |
| `cursor` | string | none | `nextCursor` from a previous call |
| `folder` | string | none | Folder id or path. Local folder reads come from the cache and include subfolders; X folder reads are live |

Returns `{ account, folder, count, nextCursor, items[] }`.

### `bookmarks_sync`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `maxPages` | int 1-500 | 50 | 20 posts per page |
| `incremental` | bool | true | Stop at the first page that adds nothing |

Returns `{ pages, added, refreshed, incremental, total, syncedAt, stoppedEarly }`.

### `bookmarks_search`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | none | Every whitespace-separated term must match text, author, tags, links, or alt text |
| `author` | string | none | Username or display name, with or without `@` |
| `folder` | string | none | Includes subfolders |
| `tag` | string | none | |
| `since`, `until` | ISO date | none | |
| `media` | `any\|photo\|video\|gif` | none | |
| `limit` | int 1-500 | 50 | |

Returns `{ count, totalCached, cachedAt, items[], hint? }`. Cache only.

### `bookmark_get`

`id` (numeric string). Returns one cached item, or fetches it from X and caches it.

### `folders_list`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `refresh` | bool | false | Re-fetch the X folder list |
| `syncContents` | bool | false | Walk every X folder and rebuild membership |

Returns `{ folders[], tags[], xFoldersAvailable, cachedAt, synced, safety }`. Each folder has `{ id, name, kind, parentId, path, cachedBookmarks, totalBookmarks }`. `totalBookmarks` includes subfolders.

### `folder_assign`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `ids` | string[] 1-500 | required | Numeric post ids |
| `folder` | string | required | Path like `Design/Frontend` |
| `scope` | `local\|x` | `local` | `local` writes only to the cache |
| `remove` | bool | false | Remove instead of add |
| `confirm` | bool | false | `scope: "x"` only |
| `dryRun` | bool | false | `scope: "x"` only |

Local: creates missing folders, adds the post without removing other folders, returns `{ kind, folder, action, changed, mixed, missing, cachedBookmarks }`.

X: requires Premium, `X_ALLOW_WRITES=true`, and `confirm: true`. Max 25 ids. Returns a preview until confirmed; moves the post because X allows one folder per bookmark.

### `folder_create`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | string 1-200 | required | Slashes create nested local folders |
| `scope` | `local\|x` | `local` | |
| `confirm` | bool | false | `scope: "x"` only |

### `folder_delete`

`folder` (id or path). Deletes a local folder, its subfolders, and their memberships. Rejects X folders.

### `tags_assign`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `ids` | string[] 1-500 | required | |
| `tags` | string[] 1-20 | required | Leading `#` and spaces are normalized |
| `remove` | bool | false | |

Returns `{ action, tags, changed, mixed, missing, allTags }`.

### `tags_list`

No arguments. Returns `{ tags: [{ tag, count }], cached }`.

### `media_get`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `tweetId` | numeric string | required | |
| `index` | int | all | Media index from a previous result |
| `download` | bool | false | Save under `data/media/<post id>/` |
| `outDir` | string | none | Custom download directory |

Photos resolve to the public CDN URL. Videos and GIFs go through cobalt. Downloads write only under `outDir` or `data/media`.

### `bookmarks_export`

| Arg | Type | Default | Notes |
| --- | --- | --- | --- |
| `format` | `markdown\|json` | markdown | |
| `out` | string | `data/bookmarks-<stamp>.md` | |

### `cobalt_check`

No arguments. Pings `COBALT_API_URL` and reports reachability.

### `safety_status`

No arguments. Returns writes enabled, current cooldown, hourly budget, max writes per call, and spacing.

## Error handling

Failures return `isError: true` with a message and a hint. Codes: `NETWORK`, `AUTH_FAILED`, `FOLDERS_UNAVAILABLE`, `GRAPHQL_ERROR`, plus HTTP `status` for `401`, `403`, `429`, and `404`.

On `429`, stop calling every tool until `safety_status` reports zero cooldown.
