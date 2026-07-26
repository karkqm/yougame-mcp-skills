import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  authStatus,
  getCategories,
  getForum,
  getGenericPage,
  getPost,
  getThread,
  search,
  getDownloadCategories,
  getDownloadList,
  getDownloadFile,
} from './api.js';
import { ucConfig } from './config.js';
import { AuthRequiredError, BrowserUnavailableError } from '../errors.js';
import { clearJar } from './http/jar.js';
import { dropCache } from './http/client.js';
import { interactiveLogin } from './browser.js';
import { classify, instructionFor } from '../resources/hosts.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return fail(
        [
          'AUTH_REQUIRED — UnknownCheats requires login.',
          `Target: ${err.target}`,
          `Reason: ${err.message}`,
          '',
          'Action: call uc_login — a browser window will open for manual login.',
          'After login, cookies are saved automatically. Retry the failed call.',
        ].join('\n'),
      );
    }
    if (err instanceof BrowserUnavailableError) {
      return fail(`BROWSER_UNAVAILABLE — ${err.message}`);
    }
    return fail(`ERROR — ${(err as Error).message}`);
  }
}

export function registerUcTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Guide
  // -------------------------------------------------------------------------
  server.registerTool(
    'uc_guide',
    {
      title: 'How to work with UnknownCheats',
      description:
        'Return the workflow guide for UnknownCheats forum: how to navigate, search, download, and handle auth. Call first when working with UC.',
      inputSchema: {
        topic: z
          .enum(['all', 'navigation', 'search', 'downloads', 'sections', 'auth'])
          .optional()
          .describe(
            'navigation — URL patterns, search — how search works, downloads — UC downloads section, sections — key forum sections, auth — login and Cloudflare, all — everything',
          ),
      },
    },
    async ({ topic }) =>
      guard(async () => {
        const t = topic ?? 'all';
        const nav = `# UnknownCheats Navigation

URL patterns:
- Forum index: /index.php
- Forum section: /forumdisplay.php?f=ID or /section-name-ID/
- Thread: /showthread.php?t=ID or /section/ID-slug.html
- Post: /showpost.php?p=ID
- Search: /search.php
- Downloads: /downloads.php
- User profile: /member.php?u=ID

Tools: uc_categories → uc_forum → uc_thread for navigation.
Search: uc_search (requires login).
Downloads: uc_downloads_cats → uc_downloads_list → uc_downloads_file → uc_download.`;

        const searchGuide = `# UC Search

uc_search requires login. Use uc_login first.
Search supports: keywords, title-only, forum filters, author filter, sort order.
Results include threads and posts with snippets.`;

        const downloads = `# UC Downloads Section

UnknownCheats has a dedicated file repository separate from forum threads.
- uc_downloads_cats — list download categories
- uc_downloads_list — files in a category
- uc_downloads_file — file details, description, changelog
- uc_download — download the actual file

Many CS2 tools, bases, and SDKs are in the downloads section.`;

        const sections = `# Key UC Forum Sections for CS2/HvH

Counter-Strike 2:
- CS2 Releases — released cheats and tools
- CS2 Source Code — open-source projects and bases
- CS2 Tutorials — guides and how-tos

General:
- Anti-Cheat Bypass — techniques and tools
- C and C++ — native code resources
- Direct3D / DirectX — rendering and hooks
- General Programming — algorithms, patterns

Use uc_categories to get actual section IDs.`;

        const auth = `# UC Auth and Cloudflare

unknowncheats.me is behind Cloudflare. Plain HTTP from Node often gets
HTTP 403 "Just a moment..." — a JS challenge that only a real browser can pass.

Workflow:
1. Call uc_login — opens Chromium with a persistent profile.
2. Wait for Cloudflare to clear (title is no longer "Just a moment...").
   The browser solves the challenge automatically; cf_clearance cookie is saved.
3. If not already signed in, log into the forum (bbuserid cookie).
4. Cookies (including cf_clearance) are imported into the HTTP jar for all tools.
5. uc_auth_status — check session; uc_logout — wipe cookies.

If tools return AUTH_REQUIRED mentioning Cloudflare:
- Run uc_login again (even without full forum login, cf_clearance alone unlocks public pages).
- Keep the browser open longer if the challenge is slow (timeoutSec up to 1800).
- Ensure Chromium is installed: npx playwright install chromium

Public pages may work after CF clearance alone; search and some downloads still need forum login.`;

        if (t === 'navigation') return ok(nav);
        if (t === 'search') return ok(searchGuide);
        if (t === 'downloads') return ok(downloads);
        if (t === 'sections') return ok(sections);
        if (t === 'auth') return ok(auth);
        return ok(`${nav}\n\n${searchGuide}\n\n${downloads}\n\n${sections}\n\n${auth}`);
      }),
  );

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  server.registerTool(
    'uc_auth_status',
    {
      title: 'UC auth status',
      description: 'Check if we have an active session on UnknownCheats: username, user id, stored cookies.',
      inputSchema: {},
    },
    async () => guard(async () => ok(await authStatus())),
  );

  server.registerTool(
    'uc_login',
    {
      title: 'Login to UnknownCheats',
      description:
        'Open a real browser window with the UC login page for manual sign-in (password, captcha, 2FA). After login, cookies are saved and used by all other tools.',
      inputSchema: {
        timeoutSec: z.number().int().min(30).max(1800).optional().describe('How long to wait for login, seconds (default 300).'),
        keepOpen: z.boolean().optional().describe('Keep browser window open after login.'),
      },
    },
    async ({ timeoutSec, keepOpen }) =>
      guard(async () => {
        const result = await interactiveLogin({ timeoutSec, keepOpen });
        dropCache();
        const status = result.loggedIn ? await authStatus() : null;
        return ok({ ...result, status });
      }),
  );

  server.registerTool(
    'uc_logout',
    {
      title: 'Clear UC session',
      description: 'Delete stored UnknownCheats cookies from disk.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        clearJar();
        dropCache();
        return ok({ ok: true, message: 'Cookies deleted: ' + ucConfig.cookiesPath });
      }),
  );

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  server.registerTool(
    'uc_categories',
    {
      title: 'UC forum categories',
      description:
        'Forum tree: categories with their sub-forums, thread/post counts, and last activity. Use to discover forum section IDs for filtering searches.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const tree = await getCategories();
        return ok(tree);
      }),
  );

  server.registerTool(
    'uc_forum',
    {
      title: 'UC forum thread list',
      description:
        'Threads in a forum section with pagination, authors, reply/view counts. Supports sorting.',
      inputSchema: {
        forum: z.union([z.number(), z.string()]).describe('Forum id (e.g. 564), path, or full URL.'),
        page: z.number().int().min(1).optional(),
        order: z
          .enum(['lastpost', 'postdate', 'replycount', 'views', 'title'])
          .optional()
          .describe('Sort order.'),
        direction: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Max threads to return (default: all on page).'),
      },
    },
    async ({ forum, page, order, direction, limit }) =>
      guard(async () => {
        const data = await getForum(forum, { page, order, direction });
        if (limit) data.threads = data.threads.slice(0, limit);
        return ok(data);
      }),
  );

  server.registerTool(
    'uc_thread',
    {
      title: 'Read UC thread and posts',
      description:
        'Full thread parsing: title, tags, first post (article) and comments in markdown, code blocks, attachments, external links. Use to read tutorials, source code posts, and discussions.',
      inputSchema: {
        thread: z.union([z.number(), z.string()]).describe('Thread id, path, or full URL.'),
        page: z.number().int().min(1).optional(),
        allPages: z.boolean().optional().describe('Read multiple pages.'),
        maxPages: z.number().int().min(1).max(20).optional().describe('Page limit for allPages (default 5).'),
        firstPostOnly: z.boolean().optional().describe('Return only the first post (the article), no comments.'),
      },
    },
    async ({ thread, page, allPages, maxPages, firstPostOnly }) =>
      guard(async () => {
        const data = await getThread(thread, { page, allPages, maxPages });
        if (firstPostOnly) data.posts = data.posts.slice(0, 1);

        const downloadable = data.posts.flatMap((p) => [
          ...p.attachments.map((a) => a.url).filter(Boolean) as string[],
          ...p.links.filter((l) => !l.internal && (classify(l.url).host || classify(l.url).looksDirect)).map((l) => l.url),
        ]);

        return ok({
          ...data,
          downloadableResources: [...new Set(downloadable)].slice(0, 50),
        });
      }),
  );

  server.registerTool(
    'uc_post',
    {
      title: 'UC single post',
      description: 'Get a specific post by its id with thread context.',
      inputSchema: { postId: z.union([z.number(), z.string()]).describe('Post id.') },
    },
    async ({ postId }) => guard(async () => ok(await getPost(postId))),
  );

  server.registerTool(
    'uc_search',
    {
      title: 'Search UnknownCheats',
      description:
        'Search UC threads and posts with filters by forum sections, author, and sort order. Requires login: guests cannot search.',
      inputSchema: {
        query: z.string().min(2).describe('Search query.'),
        type: z.enum(['thread', 'post']).optional().describe('thread — search thread titles, post — search posts.'),
        titleOnly: z.boolean().optional(),
        forumIds: z.array(z.number().int()).optional().describe('Restrict to forum section ids.'),
        searchChildren: z.boolean().optional().describe('Include sub-forums (default yes).'),
        author: z.string().optional(),
        order: z.enum(['relevance', 'dateline', 'lastpost', 'replycount']).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async (args) => guard(async () => ok(await search(args))),
  );

  server.registerTool(
    'uc_page',
    {
      title: 'UC generic page',
      description: 'Load any UC page (wiki, profile, etc.) and return its text content.',
      inputSchema: { path: z.string().describe('Path or full URL.') },
    },
    async ({ path }) => guard(async () => ok(await getGenericPage(path))),
  );

  // -------------------------------------------------------------------------
  // Downloads section
  // -------------------------------------------------------------------------
  server.registerTool(
    'uc_downloads_cats',
    {
      title: 'UC download categories',
      description: 'List all download categories in the UC downloads section. UC has a dedicated file repository separate from forum threads.',
      inputSchema: {},
    },
    async () => guard(async () => ok(await getDownloadCategories())),
  );

  server.registerTool(
    'uc_downloads_list',
    {
      title: 'UC downloads in category',
      description: 'List files in a UC download category with authors, dates, download counts.',
      inputSchema: {
        categoryId: z.number().int().describe('Download category id.'),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ categoryId, page }) => guard(async () => ok(await getDownloadList(categoryId, page))),
  );

  server.registerTool(
    'uc_downloads_file',
    {
      title: 'UC download file details',
      description: 'Get details of a specific file in UC downloads: description, version, changelog, screenshots, download link.',
      inputSchema: {
        fileId: z.number().int().describe('Download file id.'),
      },
    },
    async ({ fileId }) => guard(async () => ok(await getDownloadFile(fileId))),
  );

  server.registerTool(
    'uc_download',
    {
      title: 'Download from UC',
      description:
        'Download a file: UC attachment, UC download section file, or external link. Determines hosting automatically and downloads via direct GET or browser.',
      inputSchema: {
        url: z.string().url().describe('File URL: UC attachment, downloads.php link, or external host.'),
        destDir: z.string().optional().describe(`Save directory (default ${ucConfig.downloadDir}).`),
        browser: z.boolean().optional().describe('Force browser download.'),
        headless: z.boolean().optional().describe('Hidden browser window (default visible).'),
      },
    },
    async ({ url: fileUrl, destDir, browser: useBrowser, headless }) =>
      guard(async () => {
        const dest = destDir || ucConfig.downloadDir;

        // UC downloads section file
        if (/downloads\.php.*do=download/i.test(fileUrl) || /unknowncheats\.me\/forum\/attachments/i.test(fileUrl)) {
          const { rawFetch } = await import('./http/client.js');
          const res = await rawFetch(fileUrl, { headers: { Accept: '*/*' } });
          const type = res.headers.get('content-type');
          if (res.ok && !/^text\/html/i.test(type || '')) {
            const { saveStream } = await import('./download-util.js');
            const saved = await saveStream(res, dest);
            return ok({ ok: true, ...saved, via: 'direct' });
          }
          await res.body?.cancel().catch(() => undefined);
        }

        // External hosting or browser fallback
        if (!useBrowser) {
          const { host } = classify(fileUrl);
          if (host?.strategy !== 'browser' && host?.strategy !== 'manual') {
            try {
              const extRes = await fetch(fileUrl, {
                redirect: 'follow',
                headers: { 'User-Agent': ucConfig.userAgent, Accept: '*/*' },
                signal: AbortSignal.timeout(ucConfig.requestTimeoutMs * 2),
              });
              const type = extRes.headers.get('content-type');
              if (extRes.ok && !/^text\/html/i.test(type || '')) {
                const { saveStream } = await import('./download-util.js');
                const saved = await saveStream(extRes, dest);
                return ok({ ok: true, ...saved, via: 'direct', host: host?.name ?? null });
              }
              await extRes.body?.cancel().catch(() => undefined);
            } catch {
              /* fall through to browser */
            }
          }
        }

        // Browser download
        try {
          const { browserDownload: bd } = await import('./browser.js');
          const result = await bd(fileUrl, dest, { headless: headless ?? false });
          return ok({
            ok: true,
            filePath: result.filePath,
            fileName: result.suggestedName,
            bytes: result.bytes,
            via: 'browser',
          });
        } catch (err) {
          return fail(`Download failed: ${(err as Error).message}. URL: ${fileUrl}. Hint: ${instructionFor(fileUrl)}`);
        }
      }),
  );

  // -------------------------------------------------------------------------
  // Resources from thread
  // -------------------------------------------------------------------------
  server.registerTool(
    'uc_resources',
    {
      title: 'UC thread resources',
      description:
        'Collect all downloadable resources from a thread: attachments and external file hosting links. Returns hosting type and download instructions for each.',
      inputSchema: {
        thread: z.union([z.number(), z.string()]).describe('Thread id, path, or URL.'),
        allPages: z.boolean().optional(),
        maxPages: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ thread, allPages, maxPages }) =>
      guard(async () => {
        const data = await getThread(thread, { allPages, maxPages });
        const seen = new Set<string>();
        const resources: Array<Record<string, unknown>> = [];

        for (const post of data.posts) {
          for (const att of post.attachments) {
            if (!att.url || seen.has(att.url)) continue;
            seen.add(att.url);
            resources.push({
              type: 'attachment',
              name: att.name,
              size: att.size,
              url: att.url,
              post: post.number,
              author: post.author,
              instruction: instructionFor(att.url),
            });
          }
          for (const link of post.links) {
            if (link.internal || seen.has(link.url)) continue;
            const { host, looksDirect } = classify(link.url);
            if (!host && !looksDirect) continue;
            seen.add(link.url);
            resources.push({
              type: host?.name ?? 'external link',
              name: link.text,
              url: link.url,
              strategy: host?.strategy ?? (looksDirect ? 'direct' : 'unknown'),
              post: post.number,
              author: post.author,
              instruction: instructionFor(link.url),
            });
          }
        }

        return ok({
          thread: { id: data.id, title: data.title, url: data.url },
          resources,
        });
      }),
  );
}
