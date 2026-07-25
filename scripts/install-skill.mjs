// Ставит скиллы в ~/.claude/skills: node scripts/install-skill.mjs [имя] [--force]
// Без аргумента ставит все скиллы из каталога skill/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcRoot = path.join(root, 'skill');
const destRoot = path.join(os.homedir(), '.claude', 'skills');

const force = process.argv.includes('--force');
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!fs.existsSync(srcRoot)) {
  console.error('Не найден каталог скиллов:', srcRoot);
  process.exit(1);
}

const available = fs
  .readdirSync(srcRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(srcRoot, e.name, 'SKILL.md')))
  .map((e) => e.name);

const targets = wanted.length ? wanted : available;
const unknown = targets.filter((t) => !available.includes(t));
if (unknown.length) {
  console.error('Неизвестные скиллы:', unknown.join(', '));
  console.error('Доступны:', available.join(', '));
  process.exit(1);
}

fs.mkdirSync(destRoot, { recursive: true });
let installed = 0;
let skipped = 0;

for (const name of targets) {
  const src = path.join(srcRoot, name);
  const dest = path.join(destRoot, name);
  if (fs.existsSync(dest) && !force) {
    console.warn(`Пропущен ${name}: ${dest} уже существует (перезаписать — флаг --force).`);
    skipped += 1;
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('Установлен скилл:', dest);
  installed += 1;
}

if (installed) console.log('Перезапусти клиент, чтобы он подхватил скиллы.');
if (skipped && !installed) process.exitCode = 1;
