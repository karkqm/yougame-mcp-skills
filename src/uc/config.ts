import os from 'node:os';
import path from 'node:path';

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

const home = process.env.UC_MCP_HOME || path.join(os.homedir(), '.uc-mcp');

export const ucConfig = {
  baseUrl: (process.env.UC_BASE_URL || 'https://www.unknowncheats.me/forum').replace(/\/+$/, ''),
  home,
  cookiesPath: path.join(home, 'cookies.json'),
  browserProfileDir: path.join(home, 'browser-profile'),
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

export function ucUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const base = ucConfig.baseUrl;
  if (pathname.startsWith('/forum')) return base.replace(/\/forum$/, '') + pathname;
  return base + (pathname.startsWith('/') ? pathname : '/' + pathname);
}
