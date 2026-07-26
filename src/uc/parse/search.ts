import * as cheerio from 'cheerio';
import { abs, maxPage, threadIdFromUrl, timeOf, postIdFromUrl } from './util.js';

export interface SearchHit {
  title: string;
  url: string | null;
  threadId: number | null;
  postId: number | null;
  snippet: string | null;
  author: string | null;
  date: string | null;
  forum: string | null;
  kind: 'thread' | 'post';
}

export interface SearchResults {
  query: string | null;
  resultsUrl: string | null;
  hits: SearchHit[];
  page: number;
  pages: number;
}

export function parseSearchResults(html: string, requestedUrl?: string): SearchResults {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // vBulletin search results: li/tr blocks with thread/post results
  $('li[id^="post_"], li.searchresult, tr[id^="post_"], .searchresult_body, .searchresult').each((_, row) => {
    const $row = $(row);
    const $titleLink = $row.find('h3 a, .searchtitle a, .threadtitle a, a.title').first();
    const href = abs($titleLink.attr('href'));
    if (!href) return;
    if (seen.has(href)) return;
    seen.add(href);

    const snippet = $row.find('.searchresult_body, .postcontent, .snippet, .searchexcerpt').first()
      .text().replace(/\s+/g, ' ').trim() || null;
    const forumLink = $row.find('a[href*="forumdisplay"], a[href*="/forum/"]').first().text().trim();

    hits.push({
      title: $titleLink.text().replace(/\s+/g, ' ').trim(),
      url: href,
      threadId: threadIdFromUrl(href),
      postId: postIdFromUrl(href),
      snippet,
      author: $row.find('.username, .bigusername, a[href*="member.php"]').first().text().trim() || null,
      date: timeOf($row.find('time, .date, .datetime').first()) || null,
      forum: forumLink || null,
      kind: /showpost|#post/.test(href) ? 'post' : 'thread',
    });
  });

  // Fallback: thread-style search results
  if (!hits.length) {
    $('tr[id^="thread_"], li[id^="thread_"]').each((_, row) => {
      const $row = $(row);
      const $titleLink = $row.find('a[id^="thread_title_"], .threadtitle a').first();
      const href = abs($titleLink.attr('href'));
      if (!href || seen.has(href)) return;
      seen.add(href);
      hits.push({
        title: $titleLink.text().replace(/\s+/g, ' ').trim(),
        url: href,
        threadId: threadIdFromUrl(href),
        postId: null,
        snippet: null,
        author: $row.find('.username').first().text().trim() || null,
        date: timeOf($row.find('time, .date').first()) || null,
        forum: null,
        kind: 'thread',
      });
    });
  }

  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const pageMatch = (requestedUrl || canonical).match(/page[=-](\d+)/i);
  let query: string | null = null;
  try {
    query = new URL(canonical || requestedUrl || 'https://x/').searchParams.get('query') ||
      new URL(canonical || requestedUrl || 'https://x/').searchParams.get('searchstring');
  } catch {
    query = null;
  }

  return {
    query,
    resultsUrl: canonical || requestedUrl || null,
    hits,
    page: pageMatch ? Number.parseInt(pageMatch[1], 10) : 1,
    pages: maxPage($),
  };
}
