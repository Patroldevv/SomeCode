import { memo } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitMarkdownBlocks } from '../lib/markdownBlocks.ts';
import { safeHref } from '../lib/safeUrl.ts';
import { CodeBlock } from './CodeBlock.tsx';

// Renders UNTRUSTED agent markdown. Safety rests on:
//  - no raw HTML: react-markdown turns HTML in the source into text (no rehype-raw, `skipHtml` left off so the
//    user still sees what the agent wrote);
//  - URLs pass react-markdown's own `defaultUrlTransform` AND the stricter `safeHref`; the `a` component checks
//    `safeHref` again and renders a plain <span> when it refuses;
//  - images never become <img> (no request leaves the page), only their alt text is shown;
//  - code is highlighted into React elements, never injected as HTML.

type HastNode = NonNullable<ExtraProps['node']>['children'][number];

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

const urlTransform: UrlTransform = (url) => (defaultUrlTransform(url) ? (safeHref(url) ?? '') : '');

const remarkPlugins = [remarkGfm];

const components: Components = {
  // `id` / `aria-label` / `aria-describedby` carry GFM footnote anchors and their accessible labels.
  a: ({ href, title, id, 'aria-label': ariaLabel, 'aria-describedby': describedBy, children }) => {
    const safe = href ? safeHref(href) : null;
    if (safe === null) return <span id={id}>{children}</span>;
    const web = /^https?:/i.test(safe);
    return (
      <a
        href={safe}
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className="text-accent underline underline-offset-2"
        {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    );
  },
  img: ({ alt }) => (alt ? <span className="text-text-muted">{alt}</span> : null),
  pre: ({ node }) => {
    const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
    const classes = code?.type === 'element' ? code.properties['className'] : undefined;
    const langClass = Array.isArray(classes)
      ? classes.find((c): c is string => typeof c === 'string' && c.startsWith('language-'))
      : undefined;
    const text = code ? textOf(code).replace(/\n$/, '') : '';
    return <CodeBlock code={text} lang={langClass?.slice('language-'.length)} />;
  },
  code: ({ children }) => (
    <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  p: ({ children }) => <p className="my-2">{children}</p>,
  h1: ({ children }) => <h1 className="mt-5 mb-2 text-[1.5em] leading-tight font-semibold">{children}</h1>,
  // GFM gives the footnotes heading `className="sr-only"` and an id: both must survive.
  h2: ({ children, id, className }) => (
    <h2 id={id} className={className ?? 'mt-5 mb-2 text-[1.3em] leading-tight font-semibold'}>
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 className="mt-4 mb-2 text-[1.15em] leading-snug font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-1 font-semibold">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-3 mb-1 font-semibold">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-3 mb-1 font-semibold text-text-muted">{children}</h6>,
  ul: ({ children, className }) => (
    <ul className={`my-2 pl-6 ${className === 'contains-task-list' ? 'list-none' : 'list-disc'}`}>{children}</ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 list-decimal pl-6">
      {children}
    </ol>
  ),
  li: ({ children, id }) => (
    <li id={id} className="my-0.5">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 text-text-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto">
      <table className="border-collapse text-[0.95em]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-border bg-bg-subtle px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-border px-2 py-1">
      {children}
    </td>
  ),
};

/**
 * One top-level block, parsed on its own. Memoised on its text: while a message streams only the last block
 * changes, so only it is re-parsed. Renders no wrapper, so all blocks are siblings in `Markdown`'s container
 * (vertical margins collapse across blocks exactly as in a single parse).
 */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components} urlTransform={urlTransform}>
      {text}
    </ReactMarkdown>
  );
});

/**
 * Agent markdown (GFM). Inherits font family and size from its parent. Safe to re-render on every chunk:
 * the text is split into blocks (`splitMarkdownBlocks`) keyed by index, and unchanged blocks are not re-parsed.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = splitMarkdownBlocks(text);
  return (
    <div className="min-w-0 [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      {blocks.map((block, index) => (
        // Index keys are right here: blocks only ever grow at the end (prefix-stable split).
        <MarkdownBlock key={index} text={block} />
      ))}
    </div>
  );
}
