#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { registerTools } from './tools.js';
import { registerUcTools } from './uc/tools.js';
import { ucConfig } from './uc/config.js';

const server = new McpServer(
  { name: 'yougame', version: '0.2.0' },
  {
    instructions: [
      'Доступ к форумам разработчиков: yougame.biz (XenForo) и unknowncheats.me (vBulletin),',
      'плюс база знаний и гейт «сначала ресерч».',
      '',
      '== yougame.biz (инструменты yg_*) ==',
      'Если задача про читы, моды, дамперы, инжекторы, оффсеты, реверс или игровые скрипты —',
      'начинай с yg_plan: он определит домен, выдаст поисковые запросы и покажет уже существующие',
      'инструменты. Дальше по лестнице: yg_kb_search → yg_tools → yg_search/yg_thread → yg_note → yg_ready → код → yg_report.',
      'Навигация: yg_categories → yg_forum → yg_thread. Поиск: yg_search (нужен вход).',
      'Скачивание: yg_resources → yg_download.',
      'AUTH_REQUIRED или 🔒 → yg_login.',
      '',
      '== unknowncheats.me (инструменты uc_*) ==',
      'Крупнейший англоязычный форум: исходники, туториалы, базы читов, SDK, оффсеты.',
      'Сайт за Cloudflare: при 403/Just a moment вызови uc_login — браузер получит cf_clearance.',
      'Навигация: uc_categories → uc_forum → uc_thread. Поиск: uc_search (нужен вход).',
      'Загрузки: uc_downloads_cats → uc_downloads_list → uc_downloads_file → uc_download.',
      'Ресурсы темы: uc_resources. AUTH_REQUIRED → uc_login. Гайд: uc_guide topic="auth".',
      '',
      'Оба форума питают одну базу знаний (yg_plan/yg_note/yg_ready/yg_report).',
      'При ресерче проверяй ОБА форума для полноты картины.',
    ].join(' '),
  },
);

registerTools(server);
registerUcTools(server);

async function main(): Promise<void> {
  process.stderr.write(`[yougame-mcp] yg=${config.baseUrl} uc=${ucConfig.baseUrl} home=${config.home}\n`);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[yougame-mcp] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
