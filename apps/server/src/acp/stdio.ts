import type { SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk';

/**
 * Every `sessionUpdate` tag the SDK's stable schema accepts. The SDK validates `session/update`
 * against a closed union and discards (with a stderr log) any other tag, so those are
 * intercepted before the SDK sees them. Typed against the SDK's own `SessionUpdate`, so an SDK
 * upgrade that adds or removes a tag fails the typecheck until this list matches again.
 */
const SDK_UPDATE_TAGS: Record<SessionUpdate['sessionUpdate'], true> = {
  user_message_chunk: true,
  agent_message_chunk: true,
  agent_thought_chunk: true,
  tool_call: true,
  tool_call_update: true,
  plan: true,
  available_commands_update: true,
  current_mode_update: true,
  config_option_update: true,
  session_info_update: true,
  usage_update: true,
  notice: true,
  compaction_update: true,
  compaction_summary_chunk: true,
};

/** Notification `_meta` key that marks a placeholder standing in for an intercepted update. */
const PLACEHOLDER_META = 'somecode/unsupported';

export type InterceptedUpdate = { sessionUpdate: string; raw: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Keeps `session/update` notifications with a tag the SDK does not know from being discarded.
 * `rewrite` swaps such a line for a valid placeholder notification (an empty
 * `session_info_update` whose `_meta` names the stashed original), so the update keeps its place
 * in the SDK's in-order dispatch; `take` hands the original back to the update handler.
 */
export class UnknownUpdates {
  readonly #stash = new Map<number, InterceptedUpdate>();
  #next = 0;

  rewrite(line: string): string {
    if (!line.includes('"session/update"')) return line; // cheap pre-check before parsing
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return line;
    }
    if (!isRecord(msg) || msg.method !== 'session/update' || 'id' in msg || !isRecord(msg.params)) return line;
    const { sessionId, update } = msg.params;
    if (typeof sessionId !== 'string' || !isRecord(update)) return line;
    const tag = update.sessionUpdate;
    if (typeof tag === 'string' && Object.hasOwn(SDK_UPDATE_TAGS, tag)) return line;
    const id = this.#next++;
    this.#stash.set(id, { sessionUpdate: typeof tag === 'string' ? tag : 'invalid', raw: update });
    return JSON.stringify({
      jsonrpc: msg.jsonrpc,
      method: msg.method,
      params: { sessionId, update: { sessionUpdate: 'session_info_update' }, _meta: { [PLACEHOLDER_META]: id } },
    });
  }

  /** The original update a placeholder notification stands for, or undefined for a real one. */
  take(params: SessionNotification): InterceptedUpdate | undefined {
    const id = params._meta?.[PLACEHOLDER_META];
    if (typeof id !== 'number') return undefined;
    const found = this.#stash.get(id);
    this.#stash.delete(id);
    return found;
  }
}

/**
 * Passes only complete stdout lines that look like JSON objects to the ACP stream, so stray
 * agent output (banners, logs) never reaches the JSON-RPC layer. Dropped lines go to stderr.
 * `rewrite` may replace a JSON line before it reaches the SDK.
 */
export function jsonLines(label: string, rewrite: (line: string) => string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const emit = (line: string, out: TransformStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) out.enqueue(encoder.encode(`${rewrite(trimmed)}\n`));
    else if (trimmed) {
      process.stderr.write(`[somecode] ${label}: ignored non-JSON stdout line: ${trimmed.slice(0, 200)}\n`);
    }
  };
  return new TransformStream({
    transform(chunk, out) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        emit(buffer.slice(0, nl), out);
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(out) {
      emit(buffer + decoder.decode(), out);
    },
  });
}
