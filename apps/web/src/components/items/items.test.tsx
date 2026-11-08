import { render, screen, within } from '@testing-library/react';
import * as jsdiff from 'diff';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../../i18n/index.ts';
import type { Item, ThoughtItem, ToolItem } from '../../lib/sessionState.ts';
import { AgentMessage } from './AgentMessage.tsx';
import { DiffView } from './DiffView.tsx';
import { ErrorCard } from './ErrorCard.tsx';
import { PermissionCard } from './PermissionCard.tsx';
import { PlanChecklist } from './PlanChecklist.tsx';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolCard } from './ToolCard.tsx';
import { UnsupportedRow } from './UnsupportedRow.tsx';
import { UserMessage } from './UserMessage.tsx';

// Pass-through spy on the line-diff engine (counts calls, keeps real behaviour).
vi.mock('diff', async (importOriginal) => {
  const real = await importOriginal<typeof import('diff')>();
  return { ...real, diffLines: vi.fn(real.diffLines) };
});
const engine = vi.mocked(jsdiff.diffLines);

type PermissionItem = Extract<Item, { kind: 'permission' }>;

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setLanguageForTests('en');
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});

afterEach(() => {
  // Pristine output: no act(...) warnings, no React key/prop warnings.
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  setLanguageForTests(null);
});

const thought = (patch: Partial<ThoughtItem> = {}): ThoughtItem => ({
  kind: 'thought',
  key: '1',
  text: 'pondering the codebase',
  startedAt: 1_000,
  endedAt: 7_000,
  ...patch,
});

const tool = (patch: Partial<ToolItem> = {}): ToolItem => ({
  kind: 'tool',
  key: '2',
  id: 't1',
  title: 'List files',
  toolKind: 'execute',
  status: 'completed',
  content: [],
  ...patch,
});

describe('ThinkingBlock', () => {
  it('while live, shows the streaming text and has no toggle button', () => {
    render(<ThinkingBlock item={thought({ endedAt: undefined })} live />);
    expect(screen.getByText('pondering the codebase')).toBeVisible();
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('when done, is a collapsed "Thought for 6 s" button that toggles the text', async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock item={thought()} live={false} />);
    const button = screen.getByRole('button', { name: /Thought for 6 s/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('pondering the codebase')).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const text = screen.getByText('pondering the codebase');
    expect(text).toBeVisible();
    expect(button.getAttribute('aria-controls')).toBe(text.closest('[id]')!.id);

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('pondering the codebase')).toBeNull();
  });

  it('uses the Turkish label', () => {
    setLanguageForTests('tr');
    render(<ThinkingBlock item={thought()} live={false} />);
    expect(screen.getByRole('button', { name: /Düşündü · 6 sn/ })).toBeInTheDocument();
  });

  it('says only "Thought" when the thought never ended (e.g. the agent disconnected)', () => {
    render(<ThinkingBlock item={thought({ endedAt: undefined })} live={false} />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent(/^Thought$/);
  });
});

describe('ToolCard', () => {
  it('labels a failed tool with the i18n "Failed" status', () => {
    render(<ToolCard item={tool({ status: 'failed' })} />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument();
    expect(screen.queryByText('failed')).toBeNull();
  });

  it('shows a check for a completed tool', () => {
    render(<ToolCard item={tool({ status: 'completed' })} />);
    expect(screen.getByRole('img', { name: 'Completed' })).toBeInTheDocument();
  });

  it('shows a spinner with role="status" while in progress', () => {
    render(<ToolCard item={tool({ status: 'in_progress' })} />);
    expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
  });

  it('shows an unknown status as a neutral dot, never as visible text', () => {
    render(<ToolCard item={tool({ status: 'weird_state' })} />);
    const dot = screen.getByRole('img', { name: 'Unknown status' });
    expect(dot).toHaveAttribute('title', 'weird_state');
    expect(screen.queryByText('weird_state')).toBeNull();
  });

  it('truncates a long title on one line and keeps the full title in `title`', () => {
    const long = 'Read '.repeat(80);
    render(<ToolCard item={tool({ title: long })} />);
    const title = screen.getByText(long.trim());
    expect(title).toHaveClass('truncate');
    expect(title).toHaveAttribute('title', long.trim());
  });

  it('labels the tool kind', () => {
    render(<ToolCard item={tool({ toolKind: 'search' })} />);
    expect(screen.getByRole('img', { name: 'Search' })).toBeInTheDocument();
    render(<ToolCard item={tool({ key: '3', toolKind: 'something_new' })} />);
    expect(screen.getAllByRole('img', { name: 'Tool' }).length).toBeGreaterThan(0);
  });

  it('summarises an edit as +9 -3', () => {
    const oldText = 'a\nb\nc\n';
    const newText = Array.from({ length: 9 }, (_, i) => `x${i}`).join('\n') + '\n';
    render(<ToolCard item={tool({ toolKind: 'edit', title: 'Edit a.ts', content: [{ type: 'diff', path: 'a.ts', oldText, newText }] })} />);
    expect(screen.getByRole('button', { name: /Edit a\.ts/ })).toHaveTextContent('+9 -3');
  });

  it('names the edit size for screen readers with correct plurals in both languages', () => {
    const edit = (oldText: string, newText: string, key: string) =>
      tool({ key, toolKind: 'edit', title: `Edit ${key}`, content: [{ type: 'diff', path: 'a.ts', oldText, newText }] });
    const { unmount } = render(<ToolCard item={edit('a\n', 'b\n', 'one')} />);
    expect(screen.getByRole('button', { name: /Edit one/ })).toHaveAccessibleName(/1 line added, 1 line removed/);
    unmount();
    render(<ToolCard item={edit('a\n', 'b\nc\n', 'two')} />);
    expect(screen.getByRole('button', { name: /Edit two/ })).toHaveAccessibleName(/2 lines added, 1 line removed/);
  });

  it('diffs each edit once: re-renders with a new content array of the same strings, and expanding, reuse it', async () => {
    const user = userEvent.setup();
    const oldText = 'memo-a\nmemo-b\n';
    const newText = 'memo-a\nmemo-c\n';
    const card = () => tool({ toolKind: 'edit', title: 'Edit m.ts', content: [{ type: 'diff', path: 'm.ts', oldText, newText }] });
    engine.mockClear();
    const { rerender } = render(<ToolCard item={card()} />);
    rerender(<ToolCard item={card()} />);
    rerender(<ToolCard item={{ ...card(), status: 'in_progress' }} />);
    await user.click(screen.getByRole('button', { name: /Edit m\.ts/ }));
    expect(screen.getByText('memo-c')).toBeVisible();
    expect(engine).toHaveBeenCalledTimes(1);
  });

  it('expands to show the input JSON and the output', async () => {
    const user = userEvent.setup();
    render(
      <ToolCard
        item={tool({
          rawInput: { command: 'ls' },
          content: [
            { type: 'text', text: 'file-a\nfile-b' },
            { type: 'terminal', terminalId: 'term-7' },
          ],
        })}
      />,
    );
    const button = screen.getByRole('button', { name: /List files/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/"command": "ls"/)).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Input')).toBeVisible();
    expect(screen.getByText(/"command": "ls"/)).toBeVisible();
    expect(screen.getByText('Output')).toBeVisible();
    const output = screen.getByText(/file-a/);
    expect(output).toHaveClass('font-mono');
    expect(screen.getByText('Terminal: term-7')).toBeVisible();

    await user.click(button);
    expect(screen.queryByText(/"command": "ls"/)).toBeNull();
  });

  it('shows the diff of an edit when expanded', async () => {
    const user = userEvent.setup();
    render(<ToolCard item={tool({ toolKind: 'edit', content: [{ type: 'diff', path: 'src/a.ts', oldText: 'one\n', newText: 'two\n' }] })} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('src/a.ts')).toBeVisible();
    expect(screen.getByText('two').closest('ins')).not.toBeNull();
    expect(screen.getByText('one').closest('del')).not.toBeNull();
  });

  it('falls back to rawOutput when there are no content blocks', async () => {
    const user = userEvent.setup();
    render(<ToolCard item={tool({ rawOutput: { exitCode: 0 } })} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText(/"exitCode": 0/)).toBeVisible();
  });

  it('caps a 30 000-character output at the first 20 000 characters with a note', async () => {
    const user = userEvent.setup();
    render(<ToolCard item={tool({ content: [{ type: 'text', text: 'x'.repeat(30_000) }] })} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('x'.repeat(20_000))).toBeVisible();
    expect(screen.getByText('Showing the first 20 000 characters; 10 000 more are not shown.')).toBeVisible();
  });
});

describe('DiffView', () => {
  it('marks additions and removals with +/- and an accessible name, not only colour', () => {
    const { container } = render(<DiffView path="a.ts" oldText={'keep\nold\n'} newText={'keep\nnew\n'} />);
    const ins = container.querySelector('ins')!;
    const del = container.querySelector('del')!;
    expect(ins).toHaveTextContent('+');
    expect(ins).toHaveTextContent('Added');
    expect(ins).toHaveTextContent('new');
    expect(del).toHaveTextContent('-');
    expect(del).toHaveTextContent('Removed');
    expect(screen.getByText('keep')).toBeInTheDocument();
  });

  it('labels a new file and shows every line as an addition', () => {
    const { container } = render(<DiffView path="b.ts" oldText={null} newText={'a\nb\n'} />);
    expect(screen.getByText('New file')).toBeInTheDocument();
    expect(container.querySelectorAll('ins')).toHaveLength(2);
    expect(container.querySelector('del')).toBeNull();
  });

  it('collapses distant unchanged lines into a muted "…" row', () => {
    const lines = (s: string) => Array.from({ length: 20 }, (_, i) => (i === 10 ? s : `l${i}`)).join('\n') + '\n';
    render(<DiffView path="c.ts" oldText={lines('a')} newText={lines('b')} />);
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('cuts a huge diff and says so', () => {
    const { container } = render(<DiffView path="min.js" oldText={null} newText={'y'.repeat(5_000_000)} />);
    expect(container.querySelector('ins')!.textContent!.length).toBeLessThan(2_100);
    expect(screen.getByText('This diff is too long to show in full, so some lines or parts of lines are not shown.')).toBeVisible();
  });

  it('shows no note when nothing was cut', () => {
    render(<DiffView path="a.ts" oldText={'a\n'} newText={'b\n'} />);
    expect(screen.queryByText(/too long to show/)).toBeNull();
  });

  it('scrolls long lines horizontally instead of wrapping them', () => {
    const { container } = render(<DiffView path="d.ts" oldText={null} newText={'y'.repeat(2000)} />);
    expect(container.querySelector('ins')).toHaveClass('whitespace-pre');
    expect(container.querySelector('.overflow-auto')).not.toBeNull();
  });
});

describe('PermissionCard', () => {
  const perm = (patch: Partial<PermissionItem> = {}): PermissionItem => ({
    kind: 'permission',
    key: '5',
    requestId: 'r1',
    toolCallId: 't1',
    title: 'Run rm -rf build',
    options: [
      { id: 'o1', name: 'Allow once', kind: 'allow_once' },
      { id: 'o2', name: 'Reject', kind: 'reject_once' },
    ],
    resolved: false,
    ...patch,
  });

  it("shows exactly the agent's own options as buttons (no extra Reject)", () => {
    render(<PermissionCard item={perm({ options: [{ id: 'o1', name: 'Allow once', kind: 'allow_once' }] })} answered={false} onRespond={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow once']);
    expect(screen.getByText('Run rm -rf build')).toBeInTheDocument();
  });

  it('calls onRespond(requestId, optionId) once per click', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<PermissionCard item={perm()} answered={false} onRespond={onRespond} />);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('r1', 'o2');
  });

  it('disables every button once answered', () => {
    render(<PermissionCard item={perm()} answered onRespond={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toBeDisabled();
  });

  it('says "Answered" and offers no buttons once resolved', () => {
    render(<PermissionCard item={perm({ resolved: true })} answered={false} onRespond={() => {}} />);
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PlanChecklist', () => {
  it('distinguishes pending, in-progress and completed entries', () => {
    render(
      <PlanChecklist
        plan={[
          { content: 'Read the code', status: 'completed', priority: 'high' },
          { content: 'Write the fix', status: 'in_progress', priority: 'high' },
          { content: 'Run the tests', status: 'pending', priority: 'medium' },
          { content: 'Mystery', status: 'blocked', priority: 'low' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[0]!).getByRole('img', { name: 'Completed' })).toBeInTheDocument();
    expect(within(items[1]!).getByRole('img', { name: 'In progress' })).toBeInTheDocument();
    expect(within(items[2]!).getByRole('img', { name: 'Pending' })).toBeInTheDocument();
    expect(within(items[3]!).getByRole('img', { name: 'Unknown status' })).toHaveAttribute('title', 'blocked');
    expect(screen.getByText('Read the code')).toHaveClass('line-through');
    expect(screen.getByText('Write the fix')).toHaveClass('font-medium');
  });
});

describe('messages and rows', () => {
  it('UserMessage shows the text as plain text', () => {
    render(<UserMessage text={'**not bold**\nsecond line'} />);
    expect(screen.getByText(/\*\*not bold\*\*/)).toBeInTheDocument();
    expect(document.querySelector('strong')).toBeNull();
  });

  it('AgentMessage renders markdown in the voice font', () => {
    const { container } = render(<AgentMessage text="Hello **world**" />);
    expect(screen.getByText('world').tagName).toBe('STRONG');
    expect(container.firstElementChild).toHaveClass('font-voice');
  });

  it('ErrorCard is an alert with the code message only', () => {
    render(<ErrorCard code="disconnected" />);
    expect(screen.getByRole('alert')).toHaveTextContent('The agent is not connected, so start a new session.');
  });

  it('ErrorCard falls back to the internal message for an unknown code', () => {
    render(<ErrorCard code={'nope' as never} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong inside SomeCode/);
  });

  it('UnsupportedRow shows the label with the raw tag as secondary text', () => {
    render(<UnsupportedRow sessionUpdate="usage_update" />);
    expect(screen.getByText('Unsupported update')).toBeInTheDocument();
    expect(screen.getByText('usage_update')).toHaveClass('font-mono');
  });
});

describe('ErrorCard sign-in hint', () => {
  it('shows the agent\'s sign-in command for auth_required', () => {
    render(<ErrorCard code="auth_required" signInHint="claude auth login" />);
    expect(screen.getByText('claude auth login')).toBeInTheDocument();
    expect(screen.getByText(/Run this in a terminal/)).toBeInTheDocument();
  });

  it('shows no hint for other codes, or when the agent has none', () => {
    const { rerender } = render(<ErrorCard code="disconnected" signInHint="claude auth login" />);
    expect(screen.queryByText('claude auth login')).not.toBeInTheDocument();
    rerender(<ErrorCard code="auth_required" />);
    expect(screen.queryByText(/Run this in a terminal/)).not.toBeInTheDocument();
  });
});
