---
name: x-bookmarks
description: Read, search, organize, and export the user's own X (Twitter) bookmarks through the x-bookmarks-mcp repo (MCP server or CLI). Use when the user asks to look through saved X posts, file or tag them, build a reading list, download media from a bookmark, or audit their bookmark cache. Requires browser cookies in .env; do not attempt without them.
---

# X bookmarks

Personal bookmark tool. Reads the user's own bookmarks through their logged-in x.com session. Local cache makes search, folders, tags, export, and the viewer work offline.

## Before you start

1. Confirm the repo is installed: `package.json` has `@modelcontextprotocol/sdk`, `zod`, `x-client-transaction-id`.
2. Confirm credentials exist without printing them: run `node src/cli.js doctor`.
3. If `doctor` fails on `cookies`, stop and ask the user to copy `auth_token` and `ct0` from DevTools > Application > Cookies > `https://x.com` into `.env`. Never ask for them in chat.

## Tool map

| Need | Tool |
| --- | --- |
| Health check | `x_doctor` |
| Who is logged in | `x_whoami` |
| Fresh page from X | `bookmarks_list` |
| Fill the cache | `bookmarks_sync` |
| Find saved posts | `bookmarks_search` |
| One post in full | `bookmark_get` |
| Folder tree and tags | `folders_list` |
| File posts | `folder_assign` |
| New folder | `folder_create` |
| Delete local folder | `folder_delete` |
| Apply labels | `tags_assign` |
| List labels | `tags_list` |
| Media URLs or download | `media_get` |
| Markdown or JSON | `bookmarks_export` |
| Rate and write status | `safety_status` |

## Local URLs

`bookmarks_list`, `bookmarks_search`, and `bookmark_get` return `localUrl` per post: a `file://` link to the generated viewer that opens scrolled to that post. Offer it when the user wants to open a bookmark in their own viewer instead of on x.com.

## Standard workflow

1. `bookmarks_sync` (incremental is fine) so the cache is fresh.
2. `bookmarks_search` with `folder`, `tag`, `query`, `author`, or date filters.
3. Read hits with `bookmark_get`, or summarize from the returned item text.
4. Organize with `folder_assign` and `tags_assign` using ids you actually read.
5. Finish with `bookmarks_export` if the user wants a file, or tell them to run `node src/cli.js view` for the browser view. Run `node src/cli.js links` first if they want OG link cards.

## Organizing rules

- Local folders are the default and cost nothing: `scope: "local"`, no confirmation, no X request.
- Folders nest with slashes: `Design/Frontend/Glass`. Creating a folder is just assigning into it.
- A post can be in several local folders. Tags are a separate cross-cutting axis; prefer tags for properties and folders for placement.
- Never tag or file ids that are not in the cache. `folder_assign` reports `missing`; run a sync or `bookmark_get` first.
- Before bulk tagging, show the user the proposed folder tree and tag set, then apply after approval. Everything is reversible with `folder_delete` and `tags_assign` with `remove: true`.

## X folder writes

Only with `scope: "x"`, and only when the user explicitly asks for real X folders. Requires X Premium, `X_ALLOW_WRITES=true`, and `confirm: true`. Without confirmation these calls return a preview and change nothing. Do not enable writes on your own.

## Safety limits

- One serialized request queue, reads about 1 per second, writes 6 to 9 seconds apart.
- On `429`, every tool is paused until the cooldown expires. Do not retry around it.
- 30 writes per hour by default, 25 per call. Do not raise the budget without being asked.
- Reads are cheap. Prefer cache search over repeated `bookmarks_list` calls.

## Error playbook

| Error | Action |
| --- | --- |
| `401` or "cookies" | Ask the user to refresh `auth_token` and `ct0`. |
| `403` | Stale session, locked account, or missing entitlement. Report, do not retry. |
| `404` on an operation | Usually a rotated query id. One automatic retry happens; if it persists, run `x_doctor` and report. |
| `FOLDERS_UNAVAILABLE` / "cannot use bookmark folders" | Account lacks Premium. Use local folders and say so. |
| `429` | Stop. Report the cooldown from `safety_status`. |
| `Writes are disabled` | Expected. Do not change `.env`. |
| `Could not reach x.com` | Network, VPN, or proxy. Not an auth problem. |

## Data handling

- `data/bookmarks.json` holds the cache, account handle, folders, and tags. Never print the whole file or paste it elsewhere.
- Never print `.env`, `auth.json`, cookie values, or full GraphQL payloads.
- Exports and the viewer contain personal content. Treat them as private.
- Media downloads go to `data/media/` by default. Report paths, not file contents.

## Viewer

`node src/cli.js view` regenerates `data/view.html` and opens it. Use it when the user wants to browse visually. Regenerate after any sync or organization change.
