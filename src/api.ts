import { config, url as toUrl } from './config.js';
import { AuthRequiredError, NotFoundError } from './errors.js';
import { getPage } from './http/client.js';
import { hasSessionCookies } from './http/jar.js';
import { parseNodeTree, parseThreadList, type CategoryBlock, type ForumNode, type ForumPage } from './parse/forum.js';
import { parseSearchResults, type SearchResults } from './parse/search.js';
import { parseThread, type ThreadPage } from './parse/thread.js';

/** Приводит «873», «/forums/873/» или полный URL к пути раздела. */
export function forumPath(idOrUrl: string | number, page = 1): string {
  const raw = String(idOrUrl).trim();
  let base: string;
  if (/^\d+$/.test(raw)) base = `/forums/${raw}/`;
  else if (/^https?:/i.test(raw)) base = new URL(raw).pathname;
  else base = raw.startsWith('/') ? raw : `/${raw}`;
  base = base.replace(/\/page-\d+\/?$/, '/').replace(/\/?$/, '/');
  return page > 1 ? `${base}page-${page}` : base;
}

export function threadPath(idOrUrl: string | number, page = 1): string {
  const raw = String(idOrUrl).trim();
  let base: string;
  if (/^\d+$/.test(raw)) base = `/threads/${raw}/`;
  else if (/^https?:/i.test(raw)) base = new URL(raw).pathname;
  else base = raw.startsWith('/') ? raw : `/${raw}`;
  base = base.replace(/\/page-\d+\/?$/, '/').replace(/(post-\d+)?\/?$/, '/');
  return page > 1 ? `${base}page-${page}` : base;
}

export interface AuthStatus {
  loggedIn: boolean;
  username: string | null;
  userId: number | null;
  cookiesStored: boolean;
}

export async function authStatus(): Promise<AuthStatus> {
  const page = await getPage('/', { noCache: true, allowGate: true });
  const username = (page.html.match(/<span class="p-navgroup-linkText">([^<]+)<\/span>/) || [])[1]?.trim() ?? null;
  const userId = Number.parseInt((page.html.match(/userId:\s*(\d+)/) || [])[1] || '', 10) || null;
  return {
    loggedIn: page.loggedIn,
    username: page.loggedIn ? username : null,
    userId: page.loggedIn ? userId : null,
    cookiesStored: hasSessionCookies(),
  };
}

/** Дерево разделов: с главной или из конкретной категории/раздела. */
export async function getCategories(rootIdOrUrl?: string | number): Promise<{
  source: string;
  categories: CategoryBlock[];
  nodes: ForumNode[];
}> {
  const path = rootIdOrUrl ? forumPath(rootIdOrUrl) : '/';
  const page = await getPage(path);
  const tree = parseNodeTree(page.html);
  return { source: page.finalUrl, ...tree };
}

export interface ForumOptions {
  page?: number;
  prefixId?: number;
  /** Сортировка списка тем. */
  order?: 'last_post_date' | 'post_date' | 'reply_count' | 'view_count' | 'first_post_reaction_score';
  direction?: 'asc' | 'desc';
}

export async function getForum(idOrUrl: string | number, opts: ForumOptions = {}): Promise<ForumPage & { url: string }> {
  const params = new URLSearchParams();
  if (opts.prefixId) params.set('prefix_id', String(opts.prefixId));
  if (opts.order) params.set('order', opts.order);
  if (opts.direction) params.set('direction', opts.direction);
  const query = params.toString();
  const path = forumPath(idOrUrl, opts.page ?? 1) + (query ? `?${query}` : '');

  const page = await getPage(path);
  const parsed = parseThreadList(page.html, page.finalUrl);
  if (!parsed.forum.title && parsed.threads.length === 0 && parsed.subNodes.length === 0) {
    throw new NotFoundError(`Раздел не найден или пуст: ${toUrl(path)}`);
  }
  return { ...parsed, url: page.finalUrl };
}

export interface ThreadOptions {
  page?: number;
  /** Прочитать все страницы темы (ограничение — maxPages). */
  allPages?: boolean;
  maxPages?: number;
}

export async function getThread(idOrUrl: string | number, opts: ThreadOptions = {}): Promise<ThreadPage> {
  const first = await getPage(threadPath(idOrUrl, opts.page ?? 1));
  const parsed = parseThread(first.html, first.finalUrl);
  if (!parsed.posts.length && !parsed.title) {
    throw new NotFoundError(`Тема не найдена: ${toUrl(threadPath(idOrUrl))}`);
  }

  if (opts.allPages && parsed.pages > parsed.page) {
    const limit = Math.min(parsed.pages, (opts.page ?? 1) + (opts.maxPages ?? 5) - 1);
    for (let p = (opts.page ?? 1) + 1; p <= limit; p++) {
      const next = await getPage(threadPath(idOrUrl, p));
      const more = parseThread(next.html, next.finalUrl);
      parsed.posts.push(...more.posts);
      parsed.gates.push(...more.gates);
    }
  }
  return parsed;
}

/** Одно сообщение по его id (/posts/<id>/). */
export async function getPost(postId: number | string): Promise<{ thread: Omit<ThreadPage, 'posts'>; post: ThreadPage['posts'][number] }> {
  const page = await getPage(`/posts/${postId}/`);
  const parsed = parseThread(page.html, page.finalUrl);
  const post = parsed.posts.find((p) => String(p.id) === String(postId));
  if (!post) throw new NotFoundError(`Сообщение #${postId} не найдено на странице ${page.finalUrl}`);
  const { posts, ...thread } = parsed;
  return { thread, post };
}

export interface SearchOptions {
  keywords: string;
  /** Искать только в заголовках тем. */
  titleOnly?: boolean;
  /** Ограничить разделами (id узлов). */
  forumIds?: number[];
  /** Включая подразделы. */
  childNodes?: boolean;
  author?: string;
  /** ISO-дата, например 2026-01-01. */
  newerThan?: string;
  order?: 'relevance' | 'date' | 'replies';
  /** thread — искать темы, post — сообщения. */
  type?: 'thread' | 'post';
  page?: number;
}

export async function search(opts: SearchOptions): Promise<SearchResults & { requiresLogin?: boolean }> {
  // Поиск на форуме доступен только авторизованным — сразу подсказываем это.
  const form = await getPage('/search/', { noCache: true });
  const token = form.csrf;
  if (!form.loggedIn) {
    throw new AuthRequiredError('Поиск по форуму доступен только авторизованным пользователям.', toUrl('/search/'), 'Вызови yg_login.');
  }

  const body = new URLSearchParams();
  body.set('keywords', opts.keywords);
  body.set('search_type', opts.type === 'thread' ? 'post' : (opts.type ?? 'post'));
  if (opts.type === 'thread') body.set('c[title_only]', '1');
  if (opts.titleOnly) body.set('c[title_only]', '1');
  if (opts.author) body.set('c[users]', opts.author);
  if (opts.newerThan) body.set('c[newer_than]', opts.newerThan);
  for (const id of opts.forumIds ?? []) body.append('c[nodes][]', String(id));
  if ((opts.forumIds?.length ?? 0) > 0 && opts.childNodes !== false) body.set('c[child_nodes]', '1');
  body.set('order', opts.order ?? 'relevance');
  if (token) body.set('_xfToken', token);

  const res = await getPage('/search/search', { method: 'POST', body, noCache: true, headers: { Referer: toUrl('/search/') } });
  let parsed = parseSearchResults(res.html, res.finalUrl);

  if (opts.page && opts.page > 1 && parsed.resultsUrl) {
    const paged = parsed.resultsUrl.replace(/\/?(\?|$)/, `/page-${opts.page}$1`);
    const next = await getPage(paged, { noCache: true });
    parsed = parseSearchResults(next.html, next.finalUrl);
  }
  return parsed;
}

/** Произвольная страница форума (например /pages/... или профиль) в виде markdown. */
export async function getGenericPage(pathOrUrl: string): Promise<{ url: string; title: string; markdown: string }> {
  const page = await getPage(pathOrUrl);
  const cheerio = await import('cheerio');
  const $ = cheerio.load(page.html);
  const { renderBody } = await import('./parse/body.js');
  const $main = $('.p-body-pageContent .block-body, .p-body-content').first();
  const rendered = renderBody($, $main);
  return {
    url: page.finalUrl,
    title: $('h1.p-title-value').first().text().replace(/\s+/g, ' ').trim() || $('title').text().trim(),
    markdown: rendered.markdown.slice(0, 40_000),
  };
}

export const BASE_URL = config.baseUrl;
