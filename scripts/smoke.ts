#!/usr/bin/env node
// Scripted smoke client: one prompt against a running SomeCode server.
//
//   SOMECODE_URL=http://127.0.0.1:PORT SOMECODE_TOKEN=... \
//     node scripts/smoke.ts <agentId> <projectDir> "<prompt text>"
//
// `--url` / `--token` flags override the environment. Exit code 0 when the turn ends, 1 on a
// failed turn (turn_end with an error), a disconnect, an error or a timeout (SMOKE_TIMEOUT_MS, default 120000), 2 on a usage error.
import { parseArgs } from 'node:util';
import type { StoredEvent } from '@somecode/protocol';
import { DEFAULT_TIMEOUT_MS, runSmoke } from '../apps/server/src/launcher/smoke.ts';

const USAGE =
  'usage: SOMECODE_URL=<url> SOMECODE_TOKEN=<token> node scripts/smoke.ts <agentId> <projectDir> "<prompt>"\n' +
  '       (or pass --url <url> --token <token>; SMOKE_TIMEOUT_MS sets the timeout, default 120000)\n';

function usageError(message: string): never {
  process.stderr.write(`smoke: ${message}\n${USAGE}`);
  process.exit(2);
}

function oneLine(text: string, max: number): string {
  const flat = JSON.stringify(text);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function describe(stored: StoredEvent): string {
  const e = stored.event;
  let detail: string;
  switch (e.type) {
    case 'user_message':
    case 'agent_message':
    case 'agent_thought':
      detail = oneLine(e.text, 160);
      break;
    case 'turn_end':
      detail = `stopReason=${e.stopReason}`;
      if (e.error) detail += ` error=${e.error.code} ${oneLine(e.error.message, 300)}`;
      break;
    case 'status':
      detail = e.reason === undefined ? e.status : `${e.status} reason=${oneLine(e.reason, 300)}`;
      break;
    default:
      detail = oneLine(JSON.stringify(e), 200);
  }
  return `#${stored.seq} ${e.type} ${detail}`;
}

let parsed: { values: { url?: string; token?: string }; positionals: string[] };
try {
  parsed = parseArgs({
    options: { url: { type: 'string' }, token: { type: 'string' } },
    allowPositionals: true,
  });
} catch (err) {
  usageError(err instanceof Error ? err.message : String(err));
}

const [agentId, projectDir, prompt, ...extra] = parsed.positionals;
if (agentId === undefined || projectDir === undefined || prompt === undefined) {
  usageError('expected <agentId> <projectDir> "<prompt>"');
}
if (extra.length > 0) usageError('too many arguments (quote the prompt)');
const url = parsed.values.url ?? process.env.SOMECODE_URL;
const token = parsed.values.token ?? process.env.SOMECODE_TOKEN;
if (!url || !token) usageError('SOMECODE_URL and SOMECODE_TOKEN (or --url and --token) are required');

const rawTimeout = process.env.SMOKE_TIMEOUT_MS;
const timeoutMs = rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) usageError('SMOKE_TIMEOUT_MS must be a positive integer');

const result = await runSmoke({
  url,
  token,
  agentId,
  projectDir,
  prompt,
  timeoutMs,
  onEvent: (stored) => process.stdout.write(`${describe(stored)}\n`),
});

if (result.ok) {
  process.stdout.write(`smoke: ok stopReason=${result.stopReason}\n`);
  process.exit(0);
}
process.stderr.write(`smoke: FAILED ${result.reason ?? 'unknown'}\n`);
process.exit(1);
