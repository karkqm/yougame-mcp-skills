// Pass Cloudflare for UC and probe public HTTP via browser TLS.
// node scripts/uc-cf-pass.mjs [timeoutSec]
import { passCloudflare } from '../dist/uc/browser.js';
import { authStatus, getCategories } from '../dist/uc/api.js';
import { getPage } from '../dist/uc/http/client.js';
import { browserHttp, closeBrowserSession } from '../dist/uc/http/browser-fetch.js';
import { hasCloudflareCookies, cookieHeaderFor } from '../dist/uc/http/jar.js';
import { getHttpUserAgent } from '../dist/uc/session-ua.js';
import { ucConfig } from '../dist/uc/config.js';

const timeoutSec = Number.parseInt(process.argv[2] || '180', 10);

console.log('=== before ===');
console.log({
  baseUrl: ucConfig.baseUrl,
  browserPath: ucConfig.browserPath || '(none)',
  profile: ucConfig.browserProfileDir,
  cdpUrl: ucConfig.cdpUrl || '(auto-spawn)',
  hasCf: hasCloudflareCookies(),
  ua: getHttpUserAgent().slice(0, 90),
  cookiePreview: (cookieHeaderFor(ucConfig.baseUrl) || '').slice(0, 100),
});

console.log(`\n=== passCloudflare (${timeoutSec}s) ===`);
console.log('Откроется Edge/Chrome. Если Cloudflare/капча — ПРОЙДИ ВРУЧНУЮ, окно не закрывай.');

const result = await passCloudflare({ timeoutSec });
console.log('\n=== pass result ===');
console.log(JSON.stringify(result, null, 2));

if (!result.passed) {
  console.log('\nCF not passed — skip probes. Пройди капчу в окне Edge и запусти скрипт снова.');
  console.log('Совет: окно может быть на другом мониторе / под другими окнами (title: «Один момент…»).');
  process.exitCode = 2;
} else {
  console.log('\n=== browser HTTP probe ===');
  try {
    const probe = await browserHttp(ucConfig.baseUrl + '/index.php', { timeoutMs: 45_000, autoCf: false });
    console.log({
      status: probe.status,
      title: (probe.html.match(/<title[^>]*>([^<]+)/i)?.[1] || '').trim().slice(0, 80),
      challenge: /Just a moment|challenge-platform|Один момент/i.test(probe.html),
      bytes: probe.html.length,
    });
  } catch (e) {
    console.log('browser probe failed:', e.message);
  }

  console.log('\n=== getPage (auto transport) ===');
  try {
    const page = await getPage('/index.php', { noCache: true, allowGate: true });
    console.log({
      status: page.status,
      via: page.via,
      title: (page.html.match(/<title[^>]*>([^<]+)/i)?.[1] || '').trim().slice(0, 80),
      challenge: /Just a moment|challenge-platform|Один момент/i.test(page.html),
      loggedIn: page.loggedIn,
    });
  } catch (e) {
    console.log('getPage failed:', e.message);
  }

  console.log('\n=== authStatus ===');
  console.log(JSON.stringify(await authStatus(), null, 2));

  console.log('\n=== categories probe ===');
  try {
    const cats = await getCategories();
    const forums = (cats.categories ?? []).flatMap((c) => c.forums ?? []);
    console.log({
      source: cats.source,
      blocks: cats.categories?.length ?? 0,
      forums: forums.length,
      sample: forums.slice(0, 6).map((f) => ({ id: f.id, title: f.title })),
    });
  } catch (e) {
    console.log('getCategories failed:', e.message);
    if (e.detail) console.log('detail:', e.detail);
  }
}

await closeBrowserSession().catch(() => undefined);
