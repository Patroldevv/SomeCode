// Scripted ACP agent over stdio for tests. Behaviour is chosen by FAKE_SCENARIO:
// basic | permission | crash | garbage | slow (see the brief of Task 5).
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

async function runTurn(client: AgentContext, signal: AbortSignal): Promise<StopReason> {
  const send = (update: SessionUpdate) =>
    client.notify(methods.client.session.update, { sessionId: SESSION_ID, update });
  const permission: RequestPermissionRequest = {
    sessionId: SESSION_ID,
    toolCall: { ...TOOL_CALL, status: 'pending' },
    options: [...PERMISSION_OPTIONS],
  };
  const askPermission = () => client.request(methods.client.session.requestPermission, permission);

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
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: {},
    authMethods: [],
  }))
  .onRequest(methods.agent.session.new, () => ({
    sessionId: SESSION_ID,
    configOptions: configOptions(),
  }))
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
