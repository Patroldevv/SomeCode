import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
} from '@agentclientprotocol/sdk';
import { SomeCodeError, type FormAnswer, type FormField, type NormalizedEvent, type ToolContent } from '@somecode/protocol';

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
 * deliberately ignored; kinds the SDK knows but we do not model surface as `unsupported`.
 * (Tags the SDK itself does not know never get here: `UnknownUpdates` in `stdio.ts` turns them
 * into `unsupported` before SDK validation.)
 */
/** The sub-agent an update belongs to: Claude tags child tool calls with the Task that spawned them, OpenCode with the child session. */
export function subagentOf(update: SessionUpdate): { id: string; title?: string } | undefined {
  const meta = (update as { _meta?: unknown })._meta;
  if (!isRecord(meta)) return undefined;
  const claude = meta['claudeCode'];
  if (isRecord(claude) && typeof claude['parentToolUseId'] === 'string' && claude['parentToolUseId'] !== '') {
    return { id: claude['parentToolUseId'] };
  }
  const child = meta['opencode/child-session'];
  if (isRecord(child) && typeof child['id'] === 'string') {
    const title = text(child['title'], 300);
    return { id: `session:${child['id']}`, ...(title ? { title } : {}) };
  }
  const agy = meta['antigravity'] ?? meta['subagent'];
  if (isRecord(agy) && typeof agy['id'] === 'string') {
    const title = text(agy['title'] ?? agy['role'], 300);
    return { id: agy['id'], ...(title ? { title } : {}) };
  }
  return undefined;
}

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
      const parent = subagentOf(update);
      if (parent) event.parent = parent;
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
    case 'config_option_update':
      return normalizeConfigOptions(update.configOptions);
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

/** Longest plan/detail text kept on a permission request. */
const MAX_DETAIL_CHARS = 60_000;

/** What the agent wants approved, as text: the tool call's text content, else a `plan` in its raw input. */
function permissionDetail(toolCall: RequestPermissionRequest['toolCall']): string | undefined {
  const parts: string[] = [];
  for (const block of toolCall.content ?? []) {
    if (block.type === 'content' && block.content.type === 'text' && block.content.text.trim() !== '') parts.push(block.content.text);
  }
  let text = parts.join('\n\n');
  const raw = toolCall.rawInput;
  if (text === '' && typeof raw === 'object' && raw !== null && typeof (raw as { plan?: unknown }).plan === 'string') {
    text = (raw as { plan: string }).plan;
  }
  text = text.trim();
  return text === '' ? undefined : text.slice(0, MAX_DETAIL_CHARS);
}

export function normalizePermission(
  requestId: string,
  req: RequestPermissionRequest,
): PermissionRequestEvent {
  const { toolCallId, title } = req.toolCall;
  const detail = permissionDetail(req.toolCall);
  return {
    type: 'permission_request',
    requestId,
    toolCallId,
    title: title || toolCallId,
    options: req.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
    ...(detail !== undefined ? { detail } : {}),
  };
}

const MAX_FIELDS = 24;
const MAX_OPTIONS = 60;
const MAX_LABEL_CHARS = 1_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_LABEL_CHARS): string | undefined => (typeof v === 'string' && v !== '' ? v.slice(0, max) : undefined);

/** `oneOf` / `anyOf` entries (`{const, title, description}`) or a plain `enum` as a list of choices. */
function choices(entries: unknown, plain: unknown): FormField['options'] {
  const list = Array.isArray(entries) ? entries : undefined;
  if (list) {
    const options = list.flatMap((e) => {
      if (!isRecord(e) || typeof e['const'] !== 'string') return [];
      const description = text(e['description']);
      return [{ value: e['const'], label: text(e['title']) ?? e['const'], ...(description ? { description } : {}) }];
    });
    return options.slice(0, MAX_OPTIONS);
  }
  if (Array.isArray(plain)) {
    return plain.filter((v): v is string => typeof v === 'string').slice(0, MAX_OPTIONS).map((v) => ({ value: v, label: v }));
  }
  return undefined;
}

/**
 * Flattens an ACP form-elicitation schema (flat primitive properties, single/multi select enums) into the fields a
 * card can show. Returns null when the schema holds anything else (the caller then declines the request).
 */
export function normalizeForm(schema: unknown): FormField[] | null {
  if (!isRecord(schema) || !isRecord(schema['properties'])) return null;
  const required = new Set(Array.isArray(schema['required']) ? schema['required'].filter((k): k is string => typeof k === 'string') : []);
  const fields: FormField[] = [];
  for (const [key, raw] of Object.entries(schema['properties'])) {
    if (!isRecord(raw)) return null;
    const base = {
      key,
      title: text(raw['title']) ?? key,
      required: required.has(key),
      ...(text(raw['description']) ? { description: text(raw['description'], 4_000)! } : {}),
    };
    switch (raw['type']) {
      case 'string': {
        const options = choices(raw['oneOf'], raw['enum']);
        const def = typeof raw['default'] === 'string' ? raw['default'] : undefined;
        fields.push({ ...base, type: 'string', ...(options ? { options } : {}), ...(def !== undefined ? { default: def } : {}) });
        break;
      }
      case 'number':
      case 'integer': {
        const def = typeof raw['default'] === 'number' ? raw['default'] : undefined;
        fields.push({ ...base, type: raw['type'], ...(def !== undefined ? { default: def } : {}) });
        break;
      }
      case 'boolean': {
        const def = typeof raw['default'] === 'boolean' ? raw['default'] : undefined;
        fields.push({ ...base, type: 'boolean', ...(def !== undefined ? { default: def } : {}) });
        break;
      }
      case 'array': {
        const items = isRecord(raw['items']) ? raw['items'] : {};
        const options = choices(items['anyOf'] ?? items['oneOf'], items['enum']);
        if (!options) return null;
        const def = Array.isArray(raw['default']) ? raw['default'].filter((v): v is string => typeof v === 'string') : undefined;
        fields.push({ ...base, type: 'multi', options, ...(def ? { default: def } : {}) });
        break;
      }
      default:
        return null;
    }
    if (fields.length > MAX_FIELDS) return null;
  }
  return fields.length > 0 ? fields : null;
}

/**
 * Checks a submitted answer against the form it answers and returns only the known, well-typed values.
 * Throws a `bad_request` for a missing required value or a value outside a field's choices.
 */
export function sanitizeAnswer(fields: readonly FormField[], answer: FormAnswer): FormAnswer {
  const result: FormAnswer = {};
  for (const field of fields) {
    const value = answer[field.key];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0 && field.type === 'multi' && !field.required)) {
      if (field.required) throw new SomeCodeError('bad_request', `${field.key}: an answer is required`);
      continue;
    }
    const known = new Set((field.options ?? []).map((o) => o.value));
    switch (field.type) {
      case 'string':
        if (typeof value !== 'string' || value.length > 20_000 || (known.size > 0 && !known.has(value))) {
          throw new SomeCodeError('bad_request', `${field.key}: not a valid choice`);
        }
        break;
      case 'multi':
        if (!Array.isArray(value) || value.length > MAX_OPTIONS || value.some((v) => typeof v !== 'string' || !known.has(v))) {
          throw new SomeCodeError('bad_request', `${field.key}: not valid choices`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') throw new SomeCodeError('bad_request', `${field.key}: expected a boolean`);
        break;
      case 'number':
      case 'integer':
        if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) {
          throw new SomeCodeError('bad_request', `${field.key}: expected a number`);
        }
        break;
    }
    result[field.key] = value;
  }
  return result;
}

type Choice = { value: string; name: string; description?: string };

function flattenChoices(options: unknown): Choice[] {
  if (!Array.isArray(options)) return [];
  const out: Choice[] = [];
  for (const item of options as Array<Record<string, unknown>>) {
    if (Array.isArray(item.options)) {
      out.push(...flattenChoices(item.options)); // a group: its options
    } else if (typeof item.value === 'string') {
      out.push({
        value: item.value,
        name: typeof item.name === 'string' ? item.name : item.value,
        ...(typeof item.description === 'string' && item.description ? { description: item.description } : {}),
      });
    }
  }
  return out;
}

/** Select options only (booleans are not rendered yet); empty and duplicate-id options are dropped. */
export function normalizeConfigOptions(options: SessionConfigOption[]): ConfigOptionsEvent {
  const seen = new Set<string>();
  const out: ConfigOptionsEvent['options'] = [];
  for (const o of options as unknown as Array<Record<string, unknown>>) {
    if (o.type !== 'select' || typeof o.id !== 'string' || seen.has(o.id)) continue;
    const choices = flattenChoices(o.options);
    if (choices.length === 0) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : o.id,
      ...(typeof o.category === 'string' ? { category: o.category } : {}),
      ...(typeof o.description === 'string' && o.description ? { description: o.description } : {}),
      currentValue: String(o.currentValue),
      choices,
    });
  }
  return { type: 'config_options', options: out };
}
