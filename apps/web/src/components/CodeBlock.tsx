import { Fragment, useDeferredValue, useEffect, useState } from 'react';
import { highlightTokens, type HighlightedLine } from '../lib/highlight.ts';

/** Minimum gap between the end of one highlight and the start of the next. */
export const MIN_GAP_MS = 150;
/** The gap also grows with the cost of the last highlight (tokenising is synchronous, on the main thread). */
export const COST_FACTOR = 3;
/** Blocks larger than this are highlighted only once their text has been stable for STABLE_MS. */
export const LARGE_CODE = 20_000;
export const STABLE_MS = 300;

type Highlighted = { code: string; lang: string | undefined; lines: HighlightedLine[] };

/**
 * Decides when to (re)highlight a block whose text may change on every streamed chunk:
 *  - at most one highlight in flight; changes that arrive meanwhile are coalesced into one trailing run with the
 *    latest text;
 *  - the next run starts no earlier than `end + max(MIN_GAP_MS, COST_FACTOR × lastDuration)`, so an expensive
 *    block leaves the main thread mostly free while it streams;
 *  - large blocks wait until the text has been stable for STABLE_MS;
 *  - an empty block is never highlighted (a half-typed fence label would load the wrong grammar);
 *  - the final text is always highlighted once the stream stops.
 */
function createScheduler(onResult: (result: Highlighted) => void) {
  let latest: { code: string; lang: string | undefined } = { code: '', lang: undefined };
  let doneKey: string | null = null; // text+lang of the last finished run (whatever its result)
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextAllowed = Number.NEGATIVE_INFINITY;
  let alive = false;

  const keyOf = (code: string, lang: string | undefined) => `${lang ?? ''}\u0000${code}`;

  function schedule(): void {
    if (!alive || inFlight || latest.code === '' || keyOf(latest.code, latest.lang) === doneKey) return;
    const large = latest.code.length > LARGE_CODE;
    if (timer !== undefined) {
      if (!large) return; // the pending run will pick up the latest text
      clearTimeout(timer); // large: restart the stability window
      timer = undefined;
    }
    const wait = Math.max(nextAllowed - Date.now(), large ? STABLE_MS : 0);
    if (wait <= 0) start();
    else
      timer = setTimeout(() => {
        timer = undefined;
        start();
      }, wait);
  }

  function start(): void {
    const { code, lang } = latest;
    inFlight = true;
    const began = Date.now();
    const finish = (lines: HighlightedLine[] | null) => {
      const ended = Date.now();
      inFlight = false;
      nextAllowed = ended + Math.max(MIN_GAP_MS, COST_FACTOR * (ended - began));
      doneKey = keyOf(code, lang);
      if (!alive) return;
      // Still valid when the current text extends it (streaming); otherwise stale, dropped.
      if (lines && lang === latest.lang && latest.code.startsWith(code)) onResult({ code, lang, lines });
      schedule();
    };
    highlightTokens(code, lang).then(finish, () => finish(null));
  }

  return {
    update(code: string, lang: string | undefined): void {
      latest = { code, lang };
      schedule();
    },
    mount(): void {
      alive = true;
      schedule();
    },
    dispose(): void {
      alive = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

function Tokens({ lines }: { lines: HighlightedLine[] }) {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && '\n'}
      {line.map((token, j) => (
        <span key={j} style={token.color ? { color: token.color } : undefined}>
          {token.text}
        </span>
      ))}
    </Fragment>
  ));
}

/**
 * A fenced code block. Plain text renders immediately; Shiki tokens replace it when they arrive (as React
 * elements, never an HTML string). A result is used only while it still matches the text: for a block that is
 * still streaming, the highlighted prefix stays and the newly arrived tail is appended as plain text.
 */
export function CodeBlock({ code, lang }: { code: string; lang?: string | undefined }) {
  const deferredCode = useDeferredValue(code);
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  const [scheduler] = useState(() => createScheduler(setHighlighted));

  useEffect(() => {
    scheduler.mount();
    return () => scheduler.dispose(); // no state update after unmount
  }, [scheduler]);

  useEffect(() => {
    scheduler.update(deferredCode, lang);
  }, [scheduler, deferredCode, lang]);

  const usable =
    highlighted && highlighted.lang === lang && code.startsWith(highlighted.code) ? highlighted : null;

  return (
    <pre
      data-lang={lang}
      className="my-3 min-w-0 max-w-full overflow-x-auto whitespace-pre rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-[0.85em] leading-relaxed"
    >
      <code>
        {usable ? (
          <>
            <Tokens lines={usable.lines} />
            {code.slice(usable.code.length)}
          </>
        ) : (
          code
        )}
      </code>
    </pre>
  );
}
