import { ucConfig, ucUrl } from './config.js';
import { AuthRequiredError, NotFoundError } from '../errors.js';
import { getPage } from './http/client.js';
import { hasSessionCookies } from './http/jar.js';
import { parseForumIndex, parseThreadList, type CategoryBlock, type ForumNode, type ForumPage } from './parse/forum.js';
import { parseSearchResults, type SearchResults } from './parse/search.js';
import { parseThread, type ThreadPage } from './parse/thread.js';
import { parseDownloadCategories, parseDownloadList, parseDownloadFile, type DownloadCategory, type DownloadEntry, type DownloadFile } from './parse/downloads.js';

export function forumPath(idOrUrl: string | number, page = 1): string {
  const raw = String(idOrUrl).trim();
  let base: string;
  if (/^\d+$/.test(raw)) base = `/forumdisplay.php?f=${raw}`;
  else if (/^https?:/i.test(raw)) {
    const u = new URL(raw);
    base = u.pathname + u.search;
  } else base = raw.startsWith('/') ? raw : `/${raw}`;
  if (page > 1) {
    if (base.includes('?')) base += `&page=${page}`;
    else base += (base.endsWith('/') ? '' : '/') + `page-${page}`;
  }
  return base;
}

export function threadPath(idOrUrl: string | number, page = 1): string {
  const raw = String(idOrUrl).trim();
  let base: string;
  if (/^\d+$/.test(raw)) base = `/showthread.php?t=${raw}`;
  else if (/^https?:/i.test(raw)) {
    const u = new URL(raw);
    base = u.pathname + u.search;
  } else base = raw.startsWith('/') ? raw : `/${raw}`;
  if (page > 1) {
    if (base.includes('?')) base += `&page=${page}`;
    else base = base.replace(/\.html$/, '') + `/page${page}.html`;
  }
  return base;
}

export interface AuthStatus {
  loggedIn: boolean;
  username: string | null;
  userId: number | null;
  cookiesStored: boolean;
}

export async function authStatus(): Promise<AuthStatus> {
  const page = await getPage('/index.php', { noCache: true, allowGate: true });
  const usernameMatch = page.html.match(/id="navbar_username"[^>]*>([^<]+)</);
  const username = usernameMatch?.[1]?.trim() ?? null;
  const userIdMatch = page.html.match(/member\.php\?u=(\d+)/);
  const userId = userIdMatch ? Number.parseInt(userIdMatch[1], 10) : null;
  return {
    loggedIn: page.loggedIn,
    username: page.loggedIn ? username : null,
    userId: page.loggedIn ? userId : null,
    cookiesStored: hasSessionCookies(),
  };
}

export async function getCategories(): Promise<{
  source: string;
  categories: CategoryBlock[];
}> {
  const page = await getPage('/index.php');
  const tree = parseForumIndex(page.html);
  return { source: page.finalUrl, ...tree };
}

export interface ForumOptions {
  page?: number;
  order?: 'lastpost' | 'postdate' | 'replycount' | 'views' | 'title';
  direction?: 'asc' | 'desc';
}

export async function getForum(idOrUrl: string | number, opts: ForumOptions = {}): Promise<ForumPage & { url: string }> {
  let path = forumPath(idOrUrl, opts.page ?? 1);
  if (opts.order) path += (path.includes('?') ? '&' : '?') + `order=${opts.order}`;
  if (opts.direction) path += `&sort=${opts.direction}`;

  const page = await getPage(path);
  const parsed = parseThreadList(page.html, page.finalUrl);
  if (!parsed.forum.title && parsed.threads.length === 0) {
    throw new NotFoundError(`Forum not found or empty: ${ucUrl(path)}`);
  }
  return { ...parsed, url: page.finalUrl };
}

export interface ThreadOptions {
  page?: number;
  allPages?: boolean;
  maxPages?: number;
}

export async function getThread(idOrUrl: string | number, opts: ThreadOptions = {}): Promise<ThreadPage> {
  const first = await getPage(threadPath(idOrUrl, opts.page ?? 1));
  const parsed = parseThread(first.html, first.finalUrl);
  if (!parsed.posts.length && !parsed.title) {
    throw new NotFoundError(`Thread not found: ${ucUrl(threadPath(idOrUrl))}`);
  }

  if (opts.allPages && parsed.pages > parsed.page) {
    const limit = Math.min(parsed.pages, (opts.page ?? 1) + (opts.maxPages ?? 5) - 1);
    for (let p = (opts.page ?? 1) + 1; p <= limit; p++) {
      const next = await getPage(threadPath(idOrUrl, p));
      const more = parseThread(next.html, next.finalUrl);
      parsed.posts.push(...more.posts);
    }
  }
  return parsed;
}

export async function getPost(postId: number | string): Promise<{ thread: Omit<ThreadPage, 'posts'>; post: ThreadPage['posts'][number] }> {
  const page = await getPage(`/showpost.php?p=${postId}`);
  const parsed = parseThread(page.html, page.finalUrl);
  const post = parsed.posts.find((p) => String(p.id) === String(postId)) || parsed.posts[0];
  if (!post) throw new NotFoundError(`Post #${postId} not found`);
  const { posts, ...thread } = parsed;
  return { thread, post };
}

export interface SearchOptions {
  query: string;
  titleOnly?: boolean;
  forumIds?: number[];
  searchChildren?: boolean;
  author?: string;
  order?: 'relevance' | 'dateline' | 'lastpost' | 'replycount';
  type?: 'thread' | 'post';
  page?: number;
}

export async function search(opts: SearchOptions): Promise<SearchResults> {
  const formPage = await getPage('/search.php', { noCache: true, allowGate: true });
  if (!formPage.loggedIn) {
    throw new AuthRequiredError('UC search requires login.', ucUrl('/search.php'), 'Call uc_login.');
  }
  const token = formPage.securityToken;

  const body = new URLSearchParams();
  body.set('do', 'process');
  body.set('query', opts.query);
  if (opts.titleOnly) body.set('titleonly', '1');
  if (opts.author) body.set('searchuser', opts.author);
  if (opts.type === 'thread') body.set('showposts', '0');
  else body.set('showposts', '1');
  if (opts.order) body.set('sortby', opts.order);
  for (const id of opts.forumIds ?? []) body.append('forumchoice[]', String(id));
  if ((opts.forumIds?.length ?? 0) > 0 && opts.searchChildren !== false) body.set('childforums', '1');
  if (token) body.set('securitytoken', token);

  const res = await getPage('/search.php?do=process', {
    method: 'POST',
    body,
    noCache: true,
    headers: { Referer: ucUrl('/search.php') },
  });
  let parsed = parseSearchResults(res.html, res.finalUrl);

  if (opts.page && opts.page > 1 && parsed.resultsUrl) {
    const pagedUrl = parsed.resultsUrl + (parsed.resultsUrl.includes('?') ? '&' : '?') + `page=${opts.page}`;
    const next = await getPage(pagedUrl, { noCache: true });
    parsed = parseSearchResults(next.html, next.finalUrl);
  }
  return parsed;
}

export async function getGenericPage(pathOrUrl: string): Promise<{ url: string; title: string; text: string }> {
  const page = await getPage(pathOrUrl);
  const cheerio = await import('cheerio');
  const $ = cheerio.load(page.html);
  const { renderBody } = await import('./parse/body.js');
  const $main = $('#content, .page-content, #main_content_section, .body_wrapper').first();
  const rendered = renderBody($, $main.length ? $main : $('body'));
  return {
    url: page.finalUrl,
    title: $('title').text().replace(/\s+/g, ' ').trim(),
    text: rendered.markdown.slice(0, 40_000),
  };
}

// Downloads section
export async function getDownloadCategories(): Promise<DownloadCategory[]> {
  const page = await getPage('/downloads.php');
  return parseDownloadCategories(page.html);
}

export async function getDownloadList(categoryId: number, p = 1): Promise<DownloadEntry[]> {
  const page = await getPage(`/downloads.php?do=cat&id=${categoryId}&page=${p}`);
  return parseDownloadList(page.html);
}

export async function getDownloadFile(fileId: number): Promise<DownloadFile & { url: string }> {
  const page = await getPage(`/downloads.php?do=file&id=${fileId}`);
  const parsed = parseDownloadFile(page.html);
  return { ...parsed, url: page.finalUrl, id: fileId };
}

export const BASE_URL = ucConfig.baseUrl;
