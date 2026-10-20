#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  assignToFolder,
  cobaltCheck,
  createFolder,
  deleteLocalFolder,
  doctor,
  downloadMedia,
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

const server = new McpServer({
  name: 'x-bookmarks',
  version: '0.3.0',
});

function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(error) {
  const message = error instanceof XAccessError ? error.format() : (error?.stack ?? String(error));
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function tool(handler) {
  return async (args) => {
    try {
      return ok(await handler(args));
    } catch (error) {
      return fail(error);
    }
  };
}

const idSchema = z
  .string()
  .regex(/^\d+$/, 'Numeric post id')
  .describe('Numeric X post id, for example "1759123456789012345"');

const folderRefSchema = z.string().min(1).describe('Folder id or path, e.g. "Design" or "Design/Frontend". Parent folders include their subfolders.');

server.registerTool(
  'x_doctor',
  {
    title: 'Diagnose connectivity',
    description:
      'Run read-only checks in order: cookies, account identity, one bookmark page, folder access, write settings, cobalt. Use this when any tool returns an unexpected status such as 404 or 401, and report which check failed.',
    inputSchema: {},
  },
  tool(async () => doctor()),
);

server.registerTool(
  'x_whoami',
  {
    title: 'Check X account',
    description:
      'Verify that the saved x.com cookies work and return the authenticated account. Use this first when another tool fails with an auth error.',
    inputSchema: {},
  },
  tool(async () => whoami()),
);

server.registerTool(
  'bookmarks_list',
  {
    title: 'List bookmarks',
    description:
      'Fetch one fresh page of bookmarks, newest first. Without a folder it reads the main bookmark timeline; with a folder it reads that folder. Writes the page to the local cache. Pass nextCursor back as cursor to page further.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe('How many bookmarks to return (1-100)'),
      cursor: z.string().optional().describe('Cursor from a previous call (nextCursor)'),
      folder: folderRefSchema.optional().describe('Folder id or name; omit for all bookmarks'),
    },
  },
  tool(async ({ limit, cursor, folder }) => listBookmarks({ limit, cursor: cursor ?? null, folder: folder ?? null })),
);

server.registerTool(
  'bookmarks_sync',
  {
    title: 'Sync all bookmarks',
    description:
      'Page through bookmarks into the local cache so bookmarks_search works offline. Incremental by default: it stops at the first page with nothing new. Set incremental=false for a full walk.',
    inputSchema: {
      maxPages: z.number().int().min(1).max(500).default(50).describe('Stop after this many pages (20 posts per page)'),
      incremental: z.boolean().default(true).describe('Stop once a page adds nothing new'),
    },
  },
  tool(async ({ maxPages, incremental }) => syncBookmarks({ maxPages, incremental })),
);

server.registerTool(
  'bookmarks_search',
  {
    title: 'Search cached bookmarks',
    description:
      'Search the local cache by keyword, author, date range, media type, folder path, or tag. Fast and offline. A folder match includes its subfolders. Run bookmarks_sync first for full coverage.',
    inputSchema: {
      query: z.string().optional().describe('Keywords; every word must appear in the post, author, or links'),
      author: z.string().optional().describe('Author username or display name, with or without @'),
      folder: folderRefSchema.optional().describe('Only posts filed in this folder or its subfolders'),
      tag: z.string().optional().describe('Only posts carrying this tag'),
      since: z.string().optional().describe('Earliest date, ISO like 2025-01-31'),
      until: z.string().optional().describe('Latest date, ISO like 2025-12-31'),
      media: z
        .enum(['any', 'photo', 'video', 'gif'])
        .optional()
        .describe('Only posts with this media type; "any" means any media'),
      limit: z.number().int().min(1).max(500).default(50),
    },
  },
  tool(async ({ query, author, since, until, media, folder, tag, limit }) =>
    searchBookmarks({ query, author, since, until, media, folder, tag, limit }),
  ),
);

server.registerTool(
  'bookmark_get',
  {
    title: 'Get one bookmark',
    description:
      'Return the full stored contents of one post: text, author, metrics, media URLs, links, quoted post, and folder ids. Falls back to fetching it from X when it is not cached.',
    inputSchema: { id: idSchema },
  },
  tool(async ({ id }) => getBookmark(id)),
);

server.registerTool(
  'folders_list',
  {
    title: 'List bookmark folders',
    description:
      'List folders with paths, direct counts, and totals including subfolders, plus tag counts. Local folders (kind "local") are free, support nesting ("Design/Frontend"), and hold posts in multiple folders. X folders (kind "x") need X Premium. syncContents=true rebuilds membership of X folders from X.',
    inputSchema: {
      refresh: z.boolean().default(false).describe('Ignore the 10 minute cache and re-fetch the folder list'),
      syncContents: z.boolean().default(false).describe('Fetch the contents of every folder to update membership'),
    },
  },
  tool(async ({ refresh, syncContents }) => foldersList({ refresh, syncContents })),
);

server.registerTool(
  'folder_assign',
  {
    title: 'File bookmarks into a folder',
    description:
      'File bookmarks into a folder. scope "local" (default) writes only to the local cache: instant, offline, no X request, creates the folder if it does not exist, supports up to 500 ids and multiple folders per post. scope "x" writes to a real X folder instead: needs X Premium, X_ALLOW_WRITES=true, confirm=true, max 25 ids, and moves the post (one X folder per post).',
    inputSchema: {
      ids: z
        .array(idSchema)
        .min(1)
        .max(25)
        .describe('Post ids to file into the folder'),
      folder: folderRefSchema,
      scope: z
        .enum(['local', 'x'])
        .default('local')
        .describe('local = cache only (free, instant); x = real X folder (Premium, gated write)'),
      remove: z.boolean().default(false).describe('Remove the posts from the folder instead of adding them'),
      confirm: z.boolean().default(false).describe('Only used for scope "x": must be true to write'),
      dryRun: z.boolean().default(false).describe('Only used for scope "x": return the preview only'),
    },
  },
  tool(async ({ ids, folder, scope, remove, confirm, dryRun }) =>
    assignToFolder({ ids, folder, scope, remove, confirm, dryRun }),
  ),
);

server.registerTool(
  'folder_create',
  {
    title: 'Create bookmark folder',
    description:
      'Create a folder. Names with slashes create nested local folders, e.g. "Design/Frontend/Glass". Local is instant, free, offline, and needs no confirmation. scope "x" creates a real X folder and needs X Premium, X_ALLOW_WRITES=true, and confirm=true.',
    inputSchema: {
      name: z.string().min(1).max(200).describe('Folder path, e.g. "Design/Frontend/Glass"'),
      scope: z.enum(['local', 'x']).default('local').describe('local = cache only; x = real X folder'),
      confirm: z.boolean().default(false).describe('Only used for scope "x": must be true to write'),
    },
  },
  tool(async ({ name, scope, confirm }) => createFolder({ name, scope, confirm })),
);

server.registerTool(
  'folder_delete',
  {
    title: 'Delete a local folder',
    description:
      'Delete a local folder and remove it from every cached post. Local only and instant; X folders are deleted on x.com instead.',
    inputSchema: { folder: folderRefSchema },
  },
  tool(async ({ folder }) => deleteLocalFolder({ folder })),
);

server.registerTool(
  'tags_assign',
  {
    title: 'Tag bookmarks',
    description:
      'Add or remove tags on cached posts. Tags are free, instant, offline, and independent of folders, so a post can carry many. Use them for cross-cutting labels like claude, webgl, free, open-source.',
    inputSchema: {
      ids: z.array(idSchema).min(1).max(500).describe('Post ids to tag'),
      tags: z.array(z.string().min(1).max(40)).min(1).max(20).describe('Tags, with or without a leading #'),
      remove: z.boolean().default(false).describe('Remove the tags instead of adding them'),
    },
  },
  tool(async ({ ids, tags, remove }) => tagBookmarks({ ids, tags, remove })),
);

server.registerTool(
  'tags_list',
  {
    title: 'List tags',
    description: 'List every tag in the local cache with how many posts carry it.',
    inputSchema: {},
  },
  tool(async () => tagsList()),
);

server.registerTool(
  'media_get',
  {
    title: 'Get post media',
    description:
      'Return downloadable media URLs for a post (photos direct, videos/GIFs resolved through cobalt). Set download=true to save the files under data/media/<post id>/ and return their paths.',
    inputSchema: {
      id: idSchema,
      index: z.number().int().min(0).optional().describe('Only this media index; omit for all media'),
      download: z.boolean().default(false).describe('Save the files to disk'),
      outDir: z.string().optional().describe('Override the output directory when downloading'),
    },
  },
  tool(async ({ id, index, download, outDir }) => {
    if (!download) return resolveMedia({ tweetId: id, index: index ?? null });
    return downloadMedia({ tweetId: id, index: index ?? null, ...(outDir ? { outDir } : {}) });
  }),
);

server.registerTool(
  'bookmarks_export',
  {
    title: 'Export bookmarks',
    description: 'Write every cached bookmark to a Markdown or JSON file, including folder names, and return the path.',
    inputSchema: {
      format: z.enum(['markdown', 'json']).default('markdown'),
      out: z.string().optional().describe('Output file path'),
    },
  },
  tool(async ({ format, out }) => exportBookmarks({ format, out: out ?? null })),
);

server.registerTool(
  'cobalt_check',
  {
    title: 'Check cobalt instance',
    description: 'Ping the configured cobalt instance and report its version and supported services.',
    inputSchema: {},
  },
  tool(async () => cobaltCheck()),
);

server.registerTool(
  'safety_status',
  {
    title: 'Show safety limits',
    description:
      'Report whether writes are enabled, the current rate-limit cooldown, and how much of the hourly write budget is left. Check this before bulk folder work.',
    inputSchema: {},
  },
  tool(async () => describeSafety()),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('x-bookmarks MCP server listening on stdio');
