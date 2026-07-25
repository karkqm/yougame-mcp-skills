import { config, url as toUrl } from '../config.js';
import { AuthRequiredError, HttpError } from '../errors.js';
import { cookieHeaderFor, storeSetCookies } from './jar.js';

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
  /** Не бросать AuthRequiredError, а вернуть страницу как есть. */
  allowGate?: boolean;
  /** Не использовать и не заполнять кэш. */
  noCache?: boolean;
  /** Отдать сырой Response (для скачивания файлов). */
  raw?: boolean;
  timeoutMs?: number;
}

export interface PageResult {
  html: string;
  status: number;
  /** Итоговый URL после редиректов. */
  finalUrl: string;
  /** Страница отдана как гостю (форум не увидел нашу сессию). */
  loggedIn: boolean;
  /** CSRF-токен из <html data-csrf>. */
  csrf: string | null;
}

// ---------------------------------------------------------------------------
// Очередь: один запрос за раз + минимальный интервал между ними.
// ---------------------------------------------------------------------------
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = config.minRequestIntervalMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait + Math.floor(Math.random() * 200));
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCookiesOf(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

const htmlCache = new Map<string, { at: number; page: PageResult }>();

// ---------------------------------------------------------------------------

/** Низкоуровневый запрос: куки, ретраи, ручные редиректы. Возвращает Response. */
export async function rawFetch(target: string, opts: FetchOptions = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  let current = toUrl(target);
  let attempt = 0;

  for (let hop = 0; hop < 8; hop++) {
    const headers: Record<string, string> = {
      'User-Agent': config.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Upgrade-Insecure-Requests': '1',
      ...opts.headers,
    };
    const cookie = cookieHeaderFor(current);
    if (cookie) headers.Cookie = cookie;
    if (method === 'POST' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    let res: Response;
    try {
      res = await schedule(() =>
        fetch(current, {
          method: hop === 0 ? method : 'GET',
          body: hop === 0 ? (opts.body as BodyInit | undefined) : undefined,
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(opts.timeoutMs ?? config.requestTimeoutMs),
        }),
      );
    } catch (err) {
      if (attempt++ < config.maxRetries) {
        await sleep(600 * attempt);
        hop--;
        continue;
      }
      throw new HttpError(0, current, `Сеть недоступна: ${(err as Error).message}`);
    }

    const cookies = setCookiesOf(res);
    if (cookies.length) storeSetCookies(current, cookies);

    // Троттлинг/временные ошибки — подождать и повторить.
    if ((res.status === 429 || res.status >= 500) && attempt++ < config.maxRetries) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1200 * attempt);
      hop--;
      continue;
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }

    Object.defineProperty(res, 'url', { value: current, configurable: true });
    return res;
  }

  throw new HttpError(0, current, 'Слишком много редиректов');
}

/** Признаки того, что форум показал страницу входа вместо содержимого. */
function detectGate(html: string, status: number, finalUrl: string): string | null {
  const guest = /data-logged-in="false"/.test(html);
  const loginTemplate = /data-template="login"/.test(html);
  if (loginTemplate && (status === 403 || status === 401)) {
    return 'Раздел или тема доступны только авторизованным пользователям (HTTP ' + status + ').';
  }
  if (/\/login(\/|\?|$)/.test(new URL(finalUrl).pathname) && loginTemplate) {
    return 'Форум перенаправил на страницу входа.';
  }
  if (status === 403 && guest) {
    return 'Доступ запрещён для гостя (HTTP 403).';
  }
  return null;
}

/** Загружает HTML-страницу форума. Бросает AuthRequiredError, если нужен вход. */
export async function getPage(target: string, opts: FetchOptions = {}): Promise<PageResult> {
  const absolute = toUrl(target);
  const cacheKey = absolute;
  if (!opts.noCache && (opts.method ?? 'GET') === 'GET') {
    const hit = htmlCache.get(cacheKey);
    if (hit && Date.now() - hit.at < config.htmlCacheTtlMs) return hit.page;
  }

  const res = await rawFetch(absolute, opts);
  const html = await res.text();
  const page: PageResult = {
    html,
    status: res.status,
    finalUrl: res.url || absolute,
    loggedIn: /data-logged-in="true"/.test(html),
    csrf: (html.match(/data-csrf="([^"]+)"/) || [])[1] ?? null,
  };

  const gate = detectGate(html, res.status, page.finalUrl);
  if (gate && !opts.allowGate) {
    throw new AuthRequiredError(gate, absolute, 'Вызови инструмент yg_login, чтобы войти на форум.');
  }
  if (!gate && res.status >= 400 && res.status !== 403) {
    throw new HttpError(res.status, absolute);
  }

  if (!opts.noCache && (opts.method ?? 'GET') === 'GET' && res.status === 200) {
    htmlCache.set(cacheKey, { at: Date.now(), page });
    if (htmlCache.size > 200) htmlCache.delete(htmlCache.keys().next().value as string);
  }
  return page;
}

/** Свежий CSRF-токен активной сессии. */
export async function getCsrf(): Promise<string | null> {
  const page = await getPage('/', { noCache: true, allowGate: true });
  return page.csrf;
}

export function dropCache(): void {
  htmlCache.clear();
}
