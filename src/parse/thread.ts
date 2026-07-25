import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { renderBody, type BodyGate, type BodyLink, type BodyCode } from './body.js';
import { abs, breadcrumbs, maxPage, parseCount, threadIdFromUrl, timeOf } from './util.js';

export interface PostAttachment {
  id: number | null;
  name: string;
  url: string | null;
  size: string | null;
}

export interface Post {
  id: number | null;
  number: string | null;
  author: string | null;
  authorId: number | null;
  authorTitle: string | null;
  authorMessages: number | null;
  postedAt: string | null;
  editedAt: string | null;
  isFirst: boolean;
  /** Текст сообщения в markdown; хайды помечены как 🔒. */
  body: string;
  links: BodyLink[];
  code: BodyCode[];
  images: string[];
  attachments: PostAttachment[];
  /** Замки: что мешает увидеть содержимое целиком. */
  gates: BodyGate[];
  reactions: number | null;
  url: string | null;
}

export interface ThreadPage {
  id: number | null;
  title: string;
  prefix: string | null;
  url: string | null;
  author: string | null;
  createdAt: string | null;
  tags: string[];
  /** Блок «Краткое описание (ИИ-агент)» с самого форума, если есть. */
  aiSummary: string | null;
  breadcrumbs: ReturnType<typeof breadcrumbs>;
  customFields: Array<{ field: string; label: string; value: string }>;
  posts: Post[];
  page: number;
  pages: number;
  /** Сводка по замкам на странице. */
  gates: BodyGate[];
  loggedIn: boolean;
}

function parseAttachments($: CheerioAPI, el: Element): PostAttachment[] {
  const out: PostAttachment[] = [];
  $(el)
    .find('.message-attachments .attachmentList li, .attachmentList li')
    .each((_, li) => {
      const $li = $(li);
      const $a = $li.find('a[href*="/attachments/"]').first();
      const href = abs($a.attr('href'));
      const id = href ? Number.parseInt(href.match(/\/attachments\/(?:[^/]*?\.)?(\d+)/)?.[1] || '', 10) || null : null;
      const name =
        $li.find('.file-name').first().attr('title') ||
        $li.find('.file-name').first().text().replace(/\s+/g, ' ').trim() ||
        $a.find('img').attr('alt') ||
        (href ? href.split('/').filter(Boolean).pop() || 'attachment' : 'attachment');
      const size = $li.find('.file-meta').first().text().replace(/\s+/g, ' ').trim().split('·')[0]?.trim() || null;
      if (href) out.push({ id, name, url: href, size });
    });
  return out;
}

function parsePost($: CheerioAPI, el: Element, threadUrl: string | null): Post {
  const $p = $(el);
  const cls = $p.attr('class') || '';
  const idAttr = $p.attr('data-content') || '';
  const id = Number.parseInt(idAttr.replace(/^post-/, ''), 10) || null;

  const $bodyWrap = $p.find('.message-body .bbWrapper').first();
  const rendered = renderBody($, $bodyWrap);

  // Вложения перечисляем и как ресурсы, и как ссылки для скачивания.
  const attachments = parseAttachments($, el);

  const $userExtras = $p.find('.message-userExtras');
  let authorMessages: number | null = null;
  $userExtras.find('dl').each((_, dl) => {
    if ($(dl).find('dt').text().toLowerCase().includes('сообщ')) {
      authorMessages = parseCount($(dl).find('dd').text());
    }
  });

  const number = $p.find('.message-attribution-opposite a').last().text().replace(/\s+/g, ' ').trim() || null;

  return {
    id,
    number: number && number.startsWith('#') ? number : number ? `#${number}` : null,
    author: $p.attr('data-author') || $p.find('.message-name .username').first().text().trim() || null,
    authorId: Number.parseInt($p.find('.message-name .username').first().attr('data-user-id') || '', 10) || null,
    authorTitle: $p.find('.userBanner').first().text().replace(/\s+/g, ' ').trim() || null,
    authorMessages,
    postedAt: timeOf($p.find('.message-attribution-main time, .message-attribution time').first()),
    editedAt: timeOf($p.find('.message-lastEdit time').first()),
    isFirst: cls.includes('is-first'),
    body: rendered.markdown,
    links: rendered.links,
    code: rendered.code,
    images: rendered.images,
    attachments,
    gates: rendered.gates,
    reactions: parseCount($p.find('.reactionsBar .reactionSummary').first().text()) ?? null,
    url: id && threadUrl ? `${threadUrl.replace(/\/$/, '')}/post-${id}` : null,
  };
}

/** Полный разбор страницы темы: шапка, посты, комментарии, вложения, замки. */
export function parseThread(html: string, requestedUrl?: string): ThreadPage {
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const threadUrl = abs(canonical.replace(/\/page-\d+.*$/, '')) || null;

  const $title = $('h1.p-title-value').first();
  const prefix = $title.find('.labelLink, .yg-label').first().text().replace(/\s+/g, ' ').trim() || null;
  const titleClone = $title.clone();
  titleClone.find('.labelLink, .yg-label, .label-append').remove();

  const tags: string[] = [];
  $('.js-tagList .tagItem').each((_, a) => {
    const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (t) tags.push(t);
  });

  // Блок «Краткое описание (ИИ-агент)» — сводка, которую форум генерирует сам.
  let aiSummary: string | null = null;
  $('.block .block-header').each((_, h) => {
    if (!/ИИ-агент|краткое описание/i.test($(h).text())) return;
    const text = $(h).parent().find('.block-body').first().text().replace(/\s+/g, ' ').trim();
    if (text) aiSummary = text;
  });

  const customFields: ThreadPage['customFields'] = [];
  $('.message-fields dl[data-field]').each((_, dl) => {
    const $dl = $(dl);
    customFields.push({
      field: $dl.attr('data-field') || '',
      label: $dl.find('dt').first().text().replace(/\s+/g, ' ').trim(),
      value: $dl.find('dd').first().text().replace(/\s+/g, ' ').trim(),
    });
  });

  const posts: Post[] = [];
  $('article.message--post').each((_, el) => {
    posts.push(parsePost($, el as Element, threadUrl));
  });

  const pageMatch = (requestedUrl || canonical).match(/page-(\d+)/);

  return {
    id: threadIdFromUrl(canonical) ?? threadIdFromUrl(requestedUrl ?? null),
    title: titleClone.text().replace(/\s+/g, ' ').trim(),
    prefix,
    url: threadUrl,
    author: $('.p-description .username').first().text().trim() || posts[0]?.author || null,
    createdAt: timeOf($('.p-description time').first()) || posts[0]?.postedAt || null,
    tags,
    aiSummary,
    breadcrumbs: breadcrumbs($),
    customFields,
    posts,
    page: pageMatch ? Number.parseInt(pageMatch[1], 10) : 1,
    pages: maxPage($),
    gates: posts.flatMap((p) => p.gates),
    loggedIn: /data-logged-in="true"/.test(html),
  };
}
