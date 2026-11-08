import { isAbsolute, resolve, sep } from 'node:path';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { ConfigOption } from '@somecode/protocol';
import { allowOnce, isReadOnlyRequest, planModeApproval } from './policy.ts';

/** How much the user lets the agent do without asking, like the access menu of the chat apps. */
export type ApprovalLevel = 'ask' | 'auto' | 'full';
export const APPROVAL_LEVELS: readonly ApprovalLevel[] = ['ask', 'auto', 'full'];

export const parseApproval = (value: unknown): ApprovalLevel | null => (APPROVAL_LEVELS.includes(value as ApprovalLevel) ? (value as ApprovalLevel) : null);

/** The session's access level as a select option, so it travels the same way as model and effort. */
export function approvalOption(level: ApprovalLevel): ConfigOption {
  return {
    id: 'approval',
    name: 'Permissions',
    category: 'approval',
    currentValue: level,
    choices: [
      { value: 'ask', name: 'Ask for approval', description: 'Always ask before running commands or editing files' },
      { value: 'auto', name: 'Approve for me', description: 'Only ask about actions that may be unsafe' },
      { value: 'full', name: 'Full access', description: 'Unrestricted access to the internet and all files on your computer' },
    ],
  };
}

/**
 * Modes that decide on their own what needs approval ("accept edits", "bypass permissions", "auto"): the access
 * level above replaces them, so they are not offered and a session never starts in one.
 */
const PERMISSIVE_MODE = /accept|bypass|auto|dont[-_ ]?ask|yolo|full|unrestricted/i;
export const isPermissiveMode = (c: { value: string; name: string }): boolean => PERMISSIVE_MODE.test(c.value) || PERMISSIVE_MODE.test(c.name);

/** The option without its permissive modes (everything else untouched). */
export function trimModeOption(o: ConfigOption): ConfigOption {
  if (o.id !== 'mode' && o.category !== 'mode') return o;
  return { ...o, choices: o.choices.filter((c) => !isPermissiveMode(c)) };
}

/** The mode to move a session out of a permissive one into: the plain default, if the agent has one. */
export function plainModeFor(o: ConfigOption): string | null {
  if (o.id !== 'mode' && o.category !== 'mode') return null;
  const current = o.choices.find((c) => c.value === o.currentValue) ?? { value: o.currentValue, name: o.currentValue };
  if (!isPermissiveMode(current)) return null;
  return (o.choices.find((c) => /^(default|build|code|normal)$/i.test(c.value) && !isPermissiveMode(c)) ?? o.choices.find((c) => !isPermissiveMode(c)))?.value ?? null;
}

function paths(req: RequestPermissionRequest): string[] | null {
  const call = req.toolCall;
  const located = (call.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === 'string');
  if (located.length > 0) return located;
  const input = call.rawInput;
  if (typeof input === 'object' && input !== null) {
    for (const key of ['filePath', 'file_path', 'path', 'file']) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') return [value];
    }
  }
  return null;
}

const inside = (cwd: string, p: string): boolean => {
  const target = resolve(cwd, p);
  const root = resolve(cwd);
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
};

/**
 * Decides a permission request without asking, or returns null to ask the user:
 *  - full access: everything is allowed (once) except leaving plan mode, which is always the user's call;
 *  - approve for me: reads, searches, web lookups, read-only commands and edits inside the project; anything else asks;
 *  - ask: nothing, except that plan mode may still look around when `planAuto` is on.
 */
export function approvalDecision(ctx: { level: ApprovalLevel; mode: string | null; planAuto: boolean; cwd: string }, req: RequestPermissionRequest): string | null {
  if (req.toolCall.kind === 'switch_mode') return null;
  const once = allowOnce(req);
  if (once === null) return null;
  if (ctx.level === 'full') return once;
  if (ctx.level === 'auto') {
    if (isReadOnlyRequest(req)) return once;
    // Looking something up on the web (search, fetching a page) is reading, so it does not need asking either.
    if (req.toolCall.kind === 'fetch') return once;
    if (req.toolCall.kind === 'edit') {
      const where = paths(req);
      return where !== null && where.every((p) => (isAbsolute(p) ? inside(ctx.cwd, p) : !p.split(/[\\/]/).includes('..'))) ? once : null;
    }
    return null;
  }
  return ctx.planAuto ? planModeApproval(ctx.mode, req) : null;
}
