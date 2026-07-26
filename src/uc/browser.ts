import fs from 'node:fs';
import path from 'node:path';
import { ucConfig } from './config.js';
import { BrowserUnavailableError } from '../errors.js';
import { cookiesForBrowser } from './http/jar.js';
import {
  browserHttp,
  closeBrowserSession,
  ensureBrowserSession,
  importSessionCookies,
  markCloudflareReady,
  waitForCloudflareInSession,
} from './http/browser-fetch.js';
import { getHttpUserAgent } from './session-ua.js';

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

export interface CfPassResult {
  passed: boolean;
  cookiesImported: number;
  hasClearance: boolean;
  httpStatus: number | null;
  userAgent: string;
  message: string;
  browserPath?: string;
}

/**
 * Open real Edge/Chrome, wait for user to pass Cloudflare/captcha, keep session for tools.
 */
export async function passCloudflare(
  opts: { timeoutSec?: number; keepOpen?: boolean } = {},
): Promise<CfPassResult> {
  const timeoutSec = opts.timeoutSec ?? ucConfig.loginTimeoutSec;
  const keepOpen = opts.keepOpen ?? true;

  await closeBrowserSession().catch(() => undefined);
  await ensureBrowserSession({ visible: true });

  process.stderr.write(
    [
      '',
      '[uc] ============================================',
      '[uc]  Откроется Edge/Chrome с unknowncheats.me',
      '[uc]  Если Cloudflare/капча — ПРОЙДИ ВРУЧНУЮ',
      '[uc]  (галочка Verify you are human). Не закрывай окно.',
      `[uc]  Жду до ${timeoutSec}s…`,
      '[uc] ============================================',
      '',
    ].join('\n'),
  );

  const waited = await waitForCloudflareInSession(timeoutSec);
  const imported = await importSessionCookies();
  const ua = waited.userAgent || getHttpUserAgent();

  let httpStatus: number | null = null;
  let challenge = true;
  if (waited.passed) {
    try {
      const probe = await browserHttp(ucConfig.baseUrl + '/index.php', {
        timeoutMs: 45_000,
        autoCf: false,
      });
      httpStatus = probe.status;
      challenge = /Just a moment|challenge-platform|cf-chl-widget|Verify you are human/i.test(probe.html);
      if (!challenge && probe.status < 400) markCloudflareReady(true);
    } catch {
      httpStatus = null;
    }
  }

  const httpOk = waited.passed && httpStatus !== null && httpStatus < 400 && !challenge;

  if (!keepOpen && !httpOk) {
    await closeBrowserSession().catch(() => undefined);
  }

  if (httpOk) {
    return {
      passed: true,
      cookiesImported: imported,
      hasClearance: waited.hasClearance,
      httpStatus,
      userAgent: ua,
      browserPath: ucConfig.browserPath,
      message:
        `Cloudflare пройден (HTTP ${httpStatus}). Сессия браузера остаётся открытой для uc_* tools. ` +
        `Cookies: ${path.normalize(ucConfig.cookiesPath)}.`,
    };
  }

  return {
    passed: false,
    cookiesImported: imported,
    hasClearance: waited.hasClearance,
    httpStatus,
    userAgent: ua,
    browserPath: ucConfig.browserPath,
    message:
      waited.message ||
      `Cloudflare не пройден за ${timeoutSec}s (title="${waited.title}"). ` +
        `Пройди капчу в окне браузера и запусти uc_cf_pass снова.`,
  };
}

export interface LoginResult {
  loggedIn: boolean;
  username: string | null;
  cookiesImported: number;
  cfPassed?: boolean;
  message: string;
}

export async function interactiveLogin(
  opts: { timeoutSec?: number; keepOpen?: boolean; cfOnly?: boolean } = {},
): Promise<LoginResult> {
  const timeoutSec = opts.timeoutSec ?? ucConfig.loginTimeoutSec;
  const deadline = Date.now() + timeoutSec * 1000;
  const keepOpen = opts.keepOpen ?? true;

  await closeBrowserSession().catch(() => undefined);
  const ctx = await ensureBrowserSession({ visible: true });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  process.stderr.write(
    '[uc] Сначала Cloudflare (капча вручную при необходимости), затем логин на форум.\n',
  );

  const cf = await waitForCloudflareInSession(timeoutSec);
  let imported = await importSessionCookies();

  if (!cf.passed) {
    if (!keepOpen) await closeBrowserSession().catch(() => undefined);
    return {
      loggedIn: false,
      username: null,
      cookiesImported: imported,
      cfPassed: false,
      message: cf.message || 'Cloudflare not cleared. Complete captcha in the browser window and retry.',
    };
  }

  markCloudflareReady(true);

  if (opts.cfOnly) {
    return {
      loggedIn: false,
      username: null,
      cookiesImported: imported,
      cfPassed: true,
      message: `Cloudflare OK (${imported} cookies). Browser session kept. For forum login run uc_login without cfOnly.`,
    };
  }

  process.stderr.write(
    '[uc] Cloudflare OK. Войди в аккаунт UnknownCheats в открытом окне (логин/пароль/2FA).\n',
  );

  let cookies = await ctx.cookies();
  let hasUser = cookies.some((c: { name: string; value: string }) => c.name === 'bbuserid' && c.value && c.value !== '0');
  if (!hasUser) {
    await page
      .goto(ucConfig.baseUrl + '/member.php?do=login', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => undefined);
  }

  let username: string | null = null;
  while (Date.now() < deadline) {
    cookies = await ctx.cookies();
    hasUser = cookies.some((c: { name: string; value: string }) => c.name === 'bbuserid' && c.value && c.value !== '0');
    if (hasUser) {
      await page.waitForTimeout(1500);
      imported = await importSessionCookies();
      username = await page
        .locator('#navbar_username, .bigusername, .username_container .member_username')
        .first()
        .textContent({ timeout: 3000 })
        .catch(() => null);
      return {
        loggedIn: true,
        username: username?.trim() || null,
        cookiesImported: imported,
        cfPassed: true,
        message: 'Login OK. Browser session kept for tools. ' + path.normalize(ucConfig.cookiesPath),
      };
    }
    await page.waitForTimeout(1500);
  }

  imported = await importSessionCookies();
  return {
    loggedIn: false,
    username: null,
    cookiesImported: imported,
    cfPassed: true,
    message:
      imported > 0
        ? `Forum login not finished, CF OK (${imported} cookies). Public pages should work. Retry uc_login for account.`
        : `Login not completed within ${timeoutSec}s.`,
  };
}

export async function browserDownload(
  targetUrl: string,
  destDir: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ filePath: string; suggestedName: string; bytes: number }> {
  fs.mkdirSync(destDir, { recursive: true });

  let own = false;
  let browser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | null = null;
  let context;
  try {
    context = await ensureBrowserSession({ visible: true });
  } catch {
    own = true;
    const pw = await loadPlaywright();
    browser = await pw.chromium.launch({
      headless: false,
      executablePath: ucConfig.browserPath,
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    context = await browser.newContext({
      userAgent: getHttpUserAgent(),
      locale: 'en-US',
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    });
    await context.addCookies(cookiesForBrowser() as never).catch(() => undefined);
  }

  try {
    const timeout = opts.timeoutMs ?? 120_000;
    const page = await context.newPage();
    const downloadPromise = page.waitForEvent('download', { timeout }).catch(() => null);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);

    for (const sel of [
      'a[download]',
      '#download_button',
      'a.download-button',
      'a[href*="do=download"]',
      'button:has-text("Download")',
      'a:has-text("Download")',
    ]) {
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
    await page.close().catch(() => undefined);
    return { filePath, suggestedName: suggested, bytes };
  } finally {
    if (own) {
      await context.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }
}
