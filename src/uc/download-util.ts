import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ucConfig } from './config.js';

function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || `download-${Date.now()}`).slice(0, 180);
}

function nameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const star = value.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return sanitizeName(decodeURIComponent(star[1].replace(/^"|"$/g, '')));
    } catch {
      /* try plain filename */
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? sanitizeName(plain[1]) : null;
}

function nameFromUrl(target: string): string | null {
  try {
    const base = decodeURIComponent(new URL(target).pathname.split('/').filter(Boolean).pop() || '');
    return base ? sanitizeName(base) : null;
  } catch {
    return null;
  }
}

export async function saveStream(
  res: Response,
  destDir: string,
  fallbackName?: string,
): Promise<{ filePath: string; fileName: string; bytes: number; sha256: string }> {
  fs.mkdirSync(destDir, { recursive: true });
  const maxBytes = ucConfig.maxDownloadBytes;
  const fileName =
    nameFromDisposition(res.headers.get('content-disposition')) ||
    nameFromUrl(res.url) ||
    sanitizeName(fallbackName || `download-${Date.now()}`);
  let filePath = path.join(destDir, fileName);
  let i = 1;
  while (fs.existsSync(filePath)) {
    const ext = path.extname(fileName);
    filePath = path.join(destDir, `${path.basename(fileName, ext)} (${i++})${ext}`);
  }

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  if (!res.body) throw new Error('Empty response body');

  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    hash.update(chunk);
    if (bytes > maxBytes) source.destroy(new Error(`File exceeds limit ${Math.round(maxBytes / 1024 / 1024)} MB`));
  });
  await pipeline(source, fs.createWriteStream(filePath));

  return { filePath, fileName: path.basename(filePath), bytes, sha256: hash.digest('hex') };
}
