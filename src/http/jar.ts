import fs from 'node:fs';
import path from 'node:path';
import { CookieJar } from 'tough-cookie';
import { config } from '../config.js';

let jar: CookieJar = new CookieJar();
let loaded = false;

function ensureHome(): void {
  fs.mkdirSync(config.home, { recursive: true });
}

/** Загружает куки с диска (один раз за процесс). */
export function getJar(): CookieJar {
  if (loaded) return jar;
  loaded = true;
  try {
    const raw = fs.readFileSync(config.cookiesPath, 'utf8');
    jar = CookieJar.deserializeSync(JSON.parse(raw));
  } catch {
    jar = new CookieJar();
  }
  return jar;
}

/** Атомарно сохраняет куки на диск. */
export function saveJar(): void {
  ensureHome();
  const tmp = config.cookiesPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(getJar().serializeSync(), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, config.cookiesPath);
}

export function clearJar(): void {
  jar = new CookieJar();
  loaded = true;
  try {
    fs.unlinkSync(config.cookiesPath);
  } catch {
    /* файла может не быть */
  }
}

export function cookieHeaderFor(target: string): string {
  try {
    return getJar().getCookieStringSync(target);
  } catch {
    return '';
  }
}

export function storeSetCookies(target: string, values: string[]): void {
  const j = getJar();
  let changed = false;
  for (const value of values) {
    try {
      j.setCookieSync(value, target, { ignoreError: true });
      changed = true;
    } catch {
      /* битую куку просто пропускаем */
    }
  }
  if (changed) saveJar();
}

/** Куки форума в формате Playwright (для окна логина и браузерных загрузок). */
interface SerializedCookie {
  key: string;
  value: string;
  domain?: string;
  path?: string;
  hostOnly?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  expires?: string;
}

export function cookiesForBrowser(): Array<Record<string, unknown>> {
  const host = new URL(config.baseUrl).hostname;
  const out: Array<Record<string, unknown>> = [];
  const serialized = getJar().serializeSync();
  for (const c of (serialized?.cookies ?? []) as SerializedCookie[]) {
    if (!c.domain) continue;
    if (!(c.domain === host || host.endsWith('.' + c.domain) || c.domain.endsWith(host))) continue;
    out.push({
      name: c.key,
      value: c.value,
      domain: c.hostOnly ? c.domain : '.' + c.domain.replace(/^\./, ''),
      path: c.path || '/',
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      expires: c.expires && c.expires !== 'Infinity' ? Math.floor(new Date(c.expires).getTime() / 1000) : -1,
    });
  }
  return out;
}

/** Имя файла куки для диагностики. */
export const cookiesFile = path.normalize(config.cookiesPath);

/** Есть ли признак активной сессии форума. */
export function hasSessionCookies(): boolean {
  const header = cookieHeaderFor(config.baseUrl);
  return /(^|;\s*)xf_user=/.test(header) || /(^|;\s*)xf_session=/.test(header);
}
