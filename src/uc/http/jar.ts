import fs from 'node:fs';
import path from 'node:path';
import { CookieJar } from 'tough-cookie';
import { ucConfig } from '../config.js';

let jar: CookieJar = new CookieJar();
let loaded = false;

function ensureHome(): void {
  fs.mkdirSync(ucConfig.home, { recursive: true });
}

export function getJar(): CookieJar {
  if (loaded) return jar;
  loaded = true;
  try {
    const raw = fs.readFileSync(ucConfig.cookiesPath, 'utf8');
    jar = CookieJar.deserializeSync(JSON.parse(raw));
  } catch {
    jar = new CookieJar();
  }
  return jar;
}

export function saveJar(): void {
  ensureHome();
  const tmp = ucConfig.cookiesPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(getJar().serializeSync(), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ucConfig.cookiesPath);
}

export function clearJar(): void {
  jar = new CookieJar();
  loaded = true;
  try {
    fs.unlinkSync(ucConfig.cookiesPath);
  } catch {
    /* file may not exist */
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
      /* skip bad cookie */
    }
  }
  if (changed) saveJar();
}

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
  const host = new URL(ucConfig.baseUrl).hostname;
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

export const cookiesFile = path.normalize(ucConfig.cookiesPath);

export function hasSessionCookies(): boolean {
  const header = cookieHeaderFor(ucConfig.baseUrl);
  return /(^|;\s*)bbuserid=/.test(header) || /(^|;\s*)bbsessionhash=/.test(header);
}
