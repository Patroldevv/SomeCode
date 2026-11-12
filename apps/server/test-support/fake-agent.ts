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
let effort = 'medium';
/** UI demos only: `FAKE_EFFORT=1` reports a categorised model list plus a reasoning-effort option. */
const WITH_EFFORT = process.env.FAKE_EFFORT === '1';
let mode = 'default';
let activeTurn: AbortController | null = null;

function modesBlock() {
  return {
    currentModeId: mode,
    availableModes: [
      { id: 'default', name: 'Default', description: 'Ask before changes' },
      { id: 'plan', name: 'Plan' },
    ],
  };
}

function modeOption(current: string): SessionConfigOption {
  return {
    id: 'mode',
    name: 'Mode',
    type: 'select',
    category: 'mode',
    currentValue: current,
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan' },
    ],
  } as unknown as SessionConfigOption;
}

function configOptions(): SessionConfigOption[] {
  const modelOption = {
    id: 'model',
    name: 'Model',
    type: 'select',
    ...(WITH_EFFORT ? { category: 'model' } : {}),
    currentValue: model,
    options: [
      { value: 'fast', name: 'Fast' },
      { value: 'smart', name: 'Smart' },
    ],
  } as unknown as SessionConfigOption;
  if (!WITH_EFFORT) return [modelOption];
  return [
    modelOption,
    {
      id: 'effort',
      name: 'Effort',
      type: 'select',
      category: 'thought_level',
      currentValue: effort,
      options: ['low', 'medium', 'high', 'max'].map((value) => ({ value, name: value[0]!.toUpperCase() + value.slice(1) })),
    } as unknown as SessionConfigOption,
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

  // Some real agents echo the prompt back as a user message while the turn runs.
  if (scenario === 'echo_user') {
    await send({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo me' } });
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

  // The agent leaves plan mode: the plan travels as the tool call's text content.
  if (scenario === 'plan_permission') {
    const { outcome } = await client.request(methods.client.session.requestPermission, {
      ...permission,
      toolCall: { ...TOOL_CALL, title: 'Ready to code?', status: 'pending', content: [{ type: 'content', content: { type: 'text', text: '# Plan\n1. Do the thing' } }] },
    });
    if (outcome.outcome === 'cancelled') return 'cancelled';
  }

  // Context usage and a rate-limit report, as the Claude agent sends them with its usage updates.
  if (scenario === 'usage') {
    await send({ sessionUpdate: 'usage_update', used: 15000, size: 200000, _meta: { '_claude/rateLimit': { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.24, resetsAt: 1900000000 } } } as SessionUpdate);
    await send({ sessionUpdate: 'usage_update', used: 30000, size: 200000, _meta: { '_claude/rateLimit': { status: 'allowed', rateLimitType: 'seven_day', utilization: 47, resetsAt: 1900100000000 } } } as SessionUpdate);
    return 'end_turn';
  }

  // A deep research: searches, pages read, sources noted down and a long report at the end.
  if (scenario === 'research') {
    const text = (t: string) => ({ type: 'text', text: t }) as const;
    const call = async (id: string, name: string, input: Record<string, unknown>, answer: string) => {
      await send({ sessionUpdate: 'tool_call', toolCallId: id, title: `Run mcp_somecode_${name}`, kind: 'other', status: 'in_progress', rawInput: input });
      await pause(400);
      await send({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', content: [{ type: 'content', content: text(answer) }] });
    };
    await call('r1', 'web_search', { query: 'quickshell hyprland shell', engine: 'bing' }, 'Bing · "quickshell hyprland shell" · 3 results\n1. Quickshell\n   https://quickshell.org');
    await call('r2', 'web_read', { url: 'https://quickshell.org/docs' }, 'URL: https://quickshell.org/docs');
    await call('r3', 'research_note', { url: 'https://quickshell.org/docs', title: 'Quickshell documentation', finding: 'QtQuick based toolkit for Wayland and X11 shells; configuration is written in QML.', confidence: 'high', step: 1 }, 'Noted [1] Quickshell documentation.');
    await call('r4', 'web_search', { query: 'quickshell dotfiles github', engine: 'duckduckgo' }, 'DuckDuckGo · "quickshell dotfiles github" · 5 results');
    await call('r5', 'research_note', { url: 'https://github.com/end-4/dots-hyprland', title: 'end-4/dots-hyprland', finding: 'Popular Hyprland dotfiles with a Quickshell based shell; about 10k stars at the time of writing.', confidence: 'medium', step: 2 }, 'Noted [2] end-4/dots-hyprland.');
    await call('r6', 'research_note', { url: 'https://example.com/forum-thread', title: 'Forum thread on Quickshell lag', finding: 'A user reports high memory use after days of uptime; no confirmation from maintainers.', confidence: 'low', step: 3 }, 'Noted [3] Forum thread.');
    await send({ sessionUpdate: 'agent_message_chunk', content: text(`# Quickshell survey\n\n${'Quickshell is a QtQuick based toolkit for building desktop shells on Wayland and X11 [1]. Popular setups build on it [2], though some users report memory growth [3]. '.repeat(8)}\n\n## Sources\n1. Quickshell documentation\n2. end-4/dots-hyprland\n3. Forum thread`) });
    return 'end_turn';
  }

  // A browser screenshot: the picture comes with a caption naming the page it shows.
  if (scenario === 'screenshot') {
    await send({ sessionUpdate: 'tool_call', toolCallId: 'shot1', title: 'mcp__somecode__browser_screenshot', kind: 'other', status: 'in_progress' });
    await send({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'shot1',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'Screenshot of "Todo app" (http://localhost:5173/)' } },
        { type: 'content', content: { type: 'image', data: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAGQAoADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzmiipbe3lu7mK2gXfLM4RFyBlicAZPvVARUUUUAFFWZbC6giaWSLaieVk7gceYhdO/dQT7d6rUAFFSCGRoHnCExoyozdgSCQP/HT+VTzaZdwNGjohklICxxyo75PQbVJI/EUAVKKvnRr1bx7R1hjmQKSj3Ea53AFcEtg8EdKQ6PfKkrGJf3JcMPNTJ2feKjOWA9RkUAUaKKt2Wm3OoFhbeUSgLEPOiHABJOGIyAATQBUop8sbRSNGxUlTglWDD8CODTpbeWGOGSRcLOm+M5HzLuK5/NSPwoAiooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAq7o9xFaa3YXMzbYobmORzjOFDAmqVFAHVWmr2ECbZLwND9mWKGERsRbzBced0x1Bbjn5unFJBqlollcJc6sLmWSGVHJjcCQmIiPBxlyGPV+mBgd65aigDoZ9bWCxm+w3jRzyrZAGMMrARwsjjOOzY+oP1q8Nb02PUWmhu0js1lnJtjAzLKzSMY5NuACACnBIPyY71yFFAHT6hq8U2n3dvDqziSXynbLSFXwJQyBiuTkMn3/pnAFUtXvLS6tyyywS3DSq0bQwGMom07g+Ryc7e7YweaxaKANlr+1XUxfLJua3s4RCNp5mWJE9P4WBPvt96bp9zaWtnNIboB5reSKSExkyFiDtKNjheRnkZAI5yKyKKAJI5FRHVoUcsMBmLZT3GCB+eas6VcRW128kzbVNtOgOCfmaJ1UcepIFUqKAOpstYsYogJbvERtUihg2Mfs04UAzdMfeBbjJ+bpxSyavC0EEaaztu0gjV73ZJziWVmTO3cch0PTB281ytFAHS2mp6akOplZvIS5a5227K2NrRnygNowSGP8AEcDAI7mtK1vETWNMt5bzzRIunCK22t+6cCIl+Rj7oI4Ofm9q4iigDU1e8S4traJrz7bPG0hafaw+Q7dqfMAeMMfQbuKy6KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigCL7Qno1H2hPRqr0UrgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgWPtCejUfaE9GqvRRcCx9oT0aj7Qno1V6KLgW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sFw8Svv2HBO3HPf9aioAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKs6n/wAhW7/67v8A+hGq1WdT/wCQrd/9d3/9CNAFaiiigAooooAKKKKACiiigAqzqf8AyFbv/ru//oRqtVnU/wDkK3f/AF3f/wBCNAEMUrwSCSM7XXocZxUsN/c28PkxyDy9xbayKwzxzyOvAqvRQBcOq3p8wmUEy79xKLn587gDjgHJ4FRi+uRaG13jyiu3GwZxu3YzjOM81XooAuQare2yRpFKoWIgpmNW2kEkdR2JP5n1pv8AaV2IxGJAFC7eEXJG0rycZPykgZ6ZqrRQBO97PI++Qo7cZZo1JOMdeOfuj9fU5goooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKs6n/yFbv/AK7v/wChGq1WdT/5Ct3/ANd3/wDQjQBWooooAKKKKACiiigAooooAKs6n/yFbv8A67v/AOhGq1Wf7T1D/n+uf+/rf40AVqKs/wBp6h/z/XP/AH9b/Gj+09Q/5/rn/v63+NAFairP9p6h/wA/1z/39b/Gj+09Q/5/rn/v63+NAFairP8Aaeof8/1z/wB/W/xo/tPUP+f65/7+t/jQBWoqz/aeof8AP9c/9/W/xo/tPUP+f65/7+t/jQBWoqz/AGnqH/P9c/8Af1v8aP7T1D/n+uf+/rf40AVqKs/2nqH/AD/XP/f1v8aP7T1D/n+uf+/rf40AVqKs/wBp6h/z/XP/AH9b/Gj+09Q/5/rn/v63+NAFairP9p6h/wA/1z/39b/Gj+09Q/5/rn/v63+NAFairP8Aaeof8/1z/wB/W/xo/tPUP+f65/7+t/jQBWoqz/aeof8AP9c/9/W/xo/tPUP+f65/7+t/jQBWoqz/AGnqH/P9c/8Af1v8aP7T1D/n+uf+/rf40AVqKs/2nqH/AD/XP/f1v8aP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Dnpz1qe18UG3fTmeyEq2cbpIpkwJ8gKCeOMBU45+771Wstca0fTXaEytY37XhJfHmE+X8vTj/V9eevTigBG8P3n2WzuEaBkuofNBM6IE+dlAJLDBO3j8R2OI7PRbu8N+igJNYpueJyAzHeqbQCeuW/p1Iq/ZeKDaadBZeTcoI0CM9vdGJn2ySOvIU4H71wRznjpiq+na/JYand35h8yW5ww+c/K4lSUHJySNyDOeSCee9AEI0DUWcKsURG0sZBcR7BggHL7toOWUYJz8w9RViXwtqaW8EypE/moWK+cgZG3uoTBPLHYcAcnBHUHE58UA3CO0d68aK4HmXxd8sVJ5ZSu3CgbSpznnnGHx+KrZQm7SsKgZfKSfETIZJJAhQqQVHmEevAwV5yAc5RRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUU6OOSaVIokaSR2CqijJYnoAO5qSSzuoomlktpkjSQxM7IQFf+6T2Pt1oAhooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDT8Mf8jVpH/X9D/6GKLf/kVb/wD6/rX/ANAnrOjkkhlSWJ2jkRgyupwVI6EHsakkvLqWJopLmZ43kMrIzkhn/vEdz79aAO20cXEk2kmRZraKKay2qSHt5v3iDMZ/hk5JYDP8ecdKx7W1sby2hu4rQW3mR36Mkcr4PlW4dCSTnOW57HHTrXN0UAdNqmk2tvpby/2d9nUWVrNDdb3PnyusZdeTj+JzgDI2+lLqMEUWg3yx2quw/s6QysWZk327FjnPA3HHp82P7uOduLma7kEk772VEjBwB8qqFUcegAFRUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/9k=', mimeType: 'image/jpeg' } },
      ],
    });
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The page loads and the list shows three tasks.' } });
    return 'end_turn';
  }

  // A sub-agent: a Task call whose own tool calls arrive tagged with it, plus its chatter that must not show up.
  if (scenario === 'subagent') {
    await send({ sessionUpdate: 'tool_call', toolCallId: 'task1', title: 'Task: Explore the repo', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'explore', description: 'Explore the repo', prompt: 'Look around' } });
    await send({ sessionUpdate: 'tool_call', toolCallId: 'child1', title: 'Read package.json', kind: 'read', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'task1' } } } as SessionUpdate);
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'sub-agent chatter' }, _meta: { claudeCode: { parentToolUseId: 'task1' } } } as SessionUpdate);
    await send({ sessionUpdate: 'tool_call', toolCallId: 'oc1', title: 'grep', kind: 'search', status: 'completed', _meta: { 'opencode/child-session': { id: 'abc', parentID: 'p', depth: 1, title: 'Find usages' } } } as SessionUpdate);
    await send({ sessionUpdate: 'tool_call_update', toolCallId: 'task1', status: 'completed' });
    return 'end_turn';
  }

  // The agent asks the user a question (ACP form elicitation) and reports what it got.
  if (scenario === 'ask_user') {
    const answer = await client.request(methods.client.elicitation.create, {
      mode: 'form',
      sessionId: SESSION_ID,
      message: 'Which stack?',
      requestedSchema: {
        type: 'object',
        properties: {
          stack: { type: 'string', title: 'Stack', oneOf: [{ const: 'ts', title: 'TypeScript' }, { const: 'py', title: 'Python' }] },
          notes: { type: 'string', title: 'Notes' },
        },
        required: ['stack'],
      },
    });
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `answer: ${answer.action} ${JSON.stringify('content' in answer ? answer.content : null)}` } });
    return 'end_turn';
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
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'fake-agent', version: '1.0.0' },
      agentCapabilities: { loadSession: scenario !== 'no_load' },
      authMethods: [{ id: 'fake-login', name: 'Fake login' }],
    };
  })
  .onRequest(methods.agent.session.load, async ({ params, client }) => {
    if (params.sessionId !== 'durable-session' && params.sessionId !== SESSION_ID) throw RequestError.invalidParams(undefined, 'wrong saved session id');
    if (scenario === 'load_error') throw RequestError.authRequired(undefined, 'please log in before resuming');
    await sleep(50);
    await client.notify(methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'already saved' } } });
    await client.notify(methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'historical reply' } } });
    return {};
  })
  .onRequest(methods.agent.session.new, () => {
    if (scenario === 'new_auth_error') throw RequestError.authRequired(undefined, 'please log in');
    if (scenario === 'modes_plus_model') return { sessionId: SESSION_ID, modes: modesBlock(), configOptions: configOptions() };
    if (scenario === 'mode_in_options' || scenario === 'mode_stale') {
      return { sessionId: SESSION_ID, modes: modesBlock(), configOptions: [modeOption(mode), ...configOptions()] };
    }
    return scenario === 'modes_only'
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
      : { sessionId: SESSION_ID, configOptions: configOptions() };
  })
  .onRequest(methods.agent.session.setMode, async ({ params, client }) => {
    mode = params.modeId;
    await client.notify(methods.client.session.update, {
      sessionId: SESSION_ID,
      update: { sessionUpdate: 'current_mode_update', currentModeId: mode },
    });
    return {};
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params, client }) => {
    if (scenario === 'mode_stale' && params.configId === 'mode' && typeof params.value === 'string') {
      // The reply still shows the OLD mode; the change is announced afterwards via current_mode_update only.
      const old = mode;
      const next = params.value;
      mode = next;
      setTimeout(() => {
        void client.notify(methods.client.session.update, {
          sessionId: SESSION_ID,
          update: { sessionUpdate: 'current_mode_update', currentModeId: next },
        });
      }, 30);
      return { configOptions: [modeOption(old), ...configOptions()] };
    }
    if (WITH_EFFORT && params.configId === 'effort' && typeof params.value === 'string') {
      effort = params.value;
      return { configOptions: configOptions() };
    }
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
