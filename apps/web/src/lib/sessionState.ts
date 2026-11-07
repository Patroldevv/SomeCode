import type { ErrorCode, StoredEvent } from '@somecode/protocol';

export type SessionStatus = 'ready' | 'running' | 'disconnected';

export type PermissionOption = { id: string; name: string; kind: string };

export type Item =
  /** `local` marks an optimistic item the server has not echoed back (yet). */
  | { kind: 'user'; text: string; local?: true }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | {
      kind: 'tool';
      id: string;
      title: string;
      toolKind: string;
      status: string;
      content: unknown[];
      rawInput?: unknown;
    }
  | {
      kind: 'permission';
      requestId: string;
      toolCallId: string;
      title: string;
      options: PermissionOption[];
      resolved: boolean;
    }
  | { kind: 'unsupported'; sessionUpdate: string }
  /** A turn the agent failed (`turn_end` with an error); rendered with the code's message. */
  | { kind: 'error'; code: ErrorCode };

export type SessionState = { lastSeq: number; items: Item[]; status: SessionStatus };

export const initialState = (): SessionState => ({ lastSeq: 0, items: [], status: 'ready' });

/** Optimistic item for a prompt the client just sent (the server journals no user_message for it). */
export function addLocalUserMessage(state: SessionState, text: string): SessionState {
  return { ...state, items: [...state.items, { kind: 'user', text, local: true }] };
}

/** Appends a text chunk to the last item when it is of the same kind, else starts a new item. */
function appendText(items: Item[], kind: 'agent' | 'thought', text: string): Item[] {
  const last = items[items.length - 1];
  if (last && last.kind === kind) return [...items.slice(0, -1), { kind, text: last.text + text }];
  return [...items, { kind, text }];
}

function mapItem(items: Item[], match: (item: Item) => boolean, patch: (item: Item) => Item): Item[] {
  return items.map((item) => (match(item) ? patch(item) : item));
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** Pure: never mutates `state`; events at or below `lastSeq` (replay duplicates) are ignored. */
export function applyEvent(state: SessionState, stored: StoredEvent): SessionState {
  if (stored.seq <= state.lastSeq) return state;
  const base = { ...state, lastSeq: stored.seq };
  const e = stored.event;
  switch (e.type) {
    case 'user_message': {
      const index = state.items.findLastIndex((i) => i.kind === 'user' && i.local === true && i.text === e.text);
      if (index >= 0) {
        // The server echoed our optimistic prompt: confirm it instead of showing it twice.
        const items = state.items.slice();
        items[index] = { kind: 'user', text: e.text };
        return { ...base, items };
      }
      return { ...base, items: [...state.items, { kind: 'user', text: e.text }] };
    }
    case 'agent_message':
      return { ...base, items: appendText(state.items, 'agent', e.text) };
    case 'agent_thought':
      return { ...base, items: appendText(state.items, 'thought', e.text) };
    case 'tool_call':
      return {
        ...base,
        items: [
          ...state.items,
          {
            kind: 'tool',
            id: e.id,
            title: e.title,
            toolKind: e.kind,
            status: e.status,
            content: e.content,
            ...(e.rawInput !== undefined ? { rawInput: e.rawInput } : {}),
          },
        ],
      };
    case 'tool_call_update':
      return {
        ...base,
        items: mapItem(
          state.items,
          (i) => i.kind === 'tool' && i.id === e.id,
          (i) => {
            if (i.kind !== 'tool') return i;
            const p = e.patch;
            return {
              ...i,
              ...(isString(p.title) ? { title: p.title } : {}),
              ...(isString(p.status) ? { status: p.status } : {}),
              ...(isString(p.kind) ? { toolKind: p.kind } : {}),
              ...(Array.isArray(p.content) ? { content: p.content } : {}),
              ...(p.rawInput !== undefined ? { rawInput: p.rawInput } : {}),
            };
          },
        ),
      };
    case 'permission_request':
      return {
        ...base,
        items: [
          ...state.items,
          {
            kind: 'permission',
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
        ...base,
        items: mapItem(
          state.items,
          (i) => i.kind === 'permission' && i.requestId === e.requestId,
          (i) => (i.kind === 'permission' ? { ...i, resolved: true } : i),
        ),
      };
    case 'status':
      return { ...base, status: e.status };
    case 'unsupported':
      return { ...base, items: [...state.items, { kind: 'unsupported', sessionUpdate: e.sessionUpdate }] };
    case 'turn_end':
      return e.error ? { ...base, items: [...state.items, { kind: 'error', code: e.error.code }] } : base;
    case 'plan':
    case 'config_options':
      return base;
  }
}
