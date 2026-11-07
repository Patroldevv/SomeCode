import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
} from '@agentclientprotocol/sdk';
import type { NormalizedEvent, ToolContent } from '@somecode/protocol';

type PermissionRequestEvent = Extract<NormalizedEvent, { type: 'permission_request' }>;
type ConfigOptionsEvent = Extract<NormalizedEvent, { type: 'config_options' }>;

const TOOL_KINDS: ReadonlySet<string> = new Set([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);
const TOOL_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

/** Text blocks keep their text; any other block degrades to a neutral `[type]` marker. */
function blockText(block: ContentBlock): string {
  return block.type === 'text' ? block.text : `[${String(block.type)}]`;
}

function normalizeToolContent(items: ToolCallContent[] | null | undefined): ToolContent[] {
  if (!items) return [];
  return items.map((item): ToolContent => {
    switch (item.type) {
      case 'diff':
        return {
          type: 'diff',
          path: item.path,
          oldText: item.oldText ?? null,
          newText: item.newText,
        };
      case 'terminal':
        return { type: 'terminal', terminalId: item.terminalId };
      default:
        return { type: 'text', text: blockText(item.content) };
    }
  });
}

/**
 * Normalizes an ACP `session/update` payload. Returns `null` only for updates that are
 * deliberately ignored; unknown or unmodeled kinds surface as `unsupported`.
 */
export function normalizeUpdate(update: SessionUpdate): NormalizedEvent | null {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return { type: 'user_message', text: blockText(update.content) };
    case 'agent_message_chunk':
      return { type: 'agent_message', text: blockText(update.content) };
    case 'agent_thought_chunk':
      return { type: 'agent_thought', text: blockText(update.content) };
    case 'tool_call': {
      const event: Extract<NormalizedEvent, { type: 'tool_call' }> = {
        type: 'tool_call',
        id: update.toolCallId,
        title: update.title,
        kind: update.kind && TOOL_KINDS.has(update.kind) ? update.kind : 'other',
        status: update.status && TOOL_STATUSES.has(update.status) ? update.status : 'pending',
        content: normalizeToolContent(update.content),
      };
      if (update.rawInput !== undefined) event.rawInput = update.rawInput;
      return event;
    }
    case 'tool_call_update': {
      const patch: Record<string, unknown> = {};
      if (update.title != null) patch.title = update.title;
      if (update.kind != null && TOOL_KINDS.has(update.kind)) patch.kind = update.kind;
      if (update.status != null && TOOL_STATUSES.has(update.status)) patch.status = update.status;
      if (update.content != null) patch.content = normalizeToolContent(update.content);
      if (update.rawInput !== undefined) patch.rawInput = update.rawInput;
      if (update.rawOutput !== undefined) patch.rawOutput = update.rawOutput;
      return { type: 'tool_call_update', id: update.toolCallId, patch };
    }
    case 'plan':
      return {
        type: 'plan',
        entries: update.entries.map((e) => ({
          content: e.content,
          status: e.status,
          priority: e.priority,
        })),
      };
    case 'usage_update':
    case 'session_info_update':
    case 'available_commands_update':
    case 'current_mode_update':
      return null;
    default:
      return {
        type: 'unsupported',
        sessionUpdate: String((update as { sessionUpdate: unknown }).sessionUpdate),
        raw: update,
      };
  }
}

export function normalizePermission(
  requestId: string,
  req: RequestPermissionRequest,
): PermissionRequestEvent {
  const { toolCallId, title } = req.toolCall;
  return {
    type: 'permission_request',
    requestId,
    toolCallId,
    title: title || toolCallId,
    options: req.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
  };
}

export function normalizeConfigOptions(options: SessionConfigOption[]): ConfigOptionsEvent {
  return { type: 'config_options', options };
}
