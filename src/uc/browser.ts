import fs from 'node:fs';
import path from 'node:path';
import { ucConfig } from './config.js';
import { BrowserUnavailableError } from '../errors.js';
import { cookiesForBrowser, saveJar, getJar } from './http/jar.js';
import { dropCache } from './http/client.js';

type PlaywrightModule = typeof import('playwright');

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import('playwright')) as PlaywrightModule;
  } catch {
    throw new BrowserUnavailableError(
      'Playwright not installed. Run: npm i playwright && npx playwright install chromium',
    );
  }
}

function launchArgs(headless: boolean) {
  return {
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  };
}

interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

function importCookies(cookies: BrowserCookie[]): number {
  const jar = getJar();
  let count = 0;
  const baseHost = new URL(ucConfig.baseUrl).hostname.replace(/^www\./, '');
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, '');
    // Accept cookies for unknowncheats.me and its subdomains (including Cloudflare's cf_clearance)
    if (!domain.includes(baseHost)) continue;
    const parts = [`${c.name}=${c.value}`, `Domain=${c.domain}`, `Path=${c.path || '/'}`];
    if (c.expires && c.expires > 0) parts.push(`Expires=${new Date(c.expires * 1000).toUTCString()}`);
    if (c.secure) parts.push('Secure');
    if (c.httpOnly) parts.push('HttpOnly');
    try {
      jar.setCookieSync(parts.join('; '), ucConfig.baseUrl, { ignoreError: true });
      count++;
    } catch {
      /* skip */
    }
  }
  saveJar();
  dropCache();
  return count;
}

export interface LoginResult {
  loggedIn: boolean;
  username: string | null;
  cookiesImported: number;
  message: string;
}

export async function interactiveLogin(opts: { timeoutSec?: number; keepOpen?: boolean } = {}): Promise<LoginResult> {
  const pw = await loadPlaywright();
  fs.mkdirSync(ucConfig.browserProfileDir, { recursive: true });

  let context;
  try {
    context = await pw.chromium.launchPersistentContext(ucConfig.browserProfileDir, {
      ...launchArgs(false),
      userAgent: ucConfig.userAgent,
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
  } catch (err) {
    throw new BrowserUnavailableError(
      `Failed to launch Chromium: ${(err as Error).message}. Install: npx playwright install chromium`,
    );
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    // Step 1: Navigate — Cloudflare challenge will auto-solve in a real browser
    await page.goto(ucConfig.baseUrl + '/index.php', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);

    const deadline = Date.now() + (opts.timeoutSec ?? ucConfig.loginTimeoutSec) * 1000;

    // Step 2: Wait for Cloudflare to pass (cf_clearance cookie appears)
    let cfPassed = false;
    while (Date.now() < deadline && !cfPassed) {
      const title = await page.title().catch(() => '');
      if (/Just a moment/i.test(title)) {
        await page.waitForTimeout(2000);
        continue;
      }
      cfPassed = true;
    }

    if (!cfPassed) {
      // Save whatever cookies we got (might still be useful)
      const partial = await context.cookies(ucConfig.baseUrl);
      const imported = importCookies(partial as unknown as BrowserCookie[]);
      if (!opts.keepOpen) await context.close();
      return {
        loggedIn: false,
        username: null,
        cookiesImported: imported,
        message: 'Cloudflare challenge was not resolved in time. Try uc_login again.',
      };
    }

    // Step 3: Check if already logged in (from persistent browser profile)
    let cookies = await context.cookies(ucConfig.baseUrl);
    let hasUser = cookies.some((c) => c.name === 'bbuserid' && c.value && c.value !== '0');

    if (!hasUser) {
      // Navigate to login page
      await page.goto(ucConfig.baseUrl + '/member.php?do=login', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    }

    // Step 4: Wait for forum login (bbuserid cookie)
    let username: string | null = null;
    while (Date.now() < deadline) {
      cookies = await context.cookies(ucConfig.baseUrl);
      hasUser = cookies.some((c) => c.name === 'bbuserid' && c.value && c.value !== '0');
      if (hasUser) {
        await page.waitForTimeout(1500);
        const fresh = await context.cookies(ucConfig.baseUrl);
        const imported = importCookies(fresh as unknown as BrowserCookie[]);
        username = await page
          .locator('#navbar_username, .bigusername, .username_container .member_username')
          .first()
          .textContent({ timeout: 3000 })
          .catch(() => null);
        if (!opts.keepOpen) await context.close();
        return {
          loggedIn: true,
          username: username?.trim() || null,
          cookiesImported: imported,
          message: 'Login successful, cookies saved to ' + path.normalize(ucConfig.cookiesPath),
        };
      }
      await page.waitForTimeout(1500);
    }

    // Timeout — save Cloudflare cookies at least (cf_clearance enables HTTP access even without login)
    const finalCookies = await context.cookies(ucConfig.baseUrl);
    const imported = importCookies(finalCookies as unknown as BrowserCookie[]);
    if (!opts.keepOpen) await context.close();
    return {
      loggedIn: false,
      username: null,
      cookiesImported: imported,
      message: imported > 0
        ? `Forum login not completed, but ${imported} cookies saved (including Cloudflare clearance). HTTP access to public pages should work now. Run uc_login again to complete forum login.`
        : `Login not completed within ${opts.timeoutSec ?? ucConfig.loginTimeoutSec}s. Run uc_login again.`,
    };
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}

export async function browserDownload(
  targetUrl: string,
  destDir: string,
  opts: { headless?: boolean; timeoutMs?: number } = {},
): Promise<{ filePath: string; suggestedName: string; bytes: number }> {
  const pw = await loadPlaywright();
  fs.mkdirSync(destDir, { recursive: true });

  const browser = await pw.chromium.launch(launchArgs(opts.headless ?? false)).catch((err: Error) => {
    throw new BrowserUnavailableError(`Failed to launch Chromium: ${err.message}`);
  });

  const context = await browser.newContext({
    userAgent: ucConfig.userAgent,
    locale: 'en-US',
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });

  try {
    await context.addCookies(cookiesForBrowser() as never).catch(() => undefined);
    const timeout = opts.timeoutMs ?? 120_000;
    const page = await context.newPage();

    const downloadPromise = page.waitForEvent('download', { timeout }).catch(() => null);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);

    // Try clicking download buttons
    const selectors = [
      'a[download]', '#download_button', 'a.download-button',
      'a[href*="do=download"]', 'button:has-text("Download")', 'a:has-text("Download")',
    ];
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        await loc.click({ timeout: 5000 }).catch(() => undefined);
        break;
      }
    }

    const download = await downloadPromise;
    if (!download) throw new Error('No download received from browser');

    const dl = download as unknown as { suggestedFilename(): string; saveAs(p: string): Promise<void> };
    const suggested = dl.suggestedFilename() || 'download.bin';
    const filePath = path.join(destDir, suggested);
    await dl.saveAs(filePath);
    const bytes = fs.statSync(filePath).size;
    return { filePath, suggestedName: suggested, bytes };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
