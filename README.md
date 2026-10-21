# x-bookmarks-mcp

Read, search, organize, and export your own X (Twitter) bookmarks from an AI agent or the terminal, using the session you already have in your browser. No paid API, no browser automation.

- MCP server with 16 tools, plus a full CLI
- Local cache so search, folders, tags, export, and the viewer work offline
- Nested local folders and cross-cutting tags, free and instant
- Optional real X folder writes for Premium accounts, gated behind explicit confirmation
- Media URLs and downloads through cobalt
- Link cards with real OG images and titles, cached locally
- Standalone HTML viewer with filters, a media lightbox, and link previews

## Requirements

- Node.js 20.12 or newer
- An X account, logged in on `x.com` in a browser
- X Premium only if you want folders that exist on x.com itself

## Setup

```bash
npm install
cp .env.example .env          # Windows: Copy-Item .env.example .env
```

Open `x.com` while logged in, then DevTools > Application (Chrome/Edge) or Storage (Firefox) > Cookies > `https://x.com`:

1. Copy `auth_token` into `X_AUTH_TOKEN`
2. Copy `ct0` into `X_CT0`

Or put both in `auth.json`:

```json
{ "auth_token": "...", "ct0": "..." }
```

Both files are gitignored. Cookie values are never printed.

```bash
node src/cli.js doctor
```

`doctor` checks cookies, account identity, one bookmark page, folder access, write settings, and cobalt, in that order. It is the fastest way to find what is broken.

## Use from an agent (MCP)

Server entry point: `src/mcp.js`. Use an absolute path in client configs.

opencode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "x-bookmarks": {
      "type": "local",
      "command": ["node", "/absolute/path/to/x-bookmarks-mcp/src/mcp.js"],
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
      "args": ["/absolute/path/to/x-bookmarks-mcp/src/mcp.js"]
    }
  }
}
```

Windows paths need escaped backslashes, for example `C:\\tools\\x-bookmarks-mcp\\src\\mcp.js`.

| Tool | Purpose |
| --- | --- |
| `x_doctor` | Read-only checks: cookies, identity, bookmarks, folders, writes, cobalt |
| `x_whoami` | Show the logged-in account |
| `bookmarks_list` | One fresh page of bookmarks, optionally from a folder |
| `bookmarks_sync` | Fill the local cache, incremental by default |
| `bookmarks_search` | Keyword, author, date, media, folder, and tag filters |
| `bookmark_get` | One post in full |
| `folders_list` | Folder tree with totals and tags |
| `folder_assign` | File into local folders, or an X folder with `scope: "x"` |
| `folder_create` | Create a local or X folder |
| `folder_delete` | Delete a local folder subtree |
| `tags_assign` | Add or remove tags |
| `tags_list` | Every tag with its count |
| `media_get` | Media URLs, optionally download |
| `bookmarks_export` | Markdown or JSON export |
| `cobalt_check` | Ping the cobalt instance |
| `safety_status` | Write gate, cooldown, remaining budget |

Full schemas: [docs/TOOLS.md](docs/TOOLS.md). Agent guidance: [SKILL.md](SKILL.md).

Typical agent flow: `bookmarks_sync` → `bookmarks_search` → `bookmark_get` → `folder_assign` and `tags_assign` on ids it actually read.

## CLI

```bash
node src/cli.js doctor
node src/cli.js whoami
node src/cli.js sync                     # incremental
node src/cli.js sync --full --pages 20
node src/cli.js list --limit 20
node src/cli.js list --folder "Design/Frontend"
node src/cli.js search "rust async" --folder "Design/Frontend" --tag claude --type video
node src/cli.js folders
node src/cli.js tags
node src/cli.js assign "Reading" 1759123456789012345
node src/cli.js assign "Reading" 1759123456789012345 --remove
node src/cli.js folder-create "Design/Frontend/Glass"
node src/cli.js folder-delete "Papers"
node src/cli.js tag claude 1759123456789012345
node src/cli.js links                    # fetch OG images for link cards
node src/cli.js view
node src/cli.js media 1759123456789012345 --download
node src/cli.js export --format markdown
node src/cli.js safety
```

Every command accepts `--json`. Full reference: [docs/CLI.md](docs/CLI.md).

## Viewer

`node src/cli.js view` writes `data/view.html` and opens it. One file, no server, no cookies, read-only.

- Folder tree with totals that include subfolders
- Tag chips, combine any number
- Search across text, author, tags, links, and media alt text
- Sort by newest, oldest, or author, plus a media-only toggle
- Cards show text, media thumbnails, quoted post, link cards, folder path, tags, and a link to x.com
- Click a photo or video to open it in place: no new tab, transparent backdrop, `Esc` or click outside closes
- `/` focuses search, `Esc` clears it, Reset clears everything
- Filters persist in the URL hash (`#folder=Design/Frontend&tags=gsap`), so a link restores the same view
- Every post has a local URL: `file:///.../data/view.html#post=<id>` opens the viewer scrolled to that post. The same URL is returned as `localUrl` by `list`, `search`, and `get`

Regenerate after a sync or after changing folders and tags. The viewer is read-only and makes no requests of its own beyond image CDNs; link previews are fetched once by `links` and stored in the cache.

## Folders and tags

Two folder kinds, same commands:

| Kind | Stored in | Cost | Visible on x.com |
| --- | --- | --- | --- |
| `local` (default) | `data/bookmarks.json` | free, instant, no request | no |
| `x` | your X account | Premium, gated write | yes |

Local folders nest with slashes: `"Design/Frontend/Glass"`. Listing or searching a parent includes every subfolder. A post can sit in several folders. Nothing is sent to X.

Tags are a second, cross-cutting axis. Use them for properties (tool, license, language) that should not decide placement. A post can carry many.

The folder is created on first assign if it does not exist. Only posts already in the cache can be filed or tagged, so run `sync` first.

X folders need Premium and go through the gated write path: `scope: "x"` (CLI `--x`), `X_ALLOW_WRITES=true`, and `--yes`. X allows one folder per bookmark, so an X assignment moves it. Without Premium X answers `User is not authorized to use bookmark collections`; local folders keep working.

## Safety model

Automation on a private endpoint is what can get an account flagged, so reads and writes are handled differently.

- Every request goes through one serialized queue. No parallel bursts, even with concurrent tool calls.
- Reads are spaced about 900 ms apart plus jitter. Writes are spaced 6 to 9 seconds apart.
- A `429` sets a 15 minute cooldown (longer if X sends `Retry-After`), persisted to `data/rate.json`, blocking every tool including reads.
- Reads retry on 5xx with exponential backoff, at most three attempts. Reads never auto-retry a `429`.
- Writes are off unless `X_ALLOW_WRITES=true`.
- Every write needs `confirm: true` (CLI `--yes`); otherwise you get a preview and nothing changes.
- Batch writes cap at 25 per call with a pre-flight budget check.
- A persisted budget of 30 writes per hour (`X_MAX_WRITES_PER_HOUR`) applies across processes.
- Writes stop at the first auth, entitlement, rate-limit, or transaction error.
- Sync is incremental by default, so routine runs cost one request.
- Only bookmarks and folders are touched. No likes, follows, posts, or DMs.

Maximum safety: leave writes off and use local folders.

## Media and cobalt

Videos and GIFs are resolved with [cobalt](https://github.com/imputnet/cobalt). The public `api.cobalt.tools` instance has bot protection, so point it at an instance you control:

```env
COBALT_API_URL=https://cobalt.your-host.tld
COBALT_API_KEY=optional-instance-key
```

Self-host with `docker run -p 9000:9000 ghcr.io/imputnet/cobalt:10`, then `COBALT_API_URL=http://localhost:9000`. Verify with `node src/cli.js cobalt-check`. Photos come straight from `pbs.twimg.com`.

## How it works

- Reads use the private `Bookmarks`, `BookmarkFoldersSlice`, and `BookmarkFolderTimeline` GraphQL operations through your session.
- Identity uses `Viewer`. The legacy `1.1/account/verify_credentials` endpoint returns `404` now and is no longer used.
- Writes use `bookmarkTweetToFolder` and `createBookmarkFolder`, with `x-client-transaction-id` generated by [x-client-transaction-id](https://github.com/Lqm1/x-client-transaction-id).
- Query ids rotate with X's web builds. Resolution order: env override, 24 hour disk cache, community registry, a scan of the bundles served at `x.com/i/jf/`, then hardcoded fallbacks. A rejected or `404` id is refreshed and swapped automatically.
- Responses are normalized into a stable shape and cached in `data/bookmarks.json`.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `401` | Cookies expired. Log in on x.com again and copy fresh values. |
| `403` | Account locked, stale session, or missing feature (folders without Premium). |
| `429` or `Requests are paused` | Cooldown active. Wait for `safety_status` to show zero seconds. |
| `Writes are disabled` | Set `X_ALLOW_WRITES=true` and pass confirm. |
| `Local write budget reached` | Hourly cap hit. Wait or raise `X_MAX_WRITES_PER_HOUR`. |
| `404` on any operation | Rotated query id. One automatic rescan and retry happens. If it repeats, run `doctor` and pin `X_QUERY_ID_<OPERATION>`. |
| `This X account cannot use bookmark folders` | X folders need Premium. Local folders, reads, search, and export still work. |
| `Could not reach x.com` | Connection, VPN, or proxy problem, not a cookie problem. |
| `Could not resolve a GraphQL query id` | Pin `X_QUERY_ID_<OPERATION>` from a current x.com request. |
| `cobalt error` / `403` | Instance needs a key or blocks you. Set `COBALT_API_URL` to your own. |

## Project layout

```
src/        runtime code (one concern per file)
scripts/    repository checks
docs/       architecture, tools, CLI, security, development
data/       local cache and exports, gitignored
```

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Before any push or release:

```bash
npm run check:secrets
```

It scans the tree for your cookie values, cached account handle, hardcoded token patterns, and missing `.gitignore` entries. It never prints the values.

## Security

Cookies are a full session. `.env`, `auth.json`, and `data/` are gitignored, and the tool never logs secrets. Read the full model in [docs/SECURITY.md](docs/SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Not affiliated with X. This uses private web endpoints with your own session, which is outside X's official API terms. Use it on your own account, keep cookies private, and expect breakage when X changes its web client.
