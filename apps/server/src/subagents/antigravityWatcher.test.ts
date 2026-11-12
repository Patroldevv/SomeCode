import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '@somecode/protocol';
import { AntigravitySubagentWatcher } from './antigravityWatcher.ts';

describe('AntigravitySubagentWatcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-watcher-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('watches subagent transcript and emits child tool calls and completion', async () => {
    const convId = 'test-subagent-1234';
    const convDir = path.join(tmpDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(convDir, { recursive: true });
    const transcript = path.join(convDir, 'transcript.jsonl');

    // Initial system step
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        step_index: 0,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        content: 'System prompt sender=parent-acp-session-1',
      }) + '\n',
    );

    const events: NormalizedEvent[] = [];
    const watcher = new AntigravitySubagentWatcher(
      {
        sessionId: 'session-1',
        parentToolCallId: 'call_parent_invoke_1',
        role: 'Database Researcher',
        acpSessionId: 'parent-acp-session-1',
        conversationId: convId,
        startedAt: Date.now(),
      },
      (ev) => events.push(ev),
      { brainDirs: [tmpDir], pollIntervalMs: 20 },
    );

    watcher.start();

    // Append a tool call step
    fs.appendFileSync(
      transcript,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [
          {
            name: 'read_file',
            args: { Path: '"/workspace/src/db.ts"' },
          },
        ],
      }) + '\n',
    );

    // Wait for poll
    await new Promise((r) => setTimeout(r, 60));

    expect(events.some((e) => e.type === 'tool_call' && e.parent?.id === 'call_parent_invoke_1')).toBe(true);
    const toolCall = events.find((e) => e.type === 'tool_call' && e.parent?.id === 'call_parent_invoke_1') as Extract<NormalizedEvent, { type: 'tool_call' }>;
    expect(toolCall.title).toBe('read_file db.ts');
    expect(toolCall.kind).toBe('read');

    // Append tool completion step and send_message
    fs.appendFileSync(
      transcript,
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'DONE',
        content: 'File content of db.ts',
      }) + '\n',
    );
    fs.appendFileSync(
      transcript,
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [
          {
            name: 'send_message',
            args: { Message: 'Found SQLite configuration in db.ts' },
          },
        ],
      }) + '\n',
    );
    fs.appendFileSync(
      transcript,
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'DONE',
        content: 'Message sent successfully',
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));

    // Check parent tool call completion
    const parentUpdate = events.find(
      (e) => e.type === 'tool_call_update' && e.id === 'call_parent_invoke_1',
    ) as Extract<NormalizedEvent, { type: 'tool_call_update' }>;

    expect(parentUpdate).toBeDefined();
    expect(parentUpdate.patch.status).toBe('completed');
    expect(parentUpdate.patch.rawOutput).toBe('Found SQLite configuration in db.ts');

    watcher.stop();
  });

  it('follows a run found by a phrase in its first message, shows its tool calls under the parent and leaves the parent\'s status alone', async () => {
    const dir = path.join(tmpDir, 'scout-conv', '.system_generated', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: '<USER_REQUEST>\n/plan You are a fast Scout Subagent (powered by Gemini)\nTask: x' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'read_file', args: { Path: '/a/b.ts' } }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'file contents' },
      { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'The summary.' },
    ];
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const events: NormalizedEvent[] = [];
    const watcher = new AntigravitySubagentWatcher(
      { sessionId: 's', parentToolCallId: 'bash-1', role: 'Gemini Scout', startedAt: Date.now() - 1000, headMarker: 'You are a fast Scout Subagent', completeParent: false },
      (e) => events.push(e),
      { brainDirs: [tmpDir], pollIntervalMs: 20 },
    );
    watcher.start();
    await new Promise((r) => setTimeout(r, 200));
    watcher.stop();
    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({ type: 'tool_call', title: 'read_file b.ts', parent: { id: 'bash-1', title: 'Gemini Scout' } });
    expect(events.some((e) => e.type === 'tool_call_update' && e.id === 'bash-1')).toBe(false);
  });

  it('does not take a conversation whose first message lacks the phrase', async () => {
    const dir = path.join(tmpDir, 'other', '.system_generated', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'something else' }) + '\n');
    const events: NormalizedEvent[] = [];
    const watcher = new AntigravitySubagentWatcher(
      { sessionId: 's', parentToolCallId: 'b', role: 'Gemini Scout', startedAt: Date.now() - 1000, headMarker: 'You are a fast Scout Subagent', completeParent: false },
      (e) => events.push(e),
      { brainDirs: [tmpDir], pollIntervalMs: 20 },
    );
    watcher.start();
    await new Promise((r) => setTimeout(r, 120));
    watcher.stop();
    expect(events).toEqual([]);
  });

  it('marks the parent call completed with the answer once a scout answers without calling more tools, not before', async () => {
    const dir = path.join(tmpDir, 'scout-conv2', '.system_generated', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'transcript.jsonl');
    const write = (lines: object[]) => fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const head = { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: 'You are a fast Scout Subagent' };
    const working = { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'Let me look.', tool_calls: [{ name: 'read_file', args: { Path: '/a.ts' } }] };
    write([head, working]);
    const events: NormalizedEvent[] = [];
    const watcher = new AntigravitySubagentWatcher(
      { sessionId: 's', parentToolCallId: 'bash-2', role: 'Gemini Scout', startedAt: Date.now() - 1000, headMarker: 'You are a fast Scout Subagent' },
      (e) => events.push(e),
      { brainDirs: [tmpDir], pollIntervalMs: 20 },
    );
    watcher.start();
    await new Promise((r) => setTimeout(r, 120));
    expect(events.some((e) => e.type === 'tool_call_update' && e.id === 'bash-2')).toBe(false);
    write([head, working, { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'file' }, { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'The report.' }]);
    await new Promise((r) => setTimeout(r, 150));
    watcher.stop();
    expect(events.find((e) => e.type === 'tool_call_update' && e.id === 'bash-2')).toMatchObject({ patch: { status: 'completed', rawOutput: 'The report.' } });
  });

  it('marks the parent call failed when a scout goes silent for too long without answering', async () => {
    const dir = path.join(tmpDir, 'scout-conv3', '.system_generated', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), JSON.stringify({ step_index: 0, type: 'USER_INPUT', status: 'DONE', content: 'You are a fast Scout Subagent' }) + '\n');
    const events: NormalizedEvent[] = [];
    const watcher = new AntigravitySubagentWatcher(
      { sessionId: 's', parentToolCallId: 'bash-3', role: 'Gemini Scout', startedAt: Date.now() - 1000, headMarker: 'You are a fast Scout Subagent', idleTimeoutMs: 80 },
      (e) => events.push(e),
      { brainDirs: [tmpDir], pollIntervalMs: 20 },
    );
    watcher.start();
    await new Promise((r) => setTimeout(r, 300));
    watcher.stop();
    expect(events.find((e) => e.type === 'tool_call_update' && e.id === 'bash-3')).toMatchObject({ patch: { status: 'failed' } });
  });
});
