import { z } from 'zod';
import { errorCodeSchema } from './errors.ts';

export const configChoiceSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
});
export type ConfigChoice = z.infer<typeof configChoiceSchema>;

/** A select-type session option the agent exposes (model, mode, effort, …). */
export const configOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  currentValue: z.string(),
  choices: z.array(configChoiceSchema),
});
export type ConfigOption = z.infer<typeof configOptionSchema>;

export const toolContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('diff'),
    path: z.string(),
    oldText: z.string().nullable(),
    newText: z.string(),
  }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() }),
]);
export type ToolContent = z.infer<typeof toolContentSchema>;

export const normalizedEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user_message'), text: z.string() }),
  z.object({ type: z.literal('agent_message'), text: z.string() }),
  z.object({ type: z.literal('agent_thought'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    id: z.string(),
    title: z.string(),
    kind: z.string(),
    status: z.string(),
    content: z.array(toolContentSchema),
    rawInput: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('tool_call_update'),
    id: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('plan'),
    entries: z.array(
      z.object({
        content: z.string(),
        status: z.string(),
        priority: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal('permission_request'),
    requestId: z.string(),
    toolCallId: z.string(),
    title: z.string(),
    options: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })),
  }),
  z.object({
    type: z.literal('permission_resolved'),
    requestId: z.string(),
    outcome: z.enum(['selected', 'cancelled']),
    optionId: z.string().optional(),
  }),
  /**
   * Every accepted turn that the agent answers ends with one `turn_end`. When the agent answers
   * `session/prompt` with an error, `stopReason` is `'error'` and `error` carries its code.
   */
  z.object({
    type: z.literal('turn_end'),
    stopReason: z.string(),
    error: z.object({ code: errorCodeSchema, message: z.string() }).optional(),
  }),
  z.object({
    type: z.literal('status'),
    status: z.enum(['ready', 'running', 'disconnected']),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('config_options'), options: z.array(configOptionSchema) }),
  z.object({
    type: z.literal('unsupported'),
    sessionUpdate: z.string(),
    raw: z.unknown(),
  }),
]);
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

export type StoredEvent = {
  seq: number;
  sessionId: string;
  ts: number;
  event: NormalizedEvent;
};
