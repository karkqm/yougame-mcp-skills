import os from 'node:os';
import path from 'node:path';

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

const home = process.env.YOUGAME_MCP_HOME || path.join(os.homedir(), '.yougame-mcp');

export const config = {
  /** Базовый адрес форума. Меняется через YOUGAME_BASE_URL. */
  baseUrl: (process.env.YOUGAME_BASE_URL || 'https://yougame.biz').replace(/\/+$/, ''),

  /** Каталог состояния: куки, профиль браузера, загрузки. */
  home,
  cookiesPath: path.join(home, 'cookies.json'),
  browserProfileDir: path.join(home, 'browser-profile'),
  downloadDir: process.env.YOUGAME_DOWNLOAD_DIR || path.join(home, 'downloads'),

  /** База знаний: инструменты, находки, сессии ресерча. */
  kbPath: process.env.YOUGAME_KB_PATH || path.join(home, 'kb.json'),

  /** Минимальная пауза между запросами к форуму, мс (вежливость к серверу). */
  minRequestIntervalMs: envInt('YOUGAME_MIN_INTERVAL_MS', 900),
  requestTimeoutMs: envInt('YOUGAME_TIMEOUT_MS', 30_000),
  maxRetries: envInt('YOUGAME_MAX_RETRIES', 3),

  /** TTL кэша HTML-страниц в памяти, мс. */
  htmlCacheTtlMs: envInt('YOUGAME_CACHE_TTL_MS', 45_000),

  /** Потолок размера скачиваемого файла, байт. */
  maxDownloadBytes: envInt('YOUGAME_MAX_DOWNLOAD_MB', 1024) * 1024 * 1024,

  /** Таймаут ожидания ручного входа в окне браузера, с. */
  loginTimeoutSec: envInt('YOUGAME_LOGIN_TIMEOUT_SEC', 300),

  userAgent:
    process.env.YOUGAME_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
} as const;

export function url(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return config.baseUrl + (pathname.startsWith('/') ? pathname : '/' + pathname);
}
