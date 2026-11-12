import { homedir } from 'node:os';

/**
 * What an agent is told once, at the start of a chat, about the app it is running in: what the user can see and do
 * here and how it can extend itself (skills, plugins, services). It goes in as an extra block ahead of the user's own
 * text and is not shown in the chat.
 */
export function agentGuide(
  home: string = homedir(),
  options?: {
    scoutSubagent?: boolean;
    scoutModel?: string;
    claudeSubagent?: boolean;
    claudeModel?: string;
    browserTool?: 'off' | 'local' | 'any';
    /** The memory / history / schedule tools are on. */
    agentTools?: boolean;
    /** Which of the tools are on (all, when left out). */
    toolset?: { history?: boolean; memory?: boolean; autoMemory?: boolean; schedule?: boolean };
    /** The project has no checks yet and the agent may propose some on its own. */
    proposeChecks?: boolean;
    /** Notes saved for this project. */
    memory?: string[];
  },
): string {
  const lines = [
    'You are running inside SomeCode, a local web app (similar to the Claude or ChatGPT apps) that shows your work to the user live.',
    '- Reply in the language the user writes in. Be concise; the user sees your tool calls, plans and file edits as cards.',
    '- The user can attach images and files. A text file arrives inside <attached-file name="..."> ... </attached-file> tags in their message.',
    '- If you need a decision or missing information, ask with your question tool instead of guessing. Use plan mode output for larger changes.',
    '- You can extend yourself, but tell the user what you are adding and why, and prefer asking first:',
    `  * Skill: create ${home}/.claude/skills/<name>/SKILL.md (Claude) or ${home}/.gemini/config/skills/<name>/SKILL.md (Antigravity). It starts with front matter lines "name: <name>" and "description: <when to use it>" between --- lines, then the instructions. It then shows up on the Plugins page.`,
    '  * Plugin (Claude): run `claude plugin install <plugin>@<marketplace>`; `claude plugin list` shows what is installed.',
    '  * Service (MCP server, Claude): run `claude mcp add --transport http -s user <name> <https-url>`; the user signs in on first use.',
    '- Never put secrets in a skill file. Do not install anything from sources the user did not ask for.',
  ];

  if (options?.agentTools) {
    const set = options.toolset ?? {};
    const history = set.history !== false;
    const memory = set.memory !== false;
    const schedule = set.schedule !== false;
    const parts = [
      history ? '`history_search` / `history_read` look through earlier chats (use them when the user refers to past work)' : null,
      memory ? '`memory_list` / `memory_add` / `memory_forget` keep short notes about this project that every later chat is given' : null,
      schedule ? '`schedule_create` / `schedule_list` / `schedule_cancel` run a prompt later in a new chat' : null,
    ].filter(Boolean);
    if (parts.length > 0) lines.push(`- MEMORY AND SCHEDULING TOOLS (from the \`somecode\` MCP server): ${parts.join(', ')}.`);
    if (memory) {
      lines.push(
        set.autoMemory === false
          ? '  * Save a note with `memory_add` only when the user asks you to remember something or types /learn (one fact per note, no secrets). Do not save notes on your own.'
          : '  * When the user says "remember ...", types /learn or you learn a lasting convention or decision, save it with `memory_add` (one fact per note, no secrets).',
      );
    }
    lines.push('  * `checks_get` shows the commands SomeCode runs to check this project after a change; `checks_propose` suggests some (the user approves them in the chat). Propose only commands you have run and seen work.');
    if (options.proposeChecks) {
      lines.push(
        '  * This project has no checks yet. After your first change to code in this chat, look at how it is built and tested (package.json, Makefile, CI files), run the relevant commands once to see that they work and how long they take, and propose them with `checks_propose` (the user approves). Do it once, after the work the user asked for, and never instead of it. If they refuse, do not bring it up again.',
      );
    }
    if (schedule) lines.push('  * When asked to do something later or regularly, use `schedule_create` and tell the user what you scheduled.');
  }
  if (options?.memory && options.memory.length > 0) {
    lines.push('- PROJECT MEMORY (notes saved for this project; follow them):', ...options.memory.slice(0, 40).map((m) => `  * ${m.replace(/\s+/g, ' ').slice(0, 600)}`));
  }

  if (options?.browserTool && options.browserTool !== 'off') {
    lines.push(
      '- BROWSER TOOLS (browser_open, browser_snapshot, browser_screenshot, browser_click, browser_type, browser_press, browser_scroll, browser_wait, browser_evaluate, browser_console, browser_resize): you can open a page in a hidden browser and use it yourself.',
      `  * Use them to check your own work: after you change a web app, start its dev server, open it (${options.browserTool === 'local' ? 'only addresses on this computer such as http://localhost:PORT can be opened' : 'any http(s) address can be opened'}), take a screenshot, click through the flow you changed and read browser_console for errors. Fix what you find before you tell the user it works.`,
      '  * Prefer browser_snapshot (cheap text with numbered elements) to find what to click; use browser_screenshot to judge how it looks. Take a new snapshot after the page changes.',
      '  * Stop the dev server you started when you are done, and never type real passwords or secrets into a page.',
    );
  }

  if (options?.scoutSubagent) {
    const scoutModel = options.scoutModel || 'gemini-3.8-flash';
    lines.push(
      `- MANDATORY PROACTIVE RECONNAISSANCE (Gemini Scout Subagent, model: ${scoutModel}): You have an ultra-fast Scout Subagent (\`somecode-scout\` CLI or \`scout\` skill) running Gemini with a 1M+ token context window.`,
      '  * PROACTIVE SUBAGENT DELEGATION: You MUST proactively delegate reading and codebase reconnaissance to Gemini Scout without waiting for user permission whenever you need to inspect multiple files, understand module architectures, find functions/imports across the codebase, or analyze logs.',
      '  * If you have a tool named `scout` (from the `somecode` MCP server), call that tool: it is the preferred way and shows up to the user as a sub-agent. It takes `task` and optionally `files`.',
      '  * Otherwise run: Run `somecode-scout "<task or question>" [--files "<file1,file2,...>"]` via your Bash execution tool. Clearly specify target files or modules to inspect.',
      '  * Why: Gemini Scout reads files in depth in safe plan mode and returns structured, factual reports with exact line references directly into your context, keeping your attention sharp.',
    );
  }

  if (options?.claudeSubagent) {
    const claudeModel = options.claudeModel || 'sonnet';
    lines.push(
      `- SPECIALIZED CLAUDE SUBAGENT (Claude Code, model: ${claudeModel}): You have a high-capability Claude Subagent (\`somecode-claude\` CLI or \`claude\` skill) available on this system.`,
      '  * SUBAGENT DELEGATION: When running in Antigravity or another agent, delegate complex architectural review, specialized coding, refactoring, or second-opinion logic verification to Claude.',
      '  * How to run: Run `somecode-claude "<task or review question>" [--files "<file1,file2,...>"]` via your command execution tool.',
      '  * Why: Claude Code provides deep reasoning, nuanced multi-step code analysis, and rigorous verification.',
    );
  }

  return lines.join('\n');
}
