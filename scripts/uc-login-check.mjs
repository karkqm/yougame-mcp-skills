// UC: Cloudflare + forum login smoke. node scripts/uc-login-check.mjs [timeoutSec]
import { interactiveLogin } from '../dist/uc/browser.js';
import { authStatus, getCategories } from '../dist/uc/api.js';
import { getPage } from '../dist/uc/http/client.js';
import { hasSessionCookies, cookieHeaderFor } from '../dist/uc/http/jar.js';
import { ucConfig } from '../dist/uc/config.js';

const timeoutSec = Number.parseInt(process.argv[2] || '420', 10);

console.log('=== UC config ===');
console.log({
  baseUrl: ucConfig.baseUrl,
  cookiesPath: ucConfig.cookiesPath,
  browserProfileDir: ucConfig.browserProfileDir,
  cookiesOnDisk: hasSessionCookies(),
  cookieHeaderSample: (cookieHeaderFor(ucConfig.baseUrl) || '').slice(0, 120),
});

console.log('\n=== HTTP before login (allowGate) ===');
try {
  const page = await getPage('/index.php', { noCache: true, allowGate: true });
  const title = (page.html.match(/<title[^>]*>([^<]+)/i)?.[1] || '').trim();
  const isCf = /Just a moment|challenge-platform|cf-chl-widget/i.test(page.html);
  console.log({
    status: page.status,
    finalUrl: page.finalUrl,
    title: title.slice(0, 80),
    cloudflareChallenge: isCf,
    loggedInHtml: page.loggedIn,
    htmlBytes: page.html.length,
  });
} catch (err) {
  console.log('HTTP precheck failed:', err.message);
}

console.log(`\n=== interactiveLogin (timeout ${timeoutSec}s) — browser will open ===`);
console.log('Pass Cloudflare if shown, then log into the forum if needed.');
const result = await interactiveLogin({ timeoutSec });
console.log('\n=== login result ===');
console.log(JSON.stringify(result, null, 2));

console.log('\n=== HTTP authStatus after login ===');
try {
  const status = await authStatus();
  console.log(JSON.stringify(status, null, 2));
} catch (err) {
  console.log('authStatus failed:', err.message);
}

console.log('\n=== public categories probe ===');
try {
  const cats = await getCategories();
  console.log({
    source: cats.source,
    categoryBlocks: cats.categories?.length ?? 0,
    firstForums: (cats.categories ?? [])
      .flatMap((c) => c.forums ?? [])
      .slice(0, 5)
      .map((f) => ({ id: f.id, title: f.title, threads: f.threads })),
  });
} catch (err) {
  console.log('getCategories failed:', err.message);
  if (err.hint) console.log('hint:', err.hint);
}
