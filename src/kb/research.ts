/**
 * Гейт «сначала ресерч».
 *
 * Здесь живут правила: сколько источников нужно набрать до написания кода,
 * что считается закрытым вопросом, и как честно выйти из гейта, если на форуме
 * действительно ничего нет. Гейт — не блокировка ради блокировки: он всегда
 * возвращает, чего именно не хватает и как это добрать, и умеет пропустить
 * с записанной причиной.
 */
import { CATALOG, filterCatalog, type CatalogTool } from './catalog.js';
import { buildQueries, COMMON_FORUMS, detectDomain, detectTaskKind, domainById, type Domain } from './domains.js';
import { listTools, notesOf, type KbNote, type KbSession, type KbTool } from './store.js';

export interface Requirement {
  id: string;
  /** Что должно быть сделано. */
  what: string;
  ok: boolean;
  /** Как закрыть, если не сделано. */
  how: string;
}

/** Требования зависят от типа задачи: «найди тему» не должно упираться в ресерч. */
export function requirements(session: KbSession, notes: KbNote[]): Requirement[] {
  const code = session.sources.filter((s) => s.kind === 'code');
  const theory = session.sources.filter((s) => s.kind === 'theory' || s.kind === 'discussion');
  const withComments = session.sources.filter((s) => s.commentsRead);
  const facts = notes.filter((n) => n.kind === 'fact' || n.kind === 'version');
  const gaps = notes.filter((n) => n.kind === 'gap');
  const toolDecision = session.toolIds.length > 0 || gaps.some((n) => /инструмент|tool/i.test(n.text));

  const light = session.taskKind === 'find' || session.taskKind === 'explore';

  const reqs: Requirement[] = [
    {
      id: 'sources',
      what: light ? 'Хотя бы один источник с форума прочитан' : 'Прочитано минимум два источника с форума',
      ok: session.sources.length >= (light ? 1 : 2) || gaps.length > 0,
      how: 'yg_search по запросам из yg_plan → yg_thread → yg_note с полем sources. Если поиск пуст — запиши это как yg_note kind="gap".',
    },
    {
      id: 'tooling',
      what: 'Решено, брать готовый инструмент или писать своё',
      ok: toolDecision,
      how: 'yg_tools по домену задачи. Подходит готовый — yg_note kind="fact" + укажи toolIds в yg_ready. Не подходит — yg_note kind="gap" с объяснением почему.',
    },
  ];

  if (!light) {
    reqs.push(
      {
        id: 'code-source',
        what: 'Есть источник с рабочим кодом или подтверждение, что его нет',
        ok: code.length >= 1 || gaps.length > 0,
        how: 'Ищи в разделах «Исходники …» и по префиксу «Исходник»; помечай источник kind="code" в yg_note.',
      },
      {
        id: 'comments',
        what: 'У хотя бы одного источника прочитаны комментарии',
        ok: withComments.length >= 1 || gaps.length > 0,
        how: 'yg_thread без firstPostOnly — в комментариях лежат фиксы и «не работает на версии X». Помечай commentsRead: true.',
      },
      {
        id: 'facts',
        what: 'Записаны конкретные факты: версии, ограничения, механика',
        ok: facts.length >= 1,
        how: 'yg_note kind="fact" или kind="version" по каждому пункту из mustKnow сессии.',
      },
    );
  }

  // Неиспользованная переменная theory нужна только для читаемости выше — не считаем её отдельным требованием.
  void theory;
  return reqs;
}

export interface Readiness {
  ready: boolean;
  taskKind: string;
  domain: string;
  passed: string[];
  missing: Requirement[];
  mustKnow: string[];
  sourcesRead: number;
  notesTaken: number;
  verdict: string;
}

export function evaluate(session: KbSession): Readiness {
  const notes = notesOf(session.id);
  const reqs = requirements(session, notes);
  const missing = reqs.filter((r) => !r.ok);
  const forced = Boolean(session.override);
  const ready = missing.length === 0 || forced;
  return {
    ready,
    taskKind: session.taskKind,
    domain: session.domain,
    passed: reqs.filter((r) => r.ok).map((r) => r.what),
    missing,
    mustKnow: session.mustKnow,
    sourcesRead: session.sources.length,
    notesTaken: notes.length,
    verdict: ready
      ? forced
        ? `Гейт пройден принудительно: ${session.override?.reason}. В ответе пользователю честно скажи, что ресерч неполный.`
        : 'Ресерч закрыт — можно писать код. Начни ответ со списка источников, потом решение.'
      : 'Ресерч не закрыт — сначала добери недостающее, потом пиши код. Если форум действительно пуст, зафиксируй это через yg_note kind="gap" или вызови yg_ready с force и причиной.',
  };
}

export interface Plan {
  sessionId: string;
  inScope: boolean;
  domain: { id: string; title: string };
  alsoCheck: Array<{ id: string; title: string }>;
  taskKind: string;
  mustKnow: string[];
  searchQueries: string[];
  theoryForums: number[];
  codeForums: number[];
  готовыеИнструменты: Array<Record<string, unknown>>;
  ужеВБазе: Array<Record<string, unknown>>;
  шаги: string[];
}

function toolCard(t: CatalogTool | KbTool, source: 'каталог' | 'база'): Record<string, unknown> {
  return {
    id: t.id,
    название: t.name,
    вид: t.kind,
    язык: t.lang,
    ссылка: t.url,
    что: t.summary,
    заметки: t.notes,
    откуда: source,
  };
}

/** Всё, что нужно знать перед началом: домен, запросы, разделы, готовые инструменты. */
export function buildPlan(task: string, session: KbSession, domainOverride?: string): Plan {
  const guess = detectDomain(task);
  const domain: Domain = (domainOverride ? domainById(domainOverride) : undefined) ?? guess.domain;

  const catalogTools = filterCatalog({ domain: domain.id });
  const local = listTools().filter((t) => t.domains.includes(domain.id));
  const localMatches = listTools().filter(
    (t) => !local.includes(t) && session.queries.some((q) => `${t.name} ${t.summary}`.toLowerCase().includes(q.toLowerCase())),
  );

  return {
    sessionId: session.id,
    inScope: guess.inScope,
    domain: { id: domain.id, title: domain.title },
    alsoCheck: guess.also.map((d) => ({ id: d.id, title: d.title })),
    taskKind: session.taskKind,
    mustKnow: domain.mustKnow,
    searchQueries: session.queries,
    theoryForums: session.forumIds,
    codeForums: domain.codeForums,
    готовыеИнструменты: catalogTools.slice(0, 12).map((t) => toolCard(t, 'каталог')),
    ужеВБазе: [...local, ...localMatches].slice(0, 12).map((t) => toolCard(t, 'база')),
    шаги: [
      '1. Проверь, не решено ли это уже: yg_kb_search по ключевым словам задачи.',
      '2. Посмотри «готовыеИнструменты»: если задача закрывается существующим инструментом — не пиши свой, объясни как им пользоваться.',
      `3. Теория: yg_search type="thread" по searchQueries, forumIds=${JSON.stringify(session.forumIds)}, читай yg_thread firstPostOnly=true.`,
      `4. Техника: те же запросы по codeForums=${JSON.stringify(domain.codeForums)}, тему читай целиком вместе с комментариями.`,
      '5. Каждую находку клади в yg_note (kind: fact / version / pitfall / snippet / gap) со ссылкой на тему.',
      '6. yg_ready — проверка, что ресерч закрыт. Пока не ready — код не пиши.',
      '7. После реализации: yg_kb_add_tool на найденные инструменты и yg_report для итога.',
    ],
  };
}

/** Стартовые параметры сессии по тексту задачи. */
export function planInput(task: string, domainOverride?: string): {
  domain: Domain;
  taskKind: string;
  queries: string[];
  forumIds: number[];
  mustKnow: string[];
} {
  const guess = detectDomain(task);
  const domain: Domain = (domainOverride ? domainById(domainOverride) : undefined) ?? guess.domain;
  const taskKind = detectTaskKind(task);
  const forumIds = [...new Set([...domain.theoryForums, ...domain.codeForums, ...COMMON_FORUMS.theory])].slice(0, 14);
  return { domain, taskKind, queries: buildQueries(domain, task), forumIds, mustKnow: domain.mustKnow };
}

export interface Report {
  задача: string;
  домен: string;
  статус: string;
  источники: Array<Record<string, unknown>>;
  находки: Array<Record<string, unknown>>;
  инструменты: string[];
  пробелы: string[];
  готовность: Readiness;
}

export function buildReport(session: KbSession): Report {
  const notes = notesOf(session.id);
  return {
    задача: session.task,
    домен: session.domain,
    статус: session.status,
    источники: session.sources.map((s) => ({
      url: s.url,
      заголовок: s.title,
      тип: s.kind,
      комментарииПрочитаны: s.commentsRead ?? false,
      вывод: s.verdict,
    })),
    находки: notes
      .filter((n) => n.kind !== 'gap')
      .map((n) => ({ тип: n.kind, текст: n.text, источники: n.sources.map((s) => s.url) })),
    инструменты: session.toolIds,
    пробелы: notes.filter((n) => n.kind === 'gap').map((n) => n.text),
    готовность: evaluate(session),
  };
}

/** Выгрузка всей базы в markdown — для человека и для CLAUDE.md проекта. */
export function exportMarkdown(opts: { domain?: string } = {}): string {
  const local = listTools().filter((t) => !opts.domain || t.domains.includes(opts.domain));
  const builtin = CATALOG.filter((t) => !opts.domain || t.domains.includes(opts.domain));

  const byKind = new Map<string, Array<CatalogTool | KbTool>>();
  for (const t of [...builtin, ...local]) {
    const list = byKind.get(t.kind) ?? [];
    list.push(t);
    byKind.set(t.kind, list);
  }

  const lines: string[] = [
    '# База инструментов разработки',
    '',
    opts.domain ? `Домен: **${opts.domain}**.` : 'Все домены.',
    'Встроенный каталог + всё, что докладывалось через `yg_kb_add_tool`.',
    '',
  ];
  for (const [kind, tools] of [...byKind.entries()].sort()) {
    lines.push(`## ${kind}`, '');
    for (const t of tools) {
      const url = t.url ? ` — ${t.url}` : '';
      lines.push(`- **${t.name}**${t.lang ? ` (${t.lang})` : ''}${url}`);
      lines.push(`  - ${t.summary}`);
      if (t.notes) lines.push(`  - ${t.notes}`);
      lines.push(`  - домены: ${t.domains.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
