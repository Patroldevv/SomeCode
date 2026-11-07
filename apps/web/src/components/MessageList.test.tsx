import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { Item, PlanEntry, SessionStatus } from '../lib/sessionState.ts';
import { AgentMessage } from './items/AgentMessage.tsx';
import { PermissionCard } from './items/PermissionCard.tsx';
import { ThinkingBlock } from './items/ThinkingBlock.tsx';
import { ToolCard } from './items/ToolCard.tsx';
import { MessageList } from './MessageList.tsx';

// Deterministic: no real Shiki in jsdom.
vi.mock('../lib/highlight.ts', () => ({ highlightTokens: vi.fn(async () => null) }));

// Pass-through render counters on the row components (real behaviour, counted calls).
vi.mock('./items/AgentMessage.tsx', async (orig) => {
  const real = await orig<typeof import('./items/AgentMessage.tsx')>();
  return { AgentMessage: vi.fn(real.AgentMessage) };
});
vi.mock('./items/ToolCard.tsx', async (orig) => {
  const real = await orig<typeof import('./items/ToolCard.tsx')>();
  return { ToolCard: vi.fn(real.ToolCard) };
});
vi.mock('./items/ThinkingBlock.tsx', async (orig) => {
  const real = await orig<typeof import('./items/ThinkingBlock.tsx')>();
  return { ThinkingBlock: vi.fn(real.ThinkingBlock) };
});
vi.mock('./items/PermissionCard.tsx', async (orig) => {
  const real = await orig<typeof import('./items/PermissionCard.tsx')>();
  return { PermissionCard: vi.fn(real.PermissionCard) };
});

const VIEWPORT = 600;
const ROW = 40;

// jsdom has no layout: every element reports a fixed client box (the scroll container's viewport) and every
// row a fixed height, which is what TanStack Virtual reads (clientHeight for the scroller, offsetHeight for rows).
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  const proto = HTMLElement.prototype;
  for (const name of ['clientHeight', 'clientWidth', 'offsetHeight', 'offsetWidth']) {
    saved.set(name, Object.getOwnPropertyDescriptor(proto, name));
  }
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => ROW });
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 800 });
});
afterAll(() => {
  const proto = HTMLElement.prototype;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[name];
  }
});

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setLanguageForTests('en');
  vi.mocked(AgentMessage).mockClear();
  vi.mocked(ToolCard).mockClear();
  vi.mocked(ThinkingBlock).mockClear();
  vi.mocked(PermissionCard).mockClear();
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

const user = (key: string, text = `user ${key}`): Item => ({ kind: 'user', key, text });
const agent = (key: string, text = `agent ${key}`): Item => ({ kind: 'agent', key, text });
const thought = (key: string, endedAt?: number): Item => ({
  kind: 'thought',
  key,
  text: `thinking ${key}`,
  startedAt: 1000,
  ...(endedAt === undefined ? {} : { endedAt }),
});
const tool = (key: string): Item => ({
  kind: 'tool',
  key,
  id: `tc-${key}`,
  title: `tool ${key}`,
  toolKind: 'edit',
  status: 'completed',
  content: [{ type: 'diff', path: `/src/${key}.ts`, oldText: 'a\nb\n', newText: 'a\nc\n' }],
});
const permission = (key: string): Item => ({
  kind: 'permission',
  key,
  requestId: `req-${key}`,
  toolCallId: `tc-${key}`,
  title: `permission ${key}`,
  options: [{ id: 'allow', name: 'Allow once', kind: 'allow_once' }],
  resolved: false,
});

const noAnswers: ReadonlySet<string> = new Set();
const noop = () => {};

function List({
  items,
  plan = null,
  status = 'ready',
  answeredRequests = noAnswers,
  onRespond = noop,
}: {
  items: Item[];
  plan?: PlanEntry[] | null;
  status?: SessionStatus;
  answeredRequests?: ReadonlySet<string>;
  onRespond?: (requestId: string, optionId: string) => void;
}) {
  return (
    <div style={{ height: VIEWPORT }}>
      <MessageList items={items} plan={plan} status={status} answeredRequests={answeredRequests} onRespond={onRespond} />
    </div>
  );
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-item-key]'));
const rowKeys = () => rows().map((r) => r.dataset['itemKey']);

/** Render calls of a counted row component whose `item` has this key. */
function callsFor(component: unknown, key: string): number {
  return (component as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[0] as { item?: Item }).item?.key === key)
    .length;
}

/** Render calls of `AgentMessage` (which gets `text` only) whose text starts with `prefix`. */
function agentCalls(prefix: string): number {
  return vi.mocked(AgentMessage).mock.calls.filter((c) => c[0].text.startsWith(prefix)).length;
}

describe('MessageList', () => {
  it('renders every item of a short list, in order', () => {
    const items = [user('1'), thought('2', 3000), agent('3'), tool('4'), permission('5')];
    render(<List items={items} />);
    expect(rowKeys()).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByText('user 1')).toBeInTheDocument();
    expect(screen.getByText('agent 3')).toBeInTheDocument();
    expect(screen.getByText('tool 4')).toBeInTheDocument();
    expect(screen.getByText('permission 5')).toBeInTheDocument();
  });

  it('virtualizes a long list: only a window of rows is in the DOM', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => user(String(i + 1)));
    render(<List items={items} />);
    const count = rows().length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(60);
  });

  it('is a labelled, keyboard-scrollable log that does not announce streaming', () => {
    render(<List items={[user('1')]} />);
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(log).toHaveAttribute('aria-live', 'off');
    expect(log).toHaveAttribute('tabindex', '0');
  });

  it('puts a sticky plan before the rows, outside the item count', () => {
    const plan: PlanEntry[] = [
      { content: 'Read the code', status: 'completed', priority: 'medium' },
      { content: 'Write the fix', status: 'in_progress', priority: 'high' },
    ];
    render(<List items={[user('1'), agent('2')]} plan={plan} />);
    const heading = screen.getByRole('heading', { name: 'Plan' });
    const sticky = heading.closest<HTMLElement>('[data-sticky-plan]') as HTMLElement;
    expect(sticky).not.toBeNull();
    expect(sticky.style.position).toBe('sticky');
    expect(screen.getByRole('log')).toContainElement(sticky);
    const firstRow = rows()[0] as HTMLElement;
    expect(sticky.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowKeys()).toEqual(['1', '2']);
  });

  it('shows no plan box for a null or empty plan', () => {
    const { rerender } = render(<List items={[user('1')]} plan={null} />);
    expect(document.querySelector('[data-sticky-plan]')).toBeNull();
    rerender(<List items={[user('1')]} plan={[]} />);
    expect(document.querySelector('[data-sticky-plan]')).toBeNull();
  });

  it('shows the last thought live (open) only while running with no endedAt', () => {
    const { rerender } = render(<List items={[user('1'), thought('2')]} status="running" />);
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.getByText('thinking 2')).toBeVisible();

    // The turn ended: folded "Thought" toggle, text hidden.
    rerender(<List items={[user('1'), thought('2')]} status="ready" />);
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(screen.getByRole('button', { name: /^Thought/ })).toHaveAttribute('aria-expanded', 'false');

    // Running but the thought has ended.
    rerender(<List items={[user('1'), thought('2', 4000)]} status="running" />);
    expect(screen.queryByText('Thinking…')).toBeNull();

    // Running, open thought, but not the last item.
    rerender(<List items={[user('1'), thought('2'), agent('3')]} status="running" />);
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('streaming into the last item does not re-render earlier rows', () => {
    const items = [agent('1'), tool('2'), thought('3', 5000), permission('4'), agent('5', 'Hel')];
    const { rerender } = render(<List items={items} status="running" />);
    const before = {
      agent1: agentCalls('agent 1'),
      tool: callsFor(ToolCard, '2'),
      thought: callsFor(ThinkingBlock, '3'),
      permission: callsFor(PermissionCard, '4'),
      agent5: agentCalls('Hel'),
    };
    expect(before.tool).toBeGreaterThan(0);

    // The reducer keeps unchanged items by reference and replaces only the last one.
    const streamed = [...items.slice(0, -1), agent('5', 'Hello')];
    rerender(<List items={streamed} status="running" />);
    const more = [...items.slice(0, -1), agent('5', 'Hello, world')];
    // A new (but equal) answered set and onRespond must not re-render the permission row either.
    rerender(<List items={more} status="running" answeredRequests={new Set()} onRespond={() => {}} />);

    expect(before.agent1).toBeGreaterThan(0);
    expect(agentCalls('agent 1')).toBe(before.agent1);
    expect(callsFor(ToolCard, '2')).toBe(before.tool);
    expect(callsFor(ThinkingBlock, '3')).toBe(before.thought);
    expect(callsFor(PermissionCard, '4')).toBe(before.permission);
    expect(agentCalls('Hel')).toBeGreaterThan(before.agent5);
    expect(screen.getByText('Hello, world')).toBeInTheDocument();
  });

  it('streaming into a live last thought does not re-render earlier rows', () => {
    const items = [tool('1'), agent('2'), thought('3')];
    const { rerender } = render(<List items={items} status="running" />);
    const toolBefore = callsFor(ToolCard, '1');
    const agentBefore = agentCalls('agent 2');
    const thoughtBefore = callsFor(ThinkingBlock, '3');
    const [first, second, last] = items as [Item, Item, Item];
    rerender(<List items={[first, second, { ...last, text: 'more' } as Item]} status="running" />);
    expect(callsFor(ToolCard, '1')).toBe(toolBefore);
    expect(agentCalls('agent 2')).toBe(agentBefore);
    expect(callsFor(ThinkingBlock, '3')).toBeGreaterThan(thoughtBefore);
    expect(screen.getByText('more')).toBeInTheDocument();
  });

  it('re-renders a permission row when its answered state changes, and forwards the answer', () => {
    const onRespond = vi.fn();
    const items = [permission('1')];
    const { rerender } = render(<List items={items} onRespond={onRespond} />);
    const button = screen.getByRole('button', { name: 'Allow once' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onRespond).toHaveBeenCalledWith('req-1', 'allow');
    rerender(<List items={items} onRespond={onRespond} answeredRequests={new Set(['req-1'])} />);
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
  });

  it('never re-orders, loses or remounts rows when items are appended', () => {
    const items = [user('1'), agent('2'), tool('3')];
    const { rerender } = render(<List items={items} />);
    const nodes = rows();
    expect(rowKeys()).toEqual(['1', '2', '3']);

    const appended = [...items, thought('4', 2000), agent('5')];
    rerender(<List items={appended} />);
    expect(rowKeys()).toEqual(['1', '2', '3', '4', '5']);
    const after = rows();
    nodes.forEach((node, i) => expect(after[i]).toBe(node));

    rerender(<List items={[...appended, user('6')]} />);
    expect(rowKeys()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('a wheel up shows the jump button with the new-item count; clicking it follows again and keeps focus in the log', () => {
    const items = [user('1'), agent('2')];
    const { rerender } = render(<List items={items} />);
    const log = screen.getByRole('log');
    // jsdom does not scroll: give the log a writable, clamped scrollTop that starts at its end.
    let top = 400;
    Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(log, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => (top = Math.max(0, Math.min(v, 1000 - VIEWPORT))),
    });
    fireEvent.wheel(log, { deltaY: -60 });
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();

    rerender(<List items={[...items, agent('3')]} />);
    const button = screen.getByRole('button', { name: /Jump to latest/ });
    expect(button).toHaveTextContent('1 new');

    top = 100;
    fireEvent.click(button);
    expect(top).toBe(1000 - VIEWPORT);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
    expect(log).toHaveFocus();
  });

  describe('expanded tool cards and thoughts survive virtualization', () => {
    /** Gives the log a clamped, writable scrollTop (jsdom does not scroll) over `count` rows of ROW px. */
    function scrollable(count: number) {
      const log = screen.getByRole('log');
      let top = 0;
      const height = () => count * ROW + 40;
      Object.defineProperty(log, 'scrollHeight', { configurable: true, get: height });
      Object.defineProperty(log, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (v: number) => (top = Math.max(0, Math.min(v, height() - VIEWPORT))),
      });
      return {
        log,
        scrollTo(v: number) {
          top = v;
          fireEvent.scroll(log);
        },
        setCount(n: number) {
          count = n;
        },
      };
    }
    const many = (n: number) => Array.from({ length: n }, (_, i) => user(`u${i}`));
    const toggleOf = (name: RegExp) => screen.getByRole('button', { name });

    it('a tool card opened, scrolled out of the window (row unmounted) and back is still open', () => {
      const head = [tool('t'), thought('th', 4000), user('1')];
      const { rerender } = render(<List items={head} />);
      fireEvent.click(toggleOf(/tool t/));
      fireEvent.click(toggleOf(/^Thought/));
      expect(toggleOf(/tool t/)).toHaveAttribute('aria-expanded', 'true');
      expect(toggleOf(/^Thought/)).toHaveAttribute('aria-expanded', 'true');

      const scroller = scrollable(head.length);
      const long = [...head, ...many(100)];
      scroller.setCount(long.length);
      rerender(<List items={long} />); // pinned: follows the end
      fireEvent.scroll(scroller.log);
      expect(rowKeys()).not.toContain('t');
      expect(rowKeys()).not.toContain('th');

      scroller.scrollTo(0);
      expect(rowKeys()).toContain('t');
      expect(toggleOf(/tool t/)).toHaveAttribute('aria-expanded', 'true');
      expect(toggleOf(/^Thought/)).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('thinking th')).toBeVisible();

      // Closing works the same way and also survives.
      fireEvent.click(toggleOf(/tool t/));
      scroller.scrollTo(100 * ROW);
      expect(rowKeys()).not.toContain('t');
      scroller.scrollTo(0);
      expect(toggleOf(/tool t/)).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggling one card re-renders that row only', () => {
      const items = [tool('1'), agent('2'), tool('3'), thought('4', 3000)];
      render(<List items={items} />);
      const before = {
        tool1: callsFor(ToolCard, '1'),
        tool3: callsFor(ToolCard, '3'),
        thought: callsFor(ThinkingBlock, '4'),
        agent: agentCalls('agent 2'),
      };
      fireEvent.click(toggleOf(/tool 3/));
      expect(toggleOf(/tool 3/)).toHaveAttribute('aria-expanded', 'true');
      expect(callsFor(ToolCard, '3')).toBeGreaterThan(before.tool3);
      expect(callsFor(ToolCard, '1')).toBe(before.tool1);
      expect(callsFor(ThinkingBlock, '4')).toBe(before.thought);
      expect(agentCalls('agent 2')).toBe(before.agent);
    });

    it('a live thought still folds when it ends (nothing stale), and opens only when the user asks', () => {
      const { rerender } = render(<List items={[user('1'), thought('2')]} status="running" />);
      expect(screen.getByText('Thinking…')).toBeInTheDocument();
      rerender(<List items={[user('1'), thought('2', 4000)]} status="ready" />);
      expect(toggleOf(/^Thought/)).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggleOf(/^Thought/));
      expect(toggleOf(/^Thought/)).toHaveAttribute('aria-expanded', 'true');
    });

    it('another session (a remounted list) starts with nothing open', () => {
      const { rerender } = render(<List items={[tool('1')]} />);
      fireEvent.click(toggleOf(/tool 1/));
      rerender(
        <div style={{ height: VIEWPORT }}>
          <MessageList key="other" items={[tool('1')]} plan={null} status="ready" answeredRequests={noAnswers} onRespond={noop} />
        </div>,
      );
      expect(toggleOf(/tool 1/)).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('hides the jump button while following the end', () => {
    render(<List items={[user('1'), agent('2')]} />);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });
});
