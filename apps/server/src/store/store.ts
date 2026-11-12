import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  applyEvent,
  initialState,
  SomeCodeError,
  HISTORY_PAGE_ITEMS,
  type Item,
  type SessionHistoryPage,
  type SessionState,
  type NormalizedEvent,
  type StoredEvent,
} from '@somecode/protocol';
import { SCHEMA_SQL } from './schema.sql.ts';
import type { ScheduleSpec } from './schedule.ts';

export const MAX_EVENT_BYTES = 1_048_576;
export const MAX_EVENT_PAGE = 200;
const MAX_EVENT_PAGE_BYTES = 1024 * 1024;
const MAX_HISTORY_PAGE_BYTES = 2 * 1024 * 1024;

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_RAW_BYTES = 256 * 1024;
const MAX_DIFF_BYTES = 256 * 1024;
// Last-resort caps when an event with many large parts is still over MAX_EVENT_BYTES.
const FALLBACK_BYTES = 1024;
const MAX_ARRAY_ITEMS = 100;
const TRUNCATION_SUFFIX = '…[truncated]';

export type Project = { id: string; name: string; path: string; createdAt: number };
export type SessionRow = {
  id: string;
  projectId: string;
  agentId: string;
  acpSessionId: string | null;
  title: string | null;
  createdAt: number;
};

export type Memory = { id: string; projectId: string; text: string; createdAt: number };
export type ScheduledTask = {
  id: string;
  projectId: string;
  agentId: string;
  title: string;
  prompt: string;
  spec: ScheduleSpec;
  enabled: boolean;
  nextRun: number | null;
  lastRun: number | null;
  lastSessionId: string | null;
  runs: number;
  createdAt: number;
};
export type HistoryHit = {
  sessionId: string;
  seq: number;
  kind: 'user' | 'agent';
  snippet: string;
  sessionTitle: string | null;
  projectName: string;
  agentId: string;
  createdAt: number;
};

export interface Store {
  addProject(p: { name: string; path: string }): Project;
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createSession(s: { projectId: string; agentId: string }): SessionRow;
  getSession(id: string): SessionRow | undefined;
  listSessions(projectId: string): SessionRow[];
  setAcpSessionId(id: string, acpSessionId: string): void;
  appendEvent(sessionId: string, event: NormalizedEvent): StoredEvent;
  eventsSince(sessionId: string, afterSeq: number, limit?: number): StoredEvent[];
  history(sessionId: string, beforeSeq?: number, limit?: number): SessionHistoryPage;
  pendingPermissions(sessionId: string, afterSeq?: number): { seq: number; requestId: string }[];
  lastSeq(sessionId: string): number;
  /** Small server-side preferences (JSON text by key). */
  renameSession(id: string, title: string): boolean;
  renameProject(id: string, name: string): boolean;
  /** Removes a session with its events, projection and saved settings. */
  deleteSession(id: string): boolean;
  /** Rewinds a session's events to before the specified sequence number. */
  rewindSession(sessionId: string, beforeSeq: number): void;
  /** Removes a project and all of its sessions. */
  deleteProject(id: string): boolean;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  /** Project memory: notes every agent working in the project is told about. */
  addMemory(projectId: string, text: string): Memory;
  listMemories(projectId: string): Memory[];
  deleteMemory(id: string): boolean;
  /** Scheduled tasks. */
  addTask(t: { projectId: string; agentId: string; title: string; prompt: string; spec: ScheduleSpec; nextRun: number }): ScheduledTask;
  listTasks(): ScheduledTask[];
  getTask(id: string): ScheduledTask | undefined;
  updateTask(id: string, patch: { enabled?: boolean; title?: string; nextRun?: number | null }): boolean;
  /** A task ran: remember when and in which chat, and when it runs next (null ends it). */
  recordTaskRun(id: string, run: { at: number; sessionId: string | null; nextRun: number | null }): void;
  deleteTask(id: string): boolean;
  /** Enabled tasks whose time has come. */
  dueTasks(now: number): ScheduledTask[];
  /** Messages of past chats (the user's and the agent's) that contain every word of the query, newest first. */
  searchHistory(query: string, opts?: { projectId?: string; limit?: number }): HistoryHit[];
  /** A chat as plain text (user and agent messages and tool titles), from `afterSeq`, at most `maxChars`. */
  transcript(sessionId: string, opts?: { afterSeq?: number; maxChars?: number }): { text: string; lastSeq: number; truncated: boolean };
  close(): void;
}

type Limits = { text: number; raw: number; diff: number };
const NORMAL_LIMITS: Limits = { text: MAX_TEXT_BYTES, raw: MAX_RAW_BYTES, diff: MAX_DIFF_BYTES };
const FALLBACK_LIMITS: Limits = { text: FALLBACK_BYTES, raw: FALLBACK_BYTES, diff: FALLBACK_BYTES };

/** Cuts `text` to at most `max` UTF-8 bytes (on a character boundary) and appends the marker. */
function truncateText(text: string, max: number): string {
  if (text.length * 3 <= max) return text; // cannot exceed max bytes
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return text;
  let cut = max;
  while (cut > 0 && (buf[cut]! & 0xc0) === 0x80) cut--;
  return buf.subarray(0, cut).toString('utf8') + TRUNCATION_SUFFIX;
}

function capRaw(value: unknown, max: number): unknown {
  if (value === undefined) return value;
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  const bytes = Buffer.byteLength(json, 'utf8');
  return bytes > max ? { truncated: true, bytes } : value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function capContentItem(item: unknown, limits: Limits): unknown {
  if (!isRecord(item)) return item;
  if (item.type === 'text' && typeof item.text === 'string') {
    return { ...item, text: truncateText(item.text, limits.text) };
  }
  if (item.type === 'diff') {
    const next = { ...item };
    if (typeof item.oldText === 'string') next.oldText = truncateText(item.oldText, limits.diff);
    if (typeof item.newText === 'string') next.newText = truncateText(item.newText, limits.diff);
    return next;
  }
  return item;
}

function capContent(content: unknown, limits: Limits): unknown {
  return Array.isArray(content) ? content.map((c) => capContentItem(c, limits)) : content;
}

function limitEvent(event: NormalizedEvent, limits: Limits): NormalizedEvent {
  switch (event.type) {
    case 'user_message':
    case 'agent_message':
    case 'agent_thought':
      return { ...event, text: truncateText(event.text, limits.text) };
    case 'tool_call': {
      const next = {
        ...event,
        title: truncateText(event.title, limits.text),
        content: capContent(event.content, limits) as typeof event.content,
      };
      if ('rawInput' in event) next.rawInput = capRaw(event.rawInput, limits.raw);
      return next;
    }
    case 'tool_call_update': {
      const patch = { ...event.patch };
      if (typeof patch.title === 'string') patch.title = truncateText(patch.title, limits.text);
      if ('rawInput' in patch) patch.rawInput = capRaw(patch.rawInput, limits.raw);
      if ('rawOutput' in patch) patch.rawOutput = capRaw(patch.rawOutput, limits.raw);
      if ('content' in patch) patch.content = capContent(patch.content, limits);
      return { ...event, patch };
    }
    case 'permission_request':
      return { ...event, title: truncateText(event.title, limits.text) };
    case 'plan':
      return { ...event, entries: event.entries.map((e) => ({ ...e, content: truncateText(e.content, limits.text) })) };
    case 'unsupported':
      return { ...event, raw: capRaw(event.raw, limits.raw) };
    default:
      return event;
  }
}

/** Last-but-one resort: every string leaf cut to FALLBACK_BYTES and every array to MAX_ARRAY_ITEMS. */
function truncateDeep(value: unknown): unknown {
  if (typeof value === 'string') return truncateText(value, FALLBACK_BYTES);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map(truncateDeep);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateDeep(v)]));
  return value;
}

const tooBig = (json: string): boolean => Buffer.byteLength(json, 'utf8') >= MAX_EVENT_BYTES;

/**
 * Bounds an event's serialized size below MAX_EVENT_BYTES. Normal caps first (message text,
 * titles, plan entries, text/diff content, raw payloads); if still too big, the same at
 * FALLBACK_BYTES; then every string leaf and array; and as a last resort the event is replaced
 * by a small schema-valid `unsupported` marker recording the original size.
 */
function boundEvent(event: NormalizedEvent): { event: NormalizedEvent; json: string } {
  let bounded = limitEvent(event, NORMAL_LIMITS);
  let json = JSON.stringify(bounded);
  if (tooBig(json)) {
    bounded = limitEvent(bounded, FALLBACK_LIMITS);
    json = JSON.stringify(bounded);
  }
  if (tooBig(json)) {
    // String and array cuts keep every field's type, so the event still matches its schema.
    bounded = truncateDeep(bounded) as NormalizedEvent;
    json = JSON.stringify(bounded);
  }
  if (tooBig(json)) {
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    bounded = { type: 'unsupported', sessionUpdate: event.type, raw: { truncated: true, bytes } };
    json = JSON.stringify(bounded);
  }
  return { event: bounded, json };
}

type ProjectRecord = { id: string; name: string; path: string; created_at: number };
type SessionRecord = {
  id: string;
  project_id: string;
  agent_id: string;
  acp_session_id: string | null;
  title: string | null;
  created_at: number;
};

const toProject = (r: ProjectRecord): Project => ({
  id: r.id,
  name: r.name,
  path: r.path,
  createdAt: r.created_at,
});
const toSession = (r: SessionRecord): SessionRow => ({
  id: r.id,
  projectId: r.project_id,
  agentId: r.agent_id,
  acpSessionId: r.acp_session_id,
  title: r.title,
  createdAt: r.created_at,
});

export function openStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SCHEMA_SQL);

  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)',
  );
  const selectProjects = db.prepare('SELECT * FROM projects ORDER BY created_at, rowid');
  const selectProject = db.prepare('SELECT * FROM projects WHERE id = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (id, project_id, agent_id, created_at) VALUES (?, ?, ?, ?)',
  );
  const selectSession = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const selectSessions = db.prepare(
    'SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at, rowid',
  );
  const updateAcpId = db.prepare('UPDATE sessions SET acp_session_id = ? WHERE id = ?');
  const setInitialTitle = db.prepare('UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL');
  // seq is assigned inside the single INSERT statement, so allocation and write are atomic.
  const insertEvent = db.prepare(
    `INSERT INTO events (session_id, seq, ts, json)
     SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3 FROM events WHERE session_id = ?1
     RETURNING seq`,
  );
  const selectEvents = db.prepare(
    'SELECT seq, ts, json FROM events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  );
  const selectLastSeq = db.prepare('SELECT MAX(seq) AS seq FROM events WHERE session_id = ?');

  const updateSessionTitle = db.prepare('UPDATE sessions SET title = ? WHERE id = ?');
  const updateProjectName = db.prepare('UPDATE projects SET name = ? WHERE id = ?');
  const sessionIdsOf = db.prepare('SELECT id FROM sessions WHERE project_id = ?');
  const removeSession = (id: string): boolean => {
    db.prepare('DELETE FROM session_items WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM session_checkpoints WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM events WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM settings WHERE key = ?').run(`approval:${id}`);
    db.prepare('DELETE FROM settings WHERE key = ?').run(`research:${id}`);
    return Number(db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes) > 0;
  };
  const taskOf = (row: Record<string, unknown>): ScheduledTask => ({
    id: String(row['id']),
    projectId: String(row['project_id']),
    agentId: String(row['agent_id']),
    title: String(row['title']),
    prompt: String(row['prompt']),
    spec: JSON.parse(String(row['spec'])) as ScheduleSpec,
    enabled: Number(row['enabled']) === 1,
    nextRun: row['next_run'] === null ? null : Number(row['next_run']),
    lastRun: row['last_run'] === null ? null : Number(row['last_run']),
    lastSessionId: row['last_session_id'] === null ? null : String(row['last_session_id']),
    runs: Number(row['runs']),
    createdAt: Number(row['created_at']),
  });
  const likeOf = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const inTransaction = <T,>(work: () => T): T => {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const selectSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsertSetting = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const checkpoint = db.prepare('SELECT json FROM session_checkpoints WHERE session_id = ?');
  const saveCheckpoint = db.prepare(
    `INSERT INTO session_checkpoints(session_id, json) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET json = excluded.json`,
  );
  const saveItem = db.prepare(
    `INSERT INTO session_items(session_id, seq, tool_id, request_id, json) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, seq) DO UPDATE SET json = excluded.json`,
  );
  const byTool = db.prepare('SELECT json FROM session_items WHERE session_id = ? AND tool_id = ? ORDER BY seq DESC LIMIT 1');
  const byPermission = db.prepare('SELECT json FROM session_items WHERE session_id = ? AND request_id = ? ORDER BY seq DESC LIMIT 1');
  const itemPage = db.prepare('SELECT seq,json FROM session_items WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?');
  const pendingPermissions = db.prepare(
    `SELECT seq, request_id FROM session_items
     WHERE session_id = ? AND seq > ? AND request_id IS NOT NULL AND json_extract(json, '$.resolved') = 0
     ORDER BY seq LIMIT 100`,
  );

  const eventsSince = (sessionId: string, afterSeq: number, limit = MAX_EVENT_PAGE): StoredEvent[] => {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE) {
      throw new SomeCodeError('bad_request', `event cursor must be nonnegative and limit must be 1..${MAX_EVENT_PAGE}`);
    }
    const result: StoredEvent[] = [];
    let bytes = 0;
    for (const raw of selectEvents.iterate(sessionId, afterSeq, limit)) {
      const r = raw as { seq: number; ts: number; json: string };
      const size = Buffer.byteLength(r.json, 'utf8');
      if (result.length && bytes + size > MAX_EVENT_PAGE_BYTES) break;
      bytes += size;
      result.push({ seq: r.seq, ts: r.ts, sessionId, event: JSON.parse(r.json) as NormalizedEvent });
    }
    return result;
  };

  /** Catch up using bounded journal pages and a constant-size reducer checkpoint. */
  const projectHistory = (sessionId: string): SessionState => {
    const row = checkpoint.get(sessionId) as { json: string } | undefined;
    let state: SessionState = row ? JSON.parse(row.json) as SessionState : initialState();
    db.exec('BEGIN');
    try {
      for (;;) {
        const page = eventsSince(sessionId, state.lastSeq);
        if (page.length === 0) break;
        for (const stored of page) {
          const event = stored.event;
          // A late patch can address an item outside the rolling checkpoint. Load only its targets.
          const targets = event.type === 'tool_call_update'
            ? byTool.all(sessionId, event.id)
            : event.type === 'permission_resolved' ? byPermission.all(sessionId, event.requestId) : [];
          const items = new Map(state.items.map((item) => [item.key, item]));
          for (const target of targets as { json: string }[]) {
            const item = JSON.parse(target.json) as Item;
            items.set(item.key, item);
          }
          const input = { ...state, items: [...items.values()].sort((a, b) => Number(a.key) - Number(b.key)) };
          const next = applyEvent(input, stored);
          for (const item of next.items) {
            saveItem.run(
              sessionId,
              Number(item.key),
              item.kind === 'tool' ? item.id : null,
              item.kind === 'permission' ? item.requestId : null,
              JSON.stringify(item),
            );
          }
          state = { ...next, items: next.items.slice(-1) };
        }
      }
      saveCheckpoint.run(sessionId, JSON.stringify(state));
      db.exec('COMMIT');
      return state;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    addProject({ name, path }) {
      const project: Project = { id: randomUUID(), name, path, createdAt: Date.now() };
      insertProject.run(project.id, name, path, project.createdAt);
      return project;
    },
    listProjects() {
      return (selectProjects.all() as ProjectRecord[]).map(toProject);
    },
    getProject(id) {
      const r = selectProject.get(id) as ProjectRecord | undefined;
      return r ? toProject(r) : undefined;
    },
    createSession({ projectId, agentId }) {
      const session: SessionRow = {
        id: randomUUID(),
        projectId,
        agentId,
        acpSessionId: null,
        title: null,
        createdAt: Date.now(),
      };
      insertSession.run(session.id, projectId, agentId, session.createdAt);
      return session;
    },
    getSession(id) {
      const r = selectSession.get(id) as SessionRecord | undefined;
      return r ? toSession(r) : undefined;
    },
    listSessions(projectId) {
      return (selectSessions.all(projectId) as SessionRecord[]).map(toSession);
    },
    setAcpSessionId(id, acpSessionId) {
      updateAcpId.run(acpSessionId, id);
    },
    appendEvent(sessionId, event) {
      const { event: bounded, json } = boundEvent(event);
      const ts = Date.now();
      const row = insertEvent.get(sessionId, ts, json) as { seq: number };
      if (bounded.type === 'user_message') {
        const title = bounded.text.trim().replace(/\s+/gu, ' ').slice(0, 80);
        if (title) setInitialTitle.run(title, sessionId);
      }
      return { seq: row.seq, sessionId, ts, event: bounded };
    },
    eventsSince,
    renameSession(id, title) {
      return Number(updateSessionTitle.run(title, id).changes) > 0;
    },
    renameProject(id, name) {
      return Number(updateProjectName.run(name, id).changes) > 0;
    },
    deleteSession(id) {
      return inTransaction(() => removeSession(id));
    },
    rewindSession(sessionId, beforeSeq) {
      if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
        throw new SomeCodeError('bad_request', 'invalid sequence number');
      }
      inTransaction(() => {
        db.prepare('DELETE FROM events WHERE session_id = ? AND seq >= ?').run(sessionId, beforeSeq);
        db.prepare('DELETE FROM session_items WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM session_checkpoints WHERE session_id = ?').run(sessionId);
      });
      projectHistory(sessionId);
    },
    deleteProject(id) {
      return inTransaction(() => {
        for (const row of sessionIdsOf.all(id) as { id: string }[]) removeSession(row.id);
        db.prepare('DELETE FROM memories WHERE project_id = ?').run(id);
        db.prepare('DELETE FROM scheduled_tasks WHERE project_id = ?').run(id);
        return Number(db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes) > 0;
      });
    },
    getSetting(key) {
      return (selectSetting.get(key) as { value: string } | undefined)?.value ?? null;
    },
    setSetting(key, value) {
      upsertSetting.run(key, value);
    },
    pendingPermissions(sessionId, afterSeq = 0) {
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new SomeCodeError('bad_request', 'invalid permission cursor');
      projectHistory(sessionId);
      return (pendingPermissions.all(sessionId, afterSeq) as {seq: number; request_id: string}[])
        .map((row) => ({ seq: row.seq, requestId: row.request_id }));
    },
    history(sessionId, beforeSeq = Number.MAX_SAFE_INTEGER, limit = HISTORY_PAGE_ITEMS) {
      if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > HISTORY_PAGE_ITEMS) {
        throw new SomeCodeError('bad_request', `history cursor must be positive and limit must be 1..${HISTORY_PAGE_ITEMS}`);
      }
      const state = projectHistory(sessionId);
      const rows: { seq: number; json: string }[] = [];
      let bytes = 0;
      let hasMore = false;
      for (const raw of itemPage.iterate(sessionId, beforeSeq, limit + 1)) {
        const r = raw as { seq: number; json: string };
        const size = Buffer.byteLength(r.json, 'utf8');
        if (rows.length >= limit || (rows.length > 0 && bytes + size > MAX_HISTORY_PAGE_BYTES)) {
          hasMore = true;
          break;
        }
        bytes += size;
        rows.push(r);
      }
      const items = rows.reverse().map((r) => JSON.parse(r.json) as Item);
      return { state: { ...state, items }, beforeSeq: hasMore ? Number(items[0]!.key) : null };
    },
    lastSeq(sessionId) {
      const r = selectLastSeq.get(sessionId) as { seq: number | null };
      return r.seq ?? 0;
    },
    addMemory(projectId, text) {
      const memory = { id: randomUUID(), projectId, text, createdAt: Date.now() };
      db.prepare('INSERT INTO memories(id, project_id, text, created_at) VALUES (?, ?, ?, ?)').run(memory.id, projectId, text, memory.createdAt);
      return memory;
    },
    listMemories(projectId) {
      return (db.prepare('SELECT id, project_id, text, created_at FROM memories WHERE project_id = ? ORDER BY created_at, rowid').all(projectId) as { id: string; project_id: string; text: string; created_at: number }[]).map((r) => ({
        id: r.id,
        projectId: r.project_id,
        text: r.text,
        createdAt: r.created_at,
      }));
    },
    deleteMemory(id) {
      return Number(db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes) > 0;
    },
    addTask(t) {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare('INSERT INTO scheduled_tasks(id, project_id, agent_id, title, prompt, spec, enabled, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(id, t.projectId, t.agentId, t.title, t.prompt, JSON.stringify(t.spec), t.nextRun, createdAt);
      return taskOf(db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown>);
    },
    listTasks() {
      return (db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at, rowid').all() as Record<string, unknown>[]).map(taskOf);
    },
    getTask(id) {
      const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? taskOf(row) : undefined;
    },
    updateTask(id, patch) {
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (patch.enabled !== undefined) (sets.push('enabled = ?'), values.push(patch.enabled ? 1 : 0));
      if (patch.title !== undefined) (sets.push('title = ?'), values.push(patch.title));
      if (patch.nextRun !== undefined) (sets.push('next_run = ?'), values.push(patch.nextRun));
      if (sets.length === 0) return this.getTask(id) !== undefined;
      return Number(db.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values, id).changes) > 0;
    },
    recordTaskRun(id, run) {
      db.prepare('UPDATE scheduled_tasks SET last_run = ?, last_session_id = ?, runs = runs + 1, next_run = ?, enabled = CASE WHEN ? IS NULL THEN 0 ELSE enabled END WHERE id = ?').run(run.at, run.sessionId, run.nextRun, run.nextRun, id);
    },
    deleteTask(id) {
      return Number(db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id).changes) > 0;
    },
    dueTasks(now) {
      return (db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run').all(now) as Record<string, unknown>[]).map(taskOf);
    },
    searchHistory(query, opts = {}) {
      const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))].slice(0, 6);
      if (terms.length === 0) return [];
      const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);
      const sessions = (opts.projectId
        ? db.prepare('SELECT s.id, s.title, s.agent_id, s.created_at, p.name AS project FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.project_id = ? ORDER BY s.created_at DESC, s.rowid DESC').all(opts.projectId)
        : db.prepare('SELECT s.id, s.title, s.agent_id, s.created_at, p.name AS project FROM sessions s JOIN projects p ON p.id = s.project_id ORDER BY s.created_at DESC, s.rowid DESC').all()) as { id: string; title: string | null; agent_id: string; created_at: number; project: string }[];
      const where = terms.map(() => "lower(json_extract(json, '$.text')) LIKE ? ESCAPE '\\'").join(' AND ');
      const hits: HistoryHit[] = [];
      for (const s of sessions) {
        if (hits.length >= limit) break;
        projectHistory(s.id);
        const rows = db.prepare(`SELECT seq, json FROM session_items WHERE session_id = ? AND json_extract(json, '$.kind') IN ('user', 'agent') AND ${where} ORDER BY seq DESC LIMIT ?`).all(s.id, ...terms.map(likeOf), limit - hits.length) as { seq: number; json: string }[];
        for (const r of rows) {
          const item = JSON.parse(r.json) as { kind: 'user' | 'agent'; text: string };
          const at = Math.max(0, item.text.toLowerCase().indexOf(terms[0]!) - 120);
          const snippet = `${at > 0 ? '…' : ''}${item.text.slice(at, at + 320).replace(/\s+/g, ' ').trim()}${item.text.length > at + 320 ? '…' : ''}`;
          hits.push({ sessionId: s.id, seq: r.seq, kind: item.kind, snippet, sessionTitle: s.title, projectName: s.project, agentId: s.agent_id, createdAt: s.created_at });
        }
      }
      return hits;
    },
    transcript(sessionId, opts = {}) {
      projectHistory(sessionId);
      const maxChars = Math.min(Math.max(opts.maxChars ?? 12_000, 500), 60_000);
      const rows = db.prepare('SELECT seq, json FROM session_items WHERE session_id = ? AND seq > ? ORDER BY seq').all(sessionId, opts.afterSeq ?? 0) as { seq: number; json: string }[];
      const lines: string[] = [];
      let size = 0;
      let lastSeq = opts.afterSeq ?? 0;
      let truncated = false;
      for (const r of rows) {
        const item = JSON.parse(r.json) as { kind: string; text?: string; title?: string };
        const line = item.kind === 'user' ? `User: ${item.text}` : item.kind === 'agent' ? `Agent: ${item.text}` : item.kind === 'tool' ? `[tool] ${item.title}` : null;
        if (line === null) continue;
        if (size + line.length > maxChars && lines.length > 0) {
          truncated = true;
          break;
        }
        lines.push(line.length > maxChars ? `${line.slice(0, maxChars)}…` : line);
        size += line.length + 1;
        lastSeq = r.seq;
      }
      return { text: lines.join('\n'), lastSeq, truncated };
    },
    close() {
      db.close();
    },
  };
}
