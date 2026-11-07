import type {
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { normalizeConfigOptions, normalizePermission, normalizeUpdate } from './normalize.ts';

describe('normalizeUpdate', () => {
  it('maps agent_thought_chunk text to agent_thought', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'hmm' },
    };
    expect(normalizeUpdate(update)).toEqual({ type: 'agent_thought', text: 'hmm' });
  });

  it('maps agent_message_chunk to agent_message', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    };
    expect(normalizeUpdate(update)).toEqual({ type: 'agent_message', text: 'hello' });
  });

  it('maps user_message_chunk to user_message', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'hi' },
    };
    expect(normalizeUpdate(update)).toEqual({ type: 'user_message', text: 'hi' });
  });

  it('maps a tool_call with a diff', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Edit a.ts',
      kind: 'edit',
      status: 'in_progress',
      content: [{ type: 'diff', path: '/a.ts', oldText: null, newText: 'x' }],
      rawInput: { path: '/a.ts' },
    };
    expect(normalizeUpdate(update)).toEqual({
      type: 'tool_call',
      id: 't1',
      title: 'Edit a.ts',
      kind: 'edit',
      status: 'in_progress',
      content: [{ type: 'diff', path: '/a.ts', oldText: null, newText: 'x' }],
      rawInput: { path: '/a.ts' },
    });
  });

  it('defaults tool_call status to pending and kind to other', () => {
    const update: SessionUpdate = { sessionUpdate: 'tool_call', toolCallId: 't2', title: 'x' };
    expect(normalizeUpdate(update)).toMatchObject({
      type: 'tool_call',
      id: 't2',
      kind: 'other',
      status: 'pending',
      content: [],
    });
  });

  it('falls back to other/pending for unknown tool_call kind/status', () => {
    const update = {
      sessionUpdate: 'tool_call',
      toolCallId: 't3',
      title: 'x',
      kind: 'teleport',
      status: 'weird',
    } as unknown as SessionUpdate;
    expect(normalizeUpdate(update)).toMatchObject({ kind: 'other', status: 'pending' });
  });

  it('maps tool_call terminal and non-text content', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 't4',
      title: 'run',
      content: [
        { type: 'terminal', terminalId: 'term1' },
        { type: 'content', content: { type: 'text', text: 'out' } },
        { type: 'content', content: { type: 'image', data: 'AA==', mimeType: 'image/png' } },
      ],
    };
    expect(normalizeUpdate(update)).toMatchObject({
      content: [
        { type: 'terminal', terminalId: 'term1' },
        { type: 'text', text: 'out' },
        { type: 'text', text: '[image]' },
      ],
    });
  });

  it('puts only provided fields in the tool_call_update patch', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      title: null,
      kind: null,
      content: null,
    };
    expect(normalizeUpdate(update)).toEqual({
      type: 'tool_call_update',
      id: 't1',
      patch: { status: 'completed' },
    });
  });

  it('normalizes content and omits unknown kind/status in tool_call_update patch', () => {
    const update = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      kind: 'bogus',
      status: 'bogus',
      title: 'New title',
      content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
    } as unknown as SessionUpdate;
    expect(normalizeUpdate(update)).toEqual({
      type: 'tool_call_update',
      id: 't1',
      patch: { title: 'New title', content: [{ type: 'text', text: 'done' }] },
    });
  });

  it('passes plan entries through', () => {
    const entries = [
      { content: 'do it', status: 'pending', priority: 'high' },
      { content: 'then this', status: 'completed', priority: 'low' },
    ] as const;
    const update: SessionUpdate = { sessionUpdate: 'plan', entries: [...entries] };
    expect(normalizeUpdate(update)).toEqual({ type: 'plan', entries });
  });

  it('degrades non-text content blocks to a neutral placeholder', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'AA==', mimeType: 'image/png' },
    };
    expect(normalizeUpdate(update)).toEqual({ type: 'agent_message', text: '[image]' });
  });

  it('never drops unknown update kinds', () => {
    const update = { sessionUpdate: 'brand_new_thing', x: 1 } as unknown as SessionUpdate;
    expect(normalizeUpdate(update)).toEqual({
      type: 'unsupported',
      sessionUpdate: 'brand_new_thing',
      raw: { sessionUpdate: 'brand_new_thing', x: 1 },
    });
  });

  it('keeps known-but-unmodeled updates visible as unsupported', () => {
    const update = {
      sessionUpdate: 'config_option_update',
      configOptions: [],
    } as unknown as SessionUpdate;
    expect(normalizeUpdate(update)).toMatchObject({
      type: 'unsupported',
      sessionUpdate: 'config_option_update',
    });
  });

  it.each(['usage_update', 'session_info_update', 'available_commands_update', 'current_mode_update'])(
    'ignores %s',
    (tag) => {
      expect(normalizeUpdate({ sessionUpdate: tag } as unknown as SessionUpdate)).toBeNull();
    },
  );
});

describe('normalizePermission', () => {
  const req: RequestPermissionRequest = {
    sessionId: 's1',
    toolCall: { toolCallId: 'tc1', title: 'Run rm -rf' },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
    ],
  };

  it('maps options and tool call info', () => {
    expect(normalizePermission('r1', req)).toEqual({
      type: 'permission_request',
      requestId: 'r1',
      toolCallId: 'tc1',
      title: 'Run rm -rf',
      options: [
        { id: 'allow', name: 'Allow once', kind: 'allow_once' },
        { id: 'deny', name: 'Reject', kind: 'reject_once' },
      ],
    });
  });

  it('falls back to the toolCallId when the title is absent', () => {
    const noTitle: RequestPermissionRequest = { ...req, toolCall: { toolCallId: 'tc9' } };
    expect(normalizePermission('r2', noTitle)).toMatchObject({ toolCallId: 'tc9', title: 'tc9' });
  });
});

describe('normalizeConfigOptions', () => {
  it('wraps options into a config_options event', () => {
    const options = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'a',
        options: [{ value: 'a', name: 'A' }],
      },
    ] as unknown as SessionConfigOption[];
    expect(normalizeConfigOptions(options)).toEqual({ type: 'config_options', options });
  });
});
