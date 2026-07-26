import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { renderBody, type BodyLink, type BodyCode } from './body.js';
import { abs, breadcrumbs, idFromAttr, maxPage, parseCount, threadIdFromUrl, timeOf } from './util.js';

export interface PostAttachment {
  id: number | null;
  name: string;
  url: string | null;
  size: string | null;
}

export interface Post {
  id: number | null;
  number: number | null;
  author: string | null;
  authorId: number | null;
  authorTitle: string | null;
  authorPosts: number | null;
  authorRep: number | null;
  authorJoined: string | null;
  postedAt: string | null;
  body: string;
  links: BodyLink[];
  code: BodyCode[];
  images: string[];
  attachments: PostAttachment[];
  thanks: number | null;
  url: string | null;
}

export interface ThreadPage {
  id: number | null;
  title: string;
  url: string | null;
  author: string | null;
  tags: string[];
  breadcrumbs: ReturnType<typeof breadcrumbs>;
  posts: Post[];
  page: number;
  pages: number;
  loggedIn: boolean;
}

function parseAttachments($: CheerioAPI, $post: Cheerio<AnyNode>): PostAttachment[] {
  const out: PostAttachment[] = [];
  $post.find('.attachments a, .attachment a, a[href*="attachment.php"], a[href*="/attachments/"]').each((_, a) => {
    const $a = $(a);
    const href = abs($a.attr('href'));
    if (!href) return;
    const name = $a.text().replace(/\s+/g, ' ').trim() || $a.find('img').attr('alt') || 'attachment';
    const idMatch = href.match(/attachmentid=(\d+)|attachment\.php\?.*?(\d+)/);
    const id = idMatch ? Number.parseInt(idMatch[1] || idMatch[2], 10) : null;
    const sizeEl = $a.parent().find('.fileinfo, .smallfont').first().text();
    const size = sizeEl.match(/([\d.,]+\s*(?:KB|MB|GB|bytes))/i)?.[1] || null;
    if (!out.some((a) => a.url === href)) {
      out.push({ id, name, url: href, size });
    }
  });
  return out;
}

function parsePost($: CheerioAPI, el: Element, threadUrl: string | null): Post {
  const $p = $(el);
  const postId = idFromAttr($p.attr('id'), 'post_') ??
    idFromAttr($p.attr('id'), 'post') ??
    (Number.parseInt($p.attr('id')?.replace(/\D/g, '') || '', 10) || null);

  const $body = $p.find(`#post_message_${postId}, .postcontent, .postbody .content, .entry-content`).first();
  const rendered = renderBody($, $body);
  const attachments = parseAttachments($, $p);

  const $userInfo = $p.find('.userinfo, .postprofile, .posterinfo');
  const authorEl = $p.find('.bigusername, .username_container .username, .postprofile .username').first();
  const author = authorEl.text().replace(/\s+/g, ' ').trim() || null;
  const authorIdMatch = (authorEl.attr('href') || '').match(/[?&]u=(\d+)|\/members\/(\d+)/);
  const authorId = authorIdMatch ? Number.parseInt(authorIdMatch[1] || authorIdMatch[2], 10) : null;
  const authorTitle = $userInfo.find('.usertitle, .rank, .custom-title').first().text().replace(/\s+/g, ' ').trim() || null;

  let authorPosts: number | null = null;
  let authorRep: number | null = null;
  let authorJoined: string | null = null;
  $userInfo.find('dl, .userinfo_extra dd, .profilefield_list dd').each((_, dd) => {
    const label = $(dd).prev('dt').text().toLowerCase();
    const text = $(dd).text().trim();
    if (label.includes('post') || label.includes('сообщ')) authorPosts = parseCount(text);
    else if (label.includes('rep') || label.includes('репут')) authorRep = parseCount(text);
    else if (label.includes('join') || label.includes('регист')) authorJoined = text;
  });
  // Fallback for flat text userinfo
  if (authorPosts === null) {
    const postsText = $userInfo.text();
    const postsMatch = postsText.match(/Posts[:\s]+([\d,]+)/i);
    if (postsMatch) authorPosts = parseCount(postsMatch[1]);
    const repMatch = postsText.match(/(?:Reputation|Rep)[:\s]+([\d,]+)/i);
    if (repMatch) authorRep = parseCount(repMatch[1]);
  }

  const $postDate = $p.find('.postdate, .posthead .date, .thead .datetime, time').first();
  const postNumber = $p.find('.postcounter, .post_counter, a[id^="postcount"]').first().text().replace(/\D/g, '');

  let thanks: number | null = null;
  const thanksText = $p.find('.post_thanks_box, .thanks_count, .thankscount').first().text();
  const thanksMatch = thanksText.match(/(\d+)/);
  if (thanksMatch) thanks = Number.parseInt(thanksMatch[1], 10);

  return {
    id: postId,
    number: postNumber ? Number.parseInt(postNumber, 10) : null,
    author,
    authorId,
    authorTitle,
    authorPosts,
    authorRep,
    authorJoined,
    postedAt: timeOf($postDate),
    body: rendered.markdown,
    links: rendered.links,
    code: rendered.code,
    images: rendered.images,
    attachments,
    thanks,
    url: postId && threadUrl ? `${threadUrl}#post${postId}` : null,
  };
}

export function parseThread(html: string, requestedUrl?: string): ThreadPage {
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href') || requestedUrl || '';
  const threadUrl = abs(canonical.replace(/[?#].*$/, '').replace(/\/page-?\d+/i, '')) || null;

  let title = $('h1, .threadtitle, #thread_title, .pagetitle h1, #pagetitle h1, span.threadtitle').first()
    .text().replace(/\s+/g, ' ').trim();
  if (!title) {
    title = $('title').text().replace(/\s+/g, ' ').trim().replace(/\s*[-–—|]\s*UnKnoWnCheaTs.*$/i, '').trim();
  }

  const tags: string[] = [];
  $('.taglist a, .tag-list a, li.tag a').each((_, a) => {
    const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (t) tags.push(t);
  });

  const posts: Post[] = [];
  const seenPostIds = new Set<string>();
  // vBulletin post containers: table[id^="post"] (UC uses table#postNNNN)
  $('table[id^="post"]').each((_, el) => {
    const $el = $(el);
    const elId = $el.attr('id') || '';
    // Skip non-container divs (post_message_, postmenu_, etc.)
    if (/^post_|^postmenu|^postcount/.test(elId)) return;
    if ($el.parents('table[id^="post"]').length > 0) return;
    if (seenPostIds.has(elId)) return;
    seenPostIds.add(elId);
    posts.push(parsePost($, el as Element, threadUrl));
  });

  // Fallback: try .postbit containers
  if (!posts.length) {
    $('.postbit, .postbitlegacy, .postcontainer').each((_, el) => {
      posts.push(parsePost($, el as Element, threadUrl));
    });
  }

  const pageMatch = (requestedUrl || canonical).match(/page[=-](\d+)/i);
  const loggedIn = /navbar_username|id="logged_in"|class="[^"]*logged.?in/i.test(html);

  return {
    id: threadIdFromUrl(canonical) ?? threadIdFromUrl(requestedUrl ?? null),
    title,
    url: threadUrl,
    author: posts[0]?.author || null,
    tags,
    breadcrumbs: breadcrumbs($),
    posts,
    page: pageMatch ? Number.parseInt(pageMatch[1], 10) : 1,
    pages: maxPage($),
    loggedIn,
  };
}
