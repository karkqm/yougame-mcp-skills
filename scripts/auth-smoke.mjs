// Проверка путей, требующих сессии: node scripts/auth-smoke.mjs
import { search, getThread, authStatus } from '../dist/api.js';
import { classify } from '../dist/resources/hosts.js';

const show = (label, value) => console.log(`\n=== ${label} ===\n` + JSON.stringify(value, null, 2).slice(0, 1800));

show('auth', await authStatus());

const byThread = await search({ keywords: 'target hud', type: 'thread', order: 'relevance' });
show('search (темы)', {
  запрос: byThread.query,
  ссылкаНаРезультаты: byThread.resultsUrl,
  страниц: byThread.pages,
  найдено: byThread.hits.length,
  первые3: byThread.hits.slice(0, 3),
});

const inForum = await search({ keywords: 'esp', forumIds: [853], type: 'post', order: 'date' });
show('search (в разделе 853)', {
  найдено: inForum.hits.length,
  первые2: inForum.hits.slice(0, 2).map((h) => ({ title: h.title, url: h.url, forum: h.forum, date: h.date })),
});

// Тема, где гостю было видно 10 замков.
const t = await getThread(384660);
const links = t.posts.flatMap((p) =>
  p.links.filter((l) => !l.internal && classify(l.url).host).map((l) => ({ пост: p.number, host: classify(l.url).host.id, url: l.url.slice(0, 80) })),
);
show('thread 384660 под сессией', { заголовок: t.title, замков: t.gates.length, ссылок: links.length, примеры: links.slice(0, 4) });

// Тема с хайдом bbCodeBlock--hide.
const h = await getThread(381008);
show('thread 381008 под сессией', {
  заголовок: h.title,
  замков: h.gates.length,
  тело: h.posts[0]?.body.slice(0, 500),
});
