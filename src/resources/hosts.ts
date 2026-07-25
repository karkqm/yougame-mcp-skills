/**
 * Реестр файлообменников: как распознать ссылку и как получить прямой файл.
 * Тексты `instruction` отдаются модели, чтобы она не гадала, что делать со ссылкой.
 */
export type HostStrategy = 'direct' | 'api' | 'scrape' | 'browser' | 'manual';

export interface HostSpec {
  id: string;
  name: string;
  match: RegExp;
  strategy: HostStrategy;
  /** Что делать модели, если автозагрузка не сработала. */
  instruction: string;
  /** Требуется ли активная сессия форума. */
  needsForumAuth?: boolean;
}

export const HOSTS: HostSpec[] = [
  {
    id: 'yougame-attachment',
    name: 'Вложение форума yougame.biz',
    match: /yougame\.biz\/attachments\//i,
    strategy: 'direct',
    needsForumAuth: true,
    instruction:
      'Вложение отдаётся напрямую по ссылке /attachments/<id>/ с куками сессии. Если пришёл HTML вместо файла — сессия истекла: вызови yg_login и повтори yg_download.',
  },
  {
    id: 'github',
    name: 'GitHub',
    match: /(^|\/\/)(www\.)?github\.com\//i,
    strategy: 'direct',
    instruction:
      'Релиз (/releases/download/...) качается напрямую. Файл вида /blob/ переписывается в raw.githubusercontent.com. Ссылка на репозиторий — качается ZIP ветки через codeload. Для работы с кодом лучше git clone, а не архив.',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    match: /dropbox\.com\//i,
    strategy: 'direct',
    instruction:
      'Заменить параметр dl=0 на dl=1 (или добавить ?dl=1) — Dropbox отдаёт файл редиректом на dl.dropboxusercontent.com. Папки (/scl/fo/) отдаются ZIP-архивом. Если отвечает HTML-страница «file not found» — ссылка протухла, ищи зеркало в теме.',
  },
  {
    id: 'workupload',
    name: 'WorkUpload',
    match: /workupload\.com\//i,
    strategy: 'browser',
    instruction:
      'Обычному HTTP-клиенту отдаёт JS-заглушку «Are you a human?», поэтому качается только через браузер (yg_download делает это сам). ZIP целиком (/archive/<id>) доступен лишь с аккаунтом, поэтому содержимое архива скачивается по файлам — в ответе будет массив files. При «too many downloads» подождать несколько минут.',
  },
  {
    id: 'mega',
    name: 'MEGA',
    match: /mega\.(nz|io|co\.nz)\//i,
    strategy: 'browser',
    instruction:
      'MEGA шифрует файлы на клиенте: прямого HTTP-адреса нет. Качать только через браузерный режим (yg_download browser=true) — откроется окно, файл дойдёт сам. Если в ссылке нет ключа после #, файл скачать невозможно — ключ надо искать в теме.',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    match: /(drive|docs)\.google\.com\//i,
    strategy: 'api',
    instruction:
      'Идентификатор берётся из /file/d/<id>/ или ?id=<id>, затем качается https://drive.usercontent.google.com/download?id=<id>&export=download&confirm=t. Для больших файлов Google требует подтверждение — параметр confirm=t его снимает. «Quota exceeded» лечится только ожиданием или зеркалом.',
  },
  {
    id: 'yandex-disk',
    name: 'Яндекс.Диск',
    match: /(disk\.yandex\.[a-z.]+|yadi\.sk)\//i,
    strategy: 'api',
    instruction:
      'Публичная ссылка резолвится официальным API: https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=<ссылка>, в ответе поле href — прямой адрес (живёт несколько минут).',
  },
  {
    id: 'mediafire',
    name: 'MediaFire',
    match: /mediafire\.com\//i,
    strategy: 'scrape',
    instruction:
      'На странице файла есть кнопка #downloadButton с прямым href на download****.mediafire.com. Забрать href со страницы и скачать. Если стоит капча — переключиться на браузерный режим.',
  },
  {
    id: 'pixeldrain',
    name: 'Pixeldrain',
    match: /pixeldrain\.com\//i,
    strategy: 'api',
    instruction: 'Прямой адрес: https://pixeldrain.com/api/file/<id>?download (id берётся из /u/<id>).',
  },
  {
    id: 'gofile',
    name: 'Gofile',
    match: /gofile\.io\//i,
    strategy: 'browser',
    instruction:
      'Gofile требует гостевой токен и WT-параметр, которые выдаются только JS. Надёжнее браузерный режим (yg_download browser=true).',
  },
  {
    id: 'dropmefiles',
    name: 'DropMeFiles',
    match: /dropmefiles\.com\//i,
    strategy: 'browser',
    instruction:
      'Ссылка живёт ограниченное время и требует JS-подтверждения. Качать браузерным режимом; если файл уже удалён — просить перезалив в теме.',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    match: /(1drv\.ms|onedrive\.live\.com)\//i,
    strategy: 'browser',
    instruction: 'Пробовать добавить ?download=1; при HTML-ответе — браузерный режим.',
  },
  {
    id: 'sendspace',
    name: 'SendSpace',
    match: /sendspace\.com\//i,
    strategy: 'scrape',
    instruction: 'На странице есть ссылка #download_button — забрать href и скачать напрямую.',
  },
  {
    id: 'krakenfiles',
    name: 'KrakenFiles',
    match: /krakenfiles\.com\//i,
    strategy: 'scrape',
    instruction: 'Прямая ссылка лежит в атрибуте data-file-hash / в форме на странице; при неудаче — браузерный режим.',
  },
  {
    id: 'discord-cdn',
    name: 'Discord CDN',
    match: /(cdn|media)\.discordapp\.(com|net)\//i,
    strategy: 'direct',
    instruction:
      'Качается напрямую, но ссылки подписаны и живут ~24 часа (параметры ex/is/hm). Просроченная ссылка даёт 404 — нужен свежий линк из темы.',
  },
  {
    id: 'catbox',
    name: 'Catbox / файлохостинг с прямой отдачей',
    match: /(files\.catbox\.moe|litter\.catbox\.moe|qu\.ax|tmpfiles\.org)\//i,
    strategy: 'direct',
    instruction: 'Отдаёт файл напрямую по ссылке.',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    match: /(t\.me|telegram\.me)\//i,
    strategy: 'manual',
    instruction:
      'Файл лежит в чате Telegram — автоматически скачать нельзя. Сообщи пользователю ссылку и попроси забрать файл вручную; продолжай работу с тем, что доступно.',
  },
  {
    id: 'boosty-patreon',
    name: 'Boosty / Patreon / платная подписка',
    match: /(boosty\.to|patreon\.com|funpay\.com)\//i,
    strategy: 'manual',
    instruction:
      'Платный контент. Не пытайся обходить оплату: сообщи пользователю ссылку и стоимость, дальше решение за ним.',
  },
];

const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|jar|exe|dll|msi|apk|py|lua|txt|json|cfg|pdf|png|jpe?g|webp|mp4|so|bin|iso)(\?|$)/i;

export interface HostMatch {
  host: HostSpec | null;
  /** Похоже на прямую ссылку на файл. */
  looksDirect: boolean;
  hostname: string;
}

export function classify(rawUrl: string): HostMatch {
  let hostname = '';
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    /* невалидный URL */
  }
  const host = HOSTS.find((h) => h.match.test(rawUrl)) ?? null;
  return { host, looksDirect: ARCHIVE_EXT.test(rawUrl), hostname };
}

/** Короткая подсказка для модели по конкретной ссылке. */
export function instructionFor(rawUrl: string): string {
  const { host, looksDirect } = classify(rawUrl);
  if (host) return `${host.name}: ${host.instruction}`;
  if (looksDirect) return 'Прямая ссылка на файл: качается обычным GET (yg_download).';
  return 'Неизвестный хостинг: yg_download сначала попробует прямой GET, затем поиск ссылки в HTML, затем браузерный режим. Если всё мимо — покажи ссылку пользователю.';
}
