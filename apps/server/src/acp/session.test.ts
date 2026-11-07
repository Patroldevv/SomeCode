import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SomeCodeError, type NormalizedEvent } from '@somecode/protocol';
import type { AgentDriver } from '../agents/types.ts';
import { AcpSession } from './session.ts';

const FAKE_AGENT = fileURLToPath(new URL('../../test-support/fake-agent.ts', import.meta.url));

function fakeDriver(scenario: string, command: string = process.execPath): AgentDriver {
  return {
    id: 'fake',
    label: 'Fake agent',
    launch: () => ({ command, args: [FAKE_AGENT], env: { FAKE_SCENARIO: scenario, FAKE_FAST: '1' } }),
    detect: async () => ({ installed: true }),
  };
}

const open: AcpSession[] = [];

async function start(scenario: string): Promise<{ session: AcpSession; events: NormalizedEvent[] }> {
  const events: NormalizedEvent[] = [];
  const session = await AcpSession.start({
    driver: fakeDriver(scenario),
    cwd: process.cwd(),
    onEvent: (e) => events.push(e),
  });
  open.push(session);
  return { session, events };
}

function waitForEvent<T extends NormalizedEvent['type']>(
  events: NormalizedEvent[],
  type: T,
  from = 0,
): Promise<Extract<NormalizedEvent, { type: T }>> {
  return vi.waitFor(() => {
    const found = events.slice(from).find((e) => e.type === type);
    if (!found) throw new Error(`no ${type} event yet`);
    return found as Extract<NormalizedEvent, { type: T }>;
  });
}

const CONFIG = (currentValue: string) => ({
  type: 'config_options',
  options: [
    {
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue,
      options: [
        { value: 'fast', name: 'Fast' },
        { value: 'smart', name: 'Smart' },
      ],
    },
  ],
});

const BASIC_TURN: NormalizedEvent[] = [
  { type: 'status', status: 'running' },
  { type: 'agent_thought', text: 'Thinking about it' },
  { type: 'agent_message', text: 'I will edit the file.' },
  {
    type: 'tool_call',
    id: 'call-1',
    title: 'Edit hello.txt',
    kind: 'edit',
    status: 'in_progress',
    content: [{ type: 'diff', path: '/tmp/hello.txt', oldText: 'hello', newText: 'hello world' }],
  },
  { type: 'tool_call_update', id: 'call-1', patch: { status: 'completed' } },
  { type: 'turn_end', stopReason: 'end_turn' },
  { type: 'status', status: 'ready' },
];

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  vi.restoreAllMocks();
});

describe('AcpSession', () => {
  it('rich scenario emits every item kind the chat UI renders', async () => {
    const { session, events } = await start('rich');
    const turn = session.prompt('go');
    const req = await waitForEvent(events, 'permission_request');
    expect(session.respondPermission(req.requestId, 'allow')).toBe(true);
    await expect(turn).resolves.toBe('end_turn');

    const at = (pred: (e: NormalizedEvent) => boolean, from = 0) => {
      const i = events.findIndex((e, n) => n >= from && pred(e));
      expect(i).toBeGreaterThanOrEqual(from);
      return i;
    };
    const thought = at((e) => e.type === 'agent_thought');
    const plan = at((e) => e.type === 'plan', thought);
    const read = at((e) => e.type === 'tool_call' && e.kind === 'read', plan);
    const perm = at((e) => e.type === 'permission_request', read);
    const edit = at((e) => e.type === 'tool_call' && e.kind === 'edit', perm);
    const exec = at((e) => e.type === 'tool_call' && e.kind === 'execute', edit);
    const failed = at(
      (e) => e.type === 'tool_call_update' && e.id === 'rich-exec' && e.patch.status === 'failed',
      exec,
    );
    const message = at((e) => e.type === 'agent_message', failed);
    at((e) => e.type === 'turn_end', message);

    expect(events.filter((e) => e.type === 'agent_thought').length).toBeGreaterThanOrEqual(7);
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(4);
    expect(events.filter((e) => e.type === 'agent_message').length).toBeGreaterThanOrEqual(8);
    expect(events[edit]).toMatchObject({
      content: [{ type: 'diff', oldText: expect.any(String), newText: expect.any(String) }],
    });
    const biggest = Math.max(
      ...events.flatMap((e) =>
        e.type === 'tool_call_update' && Array.isArray(e.patch.content)
          ? (e.patch.content as Array<{ type: string; text?: string }>).map((c) =>
              c.type === 'text' ? (c.text?.length ?? 0) : 0,
            )
          : [],
      ),
    );
    expect(biggest).toBeGreaterThanOrEqual(30_000);

    const markdown = events.flatMap((e) => (e.type === 'agent_message' ? [e.text] : [])).join('');
    for (const needle of [
      '|---',
      '```ts',
      '[click me](javascript:alert(1))',
      '<script>alert(1)</script>',
      '![tracker](http://example.invalid/pixel.png)',
    ]) {
      expect(markdown).toContain(needle);
    }
  });

  it('(a) basic: streams normalized events in order and resolves end_turn', async () => {
    const { session, events } = await start('basic');
    expect(session.acpSessionId).toBe('fake-session-1');

    await expect(session.prompt('hi')).resolves.toBe('end_turn');
    expect(events).toEqual([CONFIG('fast'), { type: 'status', status: 'ready' }, ...BASIC_TURN]);
  });

  it('(b) permission: relays requests through the broker, selected and cancelled', async () => {
    const { session, events } = await start('permission');

    const allowed = session.prompt('first');
    const req = await waitForEvent(events, 'permission_request');
    expect(req).toMatchObject({
      toolCallId: 'call-1',
      title: 'Edit hello.txt',
      options: [
        { id: 'allow', name: 'Allow', kind: 'allow_once' },
        { id: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    expect(session.respondPermission(req.requestId, 'allow')).toBe(true);
    expect(session.respondPermission(req.requestId, 'allow')).toBe(false);
    await expect(allowed).resolves.toBe('end_turn');
    expect(events).toContainEqual({
      type: 'permission_resolved',
      requestId: req.requestId,
      outcome: 'selected',
      optionId: 'allow',
    });
    expect(events.at(-2)).toEqual({ type: 'turn_end', stopReason: 'end_turn' });

    const mark = events.length;
    const denied = session.prompt('second');
    const req2 = await waitForEvent(events, 'permission_request', mark);
    expect(session.respondPermission(req2.requestId, null)).toBe(true);
    await expect(denied).resolves.toBe('cancelled');
    expect(events.slice(mark)).toContainEqual({
      type: 'permission_resolved',
      requestId: req2.requestId,
      outcome: 'cancelled',
    });
    expect(events.slice(mark).some((e) => e.type === 'tool_call')).toBe(false);
  });

  it('(c) crash: rejects the prompt as disconnected and cancels pending permissions', async () => {
    const { session, events } = await start('crash');

    const err = await session.prompt('boom').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SomeCodeError);
    expect((err as SomeCodeError).code).toBe('disconnected');

    await vi.waitFor(() =>
      expect(events.at(-1)).toEqual({ type: 'status', status: 'disconnected', reason: 'crashed' }),
    );
    const req = events.find((e) => e.type === 'permission_request');
    expect(req).toBeDefined();
    const resolved = events.findIndex(
      (e) => e.type === 'permission_resolved' && e.outcome === 'cancelled',
    );
    expect(events[resolved]).toEqual({
      type: 'permission_resolved',
      requestId: req!.type === 'permission_request' ? req!.requestId : '',
      outcome: 'cancelled',
    });
    expect(resolved).toBeLessThan(events.length - 1);
    expect(events.filter((e) => e.type === 'status' && e.status === 'disconnected')).toHaveLength(1);

    await expect(session.prompt('again')).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('(d) garbage: a non-JSON stdout line is ignored and the turn still completes', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { session, events } = await start('garbage');

    await expect(session.prompt('hi')).resolves.toBe('end_turn');
    expect(events).toEqual([CONFIG('fast'), { type: 'status', status: 'ready' }, ...BASIC_TURN]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('not json'));
  });

  it('(e) slow: cancel() resolves the running prompt as cancelled within 2s', async () => {
    const { session, events } = await start('slow');

    const running = session.prompt('wait');
    await waitForEvent(events, 'agent_thought');
    await expect(session.prompt('second')).rejects.toMatchObject({ code: 'turn_in_progress' });

    const t0 = Date.now();
    await session.cancel();
    await expect(running).resolves.toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(events.slice(-2)).toEqual([
      { type: 'turn_end', stopReason: 'cancelled' },
      { type: 'status', status: 'ready' },
    ]);
  });

  it('(f) start() rejects with agent_not_installed when the command does not exist', async () => {
    const events: NormalizedEvent[] = [];
    const err = await AcpSession.start({
      driver: fakeDriver('basic', '/nonexistent/somecode-no-such-agent'),
      cwd: process.cwd(),
      onEvent: (e) => events.push(e),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SomeCodeError);
    expect((err as SomeCodeError).code).toBe('agent_not_installed');
    expect(events).toEqual([]);
  });

  it('(h) prompt_error: an agent error ends the turn with an error turn_end, then ready', async () => {
    const { session, events } = await start('prompt_error');
    const mark = events.length;

    await expect(session.prompt('hi')).rejects.toMatchObject({ code: 'internal' });
    expect(events.slice(mark)).toEqual([
      { type: 'status', status: 'running' },
      { type: 'agent_thought', text: 'Thinking about it' },
      {
        type: 'turn_end',
        stopReason: 'error',
        error: { code: 'internal', message: expect.stringContaining('model exploded') },
      },
      { type: 'status', status: 'ready' },
    ]);
    // The session is usable again: the next prompt runs (and fails the same way), not turn_in_progress.
    await expect(session.prompt('again')).rejects.toMatchObject({ code: 'internal' });
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(2);
  });

  it('(i) prompt_auth_error: JSON-RPC -32000 at prompt time becomes auth_required', async () => {
    const { session, events } = await start('prompt_auth_error');

    await expect(session.prompt('hi')).rejects.toMatchObject({ code: 'auth_required' });
    expect(events.slice(-2)).toEqual([
      { type: 'turn_end', stopReason: 'error', error: { code: 'auth_required', message: expect.any(String) } },
      { type: 'status', status: 'ready' },
    ]);
  });

  it('(j) unknown_update: an update type the SDK does not know is emitted as unsupported, in order, silently', async () => {
    const stderr = vi.spyOn(process.stderr, 'write');
    const consoleError = vi.spyOn(console, 'error');
    const { session, events } = await start('unknown_update');
    const mark = events.length;

    await expect(session.prompt('hi')).resolves.toBe('end_turn');
    expect(events.slice(mark)).toEqual([
      { type: 'status', status: 'running' },
      { type: 'agent_thought', text: 'Thinking about it' },
      { type: 'agent_message', text: 'before' },
      {
        type: 'unsupported',
        sessionUpdate: 'brand_new_thing',
        raw: { sessionUpdate: 'brand_new_thing', detail: { answer: 42 } },
      },
      { type: 'agent_message', text: 'after' },
      { type: 'turn_end', stopReason: 'end_turn' },
      { type: 'status', status: 'ready' },
    ]);
    // The SDK never saw the unknown update, so it logged no "Invalid params" error.
    expect(consoleError).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('(k) start(): aborting the signal mid-start stops the agent and rejects as disconnected', async () => {
    const events: NormalizedEvent[] = [];
    const controller = new AbortController();
    const starting = AcpSession.start({
      driver: fakeDriver('slow_start'),
      cwd: process.cwd(),
      onEvent: (e) => events.push(e),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const t0 = Date.now();
    await expect(starting).rejects.toMatchObject({ code: 'disconnected' });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(events).toEqual([{ type: 'status', status: 'disconnected', reason: 'closed' }]);

    const aborted = AcpSession.start({ driver: fakeDriver('basic'), cwd: process.cwd(), onEvent: () => {}, signal: controller.signal });
    await expect(aborted).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('(g) setConfig: sends session/set_config_option and emits the new config options', async () => {
    const { session, events } = await start('basic');

    await session.setConfig('model', 'smart');
    expect(events.at(-1)).toEqual(CONFIG('smart'));
  });
});
