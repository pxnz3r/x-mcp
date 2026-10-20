#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  assignToFolder,
  cobaltCheck,
  createFolder,
  deleteLocalFolder,
  doctor,
  downloadMedia,
  enrichLinks,
  exportBookmarks,
  foldersList,
  getBookmark,
  listBookmarks,
  resolveMedia,
  searchBookmarks,
  syncBookmarks,
  tagBookmarks,
  tagsList,
  whoami,
} from './actions.js';
import { XAccessError } from './errors.js';
import { describeSafety } from './safety.js';
import { openViewer, viewBookmarks } from './viewer.js';

const HELP = `xbm - read and file your own X bookmarks

Usage:
  node src/cli.js whoami
  node src/cli.js doctor
  node src/cli.js list [--folder NAME] [--limit 20] [--cursor CURSOR] [--json]
  node src/cli.js sync [--pages 50] [--full] [--json]
  node src/cli.js search <keywords> [--author NAME] [--folder PATH] [--tag TAG] [--since 2025-01-01]
                          [--until 2025-12-31] [--type photo|video|gif|any] [--limit 50] [--json]
  node src/cli.js get <post id> [--json]
  node src/cli.js folders [--refresh] [--sync] [--json]
  node src/cli.js assign <folder> <post id...> [--remove] [--x] [--yes] [--dry-run] [--json]
  node src/cli.js folder-create <name> [--x] [--yes] [--json]
  node src/cli.js folder-delete <path> [--json]
  node src/cli.js tag <tag> <post id...> [--remove] [--json]
  node src/cli.js tags [--json]
  node src/cli.js links [--limit 400] [--refresh] [--json]
  node src/cli.js view [--no-open] [--out FILE] [--json]
  node src/cli.js media <post id> [--index 0] [--download] [--out DIR] [--json]
  node src/cli.js export [--format markdown|json] [--out FILE]
  node src/cli.js safety
  node src/cli.js cobalt-check

Folders are local by default: instant, no X requests, no write gate.
Add --x to target a real X folder instead (needs X Premium, X_ALLOW_WRITES=true, and --yes).
Requests are serialized, spaced, and budgeted. See README for the safety rules.
`;

function flatten(text, max = 220) {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function stamp(item) {
  return item.createdAt ? item.createdAt.slice(0, 16).replace('T', ' ') : 'unknown date';
}

function printItem(item, index, folders = {}) {
  const types = item.media?.length ? ` [${item.media.map((m) => m.type).join(', ')}]` : '';
  const folderNames = (item.folderIds ?? []).map((id) => folders[id]?.name).filter(Boolean);
  const folderLabel = folderNames.length ? ` {${folderNames.join(', ')}}` : '';
  console.log(`${index + 1}. @${item.author?.username ?? '?'} - ${stamp(item)}${types}${folderLabel}`);
  console.log(`   ${flatten(item.text)}`);
  console.log(`   ${item.url ?? item.id}`);
}

function printItems(items, folders = {}) {
  if (!items.length) {
    console.log('No matching bookmarks.');
    return;
  }
  items.forEach((item, index) => printItem(item, index, folders));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: 'string' },
      cursor: { type: 'string' },
      pages: { type: 'string' },
      author: { type: 'string' },
      folder: { type: 'string' },
      tag: { type: 'string' },
      'no-open': { type: 'boolean' },
      since: { type: 'string' },
      until: { type: 'string' },
      type: { type: 'string' },
      index: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string' },
      download: { type: 'boolean' },
      full: { type: 'boolean' },
      refresh: { type: 'boolean' },
      sync: { type: 'boolean' },
      yes: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      remove: { type: 'boolean' },
      x: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const [command, ...rest] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  const limit = values.limit ? Number(values.limit) : undefined;
  const json = values.json === true;

  switch (command) {
    case 'doctor': {
      const result = await doctor();
      if (json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
        return;
      }
      console.log('doctor');
      for (const check of result.checks) {
        const detail = typeof check.detail === 'string' ? check.detail : JSON.stringify(check.detail);
        console.log(`  ${check.ok ? 'OK  ' : 'FAIL'} ${check.name.padEnd(10)} ${detail}`);
      }
      console.log(result.ok ? '\nCore checks passed.' : '\nCore checks failed.');
      if (result.hint) console.log(result.hint);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    case 'whoami': {
      const user = await whoami();
      if (json) return console.log(JSON.stringify(user, null, 2));
      console.log(`@${user.username} (${user.name}) id=${user.id}`);
      return;
    }

    case 'list': {
      const result = await listBookmarks({
        limit: limit ?? 20,
        cursor: values.cursor ?? null,
        folder: values.folder ?? null,
        tag: values.tag ?? null,
      });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (result.folder) console.log(`Folder: ${result.folder.name}\n`);
      printItems(result.items);
      if (result.nextCursor) console.log(`\nnext cursor: ${result.nextCursor}`);
      return;
    }

    case 'sync': {
      const result = await syncBookmarks({
        maxPages: values.pages ? Number(values.pages) : 50,
        incremental: values.full !== true,
      });
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        `Synced ${result.pages} page(s): ${result.added} new, ${result.refreshed} refreshed. ${result.total} bookmarks cached.`,
      );
      if (result.incremental && result.added === 0) console.log('Stopped early because the newest page had nothing new (use --full to walk everything).');
      if (result.stoppedEarly) console.log('Page limit reached; rerun sync to continue.');
      if (result.stoppedReason === 'rate-limited') {
        console.log('X rate limited a page. Everything fetched so far is saved; wait for the cooldown, then rerun sync.');
      }
      if (result.stoppedReason === 'auth') console.log('Stopped on an auth error. Refresh the cookies, then rerun sync.');
      return;
    }

    case 'search': {
      const query = rest.join(' ').trim();
      const result = searchBookmarks({
        query,
        author: values.author,
        folder: values.folder,
        since: values.since,
        until: values.until,
        media: values.type,
        limit: limit ?? 50,
      });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (result.hint) console.log(`${result.hint}\n`);
      printItems(result.items);
      return;
    }

    case 'get': {
      if (!rest[0]) throw new XAccessError('Missing post id.', { hint: 'node src/cli.js get <post id>' });
      const item = await getBookmark(rest[0]);
      if (json) return console.log(JSON.stringify(item, null, 2));
      console.log(`@${item.author.username} (${item.author.name}) - ${stamp(item)}`);
      console.log(item.url);
      console.log('');
      console.log(item.text);
      for (const link of item.links) console.log(`\nlink: ${link.url}`);
      for (const [i, media] of (item.media ?? []).entries()) console.log(`\nmedia ${i} (${media.type}): ${media.url}`);
      if (item.quoted) console.log(`\nquoted @${item.quoted.author.username}: ${flatten(item.quoted.text, 400)}`);
      return;
    }

    case 'folders': {
      const result = await foldersList({ refresh: values.refresh === true, syncContents: values.sync === true });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (!result.folders.length) {
        console.log('No folders yet. Assign a post to create one: node src/cli.js assign "Reading" <post id>');
        return;
      }
      for (const folder of result.folders) {
        const depth = folder.path.split('/').length - 1;
        console.log(
          `${'  '.repeat(depth)}${folder.name}  (${folder.totalBookmarks} total, ${folder.cachedBookmarks} direct, ${folder.kind})  ${folder.path}`,
        );
      }
      if (result.tags?.length) {
        console.log(`\ntags: ${result.tags.map((entry) => `#${entry.tag}(${entry.count})`).join(' ')}`);
      }
      if (result.synced) {
        console.log('');
        for (const entry of result.synced) {
          console.log(`synced ${entry.name}: ${entry.bookmarks} bookmarks, ${entry.pages} page(s)${entry.complete ? '' : ' (partial)'}`);
        }
      }
      return;
    }

    case 'assign': {
      const folder = rest[0];
      const ids = rest.slice(1);
      if (!folder || ids.length === 0) {
        throw new XAccessError('Usage: assign <folder> <post id...>', { hint: 'node src/cli.js assign "Reading list" 123 456 --yes' });
      }
      const result = await assignToFolder({
        ids,
        folder,
        confirm: values.yes === true,
        dryRun: values['dry-run'] === true,
        scope: values.x ? 'x' : 'local',
        remove: values.remove === true,
      });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (result.kind === 'local') {
        console.log(
          `${result.action === 'removed' ? 'Removed' : 'Added'} ${result.changed.length} bookmark(s) ${
            result.action === 'removed' ? 'from' : 'to'
          } local folder "${result.folder.name}" (${result.cachedBookmarks} total).`,
        );
        if (result.mixed.length) console.log(`Already unchanged: ${result.mixed.length}`);
        if (result.note) console.log(result.note);
        return;
      }
      if (result.confirmationRequired) {
        console.log(`Folder: ${result.folder.name} (${result.folder.id})`);
        console.log(`Would move ${result.count} bookmark(s):`);
        for (const entry of result.preview) {
          console.log(`  ${entry.id} @${entry.author ?? '?'} - ${flatten(entry.text ?? '', 80)}`);
        }
        console.log(`\n${result.hint}`);
        return;
      }
      console.log(`Moved ${result.moved.length} bookmark(s) to ${result.folder.name}.`);
      if (result.skipped.length) console.log(`Already there: ${result.skipped.join(', ')}`);
      for (const failure of result.failed) console.log(`Failed ${failure.id}: ${failure.error}`);
      return;
    }

    case 'folder-create': {
      const name = rest.join(' ').trim();
      if (!name) throw new XAccessError('Missing folder name.');
      const result = await createFolder({ name, confirm: values.yes === true, scope: values.x ? 'x' : 'local' });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (result.kind === 'local') {
        console.log(`${result.existed ? 'Folder already exists' : 'Created local folder'} "${result.created.name}" (${result.created.id}).`);
        return;
      }
      if (result.confirmationRequired) {
        console.log(`Would create folder "${result.folderName}".\n${result.hint}`);
        return;
      }
      console.log(`Created folder "${result.created.name}"${result.created.id ? ` id=${result.created.id}` : ''}.`);
      return;
    }

    case 'tag': {
      const tag = rest[0];
      const ids = rest.slice(1);
      if (!tag || ids.length === 0) {
        throw new XAccessError('Usage: tag <tag> <post id...>', { hint: 'node src/cli.js tag claude 123 456' });
      }
      const result = tagBookmarks({ ids, tags: [tag], remove: values.remove === true });
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        `${result.action === 'removed' ? 'Removed' : 'Added'} #${result.tags[0]} on ${result.changed.length} post(s).`,
      );
      if (result.mixed.length) console.log(`Unchanged: ${result.mixed.length}`);
      if (result.missing.length) console.log(`Not cached: ${result.missing.length} (run sync first)`);
      return;
    }

    case 'tags': {
      const result = tagsList();
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (!result.tags.length) {
        console.log('No tags yet. Add one: node src/cli.js tag claude <post id>');
        return;
      }
      for (const entry of result.tags) console.log(`#${entry.tag}  ${entry.count}`);
      return;
    }

    case 'folder-delete': {
      const name = rest.join(' ').trim();
      if (!name) throw new XAccessError('Missing folder name.');
      const result = deleteLocalFolder({ folder: name });
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Deleted local folder "${result.deleted.name}".`);
      return;
    }

    case 'links': {
      const result = await enrichLinks({
        limit: limit ?? 400,
        refresh: values.refresh === true,
        onProgress: json ? null : ({ done, total, found }) => {
          if (done % 25 === 0 || done === total) console.error(`  ${done}/${total} checked, ${found} previews`);
        },
      });
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Links: ${result.links} unique, ${result.checked} checked, ${result.found} previews, ${result.cached} cached, ${result.updated} updated.`);
      if (result.queued > result.checked) console.log('Some links left for the next run (limit). Rerun links to continue.');
      return;
    }

    case 'view': {
      const result = viewBookmarks({ out: values.out ?? null });
      if (!values['no-open']) {
        try {
          openViewer(result.path);
        } catch {
        }
      }
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Viewer: ${result.path}`);
      console.log(`${result.items} posts, ${result.folders} folders, ${result.tags} tags.`);
      return;
    }

    case 'media': {
      if (!rest[0]) throw new XAccessError('Missing post id.', { hint: 'node src/cli.js media <post id> [--download]' });
      const index = values.index != null ? Number(values.index) : null;
      if (values.download) {
        const result = await downloadMedia({
          tweetId: rest[0],
          index,
          ...(values.out ? { outDir: values.out } : {}),
        });
        if (json) return console.log(JSON.stringify(result, null, 2));
        for (const file of result.saved) console.log(`${file.type}: ${file.path} (${file.bytes} bytes)`);
        return;
      }
      const result = await resolveMedia({ tweetId: rest[0], index });
      if (json) return console.log(JSON.stringify(result, null, 2));
      for (const media of result.media) console.log(`${media.index}. ${media.type}: ${media.url}`);
      return;
    }

    case 'export': {
      const format = values.format === 'json' ? 'json' : 'markdown';
      const result = await exportBookmarks({ format, out: values.out ?? null });
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Exported ${result.count} bookmarks to ${result.path}`);
      return;
    }

    case 'safety': {
      console.log(JSON.stringify(describeSafety(), null, 2));
      return;
    }

    case 'cobalt-check': {
      console.log(JSON.stringify(await cobaltCheck(), null, 2));
      return;
    }

    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof XAccessError ? error.format() : (error?.stack ?? String(error)));
  process.exitCode = 1;
});
