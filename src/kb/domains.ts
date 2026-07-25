/**
 * Домены разработки: как связать задачу пользователя с разделами форума
 * и с нужным набором инструментов.
 *
 * Домен определяется по тексту задачи (`detectDomain`) и дальше управляет всем:
 * какие id разделов передать в `yg_search`, какие запросы сформулировать,
 * какие инструменты из каталога показать.
 */

export type TaskKind = 'implement' | 'port' | 'fix' | 'explore' | 'find';

/**
 * Левая граница слова с учётом кириллицы.
 *
 * `\b` в JS считает словом только ASCII, поэтому `\bмайнкрафт` не совпадает никогда:
 * перед «м» стоит пробел, и оба символа для движка «не-слово». Здесь граница задана
 * lookbehind-ом по юникодным буквам. Правой границы намеренно нет — многие ключи
 * это приставки («обфуск» ловит «обфускация»); где она нужна, ставь `\b` вручную
 * после латиницы (`js\b`) — там ASCII-граница работает правильно.
 */
function kw(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})`, 'iu');
}

export interface Domain {
  id: string;
  title: string;
  /** Слова из задачи пользователя, по которым домен опознаётся. */
  keywords: RegExp;
  /** Разделы форума с теорией и гайдами. */
  theoryForums: number[];
  /** Разделы форума с исходниками. */
  codeForums: number[];
  /** Шаблоны поисковых запросов: {q} подставляется темой задачи. */
  queries: string[];
  /** Что обязательно выяснить до написания кода. */
  mustKnow: string[];
}

/** Разделы общего назначения — добавляются к любому домену. */
export const COMMON_FORUMS = {
  /** Программирование, реверс-инжиниринг, общая секция разработки. */
  theory: [869, 908, 791, 792, 793, 946],
  /** Готовые и частичные разработки + общие исходники. */
  code: [794, 795],
};

export const DOMAINS: Domain[] = [
  {
    id: 'minecraft-java',
    title: 'Minecraft / Java (клиенты, моды, миксины)',
    keywords: kw(
      'minecraft|майнкрафт|майна|forge|fabric|mixin|миксин|yarn|mcp\\b|mapping|маппинг|nursultan|expensive|celka|rise\\b|doomsday|weave|lunar|javaagent|java-агент|jar\\b|jvm\\b',
    ),
    theoryForums: [1046, 1047, 1048, 893],
    codeForums: [853],
    queries: ['{q} minecraft', '{q} mixin', '{q} forge fabric', 'дамп классов minecraft {q}', '{q} java agent'],
    mustKnow: [
      'версия игры и лоадер (Forge / Fabric / ванильный агент)',
      'какие маппинги нужны (Yarn, MCP, Mojang official, Parchment) и обфусцирован ли клиент',
      'куда внедряться: агент до запуска, миксин, или пост-фактум по jar-у',
    ],
  },
  {
    id: 'native-windows',
    title: 'Нативные читы под Windows (C/C++, внутренние и внешние)',
    keywords: kw(
      'c\\+\\+|cpp\\b|внутренний чит|внешний чит|internal|external|inject|инжект|dll\\b|hook\\b|хук|minhook|detours|imgui|d3d(9|11|12)?|directx|opengl|vulkan|vmt\\b|entity ?list|драйвер|kernel|ядр|overlay|оверлей',
    ),
    theoryForums: [791, 792, 793, 891, 908, 909],
    codeForums: [794, 795],
    queries: ['{q} c++', '{q} внутренний чит', '{q} hook', '{q} инжект', '{q} оверлей'],
    mustKnow: [
      'внутренний (DLL в процессе) или внешний (чтение памяти) подход',
      'графический бэкенд игры — от него зависит способ рисования (D3D11/12, OpenGL, Vulkan, оверлей)',
      'какой античит стоит и что он ловит (не для обхода, а чтобы понимать ограничения темы)',
    ],
  },
  {
    id: 'unity-mono',
    title: 'Unity на Mono (managed .NET сборки)',
    keywords: kw('unity|юнити|mono\\b|melonloader|bepinex|harmony|assembly-?csharp|dnspy'),
    theoryForums: [902, 903, 904, 892],
    codeForums: [905, 794],
    queries: ['{q} unity', '{q} melonloader', '{q} bepinex', '{q} Assembly-CSharp'],
    mustKnow: [
      'Mono это или IL2CPP — от этого зависит вообще весь инструментарий',
      'версия Unity (видна в GameAssembly / global-metadata / логе запуска)',
      'патч на диске или рантайм-хук (Harmony)',
    ],
  },
  {
    id: 'unity-il2cpp',
    title: 'Unity IL2CPP (нативный AOT-код)',
    keywords: kw('il2cpp|gameassembly|global-?metadata|cpp2il|il2cppdumper'),
    theoryForums: [902, 903, 904],
    codeForums: [905, 794],
    queries: ['{q} il2cpp', 'il2cpp dumper {q}', '{q} global-metadata', '{q} GameAssembly'],
    mustKnow: [
      'версия metadata и Unity — от неё зависит, какой дампер вообще заведётся',
      'зашифрована ли global-metadata.dat (частая защита)',
      'нужен ли SDK-хедер для C++ или хватит адресов методов',
    ],
  },
  {
    id: 'unreal',
    title: 'Unreal Engine (UE4 / UE5)',
    keywords: kw('unreal|анрил|ue[45]\\b|uworld|gname|gobject|uobject|ue4ss|dumper-?7|fname|blueprint|pak-?файл'),
    theoryForums: [897, 898, 899],
    codeForums: [1002, 1003, 794],
    queries: ['{q} unreal engine', '{q} GObjects GNames', '{q} UE5 sdk', 'dumper unreal {q}'],
    mustKnow: [
      'версия движка и есть ли смещения GObjects/GNames/UWorld для неё',
      'нужен полный SDK-дамп или точечные оффсеты',
      'кастомные правки движка у конкретной игры (часто ломают готовые дамперы)',
    ],
  },
  {
    id: 'source-engine',
    title: 'Source / Source 2 (CS:GO, CS2, Dota 2, Deadlock, GMod)',
    keywords: kw(
      "source ?2|source ?engine|cs ?2\\b|cs:?go|кс ?2\\b|ксго|dota|дота|deadlock|дедлок|garry'?s ?mod|gmod|гмод|schema|схема класс|netvar|нетвар|client\\.dll",
    ),
    theoryForums: [1074, 1073, 661, 662, 1320, 739],
    codeForums: [1075, 625, 1321, 741],
    queries: ['{q} cs2', '{q} source 2', '{q} схема schema', '{q} оффсеты netvar', '{q} интерфейсы'],
    mustKnow: [
      'актуальность оффсетов/схемы: они протухают каждым обновлением игры',
      'через что берётся схема — дампер схемы или готовый дамп из темы',
      'клиентский модуль и нужные интерфейсы',
    ],
  },
  {
    id: 'dotnet',
    title: '.NET / C# приложения',
    keywords: kw('c#|csharp|\\.net\\b|dotnet|dnspy|ilspy|de4dot|cecil|clr\\b'),
    theoryForums: [892, 908, 909],
    codeForums: [794],
    queries: ['{q} c#', '{q} dnspy', '{q} .net патч', '{q} деобфускация'],
    mustKnow: [
      'обфусцирована ли сборка и чем (ConfuserEx, Eazfuscator, .NET Reactor)',
      'патч сборки на диске или рантайм-хук',
      'версия рантайма: .NET Framework или .NET 5+',
    ],
  },
  {
    id: 'android',
    title: 'Android / мобильная разработка',
    keywords: kw('android|андроид|apk\\b|smali|frida|xposed|lsposed|magisk|arm64|so-?файл|мобил'),
    theoryForums: [1299, 1298, 914],
    codeForums: [794],
    queries: ['{q} android', '{q} apk', '{q} frida', '{q} libil2cpp.so'],
    mustKnow: [
      'нужен ли root — это патч APK или рантайм-инъекция',
      'архитектура (arm64-v8a почти всегда) и есть ли проверка целостности подписи',
      'нативная часть (.so) или Java/Kotlin слой',
    ],
  },
  {
    id: 'roblox',
    title: 'Roblox / Luau',
    keywords: kw('roblox|роблокс|luau|executor|экзекутор'),
    theoryForums: [1349, 861],
    codeForums: [1350],
    queries: ['{q} roblox', '{q} luau', '{q} экзекутор'],
    mustKnow: ['Luau ≠ Lua 5.1: часть стандартной библиотеки урезана', 'что доступно из окружения исполнителя'],
  },
  {
    id: 'script',
    title: 'Скрипты для читов (LUA / JS / AHK / Python)',
    keywords: kw('lua\\b|луа|скрипт|script|ahk\\b|autohotkey|javascript|js\\b|python|питон|макрос'),
    theoryForums: [879, 887, 1059, 878, 1248],
    codeForums: [884, 1057, 1362, 1378],
    queries: ['{q} lua', '{q} js скрипт', '{q} api скриптов'],
    mustKnow: [
      'под какой чит/лоадер пишется скрипт — API у каждого своё',
      'версия API: старые пасты часто не заводятся',
    ],
  },
  {
    id: 'dma',
    title: 'DMA / внешнее чтение памяти железом',
    keywords: kw('dma\\b|дма\\b|pcileech|memprocfs|leechcore|kmbox|makcu|фьюзер|fuser'),
    theoryForums: [1290, 791],
    codeForums: [794],
    queries: ['{q} dma', '{q} memprocfs', '{q} pcileech'],
    mustKnow: ['какая карта и прошивка', 'как передаётся ввод (KMBox / Makcu) и куда выводится картинка'],
  },
  {
    id: 'reverse',
    title: 'Реверс-инжиниринг и анализ',
    keywords: kw(
      'реверс|reverse|ida\\b|ghidra|гидра|x64dbg|дизасм|disasm|распаков|unpack|крякн|crack|дамп|dump|деобфус|deobf|обфуск|obfusc|протектор|packer',
    ),
    theoryForums: [908, 909, 910, 911],
    codeForums: [794],
    queries: ['{q} реверс', '{q} дамп', '{q} распаковка', '{q} анализ'],
    mustKnow: [
      'что именно на выходе: дамп памяти, восстановленные символы, SDK или просто оффсеты',
      'есть ли упаковщик/протектор на цели',
    ],
  },
  {
    id: 'web',
    title: 'Веб: панели авторизации, лоадеры, бэкенд',
    keywords: kw('панель авторизац|loader\\b|лоадер|бэкенд|backend|php\\b|nodejs|node\\.js|react|vue|api ?сервер'),
    theoryForums: [1127, 1128, 933],
    codeForums: [707],
    queries: ['{q} панель авторизации', '{q} лоадер', '{q} backend'],
    mustKnow: ['где хранится и как проверяется лицензия', 'что уходит на клиент, а что остаётся на сервере'],
  },
  {
    id: 'gamedev',
    title: 'Разработка игр (Unity, Unreal, движки)',
    keywords: kw('геймдев|gamedev|разработка игр|godot|cryengine|шейдер|shader|ассет|asset'),
    theoryForums: [758, 759, 899, 904],
    codeForums: [760, 761, 905],
    queries: ['{q} движок', '{q} разработка игры'],
    mustKnow: ['движок и его версия', 'целевая платформа'],
  },
];

export const GENERIC_DOMAIN: Domain = {
  id: 'generic',
  title: 'Без явного домена',
  keywords: /$^/,
  theoryForums: COMMON_FORUMS.theory,
  codeForums: COMMON_FORUMS.code,
  queries: ['{q}', '{q} гайд', '{q} исходник'],
  mustKnow: ['что именно должно получиться на выходе', 'на какой платформе и в каком рантайме это работает'],
};

/** Слова, по которым видно, что задача вообще из мира yougame. */
const IN_SCOPE = kw(
  'чит|cheat|хак\\b|hack\\b|мод\\b|моды|мода\\b|mod\\b|dumper|дампер|дамп|inject|инжект|hook\\b|хук|esp\\b|aimbot|аимбот|аим\\b|wallhack|вх\\b|оффсет|offset|скрипт для|макрос|обфуск|деобфуск|реверс|reverse|античит|anticheat|байпас|bypass|спуфер|spoofer|экзекутор|executor|миксин|mixin|il2cpp|unreal|unity|minecraft|майнкрафт|roblox|роблокс|cs ?2\\b|csgo|dota|дота|rust\\b|раст\\b|tarkov|тарков|valorant|апекс|apex',
);

export interface DomainGuess {
  domain: Domain;
  /** Дополнительные подходящие домены — их разделы тоже стоит проверить. */
  also: Domain[];
  inScope: boolean;
}

/** Опознать домен по тексту задачи. */
export function detectDomain(task: string): DomainGuess {
  const hits = DOMAINS.map((d) => ({
    d,
    n: (task.match(new RegExp(d.keywords.source, 'giu')) || []).length,
  })).filter((x) => x.n > 0);
  hits.sort((a, b) => b.n - a.n);
  const inScope = IN_SCOPE.test(task) || hits.length > 0;
  if (!hits.length) return { domain: GENERIC_DOMAIN, also: [], inScope };
  return { domain: hits[0].d, also: hits.slice(1, 3).map((x) => x.d), inScope };
}

export function domainById(id: string): Domain | undefined {
  return id === 'generic' ? GENERIC_DOMAIN : DOMAINS.find((d) => d.id === id);
}

const FIND = kw('найди|найти|поищ|поиск|скачай|скачать|есть ли|где взять|покажи тем|скинь');
const EXPLORE = kw('как работает|разбер|объясни|изучи|почитай|что такое|разобрат|как устроен');
const PORT = kw('перенес|портир|port\\b|адаптир|переделай под|переписать под');
const FIX = kw('почини|пофикс|fix\\b|не работает|ошибк|краш|вылет|падает');

/** Тип задачи по формулировке: от него зависит строгость гейта. */
export function detectTaskKind(task: string): TaskKind {
  if (FIND.test(task)) return 'find';
  if (EXPLORE.test(task)) return 'explore';
  if (PORT.test(task)) return 'port';
  if (FIX.test(task)) return 'fix';
  return 'implement';
}

/** Мусорные слова, которые не должны попадать в поисковый запрос по форуму. */
const STOPWORDS = kw(
  'напиши|сделай|создай|собери|нужен|нужно|надо|мне\\b|пожалуйста|плиз|please|write|make|для меня|хочу|помоги',
);

/** Готовые поисковые запросы под задачу. */
export function buildQueries(domain: Domain, task: string): string[] {
  const core = task
    .replace(/["'`]/g, ' ')
    .replace(new RegExp(STOPWORDS.source, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
  const out = domain.queries.map((q) => q.replace('{q}', core).replace(/\s+/g, ' ').trim());
  return [...new Set([core, ...out])].filter((q) => q.length >= 2).slice(0, 8);
}
