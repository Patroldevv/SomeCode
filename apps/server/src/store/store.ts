import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { NormalizedEvent, StoredEvent } from '@somecode/protocol';
import { SCHEMA_SQL } from './schema.sql.ts';

export const MAX_EVENT_BYTES = 1_048_576;

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_RAW_BYTES = 256 * 1024;
const MAX_DIFF_BYTES = 256 * 1024;
// Last-resort caps when an event with many large parts is still over MAX_EVENT_BYTES.
const FALLBACK_BYTES = 1024;
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

export interface Store {
  addProject(p: { name: string; path: string }): Project;
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createSession(s: { projectId: string; agentId: string }): SessionRow;
  getSession(id: string): SessionRow | undefined;
  listSessions(projectId: string): SessionRow[];
  setAcpSessionId(id: string, acpSessionId: string): void;
  appendEvent(sessionId: string, event: NormalizedEvent): StoredEvent;
  eventsSince(sessionId: string, afterSeq: number): StoredEvent[];
  lastSeq(sessionId: string): number;
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
      const next = { ...event, content: capContent(event.content, limits) as typeof event.content };
      if ('rawInput' in event) next.rawInput = capRaw(event.rawInput, limits.raw);
      return next;
    }
    case 'tool_call_update': {
      const patch = { ...event.patch };
      if ('rawInput' in patch) patch.rawInput = capRaw(patch.rawInput, limits.raw);
      if ('rawOutput' in patch) patch.rawOutput = capRaw(patch.rawOutput, limits.raw);
      if ('content' in patch) patch.content = capContent(patch.content, limits);
      return { ...event, patch };
    }
    case 'unsupported':
      return { ...event, raw: capRaw(event.raw, limits.raw) };
    default:
      return event;
  }
}

/** Bounds an event's size; only rawInput/rawOutput/raw payloads and text/diff content are touched. */
function boundEvent(event: NormalizedEvent): { event: NormalizedEvent; json: string } {
  let bounded = limitEvent(event, NORMAL_LIMITS);
  let json = JSON.stringify(bounded);
  if (Buffer.byteLength(json, 'utf8') >= MAX_EVENT_BYTES) {
    bounded = limitEvent(bounded, FALLBACK_LIMITS);
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
  // seq is assigned inside the single INSERT statement, so allocation and write are atomic.
  const insertEvent = db.prepare(
    `INSERT INTO events (session_id, seq, ts, json)
     SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3 FROM events WHERE session_id = ?1
     RETURNING seq`,
  );
  const selectEvents = db.prepare(
    'SELECT seq, ts, json FROM events WHERE session_id = ? AND seq > ? ORDER BY seq',
  );
  const selectLastSeq = db.prepare('SELECT MAX(seq) AS seq FROM events WHERE session_id = ?');

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
      return { seq: row.seq, sessionId, ts, event: bounded };
    },
    eventsSince(sessionId, afterSeq) {
      return (selectEvents.all(sessionId, afterSeq) as { seq: number; ts: number; json: string }[]).map(
        (r) => ({ seq: r.seq, sessionId, ts: r.ts, event: JSON.parse(r.json) as NormalizedEvent }),
      );
    },
    lastSeq(sessionId) {
      const r = selectLastSeq.get(sessionId) as { seq: number | null };
      return r.seq ?? 0;
    },
    close() {
      db.close();
    },
  };
}
