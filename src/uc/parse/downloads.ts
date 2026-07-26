import * as cheerio from 'cheerio';
import { abs, parseCount, timeOf } from './util.js';

export interface DownloadEntry {
  id: number | null;
  title: string;
  url: string | null;
  category: string | null;
  author: string | null;
  date: string | null;
  downloads: number | null;
  rating: number | null;
  description: string | null;
}

export interface DownloadFile {
  id: number | null;
  title: string;
  url: string | null;
  downloadUrl: string | null;
  author: string | null;
  date: string | null;
  downloads: number | null;
  rating: number | null;
  size: string | null;
  description: string;
  version: string | null;
  category: string | null;
  screenshots: string[];
  changelog: string | null;
}

export interface DownloadCategory {
  id: number | null;
  title: string;
  url: string | null;
  fileCount: number | null;
  subCategories: Array<{ id: number | null; title: string; url: string | null }>;
}

export function parseDownloadCategories(html: string): DownloadCategory[] {
  const $ = cheerio.load(html);
  const cats: DownloadCategory[] = [];

  $('table.tborder tr, .download-category, li.downloadcategory').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a[href*="downloads.php?do=cat"], a[href*="do=cat"]').first();
    if (!$link.length) return;
    const href = abs($link.attr('href'));
    const idMatch = href?.match(/id=(\d+)/);
    const id = idMatch ? Number.parseInt(idMatch[1], 10) : null;
    const title = $link.text().replace(/\s+/g, ' ').trim();
    const fileCount = parseCount($el.find('.filecount, td:last-child').first().text());

    const subCats: DownloadCategory['subCategories'] = [];
    $el.find('.subcat a, .subcategory a').each((__, a) => {
      const subHref = abs($(a).attr('href'));
      const subIdMatch = subHref?.match(/id=(\d+)/);
      subCats.push({
        id: subIdMatch ? Number.parseInt(subIdMatch[1], 10) : null,
        title: $(a).text().replace(/\s+/g, ' ').trim(),
        url: subHref,
      });
    });

    cats.push({ id, title, url: href, fileCount, subCategories: subCats });
  });

  return cats;
}

export function parseDownloadList(html: string): DownloadEntry[] {
  const $ = cheerio.load(html);
  const entries: DownloadEntry[] = [];

  $('tr.download_row, .download-entry, tr[id^="download_"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a[href*="downloads.php?do=file"], a[href*="do=file"]').first();
    const href = abs($link.attr('href'));
    const idMatch = href?.match(/id=(\d+)/);
    entries.push({
      id: idMatch ? Number.parseInt(idMatch[1], 10) : null,
      title: $link.text().replace(/\s+/g, ' ').trim(),
      url: href,
      category: $el.find('.download_cat a, .category').first().text().trim() || null,
      author: $el.find('.username, .download_author a').first().text().trim() || null,
      date: timeOf($el.find('time, .date').first()) || null,
      downloads: parseCount($el.find('.download_count, .downloads').first().text()),
      rating: parseCount($el.find('.rating img').first().attr('alt')),
      description: $el.find('.download_desc, .description').first().text().replace(/\s+/g, ' ').trim() || null,
    });
  });

  return entries;
}

export function parseDownloadFile(html: string): DownloadFile {
  const $ = cheerio.load(html);

  const title = $('h1, .pagetitle h1, .download_title h1').first().text().replace(/\s+/g, ' ').trim();
  const $downloadLink = $('a[href*="do=download"], a.download-button, #download_button').first();
  const downloadUrl = abs($downloadLink.attr('href'));
  const idMatch = downloadUrl?.match(/downloadid=(\d+)|id=(\d+)/);

  const screenshots: string[] = [];
  $('.screenshot img, .download_screenshot img').each((_, img) => {
    const src = abs($(img).attr('src') || $(img).attr('data-src'));
    if (src) screenshots.push(src);
  });

  const description = $('.download_description, .download_body, .fileinfo .description').first()
    .text().replace(/\s+/g, ' ').trim();

  const changelog = $('.changelog, .download_changelog').first().text().replace(/\s+/g, ' ').trim() || null;

  let version: string | null = null;
  let size: string | null = null;
  let downloads: number | null = null;
  let category: string | null = null;
  let author: string | null = null;
  let date: string | null = null;

  $('.fileinfo dl, .download_info dl, .download-details dt').each((_, dt) => {
    const label = $(dt).text().toLowerCase();
    const value = $(dt).next('dd').text().replace(/\s+/g, ' ').trim();
    if (label.includes('version')) version = value;
    else if (label.includes('size')) size = value;
    else if (label.includes('download')) downloads = parseCount(value);
    else if (label.includes('category')) category = value;
    else if (label.includes('author') || label.includes('submitted')) author = value;
    else if (label.includes('date') || label.includes('added')) date = value;
  });

  return {
    id: idMatch ? Number.parseInt(idMatch[1] || idMatch[2], 10) : null,
    title,
    url: null,
    downloadUrl,
    author,
    date,
    downloads,
    rating: parseCount($('.rating img').first().attr('alt')),
    size,
    description,
    version,
    category,
    screenshots,
    changelog,
  };
}
