import type { ClientMessage, FormAnswer } from '@somecode/protocol';

/**
 * Plans the answer to a permission card click. Returns null when the request was already
 * answered, so a double click (or a second option) never sends a second response. The answer
 * is always one of the agent's own options: `optionId: null` would mean ACP `cancelled`,
 * which agents treat as cancelling the whole turn. Only a question's "skip" sends `null`, and a question's
 * `answer` rides along with its submit option. The caller keeps `answered` only once
 * the message was actually sent.
 */
export function planAnswer(
  answered: ReadonlySet<string>,
  sessionId: string,
  requestId: string,
  optionId: string | null,
  answer?: FormAnswer,
): { message: ClientMessage; answered: ReadonlySet<string> } | null {
  if (answered.has(requestId)) return null;
  return {
    message: { type: 'permission_response', sessionId, requestId, optionId, ...(answer ? { answer } : {}) },
    answered: new Set(answered).add(requestId),
  };
}
