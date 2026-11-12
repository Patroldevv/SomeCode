#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runScout } from '../apps/server/src/scout/runner.ts';

const USAGE = 'usage: somecode-scout <task> [--files <file1,file2,...>] [--path <dir>] [--model <model>] [--timeout <ms>]\n';

async function main() {
  if (process.env.SOMECODE_INSIDE_SUBAGENT === '1') {
    process.stderr.write('somecode-scout: error: recursive subagent invocation is disabled (cannot invoke scout from within a subagent)\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        path: { type: 'string' },
        model: { type: 'string' },
        timeout: { type: 'string' },
        files: { type: 'string', short: 'f' },
        help: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: false,
    });
  } catch (err) {
    process.stderr.write(USAGE);
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  if (parsed.values.help || (parsed.positionals.length === 0 && !parsed.values.path)) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const task = parsed.positionals.join(' ').trim();
  if (!task) {
    process.stderr.write('somecode-scout: task description cannot be empty\n');
    process.exit(2);
  }

  const cwd = typeof parsed.values.path === 'string' ? parsed.values.path : process.cwd();
  const model = typeof parsed.values.model === 'string' ? parsed.values.model : undefined;
  const timeoutMs = typeof parsed.values.timeout === 'string' ? Number(parsed.values.timeout) : undefined;
  const files = typeof parsed.values.files === 'string'
    ? parsed.values.files.split(',').map((f: string) => f.trim()).filter(Boolean)
    : undefined;

  // If SOMECODE_URL and SOMECODE_TOKEN are set, call the running server API
  const serverUrl = process.env.SOMECODE_URL;
  const serverToken = process.env.SOMECODE_TOKEN;

  if (serverUrl && serverToken) {
    try {
      const res = await fetch(`${serverUrl}/api/scout`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${serverToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ task, cwd, model, timeoutMs, files }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; output: string; error?: string };
        if (data.ok) {
          process.stdout.write(`${data.output}\n`);
          process.exit(0);
        } else {
          process.stderr.write(`somecode-scout: ${data.error || 'Scout task failed'}\n`);
          process.exit(1);
        }
      } else {
        const errData = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
        const msg = typeof errData.error === 'object' ? errData.error?.message : errData.error;
        process.stderr.write(`somecode-scout: ${msg || `Server returned error HTTP ${res.status}`}\n`);
        process.exit(1);
      }
    } catch {
      // Fall through to direct runner if API connection fails (server offline or unreachable)
    }
  }

  // Direct invocation via scout runner
  const result = await runScout({ task, cwd, model, timeoutMs, files });
  if (result.ok) {
    process.stdout.write(`${result.output}\n`);
    process.exit(0);
  } else {
    process.stderr.write(`somecode-scout: ${result.error || 'Scout task failed'}\n`);
    process.exit(1);
  }
}

void main();
