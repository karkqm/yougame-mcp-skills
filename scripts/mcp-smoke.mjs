// Проверка MCP-обвязки: поднимает сервер по stdio и дёргает инструменты.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'] });
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('Инструменты:', tools.tools.map((t) => t.name).join(', '));

const guide = await client.callTool({ name: 'yg_guide', arguments: { topic: 'workflow' } });
console.log('\nyg_guide (первые строки):\n' + guide.content[0].text.split('\n').slice(0, 6).join('\n'));

const forum = await client.callTool({ name: 'yg_forum', arguments: { forum: 853, limit: 2 } });
const parsed = JSON.parse(forum.content[0].text);
console.log('\nyg_forum:', parsed.forum.title, '| тем на странице:', parsed.threads.length, '| страниц:', parsed.pages);

const search = await client.callTool({ name: 'yg_search', arguments: { keywords: 'target hud' } });
console.log('\nyg_search isError =', search.isError);
console.log(search.content[0].text.split('\n').slice(0, 5).join('\n'));

const thread = await client.callTool({ name: 'yg_thread', arguments: { thread: 381008, firstPostOnly: true } });
const t = JSON.parse(thread.content[0].text);
console.log('\nyg_thread:', t.title, '| замков:', t.gates.length, '| подсказка:', t.подсказка);

const prompts = await client.listPrompts().catch(() => ({ prompts: [] }));
console.log('\nПромпты:', prompts.prompts.map((p) => p.name).join(', ') || '—');

await client.close();
