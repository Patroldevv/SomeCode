import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Client } from './App.tsx';
import { en } from './i18n/en.ts';
import { setLanguageForTests } from './i18n/index.ts';
import { ApiError, type Api, type SessionInfo } from './lib/api.ts';
import type { SocketLike } from './lib/connection.ts';
import { createSessionsStore, type SessionsStore } from './lib/sessionsStore.ts';

// Deterministic: no real Shiki in jsdom (Ruling K).
vi.mock('./lib/highlight.ts', () => ({ highlightTokens: vi.fn(async () => null) }));

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    act(() => this.onopen?.({}));
  }
  drop(): void {
    this.readyState = 3;
    act(() => this.onclose?.({}));
  }
  /** One WS message, then the frame it is rendered in (the store coalesces event notifications per frame). */
  receive(msg: unknown): void {
    act(() => this.onmessage?.({ data: JSON.stringify(msg) }));
    act(() => store.flush());
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

// jsdom has no layout: give the virtualized list a viewport and rows a height (as in MessageList.test).
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  const proto = HTMLElement.prototype;
  for (const name of ['clientHeight', 'clientWidth', 'offsetHeight', 'offsetWidth']) {
    saved.set(name, Object.getOwnPropertyDescriptor(proto, name));
  }
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 40 });
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 800 });
});
afterAll(() => {
  const proto = HTMLElement.prototype;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[name];
  }
});

const row = (id: string, createdAt = Date.now() - 60_000): SessionInfo => ({
  id,
  projectId: 'p1',
  agentId: 'claude',
  createdAt,
  title: null,
});

function fakeApi(sessions: SessionInfo[] = [row('s1')]) {
  const list = [...sessions];
  return {
    agents: vi.fn(async () => [{ id: 'claude', label: 'Claude Code', installed: true }]),
    projects: vi.fn(async () => [{ id: 'p1', name: 'alpha', path: '/home/u/alpha' }]),
    projectSessions: vi.fn(async () => [...list]),
    addProject: vi.fn(async (name: string, path: string) => ({ id: 'p2', name, path })),
    createSession: vi.fn(async (projectId: string, agentId: string) => {
      const created = { ...row('new'), projectId, agentId };
      list.push(created);
      return created;
    }),
  } satisfies Api;
}

let sockets: FakeSocket[];
/** Frames never run on their own: `FakeSocket.receive` flushes explicitly. */
let store: SessionsStore;
const createSocket = () => {
  const s = new FakeSocket();
  sockets.push(s);
  return s;
};
const socket = () => sockets[sockets.length - 1]!;

async function renderClient(api = fakeApi()) {
  render(<Client token="t" api={api} createSocket={createSocket} store={store} />);
  // Let the catalog requests settle so the sidebar is filled.
  await screen.findByRole('region', { name: 'alpha' });
  return api;
}

const event = (seq: number, sessionId: string, e: Record<string, unknown>) => ({
  type: 'event',
  stored: { seq, sessionId, ts: 0, event: e },
});
const box = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;

beforeEach(() => {
  setLanguageForTests('en');
  sockets = [];
  store = createSessionsStore({ schedule: () => () => {} });
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => setLanguageForTests(null));

describe('App', () => {
  it('without a token shows the token page', () => {
    render(<App />);
    expect(screen.getByText(en['token.missing'])).toBeInTheDocument();
  });
});

describe('Client', () => {
  it('without a remembered session shows the empty state and subscribes to nothing', async () => {
    await renderClient();
    socket().open();
    expect(screen.getByRole('heading', { name: 'Start your first session' })).toBeInTheDocument();
    expect(socket().sent).toEqual([]);
  });

  it('a restored session subscribes from seq 0 and shows its events', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    expect(socket().sent).toEqual([{ type: 'subscribe', sessionId: 's1', afterSeq: 0 }]);
    socket().receive({ type: 'subscribed', sessionId: 's1', lastSeq: 2 });
    socket().receive(event(1, 's1', { type: 'user_message', text: 'Earlier question' }));
    socket().receive(event(2, 's1', { type: 'agent_message', text: 'Earlier answer' }));
    expect(screen.getByText('Earlier answer')).toBeInTheDocument();
    // The sidebar names the session after its first message and marks it active.
    expect(screen.getByRole('button', { name: /Earlier question/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Claude Code', { selector: 'header span' })).toBeInTheDocument();
  });

  it('a restored session the server does not know is quietly forgotten', async () => {
    sessionStorage.setItem('somecode.activeSession', 'gone');
    await renderClient();
    socket().open();
    socket().receive({ type: 'error', code: 'not_found', message: 'unknown session' });
    expect(screen.getByRole('heading', { name: 'Start your first session' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('somecode.activeSession')).toBeNull();
  });

  it('other server errors show a dismissible banner', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().receive({ type: 'subscribed', sessionId: 's1', lastSeq: 0 });
    socket().receive({ type: 'error', code: 'turn_in_progress', message: 'busy' });
    expect(screen.getByRole('alert')).toHaveTextContent(en['error.turn_in_progress']);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Send writes a prompt, shows it at once and clears the draft', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    await userEvent.type(box(), 'Hello agent{Enter}');
    expect(socket().ofType('prompt')).toEqual([{ type: 'prompt', sessionId: 's1', text: 'Hello agent' }]);
    expect(box().value).toBe('');
    expect(screen.getAllByText('Hello agent').length).toBeGreaterThan(0);
  });

  it('a failed send keeps the draft and shows the network banner', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().drop();
    await userEvent.type(box(), 'Lost message');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(box().value).toBe('Lost message');
    expect(screen.getByRole('alert')).toHaveTextContent(en['error.network']);
    expect(screen.queryByText('Lost message', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('a prompt over the size limit is refused with a banner and keeps the draft; one just under it sends', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const over = 'a'.repeat(900_001);
    fireEvent.change(box(), { target: { value: over } });
    send();
    expect(socket().ofType('prompt')).toEqual([]);
    expect(box().value).toBe(over);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This message is longer than 900 000 bytes, so shorten it or split it into several messages.',
    );
    expect(document.querySelectorAll('[data-item-key]')).toHaveLength(0); // no optimistic item

    // Multi-byte text counts in UTF-8 bytes: 450 001 × 'ğ' (2 bytes each) is over the limit too.
    fireEvent.change(box(), { target: { value: 'ğ'.repeat(450_001) } });
    send();
    expect(socket().ofType('prompt')).toEqual([]);

    const under = 'a'.repeat(900_000);
    fireEvent.change(box(), { target: { value: under } });
    send();
    expect(socket().ofType('prompt')).toEqual([{ type: 'prompt', sessionId: 's1', text: under }]);
    expect(box().value).toBe('');
    expect(document.querySelectorAll('[data-item-key^="local-"]')).toHaveLength(1);
  });

  it('a permission card sends exactly one response, even on a double click', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().receive(
      event(1, 's1', {
        type: 'permission_request',
        requestId: 'r1',
        toolCallId: 't1',
        title: 'Run ls',
        options: [
          { id: 'allow', name: 'Allow once', kind: 'allow_once' },
          { id: 'deny', name: 'Reject', kind: 'reject_once' },
        ],
      }),
    );
    // Both the header and the active sidebar row show it.
    expect(screen.getAllByRole('img', { name: 'Waiting for permission' })).toHaveLength(2);
    const allow = screen.getByRole('button', { name: 'Allow once' });
    fireEvent.click(allow);
    fireEvent.click(allow);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(socket().ofType('permission_response')).toEqual([
      { type: 'permission_response', sessionId: 's1', requestId: 'r1', optionId: 'allow' },
    ]);
    expect(allow).toBeDisabled();
  });

  it('a permission answer that cannot be sent stays answerable', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().receive(
      event(1, 's1', {
        type: 'permission_request',
        requestId: 'r1',
        toolCallId: 't1',
        title: 'Run ls',
        options: [{ id: 'allow', name: 'Allow once', kind: 'allow_once' }],
      }),
    );
    socket().drop();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(screen.getByRole('alert')).toHaveTextContent(en['error.network']);
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  });

  it('Ctrl+B toggles the sidebar and remembers the choice', async () => {
    await renderClient();
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(screen.queryByRole('navigation', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(localStorage.getItem('somecode.sidebarOpen')).toBe('0');
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
    expect(localStorage.getItem('somecode.sidebarOpen')).toBe('1');
  });

  it('Ctrl+B is ignored while a modal dialog is open and during IME composition', async () => {
    await renderClient();
    const sidebar = () => screen.queryByRole('navigation', { name: 'Sessions' });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, isComposing: true });
    expect(sidebar()).toBeInTheDocument();
    await userEvent.click(within(sidebar()!).getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(sidebar()).toBeInTheDocument();
    expect(localStorage.getItem('somecode.sidebarOpen')).not.toBe('0');
  });

  it('a session creation that fails after the dialog was closed shows the app banner', async () => {
    const api = fakeApi();
    let fail!: (err: unknown) => void;
    api.createSession.mockImplementation(() => new Promise((_resolve, reject) => (fail = reject)));
    await renderClient(api);
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'New session' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Absolute project path' }), '/home/u/beta');
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    // The browser force-closes the modal on a second Escape.
    act(() => (screen.getByRole('dialog') as HTMLDialogElement).close());
    await act(async () => fail(new ApiError('agent_not_installed')));
    expect(screen.getByRole('alert')).toHaveTextContent(en['error.agent_not_installed']);
  });

  it('switching sessions clears the error banner', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient(fakeApi([row('s1', Date.now() - 120_000), row('s2')]));
    socket().open();
    socket().receive({ type: 'error', code: 'turn_in_progress', message: 'busy' });
    expect(screen.getByRole('alert')).toHaveTextContent(en['error.turn_in_progress']);
    await userEvent.click(screen.getByRole('button', { name: /Claude Code · 1 min\. ago/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switching sessions resumes from the last seen seq and keeps each draft', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient(fakeApi([row('s1', Date.now() - 120_000), row('s2')]));
    socket().open();
    socket().receive(event(1, 's1', { type: 'user_message', text: 'First session' }));
    socket().receive(event(2, 's1', { type: 'agent_message', text: 'reply' }));
    await userEvent.type(box(), 'draft one');
    await userEvent.click(screen.getByRole('button', { name: /Claude Code · 1 min\. ago/ }));
    expect(sessionStorage.getItem('somecode.activeSession')).toBe('s2');
    expect(box().value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: /First session/ }));
    expect(box().value).toBe('draft one');
    expect(socket().ofType('subscribe')).toEqual([
      { type: 'subscribe', sessionId: 's1', afterSeq: 0 },
      { type: 'subscribe', sessionId: 's2', afterSeq: 0 },
      { type: 'subscribe', sessionId: 's1', afterSeq: 2 },
    ]);
  });

  it('the dialog creates a session in a new project, activates and subscribes to it', async () => {
    const api = await renderClient();
    socket().open();
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'New session' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Absolute project path' }), '/home/u/beta');
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith('p2', 'claude'));
    expect(api.addProject).toHaveBeenCalledWith('beta', '/home/u/beta');
    await waitFor(() => expect(socket().ofType('subscribe')).toEqual([{ type: 'subscribe', sessionId: 'new', afterSeq: 0 }]));
    expect(sessionStorage.getItem('somecode.activeSession')).toBe('new');
    await waitFor(() => expect(screen.getByRole('button', { current: true })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('the dialog reuses a known project by path (trailing slash ignored)', async () => {
    const api = await renderClient();
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'New session' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Absolute project path' }), '/home/u/alpha/');
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith('p1', 'claude'));
    expect(api.addProject).not.toHaveBeenCalled();
  });

  it('a disconnected session disables the composer', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().receive(event(1, 's1', { type: 'status', status: 'disconnected' }));
    expect(box()).toBeDisabled();
    expect(screen.getAllByRole('img', { name: 'Agent disconnected' })).toHaveLength(2);
  });
});

describe('config chips', () => {
  const options = (model: string) => [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      currentValue: 'auto',
      choices: ['default', 'plan', 'auto'].map((value) => ({ value, name: value })),
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: model,
      choices: ['sonnet', 'opus'].map((value) => ({ value, name: value })),
    },
  ];

  async function openSession() {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().receive({ type: 'subscribed', sessionId: 's1', lastSeq: 0 });
    socket().receive(event(1, 's1', { type: 'config_options', options: options('sonnet') }));
  }

  async function choose(user: ReturnType<typeof userEvent.setup>, chip: string, item: string) {
    await user.click(screen.getByRole('button', { name: chip }));
    await user.click(screen.getByRole('menuitemradio', { name: item }));
  }

  it('shows the agent options, sends set_config and changes only when the agent confirms', async () => {
    await openSession();
    const user = userEvent.setup();
    await choose(user, 'Model: sonnet', 'opus');
    expect(socket().ofType('set_config')).toEqual([{ type: 'set_config', sessionId: 's1', configId: 'model', value: 'opus' }]);
    const chip = screen.getByRole('button', { name: 'Model: sonnet' });
    expect(chip).toHaveAttribute('aria-busy', 'true');
    socket().receive(event(2, 's1', { type: 'config_options', options: options('opus') }));
    expect(screen.getByRole('button', { name: 'Model: opus' })).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('button', { name: 'Model: sonnet' })).not.toBeInTheDocument();
  });

  it('shows a banner and keeps the old value when the agent rejects the change', async () => {
    await openSession();
    const user = userEvent.setup();
    await choose(user, 'Model: sonnet', 'opus');
    socket().receive({ type: 'error', code: 'bad_request', message: 'invalid value' });
    expect(screen.getByRole('alert')).toHaveTextContent(en['error.bad_request']);
    const chip = screen.getByRole('button', { name: 'Model: sonnet' });
    expect(chip).toHaveAttribute('aria-busy', 'false');
  });

  it('disables the chips while a turn runs', async () => {
    await openSession();
    socket().receive(event(2, 's1', { type: 'status', status: 'running' }));
    expect(screen.getByRole('button', { name: 'Model: sonnet' })).toBeDisabled();
    socket().receive(event(3, 's1', { type: 'status', status: 'ready' }));
    expect(screen.getByRole('button', { name: 'Model: sonnet' })).toBeEnabled();
  });

  it('shows no chip row for an agent that reports no options', async () => {
    sessionStorage.setItem('somecode.activeSession', 's1');
    await renderClient();
    socket().open();
    socket().receive({ type: 'subscribed', sessionId: 's1', lastSeq: 0 });
    expect(screen.queryByRole('group', { name: 'Session options' })).not.toBeInTheDocument();
  });
});
