// Пересобирает справочники скиллов из кода сервера (единый источник правды).
// Запуск: npm run build && node scripts/gen-skill-docs.mjs [--with-map]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOW } from '../dist/workflow.js';
import { getCategories } from '../dist/api.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const researchRefs = path.join(root, 'skill', 'yougame-research', 'references');
const firstRefs = path.join(root, 'skill', 'yougame-first', 'references');
fs.mkdirSync(researchRefs, { recursive: true });
fs.mkdirSync(firstRefs, { recursive: true });

const write = (dir, name, text) => {
  fs.writeFileSync(path.join(dir, name), text.trimEnd() + '\n', 'utf8');
  console.log('Записано:', path.relative(root, path.join(dir, name)));
};

// Скилл механики форума.
write(researchRefs, 'workflow.md', WORKFLOW.workflow);
write(researchRefs, 'gates.md', WORKFLOW.gates);
write(researchRefs, 'download-hosts.md', WORKFLOW.hostsTable);

// Скилл-гейт «сначала ресерч».
write(firstRefs, 'ladder.md', WORKFLOW.ladder);
write(firstRefs, 'toolbase.md', WORKFLOW.toolbase);

if (process.argv.includes('--with-map')) {
  const { categories } = await getCategories();
  const lines = [
    '# Карта разделов yougame.biz',
    '',
    `Снята автоматически ${new Date().toISOString().slice(0, 10)} (\`node scripts/gen-skill-docs.mjs --with-map\` обновит).`,
    'Числа в скобках — id узла: их можно передавать в `yg_forum` и в `forumIds` у `yg_search`.',
    '',
  ];
  for (const cat of categories) {
    lines.push(`## ${cat.title}${cat.id ? ` (${cat.id})` : ''}`, '');
    for (const node of cat.nodes) {
      lines.push(`- **${node.title}** (${node.id})${node.threads ? ` — тем: ${node.threads}` : ''}`);
      if (node.description) lines.push(`  - ${node.description}`);
      for (const sub of node.subForums) lines.push(`  - ${sub.title} (${sub.id})`);
    }
    lines.push('');
  }
  lines.push(
    '## Где что искать',
    '',
    '| Нужно | Куда смотреть |',
    '|---|---|',
    '| Теория, гайды, туториалы | «Гайды по разработке читов», «Полезные статьи и туториалы», «Вопросы и помощь новичкам» |',
    '| Готовый код | «Исходники читов …», «Готовые и частичные разработки», префиксы «Исходник», «Визуальная часть» |',
    '| Общее программирование, реверс | «Программирование», «Реверс-инжиниринг» |',
    '| Правила и работа форума | «Общий раздел YouGame.Biz» |',
  );
  write(researchRefs, 'forum-map.md', lines.join('\n'));
}
