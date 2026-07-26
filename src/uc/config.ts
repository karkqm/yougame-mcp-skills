import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

const home = process.env.UC_MCP_HOME || path.join(os.homedir(), '.uc-mcp');

/**
 * Prefer the user's real browser (Edge/Chrome). Playwright Chromium is fingerprinted by CF.
 * Note: Chrome 136+ ignores --remote-debugging-port on the *default* profile — we use a
 * dedicated UC profile with the same browser binary (real TLS + real engine).
 */
function resolveBrowserPath(): string | undefined {
  if (process.env.UC_BROWSER_PATH || process.env.UC_CHROME_PATH) {
    return process.env.UC_BROWSER_PATH || process.env.UC_CHROME_PATH;
  }

  const candidates: string[] = [
    // User's main browser on this machine (Edge)
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  // chrome-for-testing under ~/.uc-mcp/browsers (fallback)
  try {
    const browsersRoot = path.join(home, 'browsers');
    if (fs.existsSync(browsersRoot)) {
      const stack = [browsersRoot];
      while (stack.length) {
        const dir = stack.pop()!;
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          try {
            if (fs.statSync(full).isDirectory()) stack.push(full);
            else if (/^(chrome|msedge)(\.exe)?$/i.test(name)) candidates.push(full);
          } catch {
            /* skip */
          }
        }
      }
    }
  } catch {
    /* optional */
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined;
}

export const ucConfig = {
  baseUrl: (process.env.UC_BASE_URL || 'https://www.unknowncheats.me/forum').replace(/\/+$/, ''),
  home,
  cookiesPath: path.join(home, 'cookies.json'),
  sessionUaPath: path.join(home, 'session-ua.txt'),
  /** Dedicated profile for UC automation (not the default Edge profile — Chrome 136+ blocks CDP there). */
  browserProfileDir: process.env.UC_USER_DATA_DIR || path.join(home, 'browser-profile'),
  browserPath: resolveBrowserPath(),
  /** If set (e.g. http://127.0.0.1:9222), attach to already-running browser with remote debugging. */
  cdpUrl: process.env.UC_CDP_URL || process.env.UC_CDP_PORT
    ? `http://127.0.0.1:${process.env.UC_CDP_PORT || '9222'}`
    : '',
  downloadDir: process.env.UC_DOWNLOAD_DIR || path.join(home, 'downloads'),
  minRequestIntervalMs: envInt('UC_MIN_INTERVAL_MS', 1200),
  requestTimeoutMs: envInt('UC_TIMEOUT_MS', 30_000),
  maxRetries: envInt('UC_MAX_RETRIES', 3),
  htmlCacheTtlMs: envInt('UC_CACHE_TTL_MS', 45_000),
  maxDownloadBytes: envInt('UC_MAX_DOWNLOAD_MB', 1024) * 1024 * 1024,
  loginTimeoutSec: envInt('UC_LOGIN_TIMEOUT_SEC', 300),
  userAgent:
    process.env.UC_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
} as const;

/** Alias used by older code paths. */
export const chromePath = ucConfig.browserPath;

export function ucUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const base = ucConfig.baseUrl;
  if (pathname.startsWith('/forum')) return base.replace(/\/forum$/, '') + pathname;
  return base + (pathname.startsWith('/') ? pathname : '/' + pathname);
}
