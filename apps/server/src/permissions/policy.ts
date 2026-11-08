import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { isReadOnlyCommand } from './readOnly.ts';

/**
 * Plan mode is meant for reading: while the session is in it, requests to read, search or run a plainly read-only
 * command are approved (once) without bothering the user. Returns the option to select, or null to ask as usual.
 * Never applies outside plan mode, and never to edits, deletes, network calls, mode switches or unknown commands.
 */
export function planModeApproval(mode: string | null, req: RequestPermissionRequest): string | null {
  if (mode === null || mode.toLowerCase() !== 'plan') return null;
  return isReadOnlyRequest(req) ? allowOnce(req) : null;
}

/** The option that allows this one request (not the always-allow rule), or null when the agent offers none. */
export function allowOnce(req: RequestPermissionRequest): string | null {
  return req.options.find((o) => o.kind === 'allow_once')?.optionId ?? null;
}

/** A request to read, search or run a plainly read-only command. */
export function isReadOnlyRequest(req: RequestPermissionRequest): boolean {
  const call = req.toolCall;
  if (call.kind === 'read' || call.kind === 'search') return true;
  if (call.kind !== 'execute') return false;
  const input = call.rawInput;
  const fromInput = typeof input === 'object' && input !== null ? (input as { command?: unknown }).command : undefined;
  return isReadOnlyCommand(typeof fromInput === 'string' ? fromInput : (call.title ?? ''));
}
