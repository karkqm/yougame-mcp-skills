import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { ucConfig } from '../config.js';

export function abs(href: string | undefined | null): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) return null;
  try {
    return new URL(raw, ucConfig.baseUrl + '/').toString();
  } catch {
    return null;
  }
}

export function unwrapRedirect(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, ucConfig.baseUrl + '/');
    const link = u.searchParams.get('url') || u.searchParams.get('link');
    if (link && /^https?:/i.test(link)) return link;
    return u.toString();
  } catch {
    return href;
  }
}

export function parseCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = text.replace(/[,\s]+/g, '').toUpperCase();
  const m = t.match(/^([\d.]+)([KM])?/);
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  if (m[2] === 'K') return Math.round(value * 1000);
  if (m[2] === 'M') return Math.round(value * 1_000_000);
  return Math.round(value);
}

export function textOf($: CheerioAPI, el: Cheerio<AnyNode> | undefined): string {
  if (!el || el.length === 0) return '';
  return el.first().text().replace(/\s+/g, ' ').trim();
}

export function timeOf(el: Cheerio<AnyNode> | undefined): string | null {
  if (!el || el.length === 0) return null;
  const node = el.first();
  const ts = node.attr('data-timestamp') || node.attr('data-time');
  if (ts) {
    const n = Number.parseInt(ts, 10);
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
  }
  const dt = node.attr('datetime');
  if (dt) {
    const d = new Date(dt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const title = node.attr('title');
  if (title) {
    const d = new Date(title);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const text = node.text().trim();
  if (/^\d{1,2}(st|nd|rd|th)?\s+\w+\s+\d{4}/.test(text) || /^\w+\s+\d{1,2},?\s+\d{4}/.test(text)) {
    const d = new Date(text.replace(/(st|nd|rd|th)/i, ''));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function idFromAttr(value: string | undefined, prefix: string): number | null {
  if (!value) return null;
  const m = value.match(new RegExp(prefix + '(\\d+)'));
  return m ? Number.parseInt(m[1], 10) : null;
}

/** /showthread.php?t=123 or /forum/section/123-slug.html → 123 */
export function threadIdFromUrl(href: string | null): number | null {
  if (!href) return null;
  const paramMatch = href.match(/[?&]t=(\d+)/);
  if (paramMatch) return Number.parseInt(paramMatch[1], 10);
  const seoMatch = href.match(/\/(\d+)-[^/]+\.html/);
  if (seoMatch) return Number.parseInt(seoMatch[1], 10);
  return null;
}

/** /forumdisplay.php?f=123 or /forum/section-name-123/ → 123 */
export function forumIdFromUrl(href: string | null): number | null {
  if (!href) return null;
  const paramMatch = href.match(/[?&]f=(\d+)/);
  if (paramMatch) return Number.parseInt(paramMatch[1], 10);
  const seoMatch = href.match(/-(\d+)\/?$/);
  if (seoMatch) return Number.parseInt(seoMatch[1], 10);
  return null;
}

export function postIdFromUrl(href: string | null): number | null {
  if (!href) return null;
  const m = href.match(/[?&#]p=(\d+)|#post(\d+)|post_(\d+)/);
  return m ? Number.parseInt(m[1] || m[2] || m[3], 10) : null;
}

export function maxPage($: CheerioAPI): number {
  let max = 1;
  $('.pagenav .prevnext + .vbmenu_control, .pagenav td.vbmenu_control').each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(/of\s+(\d+)/i) || text.match(/(\d+)\s*$/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  $('a[href*="page="], a[href*="page-"]').each((_, el) => {
    const text = $(el).text().trim();
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  const lastLink = $('a[title="Last Page"], a.last').first().attr('href');
  if (lastLink) {
    const m = lastLink.match(/page[=-](\d+)/i);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

export function breadcrumbs($: CheerioAPI): Array<{ title: string; url: string | null; forumId: number | null }> {
  const out: Array<{ title: string; url: string | null; forumId: number | null }> = [];
  const seen = new Set<string>();
  // UC breadcrumbs are in nav[itemscope] > ul > li > span.navbar > a
  $('.breadcrumb a, #breadcrumb a, .navbit a, .navbar_breadcrumbs a, nav[itemscope] .navbar a').each((_, el) => {
    const $el = $(el);
    const href = abs($el.attr('href'));
    const title = $el.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const key = `${title}|${href ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Check sibling meta for forumdisplay.php?f=N (UC stores actual forum ID there)
    const $meta = $el.closest('li').find('meta[itemprop="item"]');
    const metaUrl = $meta.attr('content') || '';
    const fid = forumIdFromUrl(metaUrl) ?? forumIdFromUrl(href);
    out.push({ title, url: href, forumId: fid });
  });
  return out;
}
