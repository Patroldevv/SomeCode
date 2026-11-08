import { useEffect, useState, type ReactNode } from 'react';

/** Keep in step with the `collapse-close` duration in index.css. */
const CLOSE_MS = 300;

/** Without `matchMedia` (tests, very old browsers) there is nothing to animate, so behave as "reduced". */
function reducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A region that opens and closes smoothly (the row height animates from/to zero). The content is mounted only
 * while it is open or still animating shut, so closed tool output and thoughts cost nothing. The wrapper itself
 * is always in the DOM, so `aria-controls` keeps pointing at something. With reduced motion — or on the very
 * first render — it simply shows or hides.
 */
export function Collapse({
  id,
  open,
  className,
  children,
}: {
  id?: string;
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  const [animated, setAnimated] = useState(false);
  const reduced = reducedMotion();

  // Adjust state while rendering (React's "derived state" pattern) so the first frame of a change is already correct.
  if (open !== prevOpen) {
    setPrevOpen(open);
    setAnimated(true);
  }
  if (open && !present) setPresent(true);

  useEffect(() => {
    if (open || !present) return;
    if (reduced) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, present, reduced]);

  const shown = open || (present && !reduced);
  return (
    <div id={id} hidden={!shown} data-state={open ? 'open' : 'closed'} data-animated={animated && !reduced} className="reveal">
      <div className="reveal-inner">
        <div className={className}>{shown && children}</div>
      </div>
    </div>
  );
}
