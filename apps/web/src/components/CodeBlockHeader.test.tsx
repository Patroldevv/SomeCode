import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { CodeBlock } from './CodeBlock.tsx';

vi.mock('../lib/highlight.ts', () => ({ highlightTokens: vi.fn(async () => null) }));

beforeAll(() => setLanguageForTests('en'));
afterEach(() => vi.restoreAllMocks());

describe('CodeBlock header', () => {
  it('names the language and copies the raw code', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<CodeBlock code={'const a = 1;\nconst b = 2;'} lang="ts" />);
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('ts')).toBeInTheDocument();
    await user.click(within(figure).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = 2;');
    expect(await within(figure).findByText('Copied')).toBeInTheDocument();
  });

  it('labels a block without a language as plain text and survives a failing clipboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<CodeBlock code="hello" />);
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('text')).toBeInTheDocument();
    await user.click(within(figure).getByRole('button', { name: 'Copy' }));
    expect(within(figure).queryByText('Copied')).not.toBeInTheDocument();
    expect(within(figure).getByText('hello')).toBeInTheDocument();
  });

  it('renders a hostile language label as text', () => {
    const { container } = render(<CodeBlock code="x" lang={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});
