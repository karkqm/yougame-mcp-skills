import { ucConfig, ucUrl } from '../config.js';
import { AuthRequiredError, BrowserUnavailableError, HttpError } from '../../errors.js';
import { cookieHeaderFor, hasCloudflareCookies, storeSetCookies } from './jar.js';
import { getHttpUserAgent } from '../session-ua.js';
import { browserHttp } from './browser-fetch.js';

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
  allowGate?: boolean;
  noCache?: boolean;
  raw?: boolean;
  timeoutMs?: number;
  /** Force Node fetch (skip browser TLS transport). */
  forceNode?: boolean;
  /** Force browser transport. */
  forceBrowser?: boolean;
}

export interface PageResult {
  html: string;
  status: number;
  finalUrl: string;
  loggedIn: boolean;
  securityToken: string | null;
  via?: 'browser' | 'node';
}

let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = ucConfig.minRequestIntervalMs - (Date.now() - lastRequestAt);
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

function bodyToString(body: string | URLSearchParams | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  return body.toString();
}

export async function rawFetch(target: string, opts: FetchOptions = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  let current = ucUrl(target);
  let attempt = 0;

  for (let hop = 0; hop < 8; hop++) {
    const headers: Record<string, string> = {
      // Must match the browser UA that obtained cf_clearance.
      'User-Agent': getHttpUserAgent(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
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
          signal: AbortSignal.timeout(opts.timeoutMs ?? ucConfig.requestTimeoutMs),
        }),
      );
    } catch (err) {
      if (attempt++ < ucConfig.maxRetries) {
        await sleep(600 * attempt);
        hop--;
        continue;
      }
      throw new HttpError(0, current, `Network unavailable: ${(err as Error).message}`);
    }

    const cookies = setCookiesOf(res);
    if (cookies.length) storeSetCookies(current, cookies);

    if ((res.status === 429 || res.status >= 500) && attempt++ < ucConfig.maxRetries) {
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

  throw new HttpError(0, current, 'Too many redirects');
}

function detectGate(html: string, status: number, finalUrl: string): string | null {
  // Cloudflare challenge — need browser session to pass
  if (/Just a moment\.\.\.|challenge-platform|cf-chl-widget/i.test(html) && (status === 403 || status === 503)) {
    return 'Cloudflare challenge detected. Call uc_cf_pass (browser TLS + cf_clearance).';
  }
  if (/\/login\.php|member\.php\?.*do=login|\/members\/login/i.test(finalUrl) && status < 400) {
    return 'Forum redirected to login page.';
  }
  if (status === 403 && !/bbuserid/.test(html)) {
    return 'Access denied for guests (HTTP 403).';
  }
  if (/you\s+(?:must|need to)\s+(?:be\s+)?(?:logged|registered|a member)/i.test(html) && status !== 200) {
    return 'This page requires login.';
  }
  return null;
}

function extractSecurityToken(html: string): string | null {
  const m = html.match(/SECURITYTOKEN\s*=\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

function isLoggedIn(html: string): boolean {
  if (/class="[^"]*logged[_-]?in/i.test(html)) return true;
  if (/member\.php\?u=\d+/i.test(html) && !/do=login/i.test(html)) return true;
  if (/id="navbar_username"/i.test(html)) return true;
  return false;
}

function isCloudflareChallenge(html: string, status: number): boolean {
  return (
    (status === 403 || status === 503) &&
    /Just a moment|challenge-platform|cf-chl-widget|cdn-cgi\/challenge-platform/i.test(html)
  );
}

async function getPageViaBrowser(target: string, opts: FetchOptions): Promise<PageResult> {
  const absolute = ucUrl(target);
  const result = await schedule(() =>
    browserHttp(absolute, {
      method: opts.method ?? 'GET',
      body: bodyToString(opts.body),
      headers: opts.headers,
      timeoutMs: opts.timeoutMs ?? Math.max(ucConfig.requestTimeoutMs, 45_000),
    }),
  );

  return {
    html: result.html,
    status: result.status,
    finalUrl: result.finalUrl || absolute,
    loggedIn: isLoggedIn(result.html),
    securityToken: extractSecurityToken(result.html),
    via: 'browser',
  };
}

async function getPageViaNode(target: string, opts: FetchOptions): Promise<PageResult> {
  const absolute = ucUrl(target);
  const res = await rawFetch(absolute, opts);
  const html = await res.text();
  return {
    html,
    status: res.status,
    finalUrl: res.url || absolute,
    loggedIn: isLoggedIn(html),
    securityToken: extractSecurityToken(html),
    via: 'node',
  };
}

/**
 * Prefer Chrome in-page fetch (real TLS fingerprint). Node fetch keeps failing
 * Cloudflare even with a valid cf_clearance because JA3/JA4 does not match.
 */
export async function getPage(target: string, opts: FetchOptions = {}): Promise<PageResult> {
  const absolute = ucUrl(target);
  const cacheKey = `${opts.method ?? 'GET'}:${absolute}`;
  if (!opts.noCache && (opts.method ?? 'GET') === 'GET') {
    const hit = htmlCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ucConfig.htmlCacheTtlMs) return hit.page;
  }

  // Always prefer Chrome transport for UC — Node TLS fingerprint is rejected
  // even when cf_clearance is present in the cookie jar.
  let page: PageResult;

  if (opts.forceNode) {
    page = await getPageViaNode(absolute, opts);
  } else {
    try {
      page = await getPageViaBrowser(absolute, {
        ...opts,
        forceBrowser: opts.forceBrowser || hasCloudflareCookies(),
      });
    } catch (err) {
      if (err instanceof BrowserUnavailableError) {
        page = await getPageViaNode(absolute, opts);
      } else {
        throw err;
      }
    }
  }

  const gate = detectGate(page.html, page.status, page.finalUrl);
  if (gate && !opts.allowGate) {
    throw new AuthRequiredError(gate, absolute, 'Call uc_cf_pass or uc_login.');
  }
  if (!gate && page.status >= 400 && page.status !== 403) {
    throw new HttpError(page.status, absolute);
  }

  if (!opts.noCache && (opts.method ?? 'GET') === 'GET' && page.status === 200 && !isCloudflareChallenge(page.html, page.status)) {
    htmlCache.set(cacheKey, { at: Date.now(), page });
    if (htmlCache.size > 200) htmlCache.delete(htmlCache.keys().next().value as string);
  }
  return page;
}

export async function getSecurityToken(): Promise<string | null> {
  const page = await getPage('/index.php', { noCache: true, allowGate: true });
  return page.securityToken;
}

export function dropCache(): void {
  htmlCache.clear();
}
