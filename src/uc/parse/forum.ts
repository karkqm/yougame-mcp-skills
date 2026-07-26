import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { abs, breadcrumbs, forumIdFromUrl, idFromAttr, maxPage, parseCount, textOf, threadIdFromUrl, timeOf } from './util.js';

export interface ForumNode {
  id: number | null;
  title: string;
  url: string | null;
  description: string | null;
  threads: number | null;
  posts: number | null;
  subForums: Array<{ id: number | null; title: string; url: string | null }>;
  lastThread: { title: string; url: string | null; date: string | null; author: string | null } | null;
}

export interface CategoryBlock {
  id: number | null;
  title: string;
  url: string | null;
  forums: ForumNode[];
}

export interface ThreadListItem {
  id: number | null;
  title: string;
  url: string | null;
  prefix: string | null;
  author: string | null;
  replies: number | null;
  views: number | null;
  lastPostAt: string | null;
  lastPostBy: string | null;
  sticky: boolean;
  locked: boolean;
  rating: number | null;
}

export interface ForumPage {
  forum: { id: number | null; title: string; description: string | null };
  breadcrumbs: ReturnType<typeof breadcrumbs>;
  threads: ThreadListItem[];
  subForums: ForumNode[];
  page: number;
  pages: number;
}

function parseForumNode($: CheerioAPI, el: Cheerio<AnyNode>): ForumNode {
  const $node = $(el);
  const $link = $node.find('a[href*="forumdisplay"], a[href*="/forum/"]').first();
  if (!$link.length) {
    const $any = $node.find('h2 a, h3 a, .forumtitle a, td a').first();
    $link.add($any);
  }
  const title = $link.text().replace(/\s+/g, ' ').trim() || $node.find('h2, h3, .forumtitle').first().text().replace(/\s+/g, ' ').trim();
  const url = abs($link.attr('href'));
  const id = idFromAttr($node.attr('id'), 'forum') ?? forumIdFromUrl(url);

  const subForums: ForumNode['subForums'] = [];
  $node.find('.subforums a, .subforum a, .childforumlist a').each((_, a) => {
    const href = abs($(a).attr('href'));
    const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (t && href) subForums.push({ id: forumIdFromUrl(href), title: t, url: href });
  });

  let threads: number | null = null;
  let posts: number | null = null;
  $node.find('td, .forumstats dd, .forumdata dd').each((_, td) => {
    const text = $(td).text().toLowerCase();
    const val = parseCount($(td).text());
    if (text.includes('thread')) threads = threads ?? val;
    else if (text.includes('post') || text.includes('message')) posts = posts ?? val;
    else if (threads === null) threads = val;
    else if (posts === null) posts = val;
  });

  const $last = $node.find('.lastpostinfo a, .lastpost a, .lastthread a').first();
  const lastThread = $last.length
    ? {
        title: $last.attr('title') || $last.text().replace(/\s+/g, ' ').trim(),
        url: abs($last.attr('href')),
        date: timeOf($node.find('.lastpostdate, .lastpost .time, .lastpost .date').first()),
        author: $node.find('.lastpost .username, .lastpostby a').first().text().trim() || null,
      }
    : null;

  const description =
    textOf($, $node.find('.forumdescription, .forum-description, .foruminfo p').first()) || null;

  return { id, title, url, description, threads, posts, subForums, lastThread };
}

export function parseForumIndex(html: string): { categories: CategoryBlock[]; forums: ForumNode[] } {
  const $ = cheerio.load(html);
  const categories: CategoryBlock[] = [];
  const seenForums = new Set<string>();

  // UC forum index: categories are tbody or div blocks with forum rows inside
  $('table.tborder tbody[id^="collapseobj_forumbit_"], .forumbit_post, .category-forum-list').each((_, block) => {
    const $block = $(block);
    const $header = $block.prev('thead, .thead').find('a').first();
    if (!$header.length) return;
    const catUrl = abs($header.attr('href'));
    const forums: ForumNode[] = [];
    $block.find('tr[id^="forum"], .forumbit_nopost, .forumrow, li[id^="forum"]').each((__, row) => {
      const key = $(row).attr('id') || '';
      if (seenForums.has(key) && key) return;
      if (key) seenForums.add(key);
      forums.push(parseForumNode($, $(row)));
    });
    categories.push({
      id: forumIdFromUrl(catUrl),
      title: $header.text().replace(/\s+/g, ' ').trim(),
      url: catUrl,
      forums,
    });
  });

  // Fallback: parse all forum rows if category detection didn't work
  if (!categories.length) {
    const forums: ForumNode[] = [];
    $('tr[id^="forum"], li[id^="forum"], .forumbit_post').each((_, row) => {
      forums.push(parseForumNode($, $(row)));
    });
    if (forums.length) {
      categories.push({ id: null, title: 'Forums', url: null, forums });
    }
  }

  return { categories, forums: [] };
}

export function parseThreadList(html: string, requestedUrl?: string): ForumPage {
  const $ = cheerio.load(html);
  const threads: ThreadListItem[] = [];

  // Thread rows in various vBulletin layouts
  $('tr[id^="thread_"], li[id^="thread_"], .threadbit').each((_, el) => {
    const $t = $(el);
    const elId = $t.attr('id') || '';
    const $titleLink = $t.find('a[id^="thread_title_"], .threadtitle a, .title a').first();
    const url = abs($titleLink.attr('href'));
    const threadId = idFromAttr(elId, 'thread_') ?? threadIdFromUrl(url);

    const prefix = $t.find('.prefix, .threadprefix, span[class*="prefix"]').first().text().replace(/\s+/g, ' ').trim() || null;
    const titleText = $titleLink.text().replace(/\s+/g, ' ').trim();
    const author = $t.find('.author a, .username, td.alt2 a.username').first().text().trim() || null;

    let replies: number | null = null;
    let views: number | null = null;
    $t.find('td, .threadstats dd, .threadmeta dd').each((__, td) => {
      const label = $(td).text().toLowerCase();
      const val = parseCount($(td).text());
      if (label.includes('repl') || label.includes('ответ')) replies = replies ?? val;
      else if (label.includes('view') || label.includes('просмотр')) views = views ?? val;
    });
    // Fallback: sequential tds for replies/views
    if (replies === null || views === null) {
      const tds = $t.find('td.alt2, td.alt1').toArray();
      if (tds.length >= 4) {
        replies = replies ?? parseCount($(tds[tds.length - 3]).text());
        views = views ?? parseCount($(tds[tds.length - 2]).text());
      }
    }

    const $lastPost = $t.find('.lastpostdate, .lastpost .time, .threadlastpost').first();
    const sticky = /sticky|закреп/i.test($t.attr('class') || '') || $t.find('.threadicon img[src*="sticky"]').length > 0;
    const locked = /locked|закры/i.test($t.attr('class') || '') || $t.find('.threadicon img[src*="lock"]').length > 0;

    let rating: number | null = null;
    const ratingText = $t.find('.threadrating img, .rating').first().attr('alt') || '';
    const ratingMatch = ratingText.match(/(\d+)/);
    if (ratingMatch) rating = Number.parseInt(ratingMatch[1], 10);

    threads.push({
      id: threadId,
      title: titleText,
      url,
      prefix,
      author,
      replies,
      views,
      lastPostAt: timeOf($lastPost),
      lastPostBy: $t.find('.lastpost .username, .lastpostby a').first().text().trim() || null,
      sticky,
      locked,
      rating,
    });
  });

  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const pageMatch = (requestedUrl || canonical).match(/page[=-](\d+)/i);

  const subForums: ForumNode[] = [];
  $('tr[id^="forum"], li[id^="forum"]').each((_, el) => {
    subForums.push(parseForumNode($, $(el)));
  });

  return {
    forum: {
      id: forumIdFromUrl(canonical) ?? forumIdFromUrl(requestedUrl ?? null),
      title: $('h1, .forumtitle h1, .pagetitle h1, #pagetitle h1, .forum-title').first().text().replace(/\s+/g, ' ').trim(),
      description: textOf($, $('meta[name="description"]').first()) ||
        textOf($, $('.forumdescription').first()) || null,
    },
    breadcrumbs: breadcrumbs($),
    threads,
    subForums,
    page: pageMatch ? Number.parseInt(pageMatch[1], 10) : 1,
    pages: maxPage($),
  };
}
