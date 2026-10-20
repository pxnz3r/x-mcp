# Security and privacy

This tool acts as your logged-in X session. Treat the credentials like a password.

## What is sensitive

| Item | Where it lives | Why it matters |
| --- | --- | --- |
| `auth_token` | `.env` or `auth.json` | Full session. Anyone holding it can act as you until you log out or change your password |
| `ct0` | `.env` or `auth.json` | CSRF token that pairs with `auth_token` |
| `data/bookmarks.json` | local | Every cached bookmark, your handle, and your folder and tag structure |
| `data/view.html` | local | Same content, rendered |
| `data/media/` | local | Downloaded media |
| `data/rate.json` | local | Only timestamps |

`.env`, `.env.*` (except `.env.example`), `auth.json`, `credentials.json`, `data/`, and export files are gitignored. Keep it that way.

## What the tool never does

- Never prints cookie values. Error messages name the variable, not the value.
- Never sends your cookies anywhere except `x.com`.
- Never writes bookmarks, likes, follows, posts, or DMs. The only X mutations are folder add and folder create, both gated.
- Never uploads your cache or exports.

## Third parties contacted

| Host | When | Data sent |
| --- | --- | --- |
| `x.com` | Any X operation | Your cookies, normal web headers |
| `x.com/i/jf/` and `abs.twimg.com` | Query id scan, at most once per 24h | No cookies |
| `raw.githubusercontent.com` | Query id registry lookup | No cookies |
| `pbs.twimg.com` | Image thumbnails in the viewer | No cookies |
| Sites behind your bookmarked links | `links` preview fetch, once per link per 14 days | The URL only, no cookies |
| Any host with an OG image | Link card images in the viewer, hotlinked by your browser | Normal image request |
| Your `COBALT_API_URL` | Video and GIF resolution | The media URL only |

If that list matters to you, self-host cobalt, leave the query id cache warm, and skip `links` so no bookmarked site is contacted.

## Write safety

Reads and writes are deliberately asymmetric:

- Writes are disabled unless `X_ALLOW_WRITES=true`.
- Every write needs explicit confirmation (`confirm: true`, CLI `--yes`). Without it you get a preview.
- One serialized queue, 6 to 9 seconds between writes, 25 writes per call, 30 per hour by default across processes.
- `429` triggers a persisted cooldown that blocks every tool, including reads.
- Writes stop at the first auth, entitlement, rate-limit, or transaction-id failure.
- Local folder and tag changes are not writes: they stay in `data/bookmarks.json`.

Default posture: keep writes off and use local folders.

## Leak check before publishing

```powershell
npm run check:secrets
```

The script reads `.env`, `auth.json`, and the cached account handle, then scans every other tracked file for those exact values plus hardcoded `auth_token=` and `ct0=` patterns. It also verifies `.gitignore` still covers `.env`, `auth.json`, and `data/`. It prints file and label only, never the value. Any hit exits 1.

Run it before every push and before publishing the repository.

## Sharing output

`doctor`, `--json` output, exports, and the viewer all contain personal content or your handle. Redact before posting logs. Cookies themselves are never included.

## Reporting

Open an issue for code-level problems. Do not paste cookies, tokens, or `data/` contents into an issue or chat.
