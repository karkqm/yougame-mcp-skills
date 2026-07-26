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

function parseForumRow($: CheerioAPI, $row: Cheerio<AnyNode>): ForumNode {
  const $forumCell = $row.find('td[id^="f"]').first();
  const cellId = $forumCell.attr('id') || '';
  const forumId = cellId.startsWith('f') ? Number.parseInt(cellId.slice(1), 10) : null;

  const $link = $forumCell.find('a[href*="/forum/"]').first();
  const title = $link.text().replace(/\s+/g, ' ').trim();
  const url = abs($link.attr('href'));

  const subForums: ForumNode['subForums'] = [];
  $forumCell.find('.smallfont a[href*="/forum/"]').each((_, a) => {
    const href = abs($(a).attr('href'));
    const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (t && href && href !== url) {
      const imgBefore = $(a).prev('img');
      const subId = idFromAttr(imgBefore.attr('id'), 'forum_statusicon_') ?? forumIdFromUrl(href);
      subForums.push({ id: subId, title: t, url: href });
    }
  });

  const tds = $row.find('td').toArray();
  let threads: number | null = null;
  let posts: number | null = null;
  if (tds.length >= 2) {
    posts = parseCount($(tds[tds.length - 1]).text());
    threads = parseCount($(tds[tds.length - 2]).text());
  }

  const $lastCell = $row.find('td.alt2 .smallfont').first();
  const $lastLink = $lastCell.find('a[href*="-new-post"], a[href*="showthread"], a[title]').first();
  const lastThread = $lastLink.length
    ? {
        title: ($lastLink.attr('title') || '').replace(/^Go to first unread post in thread '|'$/g, '') || $lastLink.text().replace(/\s+/g, ' ').trim(),
        url: abs($lastLink.attr('href')),
        date: $lastCell.find('.time').parent().text().replace(/\s+/g, ' ').trim() || null,
        author: $lastCell.find('a[href*="member.php"]').text().trim() || null,
      }
    : null;

  return {
    id: forumId ?? forumIdFromUrl(url),
    title,
    url,
    description: null,
    threads,
    posts,
    subForums,
    lastThread,
  };
}

export function parseForumIndex(html: string): { categories: CategoryBlock[]; forums: ForumNode[] } {
  const $ = cheerio.load(html);
  const categories: CategoryBlock[] = [];

  // UC structure: table#forum-list-top-N has category title in td.tcat,
  // table#forum-list-N > tbody#collapseobj_forumbit_N has forum rows.
  // Forum rows are plain <tr> with td[id^="f"] for the forum cell.
  $('tbody[id^="collapseobj_forumbit_"]').each((_, block) => {
    const $block = $(block);
    const catNum = ($block.attr('id') || '').replace('collapseobj_forumbit_', '');
    const $catHeader = $(`table#forum-list-top-${catNum} td.tcat`);
    const catTitle = $catHeader.find('b').text().trim() || $catHeader.text().trim();
    if (!catTitle) return;

    const forums: ForumNode[] = [];
    $block.find('tr').each((__, row) => {
      const $row = $(row);
      if (!$row.find('td[id^="f"]').length) return;
      forums.push(parseForumRow($, $row));
    });

    categories.push({
      id: catNum ? Number.parseInt(catNum, 10) : null,
      title: catTitle,
      url: null,
      forums,
    });
  });

  // Fallback: any forum cells on page
  if (!categories.length) {
    const forums: ForumNode[] = [];
    $('td[id^="f"]').each((_, cell) => {
      const $row = $(cell).closest('tr');
      if ($row.length) forums.push(parseForumRow($, $row));
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

  // UC: thread rows are <tr> containing td[id^="td_threadtitle_"]
  $('td[id^="td_threadtitle_"]').each((_, cell) => {
    const $cell = $(cell);
    const $t = $cell.closest('tr');
    const cellId = $cell.attr('id') || '';
    const $titleLink = $cell.find('a[id^="thread_title_"]').first();
    const url = abs($titleLink.attr('href'));
    const threadId = idFromAttr(cellId, 'td_threadtitle_') ?? threadIdFromUrl(url);

    const titleText = $titleLink.text().replace(/\s+/g, ' ').trim();

    // Prefix: [Tag] before the title link, or font with Sticky
    let prefix: string | null = null;
    const cellText = $cell.text();
    const prefixMatch = cellText.match(/\[([^\]]+)\]/);
    if (prefixMatch) prefix = prefixMatch[1].trim();

    // Author: span with onclick containing member URL
    const authorEl = $cell.find('.smallfont span[onclick*="member"]').first();
    const author = authorEl.text().trim() || null;

    // Replies/Views from title attribute on last-post td: "Replies: N, Views: N"
    let replies: number | null = null;
    let views: number | null = null;
    $t.find('td[title*="Replies"]').each((__, td) => {
      const titleAttr = $(td).attr('title') || '';
      const rMatch = titleAttr.match(/Replies:\s*([\d,]+)/);
      const vMatch = titleAttr.match(/Views:\s*([\d,]+)/);
      if (rMatch) replies = parseCount(rMatch[1]);
      if (vMatch) views = parseCount(vMatch[1]);
    });
    // Fallback: last two numeric tds
    if (replies === null || views === null) {
      const tds = $t.find('td').toArray();
      if (tds.length >= 2) {
        const lastTd = $(tds[tds.length - 1]).text().trim();
        const prevTd = $(tds[tds.length - 2]).text().trim();
        if (views === null) views = parseCount(lastTd);
        if (replies === null) replies = parseCount(prevTd);
      }
    }

    const $lastPost = $t.find('td[title*="Replies"] .smallfont, td.alt2 .smallfont').last();
    const sticky = $cell.find('img[alt*="Sticky"]').length > 0 || /Sticky/i.test($cell.find('font[color] b').text());
    const locked = $cell.find('img[alt*="Closed"], img[src*="lock"]').length > 0;

    let rating: number | null = null;
    const ratingImg = $cell.find('img[alt*="Rating"]').first();
    const ratingAlt = ratingImg.attr('alt') || '';
    const ratingMatch = ratingAlt.match(/([\d.]+)\s*average/);
    if (ratingMatch) rating = Math.round(Number.parseFloat(ratingMatch[1]));

    const lastPostBy = $lastPost.find('a[href*="member.php"]').text().trim() || null;

    threads.push({
      id: threadId,
      title: titleText,
      url,
      prefix,
      author,
      replies,
      views,
      lastPostAt: timeOf($lastPost) ?? ($lastPost.find('.time').text().trim() || null),
      lastPostBy,
      sticky,
      locked,
      rating,
    });
  });

  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const pageMatch = (requestedUrl || canonical).match(/page[=-](\d+)/i);

  const subForums: ForumNode[] = [];
  $('td[id^="f"]').each((_, cell) => {
    const $row = $(cell).closest('tr');
    if ($row.length) subForums.push(parseForumRow($, $row));
  });

  // Forum title from <title> tag (UC has no h1 on forum pages)
  const rawTitle = $('title').text().replace(/\s+/g, ' ').trim();
  const forumTitle = rawTitle.replace(/\s*[-–—|]\s*UnKnoWnCheaTs.*$/i, '').trim() || rawTitle;

  // Forum ID from hidden input, URL param, or canonical
  const forumIdInput = $('input[name="forumid"]').attr('value');
  const forumId = (forumIdInput ? Number.parseInt(forumIdInput, 10) : null) ??
    forumIdFromUrl(canonical) ?? forumIdFromUrl(requestedUrl ?? null);

  return {
    forum: {
      id: forumId,
      title: forumTitle,
      description: $('meta[name="description"]').attr('content')?.trim() || null,
    },
    breadcrumbs: breadcrumbs($),
    threads,
    subForums,
    page: pageMatch ? Number.parseInt(pageMatch[1], 10) : 1,
    pages: maxPage($),
  };
}
