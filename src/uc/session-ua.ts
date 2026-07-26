import fs from 'node:fs';
import { ucConfig } from './config.js';

/**
 * Cloudflare binds cf_clearance to the browser User-Agent.
 * Persist the UA used when the challenge was solved so HTTP fetch matches.
 */
export function getHttpUserAgent(): string {
  try {
    const ua = fs.readFileSync(ucConfig.sessionUaPath, 'utf8').trim();
    if (ua.length > 20) return ua;
  } catch {
    /* missing */
  }
  return ucConfig.userAgent;
}

export function saveSessionUserAgent(ua: string): void {
  if (!ua || ua.length < 20) return;
  fs.mkdirSync(ucConfig.home, { recursive: true });
  const tmp = ucConfig.sessionUaPath + '.tmp';
  fs.writeFileSync(tmp, ua, { mode: 0o600 });
  fs.renameSync(tmp, ucConfig.sessionUaPath);
}

export function clearSessionUserAgent(): void {
  try {
    fs.unlinkSync(ucConfig.sessionUaPath);
  } catch {
    /* ok */
  }
}
