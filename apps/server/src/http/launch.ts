import { randomBytes } from 'node:crypto';

/**
 * One-time codes that open the interface: the address the app window or browser is started with carries a code,
 * not the access token, so the token never sits in a command line, the shell history or the browser history.
 * A code works for a minute and a few times (the app window may restart once, for instance without the GPU, and
 * opens the same address again); the page trades it for the token.
 */
export function createLaunchCodes(now: () => number = Date.now, ttlMs = 60_000, maxUses = 3) {
  const codes = new Map<string, { expires: number; uses: number }>();
  const sweep = () => {
    for (const [code, entry] of codes) if (entry.expires <= now()) codes.delete(code);
  };
  return {
    issue(): string {
      sweep();
      const code = randomBytes(18).toString('base64url');
      codes.set(code, { expires: now() + ttlMs, uses: 0 });
      return code;
    },
    /** True for a code that was issued, has not expired and has not been used up. */
    redeem(code: string): boolean {
      sweep();
      const entry = codes.get(code);
      if (!entry) return false;
      if (++entry.uses >= maxUses) codes.delete(code);
      return true;
    },
  };
}
export type LaunchCodes = ReturnType<typeof createLaunchCodes>;
