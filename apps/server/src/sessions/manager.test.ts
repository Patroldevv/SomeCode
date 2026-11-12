import { readLimits } from '../limits.ts';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SomeCodeError, type StoredEvent } from '@somecode/protocol';
import { createRegistry } from '../agents/registry.ts';
import type { AgentDriver } from '../agents/types.ts';
import { openStore, type Store } from '../store/store.ts';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { readVerify, writeVerify } from '../verify/config.ts';
import { SessionManager } from './manager.ts';

let store: Store;
let dir: string;
let projectId: string;
let manager: SessionManager;

function setup(...drivers: AgentDriver[]): void {
  manager = new SessionManager({ store, registry: createRegistry(drivers) });
}

const types = (sessionId: string) => store.eventsSince(sessionId, 0).map((e) => e.event.type);
const statuses = (sessionId: string) =>
  store
    .eventsSince(sessionId, 0)
    .flatMap((e) => (e.event.type === 'status' ? [e.event.status] : []));
const waitForType = (sessionId: string, type: string, count = 1) =>
  vi.waitFor(() => {
    if (types(sessionId).filter((t) => t === type).length < count) throw new Error(`no ${type} yet`);
  });
const waitForStatus = (sessionId: string, status: string, count = 1) =>
  vi.waitFor(() => {
    if (statuses(sessionId).filter((s) => s === status).length < count) throw new Error(`no ${status} yet`);
  });

beforeEach(() => {
  store = openStore(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'somecode-manager-'));
  projectId = store.addProject({ name: 'p', path: dir }).id;
});

afterEach(async () => {
  await manager?.closeAll();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function rejection(p: Promise<unknown> | (() => unknown)): Promise<SomeCodeError> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    expect(err).toBeInstanceOf(SomeCodeError);
    return err as SomeCodeError;
  }
  throw new Error('expected rejection');
}

describe('createSession', () => {
  it('returns the SessionRow and records the acpSessionId', async () => {
    setup(fakeDriver('basic'));
    const row = await manager.createSession(projectId, 'fake');
    expect(row).toMatchObject({ projectId, agentId: 'fake', acpSessionId: 'fake-session-1' });
    expect(store.getSession(row.id)).toEqual(row);
    expect(statuses(row.id)).toEqual(['ready']);
  });

  it('maps unknown project and unknown agent to not_found', async () => {
    setup(fakeDriver('basic'));
    expect((await rejection(manager.createSession('nope', 'fake'))).code).toBe('not_found');
    expect((await rejection(manager.createSession(projectId, 'nope'))).code).toBe('not_found');
    expect(store.listSessions(projectId)).toEqual([]);
  });

  it('maps a known agent that is not installed to agent_not_installed, without a session row', async () => {
    setup({ ...fakeDriver('basic'), detect: async () => ({ installed: false }) });
    expect((await rejection(manager.createSession(projectId, 'fake'))).code).toBe('agent_not_installed');
    expect(store.listSessions(projectId)).toEqual([]);
  });

  it('rejects a project whose path is gone or is not a directory with bad_request', async () => {
    setup(fakeDriver('basic'));
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    const asFile = store.addProject({ name: 'f', path: file }).id;
    const gone = store.addProject({ name: 'g', path: join(dir, 'missing') }).id;
    expect((await rejection(manager.createSession(asFile, 'fake'))).code).toBe('bad_request');
    expect((await rejection(manager.createSession(gone, 'fake'))).code).toBe('bad_request');
    expect(store.listSessions(asFile)).toEqual([]);
    expect(store.listSessions(gone)).toEqual([]);
  });

  it('records a spawn failure as status:disconnected and rethrows the error', async () => {
    setup({
      ...fakeDriver('basic'),
      launch: () => ({ command: join(dir, 'no-such-binary'), args: [] }),
    });
    expect((await rejection(manager.createSession(projectId, 'fake'))).code).toBe('agent_not_installed');
    const [row] = store.listSessions(projectId);
    expect(statuses(row!.id)).toEqual(['disconnected']);
  });
});

describe('explicit resume', () => {
  it('cancels permissions abandoned by a previous process, including requests outside the recent page', async () => {
    setup(fakeDriver('load'));
    const row=store.createSession({projectId,agentId:'fake'});
    store.setAcpSessionId(row.id,'durable-session');
    for(let n=0;n<105;n++) store.appendEvent(row.id,{type:'permission_request',requestId:`lost-${n}`,toolCallId:`tool-${n}`,title:'old approval',options:[{id:'allow',name:'Allow',kind:'allow_once'}]});
    store.appendEvent(row.id,{type:'status',status:'running'});
    await manager.resumeSession(row.id);
    const page=manager.history(row.id,undefined,100);
    expect(page.state.items.every((item)=>item.kind!=='permission'||item.resolved)).toBe(true);
    const older=manager.history(row.id,page.beforeSeq!,100);
    expect(older.state.items).toHaveLength(5);
    expect(older.state.items.every((item)=>item.kind==='permission'&&item.resolved)).toBe(true);
  });
  it('keeps a resuming agent reachable across unsubscribe/resubscribe and closes its child on shutdown', async () => {
    let release!: () => void;
    const detected = new Promise<void>((resolve)=>{release=resolve;});
    const tag = `somecode-test-${randomUUID()}`;
    const base = fakeDriver('load');
    setup({...base,detect:async()=>{await detected;return {installed:true};},launch:()=>{
      const launch=base.launch();
      return {...launch,args:[...launch.args,tag]};
    }});
    const row=store.createSession({projectId,agentId:'fake'});
    store.setAcpSessionId(row.id,'durable-session');
    const resuming=manager.resumeSession(row.id);
    const first=manager.subscribe(row.id,0,()=>{});
    first.unsubscribe();
    const statuses: string[]=[];
    manager.subscribe(row.id,0,(stored)=>{if(stored.event.type==='status')statuses.push(stored.event.status);});
    release();
    await resuming;
    expect(statuses).toContain('ready');
    expect(()=>manager.prompt(row.id,'reachable')).not.toThrow();
    await waitForType(row.id,'turn_end');
    expect(pids(tag)).toHaveLength(1);
    await manager.closeAll();
    expect(pids(tag)).toEqual([]);
  });
  it('restores the same ACP session after reopening the journal in a new manager', async () => {
    store.close();
    const database = join(dir,'restart.sqlite');
    store = openStore(database);
    projectId = store.addProject({name:'restart',path:dir}).id;
    setup(fakeDriver('load'));
    const row = await manager.createSession(projectId,'fake');
    manager.prompt(row.id,'saved prompt');
    await waitForType(row.id,'turn_end');
    await manager.closeAll();
    store.close();
    store = openStore(database);
    setup(fakeDriver('load'));
    expect(manager.history(row.id).state.status).toBe('disconnected');
    const restored = await manager.resumeSession(row.id);
    expect(restored.acpSessionId).toBe('fake-session-1');
    expect(types(row.id).filter((t)=>t === 'user_message')).toHaveLength(1);
    expect(types(row.id).filter((t)=>t === 'agent_message')).toHaveLength(1);
    expect(manager.history(row.id).state.status).toBe('ready');
  });
  it('loads the durable ACP id once across concurrent resumes and does not journal replayed messages', async () => {
    setup(fakeDriver('load'));
    const row = store.createSession({ projectId, agentId: 'fake' });
    store.setAcpSessionId(row.id, 'durable-session');
    store.appendEvent(row.id, { type: 'user_message', text: 'already saved' });
    const [a, b] = await Promise.all([manager.resumeSession(row.id), manager.resumeSession(row.id)]);
    expect(a.acpSessionId).toBe('durable-session');
    expect(b).toEqual(a);
    expect(types(row.id).filter((t) => t === 'user_message')).toHaveLength(1);
    expect(statuses(row.id)).toEqual(['ready']);
    await manager.resumeSession(row.id);
    expect(statuses(row.id)).toEqual(['ready']);
    manager.prompt(row.id, 'new prompt');
    await waitForType(row.id, 'turn_end');
  });

  it('journals a prompt once even when the agent echoes it back as a user message', async () => {
    setup(fakeDriver('echo_user'));
    const row = await manager.createSession(projectId, 'fake');
    manager.prompt(row.id, 'echo me');
    await waitForType(row.id, 'turn_end');
    expect(types(row.id).filter((t) => t === 'user_message')).toHaveLength(1);
  });

  it('never replaces a persisted session when the agent cannot load sessions', async () => {
    setup(fakeDriver('no_load'));
    const row = store.createSession({ projectId, agentId: 'fake' });
    store.setAcpSessionId(row.id, 'keep-this-id');
    await expect(manager.resumeSession(row.id)).rejects.toMatchObject({ code: 'bad_request' });
    expect(store.getSession(row.id)?.acpSessionId).toBe('keep-this-id');
    expect(statuses(row.id)).toEqual(['disconnected']);
    expect(() => manager.prompt(row.id, 'no')).toThrow(/not connected/);
  });
  it('retains the saved ACP id and disconnected state when loading fails', async () => {
    setup(fakeDriver('load_error'));
    const row = store.createSession({ projectId, agentId: 'fake' });
    store.setAcpSessionId(row.id,'durable-session');
    await expect(manager.resumeSession(row.id)).rejects.toMatchObject({code:'auth_required'});
    expect(store.getSession(row.id)?.acpSessionId).toBe('durable-session');
    expect(statuses(row.id)).toEqual(['disconnected']);
    expect(store.listSessions(projectId)).toHaveLength(1);
  });
});

describe('normalized history', () => {
  it('snapshots short persisted sessions as disconnected after restart, even when their last journal status was ready', () => {
    setup(fakeDriver('basic'));
    const row = store.createSession({projectId,agentId:'fake'});
    store.setAcpSessionId(row.id,'durable-session');
    store.appendEvent(row.id,{type:'user_message',text:'saved'});
    store.appendEvent(row.id,{type:'status',status:'ready'});
    const got: StoredEvent[] = [];
    const sub = manager.subscribe(row.id,0,(event)=>got.push(event));
    expect(sub.snapshot?.state.status).toBe('disconnected');
    expect(sub.snapshot?.state.items).toMatchObject([{kind:'user',text:'saved'}]);
    expect(sub.snapshot?.state.lastSeq).toBe(2);
    expect(got).toEqual([]);
    sub.unsubscribe();
  });
  it('replaces a large replay with a bounded snapshot and keeps subsequent live events contiguous', async () => {
    setup(fakeDriver('basic'));
    const row = await manager.createSession(projectId, 'fake');
    for (let n = 0; n < 250; n++) store.appendEvent(row.id, { type: 'user_message', text: `message ${n}` });
    const delivered: number[] = [];
    const sub = manager.subscribe(row.id, 0, (event) => delivered.push(event.seq));
    expect(delivered).toEqual([]);
    expect(sub.snapshot?.state.items).toHaveLength(100);
    expect(sub.snapshot?.beforeSeq).toBe(153);
    expect(sub.snapshot?.state.lastSeq).toBe(252);
    manager.prompt(row.id, 'next');
    await vi.waitFor(() => expect(store.eventsSince(row.id,252).some((e)=>e.event.type === 'turn_end')).toBe(true));
    expect(delivered[0]).toBe(253);
    expect(delivered).toEqual(delivered.map((_, n) => n + 253));
  });
  it('pages old items with late tool updates intact and keeps the live cursor at the journal head', () => {
    setup(fakeDriver('basic'));
    const row = store.createSession({ projectId, agentId: 'fake' });
    store.appendEvent(row.id, { type: 'tool_call', id: 'old-tool', title: 'Read', kind: 'read', status: 'pending', content: [] });
    for (let n = 0; n < 5; n++) store.appendEvent(row.id, { type: 'user_message', text: `message ${n}` });
    store.appendEvent(row.id, { type: 'tool_call_update', id: 'old-tool', patch: { status: 'completed' } });
    const newest = manager.history(row.id, undefined, 2);
    expect(newest.state.items.map((i) => i.key)).toEqual(['5', '6']);
    expect(newest.beforeSeq).toBe(5);
    const middle = manager.history(row.id, newest.beforeSeq!, 2);
    expect(middle.state.items.map((i) => i.key)).toEqual(['3', '4']);
    const oldest = manager.history(row.id, middle.beforeSeq!, 2);
    expect(oldest.state.items).toMatchObject([{ kind: 'tool', status: 'completed' }, { kind: 'user', text: 'message 0' }]);
    expect(oldest.state.lastSeq).toBe(7);
    expect(oldest.beforeSeq).toBeNull();
  });
});

describe('prompt', () => {
  it('journals a full turn with running -> ready and gapless seq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    expect(manager.prompt(id, 'hello')).toBeUndefined();
    await waitForStatus(id, 'ready', 2);
    expect(types(id)).toEqual([
      'config_options',
      'status',
      'user_message',
      'status',
      'agent_thought',
      'agent_message',
      'tool_call',
      'tool_call_update',
      'turn_end',
      'status',
    ]);
    expect(statuses(id)).toEqual(['ready', 'running', 'ready']);
    const seqs = store.eventsSince(id, 0).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('prompt journals user_message before status:running', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'hello');
    await waitForStatus(id, 'ready', 2);
    const stored = store.eventsSince(id, 0);
    const at = stored.findIndex((e) => e.event.type === 'status' && e.event.status === 'running');
    expect(at).toBeGreaterThan(0);
    expect(stored[at - 1]!.event).toEqual({ type: 'user_message', text: 'hello' });
    expect(stored.map((e) => e.seq)).toEqual(stored.map((_, i) => i + 1));
  });

  it('rejected prompt journals nothing', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'one');
    await waitForType(id, 'agent_thought');
    const last = store.lastSeq(id);
    expect((await rejection(() => manager.prompt(id, 'two'))).code).toBe('turn_in_progress');
    expect(store.lastSeq(id)).toBe(last);
    expect(types(id).filter((t) => t === 'user_message')).toHaveLength(1);
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 2);

    const unknown = store.createSession({ projectId, agentId: 'fake' });
    expect((await rejection(() => manager.prompt(unknown.id, 'hi'))).code).toBe('disconnected');
    expect(store.lastSeq(unknown.id)).toBe(0);
    expect((await rejection(() => manager.prompt('nope', 'hi'))).code).toBe('not_found');
  });

  it('rejected prompt on a disconnected session journals nothing', async () => {
    setup(fakeDriver('crash'));
    const { id } = await manager.createSession(projectId, 'fake');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      manager.prompt(id, 'boom');
      await waitForStatus(id, 'disconnected');
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith(expect.stringContaining('prompt failed')));
    } finally {
      stderr.mockRestore();
    }
    const last = store.lastSeq(id);
    expect((await rejection(() => manager.prompt(id, 'again'))).code).toBe('disconnected');
    expect(store.lastSeq(id)).toBe(last);
  });

  it('subscribers see user_message in order', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: StoredEvent[] = [];
    manager.subscribe(id, store.lastSeq(id), (e) => got.push(e));
    manager.prompt(id, 'hello');
    await waitForStatus(id, 'ready', 2);
    expect(got.slice(0, 2).map((e) => e.event)).toEqual([
      { type: 'user_message', text: 'hello' },
      { type: 'status', status: 'running' },
    ]);
    expect(got.map((e) => e.seq)).toEqual(store.eventsSince(id, 2).map((e) => e.seq));
  });

  it('rejects a second prompt during a turn, then accepts one after cancel', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'one');
    await waitForType(id, 'agent_thought');
    expect((await rejection(() => manager.prompt(id, 'two'))).code).toBe('turn_in_progress');
    expect(types(id)).not.toContain('turn_end');
    expect(statuses(id)).toEqual(['ready', 'running']);

    await manager.cancel(id);
    await waitForStatus(id, 'ready', 2);
    expect(store.eventsSince(id, 0).find((e) => e.event.type === 'turn_end')?.event).toEqual({
      type: 'turn_end',
      stopReason: 'cancelled',
    });

    manager.prompt(id, 'three');
    await waitForStatus(id, 'running', 2);
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 3);
  });

  it('keeps turn_in_progress when a listener re-prompts on status:ready', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    let reprompted = false;
    manager.subscribe(id, store.lastSeq(id), (e) => {
      if (e.event.type === 'status' && e.event.status === 'ready' && !reprompted) {
        reprompted = true;
        manager.prompt(id, 'second');
      }
    });
    manager.prompt(id, 'first');
    await waitForType(id, 'agent_thought');
    await manager.cancel(id);
    await waitForStatus(id, 'running', 2);
    // Let the finished first turn's promise settle; it must not clear the second turn's busy flag.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await rejection(() => manager.prompt(id, 'third'))).code).toBe('turn_in_progress');
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 3);
  });

  it('journals an agent error as turn_end{error} before status:ready, then accepts a new prompt', async () => {
    setup(fakeDriver('prompt_auth_error'));
    const { id } = await manager.createSession(projectId, 'fake');
    const from = store.lastSeq(id);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      manager.prompt(id, 'hello');
      await waitForStatus(id, 'ready', 2);
      expect(store.eventsSince(id, from).map((e) => e.event)).toEqual([
        { type: 'user_message', text: 'hello' },
        { type: 'status', status: 'running' },
        { type: 'agent_thought', text: 'Thinking about it' },
        { type: 'turn_end', stopReason: 'error', error: { code: 'auth_required', message: expect.any(String) } },
        { type: 'status', status: 'ready' },
      ]);
      // busy is cleared: a later prompt is accepted (and journaled) instead of turn_in_progress.
      await vi.waitFor(() => expect(() => manager.prompt(id, 'again')).not.toThrow());
      await waitForStatus(id, 'ready', 3);
      expect(types(id).filter((t) => t === 'turn_end')).toHaveLength(2);
    } finally {
      stderr.mockRestore();
    }
    const seqs = store.eventsSince(id, 0).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('journals an unknown ACP update type as unsupported, in order', async () => {
    setup(fakeDriver('unknown_update'));
    const { id } = await manager.createSession(projectId, 'fake');
    const from = store.lastSeq(id);
    manager.prompt(id, 'hello');
    await waitForStatus(id, 'ready', 2);
    expect(store.eventsSince(id, from).map((e) => e.event)).toEqual([
      { type: 'user_message', text: 'hello' },
      { type: 'status', status: 'running' },
      { type: 'agent_thought', text: 'Thinking about it' },
      { type: 'agent_message', text: 'before' },
      { type: 'unsupported', sessionUpdate: 'brand_new_thing', raw: { sessionUpdate: 'brand_new_thing', detail: { answer: 42 } } },
      { type: 'agent_message', text: 'after' },
      { type: 'turn_end', stopReason: 'end_turn' },
      { type: 'status', status: 'ready' },
    ]);
  });

  it('rejects an unknown session with not_found', async () => {
    setup(fakeDriver('basic'));
    expect((await rejection(() => manager.prompt('nope', 'hi'))).code).toBe('not_found');
  });

  it('rejects prompts after the agent crashed with disconnected', async () => {
    setup(fakeDriver('crash'));
    const { id } = await manager.createSession(projectId, 'fake');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      manager.prompt(id, 'boom');
      await waitForStatus(id, 'disconnected');
      // The failed background prompt is logged, not thrown.
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith(expect.stringContaining('prompt failed')));
    } finally {
      stderr.mockRestore();
    }
    expect(statuses(id).at(-1)).toBe('disconnected');
    expect((await rejection(() => manager.prompt(id, 'again'))).code).toBe('disconnected');
  });

  it('rejects prompts for a stored session with no live agent with disconnected', async () => {
    setup(fakeDriver('basic'));
    const row = store.createSession({ projectId, agentId: 'fake' });
    expect((await rejection(() => manager.prompt(row.id, 'hi'))).code).toBe('disconnected');
  });
});

describe('cancel, respondPermission, setConfig', () => {
  it('carries the plan text of a permission request (leaving plan mode)', async () => {
    setup(fakeDriver('plan_permission'));
    const id = (await manager.createSession(projectId, 'fake')).id;
    manager.prompt(id, 'plan it');
    await waitForType(id, 'permission_request');
    const request = store.eventsSince(id, 0).find((e) => e.event.type === 'permission_request')!.event;
    if (request.type !== 'permission_request') throw new Error('unreachable');
    expect(request).toMatchObject({ title: 'Ready to code?', detail: '# Plan\n1. Do the thing' });
    manager.respondPermission(id, request.requestId, 'allow');
    await waitForType(id, 'turn_end');
  });

  it('shows an agent question as a form, validates the answer and hands it back to the agent', async () => {
    setup(fakeDriver('ask_user'));
    const id = (await manager.createSession(projectId, 'fake')).id;
    manager.prompt(id, 'ask me');
    await waitForType(id, 'permission_request');
    const request = store.eventsSince(id, 0).find((e) => e.event.type === 'permission_request')!.event;
    if (request.type !== 'permission_request') throw new Error('unreachable');
    expect(request.title).toBe('Which stack?');
    expect(request.form?.fields.map((f) => [f.key, f.type, f.required])).toEqual([['stack', 'string', true], ['notes', 'string', false]]);
    expect(request.form?.fields[0]?.options).toEqual([{ value: 'ts', label: 'TypeScript' }, { value: 'py', label: 'Python' }]);
    // A missing required value or a choice that was not offered is refused and the question stays open.
    expect(() => manager.respondPermission(id, request.requestId, 'submit', {})).toThrow(/required/);
    expect(() => manager.respondPermission(id, request.requestId, 'submit', { stack: 'rust' })).toThrow(/valid/);
    manager.respondPermission(id, request.requestId, 'submit', { stack: 'ts', notes: 'fast', extra: 'dropped' });
    await waitForType(id, 'turn_end');
    const events = store.eventsSince(id, 0).map((e) => e.event);
    expect(events.find((e) => e.type === 'permission_resolved')).toMatchObject({ outcome: 'selected', answer: { stack: 'ts', notes: 'fast' } });
    expect(events.find((e) => e.type === 'agent_message' && e.text.startsWith('answer'))).toMatchObject({ text: 'answer: accept {"stack":"ts","notes":"fast"}' });
  });

  it('tags a sub-agent\'s tool calls with the sub-agent and keeps its chatter out of the conversation', async () => {
    setup(fakeDriver('subagent'));
    const id = (await manager.createSession(projectId, 'fake')).id;
    manager.prompt(id, 'explore');
    await waitForType(id, 'turn_end');
    const events = store.eventsSince(id, 0).map((e) => e.event);
    const calls = events.filter((e) => e.type === 'tool_call');
    expect(calls.find((c) => c.type === 'tool_call' && c.id === 'child1')).toMatchObject({ parent: { id: 'task1' } });
    expect(calls.find((c) => c.type === 'tool_call' && c.id === 'oc1')).toMatchObject({ parent: { id: 'session:abc', title: 'Find usages' } });
    expect(calls.find((c) => c.type === 'tool_call' && c.id === 'task1')).not.toHaveProperty('parent');
    expect(events.some((e) => e.type === 'agent_message' && e.text.includes('chatter'))).toBe(false);
  });

  it('announces the context window when a turn ends and keeps the agent\'s rate-limit reports', async () => {
    setup(fakeDriver('usage'));
    const id = (await manager.createSession(projectId, 'fake')).id;
    manager.prompt(id, 'go');
    await waitForType(id, 'turn_end');
    const events = store.eventsSince(id, 0).map((e) => e.event);
    expect(events.filter((e) => e.type === 'usage')).toEqual([{ type: 'usage', used: 30000, size: 200000 }]);
    expect(events.findIndex((e) => e.type === 'usage')).toBeLessThan(events.findIndex((e) => e.type === 'turn_end'));
    expect(readLimits(store, 'fake').map((l) => [l.type, l.used])).toEqual([['five_hour', 0.24], ['seven_day', 0.47]]);
  });

  it('skipping a question cancels it for the agent', async () => {
    setup(fakeDriver('ask_user'));
    const id = (await manager.createSession(projectId, 'fake')).id;
    manager.prompt(id, 'ask me');
    await waitForType(id, 'permission_request');
    const request = store.eventsSince(id, 0).find((e) => e.event.type === 'permission_request')!.event;
    if (request.type !== 'permission_request') throw new Error('unreachable');
    manager.respondPermission(id, request.requestId, null);
    await waitForType(id, 'turn_end');
    expect(store.eventsSince(id, 0).map((e) => e.event).find((e) => e.type === 'agent_message' && e.text.startsWith('answer'))).toMatchObject({ text: 'answer: cancel null' });
  });

  it('answers a permission request and finishes the turn', async () => {
    setup(fakeDriver('permission'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'edit');
    await waitForType(id, 'permission_request');
    const request = store.eventsSince(id, 0).find((e) => e.event.type === 'permission_request')!.event;
    if (request.type !== 'permission_request') throw new Error('unreachable');
    manager.respondPermission(id, request.requestId, 'allow');
    await waitForType(id, 'turn_end');
    expect(types(id)).toContain('permission_resolved');
    expect((await rejection(() => manager.respondPermission(id, request.requestId, 'allow'))).code).toBe(
      'not_found',
    );
    expect((await rejection(() => manager.respondPermission('nope', 'r', null))).code).toBe('not_found');
    await manager.closeAll();
    expect((await rejection(() => manager.respondPermission(id, 'r', null))).code).toBe('disconnected');
  });

  it('keeps a per-session access level: shown as an option, changeable mid-turn, remembered, and never sent to the agent', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const first = store.eventsSince(id, 0).find((e) => e.event.type === 'config_options')!.event;
    expect(first.type === 'config_options' && first.options.find((o) => o.id === 'approval')).toMatchObject({ category: 'approval', currentValue: 'ask' });
    await manager.setConfig(id, 'approval', 'full');
    const last = store.eventsSince(id, 0).at(-1)!.event;
    expect(last).toMatchObject({ type: 'config_options', options: [{ id: 'model' }, { id: 'approval', currentValue: 'full' }] });
    expect(store.getSetting(`approval:${id}`)).toBe('full');
    expect((await rejection(manager.setConfig(id, 'approval', 'yolo'))).code).toBe('bad_request');
  });

  it('offers deep research in the mode menu, keeps it as SomeCode\'s own mode (the agent stays plain) and remembers it', async () => {
    setup(fakeDriver('mode_stale'));
    const { id } = await manager.createSession(projectId, 'fake');
    const modeOf = () => {
      const last = [...store.eventsSince(id, 0)].reverse().find((e) => e.event.type === 'config_options')!.event;
      return last.type === 'config_options' ? last.options.find((o) => o.id === 'mode')! : undefined;
    };
    expect(modeOf()?.choices.map((c) => c.value)).toEqual(['default', 'plan', 'deep_research']);
    expect(modeOf()?.currentValue).toBe('default');
    await manager.setConfig(id, 'mode', 'plan');
    await vi.waitFor(() => expect(modeOf()?.currentValue).toBe('plan'));
    await manager.setConfig(id, 'mode', 'deep_research');
    // The agent itself was moved back to its plain mode; only the menu shows deep research.
    expect(modeOf()?.currentValue).toBe('deep_research');
    expect(store.getSetting(`research:${id}`)).toBe('1');
    await manager.setConfig(id, 'mode', 'plan');
    await vi.waitFor(() => expect(modeOf()?.currentValue).toBe('plan'));
    expect(store.getSetting(`research:${id}`)).toBe('0');
  });

  it('puts a research plan to the user, lets them edit it and ticks the steps off', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const { requestId } = await manager.proposeResearchPlan(id, 'Quickshell survey', ['find repos', 'compare', 'report'], true);
    const asked = store.eventsSince(id, 0).map((e) => e.event).find((e) => e.type === 'permission_request' && e.requestId === requestId);
    expect(asked).toMatchObject({ plan: { steps: ['find repos', 'compare', 'report'] } });
    expect(await manager.researchPlanState(requestId, 0)).toEqual({ state: 'pending' });
    // The user edits a step, drops one and starts it.
    manager.respondPermission(id, requestId, 'start', { steps: ['find repos', '  compare in depth  ', ''] });
    expect(await manager.researchPlanState(requestId, 200)).toEqual({ state: 'started', steps: ['find repos', 'compare in depth'] });
    expect(manager.researchProgress(id, 2, 'completed')).toEqual({ done: 1, total: 2 });
    const plans = store.eventsSince(id, 0).map((e) => e.event).filter((e) => e.type === 'plan');
    expect(plans.at(-1)).toMatchObject({ entries: [{ content: 'find repos', status: 'in_progress' }, { content: 'compare in depth', status: 'completed' }] });
    // Finishing the running step starts the next one.
    manager.researchProgress(id, 1, 'completed');
    expect(store.eventsSince(id, 0).map((e) => e.event).filter((e) => e.type === 'plan').at(-1)).toMatchObject({ entries: [{ status: 'completed' }, { status: 'completed' }] });
    expect(() => manager.researchProgress(id, 5, 'completed')).toThrow();
  });

  it('a cancelled research plan says so, and a plan without asking starts at once', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const { requestId } = await manager.proposeResearchPlan(id, 'Survey', ['a', 'b', 'c'], true);
    manager.respondPermission(id, requestId, null);
    expect(await manager.researchPlanState(requestId, 200)).toEqual({ state: 'cancelled' });
    expect(await manager.proposeResearchPlan(id, 'Survey', ['x', 'y'], false)).toEqual({ requestId: 'auto', steps: ['x', 'y'] });
    expect(store.eventsSince(id, 0).map((e) => e.event).filter((e) => e.type === 'plan').at(-1)).toMatchObject({ entries: [{ content: 'x' }, { content: 'y' }] });
  });

  it('forwards setConfig and validates the session', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    await manager.setConfig(id, 'model', 'smart');
    const last = store.eventsSince(id, 0).at(-1)!.event;
    expect(last).toMatchObject({ type: 'config_options', options: [{ id: 'model', currentValue: 'smart' }, { id: 'approval', currentValue: 'ask' }] });
    expect((await rejection(manager.setConfig('nope', 'model', 'fast'))).code).toBe('not_found');
    expect((await rejection(manager.cancel('nope'))).code).toBe('not_found');
  });
});

describe('setConfig failures', () => {
  it('refuses while a turn runs, rejects unknown options and journals nothing for either', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'go');
    await waitForType(id, 'agent_thought');
    const last = store.lastSeq(id);
    expect((await rejection(manager.setConfig(id, 'model', 'smart'))).code).toBe('turn_in_progress');
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 2);
    const before = store.lastSeq(id);
    expect((await rejection(manager.setConfig(id, 'no-such-option', 'x'))).code).toBe('bad_request');
    expect(store.lastSeq(id)).toBe(before);
    expect(before).toBeGreaterThan(last - 1);
  });
});

describe('subscribe', () => {
  it('replays history then delivers live events, without duplicates, even when one arrives mid-replay', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: StoredEvent[] = [];
    let started = false;
    const sub = manager.subscribe(id, 0, (e) => {
      got.push(e);
      if (!started) {
        started = true;
        manager.prompt(id, 'during replay'); // emits a live event while the replay is running
      }
    });
    await waitForStatus(id, 'ready', 2);
    const stored = store.eventsSince(id, 0);
    expect(got.map((e) => e.seq)).toEqual(stored.map((e) => e.seq));
    expect(got.map((e) => e.event)).toEqual(stored.map((e) => e.event));
    expect(got.map((e) => e.seq)).toEqual(got.map((_, i) => i + 1));
    expect(sub.lastSeq).toBe(2); // config_options + status:ready existed at subscribe time
    sub.unsubscribe();
  });

  it('keeps order for all subscribers when a listener triggers events synchronously', async () => {
    setup(fakeDriver('permission'));
    const { id } = await manager.createSession(projectId, 'fake');
    const from = store.lastSeq(id);
    const seen: number[] = [];
    let reprompted = false;
    manager.subscribe(id, from, (e) => {
      if (e.event.type === 'permission_request') manager.respondPermission(id, e.event.requestId, 'allow');
      if (e.event.type === 'status' && e.event.status === 'ready' && !reprompted) {
        reprompted = true;
        manager.prompt(id, 'again'); // emits status:running synchronously
      }
    });
    manager.subscribe(id, from, (e) => seen.push(e.seq));
    manager.prompt(id, 'first');
    await waitForStatus(id, 'ready', 3);
    expect(seen).toEqual(store.eventsSince(id, from).map((e) => e.seq));
    expect(types(id)).toContain('permission_resolved');
    expect(seen.length).toBeGreaterThan(10);
  });

  it('replays only events after afterSeq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    const sub = manager.subscribe(id, 1, (e) => got.push(e.seq));
    expect(got).toEqual([2]);
    expect(sub.lastSeq).toBe(2);
  });

  it('delivers no history when afterSeq is beyond the last seq and reports the real lastSeq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    const sub = manager.subscribe(id, 999, (e) => got.push(e.seq));
    expect(got).toEqual([]);
    expect(sub.lastSeq).toBe(store.lastSeq(id));
    expect(sub.lastSeq).toBe(2);
  });

  it('stops delivering after unsubscribe', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    const sub = manager.subscribe(id, 0, (e) => got.push(e.seq));
    const before = got.length;
    sub.unsubscribe();
    manager.prompt(id, 'hi');
    await waitForStatus(id, 'ready', 2);
    expect(got).toHaveLength(before);
  });

  it('isolates a throwing listener from other listeners and from journaling', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const got: number[] = [];
      manager.subscribe(id, 0, () => {
        throw new Error('listener bug');
      });
      manager.subscribe(id, 0, (e) => got.push(e.seq));
      manager.prompt(id, 'hi');
      await waitForStatus(id, 'ready', 2);
      expect(got).toEqual(store.eventsSince(id, 0).map((e) => e.seq));
      expect(stderr).toHaveBeenCalled();
      await manager.closeAll(); // the throwing listener is still registered until now
    } finally {
      stderr.mockRestore();
    }
  });

  it('rejects unknown sessions and invalid afterSeq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    expect((await rejection(() => manager.subscribe('nope', 0, () => {}))).code).toBe('not_found');
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect((await rejection(() => manager.subscribe(id, bad, () => {}))).code).toBe('bad_request');
    }
  });
});

/** PIDs of processes whose command line contains `tag` (no shell, so pgrep never matches itself). */
function pids(tag: string): string[] {
  return spawnSync('pgrep', ['-f', tag], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
}

describe('closeAll during startup', () => {
  it('stops an agent that is still starting, rejects its createSession, and writes nothing afterwards', async () => {
    const tag = `somecode-test-${randomUUID()}`;
    const base = fakeDriver('slow_start');
    const driver: AgentDriver = {
      ...base,
      launch: () => {
        const l = base.launch();
        return { ...l, args: [...l.args, tag] }; // marks this test's agent process
      },
    };
    let closed = false;
    const lateWrites: string[] = [];
    const guarded: Store = {
      ...store,
      appendEvent: (sessionId, event) => {
        if (closed) lateWrites.push(`appendEvent ${event.type}`);
        return store.appendEvent(sessionId, event);
      },
      setAcpSessionId: (id, acpId) => {
        if (closed) lateWrites.push('setAcpSessionId');
        store.setAcpSessionId(id, acpId);
      },
    };
    manager = new SessionManager({ store: guarded, registry: createRegistry([driver]) });

    const creating = rejection(manager.createSession(projectId, 'fake'));
    await vi.waitFor(() => expect(pids(tag)).toHaveLength(1)); // the agent runs, stuck in initialize
    const t0 = Date.now();
    await manager.closeAll();
    closed = true;
    expect(Date.now() - t0).toBeLessThan(3000); // did not wait for the 30 s initialize
    expect(pids(tag)).toEqual([]);
    expect((await creating).code).toBe('disconnected');

    const [row] = store.listSessions(projectId);
    expect(row!.acpSessionId).toBeNull();
    expect(statuses(row!.id)).toEqual(['disconnected']);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lateWrites).toEqual([]);

    // After closeAll, new sessions are refused without spawning or writing anything.
    expect((await rejection(manager.createSession(projectId, 'fake'))).code).toBe('disconnected');
    expect(store.listSessions(projectId)).toHaveLength(1);
    expect(pids(tag)).toEqual([]);
  });
});

describe('closeAll', () => {
  it('closes live agents and clears listeners', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    manager.subscribe(id, 0, (e) => got.push(e.seq));
    await manager.closeAll();
    expect(statuses(id).at(-1)).toBe('disconnected');
    const delivered = got.length;
    expect((await rejection(() => manager.prompt(id, 'hi'))).code).toBe('disconnected');
    expect(got).toHaveLength(delivered);
  });
});

describe('rewindSession', () => {
  it('rewinds session events and keeps agent ready for the next prompt', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'turn 1');
    await waitForType(id, 'turn_end', 1);

    manager.prompt(id, 'turn 2');
    await waitForType(id, 'turn_end', 2);

    const events = store.eventsSince(id, 0);
    const turn2 = events.find((e) => e.event.type === 'user_message' && (e.event as any).text === 'turn 2');
    expect(turn2).toBeDefined();

    await manager.rewindSession(id, turn2!.seq);

    const remaining = store.eventsSince(id, 0);
    expect(remaining.some((e) => e.seq >= turn2!.seq)).toBe(false);
    expect(remaining.some((e) => e.event.type === 'user_message' && (e.event as any).text === 'turn 1')).toBe(true);

    manager.prompt(id, 'turn 2 retry');
    await waitForType(id, 'turn_end', 2);
    const updated = store.eventsSince(id, 0);
    expect(updated.some((e) => e.event.type === 'user_message' && (e.event as any).text === 'turn 2 retry')).toBe(true);
  });
});

describe('checks after a turn', () => {
  const verifications = (id: string) =>
    store.eventsSince(id, 0).flatMap((e) => (e.event.type === 'verification' ? [e.event] : []));
  const lastOf = (id: string, round: number) => verifications(id).filter((v) => v.round === round).at(-1);

  it('runs the project\'s checks once a turn that changed files has ended, and hands a failure to the agent a limited number of times', async () => {
    setup(fakeDriver('basic'));
    writeVerify(store, projectId, { enabled: true, autoFix: true, maxFixes: 1, checks: [{ name: 'Test', command: 'echo "boom: 2 tests failed"; exit 1' }] });
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'change it');
    await vi.waitFor(() => expect(lastOf(id, 0)?.status).toBe('failed'));
    expect(lastOf(id, 0)).toMatchObject({ willFix: true, checks: [{ name: 'Test', status: 'failed', output: expect.stringContaining('2 tests failed') }] });
    // The failure went to the agent as a message of SomeCode's own, and it worked again: one round, then it stops.
    await vi.waitFor(() => expect(lastOf(id, 1)?.status).toBe('failed'));
    expect(lastOf(id, 1)?.willFix).toBe(false);
    const users = store.eventsSince(id, 0).flatMap((e) => (e.event.type === 'user_message' ? [e.event.text] : []));
    expect(users).toHaveLength(2);
    expect(users[1]).toMatch(/^\[SomeCode check\].*fix round 1 of 1/s);
    await new Promise((r) => setTimeout(r, 300));
    expect(verifications(id).filter((v) => v.round === 2)).toEqual([]);
  });

  it('passes quietly, and does nothing without checks, when switched off, or when nothing was changed', async () => {
    setup(fakeDriver('basic'), fakeDriver('usage', 'echo'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'no checks configured');
    await waitForStatus(id, 'ready', 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(verifications(id)).toEqual([]);

    writeVerify(store, projectId, { enabled: false, autoFix: true, maxFixes: 2, checks: [{ name: 'Test', command: 'exit 1' }] });
    manager.prompt(id, 'switched off');
    await waitForStatus(id, 'ready', 3);
    await new Promise((r) => setTimeout(r, 200));
    expect(verifications(id)).toEqual([]);

    writeVerify(store, projectId, { enabled: true, autoFix: true, maxFixes: 2, checks: [{ name: 'Lint', command: 'true' }] });
    manager.prompt(id, 'now it passes');
    await vi.waitFor(() => expect(lastOf(id, 0)?.status).toBe('passed'));
    expect(lastOf(id, 0)?.willFix).toBe(false);
    // A turn that changed nothing is not checked.
    const quiet = await manager.createSession(projectId, 'echo');
    manager.prompt(quiet.id, 'just talk');
    await waitForStatus(quiet.id, 'ready', 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(verifications(quiet.id)).toEqual([]);
    // "Run checks" works on demand, and refuses a project without any.
    manager.verifyNow(id);
    await vi.waitFor(() => expect(verifications(id).filter((v) => v.status === 'passed').length).toBeGreaterThanOrEqual(2));
    writeVerify(store, projectId, { enabled: true, autoFix: true, maxFixes: 2, checks: [] });
    expect(() => manager.verifyNow(id)).toThrow(/no checks/);
  });
});

describe('checks proposed by an agent', () => {
  const asked = (id: string) => store.eventsSince(id, 0).flatMap((e) => (e.event.type === 'permission_request' && e.event.detail?.includes('project') ? [e.event] : []));

  it('waits for the user, saves the checks only when approved (added or replacing) and never runs them on its own', async () => {
    setup(fakeDriver('usage'));
    writeVerify(store, projectId, { enabled: false, autoFix: false, maxFixes: 1, checks: [{ name: 'Old', command: 'echo old' }] });
    const { id } = await manager.createSession(projectId, 'fake');
    const { requestId } = await manager.proposeChecks(id, { checks: [{ name: 'Test', command: 'npm test' }, { name: 'Old again', command: 'echo old' }], mode: 'add', reason: 'The project uses vitest.' });
    expect(asked(id)[0]).toMatchObject({ requestId, options: [{ id: 'approve' }, { id: 'refuse' }], detail: expect.stringContaining('`npm test`') });
    expect(asked(id)[0]!.detail).toContain('The project uses vitest.');
    expect(await manager.checksProposalState(requestId, 0)).toEqual({ state: 'pending' });
    expect(readVerifyFor()).toMatchObject({ checks: [{ name: 'Old' }] });
    manager.respondPermission(id, requestId, 'approve');
    expect(await manager.checksProposalState(requestId, 500)).toEqual({ state: 'approved' });
    // Added without a duplicate, and the checks are switched on; the user's other settings stay.
    expect(readVerifyFor()).toMatchObject({ enabled: true, autoFix: false, maxFixes: 1, checks: [{ command: 'echo old' }, { command: 'npm test' }] });
    expect(verificationEvents(id)).toEqual([]);

    const second = await manager.proposeChecks(id, { checks: [{ name: 'Lint', command: 'npm run lint' }], mode: 'replace' });
    manager.respondPermission(id, second.requestId, 'approve');
    expect(await manager.checksProposalState(second.requestId, 500)).toEqual({ state: 'approved' });
    expect(readVerifyFor().checks).toEqual([{ name: 'Lint', command: 'npm run lint' }]);

    const third = await manager.proposeChecks(id, { checks: [{ name: 'Bad', command: 'rm -rf /' }], mode: 'replace' });
    manager.respondPermission(id, third.requestId, 'refuse');
    expect(await manager.checksProposalState(third.requestId, 500)).toEqual({ state: 'refused' });
    expect(readVerifyFor().checks).toEqual([{ name: 'Lint', command: 'npm run lint' }]);
  });

  it('does not ask when the chat has "Approve for me" or "Full access": the checks are saved at once and the card shows it was answered', async () => {
    setup(fakeDriver('usage'));
    const { id } = await manager.createSession(projectId, 'fake');
    await manager.setConfig(id, 'approval', 'full');
    const { requestId } = await manager.proposeChecks(id, { checks: [{ name: 'Test', command: 'npm test' }], mode: 'add' });
    expect(await manager.checksProposalState(requestId, 500)).toEqual({ state: 'approved' });
    expect(readVerifyFor().checks).toEqual([{ name: 'Test', command: 'npm test' }]);
    const events = store.eventsSince(id, 0).map((e) => e.event);
    expect(events.some((e) => e.type === 'permission_request' && e.requestId === requestId)).toBe(true);
    expect(events.some((e) => e.type === 'permission_resolved' && e.requestId === requestId && e.outcome === 'selected')).toBe(true);

    await manager.setConfig(id, 'approval', 'auto');
    const second = await manager.proposeChecks(id, { checks: [{ name: 'Lint', command: 'npm run lint' }], mode: 'add' });
    expect(await manager.checksProposalState(second.requestId, 500)).toEqual({ state: 'approved' });
    expect(readVerifyFor().checks.map((c) => c.name)).toEqual(['Test', 'Lint']);

    await manager.setConfig(id, 'approval', 'ask');
    const third = await manager.proposeChecks(id, { checks: [{ name: 'Types', command: 'tsc' }], mode: 'add' });
    expect(await manager.checksProposalState(third.requestId, 0)).toEqual({ state: 'pending' });
  });

  it('remembers that the project was asked, whatever the answer, and a malformed proposal does not count', async () => {
    setup(fakeDriver('usage'));
    const { id } = await manager.createSession(projectId, 'fake');
    await rejection(manager.proposeChecks(id, { checks: [{ name: '', command: 'x' }], mode: 'add' }));
    expect(store.getSetting(`verify-asked:${projectId}`)).toBeNull();
    const { requestId } = await manager.proposeChecks(id, { checks: [{ name: 'Test', command: 'npm test' }], mode: 'add' });
    expect(store.getSetting(`verify-asked:${projectId}`)).toBe('1');
    manager.respondPermission(id, requestId, 'refuse');
    await manager.checksProposalState(requestId, 500);
    expect(store.getSetting(`verify-asked:${projectId}`)).toBe('1');
  });

  it('refuses a malformed proposal and treats a cancelled turn as a refusal', async () => {
    setup(fakeDriver('usage'));
    const { id } = await manager.createSession(projectId, 'fake');
    expect((await rejection(manager.proposeChecks(id, { checks: [{ name: '', command: 'x' }], mode: 'add' }))).code).toBe('bad_request');
    expect((await rejection(manager.proposeChecks(id, { checks: Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, command: 'true' })), mode: 'add' }))).code).toBe('bad_request');
    expect((await rejection(manager.proposeChecks('nope', { checks: [{ name: 'a', command: 'b' }], mode: 'add' }))).code).toBe('not_found');
    const { requestId } = await manager.proposeChecks(id, { checks: [{ name: 'Test', command: 'npm test' }], mode: 'add' });
    manager.respondPermission(id, requestId, null);
    expect(await manager.checksProposalState(requestId, 500)).toEqual({ state: 'refused' });
    expect(readVerifyFor().checks).toEqual([]);
  });

  it('starts a chat that asks an agent to work the checks out', async () => {
    setup(fakeDriver('usage'));
    const row = await manager.askAgentForChecks(projectId, 'fake', 'Work out the checks for this project and propose them.');
    expect(store.getSession(row.id)?.title).toBe('🛡 Checks');
    await vi.waitFor(() => expect(types(row.id)).toContain('user_message'));
  });
});

const readVerifyFor = () => readVerify(store, projectId);
const verificationEvents = (id: string) => store.eventsSince(id, 0).filter((e) => e.event.type === 'verification');
