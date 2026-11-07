import { SomeCodeError, type ErrorCode } from '@somecode/protocol';
import type { ZodError } from 'zod';

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

const STATUS: Partial<Record<ErrorCode, ErrorStatus>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  turn_in_progress: 409,
  disconnected: 409,
  agent_not_installed: 422,
  auth_required: 422,
};

export function statusFor(code: ErrorCode): ErrorStatus {
  return STATUS[code] ?? 500;
}

/**
 * The client-facing form of an error. Only `SomeCodeError`s carry their own message; anything
 * else is logged here and reported as a generic `internal error`, so nothing internal leaks.
 */
export function toWireError(err: unknown): { code: ErrorCode; message: string } {
  if (err instanceof SomeCodeError) return { code: err.code, message: err.message };
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[somecode] internal error: ${detail}\n`);
  return { code: 'internal', message: 'internal error' };
}

/** A short, human-readable summary of schema validation failures. */
export function describeIssues(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : 'value'}: ${issue.message}`)
    .join('; ');
}
