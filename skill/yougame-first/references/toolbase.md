# Встроенный каталог инструментов

Это стартовая база: что уже написано до тебя. Запрос — `yg_tools`
(фильтры `domain`, `kind`, `query`). Всё, что найдётся на форуме сверх этого,
дописывается через `yg_kb_add_tool` и попадает в ту же выдачу.

## Домены

| Домен | О чём | Разделы форума (теория / исходники) |
|---|---|---|
| `minecraft-java` | Minecraft / Java (клиенты, моды, миксины) | 1046, 1047, 1048, 893 / 853 |
| `native-windows` | Нативные читы под Windows (C/C++, внутренние и внешние) | 791, 792, 793, 891, 908, 909 / 794, 795 |
| `unity-mono` | Unity на Mono (managed .NET сборки) | 902, 903, 904, 892 / 905, 794 |
| `unity-il2cpp` | Unity IL2CPP (нативный AOT-код) | 902, 903, 904 / 905, 794 |
| `unreal` | Unreal Engine (UE4 / UE5) | 897, 898, 899 / 1002, 1003, 794 |
| `source-engine` | Source / Source 2 (CS:GO, CS2, Dota 2, Deadlock, GMod) | 1074, 1073, 661, 662, 1320, 739 / 1075, 625, 1321, 741 |
| `dotnet` | .NET / C# приложения | 892, 908, 909 / 794 |
| `android` | Android / мобильная разработка | 1299, 1298, 914 / 794 |
| `roblox` | Roblox / Luau | 1349, 861 / 1350 |
| `script` | Скрипты для читов (LUA / JS / AHK / Python) | 879, 887, 1059, 878, 1248 / 884, 1057, 1362, 1378 |
| `dma` | DMA / внешнее чтение памяти железом | 1290, 791 / 794 |
| `reverse` | Реверс-инжиниринг и анализ | 908, 909, 910, 911 / 794 |
| `web` | Веб: панели авторизации, лоадеры, бэкенд | 1127, 1128, 933 / 707 |
| `gamedev` | Разработка игр (Unity, Unreal, движки) | 758, 759, 899, 904 / 760, 761, 905 |

## Инструменты

| Инструмент | Вид | Домены | Что делает |
|---|---|---|---|
| [Recaf](https://github.com/Col-E/Recaf) | decompiler | minecraft-java | Редактор байткода и декомпилятор JAR с правкой прямо в GUI. |
| [Vineflower](https://github.com/Vineflower/vineflower) | decompiler | minecraft-java | Форк Fernflower: самый читаемый вывод по современному Java-байткоду. |
| [CFR](https://github.com/leibnitz27/cfr) | decompiler | minecraft-java | Декомпилятор Java, хорошо переваривает нестандартный байткод. |
| [Bytecode-Viewer](https://github.com/Konloch/bytecode-viewer) | decompiler | minecraft-java | Комбайн: несколько декомпиляторов и просмотр байткода в одном окне. |
| [Threadtear](https://github.com/GraxCode/threadtear) | deobfuscator | minecraft-java | Многоступенчатый деобфускатор Java: строки, потоки управления, доступ через рефлексию. |
| [narumii/Deobfuscator](https://github.com/narumii/Deobfuscator) | deobfuscator | minecraft-java | Деобфускатор, заточенный под обфускаторы, которыми пакуют читы для Minecraft. |
| [ObjectWeb ASM](https://asm.ow2.io/) | build | minecraft-java | Библиотека чтения и генерации байткода — фундамент почти любого java-инструмента. |
| [java.lang.instrument (Java Agent)](https://docs.oracle.com/en/java/javase/17/docs/api/java.instrument/java/lang/instrument/package-summary.html) | dumper | minecraft-java | Штатный механизм JVM: агент с ClassFileTransformer видит байткод каждого загружаемого класса. |
| [jattach](https://github.com/jattach/jattach) | injector | minecraft-java | Подключает агента к уже работающей JVM без JDK на машине. |
| [SpongePowered Mixin](https://github.com/SpongePowered/Mixin) | hook | minecraft-java | Штатный способ править классы игры на загрузке: @Inject, @Redirect, @Overwrite. |
| [Fabric Loader](https://fabricmc.net/) | loader | minecraft-java | Лёгкий модлоадер Minecraft, маппинги Yarn, быстрое обновление под новые версии. |
| [MinecraftForge / NeoForge](https://files.minecraftforge.net/) | loader | minecraft-java | Тяжёлый модлоадер с собственным API и событиями. |
| [Enigma](https://github.com/FabricMC/Enigma) | mapping | minecraft-java | Ручное переименование обфусцированных классов с сохранением маппингов. |
| [Маппинги Minecraft (Yarn / MCP / Mojang / Parchment)](https://fabricmc.net/wiki/tutorial:mappings) | mapping | minecraft-java | Наборы имён для обфусцированных классов игры; без них декомпиляция нечитаема. |
| [SpecialSource / tiny-remapper](https://github.com/FabricMC/tiny-remapper) | mapping | minecraft-java | Ремаппинг jar между наборами имён (обфа ↔ Yarn ↔ Mojang). |
| [dnSpyEx](https://github.com/dnSpyEx/dnSpy) | decompiler | dotnet, unity-mono | Декомпилятор и отладчик .NET с правкой IL и сохранением сборки. |
| [ILSpy](https://github.com/icsharpcode/ILSpy) | decompiler | dotnet | Декомпилятор .NET, есть CLI (ilspycmd) для пакетной работы. |
| [de4dot](https://github.com/de4dot/de4dot) | deobfuscator | dotnet | Снимает распространённые .NET-обфускаторы и восстанавливает имена. |
| [Mono.Cecil](https://github.com/jbevain/cecil) | build | dotnet, unity-mono | Чтение и запись .NET-сборок из кода — база для своих патчеров. |
| [HarmonyX / Lib.Harmony](https://github.com/BepInEx/HarmonyX) | hook | unity-mono, dotnet | Рантайм-патчинг managed-методов: Prefix, Postfix, Transpiler. |
| [BepInEx](https://github.com/BepInEx/BepInEx) | loader | unity-mono, unity-il2cpp | Модлоадер Unity: работает и на Mono, и на IL2CPP, несёт Harmony. |
| [MelonLoader](https://github.com/LavaGang/MelonLoader) | loader | unity-mono, unity-il2cpp | Альтернативный модлоадер Unity с собственным API и поддержкой IL2CPP. |
| [UnityExplorer](https://github.com/sinai-dev/UnityExplorer) | analysis | unity-mono, unity-il2cpp | Рантайм-инспектор сцены: иерархия объектов, компоненты, значения полей, вызов методов. |
| [AssetRipper](https://github.com/AssetRipper/AssetRipper) | dumper | unity-mono, unity-il2cpp | Разбирает бандлы Unity обратно в проект: ассеты, сцены, скрипты. |
| [UABEA (AssetBundleExtractor)](https://github.com/nesrak1/UABEA) | dumper | unity-mono | Просмотр и правка ассетов и бандлов Unity. |
| [Il2CppDumper](https://github.com/Perfare/Il2CppDumper) | dumper | unity-il2cpp, android | Из GameAssembly.dll + global-metadata.dat достаёт классы, методы и их RVA. |
| [Il2CppInspectorRedux](https://github.com/LukeFZ/Il2CppInspectorRedux) | dumper | unity-il2cpp | Дампер IL2CPP с генерацией C++ SDK и скриптов для IDA/Ghidra/BinaryNinja. |
| [Cpp2IL](https://github.com/SamboyCoding/Cpp2IL) | dumper | unity-il2cpp | Восстанавливает managed-сборки из IL2CPP-бинаря, вплоть до тел методов. |
| [Dumper-7](https://github.com/Encryqed/Dumper-7) | sdk-gen | unreal | Внутренний дампер UE4/UE5: сам находит GObjects/GNames и генерит полный C++ SDK. |
| [UE4SS](https://github.com/UE4SS-RE/RE-UE4SS) | loader | unreal | Скриптовая система для UE: Lua/C++ моды, живой просмотр объектов, дамп CXX-хедеров. |
| [FModel](https://github.com/4sval/FModel) | analysis | unreal | Просмотр и распаковка .pak/.utoc архивов Unreal. |
| [source2gen](https://github.com/neverlosecc/source2gen) | sdk-gen | source-engine | Генерирует заголовки схемы Source 2 (классы, поля, оффсеты) прямо из игры. |
| [cs2-dumper](https://github.com/a2x/cs2-dumper) | dumper | source-engine | Внешний дампер оффсетов, интерфейсов и схемы CS2 в C++/C#/JSON. |
| [hazedumper](https://github.com/frk1/hazedumper) | dumper | source-engine | Классический сигнатурный дампер оффсетов Source (CS:GO). Полезен как образец подхода. |
| [IDA Pro / IDA Free](https://hex-rays.com/ida-pro/) | disassembler | native-windows, reverse, android, unity-il2cpp | Дизассемблер и декомпилятор (Hex-Rays) — рабочий стандарт реверса. |
| [Ghidra](https://ghidra-sre.org/) | disassembler | native-windows, reverse, android | Бесплатный дизассемблер с декомпилятором и скриптами; берёт скрипты Il2CppDumper. |
| [x64dbg](https://x64dbg.com/) | debugger | native-windows, reverse | Отладчик уровня пользователя для Windows, с плагинами (Scylla, xAnalyzer). |
| [Scylla](https://github.com/NtQuery/Scylla) | dumper | native-windows, reverse | Дамп PE-образа из памяти процесса с восстановлением таблицы импортов. |
| [Cheat Engine](https://cheatengine.org/) | memory | native-windows, unity-mono, reverse | Поиск значений в памяти, указателей, точек доступа; свой дизассемблер и Lua-скрипты. |
| [ReClass.NET](https://github.com/ReClassNET/ReClass.NET) | analysis | native-windows, reverse | Восстановление структур из памяти с экспортом в C++-заголовки. |
| [System Informer (Process Hacker)](https://systeminformer.sourceforge.io/) | analysis | native-windows | Процессы, модули, хендлы, потоки, память — обзорная разведка по цели. |
| [Detect It Easy](https://github.com/horsicq/Detect-It-Easy) | analysis | native-windows, reverse | Определяет упаковщик, протектор и компилятор бинаря. |
| [PE-bear](https://github.com/hasherezade/pe-bear) | analysis | native-windows, reverse | Разбор PE: секции, импорты, ресурсы, точки входа. |
| [MinHook](https://github.com/TsudaKageyu/minhook) | hook | native-windows | Минималистичный inline-хук x86/x64. |
| [Microsoft Detours](https://github.com/microsoft/Detours) | hook | native-windows | Библиотека перехвата функций от Microsoft, с транзакциями. |
| [kiero](https://github.com/Rebzzel/kiero) | hook | native-windows | Достаёт таблицы методов графических API (D3D9/11/12, OpenGL, Vulkan) для хука рендера. |
| [Dear ImGui](https://github.com/ocornut/imgui) | render | native-windows | Immediate-mode GUI: стандарт для внутриигровых меню. |
| [Frida](https://frida.re/) | hook | android, native-windows, reverse | Динамическая инструментация: JS-скрипты хукают нативные функции в живом процессе. |
| [JADX](https://github.com/skylot/jadx) | decompiler | android, minecraft-java | Декомпилятор APK/DEX в читаемую Java, с GUI и поиском. |
| [Apktool](https://apktool.org/) | build | android | Разбор APK в smali и обратная сборка — база для патча приложения. |
| [LSPosed / Xposed](https://github.com/LSPosed/LSPosed) | hook | android | Хук Java-методов в чужих приложениях без правки APK (нужен root). |
| [MemProcFS](https://github.com/ufrisk/MemProcFS) | memory | dma, reverse | Память целевой машины как файловая система; работает поверх LeechCore/PCILeech. |
| [PCILeech](https://github.com/ufrisk/pcileech) | memory | dma | Прямой доступ к памяти через PCIe-устройство. |
| [AutoHotkey v2](https://www.autohotkey.com/) | build | script | Скрипты ввода и автоматизации, чтение памяти через DllCall. |
| [Luau](https://luau.org/) | build | roblox, script | Диалект Lua от Roblox: типы, свои ограничения стандартной библиотеки. |
| [Wireshark](https://www.wireshark.org/) | network | native-windows, web, reverse | Анализ сетевого трафика; для игрового протокола — первая точка входа. |
| [HTTP Toolkit / Fiddler](https://httptoolkit.com/) | network | web, android | Перехват и правка HTTPS-трафика приложений и лоадеров. |

Виды: `dumper` — достаёт структуры и оффсеты, `decompiler` / `disassembler` — читают код,
`deobfuscator` — снимает защиту имён, `injector` / `hook` — внедрение и перехват,
`loader` — модлоадер, `sdk-gen` — генерирует заголовки под свой код, `mapping` — имена символов,
`memory` — работа с памятью процесса, `analysis` — разведка, `render` — интерфейс, `build` — тулчейн.
