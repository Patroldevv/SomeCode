import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLAUDE_SUBAGENT_SKILL_CONTENT = `---
name: claude
description: Deep Reasoning and Specialized Coding Subagent powered by Claude Code. Proactively invoke this subagent via run_command when you need complex architectural review, specialized coding, refactoring, or a rigorous second-opinion verification.
---
# Claude Subagent (Claude Code)

You are equipped with a high-capability Claude Subagent.

## Subagent Role & Delegation
You can proactively delegate tasks to this subagent whenever:
- You need deep second-opinion logic verification or code review.
- You need complex algorithmic implementation or specialized refactoring.
- The user asks for Claude's perspective or reasoning.

## Execution Command
Run via your \`run_command\` (bash) tool:
\`\`\`bash
somecode-claude "<task description>" [--files "<file1,file2,...>"] [--model <sonnet|opus|haiku>] [--effort <low|medium|high>]
\`\`\`

Examples:
- \`somecode-claude "Analyze database concurrency and transaction isolation risks" --files "src/db/pool.ts,src/db/tx.ts"\`
- \`somecode-claude "Refactor this module into clean dependency-injected services" --files "src/services/order.ts"\`
- \`somecode-claude "Perform security code review for authentication endpoints"\`
`;

/**
 * Ensures that the `somecode-claude` launcher is placed into `~/.local/bin/somecode-claude`.
 */
export async function ensureClaudeBin(home: string = homedir()): Promise<string> {
  const binDir = join(home, '.local', 'bin');
  await mkdir(binDir, { recursive: true });
  const binPath = join(binDir, 'somecode-claude');
  const targetTs = fileURLToPath(new URL('../../../../bin/somecode-claude.ts', import.meta.url));
  const scriptContent = `#!/bin/sh\nexec node "${targetTs}" "$@"\n`;
  await writeFile(binPath, scriptContent, { mode: 0o755 });
  await chmod(binPath, 0o755).catch(() => {});
  if (process.env.PATH && !process.env.PATH.split(delimiter).includes(binDir)) {
    process.env.PATH = `${binDir}${delimiter}${process.env.PATH}`;
  }
  return binPath;
}

/**
 * Ensures that the `claude` skill is available in Antigravity's skill directory (~/.gemini/config/skills/claude/SKILL.md)
 * and that `somecode-claude` is in ~/.local/bin.
 */
export async function ensureClaudeSkill(home: string = homedir()): Promise<string> {
  const dir = join(home, '.gemini', 'config', 'skills', 'claude');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  await writeFile(file, CLAUDE_SUBAGENT_SKILL_CONTENT, 'utf8');
  await ensureClaudeBin(home).catch(() => {});
  return file;
}

/**
 * Removes the claude skill when disabled in settings.
 */
export async function disableClaudeSkill(home: string = homedir()): Promise<void> {
  const dir = join(home, '.gemini', 'config', 'skills', 'claude');
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
