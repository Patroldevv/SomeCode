import { Fragment, useDeferredValue, useEffect, useRef, useState } from 'react';
import { highlightTokens, type HighlightedLine } from '../lib/highlight.ts';

/** At most one highlight start per this many ms while a block is streaming (trailing call keeps the latest text). */
const THROTTLE_MS = 150;

type Highlighted = { code: string; lang: string | undefined; lines: HighlightedLine[] };

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
  const lastStart = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    let active = true; // false once the text/language changed or the block unmounted
    const run = () => {
      lastStart.current = performance.now();
      highlightTokens(deferredCode, lang).then(
        (lines) => {
          if (active && lines) setHighlighted({ code: deferredCode, lang, lines });
        },
        () => {}, // highlighting is best effort: plain text stays
      );
    };
    const wait = lastStart.current + THROTTLE_MS - performance.now();
    const timer = wait > 0 ? setTimeout(run, wait) : undefined;
    if (timer === undefined) run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [deferredCode, lang]);

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
