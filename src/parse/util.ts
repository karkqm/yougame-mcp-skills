import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { config } from '../config.js';

export function abs(href: string | undefined | null): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) return null;
  try {
    return new URL(raw, config.baseUrl + '/').toString();
  } catch {
    return null;
  }
}

/**
 * Разворачивает редирект-обёртку XenForo: /proxy.php?link=<url>&hash=...
 * Возвращает настоящий адрес внешнего ресурса.
 */
export function unwrapProxy(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, config.baseUrl + '/');
    if (u.pathname.endsWith('/proxy.php')) {
      const link = u.searchParams.get('link');
      if (link) return link;
    }
    // Внешние редиректы вида /goto/link?url=...
    const alt = u.searchParams.get('url');
    if (alt && /^https?:/i.test(alt) && u.pathname.includes('goto')) return alt;
    return u.toString();
  } catch {
    return href;
  }
}

/** «2.6K», «1,2 тыс.», «12K» → число. */
export function parseCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, '').replace(',', '.').toUpperCase();
  const m = t.match(/^([\d.]+)([KKМM])?/);
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  if (m[2] === 'K' || m[2] === 'К') return Math.round(value * 1000);
  if (m[2] === 'M' || m[2] === 'М') return Math.round(value * 1_000_000);
  return Math.round(value);
}

export function textOf($: CheerioAPI, el: Cheerio<AnyNode> | undefined): string {
  if (!el || el.length === 0) return '';
  return el.first().text().replace(/\s+/g, ' ').trim();
}

/** Читает <time data-timestamp> → ISO-строка. */
export function timeOf(el: Cheerio<AnyNode> | undefined): string | null {
  if (!el || el.length === 0) return null;
  const node = el.first();
  const ts = node.attr('data-timestamp');
  if (ts) {
    const n = Number.parseInt(ts, 10);
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
  }
  const dt = node.attr('datetime');
  if (dt) {
    const d = new Date(dt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function idFromClass(className: string | undefined, prefix: string): number | null {
  if (!className) return null;
  const m = className.match(new RegExp(prefix + '(\\d+)'));
  return m ? Number.parseInt(m[1], 10) : null;
}

/** /threads/385534/ или /threads/slug.385534/page-2 → 385534 */
export function threadIdFromUrl(href: string | null): number | null {
  if (!href) return null;
  const m = href.match(/\/threads\/(?:[^/]*?\.)?(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function nodeIdFromUrl(href: string | null): number | null {
  if (!href) return null;
  const m = href.match(/\/(?:forums|categories)\/(?:[^/]*?\.)?(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Максимальный номер страницы из блока пагинации. */
export function maxPage($: CheerioAPI): number {
  const jump = $('input.js-pageJumpPage').first().attr('max');
  if (jump) {
    const n = Number.parseInt(jump, 10);
    if (Number.isFinite(n)) return n;
  }
  let max = 1;
  $('.pageNav-page a').each((_, el) => {
    const n = Number.parseInt($(el).text().trim(), 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

export function breadcrumbs($: CheerioAPI): Array<{ title: string; url: string | null; nodeId: number | null }> {
  const out: Array<{ title: string; url: string | null; nodeId: number | null }> = [];
  const seen = new Set<string>();
  // Блок крошек рендерится дважды — над и под содержимым страницы.
  $('.p-breadcrumbs li a').each((_, el) => {
    const $el = $(el);
    const href = abs($el.attr('href'));
    const title = $el.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const key = `${title}|${href ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, url: href, nodeId: nodeIdFromUrl(href) });
  });
  return out;
}
