import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOUT_SKILL_CONTENT = `---
name: scout
description: Fast Scout Subagent powered by Gemini 3.8 Flash. ALWAYS invoke this subagent proactively on your own initiative whenever you need to read multiple files, explore codebase architecture, locate functions or schemas, or analyze logs before answering or editing. Do not wait for the user to ask for scouting.
---
# Scout Subagent (Gemini 3.8 Flash)

You are equipped with an ultra-fast Scout Subagent running Gemini 3.8 Flash (1M+ token context window).

## Subagent Role & Proactive Delegation
You MUST proactively delegate reading and codebase reconnaissance to this subagent without waiting for explicit user instructions whenever:
- You need to read, analyze or compare multiple files (e.g. 2 to 20+ files).
- You need to search for keywords, imports, functions, or schemas across modules.
- You need to understand codebase architecture or locate relevant modules.
- You need to inspect large log dumps or configurations.

Scout first with \`somecode-scout\`, read the concise factual summary, and then solve the task.

## Execution Command
Run via your Bash execution tool:
\`\`\`bash
somecode-scout "<task or question>" [--files "<file1,file2,...>"] [--path <dir>] [--timeout <ms>]
\`\`\`

Examples:
- \`somecode-scout "Modül analizini yap ve özetle" --files "src/client/LexnayClient.ts,src/client/sweepers.ts"\`
- \`somecode-scout "Tüm shard ve config yapısını incele" --files "src/shard.ts,src/config.ts,src/index.ts"\`
- \`somecode-scout "Find where user auth tokens are verified and list relevant files"\`

## Rules
- The scout subagent operates in safe read-only plan mode with extreme speed.
- It returns structured factual summaries with exact file:line references directly to your tool output.
- You can specify exact files with \`--files\` so Gemini inspects them in depth in one pass.
`;

/**
 * Ensures that the `somecode-scout` launcher is placed into `~/.local/bin/somecode-scout`.
 */
export async function ensureScoutBin(home: string = homedir()): Promise<string> {
  const binDir = join(home, '.local', 'bin');
  await mkdir(binDir, { recursive: true });
  const binPath = join(binDir, 'somecode-scout');
  const targetTs = fileURLToPath(new URL('../../../../bin/somecode-scout.ts', import.meta.url));
  const scriptContent = `#!/bin/sh\nexec node "${targetTs}" "$@"\n`;
  await writeFile(binPath, scriptContent, { mode: 0o755 });
  await chmod(binPath, 0o755).catch(() => {});
  if (process.env.PATH && !process.env.PATH.split(delimiter).includes(binDir)) {
    process.env.PATH = `${binDir}${delimiter}${process.env.PATH}`;
  }
  return binPath;
}

/**
 * Ensures that the `scout` skill is available in Claude's skill directory (~/.claude/skills/scout/SKILL.md)
 * and that the `somecode-scout` executable is in ~/.local/bin.
 */
export async function ensureScoutSkill(home: string = homedir()): Promise<string> {
  const dir = join(home, '.claude', 'skills', 'scout');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  await writeFile(file, SCOUT_SKILL_CONTENT, 'utf8');
  await ensureScoutBin(home).catch(() => {});
  return file;
}

/**
 * Removes the scout skill when disabled in settings.
 */
export async function disableScoutSkill(home: string = homedir()): Promise<void> {
  const dir = join(home, '.claude', 'skills', 'scout');
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
