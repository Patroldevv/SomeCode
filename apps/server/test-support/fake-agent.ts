// Scripted ACP agent over stdio for tests. Behaviour is chosen by FAKE_SCENARIO:
// basic | permission | crash | garbage | slow (see the brief of Task 5), plus
// prompt_error | prompt_auth_error (session/prompt answered with a JSON-RPC error after a thought),
// unknown_update (a `brand_new_thing` update between two messages), slow_start (initialize hangs),
// rich (one long turn exercising every item kind the chat UI renders; FAKE_FAST=1 skips its delays).
import { Readable, Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import type {
  AgentContext,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
} from '@agentclientprotocol/sdk';

const scenario = process.env.FAKE_SCENARIO ?? 'basic';
const SESSION_ID = 'fake-session-1';
const TOOL_CALL = { toolCallId: 'call-1', title: 'Edit hello.txt', kind: 'edit' } as const;
const PERMISSION_OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
] as const;

let model = 'fast';
let mode = 'default';
let activeTurn: AbortController | null = null;

function configOptions(): SessionConfigOption[] {
  return [
    {
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue: model,
      options: [
        { value: 'fast', name: 'Fast' },
        { value: 'smart', name: 'Smart' },
      ],
    },
  ];
}

const FAST = process.env.FAKE_FAST === '1';
const pause = (ms: number) => (FAST ? Promise.resolve() : sleep(ms));

const THOUGHTS = [
  'Let me look at how the session store is wired up. ',
  'The reducer folds events by id, so ordering matters. ',
  'I should check the existing helper before adding a new one. ',
  'A small change in the retry path is probably enough. ',
  'Then the tests need a case for the empty queue. ',
  'Finally I will run the suite and see what breaks.',
];

const EDIT_OLD = Array.from({ length: 12 }, (_, i) => `  const value${i} = legacy(${i});`).join('\n');
const EDIT_NEW = [
  'export function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {',
  '  let last: unknown;',
  '  const run = async (n: number): Promise<T> => {',
  '    try {',
  '      return await fn();',
  '    } catch (err) {',
  '      last = err;',
  '      if (n <= 1) throw last;',
  '      return run(n - 1);',
  '    }',
  '  };',
  '  return run(attempts);',
  '}',
].join('\n');

const TS_BLOCK = [
  'type Item = { id: string; text: string };',
  '',
  'export function dedupe(items: Item[]): Item[] {',
  '  const seen = new Set<string>();',
  '  const out: Item[] = [];',
  '  for (const item of items) {',
  '    if (seen.has(item.id)) continue;',
  '    seen.add(item.id);',
  '    out.push(item);',
  '  }',
  '  return out;',
  '}',
  '',
  'export async function main(): Promise<void> {',
  '  const items = dedupe([{ id: "a", text: "one" }, { id: "a", text: "two" }]);',
  '  console.log(items.length);',
  '}',
].join('\n');

const MESSAGE = [
  '## Summary\n\n',
  'I added a retry helper and wired it in:\n\n',
  '- first change: `retry()` wraps the call\n- second change: empty queue is handled\n- third change: tests added\n\n',
  '| file | change |\n|---|---|\n| retry.ts | new helper |\n| queue.ts | guard |\n\n',
  '```ts\n' + TS_BLOCK.split('\n').slice(0, 9).join('\n') + '\n',
  TS_BLOCK.split('\n').slice(9).join('\n') + '\n```\n\n',
  '```\nplain block without a language\nsecond line\n```\n\n',
  'See [the docs](https://example.com/docs) for details. ',
  'Do not [click me](javascript:alert(1)).\n\n<script>alert(1)</script>\n\n',
  '![tracker](http://example.invalid/pixel.png)\n',
];

async function runRich(client: AgentContext, signal: AbortSignal): Promise<StopReason> {
  const send = (update: SessionUpdate) =>
    client.notify(methods.client.session.update, { sessionId: SESSION_ID, update });
  const text = (t: string) => ({ type: 'text', text: t }) as const;

  for (const chunk of THOUGHTS) {
    await send({ sessionUpdate: 'agent_thought_chunk', content: text(chunk) });
    await pause(400);
  }
  if (signal.aborted) return 'cancelled';

  const entries = (statuses: Array<'pending' | 'in_progress' | 'completed'>) =>
    ['Read the retry module', 'Edit the retry helper', 'Run the tests'].map((content, i) => ({
      content,
      priority: 'medium' as const,
      status: statuses[i]!,
    }));
  await send({ sessionUpdate: 'plan', entries: entries(['in_progress', 'pending', 'pending']) });
  await pause(500);

  await send({
    sessionUpdate: 'tool_call',
    toolCallId: 'rich-read',
    title: 'Read src/retry.ts',
    kind: 'read',
    status: 'in_progress',
    locations: [{ path: '/tmp/demo/src/retry.ts' }],
  });
  await pause(500);
  await send({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'rich-read',
    status: 'completed',
    content: [{ type: 'content', content: text('export const retry = () => {};\n// TODO: implement') }],
  });
  await send({ sessionUpdate: 'plan', entries: entries(['completed', 'in_progress', 'pending']) });

  const editPermission: RequestPermissionRequest = {
    sessionId: SESSION_ID,
    toolCall: { toolCallId: 'rich-edit', title: 'Edit src/retry.ts', kind: 'edit', status: 'pending' },
    options: [...PERMISSION_OPTIONS],
  };
  const { outcome } = await client.request(methods.client.session.requestPermission, editPermission);
  if (outcome.outcome === 'cancelled') return 'cancelled';

  const diff = { type: 'diff', path: '/tmp/demo/src/retry.ts', oldText: EDIT_OLD, newText: EDIT_NEW } as const;
  await send({
    sessionUpdate: 'tool_call',
    toolCallId: 'rich-edit',
    title: 'Edit src/retry.ts',
    kind: 'edit',
    status: 'in_progress',
    content: [diff],
  });
  await pause(800);
  await send({ sessionUpdate: 'tool_call_update', toolCallId: 'rich-edit', status: 'completed' });
  await send({ sessionUpdate: 'plan', entries: entries(['completed', 'completed', 'in_progress']) });

  const lines = Array.from({ length: 200 }, (_, i) => `test ${i + 1}: ${i % 7 === 0 ? 'FAIL' : 'ok'} - queue case ${i}`);
  const output = `${lines.join('\n')}\n${'x'.repeat(30_500)}\n`;
  await send({
    sessionUpdate: 'tool_call',
    toolCallId: 'rich-exec',
    title: 'npm test',
    kind: 'execute',
    status: 'in_progress',
  });
  await pause(900);
  await send({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'rich-exec',
    status: 'failed',
    content: [{ type: 'content', content: text(output) }],
  });
  await send({ sessionUpdate: 'plan', entries: entries(['completed', 'completed', 'completed']) });

  await send({ sessionUpdate: 'agent_thought_chunk', content: text('The run failed, so I will summarise what happened.') });
  await pause(400);

  for (const chunk of MESSAGE) {
    if (signal.aborted) return 'cancelled';
    // Split every part in two so the stream has plenty of mid-token and mid-fence boundaries.
    const mid = Math.floor(chunk.length / 2);
    for (const part of [chunk.slice(0, mid), chunk.slice(mid)]) {
      if (part) await send({ sessionUpdate: 'agent_message_chunk', content: text(part) });
      await pause(150);
    }
  }
  return 'end_turn';
}

async function runTurn(client: AgentContext, signal: AbortSignal): Promise<StopReason> {
  const send = (update: SessionUpdate) =>
    client.notify(methods.client.session.update, { sessionId: SESSION_ID, update });
  const permission: RequestPermissionRequest = {
    sessionId: SESSION_ID,
    toolCall: { ...TOOL_CALL, status: 'pending' },
    options: [...PERMISSION_OPTIONS],
  };
  const askPermission = () => client.request(methods.client.session.requestPermission, permission);

  if (scenario === 'rich') return runRich(client, signal);

  if (scenario === 'slow') {
    await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Waiting' } });
    try {
      await sleep(30_000, undefined, { signal });
      return 'end_turn';
    } catch {
      return 'cancelled';
    }
  }

  await send({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Thinking about it' },
  });

  if (scenario === 'unknown_update') {
    // An update type the SDK's closed schema does not know, between two normal updates.
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'before' } });
    await send({ sessionUpdate: 'brand_new_thing', detail: { answer: 42 } } as unknown as SessionUpdate);
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'after' } });
    return 'end_turn';
  }

  // The turn fails: the agent answers session/prompt with a JSON-RPC error.
  if (scenario === 'prompt_error') throw RequestError.internalError(undefined, 'model exploded');
  if (scenario === 'prompt_auth_error') throw RequestError.authRequired(undefined, 'please log in');

  if (scenario === 'crash') {
    // Leave a permission request pending, then die mid-prompt.
    void askPermission().catch(() => {});
    await sleep(300);
    process.exit(1);
  }

  await send({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'I will edit the file.' },
  });

  if (scenario === 'permission') {
    const { outcome } = await askPermission();
    if (outcome.outcome === 'cancelled') return 'cancelled';
  }

  await send({
    sessionUpdate: 'tool_call',
    ...TOOL_CALL,
    status: 'in_progress',
    content: [{ type: 'diff', path: '/tmp/hello.txt', oldText: 'hello', newText: 'hello world' }],
  });
  await send({ sessionUpdate: 'tool_call_update', toolCallId: TOOL_CALL.toolCallId, status: 'completed' });
  return 'end_turn';
}

if (scenario === 'garbage') process.stdout.write('not json\n');

const connection = agent({ name: 'fake' })
  .onRequest(methods.agent.initialize, async () => {
    if (scenario === 'slow_start') await sleep(30_000); // never finishes starting in a test
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, authMethods: [] };
  })
  .onRequest(methods.agent.session.new, () =>
    scenario === 'modes_only'
      ? {
          // An agent that only reports `modes` (no configOptions).
          sessionId: SESSION_ID,
          modes: {
            currentModeId: mode,
            availableModes: [
              { id: 'default', name: 'Default', description: 'Ask before changes' },
              { id: 'plan', name: 'Plan' },
            ],
          },
        }
      : { sessionId: SESSION_ID, configOptions: configOptions() },
  )
  .onRequest(methods.agent.session.setMode, async ({ params, client }) => {
    mode = params.modeId;
    await client.notify(methods.client.session.update, {
      sessionId: SESSION_ID,
      update: { sessionUpdate: 'current_mode_update', currentModeId: mode },
    });
    return {};
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    if (params.configId !== 'model' || typeof params.value !== 'string') {
      throw RequestError.invalidParams(undefined, `unknown config ${params.configId}`);
    }
    model = params.value;
    return { configOptions: configOptions() };
  })
  .onRequest(methods.agent.session.prompt, async ({ client }) => {
    const turn = new AbortController();
    activeTurn = turn;
    try {
      return { stopReason: await runTurn(client, turn.signal) };
    } finally {
      if (activeTurn === turn) activeTurn = null;
    }
  })
  .onNotification(methods.agent.session.cancel, () => {
    activeTurn?.abort();
  })
  .connect(
    ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );

void connection.closed.then(() => process.exit(0));
