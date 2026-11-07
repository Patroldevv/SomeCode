import { timingSafeEqual } from 'node:crypto';

/** Constant-time token comparison; a length mismatch is rejected without comparing contents. */
export function tokenMatches(expected: string, provided: string | null | undefined): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/** A request without an Origin header (non-browser client) is allowed; otherwise it must match exactly. */
export function originAllowed(origin: string | null | undefined, allowed: string): boolean {
  return origin === undefined || origin === null || origin === allowed;
}
