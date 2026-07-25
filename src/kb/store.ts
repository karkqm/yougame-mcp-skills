/**
 * Локальная база знаний: инструменты, находки и сессии ресерча.
 *
 * Один JSON-файл (`~/.yougame-mcp/kb.json`), запись атомарная через временный файл.
 * База переживает перезапуск клиента — в этом весь смысл: второй раз ту же тему
 * на форуме искать не нужно.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { ToolKind } from './catalog.js';

export interface KbSource {
  url: string;
  title?: string;
  /** theory — гайд/статья, code — исходник, discussion — обсуждение, external — вне форума. */
  kind?: 'theory' | 'code' | 'discussion' | 'external';
  /** Прочитаны ли комментарии: на форуме там живут фиксы и «не работает на версии X». */
  commentsRead?: boolean;
  verdict?: string;
}

export interface KbTool {
  id: string;
  name: string;
  kind: ToolKind;
  domains: string[];
  lang?: string;
  url?: string;
  summary: string;
  notes?: string;
  tags: string[];
  sources: KbSource[];
  addedAt: string;
  updatedAt: string;
}

export type NoteKind = 'fact' | 'pitfall' | 'snippet' | 'version' | 'gap';

export interface KbNote {
  id: string;
  sessionId?: string;
  domain?: string;
  kind: NoteKind;
  text: string;
  sources: KbSource[];
  tags: string[];
  addedAt: string;
}

export interface KbSession {
  id: string;
  task: string;
  domain: string;
  taskKind: string;
  status: 'open' | 'ready' | 'done' | 'abandoned';
  queries: string[];
  forumIds: number[];
  mustKnow: string[];
  sources: KbSource[];
  noteIds: string[];
  toolIds: string[];
  /** Заполняется, если гейт прошли принудительно. */
  override?: { reason: string; at: string };
  startedAt: string;
  updatedAt: string;
}

interface KbFile {
  version: 1;
  tools: KbTool[];
  notes: KbNote[];
  sessions: KbSession[];
}

const EMPTY: KbFile = { version: 1, tools: [], notes: [], sessions: [] };

let cache: KbFile | null = null;

function load(): KbFile {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(config.kbPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<KbFile>;
    cache = {
      version: 1,
      tools: parsed.tools ?? [],
      notes: parsed.notes ?? [],
      sessions: parsed.sessions ?? [],
    };
  } catch {
    cache = { ...EMPTY, tools: [], notes: [], sessions: [] };
  }
  return cache;
}

function save(): void {
  const data = load();
  fs.mkdirSync(path.dirname(config.kbPath), { recursive: true });
  const tmp = `${config.kbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, config.kbPath);
}

/** Сбросить кэш — базу мог поправить пользователь руками. */
export function reload(): void {
  cache = null;
}

function now(): string {
  return new Date().toISOString();
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || newId('tool')
  );
}

// ---------------------------------------------------------------- инструменты

export interface AddToolInput {
  name: string;
  kind: ToolKind;
  domains: string[];
  summary: string;
  lang?: string;
  url?: string;
  notes?: string;
  tags?: string[];
  sources?: KbSource[];
}

export function addTool(input: AddToolInput): { tool: KbTool; created: boolean } {
  const db = load();
  const id = slug(input.name);
  const existing = db.tools.find((t) => t.id === id);
  if (existing) {
    existing.kind = input.kind;
    existing.domains = [...new Set([...existing.domains, ...input.domains])];
    existing.summary = input.summary || existing.summary;
    existing.lang = input.lang ?? existing.lang;
    existing.url = input.url ?? existing.url;
    existing.notes = input.notes ?? existing.notes;
    existing.tags = [...new Set([...existing.tags, ...(input.tags ?? [])])];
    existing.sources = dedupeSources([...existing.sources, ...(input.sources ?? [])]);
    existing.updatedAt = now();
    save();
    return { tool: existing, created: false };
  }
  const tool: KbTool = {
    id,
    name: input.name,
    kind: input.kind,
    domains: input.domains,
    lang: input.lang,
    url: input.url,
    summary: input.summary,
    notes: input.notes,
    tags: input.tags ?? [],
    sources: input.sources ?? [],
    addedAt: now(),
    updatedAt: now(),
  };
  db.tools.push(tool);
  save();
  return { tool, created: true };
}

export function removeTool(id: string): boolean {
  const db = load();
  const before = db.tools.length;
  db.tools = db.tools.filter((t) => t.id !== id);
  if (db.tools.length === before) return false;
  save();
  return true;
}

export function listTools(): KbTool[] {
  return load().tools;
}

// ---------------------------------------------------------------- находки

export function addNote(input: {
  kind: NoteKind;
  text: string;
  sessionId?: string;
  domain?: string;
  sources?: KbSource[];
  tags?: string[];
}): KbNote {
  const db = load();
  const note: KbNote = {
    id: newId('note'),
    sessionId: input.sessionId,
    domain: input.domain,
    kind: input.kind,
    text: input.text,
    sources: input.sources ?? [],
    tags: input.tags ?? [],
    addedAt: now(),
  };
  db.notes.push(note);
  const session = input.sessionId ? db.sessions.find((s) => s.id === input.sessionId) : undefined;
  if (session) {
    session.noteIds.push(note.id);
    session.sources = dedupeSources([...session.sources, ...note.sources]);
    session.updatedAt = now();
  }
  save();
  return note;
}

export function listNotes(): KbNote[] {
  return load().notes;
}

export function notesOf(sessionId: string): KbNote[] {
  const db = load();
  return db.notes.filter((n) => n.sessionId === sessionId);
}

// ---------------------------------------------------------------- сессии

export function createSession(input: {
  task: string;
  domain: string;
  taskKind: string;
  queries: string[];
  forumIds: number[];
  mustKnow: string[];
}): KbSession {
  const db = load();
  const session: KbSession = {
    id: newId('ses'),
    task: input.task,
    domain: input.domain,
    taskKind: input.taskKind,
    status: 'open',
    queries: input.queries,
    forumIds: input.forumIds,
    mustKnow: input.mustKnow,
    sources: [],
    noteIds: [],
    toolIds: [],
    startedAt: now(),
    updatedAt: now(),
  };
  db.sessions.push(session);
  // Держим историю обозримой.
  if (db.sessions.length > 200) db.sessions = db.sessions.slice(-200);
  save();
  return session;
}

export function getSession(id: string): KbSession | undefined {
  return load().sessions.find((s) => s.id === id);
}

/** Последняя незакрытая сессия — чтобы не таскать id между вызовами. */
export function currentSession(): KbSession | undefined {
  const open = load().sessions.filter((s) => s.status === 'open');
  return open[open.length - 1];
}

export function listSessions(limit = 20): KbSession[] {
  return load().sessions.slice(-limit).reverse();
}

export function updateSession(id: string, patch: Partial<KbSession>): KbSession | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  Object.assign(session, patch, { updatedAt: now() });
  save();
  return session;
}

export function addSources(id: string, sources: KbSource[]): KbSession | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  session.sources = dedupeSources([...session.sources, ...sources]);
  session.updatedAt = now();
  save();
  return session;
}

export function attachTools(id: string, toolIds: string[]): KbSession | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  session.toolIds = [...new Set([...session.toolIds, ...toolIds])];
  session.updatedAt = now();
  save();
  return session;
}

// ---------------------------------------------------------------- прочее

function dedupeSources(list: KbSource[]): KbSource[] {
  const map = new Map<string, KbSource>();
  for (const s of list) {
    const prev = map.get(s.url);
    // Более информативная запись вытесняет менее информативную.
    if (!prev) map.set(s.url, s);
    else
      map.set(s.url, {
        ...prev,
        ...s,
        commentsRead: prev.commentsRead || s.commentsRead,
        title: s.title ?? prev.title,
        verdict: s.verdict ?? prev.verdict,
      });
  }
  return [...map.values()];
}

export function stats(): { tools: number; notes: number; sessions: number; path: string } {
  const db = load();
  return { tools: db.tools.length, notes: db.notes.length, sessions: db.sessions.length, path: config.kbPath };
}
