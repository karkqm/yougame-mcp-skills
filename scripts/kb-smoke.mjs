// Проверка базы знаний и гейта без похода на форум: node scripts/kb-smoke.mjs
// Работает на временной базе, реальный ~/.yougame-mcp/kb.json не трогает.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const kbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yg-kb-')), 'kb.json');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env, YOUGAME_KB_PATH: kbPath },
});
const client = new Client({ name: 'kb-smoke', version: '1.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  try {
    return { isError: res.isError, data: JSON.parse(text), text };
  } catch {
    return { isError: res.isError, data: null, text };
  }
};

const check = (label, condition, extra = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!condition) process.exitCode = 1;
};

const names = (await client.listTools()).tools.map((t) => t.name);
check('инструменты базы зарегистрированы', ['yg_plan', 'yg_note', 'yg_ready', 'yg_report', 'yg_tools', 'yg_kb_add_tool', 'yg_kb_search', 'yg_kb_export'].every((n) => names.includes(n)), names.length + ' шт.');

// 1. План по задаче про дампер.
const plan = await call('yg_plan', { task: 'напиши дампер классов для minecraft' });
check('домен опознан', plan.data?.domain?.id === 'minecraft-java', plan.data?.domain?.id);
check('задача в скоупе форума', plan.data?.inScope === true);
check('есть поисковые запросы', (plan.data?.searchQueries ?? []).length > 0, JSON.stringify(plan.data?.searchQueries?.slice(0, 3)));
check('из запросов вычищены служебные слова', !(plan.data?.searchQueries ?? []).some((q) => /напиши/i.test(q)), plan.data?.searchQueries?.[0]);
check('тип задачи — реализация', plan.data?.taskKind === 'implement', plan.data?.taskKind);
check('предложены готовые инструменты', (plan.data?.готовыеИнструменты ?? []).length > 0, (plan.data?.готовыеИнструменты ?? []).length + ' шт.');
const sessionId = plan.data?.sessionId;
check('открыта сессия', Boolean(sessionId), sessionId);

// 2. Гейт закрыт, пока ресерча нет.
const early = await call('yg_ready', { sessionId });
check('гейт не пускает без ресерча', early.data?.ready === false, (early.data?.missing ?? []).map((m) => m.id).join(', '));

// 3. Каталог инструментов.
const dumpers = await call('yg_tools', { domain: 'minecraft-java', kind: 'dumper' });
check('каталог отдаёт дамперы для JVM', (dumpers.data?.изКаталога ?? []).length > 0, (dumpers.data?.изКаталога ?? []).map((t) => t.id).join(', '));

// 4. Набираем ресерч.
await call('yg_note', {
  sessionId,
  kind: 'fact',
  text: 'ClassFileTransformer видит байткод каждого загружаемого класса',
  sources: [{ url: 'https://yougame.biz/threads/1/', kind: 'theory', commentsRead: true }],
});
await call('yg_note', {
  sessionId,
  kind: 'version',
  text: 'Примеры в разделе только под 1.16.5, под 1.21 готового нет',
  sources: [{ url: 'https://yougame.biz/threads/2/', kind: 'code' }],
});
const gated = await call('yg_ready', { sessionId, toolIds: ['java-agent'] });
check('гейт открылся после ресерча', gated.data?.ready === true, gated.data?.verdict?.slice(0, 60));

// 5. Отчёт.
const report = await call('yg_report', { sessionId });
check('в отчёте два источника', (report.data?.источники ?? []).length === 2);
check('в отчёте есть инструмент', (report.data?.инструменты ?? []).includes('java-agent'));

// 6. Пользовательский инструмент попадает в базу и в поиск.
await call('yg_kb_add_tool', {
  name: 'Smoke Dumper',
  kind: 'dumper',
  domains: ['minecraft-java'],
  summary: 'Тестовая запись из смоука',
  sources: [{ url: 'https://yougame.biz/threads/3/' }],
});
const found = await call('yg_kb_search', { query: 'smoke dumper' });
check('добавленный инструмент ищется', (found.data?.инструменты ?? []).some((t) => t.id === 'smoke-dumper'));

// 7. force требует причину.
const plan2 = await call('yg_plan', { task: 'сделай esp для cs2' });
check('второй домен опознан', plan2.data?.domain?.id === 'source-engine', plan2.data?.domain?.id);
const badForce = await call('yg_ready', { sessionId: plan2.data?.sessionId, force: true });
check('force без причины отклонён', badForce.isError === true);
const goodForce = await call('yg_ready', { sessionId: plan2.data?.sessionId, force: true, reason: 'смоук-тест' });
check('force с причиной проходит', goodForce.data?.ready === true, goodForce.data?.verdict?.slice(0, 50));

// 7b. Кириллица в определении домена и типа задачи.
const ru = await call('yg_plan', { task: 'найди исходник вх для юнити на моно' });
check('домен по кириллице опознан', ru.data?.domain?.id === 'unity-mono', ru.data?.domain?.id);
check('тип задачи — поиск', ru.data?.taskKind === 'find', ru.data?.taskKind);
const light = await call('yg_ready', {
  sessionId: ru.data?.sessionId,
  toolIds: ['dnspyex'],
});
check('для поиска гейт мягче', (light.data?.missing ?? []).length <= 1, JSON.stringify((light.data?.missing ?? []).map((m) => m.id)));

// 8. Задача не из домена форума.
const offtopic = await call('yg_plan', { task: 'напиши REST API на express для списка задач' });
check('обычная задача помечена вне скоупа', offtopic.data?.inScope === false, offtopic.data?.domain?.id);

// 9. Экспорт.
const exported = await call('yg_kb_export', { domain: 'unreal' });
check('экспорт markdown работает', exported.text.includes('Dumper-7'));

await client.close();
fs.rmSync(path.dirname(kbPath), { recursive: true, force: true });
console.log('\nБаза лежала в', kbPath, '(удалена)');
