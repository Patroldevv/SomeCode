import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { ConfigOption } from '@somecode/protocol';
import { describe, expect, it } from 'vitest';
import { approvalDecision, plainModeFor, trimModeOption } from './approval.ts';

const req = (toolCall: Record<string, unknown>, only?: 'once'): RequestPermissionRequest =>
  ({
    sessionId: 's',
    toolCall: { toolCallId: 't', ...toolCall },
    options: [
      ...(only === 'once' ? [] : [{ optionId: 'always', name: 'Always', kind: 'allow_always' }]),
      { optionId: 'once', name: 'Once', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
  }) as RequestPermissionRequest;
const ctx = (level: 'ask' | 'auto' | 'full', mode: string | null = 'default', planAuto = true) => ({ level, mode, planAuto, cwd: '/home/u/project' });

describe('approvalDecision', () => {
  it('full access allows everything once, except leaving plan mode', () => {
    expect(approvalDecision(ctx('full'), req({ kind: 'execute', title: 'rm -rf x' }))).toBe('once');
    expect(approvalDecision(ctx('full'), req({ kind: 'fetch', title: 'GET' }))).toBe('once');
    expect(approvalDecision(ctx('full'), req({ kind: 'switch_mode', title: 'Ready to code?' }))).toBeNull();
  });

  it('"approve for me" allows reads, read-only commands and edits inside the project, and asks about the rest', () => {
    expect(approvalDecision(ctx('auto'), req({ kind: 'read', title: 'Read' }))).toBe('once');
    expect(approvalDecision(ctx('auto'), req({ kind: 'execute', title: 'git status' }))).toBe('once');
    expect(approvalDecision(ctx('auto'), req({ kind: 'edit', title: 'Edit', locations: [{ path: '/home/u/project/src/a.ts' }] }))).toBe('once');
    expect(approvalDecision(ctx('auto'), req({ kind: 'edit', title: 'Edit', rawInput: { filePath: 'src/a.ts' } }))).toBe('once');
    expect(approvalDecision(ctx('auto'), req({ kind: 'edit', title: 'Edit', locations: [{ path: '/etc/passwd' }] }))).toBeNull();
    expect(approvalDecision(ctx('auto'), req({ kind: 'edit', title: 'Edit', rawInput: { filePath: '../outside.ts' } }))).toBeNull();
    expect(approvalDecision(ctx('auto'), req({ kind: 'edit', title: 'Edit' }))).toBeNull();
    expect(approvalDecision(ctx('auto'), req({ kind: 'execute', title: 'npm install' }))).toBeNull();
    expect(approvalDecision(ctx('auto'), req({ kind: 'delete', title: 'rm' }))).toBeNull();
    expect(approvalDecision(ctx('auto'), req({ kind: 'fetch', title: 'websearch' }))).toBe('once');
  });

  it('"ask" asks about everything, except that plan mode may look around (when allowed)', () => {
    expect(approvalDecision(ctx('ask'), req({ kind: 'read', title: 'Read' }))).toBeNull();
    expect(approvalDecision(ctx('ask', 'plan'), req({ kind: 'execute', title: 'ls -la' }))).toBe('once');
    expect(approvalDecision(ctx('ask', 'plan', false), req({ kind: 'execute', title: 'ls -la' }))).toBeNull();
  });

  it('never decides when the agent offers no one-time allow', () => {
    expect(approvalDecision(ctx('full'), { ...req({ kind: 'read' }), options: [{ optionId: 'no', name: 'No', kind: 'reject_once' }] } as RequestPermissionRequest)).toBeNull();
  });
});

describe('modes', () => {
  const mode = (current: string, values: string[]): ConfigOption => ({ id: 'mode', name: 'Mode', category: 'mode', currentValue: current, choices: values.map((value) => ({ value, name: value })) });

  it('drops the self-approving modes from the choices and leaves other options alone', () => {
    expect(trimModeOption(mode('default', ['default', 'accept-edits', 'plan', 'bypassPermissions', 'auto'])).choices.map((c) => c.value)).toEqual(['default', 'plan']);
    const model: ConfigOption = { id: 'model', name: 'Model', currentValue: 'auto', choices: [{ value: 'auto', name: 'Auto' }] };
    expect(trimModeOption(model)).toBe(model);
  });

  it('moves a session out of a permissive mode into the plain default', () => {
    expect(plainModeFor(mode('auto', ['default', 'acceptEdits', 'plan', 'auto']))).toBe('default');
    expect(plainModeFor(mode('accept-edits', ['build', 'accept-edits', 'plan']))).toBe('build');
    expect(plainModeFor(mode('plan', ['default', 'plan']))).toBeNull();
    expect(plainModeFor({ id: 'model', name: 'Model', currentValue: 'auto', choices: [] })).toBeNull();
  });
});
