import { z } from 'zod';
import type { ErrorCode } from './errors.ts';
import { formAnswerSchema, imageAttachmentSchema, type StoredEvent } from './events.ts';
import type { SessionHistoryPage } from './sessionState.ts';

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    sessionId: z.string(),
    afterSeq: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('prompt'),
    sessionId: z.string(),
    text: z.string(),
    images: z.array(imageAttachmentSchema).optional(),
  }),
  z.object({ type: z.literal('cancel'), sessionId: z.string() }),
  z.object({ type: z.literal('unsubscribe'), sessionId: z.string() }),
  z.object({
    type: z.literal('permission_response'),
    sessionId: z.string(),
    requestId: z.string(),
    optionId: z.string().nullable(),
    /** The values for a form question (the `optionId` is then the one that submits it). */
    answer: formAnswerSchema.optional(),
  }),
  z.object({
    type: z.literal('set_config'),
    sessionId: z.string(),
    configId: z.string(),
    value: z.unknown(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { type: 'snapshot'; sessionId: string; history: SessionHistoryPage }
  | { type: 'subscribed'; sessionId: string; lastSeq: number }
  | { type: 'event'; stored: StoredEvent }
  | { type: 'error'; code: ErrorCode; message: string };
