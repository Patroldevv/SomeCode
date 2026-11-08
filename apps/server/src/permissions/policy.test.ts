import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { planModeApproval } from './policy.ts';

const req = (toolCall: Record<string, unknown>): RequestPermissionRequest =>
  ({
    sessionId: 's',
    toolCall: { toolCallId: 't', ...toolCall },
    options: [
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
      { optionId: 'once', name: 'Once', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
  }) as RequestPermissionRequest;

describe('planModeApproval', () => {
  it('approves reads, searches and read-only commands once, in plan mode only', () => {
    expect(planModeApproval('plan', req({ kind: 'read', title: 'Read x' }))).toBe('once');
    expect(planModeApproval('plan', req({ kind: 'search', title: 'grep' }))).toBe('once');
    expect(planModeApproval('plan', req({ kind: 'execute', title: 'ls -la workspace/project' }))).toBe('once');
    expect(planModeApproval('plan', req({ kind: 'execute', title: 'bash', rawInput: { command: 'git -C /p status' } }))).toBe('once');
    expect(planModeApproval('default', req({ kind: 'execute', title: 'ls -la' }))).toBeNull();
    expect(planModeApproval(null, req({ kind: 'read', title: 'x' }))).toBeNull();
  });

  it('still asks for anything that changes something', () => {
    expect(planModeApproval('plan', req({ kind: 'execute', title: 'rm -rf build' }))).toBeNull();
    expect(planModeApproval('plan', req({ kind: 'execute', title: 'bash', rawInput: { command: 'ls; rm x' } }))).toBeNull();
    expect(planModeApproval('plan', req({ kind: 'edit', title: 'Edit a.ts' }))).toBeNull();
    expect(planModeApproval('plan', req({ kind: 'switch_mode', title: 'Ready to code?' }))).toBeNull();
    expect(planModeApproval('plan', req({ kind: 'fetch', title: 'https://example.com' }))).toBeNull();
  });
});
