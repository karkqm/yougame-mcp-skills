import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { BrowserUnavailableError } from './errors.js';
import { cookiesForBrowser, saveJar, getJar } from './http/jar.js';
import { dropCache } from './http/client.js';

type PlaywrightModule = typeof import('playwright');

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import('playwright')) as PlaywrightModule;
  } catch {
    throw new BrowserUnavailableError(
      'Playwright не установлен. Выполни в каталоге сервера: npm i playwright && npx playwright install chromium',
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

/** Переносит куки из окна браузера в наш cookie jar. */
function importCookies(cookies: BrowserCookie[]): number {
  const jar = getJar();
  let count = 0;
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, '');
    if (!domain.includes(new URL(config.baseUrl).hostname.replace(/^www\./, ''))) continue;
    const parts = [`${c.name}=${c.value}`, `Domain=${domain}`, `Path=${c.path || '/'}`];
    if (c.expires && c.expires > 0) parts.push(`Expires=${new Date(c.expires * 1000).toUTCString()}`);
    if (c.secure) parts.push('Secure');
    if (c.httpOnly) parts.push('HttpOnly');
    try {
      jar.setCookieSync(parts.join('; '), config.baseUrl, { ignoreError: true });
      count++;
    } catch {
      /* пропускаем */
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

/**
 * Открывает настоящее окно браузера со страницей входа форума и ждёт,
 * пока пользователь войдёт (пароль, капча, 2FA — всё вручную).
 * После появления куки xf_user сессия сохраняется на диск.
 */
export async function interactiveLogin(opts: { timeoutSec?: number; keepOpen?: boolean } = {}): Promise<LoginResult> {
  const pw = await loadPlaywright();
  fs.mkdirSync(config.browserProfileDir, { recursive: true });

  let context;
  try {
    context = await pw.chromium.launchPersistentContext(config.browserProfileDir, {
      ...launchArgs(false),
      userAgent: config.userAgent,
      locale: 'ru-RU',
      viewport: { width: 1280, height: 900 },
    });
  } catch (err) {
    throw new BrowserUnavailableError(
      `Не удалось запустить Chromium: ${(err as Error).message}. Установи браузер: npx playwright install chromium`,
    );
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(config.baseUrl + '/login/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);

    const deadline = Date.now() + (opts.timeoutSec ?? config.loginTimeoutSec) * 1000;
    let username: string | null = null;

    while (Date.now() < deadline) {
      const cookies = await context.cookies(config.baseUrl);
      const hasUser = cookies.some((c) => c.name === 'xf_user' && c.value);
      if (hasUser) {
        // Дать форуму дописать сессионные куки после редиректа.
        await page.waitForTimeout(1500);
        const fresh = await context.cookies(config.baseUrl);
        const imported = importCookies(fresh as unknown as BrowserCookie[]);
        username = await page
          .locator('.p-navgroup-link--user .p-navgroup-linkText')
          .first()
          .textContent({ timeout: 2000 })
          .catch(() => null);
        if (!opts.keepOpen) await context.close();
        return {
          loggedIn: true,
          username: username?.trim() || null,
          cookiesImported: imported,
          message: 'Вход выполнен, куки сохранены в ' + path.normalize(config.cookiesPath),
        };
      }
      await page.waitForTimeout(1500);
    }

    if (!opts.keepOpen) await context.close();
    return {
      loggedIn: false,
      username: null,
      cookiesImported: 0,
      message: `Вход не завершён за ${opts.timeoutSec ?? config.loginTimeoutSec} с. Запусти yg_login ещё раз и заверши вход в открывшемся окне.`,
    };
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}

export interface BrowserDownloadResult {
  filePath: string;
  suggestedName: string;
  bytes: number;
}

interface PlaywrightDownload {
  suggestedFilename(): string;
  saveAs(target: string): Promise<void>;
}

/** Типовые элементы скачивания на файлообменниках, от точных к общим. */
const DOWNLOAD_SELECTORS = [
  'a[download]',
  '#downloadButton',
  '#download_button',
  'a.download-button',
  'a.btn-prio',
  '.btn-prio',
  'a[href*="/start/"]',
  'a[href*="/start"]',
  'a:has-text("Download archive")',
  'button:has-text("Скачать")',
  'a:has-text("Скачать")',
  'button:has-text("Download")',
  'a:has-text("Download")',
  'button:has-text("Загрузить")',
  '.js-download-btn',
];

interface PageLike {
  locator: (selector: string) => { first: () => { count: () => Promise<number>; click: (opts?: { timeout?: number }) => Promise<void> } };
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState: (state: never, opts?: { timeout?: number }) => Promise<void>;
}

/**
 * Ждёт файл, между попытками нажимая кнопку скачивания.
 * Обменники любят промежуточные страницы, JS-проверки и таймеры ожидания.
 */
async function clickUntilDownload(
  page: PageLike,
  downloadPromise: Promise<unknown>,
  rounds: number,
): Promise<PlaywrightDownload | null> {
  let done = false;
  const guarded = downloadPromise.then((d) => {
    done = true;
    return d;
  });

  for (let round = 0; round < rounds && !done; round++) {
    // Первый круг короткий: часть хостингов отдаёт файл прямо при переходе.
    const outcome = await Promise.race([
      guarded.then(() => 'download' as const),
      page.waitForTimeout(round === 0 ? 3000 : 7000).then(() => 'timeout' as const),
    ]);
    if (outcome === 'download') break;

    for (const selector of DOWNLOAD_SELECTORS) {
      const locator = page.locator(selector).first();
      if (!(await locator.count().catch(() => 0))) continue;
      await locator.click({ timeout: 5000 }).catch(() => undefined);
      break;
    }
    await page.waitForLoadState('domcontentloaded' as never, { timeout: 15_000 }).catch(() => undefined);
  }

  return (await guarded) as PlaywrightDownload | null;
}

/**
 * Архив на обменнике, который не отдаёт ZIP целиком (например workupload):
 * открывает страницу, находит ссылки на отдельные файлы и качает их по очереди.
 */
export async function browserDownloadArchive(
  targetUrl: string,
  destDir: string,
  opts: { headless?: boolean; filePattern?: RegExp; maxFiles?: number } = {},
): Promise<{ files: BrowserDownloadResult[]; discovered: string[] }> {
  const pw = await loadPlaywright();
  fs.mkdirSync(destDir, { recursive: true });
  const pattern = opts.filePattern ?? /\/file\/[\w-]+$/;

  const browser = await pw.chromium.launch(launchArgs(opts.headless ?? false));
  const context = await browser.newContext({
    userAgent: config.userAgent,
    locale: 'ru-RU',
    acceptDownloads: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(5000);

    const discovered: string[] = await page.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('a[href]'), (a: Element) => (a as HTMLAnchorElement).href) as string[],
    );
    const fileLinks = [...new Set(discovered.filter((href) => pattern.test(new URL(href).pathname)))].slice(
      0,
      opts.maxFiles ?? 25,
    );

    const files: BrowserDownloadResult[] = [];
    for (const link of fileLinks) {
      // Обменники троттлят загрузки подряд — идём с паузой.
      if (files.length) await page.waitForTimeout(4000);
      const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      const download = await clickUntilDownload(page as unknown as PageLike, downloadPromise, 3);
      if (!download) continue;
      const suggested = download.suggestedFilename() || 'download.bin';
      const filePath = path.join(destDir, suggested);
      await download.saveAs(filePath);
      files.push({ filePath, suggestedName: suggested, bytes: fs.statSync(filePath).size });
    }

    return { files, discovered: fileLinks };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/**
 * Резервный способ скачивания: открыть страницу файлообменника в браузере,
 * нажать кнопку загрузки и перехватить событие download.
 */
export async function browserDownload(
  targetUrl: string,
  destDir: string,
  opts: { headless?: boolean; timeoutMs?: number } = {},
): Promise<BrowserDownloadResult> {
  const pw = await loadPlaywright();
  fs.mkdirSync(destDir, { recursive: true });

  const browser = await pw.chromium.launch(launchArgs(opts.headless ?? false)).catch((err: Error) => {
    throw new BrowserUnavailableError(
      `Не удалось запустить Chromium: ${err.message}. Установи браузер: npx playwright install chromium`,
    );
  });

  const context = await browser.newContext({
    userAgent: config.userAgent,
    locale: 'ru-RU',
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await context.addCookies(cookiesForBrowser() as never).catch(() => undefined);
    const timeout = opts.timeoutMs ?? 180_000;

    // Файл может прийти как на исходной вкладке, так и во всплывающей.
    type Download = Awaited<ReturnType<typeof firstDownload>>;
    let resolveDownload: ((d: unknown) => void) | null = null;
    const downloadPromise = new Promise<unknown>((resolve) => {
      resolveDownload = resolve;
    });
    function firstDownload() {
      return downloadPromise as Promise<{ suggestedFilename(): string; saveAs(p: string): Promise<void> }>;
    }
    const watch = (p: { on: (event: string, cb: (d: unknown) => void) => void }) => {
      p.on('download', (d: unknown) => resolveDownload?.(d));
    };
    context.on('page', (p) => watch(p as never));

    const page = await context.newPage();
    watch(page as never);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);

    // Обменники часто ведут в 2–3 шага (страница файла → ожидание → файл).
    const raced = Promise.race([
      firstDownload(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);
    const download = (await clickUntilDownload(page as never, raced, 4)) as Download | null;

    if (!download) {
      throw new Error(
        'Браузер не получил файл: кнопка скачивания не найдена или хостинг требует действий пользователя (капча, ожидание, оплата).',
      );
    }

    const suggested = download.suggestedFilename() || 'download.bin';
    const filePath = path.join(destDir, suggested);
    await download.saveAs(filePath);
    const bytes = fs.statSync(filePath).size;
    return { filePath, suggestedName: suggested, bytes };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
