import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { abs, breadcrumbs, idFromClass, maxPage, nodeIdFromUrl, parseCount, textOf, threadIdFromUrl, timeOf } from './util.js';

export interface ForumNode {
  id: number | null;
  type: 'forum' | 'category' | 'link' | 'page' | 'unknown';
  title: string;
  url: string | null;
  description: string | null;
  threads: number | null;
  messages: number | null;
  subForums: Array<{ id: number | null; title: string; url: string | null }>;
  lastThread: { title: string; url: string | null; date: string | null } | null;
}

export interface CategoryBlock {
  id: number | null;
  title: string;
  url: string | null;
  nodes: ForumNode[];
}

export interface ThreadListItem {
  id: number | null;
  title: string;
  url: string | null;
  prefix: string | null;
  author: string | null;
  authorId: number | null;
  createdAt: string | null;
  replies: number | null;
  views: number | null;
  lastPostAt: string | null;
  lastPostBy: string | null;
  sticky: boolean;
  locked: boolean;
}

export interface ForumPage {
  forum: { id: number | null; title: string; description: string | null };
  breadcrumbs: ReturnType<typeof breadcrumbs>;
  threads: ThreadListItem[];
  subNodes: ForumNode[];
  page: number;
  pages: number;
}

function nodeType(cls: string): ForumNode['type'] {
  if (cls.includes('node--forum')) return 'forum';
  if (cls.includes('node--category')) return 'category';
  if (cls.includes('node--link')) return 'link';
  if (cls.includes('node--page')) return 'page';
  return 'unknown';
}

function statsOf($: CheerioAPI, $node: Cheerio<AnyNode>): { threads: number | null; messages: number | null } {
  let threads: number | null = null;
  let messages: number | null = null;
  $node.find('.node-statsMeta dl, .node-stats dl').each((_, dl) => {
    const label = $(dl).find('dt').text().toLowerCase();
    const value = parseCount($(dl).find('dd').text());
    if (label.includes('тем') || label.includes('thread')) threads = threads ?? value;
    else if (label.includes('сообщ') || label.includes('message')) messages = messages ?? value;
  });
  return { threads, messages };
}

function parseNode($: CheerioAPI, el: Element): ForumNode {
  const $node = $(el);
  const cls = $node.attr('class') || '';
  const $link = $node.find('.node-title a').first();
  const url = abs($link.attr('href'));
  const { threads, messages } = statsOf($, $node);

  const subForums: ForumNode['subForums'] = [];
  $node.find('.node-subNodeFlatList a, .node-subNodeList a').each((_, a) => {
    const href = abs($(a).attr('href'));
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (title) subForums.push({ id: nodeIdFromUrl(href), title, url: href });
  });

  const $last = $node.find('.node-extra-title').first();
  const lastThread = $last.length
    ? {
        title: $last.attr('title') || $last.text().replace(/\s+/g, ' ').trim(),
        url: abs($last.attr('href')),
        date: timeOf($node.find('.node-extra-date').first()),
      }
    : null;

  return {
    id: idFromClass(cls, 'node--id') ?? nodeIdFromUrl(url),
    type: nodeType(cls),
    title: $link.text().replace(/\s+/g, ' ').trim(),
    url,
    description: textOf($, $node.find('.node-description').first()) || null,
    threads,
    messages,
    subForums,
    lastThread,
  };
}

/** Дерево «категория → форумы → подфорумы» со страницы индекса или раздела. */
export function parseNodeTree(html: string): { categories: CategoryBlock[]; nodes: ForumNode[] } {
  const $ = cheerio.load(html);
  return parseNodeTreeIn($);
}

function parseNodeTreeIn($: CheerioAPI): { categories: CategoryBlock[]; nodes: ForumNode[] } {
  const categories: CategoryBlock[] = [];
  const seen = new Set<Element>();

  $('.block--category').each((_, block) => {
    const $block = $(block);
    const $header = $block.find('.block-header a').first();
    const url = abs($header.attr('href'));
    const nodes: ForumNode[] = [];
    $block.find('.node').each((__, node) => {
      seen.add(node as Element);
      nodes.push(parseNode($, node as Element));
    });
    categories.push({
      id: nodeIdFromUrl(url) ?? idFromClass($block.attr('class'), 'block--category'),
      title: $header.text().replace(/\s+/g, ' ').trim() || $block.find('.block-header').first().text().replace(/\s+/g, ' ').trim(),
      url,
      nodes,
    });
  });

  const loose: ForumNode[] = [];
  $('.node').each((_, node) => {
    if (seen.has(node as Element)) return;
    loose.push(parseNode($, node as Element));
  });

  return { categories, nodes: loose };
}

/** Список тем раздела. */
export function parseThreadList(html: string, requestedUrl?: string): ForumPage {
  const $ = cheerio.load(html);
  const threads: ThreadListItem[] = [];

  $('.structItem--thread').each((_, el) => {
    const $t = $(el);
    const cls = $t.attr('class') || '';
    const $title = $t
      .find('.structItem-title a')
      .filter((__, a) => /\/threads\//.test($(a).attr('href') || ''))
      .first();
    const url = abs($title.attr('href'));
    const $author = $t.find('.structItem-parts .username').first();
    const metaValues: Array<{ label: string; value: number | null }> = [];
    $t.find('.structItem-cell--meta dl').each((__, dl) => {
      metaValues.push({ label: $(dl).find('dt').text().toLowerCase(), value: parseCount($(dl).find('dd').text()) });
    });

    threads.push({
      id: idFromClass(cls, 'js-threadListItem-') ?? threadIdFromUrl(url),
      title: $title.text().replace(/\s+/g, ' ').trim(),
      url,
      prefix: $t.find('.structItem-title .labelLink').first().text().replace(/\s+/g, ' ').trim() || null,
      author: $t.attr('data-author') || $author.text().trim() || null,
      authorId: Number.parseInt($author.attr('data-user-id') || '', 10) || null,
      createdAt: timeOf($t.find('.structItem-startDate time').first()),
      replies: metaValues.find((m) => m.label.includes('ответ') || m.label.includes('repl'))?.value ?? null,
      views: metaValues.find((m) => m.label.includes('просмотр') || m.label.includes('view'))?.value ?? null,
      lastPostAt: timeOf($t.find('.structItem-latestDate').first()),
      lastPostBy: $t.find('.structItem-cell--latest .username').first().text().trim() || null,
      sticky: cls.includes('is-sticky') || $t.find('.structItem-status--sticky').length > 0,
      locked: cls.includes('is-locked') || $t.find('.structItem-status--locked').length > 0,
    });
  });

  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const pageMatch = (requestedUrl || canonical).match(/page-(\d+)/);
  const { categories, nodes } = parseNodeTreeIn($);

  return {
    forum: {
      id: nodeIdFromUrl(canonical) ?? nodeIdFromUrl(requestedUrl ?? null),
      title: $('h1.p-title-value').first().text().replace(/\s+/g, ' ').trim(),
      description: $('.p-description').first().text().replace(/\s+/g, ' ').trim() || null,
    },
    breadcrumbs: breadcrumbs($),
    threads,
    subNodes: [...categories.flatMap((c) => c.nodes), ...nodes],
    page: pageMatch ? Number.parseInt(pageMatch[1], 10) : 1,
    pages: maxPage($),
  };
}
