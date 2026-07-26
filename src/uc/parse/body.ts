import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { abs, unwrapRedirect } from './util.js';

export interface BodyLink {
  url: string;
  text: string;
  internal: boolean;
}

export interface BodyCode {
  language: string | null;
  title: string | null;
  code: string;
}

export interface RenderedBody {
  markdown: string;
  links: BodyLink[];
  code: BodyCode[];
  images: string[];
}

const BLOCK_TAGS = new Set(['div', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tr', 'h1', 'h2', 'h3', 'h4']);

export function renderBody($: CheerioAPI, $root: Cheerio<AnyNode>): RenderedBody {
  const out: RenderedBody = { markdown: '', links: [], code: [], images: [] };
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
  const id = ($node.attr('id') || '').trim();

  // vBulletin code block: <div class="bbcode_container"> ... <pre class="bbcode_code">
  if (cls.includes('bbcode_container') || cls.includes('bbcode_code_container')) {
    const title = $node.find('.bbcode_description, .bbcode_code_title').first().text().replace(/\s+/g, ' ').trim() || null;
    const $pre = $node.find('pre.bbcode_code, code.bbcode_code, .bbcode_code').first();
    const codeText = $pre.length ? $pre.text() : $node.find('pre, code').first().text();
    const code = codeText.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    const langMatch = cls.match(/language-([\w+-]+)/);
    const language = langMatch?.[1] ?? null;
    out.code.push({ language, title, code });
    chunks.push(`\n\n${title ? `**${title}**\n` : ''}\`\`\`${language ?? ''}\n${code}\n\`\`\`\n\n`);
    return;
  }

  // Standalone pre with bbcode_code class
  if (tag === 'pre' && cls.includes('bbcode_code')) {
    const code = $node.text().replace(/\r\n/g, '\n').replace(/\n+$/, '');
    out.code.push({ language: null, title: null, code });
    chunks.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
    return;
  }

  // vBulletin quote block
  if (cls.includes('bbcode_quote') || cls.includes('quote_container') || cls.includes('bbcode_postedby')) {
    if (cls.includes('bbcode_postedby')) {
      chunks.push(`\n> _${$node.text().replace(/\s+/g, ' ').trim()}_\n`);
      return;
    }
    const attribution = $node.find('.bbcode_postedby, .quote_header, .attribution').first().text().replace(/\s+/g, ' ').trim();
    const $content = $node.find('.message, .quote_content, .bbcode_quote_body').first();
    const inner: string[] = [];
    walkChildren($, $content.length ? $content : $node, inner, out, depth + 1);
    const quoted = inner
      .join('')
      .trim()
      .split('\n')
      .map((l) => '> ' + l)
      .join('\n');
    chunks.push(`\n\n${attribution ? `> _${attribution}_\n>\n` : ''}${quoted}\n\n`);
    return;
  }

  // Spoiler
  if (cls.includes('spoiler') || $node.attr('data-type') === 'spoiler') {
    const label = $node.find('.spoiler_title, .spoiler-header').first().text().replace(/\s+/g, ' ').trim() || 'Spoiler';
    const inner: string[] = [];
    const $content = $node.find('.spoiler_text, .spoiler-content, .spoiler_body').first();
    walkChildren($, $content.length ? $content : $node, inner, out, depth + 1);
    chunks.push(`\n\n<details><summary>${label}</summary>\n\n${inner.join('').trim()}\n\n</details>\n\n`);
    return;
  }

  // Hidden content / thanks-required blocks
  if (cls.includes('hidden_content') || cls.includes('thanks_required')) {
    const text = $node.text().replace(/\s+/g, ' ').trim();
    chunks.push(`\n\n> 🔒 **[HIDDEN: ${text.slice(0, 200) || 'login or thanks required'}]**\n\n`);
    return;
  }

  switch (tag) {
    case 'br':
      chunks.push('\n');
      return;
    case 'p':
    case 'div':
    case 'section': {
      if (id.startsWith('post_message_')) {
        walkChildren($, $node, chunks, out, depth + 1);
        return;
      }
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
      const href = unwrapRedirect(abs($node.attr('href')));
      const text = $node.text().replace(/\s+/g, ' ').trim();
      if (!href) {
        chunks.push(text);
        return;
      }
      const internal = href.includes('unknowncheats.me');
      if (!out.links.some((l) => l.url === href)) out.links.push({ url: href, text: text || href, internal });
      chunks.push(text && text !== href ? `[${text}](${href})` : href);
      return;
    }
    case 'img': {
      if (cls.includes('smilie') || cls.includes('inlineimg')) {
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
        out.links.push({ url: src, text: 'embedded content', internal: false });
        chunks.push(`\n[embedded content](${src})\n`);
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
