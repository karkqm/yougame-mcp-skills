import * as cheerio from 'cheerio';
import { abs, maxPage, threadIdFromUrl, timeOf } from './util.js';

export interface SearchHit {
  title: string;
  url: string | null;
  threadId: number | null;
  snippet: string | null;
  author: string | null;
  date: string | null;
  forum: string | null;
  kind: 'thread' | 'post' | 'other';
}

export interface SearchResults {
  query: string | null;
  /** Постоянная ссылка на результаты (/search/<id>/?q=...). */
  resultsUrl: string | null;
  hits: SearchHit[];
  page: number;
  pages: number;
}

/** Разбор страницы результатов поиска XenForo (.contentRow / .block-row). */
export function parseSearchResults(html: string, requestedUrl?: string): SearchResults {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // .contentRow вложен в li.block-row — берём внутренний блок, а внешний только как запасной.
  const rows = $('.contentRow').length ? $('.contentRow') : $('li.block-row');

  rows.each((_, row) => {
    const $row = $(row);
    const $title = $row.find('.contentRow-title a, h3 a').first();
    const href = abs($title.attr('href'));
    if (!href || !/\/(threads|posts)\//.test(href)) return;
    if (seen.has(href)) return;
    seen.add(href);

    const minor = $row.find('.contentRow-minor').first().text().replace(/\s+/g, ' ').trim();
    const forumLink = $row
      .find('a')
      .filter((__, a) => /\/forums\//.test($(a).attr('href') || ''))
      .first()
      .text()
      .trim();

    hits.push({
      title: $title.text().replace(/\s+/g, ' ').trim(),
      url: href,
      threadId: threadIdFromUrl(href),
      snippet: $row.find('.contentRow-snippet').first().text().replace(/\s+/g, ' ').trim() || null,
      author: $row.find('.username').first().text().trim() || null,
      date: timeOf($row.find('time').first()) || null,
      forum: forumLink || (minor.split('·').pop() ?? null),
      kind: /\/posts\//.test(href) ? 'post' : 'thread',
    });
  });

  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const pageMatch = (requestedUrl || canonical).match(/page-(\d+)/);
  let query: string | null = null;
  try {
    query = new URL(canonical || requestedUrl || 'https://x/').searchParams.get('q');
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
