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

/** One choice of a form field. */
export const formOptionSchema = z.object({ value: z.string(), label: z.string(), description: z.string().optional() });

/** One question of a form the agent asks the user (ACP form elicitation, flattened to what a card can show). */
export const formFieldSchema = z.object({
  key: z.string(),
  /** `multi` = pick any number of `options`. */
  type: z.enum(['string', 'number', 'integer', 'boolean', 'multi']),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean(),
  /** Present for a choice: `string` with options = pick one. */
  options: z.array(formOptionSchema).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formAnswerSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]));
export type FormAnswer = z.infer<typeof formAnswerSchema>;

export const toolContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('diff'),
    path: z.string(),
    oldText: z.string().nullable(),
    newText: z.string(),
  }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() }),
  /** A picture a tool returned (a browser screenshot). */
  z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
]);
export type ToolContent = z.infer<typeof toolContentSchema>;

export const imageAttachmentSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
  name: z.string().optional(),
});
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;

export const normalizedEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user_message'),
    text: z.string(),
    images: z.array(imageAttachmentSchema).optional(),
  }),
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
    /** Set when a sub-agent made this call: the sub-agent's id (its Task call, or `session:<id>`) and name. */
    parent: z.object({ id: z.string(), title: z.string().optional() }).optional(),
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
    /** What the agent wants approved, as markdown (e.g. its plan when it asks to leave plan mode). */
    detail: z.string().optional(),
    /** A question to the user: the agent wants these fields filled in instead of picking one option. */
    form: z.object({ fields: z.array(formFieldSchema) }).optional(),
    /** A research plan the user may edit, start or cancel (deep research): the answer carries the steps to follow. */
    plan: z.object({ steps: z.array(z.string()) }).optional(),
  }),
  z.object({
    type: z.literal('permission_resolved'),
    requestId: z.string(),
    outcome: z.enum(['selected', 'cancelled']),
    optionId: z.string().optional(),
    /** The values the user submitted for a form. */
    answer: formAnswerSchema.optional(),
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
  /**
   * The project's checks (tests, typecheck, lint) that SomeCode runs after a turn that changed files. Events with the
   * same `id` update one card: first `running`, then each check as it finishes, then the result.
   */
  z.object({
    type: z.literal('verification'),
    id: z.string(),
    status: z.enum(['running', 'passed', 'failed']),
    /** 0 for the first run after the user's message; 1, 2, … after each automatic fix. */
    round: z.number(),
    checks: z.array(
      z.object({
        name: z.string(),
        command: z.string(),
        status: z.enum(['pending', 'running', 'passed', 'failed']),
        /** The end of the output of a failed check. */
        output: z.string().optional(),
        ms: z.number().optional(),
      }),
    ),
    /** The failure was handed to the agent to fix (it will start a new turn). */
    willFix: z.boolean().optional(),
  }),
  /** How full the agent's context window is: tokens used of the window's size. Sent when a turn ends. */
  z.object({ type: z.literal('usage'), used: z.number(), size: z.number() }),
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
