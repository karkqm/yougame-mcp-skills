# yougame-mcp

MCP-сервер для работы ИИ с двумя форумами разработчиков:
**yougame.biz** (XenForo) и **unknowncheats.me** (vBulletin).

Сервер даёт инструменты доступа к обоим форумам, локальную базу знаний и каталог инструментов разработки.
Скиллы дают регламент: `yougame-first` — гейт «сначала ресерч, потом код», `yougame-research` —
механика форумов (хайды, файлообменники, навигация).

Оба форума питают одну базу знаний — при ресерче проверяются оба для полноты картины.

**Ставится по [AI-INSTALL.md](AI-INSTALL.md)** — там пошаговая инструкция, рассчитанная на то,
что установку выполняет сам ИИ-агент.

## Что умеет

### База знаний и гейт

| Инструмент | Назначение |
|---|---|
| `yg_plan` | Первый вызов по задаче: домен, поисковые запросы, id разделов, готовые инструменты, сессия ресерча |
| `yg_kb_search` | Поиск по локальной базе — решалась ли задача раньше |
| `yg_tools` | Каталог инструментов разработки по домену и виду |
| `yg_note` | Записать находку: факт, версия, грабли, код, пробел |
| `yg_ready` | Гейт: можно ли уже писать код; отдаёт список недостающего |
| `yg_report` | Итог ресерча со ссылками на источники |
| `yg_kb_add_tool` | Добавить найденный инструмент в базу |
| `yg_kb_export` | Выгрузить каталог в markdown |

### yougame.biz (инструменты yg_*)

| Инструмент | Назначение |
|---|---|
| `yg_guide` | Регламент: лестница решений, порядок ресерча, хайды, файлообменники |
| `yg_auth_status` | Видит ли форум нашу сессию |
| `yg_login` / `yg_logout` | Вход через браузер / забыть сессию |
| `yg_categories` | Дерево категорий → разделов → подразделов |
| `yg_forum` | Список тем раздела с пагинацией и сортировкой |
| `yg_thread` | Статья + комментарии в markdown, блоки кода, вложения, хайды |
| `yg_post` | Одно сообщение по id |
| `yg_search` | Поиск XenForo с фильтрами (нужен вход) |
| `yg_page` | Любая страница форума в markdown |
| `yg_resources` | Скачиваемые ресурсы темы + инструкция по хостингу |
| `yg_download` | Скачивание: вложения и внешние обменники |

### unknowncheats.me (инструменты uc_*)

Крупнейший англоязычный форум: исходники, туториалы, SDK, оффсеты.
Сайт за Cloudflare — при 403 / «Just a moment» вызови `uc_cf_pass` или `uc_login`.

| Инструмент | Назначение |
|---|---|
| `uc_guide` | Гайд по UC: авторизация, Cloudflare, навигация |
| `uc_auth_status` | Статус сессии: CF clearance, логин, cookies |
| `uc_cf_pass` | Открыть Edge/Chrome, пройти Cloudflare вручную, сохранить cf_clearance |
| `uc_login` / `uc_logout` | CF + логин на форум / забыть сессию |
| `uc_categories` | Дерево категорий (8 категорий, ~107 форумов) |
| `uc_forum` | Список тем раздела: prefix, автор, replies, views, sticky/locked |
| `uc_thread` | Тред целиком: посты в markdown, код, вложения, thanks |
| `uc_post` | Одно сообщение по id |
| `uc_search` | Поиск vBulletin с фильтрами (нужен вход) |
| `uc_page` | Любая страница UC в markdown |
| `uc_downloads_cats` | Категории раздела загрузок |
| `uc_downloads_list` | Список файлов в категории |
| `uc_downloads_file` | Детали файла: описание, версия, размер, скриншоты |
| `uc_download` | Скачивание файла через браузер |
| `uc_resources` | Ресурсы из темы (ссылки, вложения) |

### Лестница решений

Порядок, который навязывает скилл `yougame-first` и проверяет `yg_ready`:

| Ступень | Инструмент | Останавливаешься, если |
|---|---|---|
| 0. Это домен yougame? | `yg_plan` (`inScope`) | нет — обычная работа |
| 1. Уже решали? | `yg_kb_search` | в локальной базе есть ответ |
| 2. Инструмент уже есть? | `yg_tools` | задача закрывается готовым инструментом |
| 3a. Есть на yougame? | `yg_search` → `yg_thread` | нашлась механика или исходник |
| 3b. Есть на UC? | `uc_search` → `uc_thread` | нашлось на англоязычном форуме |
| 4. Ресерч закрыт? | `yg_ready` | `ready: true` |
| 5. Реализация | — | — |
| 6. Вернуть знание | `yg_kb_add_tool`, `yg_report` | — |

### База инструментов

Встроенный каталог (`src/kb/catalog.ts`) — стартовый набор того, что уже написано:
дамперы (Dumper-7, source2gen, Il2CppDumper, Scylla), декомпиляторы
(Vineflower, dnSpyEx, JADX, Recaf), деобфускаторы (de4dot, Threadtear), хук-библиотеки
(MinHook, Detours, Harmony, Frida), модлоадеры (BepInEx, MelonLoader, Fabric, Forge),
маппинги, работа с памятью, анализ.

## Установка

Нужен Node ≥ 18.17 (проверено на 18.20).

```bash
npm install
npm run build
npx playwright install chromium
```

### Подключение к Claude Code

```bash
claude mcp add yougame -- node "$(pwd)/dist/index.js"
```

Либо вручную:

```json
{
  "mcpServers": {
    "yougame": {
      "command": "node",
      "args": ["/абсолютный/путь/до/yougame-mcp-skills/dist/index.js"]
    }
  }
}
```

### Установка скиллов

```bash
npm run install-skill -- --force
```

Копирует `skill/yougame-first` и `skill/yougame-research` в `~/.claude/skills/`.

Всё разом (зависимости, сборка, скиллы):

```bash
npm run setup
```

## Авторизация

### yougame.biz

Когда инструмент упирается в закрытый раздел или хайд — `AUTH_REQUIRED`.
Модель вызывает `yg_login`, открывается Chromium, пользователь входит сам.
Сессия в `~/.yougame-mcp/cookies.json`.

### unknowncheats.me

UC за Cloudflare. Два уровня:

1. **CF clearance** (`uc_cf_pass`) — открывает Edge/Chrome с UC-профилем, пользователь проходит
   капчу «Verify you are human», cf_clearance сохраняется. Хватает для публичных страниц.
2. **Форум-логин** (`uc_login`) — CF + вход в аккаунт. Нужен для поиска и некоторых разделов.

HTTP-запросы идут через браузерный транспорт (real TLS fingerprint) — Node fetch
отклоняется Cloudflare даже с валидным cf_clearance из-за JA3/JA4 mismatch.

Сессия в `~/.uc-mcp/cookies.json`, профиль браузера в `~/.uc-mcp/browser-profile`.

## Настройки

### yougame.biz (переменные окружения)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `YOUGAME_BASE_URL` | `https://yougame.biz` | адрес форума |
| `YOUGAME_MCP_HOME` | `~/.yougame-mcp` | куки, профиль, загрузки |
| `YOUGAME_MIN_INTERVAL_MS` | `900` | пауза между запросами |
| `YOUGAME_CACHE_TTL_MS` | `45000` | кэш HTML в памяти |
| `YOUGAME_LOGIN_TIMEOUT_SEC` | `300` | таймаут ручного входа |

### unknowncheats.me (переменные окружения)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `UC_BASE_URL` | `https://www.unknowncheats.me/forum` | адрес форума |
| `UC_MCP_HOME` | `~/.uc-mcp` | куки, профиль, загрузки |
| `UC_BROWSER_PATH` | auto-detect Edge/Chrome | путь к браузеру |
| `UC_CDP_URL` | — | CDP-адрес уже запущенного браузера |
| `UC_MIN_INTERVAL_MS` | `1200` | пауза между запросами |
| `UC_CACHE_TTL_MS` | `45000` | кэш HTML в памяти |
| `UC_LOGIN_TIMEOUT_SEC` | `300` | таймаут CF/логина |

## Проверка

```bash
npm run smoke        # парсеры по живому yougame.biz
npm run smoke:mcp    # MCP по stdio
npm run smoke:kb     # база знаний без сети
```

## Структура

```
src/
  index.ts            вход, MCP-сервер, регистрация yg_* и uc_*
  tools.ts            yougame.biz инструменты
  api.ts              высокоуровневые операции yougame
  browser.ts          Playwright: вход и скачивание (yougame)
  config.ts errors.ts
  http/               cookie jar, очередь запросов (yougame)
  parse/              разбор HTML: разделы, темы, посты, bbcode → markdown (yougame)
  resources/          реестр файлообменников и загрузчик
  kb/                 база знаний, каталог инструментов, гейт ресерча
  uc/
    config.ts         конфигурация UC (URL, пути, браузер, rate limits)
    api.ts            высокоуровневые операции UC
    tools.ts          регистрация uc_* инструментов
    browser.ts        Edge/Chrome: CF captcha, логин, скачивание
    session-ua.ts     персистентный User-Agent (для cf_clearance match)
    download-util.ts  потоковое скачивание с sha256
    http/
      client.ts       HTTP-клиент: browser-first, Cloudflare detection
      browser-fetch.ts CDP-транспорт через Edge/Chrome (real TLS)
      jar.ts          cookie jar (tough-cookie, bbuserid/cf_clearance)
    parse/
      forum.ts        парсер: категории, форумы, список тем (vBulletin)
      thread.ts       парсер: посты, авторы, вложения, thanks
      search.ts       парсер: результаты поиска
      downloads.ts    парсер: раздел загрузок
      body.ts         vBulletin BBCode → markdown (code, quote, spoiler)
      util.ts         URL-утилиты, breadcrumbs, counts
skill/
  yougame-first/      гейт «сначала ресерч, потом код»
  yougame-research/   механика форумов
scripts/              смоук-тесты, генерация справочников
```
