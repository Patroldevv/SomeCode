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
});
