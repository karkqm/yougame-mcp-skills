import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { rawFetch } from '../http/client.js';
import { classify, instructionFor } from './hosts.js';

const HTMLish = /^text\/html|^application\/xhtml/i;

export interface DownloadResult {
  ok: boolean;
  url: string;
  resolvedUrl: string | null;
  filePath: string | null;
  fileName: string | null;
  bytes: number;
  sha256: string | null;
  contentType: string | null;
  /** Каким способом получилось скачать. */
  via: 'direct' | 'api' | 'scrape' | 'browser' | 'forum' | null;
  host: string | null;
  instruction: string;
  /** Заполняется, когда архив скачан по файлам (обменник не отдаёт ZIP целиком). */
  files?: Array<{ path: string; name: string; bytes: number; sha256: string }>;
  error?: string;
}

function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || `download-${Date.now()}`).slice(0, 180);
}

function nameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const star = value.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return sanitizeName(decodeURIComponent(star[1].replace(/^"|"$/g, '')));
    } catch {
      /* дальше пробуем обычный filename */
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? sanitizeName(plain[1]) : null;
}

function nameFromUrl(target: string): string | null {
  try {
    const base = decodeURIComponent(new URL(target).pathname.split('/').filter(Boolean).pop() || '');
    return base ? sanitizeName(base) : null;
  } catch {
    return null;
  }
}

/** sha256 файла потоково — большие архивы не держим в памяти. */
async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function extFetch(target: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(target, {
    redirect: 'follow',
    headers: {
      'User-Agent': config.userAgent,
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      Accept: '*/*',
      ...headers,
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs * 2),
  });
}

// ---------------------------------------------------------------------------
// Резолверы конкретных хостингов: url → прямая ссылка на файл.
// ---------------------------------------------------------------------------

async function resolveDropbox(target: string): Promise<string> {
  const u = new URL(target);
  u.searchParams.set('dl', '1');
  return u.toString();
}

function resolveGithub(target: string): string {
  if (/\/releases\/download\//.test(target)) return target;
  const blob = target.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  const repo = target.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)\/?$/i);
  if (repo) return `https://codeload.github.com/${repo[1]}/${repo[2].replace(/\.git$/, '')}/zip/refs/heads/main`;
  return target;
}

function resolveGoogleDrive(target: string): string | null {
  const id = target.match(/\/file\/d\/([\w-]{10,})/)?.[1] || new URL(target).searchParams.get('id');
  if (!id) return null;
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

async function resolveYandexDisk(target: string): Promise<string | null> {
  const api = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(target)}`;
  const res = await extFetch(api, { Accept: 'application/json' });
  if (!res.ok) return null;
  const data = (await res.json()) as { href?: string };
  return data.href ?? null;
}

function resolvePixeldrain(target: string): string | null {
  const id = target.match(/pixeldrain\.com\/(?:u|l|api\/file)\/([\w-]+)/i)?.[1];
  return id ? `https://pixeldrain.com/api/file/${id}?download` : null;
}

async function resolveWorkupload(target: string): Promise<string | null> {
  const id = target.match(/workupload\.com\/(?:file|archive|start)\/([\w-]+)/i)?.[1];
  if (!id) return null;
  const pageRes = await extFetch(target);
  const cookie = (pageRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
  await pageRes.text().catch(() => '');
  const api = await extFetch(`https://workupload.com/api/file/getDownloadServer/${id}`, {
    Accept: 'application/json',
    Referer: target,
    ...(cookie ? { Cookie: cookie } : {}),
  });
  if (!api.ok) return null;
  const data = (await api.json().catch(() => null)) as { data?: { url?: string } } | null;
  return data?.data?.url ?? null;
}

async function resolveByScrape(target: string): Promise<string | null> {
  const res = await extFetch(target);
  const html = await res.text();
  const patterns = [
    /id="downloadButton"[^>]*href="([^"]+)"/i,
    /id="download_button"[^>]*href="([^"]+)"/i,
    /<a[^>]+href="([^"]+)"[^>]*\bdownload\b/i,
    /href="(https?:\/\/[^"]+\.(?:zip|rar|7z|jar|exe|apk|tar\.gz|msi|dll)(?:\?[^"]*)?)"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try {
        return new URL(m[1].replace(/&amp;/g, '&'), target).toString();
      } catch {
        /* следующий шаблон */
      }
    }
  }
  return null;
}

async function resolve(target: string): Promise<{ url: string | null; via: DownloadResult['via'] }> {
  const { host } = classify(target);
  switch (host?.id) {
    case 'dropbox':
      return { url: await resolveDropbox(target), via: 'direct' };
    case 'github':
      return { url: resolveGithub(target), via: 'direct' };
    case 'google-drive':
      return { url: resolveGoogleDrive(target), via: 'api' };
    case 'yandex-disk':
      return { url: await resolveYandexDisk(target), via: 'api' };
    case 'pixeldrain':
      return { url: resolvePixeldrain(target), via: 'api' };
    case 'workupload':
      return { url: await resolveWorkupload(target), via: 'api' };
    case 'mediafire':
    case 'sendspace':
    case 'krakenfiles':
      return { url: await resolveByScrape(target), via: 'scrape' };
    case 'mega':
    case 'gofile':
    case 'dropmefiles':
    case 'onedrive':
      return { url: null, via: 'browser' };
    case 'telegram':
    case 'boosty-patreon':
      return { url: null, via: null };
    default:
      return { url: target, via: 'direct' };
  }
}

/**
 * Только определить прямую ссылку, ничего не качая.
 * Полезно, чтобы показать пользователю, что именно будет скачано.
 */
export async function resolveDownloadUrl(target: string): Promise<{ url: string | null; via: DownloadResult['via']; host: string | null }> {
  const { host } = classify(target);
  const resolved = await resolve(target).catch(() => ({ url: null, via: null as DownloadResult['via'] }));
  return { ...resolved, host: host?.id ?? null };
}

/** Сохраняет тело ответа в файл, считая размер и sha256. */
async function saveStream(res: Response, destDir: string, fallbackName: string, maxBytes: number) {
  fs.mkdirSync(destDir, { recursive: true });
  const fileName =
    nameFromDisposition(res.headers.get('content-disposition')) || nameFromUrl(res.url) || sanitizeName(fallbackName);
  let filePath = path.join(destDir, fileName);
  let i = 1;
  while (fs.existsSync(filePath)) {
    const ext = path.extname(fileName);
    filePath = path.join(destDir, `${path.basename(fileName, ext)} (${i++})${ext}`);
  }

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  if (!res.body) throw new Error('Пустой ответ сервера');

  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    hash.update(chunk);
    if (bytes > maxBytes) source.destroy(new Error(`Файл больше лимита ${Math.round(maxBytes / 1024 / 1024)} МБ`));
  });
  await pipeline(source, fs.createWriteStream(filePath));

  return { filePath, fileName: path.basename(filePath), bytes, sha256: hash.digest('hex') };
}

export interface DownloadOptions {
  destDir?: string;
  /** Сразу использовать браузер (для MEGA, Gofile и капчи). */
  browser?: boolean;
  maxBytes?: number;
  /** Показывать окно браузера при резервном скачивании. */
  headless?: boolean;
}

/**
 * Универсальное скачивание: вложение форума, прямая ссылка или файлообменник.
 * Порядок: резолвер хоста → прямой GET → поиск ссылки в HTML → браузер.
 */
export async function downloadResource(rawUrl: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const destDir = opts.destDir || config.downloadDir;
  const maxBytes = opts.maxBytes ?? config.maxDownloadBytes;
  const { host, hostname } = classify(rawUrl);
  const base: DownloadResult = {
    ok: false,
    url: rawUrl,
    resolvedUrl: null,
    filePath: null,
    fileName: null,
    bytes: 0,
    sha256: null,
    contentType: null,
    via: null,
    host: host?.name ?? hostname ?? null,
    instruction: instructionFor(rawUrl),
  };

  const isForumFile = /yougame\.biz\/attachments\//i.test(rawUrl) || rawUrl.startsWith(config.baseUrl + '/attachments/');

  // 1. Вложение форума — через клиент с куками сессии.
  if (isForumFile && !opts.browser) {
    const res = await rawFetch(rawUrl, { headers: { Accept: '*/*' } });
    const type = res.headers.get('content-type');
    if (res.ok && !HTMLish.test(type || '')) {
      const saved = await saveStream(res, destDir, `attachment-${Date.now()}`, maxBytes);
      return { ...base, ok: true, resolvedUrl: res.url, contentType: type, via: 'forum', ...saved };
    }
    await res.body?.cancel().catch(() => undefined);
    return {
      ...base,
      error:
        res.status === 403 || HTMLish.test(type || '')
          ? 'Форум не отдал вложение — скорее всего нужна авторизация. Вызови yg_login и повтори.'
          : `Форум ответил HTTP ${res.status}`,
    };
  }

  // 2. Хостинги, которые умеет только браузер.
  if (!opts.browser) {
    const resolved = await resolve(rawUrl).catch(() => ({ url: null, via: null as DownloadResult['via'] }));
    if (resolved.url) {
      try {
        const res = await extFetch(resolved.url, { Referer: rawUrl });
        const type = res.headers.get('content-type');
        if (res.ok && !HTMLish.test(type || '')) {
          const saved = await saveStream(res, destDir, nameFromUrl(rawUrl) || 'download.bin', maxBytes);
          return { ...base, ok: true, resolvedUrl: resolved.url, contentType: type, via: resolved.via ?? 'direct', ...saved };
        }
        await res.body?.cancel().catch(() => undefined);

        // Пришёл HTML — пробуем вытащить прямую ссылку из страницы.
        const scraped = await resolveByScrape(resolved.url).catch(() => null);
        if (scraped) {
          const res2 = await extFetch(scraped, { Referer: resolved.url });
          const type2 = res2.headers.get('content-type');
          if (res2.ok && !HTMLish.test(type2 || '')) {
            const saved = await saveStream(res2, destDir, nameFromUrl(scraped) || 'download.bin', maxBytes);
            return { ...base, ok: true, resolvedUrl: scraped, contentType: type2, via: 'scrape', ...saved };
          }
          await res2.body?.cancel().catch(() => undefined);
        }
      } catch (err) {
        base.error = (err as Error).message;
      }
    }
  }

  // 3. Резервный путь — настоящий браузер.
  if (host?.strategy === 'manual') {
    return { ...base, error: `Автоматическое скачивание невозможно. ${host.instruction}` };
  }

  // Архив на обменнике без выдачи ZIP — качаем содержимое по файлам.
  if (host?.id === 'workupload' && /\/archive\//i.test(rawUrl)) {
    try {
      const { browserDownloadArchive } = await import('../browser.js');
      const { files, discovered } = await browserDownloadArchive(rawUrl, destDir, { headless: opts.headless ?? false });
      if (files.length) {
        const detailed = await Promise.all(
          files.map(async (f) => ({ path: f.filePath, name: f.suggestedName, bytes: f.bytes, sha256: await hashFile(f.filePath) })),
        );
        return {
          ...base,
          ok: true,
          resolvedUrl: rawUrl,
          filePath: destDir,
          fileName: `${detailed.length} файл(ов) из архива`,
          bytes: detailed.reduce((sum, f) => sum + f.bytes, 0),
          sha256: null,
          via: 'browser',
          files: detailed,
        };
      }
      base.error = `В архиве не нашлось скачиваемых файлов (найдено ссылок: ${discovered.length}).`;
    } catch (err) {
      base.error = (err as Error).message;
    }
  }

  try {
    const { browserDownload } = await import('../browser.js');
    const result = await browserDownload(rawUrl, destDir, { headless: opts.headless ?? false });
    return {
      ...base,
      ok: true,
      resolvedUrl: rawUrl,
      filePath: result.filePath,
      fileName: path.basename(result.filePath),
      bytes: result.bytes,
      sha256: await hashFile(result.filePath),
      contentType: null,
      via: 'browser',
    };
  } catch (err) {
    return {
      ...base,
      error: `${base.error ? base.error + ' | ' : ''}Браузерный режим не помог: ${(err as Error).message}`,
    };
  }
}
