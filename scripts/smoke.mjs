// Прогон парсеров по живому форуму без MCP-обвязки: node scripts/smoke.mjs
import { getCategories, getForum, getThread, authStatus } from '../dist/api.js';
import { classify, instructionFor } from '../dist/resources/hosts.js';

const show = (label, value) => console.log(`\n=== ${label} ===\n` + JSON.stringify(value, null, 2).slice(0, 2200));

const status = await authStatus();
show('auth', status);

const cats = await getCategories();
show('categories (первые 2)', {
  всего: cats.categories.length,
  примеры: cats.categories.slice(0, 2).map((c) => ({
    категория: c.title,
    id: c.id,
    разделов: c.nodes.length,
    первый: c.nodes[0] && { id: c.nodes[0].id, title: c.nodes[0].title, темы: c.nodes[0].threads, подфорумы: c.nodes[0].subForums.length },
  })),
});

const forum = await getForum(873);
show('forum 873', {
  заголовок: forum.forum.title,
  подразделов: forum.subNodes.length,
  примерПодраздела: forum.subNodes[0],
  тем: forum.threads.length,
  страниц: forum.pages,
});

const leaf = await getForum(853);
show('forum 853', {
  заголовок: leaf.forum.title,
  страниц: leaf.pages,
  тем: leaf.threads.length,
  первые3: leaf.threads.slice(0, 3),
});

const threadId = leaf.threads.find((t) => !t.sticky)?.id ?? 385534;
const thread = await getThread(threadId);
show('thread ' + threadId, {
  заголовок: thread.title,
  префикс: thread.prefix,
  теги: thread.tags,
  aiSummary: thread.aiSummary,
  страниц: thread.pages,
  постов: thread.posts.length,
  замки: thread.gates,
  первыйПост: thread.posts[0] && {
    автор: thread.posts[0].author,
    номер: thread.posts[0].number,
    дата: thread.posts[0].postedAt,
    вложения: thread.posts[0].attachments,
    ссылки: thread.posts[0].links.slice(0, 5),
    блоковКода: thread.posts[0].code.length,
    тело: thread.posts[0].body.slice(0, 600),
  },
  комментарий: thread.posts[1] && { автор: thread.posts[1].author, тело: thread.posts[1].body.slice(0, 200) },
});

// Тема с хайдом (проверяем детект замка гостем).
const hidden = await getThread(381008);
show('thread 381008 (хайд)', {
  заголовок: hidden.title,
  замки: hidden.gates,
  телоПервого: hidden.posts[0]?.body.slice(0, 300),
});

show('классификация ссылок', [
  'https://www.dropbox.com/scl/fi/ri2ugevfbdembdh6pa9wz/nedofix.rar?rlkey=zqbtp7ky7druuksin27&dl=0',
  'https://workupload.com/file/abc123',
  'https://mega.nz/file/xxx#key',
  'https://yougame.biz/attachments/342508/',
].map((u) => ({ url: u, ...classify(u), host: classify(u).host?.id ?? null, инструкция: instructionFor(u).slice(0, 90) })));
