import { useEffect, useState } from 'react';

/** Without `matchMedia` (tests, very old browsers) there is nothing to animate, so behave as "reduced". */
function reducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Whether something that animates out should still be mounted: true while `open`, and for `ms` after it closes so
 * the closing animation can play. With reduced motion it follows `open` exactly.
 */
export function usePresence(open: boolean, ms: number): boolean {
  const [present, setPresent] = useState(open);
  const reduced = reducedMotion();
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    if (reduced) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), ms);
    return () => clearTimeout(timer);
  }, [open, present, reduced, ms]);
  return open || (present && !reduced);
}
