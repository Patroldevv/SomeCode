export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent_id TEXT NOT NULL,
  acp_session_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;

-- A rebuildable normalized projection. The event journal remains the durable source of truth.
CREATE TABLE IF NOT EXISTS session_checkpoints (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_items (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  tool_id TEXT,
  request_id TEXT,
  json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
-- What the user (or an agent for them) wants every agent in a project to remember.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id, created_at);
-- Prompts that start a chat by themselves: once, every N minutes or daily.
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  spec TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run INTEGER,
  last_run INTEGER,
  last_session_id TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_tool ON session_items(session_id, tool_id);
CREATE INDEX IF NOT EXISTS idx_items_permission ON session_items(session_id, request_id);
CREATE INDEX IF NOT EXISTS idx_items_pending_permission ON session_items(session_id, seq)
  WHERE request_id IS NOT NULL AND json_extract(json, '$.resolved') = 0;
`;
