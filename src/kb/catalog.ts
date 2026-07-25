/**
 * Встроенная база инструментов разработки.
 *
 * Смысл: прежде чем писать свой дампер/деобфускатор/инжектор, модель должна увидеть,
 * что для этой задачи уже существует. Каталог — стартовый набор; всё, что найдётся
 * на форуме дополнительно, дописывается пользовательскими записями через `yg_kb_add_tool`.
 */

export type ToolKind =
  | 'dumper' // достаёт структуры/классы/оффсеты из работающей или лежащей на диске цели
  | 'decompiler'
  | 'disassembler'
  | 'deobfuscator'
  | 'debugger'
  | 'injector'
  | 'hook' // библиотека перехвата
  | 'loader' // модлоадер / фреймворк модификаций
  | 'sdk-gen' // генерирует заголовки/классы для своего кода
  | 'mapping' // маппинги и переименование символов
  | 'memory' // чтение/запись памяти процесса
  | 'analysis' // статический анализ, определение упаковщика, мониторинг
  | 'network'
  | 'render' // рисование меню/оверлея
  | 'build'; // сборка, тулчейн

export interface CatalogTool {
  id: string;
  name: string;
  kind: ToolKind;
  domains: string[];
  lang?: string;
  url?: string;
  /** Одной строкой: что делает. */
  summary: string;
  /** Когда брать именно его и обо что обычно спотыкаются. */
  notes?: string;
  tags?: string[];
}

export const CATALOG: CatalogTool[] = [
  // ---------------------------------------------------------------- Java / Minecraft
  {
    id: 'recaf',
    name: 'Recaf',
    kind: 'decompiler',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/Col-E/Recaf',
    summary: 'Редактор байткода и декомпилятор JAR с правкой прямо в GUI.',
    notes: 'Основной инструмент, когда надо не только прочитать, но и пересобрать jar. Тянет несколько декомпиляторов внутри.',
    tags: ['jar', 'bytecode'],
  },
  {
    id: 'vineflower',
    name: 'Vineflower',
    kind: 'decompiler',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/Vineflower/vineflower',
    summary: 'Форк Fernflower: самый читаемый вывод по современному Java-байткоду.',
    notes: 'Дефолт для декомпиляции модов и клиентов. CFR и Procyon держи как второе мнение на сложных методах.',
  },
  {
    id: 'cfr',
    name: 'CFR',
    kind: 'decompiler',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/leibnitz27/cfr',
    summary: 'Декомпилятор Java, хорошо переваривает нестандартный байткод.',
    notes: 'Когда Vineflower выдал кашу — гони тот же класс через CFR.',
  },
  {
    id: 'bytecode-viewer',
    name: 'Bytecode-Viewer',
    kind: 'decompiler',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/Konloch/bytecode-viewer',
    summary: 'Комбайн: несколько декомпиляторов и просмотр байткода в одном окне.',
  },
  {
    id: 'threadtear',
    name: 'Threadtear',
    kind: 'deobfuscator',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/GraxCode/threadtear',
    summary: 'Многоступенчатый деобфускатор Java: строки, потоки управления, доступ через рефлексию.',
    notes: 'Работает трансформерами, которые включаются по одному. Против свежих обфускаторов помогает частично.',
  },
  {
    id: 'narumii-deobfuscator',
    name: 'narumii/Deobfuscator',
    kind: 'deobfuscator',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/narumii/Deobfuscator',
    summary: 'Деобфускатор, заточенный под обфускаторы, которыми пакуют читы для Minecraft.',
  },
  {
    id: 'asm',
    name: 'ObjectWeb ASM',
    kind: 'build',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://asm.ow2.io/',
    summary: 'Библиотека чтения и генерации байткода — фундамент почти любого java-инструмента.',
    notes: 'Свой дампер/трансформер классов пишется на ASM + java.lang.instrument, а не с нуля.',
  },
  {
    id: 'java-agent',
    name: 'java.lang.instrument (Java Agent)',
    kind: 'dumper',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://docs.oracle.com/en/java/javase/17/docs/api/java.instrument/java/lang/instrument/package-summary.html',
    summary: 'Штатный механизм JVM: агент с ClassFileTransformer видит байткод каждого загружаемого класса.',
    notes:
      'Это и есть «дампер классов» в честном виде: premain/agentmain + transform, который пишет байты в файл. Позволяет достать классы, сгенерированные или расшифрованные в рантайме, — то, чего нет в jar на диске. Подключение к уже запущенной JVM — через Attach API (jattach / VirtualMachine.attach).',
    tags: ['dumper', 'runtime'],
  },
  {
    id: 'jattach',
    name: 'jattach',
    kind: 'injector',
    domains: ['minecraft-java'],
    url: 'https://github.com/jattach/jattach',
    summary: 'Подключает агента к уже работающей JVM без JDK на машине.',
  },
  {
    id: 'mixin',
    name: 'SpongePowered Mixin',
    kind: 'hook',
    domains: ['minecraft-java'],
    lang: 'Java',
    url: 'https://github.com/SpongePowered/Mixin',
    summary: 'Штатный способ править классы игры на загрузке: @Inject, @Redirect, @Overwrite.',
    notes: 'Forge и Fabric несут его из коробки. MixinExtras добавляет @WrapOperation и прочие точные инъекции.',
  },
  {
    id: 'fabric-loader',
    name: 'Fabric Loader',
    kind: 'loader',
    domains: ['minecraft-java'],
    url: 'https://fabricmc.net/',
    summary: 'Лёгкий модлоадер Minecraft, маппинги Yarn, быстрое обновление под новые версии.',
  },
  {
    id: 'forge',
    name: 'MinecraftForge / NeoForge',
    kind: 'loader',
    domains: ['minecraft-java'],
    url: 'https://files.minecraftforge.net/',
    summary: 'Тяжёлый модлоадер с собственным API и событиями.',
  },
  {
    id: 'enigma',
    name: 'Enigma',
    kind: 'mapping',
    domains: ['minecraft-java'],
    url: 'https://github.com/FabricMC/Enigma',
    summary: 'Ручное переименование обфусцированных классов с сохранением маппингов.',
  },
  {
    id: 'mappings',
    name: 'Маппинги Minecraft (Yarn / MCP / Mojang / Parchment)',
    kind: 'mapping',
    domains: ['minecraft-java'],
    url: 'https://fabricmc.net/wiki/tutorial:mappings',
    summary: 'Наборы имён для обфусцированных классов игры; без них декомпиляция нечитаема.',
    notes: 'Первое, что надо определить в любой java-задаче по Minecraft: какая версия и какие маппинги. Промах здесь ломает всё дальше.',
  },
  {
    id: 'specialsource',
    name: 'SpecialSource / tiny-remapper',
    kind: 'mapping',
    domains: ['minecraft-java'],
    url: 'https://github.com/FabricMC/tiny-remapper',
    summary: 'Ремаппинг jar между наборами имён (обфа ↔ Yarn ↔ Mojang).',
  },

  // ---------------------------------------------------------------- .NET / Unity Mono
  {
    id: 'dnspyex',
    name: 'dnSpyEx',
    kind: 'decompiler',
    domains: ['dotnet', 'unity-mono'],
    url: 'https://github.com/dnSpyEx/dnSpy',
    summary: 'Декомпилятор и отладчик .NET с правкой IL и сохранением сборки.',
    notes: 'Живой форк заброшенного dnSpy. Умеет цепляться отладчиком к Unity-игре на Mono — это быстрее любого статического анализа.',
  },
  {
    id: 'ilspy',
    name: 'ILSpy',
    kind: 'decompiler',
    domains: ['dotnet'],
    url: 'https://github.com/icsharpcode/ILSpy',
    summary: 'Декомпилятор .NET, есть CLI (ilspycmd) для пакетной работы.',
  },
  {
    id: 'de4dot',
    name: 'de4dot',
    kind: 'deobfuscator',
    domains: ['dotnet'],
    url: 'https://github.com/de4dot/de4dot',
    summary: 'Снимает распространённые .NET-обфускаторы и восстанавливает имена.',
    notes: 'Старый, но по ConfuserEx и родне до сих пор рабочий первый шаг.',
  },
  {
    id: 'cecil',
    name: 'Mono.Cecil',
    kind: 'build',
    domains: ['dotnet', 'unity-mono'],
    url: 'https://github.com/jbevain/cecil',
    summary: 'Чтение и запись .NET-сборок из кода — база для своих патчеров.',
  },
  {
    id: 'harmony',
    name: 'HarmonyX / Lib.Harmony',
    kind: 'hook',
    domains: ['unity-mono', 'dotnet'],
    url: 'https://github.com/BepInEx/HarmonyX',
    summary: 'Рантайм-патчинг managed-методов: Prefix, Postfix, Transpiler.',
    notes: 'Правильный способ менять поведение Unity-игры без правки Assembly-CSharp.dll на диске.',
  },
  {
    id: 'bepinex',
    name: 'BepInEx',
    kind: 'loader',
    domains: ['unity-mono', 'unity-il2cpp'],
    url: 'https://github.com/BepInEx/BepInEx',
    summary: 'Модлоадер Unity: работает и на Mono, и на IL2CPP, несёт Harmony.',
  },
  {
    id: 'melonloader',
    name: 'MelonLoader',
    kind: 'loader',
    domains: ['unity-mono', 'unity-il2cpp'],
    url: 'https://github.com/LavaGang/MelonLoader',
    summary: 'Альтернативный модлоадер Unity с собственным API и поддержкой IL2CPP.',
  },
  {
    id: 'unityexplorer',
    name: 'UnityExplorer',
    kind: 'analysis',
    domains: ['unity-mono', 'unity-il2cpp'],
    url: 'https://github.com/sinai-dev/UnityExplorer',
    summary: 'Рантайм-инспектор сцены: иерархия объектов, компоненты, значения полей, вызов методов.',
    notes: 'Экономит часы: смотришь живую сцену вместо угадывания по декомпиляции.',
  },
  {
    id: 'assetripper',
    name: 'AssetRipper',
    kind: 'dumper',
    domains: ['unity-mono', 'unity-il2cpp'],
    url: 'https://github.com/AssetRipper/AssetRipper',
    summary: 'Разбирает бандлы Unity обратно в проект: ассеты, сцены, скрипты.',
  },
  {
    id: 'uabe',
    name: 'UABEA (AssetBundleExtractor)',
    kind: 'dumper',
    domains: ['unity-mono'],
    url: 'https://github.com/nesrak1/UABEA',
    summary: 'Просмотр и правка ассетов и бандлов Unity.',
  },

  // ---------------------------------------------------------------- IL2CPP
  {
    id: 'il2cppdumper',
    name: 'Il2CppDumper',
    kind: 'dumper',
    domains: ['unity-il2cpp', 'android'],
    url: 'https://github.com/Perfare/Il2CppDumper',
    summary: 'Из GameAssembly.dll + global-metadata.dat достаёт классы, методы и их RVA.',
    notes:
      'Даёт dump.cs, script.json и заголовки для IDA/Ghidra. Спотыкается о зашифрованную metadata и о свежие версии Unity — тогда смотри Il2CppInspectorRedux или Cpp2IL.',
    tags: ['dumper'],
  },
  {
    id: 'il2cppinspector',
    name: 'Il2CppInspectorRedux',
    kind: 'dumper',
    domains: ['unity-il2cpp'],
    url: 'https://github.com/LukeFZ/Il2CppInspectorRedux',
    summary: 'Дампер IL2CPP с генерацией C++ SDK и скриптов для IDA/Ghidra/BinaryNinja.',
    notes: 'Берёт часть версий, на которых падает Il2CppDumper.',
  },
  {
    id: 'cpp2il',
    name: 'Cpp2IL',
    kind: 'dumper',
    domains: ['unity-il2cpp'],
    url: 'https://github.com/SamboyCoding/Cpp2IL',
    summary: 'Восстанавливает managed-сборки из IL2CPP-бинаря, вплоть до тел методов.',
    notes: 'Пригодно, когда нужна не таблица адресов, а читаемый код. Медленнее и капризнее дамперов.',
  },

  // ---------------------------------------------------------------- Unreal
  {
    id: 'dumper-7',
    name: 'Dumper-7',
    kind: 'sdk-gen',
    domains: ['unreal'],
    url: 'https://github.com/Encryqed/Dumper-7',
    summary: 'Внутренний дампер UE4/UE5: сам находит GObjects/GNames и генерит полный C++ SDK.',
    notes: 'Стандартный первый шаг по любой Unreal-игре. Кастомные правки движка в конкретной игре могут его сломать — тогда правится вручную.',
    tags: ['dumper', 'sdk'],
  },
  {
    id: 'ue4ss',
    name: 'UE4SS',
    kind: 'loader',
    domains: ['unreal'],
    url: 'https://github.com/UE4SS-RE/RE-UE4SS',
    summary: 'Скриптовая система для UE: Lua/C++ моды, живой просмотр объектов, дамп CXX-хедеров.',
  },
  {
    id: 'fmodel',
    name: 'FModel',
    kind: 'analysis',
    domains: ['unreal'],
    url: 'https://github.com/4sval/FModel',
    summary: 'Просмотр и распаковка .pak/.utoc архивов Unreal.',
  },

  // ---------------------------------------------------------------- Source / Source 2
  {
    id: 'source2gen',
    name: 'source2gen',
    kind: 'sdk-gen',
    domains: ['source-engine'],
    url: 'https://github.com/neverlosecc/source2gen',
    summary: 'Генерирует заголовки схемы Source 2 (классы, поля, оффсеты) прямо из игры.',
    notes: 'Прогоняется заново после каждого обновления игры — оффсеты живут ровно до патча.',
    tags: ['dumper', 'sdk'],
  },
  {
    id: 'cs2-dumper',
    name: 'cs2-dumper',
    kind: 'dumper',
    domains: ['source-engine'],
    url: 'https://github.com/a2x/cs2-dumper',
    summary: 'Внешний дампер оффсетов, интерфейсов и схемы CS2 в C++/C#/JSON.',
  },
  {
    id: 'hazedumper',
    name: 'hazedumper',
    kind: 'dumper',
    domains: ['source-engine'],
    url: 'https://github.com/frk1/hazedumper',
    summary: 'Классический сигнатурный дампер оффсетов Source (CS:GO). Полезен как образец подхода.',
  },

  // ---------------------------------------------------------------- Нативный реверс
  {
    id: 'ida',
    name: 'IDA Pro / IDA Free',
    kind: 'disassembler',
    domains: ['native-windows', 'reverse', 'android', 'unity-il2cpp'],
    url: 'https://hex-rays.com/ida-pro/',
    summary: 'Дизассемблер и декомпилятор (Hex-Rays) — рабочий стандарт реверса.',
  },
  {
    id: 'ghidra',
    name: 'Ghidra',
    kind: 'disassembler',
    domains: ['native-windows', 'reverse', 'android'],
    url: 'https://ghidra-sre.org/',
    summary: 'Бесплатный дизассемблер с декомпилятором и скриптами; берёт скрипты Il2CppDumper.',
  },
  {
    id: 'x64dbg',
    name: 'x64dbg',
    kind: 'debugger',
    domains: ['native-windows', 'reverse'],
    url: 'https://x64dbg.com/',
    summary: 'Отладчик уровня пользователя для Windows, с плагинами (Scylla, xAnalyzer).',
  },
  {
    id: 'scylla',
    name: 'Scylla',
    kind: 'dumper',
    domains: ['native-windows', 'reverse'],
    url: 'https://github.com/NtQuery/Scylla',
    summary: 'Дамп PE-образа из памяти процесса с восстановлением таблицы импортов.',
    notes: 'Каноничный ответ на «сдампить распакованный модуль»: остановиться на OEP в x64dbg и снять образ.',
    tags: ['dumper'],
  },
  {
    id: 'cheat-engine',
    name: 'Cheat Engine',
    kind: 'memory',
    domains: ['native-windows', 'unity-mono', 'reverse'],
    url: 'https://cheatengine.org/',
    summary: 'Поиск значений в памяти, указателей, точек доступа; свой дизассемблер и Lua-скрипты.',
    notes: 'Быстрый способ найти нужное поле, прежде чем лезть в статический анализ.',
  },
  {
    id: 'reclass',
    name: 'ReClass.NET',
    kind: 'analysis',
    domains: ['native-windows', 'reverse'],
    url: 'https://github.com/ReClassNET/ReClass.NET',
    summary: 'Восстановление структур из памяти с экспортом в C++-заголовки.',
  },
  {
    id: 'system-informer',
    name: 'System Informer (Process Hacker)',
    kind: 'analysis',
    domains: ['native-windows'],
    url: 'https://systeminformer.sourceforge.io/',
    summary: 'Процессы, модули, хендлы, потоки, память — обзорная разведка по цели.',
  },
  {
    id: 'die',
    name: 'Detect It Easy',
    kind: 'analysis',
    domains: ['native-windows', 'reverse'],
    url: 'https://github.com/horsicq/Detect-It-Easy',
    summary: 'Определяет упаковщик, протектор и компилятор бинаря.',
    notes: 'Проверяй первым: если стоит VMProtect/Themida, план работы совсем другой.',
  },
  {
    id: 'pe-bear',
    name: 'PE-bear',
    kind: 'analysis',
    domains: ['native-windows', 'reverse'],
    url: 'https://github.com/hasherezade/pe-bear',
    summary: 'Разбор PE: секции, импорты, ресурсы, точки входа.',
  },
  {
    id: 'minhook',
    name: 'MinHook',
    kind: 'hook',
    domains: ['native-windows'],
    lang: 'C/C++',
    url: 'https://github.com/TsudaKageyu/minhook',
    summary: 'Минималистичный inline-хук x86/x64.',
  },
  {
    id: 'detours',
    name: 'Microsoft Detours',
    kind: 'hook',
    domains: ['native-windows'],
    url: 'https://github.com/microsoft/Detours',
    summary: 'Библиотека перехвата функций от Microsoft, с транзакциями.',
  },
  {
    id: 'kiero',
    name: 'kiero',
    kind: 'hook',
    domains: ['native-windows'],
    url: 'https://github.com/Rebzzel/kiero',
    summary: 'Достаёт таблицы методов графических API (D3D9/11/12, OpenGL, Vulkan) для хука рендера.',
  },
  {
    id: 'imgui',
    name: 'Dear ImGui',
    kind: 'render',
    domains: ['native-windows'],
    url: 'https://github.com/ocornut/imgui',
    summary: 'Immediate-mode GUI: стандарт для внутриигровых меню.',
  },
  {
    id: 'frida',
    name: 'Frida',
    kind: 'hook',
    domains: ['android', 'native-windows', 'reverse'],
    url: 'https://frida.re/',
    summary: 'Динамическая инструментация: JS-скрипты хукают нативные функции в живом процессе.',
    notes: 'Лучший способ быстро проверить гипотезу, не собирая DLL.',
  },

  // ---------------------------------------------------------------- Android
  {
    id: 'jadx',
    name: 'JADX',
    kind: 'decompiler',
    domains: ['android', 'minecraft-java'],
    url: 'https://github.com/skylot/jadx',
    summary: 'Декомпилятор APK/DEX в читаемую Java, с GUI и поиском.',
  },
  {
    id: 'apktool',
    name: 'Apktool',
    kind: 'build',
    domains: ['android'],
    url: 'https://apktool.org/',
    summary: 'Разбор APK в smali и обратная сборка — база для патча приложения.',
  },
  {
    id: 'lsposed',
    name: 'LSPosed / Xposed',
    kind: 'hook',
    domains: ['android'],
    url: 'https://github.com/LSPosed/LSPosed',
    summary: 'Хук Java-методов в чужих приложениях без правки APK (нужен root).',
  },

  // ---------------------------------------------------------------- DMA
  {
    id: 'memprocfs',
    name: 'MemProcFS',
    kind: 'memory',
    domains: ['dma', 'reverse'],
    url: 'https://github.com/ufrisk/MemProcFS',
    summary: 'Память целевой машины как файловая система; работает поверх LeechCore/PCILeech.',
  },
  {
    id: 'pcileech',
    name: 'PCILeech',
    kind: 'memory',
    domains: ['dma'],
    url: 'https://github.com/ufrisk/pcileech',
    summary: 'Прямой доступ к памяти через PCIe-устройство.',
  },

  // ---------------------------------------------------------------- Скрипты, сеть, общее
  {
    id: 'autohotkey',
    name: 'AutoHotkey v2',
    kind: 'build',
    domains: ['script'],
    url: 'https://www.autohotkey.com/',
    summary: 'Скрипты ввода и автоматизации, чтение памяти через DllCall.',
  },
  {
    id: 'luau',
    name: 'Luau',
    kind: 'build',
    domains: ['roblox', 'script'],
    url: 'https://luau.org/',
    summary: 'Диалект Lua от Roblox: типы, свои ограничения стандартной библиотеки.',
  },
  {
    id: 'wireshark',
    name: 'Wireshark',
    kind: 'network',
    domains: ['native-windows', 'web', 'reverse'],
    url: 'https://www.wireshark.org/',
    summary: 'Анализ сетевого трафика; для игрового протокола — первая точка входа.',
  },
  {
    id: 'http-toolkit',
    name: 'HTTP Toolkit / Fiddler',
    kind: 'network',
    domains: ['web', 'android'],
    url: 'https://httptoolkit.com/',
    summary: 'Перехват и правка HTTPS-трафика приложений и лоадеров.',
  },
];

export function catalogById(id: string): CatalogTool | undefined {
  return CATALOG.find((t) => t.id === id);
}

export interface CatalogFilter {
  domain?: string;
  kind?: ToolKind;
  query?: string;
}

export function filterCatalog(f: CatalogFilter): CatalogTool[] {
  const q = f.query?.toLowerCase().trim();
  return CATALOG.filter((t) => {
    if (f.domain && !t.domains.includes(f.domain)) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (q) {
      const hay = `${t.name} ${t.id} ${t.summary} ${t.notes ?? ''} ${(t.tags ?? []).join(' ')} ${t.lang ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
