import { render, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMessage } from './items/AgentMessage.tsx';

// Deterministic: no real Shiki in jsdom (Ruling K).
vi.mock('../lib/highlight.ts', () => ({ highlightTokens: vi.fn(async () => null) }));
// Pass-through parse counter: every call of react-markdown's component is one parse of its `children`.
vi.mock('react-markdown', async (orig) => {
  const real = await orig<typeof import('react-markdown')>();
  return { ...real, default: vi.fn(real.default) };
});
const parse = vi.mocked(ReactMarkdown);
const parsesOf = (text: string) => parse.mock.calls.filter(([props]) => props.children === text).length;

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  parse.mockClear();
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('AgentMessage: block-wise streaming markdown', () => {
  it('while a message streams, earlier blocks are parsed once and only the last block re-parses', () => {
    const blocks = [
      '# Plan\n\n',
      'First we read the **config**.\n\n',
      '```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n',
      '| file | change |\n| - | - |\n| a.ts | edit |\n\n',
      'Then we run the tests and report back.',
    ];
    const full = blocks.join('');
    const { rerender } = render(<AgentMessage text={full.slice(0, 1)} />);
    // Stream it two characters per chunk.
    for (let end = 3; end < full.length; end += 2) rerender(<AgentMessage text={full.slice(0, end)} />);
    rerender(<AgentMessage text={full} />);

    for (const block of blocks.slice(0, -1)) expect(parsesOf(block)).toBe(1);
    expect(parsesOf(blocks[blocks.length - 1]!)).toBe(1);
    // Total parses ≈ one per chunk (the last block) + one per completed block, not chunks × blocks.
    const chunks = Math.ceil(full.length / 2) + 1;
    expect(parse.mock.calls.length).toBeLessThanOrEqual(chunks + blocks.length);
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Then we run the tests and report back.')).toBeInTheDocument();
  });

  it('a re-render with unchanged text parses nothing', () => {
    const text = 'one\n\ntwo\n\nthree';
    const { rerender } = render(<AgentMessage text={text} />);
    expect(parse).toHaveBeenCalledTimes(3);
    rerender(<AgentMessage text={text} />);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it('a reference definition anywhere makes it one parse of the whole text, so the link resolves', () => {
    const text = 'See [the docs][d].\n\nMore text.\n\n[d]: https://example.com/docs';
    render(<AgentMessage text={text} />);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://example.com/docs');
  });

  it('a footnote in a later block still links to its definition', () => {
    const text = 'A claim.[^1]\n\nMore.\n\n[^1]: The source.';
    const { container } = render(<AgentMessage text={text} />);
    expect(container.querySelector('a[href="#user-content-fn-1"]')).not.toBeNull();
    expect(screen.getByText('The source.', { exact: false })).toBeInTheDocument();
  });

  it('margins collapse across blocks: all block elements are siblings in one container', () => {
    const { container } = render(<AgentMessage text={'one\n\ntwo\n\nthree'} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]!.parentElement).toBe(paragraphs[2]!.parentElement);
  });
});
