#!/usr/bin/env node
// Handshake check: starts an agent, runs initialize + session/new, prints what it announced, closes it.
// It never sends a prompt, so it uses no model quota.
//
//   node scripts/handshake.ts <agentId> [projectDir]      (agentId: claude | opencode | agy)
//
// Exit code 0 on success, 1 on a failed handshake (2 when the agent needs a sign-in), 2 on a usage error.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultRegistry } from '../apps/server/src/agents/registry.ts';
import { runHandshake } from '../apps/server/src/launcher/handshake.ts';

const registry = defaultRegistry();
const [agentId, dir = process.cwd()] = process.argv.slice(2);
const usage = `usage: node scripts/handshake.ts <agentId> [projectDir]  (agents: ${registry.list().map((d) => d.id).join(', ')})\n`;

if (!agentId) {
  process.stderr.write(usage);
  process.exit(2);
}
const driver = registry.get(agentId);
if (!driver) {
  process.stderr.write(`handshake: unknown agent "${agentId}"\n${usage}`);
  process.exit(2);
}
const cwd = resolve(dir);
if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write(`handshake: not a directory: ${cwd}\n`);
  process.exit(2);
}

const status = await driver.detect();
console.log(`agent: ${driver.label} (${driver.id}) installed=${status.installed} version=${status.version ?? '-'} auth=${status.auth ?? '-'}`);
if (!status.installed) {
  console.log(`not installed${status.installHint ? `; install with: ${status.installHint}` : ''}`);
  process.exit(1);
}

const result = await runHandshake(driver, cwd);
if (!result.ok) {
  console.log(`handshake FAILED: ${result.error?.code} — ${result.error?.message}`);
  if (result.error?.code === 'auth_required' && status.signInHint) console.log(`sign in with: ${status.signInHint}`);
  process.exit(result.error?.code === 'auth_required' ? 2 : 1);
}
console.log(`announced: ${result.agentInfo?.name ?? '?'} ${result.agentInfo?.version ?? ''}`.trimEnd());
console.log(`loadSession: ${result.loadSession}`);
console.log(`sign-in methods: ${result.authMethods?.map((m) => `${m.id} (${m.name})`).join(', ') || 'none announced'}`);
for (const o of result.options ?? []) {
  const shown = o.choices.slice(0, 8).map((c) => c.value);
  console.log(`option ${o.id}${o.category ? ` [${o.category}]` : ''}: current=${o.currentValue} choices=${shown.join(', ')}${o.choices.length > 8 ? `, … (${o.choices.length} total)` : ''}`);
}
console.log('handshake OK (no prompt was sent)');
