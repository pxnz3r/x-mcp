# Development

## Setup

```powershell
npm install
Copy-Item .env.example .env   # macOS/Linux: cp .env.example .env
```

Fill `X_AUTH_TOKEN` and `X_CT0` from a logged-in browser session, then:

```powershell
node src/cli.js doctor
```

No build step. Plain ESM, Node 20.12 or newer. Dependencies: the MCP SDK, `zod`, and `x-client-transaction-id`.

## Layout

```
src/        runtime code, one concern per file (see docs/ARCHITECTURE.md)
scripts/    repository checks
docs/       architecture, tool, CLI, security, and development docs
data/       local cache, ignored by git
```

## Scripts

```powershell
npm run check:secrets   # leak scan; run before every push
npm run mcp             # start the MCP server on stdio
node src/cli.js doctor  # live smoke test against your account
node src/cli.js view    # regenerate the viewer
```

There is no test suite. Verification is manual and uses the real session:

1. `node --check` on every changed file.
2. `node src/cli.js doctor` for cookies, identity, and one live page.
3. The affected command with a small limit.
4. `npm run check:secrets` when touching config, docs, or gitignore.

Offline paths (search, folders, tags, viewer, export) can be exercised without network access, which is useful for UI changes.

## Adding an X operation

1. Add the operation name and known query ids to `CANDIDATES` in `src/queryids.js`.
2. Add a method to `XClient` in `src/x.js`. Reads pass `features` and `variables`; writes pass `method: 'POST'`.
3. Parse the payload in `src/normalize.js` and extend the item shape only if necessary.
4. Expose a use case in `src/actions.js`, then wire it into `src/mcp.js` and `src/cli.js`.
5. Update `docs/TOOLS.md` and `docs/CLI.md`.

Reads should stay idempotent. Writes must call `requireWrites()` and `spendMutation()` and stop on `401`, `403`, `429`, or a transaction-id failure.

## Adding a tool

Register it in `src/mcp.js` with a title, a description that tells an agent when to use it, and a zod schema. Descriptions are the agent's only documentation, so state defaults and side effects. Mark writes explicitly and mention the confirmation requirement.

## Conventions

- `XAccessError` for anything expected; include a `hint` when the user can act on it.
- Never log credentials or full payloads.
- Keep `data/` writes behind `store.js`.
- Local-first: if a feature can work offline, do that before adding a request.
- One request per user action unless paging is the point.

## Release checklist

- [ ] `npm run check:secrets` passes
- [ ] `data/`, `.env`, and `auth.json` are absent from the published tree
- [ ] `node src/cli.js doctor` passes on a clean checkout
- [ ] `node src/cli.js view` renders with sample data
- [ ] Version bumped in `package.json` and the MCP server info
- [ ] `README.md` and `docs/` match actual flags and tool names
- [ ] License file present (MIT) and referenced in `package.json`
- [ ] No personal handles, paths, or screenshots in code, docs, or history

If the repository has history, run the leak check against `git log -p` too, or rewrite history before publishing.
