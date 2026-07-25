import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  authStatus,
  getCategories,
  getForum,
  getGenericPage,
  getPost,
  getThread,
  search,
  threadPath,
} from './api.js';
import { config } from './config.js';
import { AuthRequiredError, BrowserUnavailableError } from './errors.js';
import { clearJar } from './http/jar.js';
import { dropCache } from './http/client.js';
import { interactiveLogin } from './browser.js';
import { downloadResource } from './resources/download.js';
import { classify, HOSTS, instructionFor } from './resources/hosts.js';
import { WORKFLOW } from './workflow.js';
import { filterCatalog } from './kb/catalog.js';
import { DOMAINS } from './kb/domains.js';
import { buildPlan, buildReport, evaluate, exportMarkdown, planInput } from './kb/research.js';
import {
  addNote,
  addTool,
  attachTools,
  createSession,
  currentSession,
  getSession,
  listNotes,
  listSessions,
  listTools,
  stats,
  updateSession,
} from './kb/store.js';
import type { BodyGate } from './parse/body.js';

/** Подсказка модели по замкам: вход помогает не всегда. */
function gateHint(gates: BodyGate[]): string | undefined {
  if (!gates.length) return undefined;
  const kinds = new Set(gates.map((g) => g.kind));
  const parts: string[] = [];
  if (kinds.has('login') || kinds.has('hidden-link')) {
    parts.push('Часть содержимого скрыта от гостей — вызови yg_login и повтори вызов.');
  }
  if (kinds.has('reply')) {
    parts.push('Есть блоки, открывающиеся только после ответа в теме — попроси пользователя ответить, сам за него не пиши.');
  }
  if (kinds.has('posts') || kinds.has('reaction')) {
    parts.push('Есть блоки, требующие ранга аккаунта (сообщения/реакции) — скажи пользователю, что они недоступны.');
  }
  if (kinds.has('user-specific')) {
    parts.push('Есть «ответы с хайдом», адресованные конкретным пользователям, — их не откроет ни вход, ни ответ, пропусти их.');
  }
  return parts.join(' ') || undefined;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Единая обработка ошибок: авторизация, браузер, сеть. */
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return fail(
        [
          'AUTH_REQUIRED — форум требует входа.',
          `Что закрыто: ${err.target}`,
          `Причина: ${err.message}`,
          '',
          'Действие: скажи пользователю, что нужен вход, и вызови инструмент yg_login —',
          'откроется настоящее окно браузера со страницей входа yougame.biz.',
          'После входа куки сохранятся сами, повтори прерванный вызов.',
        ].join('\n'),
      );
    }
    if (err instanceof BrowserUnavailableError) {
      return fail(`BROWSER_UNAVAILABLE — ${err.message}`);
    }
    return fail(`ERROR — ${(err as Error).message}`);
  }
}

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Инструкция для модели
  // -------------------------------------------------------------------------
  server.registerTool(
    'yg_guide',
    {
      title: 'Как работать с форумом',
      description:
        'Вернуть рабочий регламент: лестница решений (что сделать до написания кода), порядок ресерча, карта разделов, правила по хайдам, таблица файлообменников и каталог инструментов. Вызывай ПЕРВЫМ, если задача связана с yougame.biz или с разработкой читов/модов/дамперов.',
      inputSchema: {
        topic: z
          .enum(['all', 'ladder', 'workflow', 'hosts', 'gates', 'tools'])
          .optional()
          .describe(
            'ladder — лестница решений до написания кода, workflow — порядок ресерча, hosts — файлообменники, gates — хайды и доступ, tools — каталог инструментов, all — всё',
          ),
      },
    },
    async ({ topic }) =>
      guard(async () => {
        const t = topic ?? 'all';
        if (t === 'hosts') {
          return ok(HOSTS.map((h) => ({ хостинг: h.name, стратегия: h.strategy, инструкция: h.instruction })));
        }
        if (t === 'gates') return ok(WORKFLOW.gates);
        if (t === 'workflow') return ok(WORKFLOW.workflow);
        if (t === 'ladder') return ok(WORKFLOW.ladder);
        if (t === 'tools') return ok(WORKFLOW.toolbase);
        return ok(`${WORKFLOW.ladder}\n\n${WORKFLOW.workflow}\n\n${WORKFLOW.gates}\n\n${WORKFLOW.hostsTable}`);
      }),
  );

  // -------------------------------------------------------------------------
  // Авторизация
  // -------------------------------------------------------------------------
  server.registerTool(
    'yg_auth_status',
    {
      title: 'Статус авторизации',
      description: 'Проверить, видит ли форум нашу сессию: логин, id пользователя, наличие сохранённых кук.',
      inputSchema: {},
    },
    async () => guard(async () => ok(await authStatus())),
  );

  server.registerTool(
    'yg_login',
    {
      title: 'Войти на форум',
      description:
        'Открыть настоящее окно браузера со страницей входа yougame.biz и дождаться ручного входа пользователя (пароль, капча, 2FA). После входа куки сохраняются на диск и используются всеми остальными инструментами. Вызывай, когда получен AUTH_REQUIRED или встречен хайд.',
      inputSchema: {
        timeoutSec: z.number().int().min(30).max(1800).optional().describe('Сколько ждать завершения входа, сек (по умолчанию 300).'),
        keepOpen: z.boolean().optional().describe('Не закрывать окно браузера после входа.'),
      },
    },
    async ({ timeoutSec, keepOpen }) =>
      guard(async () => {
        const result = await interactiveLogin({ timeoutSec, keepOpen });
        dropCache();
        const status = result.loggedIn ? await authStatus() : null;
        return ok({ ...result, status });
      }),
  );

  server.registerTool(
    'yg_logout',
    {
      title: 'Забыть сессию',
      description: 'Удалить сохранённые куки форума с диска.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        clearJar();
        dropCache();
        return ok({ ok: true, message: 'Куки удалены: ' + config.cookiesPath });
      }),
  );

  // -------------------------------------------------------------------------
  // Навигация
  // -------------------------------------------------------------------------
  server.registerTool(
    'yg_categories',
    {
      title: 'Категории и разделы',
      description:
        'Дерево форума: категории → разделы → подразделы, со статистикой и последней темой. Без аргументов — с главной страницы; с root — содержимое конкретной категории/раздела.',
      inputSchema: {
        root: z.union([z.number(), z.string()]).optional().describe('id узла (873), путь (/categories/731/) или полный URL.'),
        withStats: z.boolean().optional().describe('Оставить счётчики тем и сообщений (по умолчанию да).'),
      },
    },
    async ({ root, withStats }) =>
      guard(async () => {
        const tree = await getCategories(root);
        if (withStats === false) {
          for (const c of tree.categories) for (const n of c.nodes) Object.assign(n, { threads: undefined, messages: undefined });
        }
        return ok(tree);
      }),
  );

  server.registerTool(
    'yg_forum',
    {
      title: 'Список тем раздела',
      description:
        'Темы раздела с пагинацией, префиксами, авторами, количеством ответов и просмотров. Возвращает также подразделы, если они есть.',
      inputSchema: {
        forum: z.union([z.number(), z.string()]).describe('id раздела (853), путь (/forums/853/) или полный URL.'),
        page: z.number().int().min(1).optional(),
        prefixId: z.number().int().optional().describe('Фильтр по префиксу темы.'),
        order: z
          .enum(['last_post_date', 'post_date', 'reply_count', 'view_count', 'first_post_reaction_score'])
          .optional()
          .describe('Сортировка списка тем.'),
        direction: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Сколько тем вернуть (по умолчанию все со страницы).'),
      },
    },
    async ({ forum, page, prefixId, order, direction, limit }) =>
      guard(async () => {
        const data = await getForum(forum, { page, prefixId, order, direction });
        if (limit) data.threads = data.threads.slice(0, limit);
        return ok(data);
      }),
  );

  server.registerTool(
    'yg_thread',
    {
      title: 'Читать тему (статью) и комментарии',
      description:
        'Полный разбор темы: заголовок, теги, краткое описание ИИ-агента форума, первый пост (статья) и комментарии в markdown, блоки кода, вложения, внешние ссылки и замки (хайды). Хайд помечается 🔒 — тогда нужен yg_login.',
      inputSchema: {
        thread: z.union([z.number(), z.string()]).describe('id темы (385534), путь (/threads/385534/) или полный URL.'),
        page: z.number().int().min(1).optional(),
        allPages: z.boolean().optional().describe('Прочитать несколько страниц подряд.'),
        maxPages: z.number().int().min(1).max(20).optional().describe('Лимит страниц при allPages (по умолчанию 5).'),
        firstPostOnly: z.boolean().optional().describe('Вернуть только стартовый пост — саму статью, без комментариев.'),
        includeCode: z.boolean().optional().describe('Оставить массив блоков кода отдельным полем (по умолчанию да).'),
      },
    },
    async ({ thread, page, allPages, maxPages, firstPostOnly, includeCode }) =>
      guard(async () => {
        const data = await getThread(thread, { page, allPages, maxPages });
        if (firstPostOnly) data.posts = data.posts.filter((p) => p.isFirst).slice(0, 1);
        if (includeCode === false) for (const p of data.posts) p.code = [];

        const downloadable = data.posts.flatMap((p) => [
          ...p.attachments.map((a) => a.url).filter(Boolean),
          ...p.links.filter((l) => !l.internal && (classify(l.url).host || classify(l.url).looksDirect)).map((l) => l.url),
        ]);

        return ok({
          ...data,
          подсказка: gateHint(data.gates),
          ресурсыДляСкачивания: [...new Set(downloadable)].slice(0, 50),
        });
      }),
  );

  server.registerTool(
    'yg_post',
    {
      title: 'Одно сообщение',
      description: 'Получить конкретное сообщение по его id (/posts/<id>/) вместе с контекстом темы.',
      inputSchema: { postId: z.union([z.number(), z.string()]).describe('id сообщения.') },
    },
    async ({ postId }) => guard(async () => ok(await getPost(postId))),
  );

  server.registerTool(
    'yg_search',
    {
      title: 'Поиск по форуму',
      description:
        'Поиск XenForo по темам и сообщениям с фильтрами по разделам, автору и дате. Требует авторизации: гостям поиск закрыт.',
      inputSchema: {
        keywords: z.string().min(2).describe('Поисковый запрос.'),
        type: z.enum(['thread', 'post']).optional().describe('thread — искать темы по заголовкам, post — сообщения.'),
        titleOnly: z.boolean().optional(),
        forumIds: z.array(z.number().int()).optional().describe('Ограничить разделами (id узлов).'),
        childNodes: z.boolean().optional().describe('Включая подразделы (по умолчанию да).'),
        author: z.string().optional(),
        newerThan: z.string().optional().describe('Не старше даты, формат YYYY-MM-DD.'),
        order: z.enum(['relevance', 'date', 'replies']).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async (args) => guard(async () => ok(await search(args))),
  );

  server.registerTool(
    'yg_page',
    {
      title: 'Произвольная страница форума',
      description: 'Загрузить любую страницу форума (например /pages/... или профиль) и вернуть её текст в markdown.',
      inputSchema: { path: z.string().describe('Путь или полный URL страницы.') },
    },
    async ({ path }) => guard(async () => ok(await getGenericPage(path))),
  );

  // -------------------------------------------------------------------------
  // Ресурсы и загрузки
  // -------------------------------------------------------------------------
  server.registerTool(
    'yg_resources',
    {
      title: 'Ресурсы темы',
      description:
        'Собрать из темы всё, что можно скачать: вложения форума и внешние ссылки на файлообменники. Для каждой ссылки возвращается хостинг и инструкция, как её качать.',
      inputSchema: {
        thread: z.union([z.number(), z.string()]).describe('id темы, путь или URL.'),
        allPages: z.boolean().optional().describe('Просмотреть несколько страниц темы.'),
        maxPages: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ thread, allPages, maxPages }) =>
      guard(async () => {
        const data = await getThread(thread, { allPages, maxPages });
        const seen = new Set<string>();
        const resources: Array<Record<string, unknown>> = [];

        for (const post of data.posts) {
          for (const att of post.attachments) {
            if (!att.url || seen.has(att.url)) continue;
            seen.add(att.url);
            resources.push({
              тип: 'вложение форума',
              имя: att.name,
              размер: att.size,
              url: att.url,
              пост: post.number,
              автор: post.author,
              инструкция: instructionFor(att.url),
            });
          }
          for (const link of post.links) {
            if (link.internal || seen.has(link.url)) continue;
            const { host, looksDirect } = classify(link.url);
            if (!host && !looksDirect) continue;
            seen.add(link.url);
            resources.push({
              тип: host?.name ?? 'внешняя ссылка',
              имя: link.text,
              url: link.url,
              стратегия: host?.strategy ?? (looksDirect ? 'direct' : 'unknown'),
              пост: post.number,
              автор: post.author,
              инструкция: instructionFor(link.url),
            });
          }
        }

        return ok({
          тема: { id: data.id, заголовок: data.title, url: data.url },
          замки: data.gates,
          подсказка: gateHint(data.gates),
          ресурсы: resources,
        });
      }),
  );

  server.registerTool(
    'yg_download',
    {
      title: 'Скачать ресурс',
      description:
        'Скачать вложение форума или файл с внешнего файлообменника. Хостинг определяется автоматически (Dropbox, WorkUpload, MEGA, Google Drive, Яндекс.Диск, MediaFire, Pixeldrain, GitHub и др.); при неудаче используется резервный запуск браузера. Возвращает путь к файлу, размер и sha256.',
      inputSchema: {
        url: z.string().url().describe('Ссылка на файл: /attachments/<id>/ форума или внешний хостинг.'),
        destDir: z.string().optional().describe(`Каталог сохранения (по умолчанию ${config.downloadDir}).`),
        browser: z.boolean().optional().describe('Сразу качать через браузер (MEGA, Gofile, капча).'),
        headless: z.boolean().optional().describe('Скрытое окно браузера при резервном режиме (по умолчанию окно видно).'),
        maxMB: z.number().int().min(1).max(8192).optional().describe('Лимит размера файла, МБ.'),
      },
    },
    async ({ url, destDir, browser, headless, maxMB }) =>
      guard(async () => {
        const result = await downloadResource(url, {
          destDir,
          browser,
          headless,
          maxBytes: maxMB ? maxMB * 1024 * 1024 : undefined,
        });
        if (!result.ok) {
          return fail(
            [
              `Не удалось скачать: ${result.url}`,
              `Хостинг: ${result.host ?? 'неизвестен'}`,
              result.error ? `Ошибка: ${result.error}` : '',
              `Что делать: ${result.instruction}`,
            ]
              .filter(Boolean)
              .join('\n'),
          );
        }
        return ok(result);
      }),
  );

  // -------------------------------------------------------------------------
  // База знаний и гейт «сначала ресерч»
  // -------------------------------------------------------------------------
  server.registerTool(
    'yg_plan',
    {
      title: 'План работы до написания кода',
      description:
        'ВЫЗЫВАЙ ПЕРВЫМ для любой задачи про читы, моды, дамперы, инжекторы, оффсеты, реверс и игровые скрипты — до того, как начал писать код. Определяет домен задачи, отдаёт готовые поисковые запросы, id разделов форума, список уже существующих инструментов (свой писать может быть не нужно) и открывает сессию ресерча. Возвращает sessionId для yg_note / yg_ready / yg_report.',
      inputSchema: {
        task: z.string().min(3).describe('Задача пользователя своими словами, как он её поставил.'),
        domain: z
          .string()
          .optional()
          .describe(`Домен вручную, если автоопределение промахнулось: ${DOMAINS.map((d) => d.id).join(', ')}, generic.`),
      },
    },
    async ({ task, domain }) =>
      guard(async () => {
        const input = planInput(task, domain);
        const session = createSession({
          task,
          domain: input.domain.id,
          taskKind: input.taskKind,
          queries: input.queries,
          forumIds: input.forumIds,
          mustKnow: input.mustKnow,
        });
        const plan = buildPlan(task, session, domain);
        return ok({
          ...plan,
          примечание: plan.inScope
            ? 'Задача из домена форума: пройди лестницу решений (yg_guide topic="ladder") до написания кода.'
            : 'Задача, похоже, не из мира yougame — ресерч по форуму не нужен, работай обычным порядком. Если считаешь иначе, продолжай по плану.',
        });
      }),
  );

  server.registerTool(
    'yg_note',
    {
      title: 'Записать находку',
      description:
        'Зафиксировать результат ресерча: факт, версию, подводный камень, кусок кода или пробел («на форуме этого нет»). Записи копятся в локальной базе и учитываются гейтом yg_ready. Указывай источники — без них находка не засчитывается.',
      inputSchema: {
        text: z.string().min(3).describe('Сама находка, конкретно и своими словами.'),
        kind: z
          .enum(['fact', 'version', 'pitfall', 'snippet', 'gap'])
          .describe('fact — механика/факт, version — версии и совместимость, pitfall — грабли, snippet — код, gap — чего на форуме нет.'),
        sessionId: z.string().optional().describe('Id сессии из yg_plan. Без него берётся последняя открытая.'),
        sources: z
          .array(
            z.object({
              url: z.string().describe('Ссылка на тему/сообщение форума или внешний источник.'),
              title: z.string().optional(),
              kind: z.enum(['theory', 'code', 'discussion', 'external']).optional().describe('Что это за источник.'),
              commentsRead: z.boolean().optional().describe('Прочитаны ли комментарии темы.'),
              verdict: z.string().optional().describe('Короткий вывод: пригодилось / устарело / сломано.'),
            }),
          )
          .optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ text, kind, sessionId, sources, tags }) =>
      guard(async () => {
        const session = sessionId ? getSession(sessionId) : currentSession();
        const note = addNote({
          kind,
          text,
          sessionId: session?.id,
          domain: session?.domain,
          sources: sources ?? [],
          tags: tags ?? [],
        });
        const readiness = session ? evaluate(session) : undefined;
        return ok({
          записано: note.id,
          сессия: session?.id ?? null,
          предупреждение: sources?.length ? undefined : 'Находка без источника — для гейта она почти ничего не весит.',
          готовность: readiness,
        });
      }),
  );

  server.registerTool(
    'yg_ready',
    {
      title: 'Можно ли уже писать код',
      description:
        'Гейт: проверяет, закрыт ли ресерч по текущей задаче. Пока ready=false, код писать рано — в ответе список недостающего и как его добрать. Если на форуме по теме действительно ничего нет, зафиксируй это через yg_note kind="gap" или пройди с force и причиной (причина попадёт в отчёт и её надо озвучить пользователю).',
      inputSchema: {
        sessionId: z.string().optional().describe('Id сессии из yg_plan. Без него берётся последняя открытая.'),
        toolIds: z.array(z.string()).optional().describe('Инструменты, на которые решено опереться (id из yg_tools).'),
        force: z.boolean().optional().describe('Пройти гейт принудительно. Требует reason.'),
        reason: z.string().optional().describe('Почему ресерч закрывать нечем: пусто на форуме, закрытые разделы, срочность.'),
      },
    },
    async ({ sessionId, toolIds, force, reason }) =>
      guard(async () => {
        const session = sessionId ? getSession(sessionId) : currentSession();
        if (!session) {
          return fail('Нет открытой сессии ресерча. Начни с yg_plan — он определит домен задачи и выдаст план.');
        }
        if (toolIds?.length) attachTools(session.id, toolIds);
        if (force) {
          if (!reason) return fail('force без reason не принимается: напиши, почему ресерч закрыть нечем.');
          updateSession(session.id, { override: { reason, at: new Date().toISOString() } });
        }
        const fresh = getSession(session.id)!;
        const readiness = evaluate(fresh);
        if (readiness.ready && fresh.status === 'open') updateSession(fresh.id, { status: 'ready' });
        return ok(readiness);
      }),
  );

  server.registerTool(
    'yg_report',
    {
      title: 'Итог ресерча',
      description:
        'Собрать отчёт по сессии: источники со ссылками, находки, выбранные инструменты и пробелы. Показывай его пользователю перед решением — это тот самый список «на чём основан вывод».',
      inputSchema: {
        sessionId: z.string().optional(),
        close: z.boolean().optional().describe('Закрыть сессию как выполненную.'),
      },
    },
    async ({ sessionId, close }) =>
      guard(async () => {
        const session = sessionId ? getSession(sessionId) : currentSession();
        if (!session) return fail('Нет сессии ресерча. Начни с yg_plan.');
        const report = buildReport(session);
        if (close) updateSession(session.id, { status: 'done' });
        return ok(report);
      }),
  );

  server.registerTool(
    'yg_tools',
    {
      title: 'Каталог инструментов разработки',
      description:
        'База инструментов: дамперы, декомпиляторы, деобфускаторы, инжекторы, хук-библиотеки, модлоадеры, генераторы SDK, маппинги, работа с памятью. Смотри ДО того, как писать своё: чаще всего нужное уже написано. Отдаёт встроенный каталог вместе с тем, что докладывалось через yg_kb_add_tool.',
      inputSchema: {
        domain: z.string().optional().describe(`Домен: ${DOMAINS.map((d) => d.id).join(', ')}.`),
        kind: z
          .enum([
            'dumper',
            'decompiler',
            'disassembler',
            'deobfuscator',
            'debugger',
            'injector',
            'hook',
            'loader',
            'sdk-gen',
            'mapping',
            'memory',
            'analysis',
            'network',
            'render',
            'build',
          ])
          .optional()
          .describe('Вид инструмента.'),
        query: z.string().optional().describe('Свободный поиск по названию и описанию.'),
      },
    },
    async ({ domain, kind, query }) =>
      guard(async () => {
        const builtin = filterCatalog({ domain, kind, query });
        const q = query?.toLowerCase();
        const local = listTools().filter((t) => {
          if (domain && !t.domains.includes(domain)) return false;
          if (kind && t.kind !== kind) return false;
          if (q && !`${t.name} ${t.summary} ${t.notes ?? ''}`.toLowerCase().includes(q)) return false;
          return true;
        });
        if (!builtin.length && !local.length) {
          return ok({
            найдено: 0,
            подсказка:
              'В каталоге пусто по этому фильтру. Поищи инструмент на форуме (yg_search), а найденный добавь через yg_kb_add_tool — в следующий раз он будет здесь.',
            доступныеДомены: DOMAINS.map((d) => ({ id: d.id, о: d.title })),
          });
        }
        return ok({
          изКаталога: builtin.map((t) => ({
            id: t.id,
            название: t.name,
            вид: t.kind,
            язык: t.lang,
            ссылка: t.url,
            что: t.summary,
            заметки: t.notes,
            домены: t.domains,
          })),
          изБазы: local.map((t) => ({
            id: t.id,
            название: t.name,
            вид: t.kind,
            ссылка: t.url,
            что: t.summary,
            заметки: t.notes,
            источники: t.sources.map((s) => s.url),
          })),
          напоминание: 'Если задача закрывается готовым инструментом — не пиши свой, объясни как им пользоваться.',
        });
      }),
  );

  server.registerTool(
    'yg_kb_add_tool',
    {
      title: 'Добавить инструмент в базу',
      description:
        'Записать найденный на форуме или в сети инструмент, чтобы он попадал в выдачу yg_tools в следующих сессиях. Повторное добавление с тем же именем обновляет запись.',
      inputSchema: {
        name: z.string().min(2),
        kind: z
          .enum([
            'dumper',
            'decompiler',
            'disassembler',
            'deobfuscator',
            'debugger',
            'injector',
            'hook',
            'loader',
            'sdk-gen',
            'mapping',
            'memory',
            'analysis',
            'network',
            'render',
            'build',
          ])
          .describe('Вид инструмента.'),
        domains: z.array(z.string()).min(1).describe(`Домены: ${DOMAINS.map((d) => d.id).join(', ')}.`),
        summary: z.string().min(5).describe('Одной строкой: что делает.'),
        lang: z.string().optional(),
        url: z.string().optional(),
        notes: z.string().optional().describe('Когда брать и обо что спотыкаются.'),
        tags: z.array(z.string()).optional(),
        sources: z
          .array(z.object({ url: z.string(), title: z.string().optional() }))
          .optional()
          .describe('Темы форума, где о нём говорят.'),
      },
    },
    async (args) =>
      guard(async () => {
        const { tool, created } = addTool({ ...args, sources: args.sources ?? [] });
        const session = currentSession();
        if (session) attachTools(session.id, [tool.id]);
        return ok({ [created ? 'добавлено' : 'обновлено']: tool.id, инструмент: tool, база: stats() });
      }),
  );

  server.registerTool(
    'yg_kb_search',
    {
      title: 'Поиск по локальной базе',
      description:
        'Проверить, не решалась ли эта задача раньше: инструменты, находки и прошлые сессии из локальной базы. Быстрее форума и работает без сети — вызывай до yg_search.',
      inputSchema: {
        query: z.string().min(2).describe('Ключевые слова задачи.'),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) =>
      guard(async () => {
        const q = query.toLowerCase();
        const cap = limit ?? 10;
        const hit = (s: string) => s.toLowerCase().includes(q);
        const tools = listTools().filter((t) => hit(`${t.name} ${t.summary} ${t.notes ?? ''} ${t.tags.join(' ')}`));
        const builtin = filterCatalog({ query });
        const notes = listNotes().filter((n) => hit(`${n.text} ${n.tags.join(' ')}`));
        const sessions = listSessions(100).filter((s) => hit(s.task));
        return ok({
          инструменты: [
            ...builtin.map((t) => ({ id: t.id, название: t.name, вид: t.kind, что: t.summary, ссылка: t.url, откуда: 'каталог' })),
            ...tools.map((t) => ({ id: t.id, название: t.name, вид: t.kind, что: t.summary, ссылка: t.url, откуда: 'база' })),
          ].slice(0, cap),
          находки: notes.slice(-cap).map((n) => ({ тип: n.kind, текст: n.text, источники: n.sources.map((s) => s.url) })),
          прошлыеСессии: sessions.slice(0, cap).map((s) => ({
            id: s.id,
            задача: s.task,
            домен: s.domain,
            статус: s.status,
            источников: s.sources.length,
          })),
          база: stats(),
        });
      }),
  );

  server.registerTool(
    'yg_kb_export',
    {
      title: 'Выгрузить базу инструментов',
      description: 'Отдать каталог инструментов в markdown — положить в документацию проекта или показать пользователю.',
      inputSchema: {
        domain: z.string().optional().describe('Ограничить одним доменом.'),
        path: z.string().optional().describe('Записать в файл по этому пути вместо возврата текстом.'),
      },
    },
    async ({ domain, path: outPath }) =>
      guard(async () => {
        const md = exportMarkdown({ domain });
        if (!outPath) return ok(md);
        const fs = await import('node:fs');
        const nodePath = await import('node:path');
        fs.mkdirSync(nodePath.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, md, 'utf8');
        return ok({ записано: outPath, размер: md.length });
      }),
  );

  // -------------------------------------------------------------------------
  // Готовый сценарий ресерча
  // -------------------------------------------------------------------------
  server.registerPrompt?.(
    'yougame_research',
    {
      title: 'Ресерч по форуму перед реализацией',
      description: 'Регламент: сначала теория (гайды), потом техника (код и исходники), потом реализация задачи пользователя.',
      argsSchema: { task: z.string().describe('Что просит пользователь.') },
    },
    ({ task }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `${WORKFLOW.ladder}\n\n${WORKFLOW.workflow}\n\nЗадача пользователя: ${task}\n\nНачни с yg_plan — он определит домен, выдаст запросы и покажет уже существующие инструменты. Дальше по лестнице: локальная база → каталог инструментов → форум → yg_ready → код.`,
          },
        },
      ],
    }),
  );
}

export { threadPath };
