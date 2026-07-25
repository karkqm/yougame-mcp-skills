import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { abs, unwrapProxy } from './util.js';

export interface BodyLink {
  url: string;
  text: string;
  /** Ссылка ведёт на сам форум. */
  internal: boolean;
}

export interface BodyGate {
  /**
   * login — нужен вход; reply — нужен ответ в теме; reaction/posts — нужен ранг аккаунта;
   * user-specific — «ответ с хайдом» конкретному пользователю (открыть невозможно);
   * hidden-link — ссылка спрятана от гостей.
   */
  kind: 'login' | 'reply' | 'reaction' | 'posts' | 'user-specific' | 'hidden-link' | 'unknown';
  message: string;
}

export interface BodyCode {
  language: string | null;
  title: string | null;
  code: string;
}

export interface RenderedBody {
  markdown: string;
  links: BodyLink[];
  gates: BodyGate[];
  code: BodyCode[];
  images: string[];
}

const BLOCK_TAGS = new Set(['div', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tr', 'h1', 'h2', 'h3', 'h4']);

/** Классифицирует блок хайда по модификаторам класса и тексту. */
function classifyHide(cls: string, text: string): BodyGate['kind'] {
  const c = cls.toLowerCase();
  const t = text.toLowerCase();
  // «Ответ с хайдом»: блок адресован конкретному пользователю, другим он не откроется.
  if (/для пользовател|hidden content for/i.test(t)) return 'user-specific';
  if (/\breply\b/.test(c) || t.includes('ответ')) return 'reply';
  if (/\blike|react/.test(c) || t.includes('реакц') || t.includes('лайк')) return 'reaction';
  if (/\bposts?\b|\bmessages?\b/.test(c) || t.includes('сообщени')) return 'posts';
  if (/\busers?\b|\bmembers?\b/.test(c) || t.includes('авториз') || t.includes('регистр')) return 'login';
  return 'unknown';
}

/**
 * Конвертирует тело сообщения (.bbWrapper) в markdown и попутно собирает
 * ссылки, вложенные ресурсы, блоки кода и «замки» (хайд / скрытые ссылки).
 */
export function renderBody($: CheerioAPI, $root: Cheerio<AnyNode>): RenderedBody {
  const out: RenderedBody = { markdown: '', links: [], gates: [], code: [], images: [] };
  if (!$root || $root.length === 0) return out;

  const chunks: string[] = [];
  walkChildren($, $root.first(), chunks, out, 0);

  out.markdown = chunks
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

function walkChildren($: CheerioAPI, $el: Cheerio<AnyNode>, chunks: string[], out: RenderedBody, depth: number): void {
  $el.contents().each((_, node) => {
    walk($, node, chunks, out, depth);
  });
}

function walk($: CheerioAPI, node: AnyNode, chunks: string[], out: RenderedBody, depth: number): void {
  if (depth > 40) return;

  if (node.type === 'text') {
    const text = (node as unknown as { data: string }).data.replace(/\s+/g, ' ');
    if (text.trim() || chunks.length) chunks.push(text);
    return;
  }
  if (node.type !== 'tag') return;

  const el = node as Element;
  const $node = $(el);
  const tag = el.tagName.toLowerCase();
  const cls = ($node.attr('class') || '').trim();

  // --- скрытый контент (аддон хайда) -------------------------------------
  if (cls.includes('bbCodeBlock--hide')) {
    const title = $node.find('.bbCodeBlock-title').first().text().replace(/\s+/g, ' ').trim();
    const $content = $node.find('.bbCodeBlock-content').first();
    const hasContent = $content.length > 0 && $content.text().trim().length > 0;
    if (hasContent) {
      chunks.push('\n\n> 🔓 **[хайд открыт]**\n');
      walkChildren($, $content, chunks, out, depth + 1);
      chunks.push('\n\n');
    } else {
      const kind = classifyHide(cls, title);
      out.gates.push({ kind, message: title || 'Скрытое содержимое' });
      chunks.push(`\n\n> 🔒 **[СКРЫТО: ${title || 'требуется доступ'}]**\n\n`);
    }
    return;
  }

  // --- ссылка, спрятанная от гостей --------------------------------------
  if (cls.includes('blockMessage-whlg') || (cls.includes('blockMessage') && /авторизуйтесь.*ссылк/i.test($node.text()))) {
    const msg = $node.text().replace(/\s+/g, ' ').trim();
    out.gates.push({ kind: 'hidden-link', message: msg });
    chunks.push(`\n\n> 🔒 **[ССЫЛКА СКРЫТА ОТ ГОСТЕЙ]** ${msg}\n\n`);
    return;
  }

  // --- блок кода ----------------------------------------------------------
  if (cls.includes('bbCodeBlock--code')) {
    const title = $node.find('.bbCodeBlock-title').first().text().replace(/\s+/g, ' ').trim() || null;
    const $code = $node.find('pre.bbCodeCode, code').first();
    const language = ($code.attr('data-lang') || ($code.attr('class') || '').match(/language-([\w+-]+)/)?.[1] || null) as
      | string
      | null;
    const code = $code.text().replace(/\r\n/g, '\n').replace(/\n+$/, '');
    out.code.push({ language: language && language !== 'none' ? language : null, title, code });
    chunks.push(
      `\n\n${title ? `**${title}**\n` : ''}\`\`\`${language && language !== 'none' ? language : ''}\n${code}\n\`\`\`\n\n`,
    );
    return;
  }

  // --- цитата -------------------------------------------------------------
  if (cls.includes('bbCodeBlock--quote') || tag === 'blockquote') {
    const attribution = $node.find('.bbCodeBlock-title').first().text().replace(/\s+/g, ' ').trim();
    const inner: string[] = [];
    walkChildren($, $node.find('.bbCodeBlock-content').first().length ? $node.find('.bbCodeBlock-content').first() : $node, inner, out, depth + 1);
    const quoted = inner
      .join('')
      .trim()
      .split('\n')
      .map((l) => '> ' + l)
      .join('\n');
    chunks.push(`\n\n${attribution ? `> _${attribution}_\n>\n` : ''}${quoted}\n\n`);
    return;
  }

  // --- спойлер ------------------------------------------------------------
  if (cls.includes('bbCodeSpoiler')) {
    const label =
      $node.find('.bbCodeSpoiler-button-title, .bbCodeSpoiler-title').first().text().replace(/\s+/g, ' ').trim() ||
      'Спойлер';
    const inner: string[] = [];
    walkChildren($, $node.find('.bbCodeSpoiler-content').first().length ? $node.find('.bbCodeSpoiler-content').first() : $node, inner, out, depth + 1);
    chunks.push(`\n\n<details><summary>${label}</summary>\n\n${inner.join('').trim()}\n\n</details>\n\n`);
    return;
  }

  switch (tag) {
    case 'br':
      chunks.push('\n');
      return;
    case 'p':
    case 'div':
    case 'section': {
      const before = chunks.length;
      walkChildren($, $node, chunks, out, depth + 1);
      if (chunks.length > before) chunks.push(tag === 'p' ? '\n\n' : '\n');
      return;
    }
    case 'b':
    case 'strong': {
      const inner = collect($, $node, out, depth);
      if (inner.trim()) chunks.push(`**${inner.trim()}**`);
      return;
    }
    case 'i':
    case 'em': {
      const inner = collect($, $node, out, depth);
      if (inner.trim()) chunks.push(`*${inner.trim()}*`);
      return;
    }
    case 'u': {
      const inner = collect($, $node, out, depth);
      if (inner.trim()) chunks.push(`__${inner.trim()}__`);
      return;
    }
    case 's':
    case 'del':
    case 'strike': {
      const inner = collect($, $node, out, depth);
      if (inner.trim()) chunks.push(`~~${inner.trim()}~~`);
      return;
    }
    case 'a': {
      const href = unwrapProxy(abs($node.attr('data-proxy-href') || $node.attr('href')));
      const text = $node.text().replace(/\s+/g, ' ').trim();
      if (!href) {
        chunks.push(text);
        return;
      }
      const internal = href.includes(new URL(abs('/') as string).hostname);
      if (!out.links.some((l) => l.url === href)) out.links.push({ url: href, text: text || href, internal });
      chunks.push(text && text !== href ? `[${text}](${href})` : href);
      return;
    }
    case 'img': {
      if (($node.attr('class') || '').includes('smilie')) {
        chunks.push($node.attr('alt') || '');
        return;
      }
      const src = abs($node.attr('data-src') || $node.attr('src'));
      if (src) {
        out.images.push(src);
        chunks.push(`![${$node.attr('alt') || 'image'}](${src})`);
      }
      return;
    }
    case 'ul':
    case 'ol': {
      chunks.push('\n');
      let i = 1;
      $node.children('li').each((_, li) => {
        const inner = collect($, $(li), out, depth + 1).trim().replace(/\n/g, '\n  ');
        chunks.push(`${tag === 'ol' ? `${i++}.` : '-'} ${inner}\n`);
      });
      chunks.push('\n');
      return;
    }
    case 'pre': {
      const code = $node.text().replace(/\n+$/, '');
      out.code.push({ language: null, title: null, code });
      chunks.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
      return;
    }
    case 'code': {
      chunks.push('`' + $node.text().trim() + '`');
      return;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4': {
      const inner = collect($, $node, out, depth).trim();
      chunks.push(`\n\n${'#'.repeat(Number.parseInt(tag[1], 10))} ${inner}\n\n`);
      return;
    }
    case 'hr':
      chunks.push('\n\n---\n\n');
      return;
    case 'iframe': {
      const src = abs($node.attr('src'));
      if (src) {
        out.links.push({ url: src, text: 'встроенное видео/фрейм', internal: false });
        chunks.push(`\n[встроенный контент](${src})\n`);
      }
      return;
    }
    case 'script':
    case 'style':
    case 'template':
    case 'noscript':
      return;
    default: {
      const before = chunks.length;
      walkChildren($, $node, chunks, out, depth + 1);
      if (BLOCK_TAGS.has(tag) && chunks.length > before) chunks.push('\n');
      return;
    }
  }
}

function collect($: CheerioAPI, $node: Cheerio<AnyNode>, out: RenderedBody, depth: number): string {
  const buf: string[] = [];
  walkChildren($, $node, buf, out, depth + 1);
  return buf.join('');
}
