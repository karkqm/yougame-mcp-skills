import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { ucConfig, ucUrl } from '../config.js';
import { BrowserUnavailableError } from '../../errors.js';
import { saveSessionUserAgent } from '../session-ua.js';
import { getJar, saveJar } from './jar.js';

type PlaywrightModule = typeof import('playwright');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContext = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;

const STEALTH_INIT = `
(() => {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
  try { window.chrome = window.chrome || { runtime: {} }; } catch {}
})();
`;

let browser: AnyBrowser | null = null;
let context: AnyContext | null = null;
let chromeProc: ChildProcess | null = null;
let launching: Promise<AnyContext> | null = null;
let cfReady = false;
let ownsBrowserProcess = false;

function log(msg: string): void {
  process.stderr.write(`[uc] ${msg}\n`);
}

const CDP_STATE_FILE = path.join(ucConfig.home, 'cdp-state.json');

interface CdpState {
  port: number;
  pid: number;
}

function saveCdpState(port: number, pid: number): void {
  try {
    fs.mkdirSync(ucConfig.home, { recursive: true });
    fs.writeFileSync(CDP_STATE_FILE, JSON.stringify({ port, pid }));
  } catch { /* best effort */ }
}

function loadCdpState(): CdpState | null {
  try {
    return JSON.parse(fs.readFileSync(CDP_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function clearCdpState(): void {
  try { fs.unlinkSync(CDP_STATE_FILE); } catch { /* ok */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killOrphanedUcBrowser(): void {
  const state = loadCdpState();
  if (state && isProcessAlive(state.pid)) {
    log(`Killing orphaned UC browser (PID ${state.pid}, CDP port ${state.port})`);
    try { process.kill(state.pid); } catch { /* ok */ }
    try { process.kill(state.pid, 'SIGKILL'); } catch { /* ok */ }
    if (process.platform === 'win32') {
      try { execSync(`taskkill /F /PID ${state.pid} /T`, { stdio: 'ignore', timeout: 5000 }); } catch { /* ok */ }
    }
  }
  clearCdpState();
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import('playwright')) as PlaywrightModule;
  } catch {
    throw new BrowserUnavailableError(
      'Playwright not installed. Run: npm i playwright && npx playwright install chromium',
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        s.close();
        reject(new Error('No free port'));
        return;
      }
      const port = addr.port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function cdpReady(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const base = url.replace(/\/$/, '');
    const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpReady(url, 1500)) return;
    await sleep(300);
  }
  throw new Error(`CDP not ready at ${url}`);
}

async function attachCdp(cdpUrl: string): Promise<AnyContext> {
  const pw = await loadPlaywright();
  browser = await pw.chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  context = contexts[0] ?? (await browser.newContext());
  await context.addInitScript(STEALTH_INIT).catch(() => undefined);
  ownsBrowserProcess = false;
  log(`Attached to browser via CDP ${cdpUrl}`);
  return context;
}

/**
 * Spawn real Edge/Chrome ourselves (no Playwright launch flags), attach via CDP.
 * Uses a dedicated profile — default profile cannot use remote debugging since Chrome 136,
 * and the main Edge profile is locked while Edge is already open.
 */
async function launchBrowserViaCdp(opts: { visible?: boolean } = {}): Promise<AnyContext> {
  const exe = ucConfig.browserPath;
  if (!exe || !fs.existsSync(exe)) {
    throw new Error(
      'No Edge/Chrome binary found. Install Microsoft Edge or set UC_BROWSER_PATH to chrome.exe/msedge.exe',
    );
  }

  fs.mkdirSync(ucConfig.browserProfileDir, { recursive: true });
  const port = await findFreePort();
  const cdpUrl = `http://127.0.0.1:${port}`;

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${ucConfig.browserProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    // Force on primary monitor — profile may remember last pos off-screen (left of desktop).
    '--window-position=100,80',
    '--window-size=1280,900',
    '--start-maximized',
    // New window even if another Edge instance is already running
    '--new-window',
    ucConfig.baseUrl + '/index.php',
  ];

  log(`Starting ${pathBase(exe)} (profile=${ucConfig.browserProfileDir})`);
  log('Если увидишь Cloudflare / капчу — пройди её вручную в открывшемся окне. Не закрывай окно.');
  log('Окно должно быть на основном мониторе (100,80). Не кликай по галочке мышью автоматизации — только руками.');

  chromeProc = spawn(exe, args, {
    stdio: 'ignore',
    detached: false,
    windowsHide: false,
  });
  ownsBrowserProcess = true;
  if (chromeProc.pid) saveCdpState(port, chromeProc.pid);
  chromeProc.on('exit', () => {
    chromeProc = null;
    browser = null;
    context = null;
    cfReady = false;
    clearCdpState();
  });

  await waitForCdp(cdpUrl, 45_000);
  const ctx = await attachCdp(cdpUrl);
  await forceWindowOnScreen(ctx).catch(() => undefined);
  return ctx;
}

/** Move browser window onto the visible primary monitor (fixes off-screen left). */
async function forceWindowOnScreen(ctx: AnyContext): Promise<void> {
  const page = ctx.pages?.()[0];
  if (!page) return;
  const session = await page.context().newCDPSession(page).catch(() => null);
  if (!session) return;
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 100, top: 80, width: 1280, height: 900, windowState: 'normal' },
    });
  } catch {
    /* older targets */
  }
  await page.bringToFront().catch(() => undefined);
  // JS fallback
  await page
    .evaluate(() => {
      try {
        window.moveTo(100, 80);
        window.resizeTo(1280, 900);
        window.focus();
      } catch {
        /* noop */
      }
    })
    .catch(() => undefined);
}

function pathBase(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export async function ensureBrowserSession(
  _opts: { headless?: boolean; visible?: boolean } = {},
): Promise<AnyContext> {
  if (context) {
    try {
      context.pages();
      return context;
    } catch {
      context = null;
      browser = null;
      cfReady = false;
    }
  }

  if (!launching) {
    launching = (async () => {
      // 0) Saved CDP state from previous run (orphaned browser)
      const saved = loadCdpState();
      if (saved && isProcessAlive(saved.pid)) {
        const savedUrl = `http://127.0.0.1:${saved.port}`;
        if (await cdpReady(savedUrl, 2000)) {
          try {
            log(`Reconnecting to orphaned UC browser (PID ${saved.pid}, port ${saved.port})`);
            const ctx = await attachCdp(savedUrl);
            chromeProc = null;
            ownsBrowserProcess = false;
            return ctx;
          } catch (err) {
            log(`Reconnect failed: ${(err as Error).message}`);
          }
        }
        killOrphanedUcBrowser();
        await sleep(1500);
      }

      // 1) Existing CDP (user started browser with --remote-debugging-port)
      const existing = ucConfig.cdpUrl || 'http://127.0.0.1:9222';
      if (await cdpReady(existing, 800)) {
        try {
          return await attachCdp(existing);
        } catch (err) {
          log(`CDP attach to ${existing} failed: ${(err as Error).message}`);
        }
      }

      // 2) Spawn real Edge/Chrome + CDP
      try {
        return await launchBrowserViaCdp({ visible: true });
      } catch (err) {
        log(`CDP browser launch failed: ${(err as Error).message}`);
      }

      // 3) Playwright persistent (last resort — often blocked by CF)
      const pw = await loadPlaywright();
      fs.mkdirSync(ucConfig.browserProfileDir, { recursive: true });
      const launchOpts: Record<string, unknown> = {
        headless: false,
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
        ignoreDefaultArgs: ['--enable-automation'],
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
      };
      if (ucConfig.browserPath) launchOpts.executablePath = ucConfig.browserPath;
      const ctx = await pw.chromium.launchPersistentContext(ucConfig.browserProfileDir, launchOpts);
      await ctx.addInitScript(STEALTH_INIT);
      context = ctx;
      ownsBrowserProcess = true;
      log('Fallback: Playwright persistent context');
      return ctx;
    })().finally(() => {
      launching = null;
    });
  }

  return launching;
}

export async function closeBrowserSession(): Promise<void> {
  cfReady = false;
  const b = browser;
  const c = context;
  const proc = chromeProc;
  browser = null;
  context = null;
  chromeProc = null;

  if (b) {
    if (ownsBrowserProcess) {
      await b.close().catch(() => undefined);
    } else {
      try { b.close(); } catch { /* disconnect only */ }
    }
  } else if (c && ownsBrowserProcess) {
    await c.close?.().catch(() => undefined);
  }

  if (proc && !proc.killed && ownsBrowserProcess) {
    try { proc.kill(); } catch { /* ok */ }
  }
  ownsBrowserProcess = false;

  killOrphanedUcBrowser();
}

export function browserSessionAlive(): boolean {
  return context !== null;
}

export function markCloudflareReady(ready = true): void {
  cfReady = ready;
}

export function isCloudflareReady(): boolean {
  return cfReady;
}

function isChallengeHtml(html: string, title = ''): boolean {
  if (
    /Just a moment|Один момент|Attention Required|Checking your browser|Please wait|Verify you are human/i.test(
      title,
    )
  ) {
    return true;
  }
  return /challenge-platform|cf-chl-widget|cdn-cgi\/challenge-platform|cf-turnstile|Verify you are human/i.test(
    html,
  );
}

function looksLikeForum(html: string): boolean {
  return /vbulletin|forumhome|threadbit|navbar|forumdisplay|showthread|UnknownCheats/i.test(html);
}

async function mainPage(ctx: AnyContext): Promise<AnyPage> {
  const pages = ctx.pages();
  return pages[0] ?? (await ctx.newPage());
}

export async function importSessionCookies(): Promise<number> {
  const ctx = context;
  if (!ctx) return 0;
  const baseHost = new URL(ucConfig.baseUrl).hostname.replace(/^www\./, '');
  const cookies = await ctx.cookies();
  const jar = getJar();
  let count = 0;

  for (const c of cookies) {
    const domain = (c.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain.includes(baseHost)) continue;
    const rawDomain = c.domain || domain;
    const isHostOnly = Boolean(rawDomain) && !rawDomain.startsWith('.');
    const domainAttr = isHostOnly ? domain : `.${domain}`;
    const parts = [`${c.name}=${c.value}`, `Domain=${domainAttr}`, `Path=${c.path || '/'}`];
    if (c.expires && c.expires > 0) parts.push(`Expires=${new Date(c.expires * 1000).toUTCString()}`);
    if (c.secure) parts.push('Secure');
    if (c.httpOnly) parts.push('HttpOnly');
    for (const url of [`https://www.${baseHost}/`, `https://${baseHost}/`, ucConfig.baseUrl + '/']) {
      try {
        jar.setCookieSync(parts.join('; '), url, { ignoreError: true });
        count++;
        break;
      } catch {
        /* next */
      }
    }
  }
  if (count) saveJar();
  return count;
}

/**
 * Wait until Cloudflare is gone. Asks the user (via stderr) to complete captcha in the browser window.
 */
export async function waitForCloudflareInSession(timeoutSec = ucConfig.loginTimeoutSec): Promise<{
  passed: boolean;
  hasClearance: boolean;
  title: string;
  userAgent: string;
  message: string;
}> {
  let ctx = await ensureBrowserSession({ visible: true });
  let page = await mainPage(ctx);
  const deadline = Date.now() + timeoutSec * 1000;

  await page.bringToFront().catch(() => undefined);
  await page.goto(ucConfig.baseUrl + '/index.php', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);

  let ua = await page.evaluate(() => navigator.userAgent).catch(() => '');
  if (ua) saveSessionUserAgent(ua);

  let lastPrompt = 0;
  let lastMove = 0;

  const promptUser = (title: string) => {
    const now = Date.now();
    if (now - lastPrompt < 15_000) return;
    lastPrompt = now;
    const left = Math.max(0, Math.ceil((deadline - now) / 1000));
    log('────────────────────────────────────────────');
    log('CLOUDFLARE / КАПЧА — нужно действие (только руками!)');
    log(`Страница: "${title.slice(0, 60)}"`);
    log('1) Окно Edge должно быть НА ЭКРАНЕ (не слева за монитором)');
    log('2) Один раз кликни галочку «Verify you are human» / captcha');
    log('3) Не обновляй страницу и не закрывай окно — жди загрузки форума');
    log('4) Автоклики отключены: они сбрасывают Turnstile и крутят капчу заново');
    log(`Ожидание ещё ~${left}s…`);
    log('────────────────────────────────────────────');
  };

  // Ensure visible once at start
  await forceWindowOnScreen(ctx).catch(() => undefined);

  while (Date.now() < deadline) {
    try {
      try {
        ctx.pages();
      } catch {
        context = null;
        browser = null;
        cfReady = false;
        log('Окно браузера закрыто — перезапускаю. Пройди CF заново.');
        ctx = await ensureBrowserSession({ visible: true });
        page = await mainPage(ctx);
        await forceWindowOnScreen(ctx).catch(() => undefined);
        await page.goto(ucConfig.baseUrl + '/index.php', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
        ua = await page.evaluate(() => navigator.userAgent).catch(() => ua);
        if (ua) saveSessionUserAgent(ua);
      }

      const cookies = await ctx.cookies();
      const hasClearance = cookies.some((c: { name: string; value: string }) => c.name === 'cf_clearance' && c.value);
      const title = await page.title().catch(() => '');
      const html = await page.content().catch(() => '');
      const challenged = isChallengeHtml(html, title);

      if (!challenged && looksLikeForum(html)) {
        await page.waitForTimeout(600).catch(() => undefined);
        await importSessionCookies();
        cfReady = true;
        log(`Cloudflare пройден (title="${title.slice(0, 50)}").`);
        return {
          passed: true,
          hasClearance,
          title,
          userAgent: ua,
          message: 'Cloudflare cleared in browser session.',
        };
      }

      if (challenged) {
        promptUser(title);
        // Re-pin window every 20s in case it jumps off-screen again.
        if (Date.now() - lastMove > 20_000) {
          lastMove = Date.now();
          await forceWindowOnScreen(ctx).catch(() => undefined);
        }
      }

      // Poll only — no reloads, no synthetic clicks (they make CF "renew").
      await page.waitForTimeout(2500).catch(() => undefined);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/has been closed|Target closed|Browser closed/i.test(msg)) {
        context = null;
        browser = null;
        cfReady = false;
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }

  const cookies = context ? await context.cookies() : [];
  const hasClearance = cookies.some((c: { name: string; value: string }) => c.name === 'cf_clearance' && c.value);
  await importSessionCookies();
  const title = context ? await mainPage(context).then((p: AnyPage) => p.title()).catch(() => '') : '';
  return {
    passed: false,
    hasClearance,
    title,
    userAgent: ua,
    message:
      'Таймаут Cloudflare. Пройди капчу в окне браузера и вызови uc_cf_pass / scripts/uc-cf-pass.mjs снова.',
  };
}

export interface BrowserHttpResult {
  html: string;
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
}

/** HTTP through the live browser (real TLS). Required for Cloudflare sites. */
export async function browserHttp(
  target: string,
  opts: {
    method?: 'GET' | 'POST';
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    autoCf?: boolean;
  } = {},
): Promise<BrowserHttpResult> {
  const absolute = ucUrl(target);
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? Math.max(ucConfig.requestTimeoutMs, 60_000);

  let ctx: AnyContext;
  try {
    ctx = await ensureBrowserSession({ visible: true });
  } catch (err) {
    throw new BrowserUnavailableError((err as Error).message);
  }

  const page = await mainPage(ctx);

  if (!/unknowncheats\.me/i.test(page.url()) || !cfReady) {
    await page.goto(ucConfig.baseUrl + '/index.php', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
    const title = await page.title().catch(() => '');
    const html = await page.content().catch(() => '');
    if (opts.autoCf !== false && isChallengeHtml(html, title)) {
      const waited = await waitForCloudflareInSession(Math.max(90, Math.ceil(timeoutMs / 1000)));
      if (!waited.passed) {
        return {
          html: await page.content().catch(() => html),
          status: 403,
          finalUrl: page.url(),
          headers: {},
        };
      }
    } else if (!isChallengeHtml(html, title) && looksLikeForum(html)) {
      cfReady = true;
      await importSessionCookies();
    }
  }

  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...opts.headers,
  };
  if (method === 'POST' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }

  if (method === 'GET' && !opts.headers?.['X-Requested-With']) {
    const resp = await page.goto(absolute, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null);
    const html = await page.content();
    const title = await page.title().catch(() => '');
    if (isChallengeHtml(html, title)) {
      cfReady = false;
      if (opts.autoCf !== false) {
        const waited = await waitForCloudflareInSession(Math.max(90, Math.ceil(timeoutMs / 1000)));
        if (waited.passed) {
          const retry = await page.goto(absolute, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null);
          return {
            html: await page.content(),
            status: retry?.status() ?? 200,
            finalUrl: page.url(),
            headers: {},
          };
        }
      }
      return { html, status: 403, finalUrl: page.url(), headers: {} };
    }
    return {
      html,
      status: resp?.status() ?? 200,
      finalUrl: page.url() || absolute,
      headers: {},
    };
  }

  const result = await Promise.race([
    page.evaluate(
      async ({ url, method, body, headers }: { url: string; method: string; body?: string; headers: Record<string, string> }) => {
        const res = await fetch(url, {
          method,
          body: body ?? null,
          headers,
          credentials: 'include',
          redirect: 'follow',
        });
        const text = await res.text();
        const hdrs: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          hdrs[k] = v;
        });
        return { status: res.status, url: res.url, text, headers: hdrs };
      },
      { url: absolute, method, body: opts.body, headers },
    ),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Browser HTTP timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

  if (isChallengeHtml(result.text)) cfReady = false;

  return {
    html: result.text,
    status: result.status,
    finalUrl: result.url || absolute,
    headers: result.headers,
  };
}
