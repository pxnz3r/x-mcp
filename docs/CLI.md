# CLI reference

```
node src/cli.js <command> [args] [--flags]
```

Every command accepts `--json` for machine-readable output and `--help` / `-h`.

| Command | Purpose |
| --- | --- |
| `doctor` | Read-only health checks |
| `whoami` | Show the logged-in account |
| `list` | One page of bookmarks, live from X or from a local folder |
| `sync` | Page bookmarks into the local cache |
| `search` | Search the cache |
| `get` | One post, from cache or X |
| `folders` | Folder tree with counts and tags |
| `assign` | Add or remove folder membership |
| `folder-create` | Create a folder (nested allowed) |
| `folder-delete` | Delete a local folder subtree |
| `tag` | Add or remove a tag |
| `tags` | List tags with counts |
| `links` | Fetch OG images and titles for external links |
| `view` | Generate and open the HTML viewer |
| `media` | Resolve or download post media |
| `export` | Markdown or JSON export |
| `safety` | Current write gate, cooldown, and budget |
| `cobalt-check` | Ping the cobalt instance |

## Reads

```powershell
node src/cli.js doctor [--json]
node src/cli.js whoami [--json]
node src/cli.js list [--folder PATH] [--limit 20] [--cursor CURSOR] [--json]
node src/cli.js sync [--pages 50] [--full] [--json]
node src/cli.js search "terms" [--author NAME] [--folder PATH] [--tag TAG]
                            [--since 2025-01-01] [--until 2025-12-31]
                            [--type photo|video|gif|any] [--limit 50] [--json]
node src/cli.js get <post id> [--json]
node src/cli.js folders [--refresh] [--sync] [--json]
node src/cli.js tags [--json]
```

- `list --folder` on a local folder reads the cache and includes subfolders. On an X folder it fetches live.
- `sync --full` walks until it stops adding new posts; without it, sync stops at the first page with nothing new.
- `search` requires the cache. Run `sync` first.
- Every listed post prints a `local:` line with a `file://` link into `data/view.html#post=<id>`, which opens the viewer at that post.

## Local organization

```powershell
node src/cli.js assign "Design/Frontend" 1759123456789012345 1759123456789012346
node src/cli.js assign "Design/Frontend" 1759123456789012345 --remove
node src/cli.js folder-create "Design/Frontend/Glass"
node src/cli.js folder-delete "Design/Frontend/Glass"
node src/cli.js tag claude 1759123456789012345
node src/cli.js tag claude 1759123456789012345 --remove
```

Local operations never contact X. Missing folders are created on first assign. Only cached posts can be filed or tagged.

## X folders (Premium, gated writes)

```powershell
# .env: X_ALLOW_WRITES=true
node src/cli.js assign "Reading" 1759123456789012345 --x --yes
node src/cli.js folder-create "Reading" --x --yes
```

Without `--yes` the command prints a preview and changes nothing. `--dry-run` forces the preview. X allows one folder per bookmark, so filing moves the post. Maximum 25 writes per call.

## Link previews

```powershell
node src/cli.js links [--limit 400] [--refresh] [--json]
```

Fetches the page behind each cached external link and stores its `og:image`, title, description, and site in the cache. Results are cached for 14 days in `data/link-previews.json`; misses retry after 3 days. Fetches run six at a time with a 7 second timeout. X and Twitter links are skipped because they need auth. Run it after a sync if you want cards in the viewer; `view` itself fetches nothing.

## Viewer

```powershell
node src/cli.js view [--no-open] [--out FILE] [--json]
```

Writes `data/view.html` by default and opens it in the default browser. Clicking media opens a lightbox in place; `Esc` or a click outside closes it. External links render as cards when `links` has run. `data/view.html#post=<id>` opens the viewer scrolled to one post and highlights it.

## Media and export

```powershell
node src/cli.js media 1759123456789012345
node src/cli.js media 1759123456789012345 --index 1 --download --out D:\media
node src/cli.js export --format markdown [--out FILE]
node src/cli.js export --format json [--out FILE]
```

`--out` on `media` means a directory; on `export` it means a file. Media downloads default to `data/media/<post id>/`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | `XAccessError`, unexpected failure, or a failed `doctor` run |

Errors print the message plus a hint on the next line.
