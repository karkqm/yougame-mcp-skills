#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { registerTools } from './tools.js';

const server = new McpServer(
  { name: 'yougame', version: '0.1.0' },
  {
    instructions: [
      'Доступ к форуму разработчиков yougame.biz (XenForo) плюс база знаний и гейт «сначала ресерч».',
      'Если задача про читы, моды, дамперы, инжекторы, оффсеты, реверс или игровые скрипты —',
      'начинай с yg_plan: он определит домен, выдаст поисковые запросы и покажет уже существующие',
      'инструменты, чтобы не писать своё там, где готовое есть. Дальше по лестнице (yg_guide topic="ladder"):',
      'yg_kb_search → yg_tools → yg_search/yg_thread → yg_note на каждую находку → yg_ready → код → yg_report.',
      'Навигация: yg_categories → yg_forum → yg_thread. Поиск: yg_search (нужен вход).',
      'Скачивание: yg_resources → yg_download.',
      'Если инструмент вернул AUTH_REQUIRED или в тексте встретился знак 🔒 — вызови yg_login:',
      'откроется окно браузера, пользователь войдёт сам, сессия сохранится.',
    ].join(' '),
  },
);

registerTools(server);

async function main(): Promise<void> {
  // stdout занят протоколом MCP — любая диагностика только в stderr.
  process.stderr.write(`[yougame-mcp] base=${config.baseUrl} home=${config.home}\n`);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[yougame-mcp] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
