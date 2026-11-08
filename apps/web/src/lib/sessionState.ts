import { configOptionSchema, type ConfigOption, type ErrorCode, type StoredEvent } from '@somecode/protocol';

export type SessionStatus = 'ready' | 'running' | 'disconnected';

export type PermissionOption = { id: string; name: string; kind: string };

/** A tool call's content, narrowed from the protocol's `ToolContent` to what the UI renders. */
export type ToolContentView =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

export type PlanEntry = { content: string; status: string; priority: string };

/**
 * `key` is stable across replays: the creating event's `String(seq)`, or `local-<n>` for an optimistic
 * item (which keeps it once the server confirms it).
 */
export type Item =
  /** `local` marks an optimistic item the server has not echoed back (yet). */
  | { kind: 'user'; key: string; text: string; local?: true }
  | { kind: 'agent'; key: string; text: string }
  /** `endedAt` is unset while the thought is still streaming. Both are event `ts` in ms. */
  | { kind: 'thought'; key: string; text: string; startedAt: number; endedAt?: number }
  | {
      kind: 'tool';
      key: string;
      id: string;
      title: string;
      toolKind: string;
      status: string;
      content: ToolContentView[];
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  | {
      kind: 'permission';
      key: string;
      requestId: string;
      toolCallId: string;
      title: string;
      options: PermissionOption[];
      resolved: boolean;
    }
  | { kind: 'unsupported'; key: string; sessionUpdate: string }
  /** A turn the agent failed (`turn_end` with an error); rendered with the code's message. */
  | { kind: 'error'; key: string; code: ErrorCode };

export type ThoughtItem = Extract<Item, { kind: 'thought' }>;
export type ToolItem = Extract<Item, { kind: 'tool' }>;

export type SessionState = {
  /** The agent's select options (model, mode, effort, …) as last reported; null until reported. */
  configOptions: ConfigOption[] | null;
  lastSeq: number;
  items: Item[];
  status: SessionStatus;
  plan: PlanEntry[] | null;
  /** Counter behind the `local-<n>` keys of optimistic items. */
  localSeq: number;
};

export const initialState = (): SessionState => ({
  configOptions: null,
  lastSeq: 0,
  items: [],
  status: 'ready',
  plan: null,
  localSeq: 0,
});

/** Optimistic item for a prompt the client just sent; the server's journaled user_message confirms it. */
export function addLocalUserMessage(state: SessionState, text: string): SessionState {
  const localSeq = state.localSeq + 1;
  return {
    ...state,
    localSeq,
    items: [...state.items, { kind: 'user', key: `local-${localSeq}`, text, local: true }],
  };
}

/** Appends a text chunk to the last item when it is of the same kind, else starts a new item keyed by `key`. */
function appendAgent(items: Item[], key: string, text: string): Item[] {
  const last = items[items.length - 1];
  if (last && last.kind === 'agent') return [...items.slice(0, -1), { ...last, text: last.text + text }];
  return [...items, { kind: 'agent', key, text }];
}

/** Like `appendAgent`, but only an unfinished thought takes the chunk; a closed one is followed by a new item. */
function appendThought(items: Item[], key: string, text: string, ts: number): Item[] {
  const last = items[items.length - 1];
  if (last && last.kind === 'thought' && last.endedAt === undefined) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...items, { kind: 'thought', key, text, startedAt: ts }];
}

/** Closes every unfinished thought at `ts`; returns the same array when there is none. */
function closeThoughts(items: Item[], ts: number): Item[] {
  if (!items.some((i) => i.kind === 'thought' && i.endedAt === undefined)) return items;
  return items.map((i) => (i.kind === 'thought' && i.endedAt === undefined ? { ...i, endedAt: ts } : i));
}

function mapItem(items: Item[], match: (item: Item) => boolean, patch: (item: Item) => Item): Item[] {
  return items.map((item) => (match(item) ? patch(item) : item));
}

/** Keeps the entries the UI can render; an unrecognised one is dropped rather than shown empty. */
function toToolContent(raw: unknown[]): ToolContentView[] {
  const out: ToolContentView[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (c.type === 'text' && isString(c.text)) {
      out.push({ type: 'text', text: c.text });
    } else if (c.type === 'diff' && isString(c.path) && isString(c.newText)) {
      out.push({ type: 'diff', path: c.path, oldText: isString(c.oldText) ? c.oldText : null, newText: c.newText });
    } else if (c.type === 'terminal' && isString(c.terminalId)) {
      out.push({ type: 'terminal', terminalId: c.terminalId });
    }
  }
  return out;
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** What the server's store appends to a text it cut to its size limit (apps/server/src/store/store.ts). */
export const TRUNCATION_MARKER = '…[truncated]';

/** Pure: never mutates `state`; events at or below `lastSeq` (replay duplicates) are ignored. */
export function applyEvent(state: SessionState, stored: StoredEvent): SessionState {
  if (stored.seq <= state.lastSeq) return state;
  const e = stored.event;
  const key = String(stored.seq);
  const base = { ...state, lastSeq: stored.seq };
  // Any event except more thought (and the status:running that opens a turn) ends a streaming thought.
  const closesThought = !(e.type === 'agent_thought' || (e.type === 'status' && e.status === 'running'));
  const current = closesThought ? { ...base, items: closeThoughts(state.items, stored.ts) } : base;
  const items = current.items;
  switch (e.type) {
    case 'user_message': {
      // A new prompt starts a new turn, so the previous turn's plan no longer applies.
      const exact = items.findLastIndex((i) => i.kind === 'user' && i.local === true && i.text === e.text);
      // The server cuts a prompt over 64 KiB and appends its marker: the oldest pending prompt with that
      // prefix is the one echoed. It keeps its full local text (what the user sent; the agent got all of it).
      const prefix = e.text.endsWith(TRUNCATION_MARKER) ? e.text.slice(0, -TRUNCATION_MARKER.length) : null;
      const index =
        exact >= 0 || prefix === null
          ? exact
          : items.findIndex(
              (i) => i.kind === 'user' && i.local === true && i.text.length > prefix.length && i.text.startsWith(prefix),
            );
      if (index >= 0) {
        // The server echoed our optimistic prompt: confirm it (keeping its key) instead of showing it twice.
        const local = items[index] as Item & { kind: 'user' };
        const next = items.slice();
        next[index] = { kind: 'user', key: local.key, text: local.text };
        return { ...current, items: next, plan: null };
      }
      return { ...current, items: [...items, { kind: 'user', key, text: e.text }], plan: null };
    }
    case 'agent_message':
      return { ...current, items: appendAgent(items, key, e.text) };
    case 'agent_thought':
      return { ...current, items: appendThought(items, key, e.text, stored.ts) };
    case 'tool_call':
      return {
        ...current,
        items: [
          ...items,
          {
            kind: 'tool',
            key,
            id: e.id,
            title: e.title,
            toolKind: e.kind,
            status: e.status,
            content: toToolContent(e.content),
            ...(e.rawInput !== undefined ? { rawInput: e.rawInput } : {}),
          },
        ],
      };
    case 'tool_call_update': {
      // An update for a tool we never saw changes nothing.
      if (!state.items.some((i) => i.kind === 'tool' && i.id === e.id)) return base;
      return {
        ...current,
        items: mapItem(
          items,
          (i) => i.kind === 'tool' && i.id === e.id,
          (i) => {
            if (i.kind !== 'tool') return i;
            const p = e.patch;
            return {
              ...i,
              ...(isString(p.title) ? { title: p.title } : {}),
              ...(isString(p.status) ? { status: p.status } : {}),
              ...(isString(p.kind) ? { toolKind: p.kind } : {}),
              ...(Array.isArray(p.content) ? { content: toToolContent(p.content) } : {}),
              ...(p.rawInput !== undefined ? { rawInput: p.rawInput } : {}),
              ...(p.rawOutput !== undefined ? { rawOutput: p.rawOutput } : {}),
            };
          },
        ),
      };
    }
    case 'permission_request':
      return {
        ...current,
        items: [
          ...items,
          {
            kind: 'permission',
            key,
            requestId: e.requestId,
            toolCallId: e.toolCallId,
            title: e.title,
            options: e.options,
            resolved: false,
          },
        ],
      };
    case 'permission_resolved':
      return {
        ...current,
        items: mapItem(
          items,
          (i) => i.kind === 'permission' && i.requestId === e.requestId,
          (i) => (i.kind === 'permission' ? { ...i, resolved: true } : i),
        ),
      };
    case 'status':
      return { ...current, status: e.status };
    case 'unsupported':
      return { ...current, items: [...items, { kind: 'unsupported', key, sessionUpdate: e.sessionUpdate }] };
    case 'turn_end':
      return e.error ? { ...current, items: [...items, { kind: 'error', key, code: e.error.code }] } : current;
    case 'plan':
      return { ...current, plan: e.entries.map((p) => ({ content: p.content, status: p.status, priority: p.priority })) };
    case 'config_options': {
      // Journals written before the typed shape may hold raw SDK options: ignore what doesn't fit.
      const parsed = configOptionSchema.array().safeParse(e.options);
      return parsed.success ? { ...current, configOptions: parsed.data } : current;
    }
  }
}
