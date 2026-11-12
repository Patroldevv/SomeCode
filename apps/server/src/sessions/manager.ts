import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordRateLimit } from '../limits.ts';
import { approvalDecision, approvalOption, parseApproval, plainModeFor, trimModeOption, type ApprovalLevel } from '../permissions/approval.ts';
import { DEFAULT_SETTINGS, defaultApprovalLevel, type ServerSettings } from '../settings.ts';
import { agentGuide } from '../agentGuide.ts';
import { SomeCodeError, type ConfigOption, type FormAnswer, type ImageAttachment, type SessionHistoryPage, type NormalizedEvent, type StoredEvent } from '@somecode/protocol';
import { AcpSession, type McpServerConfig } from '../acp/session.ts';
import type { AgentRegistry } from '../agents/registry.ts';
import type { AgentDriver } from '../agents/types.ts';
import { MAX_EVENT_PAGE, type SessionRow, type Store } from '../store/store.ts';
import { isScoutRun, SCOUT_MARKER } from '../scout/detect.ts';
import { researchInstructions } from '../research/instructions.ts';
import { z } from 'zod';
import { checkSchema, readVerify, writeVerify, type Check, type VerifyConfig } from '../verify/config.ts';
import { fixPrompt, runCheck, type CheckResult } from '../verify/runner.ts';
import { DEEP_RESEARCH, plainValueOf, withResearchMode } from '../research/mode.ts';
import { isClaudeSubagentRun } from '../claude-subagent/detect.ts';

/** A scout whose conversation has been silent this long is taken as dead (its own limit is 3 minutes in all). */
const SCOUT_IDLE_MS = 120_000;
import { AntigravitySubagentWatcher } from '../subagents/antigravityWatcher.ts';
import { ensureScoutSkill } from '../scout/skill.ts';
import { ensureClaudeSkill } from '../claude-subagent/skill.ts';

type Listener = (e: StoredEvent) => void;

type Entry = {
  /** Null until the agent has started, and for sessions with no live agent in this process. */
  session: AcpSession | null;
  /** Startup/resume owns this entry even before it has a live process. */
  pending: boolean;
  listeners: Set<Listener>;
  busy: boolean;
  disconnected: boolean;
  /** Identifies the running turn so a finished turn cannot clear the flag of its successor. */
  turn: symbol | null;
  /** Stored events awaiting broadcast; `draining` is set while a broadcast loop is running. */
  queue: StoredEvent[];
  draining: boolean;
  subagentWatchers: Map<string, AntigravitySubagentWatcher>;
  /** Titles of tool calls that may turn out to be a scout once their input arrives (some agents send it late). */
  callTitles?: Map<string, string>;
  /** The agent has been told about the app (once per connection). */
  guided?: boolean;
  /** The agent has been instructed about the active scout subagent. */
  scoutGuided?: boolean;
  pendingSubagents: Map<string, { role: string; prompt?: string; startedAt: number }>;
  /** The turn in progress changed files (so the project's checks are due when it ends). */
  edited?: boolean;
  /** How many automatic fix rounds the user's last message has had, and whether checks are running now. */
  verifyRound?: number;
  verifying?: boolean;
  activeClaudeCalls: Map<string, { id: string; startedAt: number }>;
};

/** A tool call that writes, deletes or moves files (or shows a diff): the turn changed the project. */
function isEditEvent(event: NormalizedEvent): boolean {
  if (event.type === 'tool_call') return ['edit', 'delete', 'move'].includes(event.kind) || event.content.some((c) => c.type === 'diff');
  if (event.type === 'tool_call_update') {
    const content = event.patch['content'];
    return (typeof event.patch['kind'] === 'string' && ['edit', 'delete', 'move'].includes(event.patch['kind'])) || (Array.isArray(content) && content.some((c) => typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'diff'));
  }
  return false;
}

function log(message: string, err: unknown): void {
  process.stderr.write(`[somecode] ${message}: ${err instanceof Error ? err.message : String(err)}\n`);
}

const shuttingDown = (): SomeCodeError => new SomeCodeError('disconnected', 'SomeCode is shutting down');

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Owns the live agent sessions: persists every event, fans it out, and replays history safely. */
export class SessionManager {
  readonly #store: Store;
  readonly #registry: AgentRegistry;
  readonly #entries = new Map<string, Entry>();
  /** Aborted by closeAll(): stops agents that are still starting and refuses new sessions. */
  readonly #shutdown = new AbortController();
  /** createSession() agent starts in flight; closeAll() waits for them. */
  readonly #starting = new Set<Promise<unknown>>();
  readonly #resuming = new Map<string, Promise<SessionRow>>();

  readonly #settings: () => ServerSettings;
  /** The access level of each session, and the options its agent last reported (before our additions). */
  readonly #approvals = new Map<string, ApprovalLevel>();
  /** Sessions in deep research mode (SomeCode's own mode, remembered per session). */
  readonly #research = new Map<string, boolean>();
  readonly #agentOptions = new Map<string, ConfigOption[]>();
  readonly #url?: () => string;
  readonly #token?: string;

  constructor(deps: { store: Store; registry: AgentRegistry; settings?: () => ServerSettings; url?: () => string; token?: string }) {
    this.#store = deps.store;
    this.#registry = deps.registry;
    this.#settings = deps.settings ?? (() => DEFAULT_SETTINGS);
    this.#url = deps.url;
    this.#token = deps.token;
  }

  async createSession(projectId: string, agentId: string): Promise<SessionRow> {
    if (this.#shutdown.signal.aborted) throw shuttingDown();
    const project = this.#store.getProject(projectId);
    if (!project) throw new SomeCodeError('not_found', `unknown project: ${projectId}`);
    const driver = this.#registry.get(agentId);
    if (!driver) throw new SomeCodeError('not_found', `unknown agent: ${agentId}`);
    if (!isDirectory(project.path)) {
      throw new SomeCodeError('bad_request', `project path is not an existing directory: ${project.path}`);
    }
    if (!(await driver.detect()).installed) {
      throw new SomeCodeError('agent_not_installed', `agent "${agentId}" is not installed`);
    }
    if (this.#shutdown.signal.aborted) throw shuttingDown();

    // The row comes first so that every event the agent emits (even during startup) has a home.
    const row = this.#store.createSession({ projectId, agentId });
    const entry = this.#entry(row.id);
    entry.pending = true;
    const starting = this.#startAgent(row.id, entry, driver, project.path);
    this.#starting.add(starting);
    try {
      entry.session = await starting;
    } finally {
      entry.pending = false;
      this.#starting.delete(starting);
    }
    this.#store.setAcpSessionId(row.id, entry.session.acpSessionId);
    return this.#store.getSession(row.id)!;
  }

  /** Explicit, single-flight restoration of the existing ACP id, including after server restart. */
  resumeSession(sessionId: string): Promise<SessionRow> {
    if (this.#shutdown.signal.aborted) return Promise.reject(shuttingDown());
    const pending = this.#resuming.get(sessionId);
    if (pending) return pending;
    const row = this.#store.getSession(sessionId);
    if (!row) return Promise.reject(new SomeCodeError('not_found', `unknown session: ${sessionId}`));
    const entry = this.#entry(sessionId);
    if (entry.session && !entry.disconnected) return Promise.resolve(row);
    entry.pending = true;
    const resume = (async () => {
      if (!row.acpSessionId) throw new SomeCodeError('bad_request', 'session has no saved ACP id to resume');
      const project = this.#store.getProject(row.projectId);
      const driver = this.#registry.get(row.agentId);
      if (!project || !driver) throw new SomeCodeError('not_found', 'session project or agent is unavailable');
      if (!isDirectory(project.path)) throw new SomeCodeError('bad_request', 'session directory is unavailable');
      if (!(await driver.detect()).installed) throw new SomeCodeError('agent_not_installed', 'session agent is not installed');
      if (this.#shutdown.signal.aborted) throw shuttingDown();
      await entry.session?.close();
      entry.session = null;
      entry.disconnected = false;
      entry.busy = false;
      entry.turn = null;
      entry.session = await this.#startAgent(sessionId, entry, driver, project.path, row.acpSessionId);
      // A previous process's broker cannot answer these requests. Cancel their durable cards too.
      let permissionCursor = 0;
      for (;;) {
        const pendingPermissions = this.#store.pendingPermissions(sessionId, permissionCursor);
        if (pendingPermissions.length === 0) break;
        for (const permission of pendingPermissions) {
          this.#onEvent(sessionId, entry, { type: 'permission_resolved', requestId: permission.requestId, outcome: 'cancelled' });
          permissionCursor = permission.seq;
        }
      }
      return this.#store.getSession(sessionId)!;
    })();
    this.#resuming.set(sessionId, resume);
    this.#starting.add(resume);
    const clear = () => {
      entry.pending = false;
      this.#resuming.delete(sessionId);
      this.#starting.delete(resume);
    };
    void resume.then(clear, clear);
    return resume;
  }

  /** The tools SomeCode offers the agent as an MCP server (the scout and the browser, while they are switched on). */
  #mcpServers(env: NodeJS.ProcessEnv): McpServerConfig[] {
    const settings = this.#settings();
    const { scoutSubagent, browserTool, agentTools } = settings;
    if ((!scoutSubagent && browserTool === 'off' && !agentTools) || !env['SOMECODE_URL'] || !env['SOMECODE_TOKEN']) return [];
    return [
      {
        name: 'somecode',
        command: process.execPath,
        args: [fileURLToPath(new URL('../../../../bin/somecode-mcp.ts', import.meta.url))],
        env: [
          { name: 'SOMECODE_URL', value: env['SOMECODE_URL'] },
          { name: 'SOMECODE_TOKEN', value: env['SOMECODE_TOKEN'] },
          { name: 'SOMECODE_BROWSER', value: browserTool },
          ...(scoutSubagent ? [{ name: 'SOMECODE_SCOUT', value: '1' }] : []),
          ...(agentTools
            ? [
                { name: 'SOMECODE_TOOLS', value: '1' },
                { name: 'SOMECODE_TOOLSET', value: ['research', 'verify', settings.historySearch ? 'history' : '', settings.projectMemory ? 'memory' : '', settings.scheduledTasks ? 'schedule' : ''].filter(Boolean).join(',') },
                { name: 'SOMECODE_RESEARCH', value: JSON.stringify({ plan: settings.researchPlan, depth: settings.researchDepth, engines: settings.researchEngines }) },
              ]
            : []),
          ...(env['SOMECODE_SESSION_ID'] ? [{ name: 'SOMECODE_SESSION_ID', value: env['SOMECODE_SESSION_ID'] }] : []),
        ],
      },
    ];
  }

  async #startAgent(sessionId: string, entry: Entry, driver: AgentDriver, cwd: string, acpSessionId?: string): Promise<AcpSession> {
    if (this.#settings().scoutSubagent) {
      void ensureScoutSkill().catch(() => {});
    }
    if (this.#settings().claudeSubagent) {
      void ensureClaudeSkill().catch(() => {});
    }
    const signal = this.#shutdown.signal;
    const env: NodeJS.ProcessEnv = {
      ...(this.#url ? { SOMECODE_URL: this.#url() } : {}),
      ...(this.#token ? { SOMECODE_TOKEN: this.#token } : {}),
      SOMECODE_SESSION_ID: sessionId,
    };
    let session: AcpSession;
    try {
      session = await AcpSession.start({
        driver,
        cwd,
        signal,
        env,
        mcpServers: this.#mcpServers(env),
        ...(acpSessionId ? { acpSessionId } : {}),
        onRateLimit: (info) => recordRateLimit(this.#store, driver.id, info),
        autoApprove: (mode, req) => approvalDecision({ level: this.#approval(sessionId), mode, planAuto: this.#settings().planAutoApprove, cwd }, req),
        onEvent: (event) => this.#onEvent(sessionId, entry, event),
      });
    } catch (err) {
      // A failure before the agent ever ran (e.g. spawn error) emits no status of its own.
      if (!entry.disconnected) {
        this.#onEvent(sessionId, entry, {
          type: 'status',
          status: 'disconnected',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      throw signal.aborted ? shuttingDown() : err;
    }
    if (signal.aborted) {
      // closeAll() ran just as the start finished; this session is not in its list yet.
      await session.close();
      throw shuttingDown();
    }
    // An agent with no options of its own still gets the access-level picker.
    if (!this.#agentOptions.has(sessionId)) this.#onEvent(sessionId, entry, { type: 'config_options', options: [] });
    void this.#leavePermissiveMode(sessionId, session);
    return session;
  }

  /** Starts a turn and returns immediately; progress and the outcome arrive as events. */
  prompt(sessionId: string, text: string, images?: ImageAttachment[], opts: { auto?: boolean } = {}): void {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (entry.busy) throw new SomeCodeError('turn_in_progress', 'a prompt turn is already running');
    const turn = Symbol('turn');
    entry.turn = turn;
    entry.busy = true;
    entry.edited = false;
    // A message of the user starts the automatic fix rounds again; a fix SomeCode sent itself does not.
    if (!opts.auto) entry.verifyRound = 0;
    // The turn is accepted: record the user's message first so it precedes status:running.
    this.#onEvent(sessionId, entry, {
      type: 'user_message',
      text,
      ...(images && images.length > 0 ? { images } : {}),
    });
    // The first turn of a chat also carries the guide to the app (not journaled, so it never shows in the chat).
    let preamble: string | undefined;
    const settings = this.#settings();
    const scoutActive = settings.scoutSubagent;
    const claudeActive = settings.claudeSubagent;
    if (scoutActive) void ensureScoutSkill().catch(() => {});
    if (claudeActive) void ensureClaudeSkill().catch(() => {});
    if (!entry.guided && settings.agentGuide) {
      preamble = agentGuide(undefined, {
        scoutSubagent: scoutActive,
        scoutModel: settings.scoutModel,
        claudeSubagent: claudeActive,
        claudeModel: settings.claudeModel,
        browserTool: settings.browserTool,
        agentTools: settings.agentTools,
        toolset: { history: settings.historySearch, memory: settings.projectMemory, autoMemory: settings.autoMemory, schedule: settings.scheduledTasks },
        proposeChecks: settings.agentTools && settings.autoChecks && this.#wantsCheckProposal(sessionId),
        memory: settings.projectMemory ? this.#memoryNotes(sessionId) : [],
      });
      entry.guided = true;
      entry.scoutGuided = scoutActive;
    } else if (scoutActive && !entry.scoutGuided) {
      preamble = [
        `[SCOUT SUBAGENT ACTIVATED: Fast Gemini Scout (model: ${settings.scoutModel}) is available on this system as your reading/inspection subagent.]`,
        'PROACTIVE INVOCATION: You have a subagent powered by Gemini (1M+ context window). Proactively delegate file exploration, code reading, and architectural analysis to it without waiting for user permission.',
        'HOW TO INVOKE: Run via Bash tool: `somecode-scout "<task>" [--files "<file1,file2,...>"]` or `somecode-scout "İncele ve özetle: <modül/dosyalar>"`',
        'You can specify multiple files or entire directories for it to read in depth. It runs in safe plan mode and returns structured factual reports directly into your conversation.',
      ].join('\n');
      entry.scoutGuided = true;
    }
    // Deep research: every message of the session (or one that starts with /research) carries the research instructions.
    if (!opts.auto && (this.#researching(sessionId) || /^\/(deep-)?research(\s|$)/i.test(text))) {
      const instructions = researchInstructions({
        browser: settings.browserTool,
        scout: settings.scoutSubagent,
        memory: settings.agentTools && settings.projectMemory,
        tools: settings.agentTools,
        plan: settings.researchPlan,
        depth: settings.researchDepth,
        engines: settings.researchEngines,
      });
      preamble = preamble ? `${preamble}\n\n${instructions}` : instructions;
    }
    session
      .prompt(text, images, preamble)
      .catch((err: unknown) => log(`prompt failed for session ${sessionId}`, err))
      .finally(() => {
        if (entry.turn === turn) entry.busy = false;
      });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#known(sessionId).session?.cancel();
  }

  respondPermission(sessionId: string, requestId: string, optionId: string | null, answer?: FormAnswer): void {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (!session.respondPermission(requestId, optionId, answer)) {
      throw new SomeCodeError('not_found', `no pending permission request: ${requestId}`);
    }
  }

  /** Research plans waiting for (or past) the user's decision, by request id. */
  readonly #plans = new Map<string, { sessionId: string; settled: { steps: string[] | null } | null; waiters: Set<() => void> }>();
  /** The steps of each session's approved research plan, ticked off while the agent works. */
  readonly #planSteps = new Map<string, { content: string; status: string; priority: string }[]>();

  /**
   * Puts a research plan in front of the user (`ask`) or just shows it, and gives the id to wait on. With `ask` off the
   * plan starts at once with the steps as given.
   */
  async proposeResearchPlan(sessionId: string, title: string, steps: string[], ask: boolean): Promise<{ requestId: string; steps?: string[] }> {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (!ask) {
      this.#startPlan(sessionId, entry, steps);
      return { requestId: 'auto', steps };
    }
    const { requestId, result } = await session.askPlan(title, steps);
    const record = { sessionId, settled: null as { steps: string[] | null } | null, waiters: new Set<() => void>() };
    this.#plans.set(requestId, record);
    void result.then((approved) => {
      record.settled = { steps: approved };
      if (approved) this.#startPlan(sessionId, entry, approved);
      for (const wake of record.waiters) wake();
      // The agent has had its answer by now; the record is only kept for a late poll.
      setTimeout(() => this.#plans.delete(requestId), 10 * 60_000).unref();
    });
    return { requestId };
  }

  /** Waits up to `waitMs` for the user's decision on a plan. */
  async researchPlanState(requestId: string, waitMs: number): Promise<{ state: 'pending' | 'started' | 'cancelled'; steps?: string[] }> {
    const record = this.#plans.get(requestId);
    if (!record) throw new SomeCodeError('not_found', `unknown plan: ${requestId}`);
    if (!record.settled && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          record.waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, waitMs);
        record.waiters.add(wake);
      });
    }
    if (!record.settled) return { state: 'pending' };
    return record.settled.steps ? { state: 'started', steps: record.settled.steps } : { state: 'cancelled' };
  }

  /** Checks an agent proposed, waiting for (or past) the user's answer, by request id. */
  readonly #proposals = new Map<string, { settled: boolean | null; waiters: Set<() => void> }>();

  /**
   * An agent proposes checks for the project: the user sees them in the chat and approves or refuses. On approval they
   * are saved (added to the project's checks, or replacing them). Nothing the agent proposes ever runs unapproved.
   */
  async proposeChecks(sessionId: string, input: { checks: Check[]; mode: 'add' | 'replace'; reason?: string }): Promise<{ requestId: string }> {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    const row = this.#store.getSession(sessionId)!;
    const project = this.#store.getProject(row.projectId);
    if (!project) throw new SomeCodeError('not_found', 'unknown project');
    const checks = z.array(checkSchema).min(1).max(8).safeParse(input.checks);
    if (!checks.success) throw new SomeCodeError('bad_request', 'a check needs a name (up to 40 characters) and a command (up to 400); at most 8 checks');
    // Whatever the answer, the project has been asked: later chats do not suggest it again on their own.
    this.#store.setSetting(`verify-asked:${project.id}`, '1');
    const detail = [
      input.reason ? `${input.reason.slice(0, 500)}\n` : '',
      input.mode === 'replace' ? '**These replace the project\'s checks:**' : '**These are added to the project\'s checks:**',
      ...checks.data.map((c) => `- **${c.name}**: \`${c.command.replace(/`/g, "'")}\``),
      '',
      'They run in the project folder after a turn that changed files.',
    ].join('\n');
    const { requestId, result } = await session.askApproval(`Checks for ${project.name}`, detail);
    const record = { settled: null as boolean | null, waiters: new Set<() => void>() };
    this.#proposals.set(requestId, record);
    // The access level the user chose for this chat decides whether they are asked: "Ask for approval" asks; "Approve
    // for me" and "Full access" save the checks at once (the card stays in the chat, already answered, so it is seen).
    if (this.#approval(sessionId) !== 'ask') session.respondPermission(requestId, 'approve');
    void result.then((approved) => {
      if (approved) {
        const current = readVerify(this.#store, project.id);
        const known = new Set(current.checks.map((c) => c.command));
        const next = input.mode === 'replace' ? checks.data : [...current.checks, ...checks.data.filter((c) => !known.has(c.command))].slice(0, 8);
        writeVerify(this.#store, project.id, { ...current, enabled: true, checks: next });
      }
      record.settled = approved;
      for (const wake of record.waiters) wake();
      setTimeout(() => this.#proposals.delete(requestId), 10 * 60_000).unref();
    });
    return { requestId };
  }

  /** Waits up to `waitMs` for the user's answer on proposed checks. */
  async checksProposalState(requestId: string, waitMs: number): Promise<{ state: 'pending' | 'approved' | 'refused' }> {
    const record = this.#proposals.get(requestId);
    if (!record) throw new SomeCodeError('not_found', `unknown proposal: ${requestId}`);
    if (record.settled === null && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          record.waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, waitMs);
        record.waiters.add(wake);
      });
    }
    return { state: record.settled === null ? 'pending' : record.settled ? 'approved' : 'refused' };
  }

  /** Starts a chat in the project that asks an agent to work out the project's checks and propose them. */
  async askAgentForChecks(projectId: string, agentId: string, prompt: string): Promise<SessionRow> {
    const row = await this.createSession(projectId, agentId);
    this.#store.renameSession(row.id, '🛡 Checks');
    this.prompt(row.id, prompt);
    return row;
  }

  /** Marks one step (counted from 1) of the session's research plan and shows the plan again. */
  researchProgress(sessionId: string, step: number, status: 'in_progress' | 'completed'): { done: number; total: number } {
    const entry = this.#known(sessionId);
    const steps = this.#planSteps.get(sessionId);
    if (!steps || step < 1 || step > steps.length) throw new SomeCodeError('bad_request', `no step ${step} in the research plan`);
    steps[step - 1]!.status = status;
    // The spinner never rests between two steps: when one is finished and none is running, the next one starts.
    if (status === 'completed' && !steps.some((s) => s.status === 'in_progress')) {
      const next = steps.find((s) => s.status === 'pending');
      if (next) next.status = 'in_progress';
    }
    this.#onEvent(sessionId, entry, { type: 'plan', entries: steps.map((e) => ({ ...e })) });
    return { done: steps.filter((s) => s.status === 'completed').length, total: steps.length };
  }

  #startPlan(sessionId: string, entry: Entry, steps: string[]): void {
    const entries = steps.map((content, i) => ({ content, status: i === 0 ? 'in_progress' : 'pending', priority: 'medium' }));
    this.#planSteps.set(sessionId, entries);
    this.#onEvent(sessionId, entry, { type: 'plan', entries: entries.map((e) => ({ ...e })) });
  }

  /** After a turn that changed files: run the project's checks (once), and hand a failure to the agent. */
  #afterTurn(sessionId: string, entry: Entry): void {
    if (!entry.edited || entry.verifying || entry.disconnected || this.#shutdown.signal.aborted) return;
    const row = this.#store.getSession(sessionId);
    const project = row && this.#store.getProject(row.projectId);
    if (!project) return;
    const config = readVerify(this.#store, project.id);
    if (!config.enabled || config.checks.length === 0) return;
    entry.edited = false;
    void this.#verify(sessionId, entry, project.path, config);
  }

  /** The project has no checks and no agent has proposed any yet (a refusal counts: it is not asked twice). */
  #wantsCheckProposal(sessionId: string): boolean {
    const row = this.#store.getSession(sessionId);
    if (!row) return false;
    return readVerify(this.#store, row.projectId).checks.length === 0 && this.#store.getSetting(`verify-asked:${row.projectId}`) !== '1';
  }

  /** Runs the checks now, whatever the turn did (the "Run checks" button). */
  verifyNow(sessionId: string): void {
    const entry = this.#known(sessionId);
    const row = this.#store.getSession(sessionId)!;
    const project = this.#store.getProject(row.projectId);
    if (!project) throw new SomeCodeError('not_found', 'unknown project');
    const config = readVerify(this.#store, project.id);
    if (config.checks.length === 0) throw new SomeCodeError('bad_request', 'the project has no checks yet');
    if (entry.verifying) throw new SomeCodeError('turn_in_progress', 'the checks are already running');
    entry.verifyRound = 0;
    void this.#verify(sessionId, entry, project.path, config);
  }

  async #verify(sessionId: string, entry: Entry, folder: string, config: VerifyConfig): Promise<void> {
    entry.verifying = true;
    const id = randomUUID();
    const round = entry.verifyRound ?? 0;
    const checks = config.checks.map((c) => ({ name: c.name, command: c.command, status: 'pending' as 'pending' | 'running' | 'passed' | 'failed', ...({} as { output?: string; ms?: number }) }));
    const emit = (status: 'running' | 'passed' | 'failed', willFix?: boolean) =>
      this.#onEvent(sessionId, entry, { type: 'verification', id, status, round, checks: checks.map((c) => ({ ...c })), ...(willFix !== undefined ? { willFix } : {}) });
    try {
      const results: CheckResult[] = [];
      for (const [i, check] of config.checks.entries()) {
        checks[i]!.status = 'running';
        emit('running');
        const result = await runCheck(folder, check, { signal: this.#shutdown.signal });
        results.push(result);
        checks[i]!.status = result.ok ? 'passed' : 'failed';
        checks[i]!.ms = result.ms;
        if (!result.ok) checks[i]!.output = result.output;
      }
      const failed = results.some((r) => !r.ok);
      const willFix = failed && config.autoFix && round < config.maxFixes && !entry.disconnected && !this.#shutdown.signal.aborted;
      emit(failed ? 'failed' : 'passed', willFix);
      if (willFix) {
        // The agent may still be finishing its turn: wait for it to be free before handing the failure over.
        for (let waited = 0; entry.busy && waited < 20_000; waited += 250) await new Promise((r) => setTimeout(r, 250));
        if (!entry.busy) {
          entry.verifyRound = round + 1;
          this.prompt(sessionId, fixPrompt(results, round + 1, config.maxFixes), undefined, { auto: true });
        }
      }
    } catch (err) {
      log(`checks failed to run for session ${sessionId}`, err);
    } finally {
      entry.verifying = false;
    }
  }

  /** The notes saved for the session's project, to tell the agent at the start of a chat. */
  #memoryNotes(sessionId: string): string[] {
    const row = this.#store.getSession(sessionId);
    return row ? this.#store.listMemories(row.projectId).map((m) => m.text) : [];
  }

  /** The access level of a session: what the user set for it, else the default for new chats. */
  #approval(sessionId: string): ApprovalLevel {
    const known = this.#approvals.get(sessionId);
    if (known) return known;
    const level = parseApproval(this.#store.getSetting(`approval:${sessionId}`)) ?? defaultApprovalLevel(this.#settings());
    this.#approvals.set(sessionId, level);
    return level;
  }

  /** Access levels replace the agent's own "accept edits"/"bypass" modes: a session never stays in one. */
  async #leavePermissiveMode(sessionId: string, session: AcpSession): Promise<void> {
    const mode = this.#agentOptions.get(sessionId)?.map(plainModeFor).find((m) => m !== null);
    if (!mode) return;
    try {
      await session.setConfig('mode', mode);
    } catch (err) {
      log(`cannot move session ${sessionId} out of a permissive mode`, err);
    }
  }

  async setConfig(sessionId: string, configId: string, value: string): Promise<void> {
    if (configId === 'approval') {
      const entry = this.#known(sessionId);
      const level = parseApproval(value);
      if (!level) throw new SomeCodeError('bad_request', `unknown access level: ${value}`);
      this.#approvals.set(sessionId, level);
      this.#store.setSetting(`approval:${sessionId}`, level);
      this.#onEvent(sessionId, entry, { type: 'config_options', options: this.#agentOptions.get(sessionId) ?? [] });
      return;
    }
    if (configId === 'mode') {
      const entry = this.#known(sessionId);
      const session = entry.session;
      if (!session) throw new SomeCodeError('disconnected', 'agent is not connected');
      const on = value === DEEP_RESEARCH;
      this.#research.set(sessionId, on);
      this.#store.setSetting(`research:${sessionId}`, on ? '1' : '0');
      if (on) {
        // Deep research is SomeCode's own mode: the agent itself goes to its plain mode.
        const option = this.#agentOptions.get(sessionId)?.find((o) => o.id === 'mode' || o.category === 'mode');
        const plain = option ? plainValueOf(option) : null;
        if (option && plain && option.currentValue !== plain) await session.setConfig('mode', plain);
        this.#onEvent(sessionId, entry, { type: 'config_options', options: this.#agentOptions.get(sessionId) ?? [] });
        return;
      }
      await session.setConfig('mode', value);
      this.#onEvent(sessionId, entry, { type: 'config_options', options: this.#agentOptions.get(sessionId) ?? [] });
      return;
    }
    const session = this.#known(sessionId).session;
    if (!session) throw new SomeCodeError('disconnected', 'agent is not connected');
    await session.setConfig(configId, value);
  }

  /** Whether the session is in deep research mode (remembered across restarts). */
  #researching(sessionId: string): boolean {
    const known = this.#research.get(sessionId);
    if (known !== undefined) return known;
    const on = this.#store.getSetting(`research:${sessionId}`) === '1';
    this.#research.set(sessionId, on);
    return on;
  }

  history(sessionId: string, beforeSeq?: number, limit?: number): SessionHistoryPage {
    if (!this.#store.getSession(sessionId)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    const entry = this.#entries.get(sessionId);
    const history = this.#store.history(sessionId, beforeSeq, limit);
    // A persisted ready status describes the previous process, not a currently running agent.
    if (!entry?.session || entry.disconnected) history.state.status = 'disconnected';
    return history;
  }

  /**
   * Delivers every stored event after `afterSeq` in order, then live events, each exactly once.
   * The listener is registered before history is read; live events arriving meanwhile are
   * held back and merged by seq.
   */
  subscribe(
    sessionId: string,
    afterSeq: number,
    listener: (e: StoredEvent) => void,
  ): { lastSeq: number; snapshot?: SessionHistoryPage; unsubscribe(): void } {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      throw new SomeCodeError('bad_request', 'afterSeq must be an integer >= 0');
    }
    const entry = this.#known(sessionId);
    let active = true;
    let replaying = true;
    let lastDelivered = afterSeq;
    const held: StoredEvent[] = [];
    const deliver = (e: StoredEvent): void => {
      if (!active || e.seq <= lastDelivered) return;
      lastDelivered = e.seq;
      try {
        listener(e);
      } catch (err) {
        log(`listener for session ${sessionId} threw`, err);
      }
    };
    const wrapper: Listener = (e) => {
      if (replaying) held.push(e);
      else deliver(e);
    };
    entry.listeners.add(wrapper);

    const lastSeq = this.#store.lastSeq(sessionId);
    const noLiveAgent = !entry.session || entry.disconnected;
    const history = noLiveAgent || lastSeq - afterSeq > MAX_EVENT_PAGE ? [] : this.#store.eventsSince(sessionId, afterSeq);
    const needsSnapshot = noLiveAgent || lastSeq - afterSeq > MAX_EVENT_PAGE || (afterSeq < lastSeq && history.at(-1)?.seq !== lastSeq);
    const snapshot = needsSnapshot ? this.history(sessionId) : undefined;
    if (snapshot) lastDelivered = snapshot.state.lastSeq;
    for (const e of history) deliver(e);
    // `held` can grow while draining (a listener may trigger new events), so index, not iterate.
    for (let i = 0; i < held.length; i++) deliver(held[i]!);
    replaying = false;

    return {
      lastSeq,
      ...(snapshot ? { snapshot } : {}),
      unsubscribe: () => {
        active = false;
        entry.listeners.delete(wrapper);
        if (!entry.session && !entry.pending && entry.listeners.size === 0 && this.#entries.get(sessionId) === entry) {
          this.#entries.delete(sessionId);
        }
      },
    };
  }

  /** Stops every agent, including ones still starting; later createSession() calls are refused. */
  async closeAll(): Promise<void> {
    this.#shutdown.abort();
    await Promise.allSettled([...this.#starting]);
    const entries = [...this.#entries.values()];
    await Promise.allSettled(entries.map((entry) => entry.session?.close()));
    for (const entry of entries) {
      for (const watcher of entry.subagentWatchers.values()) watcher.stop();
      entry.subagentWatchers.clear();
      entry.pendingSubagents.clear();
      entry.activeClaudeCalls.clear();
      entry.listeners.clear();
    }
  }

  #entry(sessionId: string): Entry {
    let entry = this.#entries.get(sessionId);
    if (!entry) {
      entry = {
        session: null,
        pending: false,
        listeners: new Set(),
        busy: false,
        disconnected: false,
        turn: null,
        queue: [],
        draining: false,
        subagentWatchers: new Map(),
        pendingSubagents: new Map(),
        activeClaudeCalls: new Map(),
      };
      this.#entries.set(sessionId, entry);
    }
    return entry;
  }

  /** The entry for an existing session; unknown ids never reach the store's foreign keys. */
  /** Renames a session; the new name replaces the one taken from its first message. */
  renameSession(sessionId: string, title: string): void {
    const clean = title.trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (clean === '') throw new SomeCodeError('bad_request', 'title must not be empty');
    if (!this.#store.renameSession(sessionId, clean)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
  }

  /** Stops the session's agent and removes the session for good. */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.#store.getSession(sessionId)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    const entry = this.#entries.get(sessionId);
    this.#entries.delete(sessionId);
    this.#approvals.delete(sessionId);
    this.#research.delete(sessionId);
    this.#agentOptions.delete(sessionId);
    if (entry) {
      entry.listeners.clear();
      for (const watcher of entry.subagentWatchers.values()) watcher.stop();
      entry.subagentWatchers.clear();
      entry.pendingSubagents.clear();
      entry.activeClaudeCalls.clear();
      await entry.session?.close().catch(() => {});
    }
    this.#store.deleteSession(sessionId);
  }

  async deleteProject(projectId: string, sessionIds: string[]): Promise<void> {
    for (const id of sessionIds) await this.deleteSession(id);
    if (!this.#store.deleteProject(projectId)) throw new SomeCodeError('not_found', `unknown project: ${projectId}`);
  }

  async rewindSession(sessionId: string, beforeSeq: number): Promise<void> {
    if (!this.#store.getSession(sessionId)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    const entry = this.#entry(sessionId);
    if (entry.session && entry.busy) {
      await entry.session.cancel().catch(() => {});
      entry.busy = false;
      entry.turn = null;
    }
    entry.queue = [];
    for (const watcher of entry.subagentWatchers.values()) watcher.stop();
    entry.subagentWatchers.clear();
    entry.pendingSubagents.clear();
    entry.activeClaudeCalls.clear();

    this.#store.rewindSession(sessionId, beforeSeq);
  }

  #known(sessionId: string): Entry {
    if (!this.#store.getSession(sessionId)) {
      throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    }
    return this.#entry(sessionId);
  }

  /** Journals the event, then broadcasts the stored form. Must never throw into the ACP layer. */
  #onEvent(sessionId: string, entry: Entry, event: NormalizedEvent): void {
    if (event.type === 'config_options') {
      // What the agent reports, minus its self-approving modes, plus the access level we enforce ourselves.
      this.#agentOptions.set(sessionId, event.options);
      event = {
        type: 'config_options',
        options: [...withResearchMode(event.options.filter((o) => o.id !== 'approval').map(trimModeOption), this.#researching(sessionId)), approvalOption(this.#approval(sessionId))],
      };
    }
    if (event.type === 'status') {
      if (event.status === 'disconnected') entry.disconnected = true;
      if (event.status !== 'running') entry.busy = false;
    }
    this.#trackSubagents(sessionId, entry, event);
    if (isEditEvent(event)) entry.edited = true;
    // The checks run once the turn is over, never while the agent is still working.
    if (event.type === 'turn_end' && event.stopReason === 'end_turn' && !event.error) setTimeout(() => this.#afterTurn(sessionId, entry), 0);
    let stored: StoredEvent;
    try {
      stored = this.#store.appendEvent(sessionId, event);
    } catch (err) {
      log(`cannot persist ${event.type} event for session ${sessionId}`, err);
      return;
    }
    // A listener may synchronously cause further events (prompt, respondPermission). Those are
    // queued and drained by the outermost loop so every listener sees events in seq order.
    entry.queue.push(stored);
    if (entry.draining) return;
    entry.draining = true;
    try {
      let next: StoredEvent | undefined;
      while ((next = entry.queue.shift())) {
        for (const listener of [...entry.listeners]) {
          try {
            listener(next);
          } catch (err) {
            log(`listener for session ${sessionId} threw`, err);
          }
        }
      }
    } finally {
      entry.draining = false;
    }
  }

  #trackSubagents(sessionId: string, entry: Entry, event: NormalizedEvent): void {
    if (event.type === 'tool_call' && /scout/i.test(event.title)) {
      (entry.callTitles ??= new Map()).set(event.id, event.title);
      if (entry.callTitles.size > 50) entry.callTitles.delete(entry.callTitles.keys().next().value!);
    }
    if (event.type === 'tool_call' && isScoutRun(event.title, event.rawInput) && !entry.subagentWatchers.has(event.id)) {
      // The scout is a Gemini run started by a shell command: follow its own conversation so its work shows live under the call.
      const watcher = new AntigravitySubagentWatcher(
        { sessionId, parentToolCallId: event.id, role: 'Gemini Scout', startedAt: Date.now(), headMarker: SCOUT_MARKER, idleTimeoutMs: SCOUT_IDLE_MS },
        (childEvent) => this.#onEvent(sessionId, entry, childEvent),
        { signal: this.#shutdown.signal },
      );
      entry.subagentWatchers.set(event.id, watcher);
      watcher.start();
    } else if (event.type === 'tool_call' && isClaudeSubagentRun(event.title, event.rawInput)) {
      entry.activeClaudeCalls.set(event.id, { id: event.id, startedAt: Date.now() });
    } else if (event.type === 'tool_call') {
      const isSubagent =
        event.title.toLowerCase().includes('invoke_subagent') ||
        event.title.toLowerCase().includes('subagent') ||
        (typeof event.rawInput === 'object' && event.rawInput !== null && 'Role' in event.rawInput && 'Prompt' in event.rawInput);
      if (isSubagent && !entry.pendingSubagents.has(event.id)) {
        const input = typeof event.rawInput === 'object' && event.rawInput !== null ? (event.rawInput as Record<string, unknown>) : {};
        const role = typeof input['Role'] === 'string' ? input['Role'] : typeof input['role'] === 'string' ? input['role'] : 'Subagent';
        const prompt = typeof input['Prompt'] === 'string' ? input['Prompt'] : typeof input['prompt'] === 'string' ? input['prompt'] : undefined;
        entry.pendingSubagents.set(event.id, { role, prompt, startedAt: Date.now() });

        const row = this.#store.getSession(sessionId);
        const watcher = new AntigravitySubagentWatcher(
          {
            sessionId,
            parentToolCallId: event.id,
            role,
            prompt,
            acpSessionId: row?.acpSessionId ?? undefined,
            startedAt: Date.now(),
          },
          (childEvent) => this.#onEvent(sessionId, entry, childEvent),
          { signal: this.#shutdown.signal },
        );
        entry.subagentWatchers.set(event.id, watcher);
        watcher.start();
      }
    } else if (event.type === 'tool_call_update') {
      if (!entry.activeClaudeCalls.has(event.id) && event.patch['rawInput'] !== undefined && isClaudeSubagentRun(typeof event.patch['title'] === 'string' ? event.patch['title'] : '', event.patch['rawInput'])) {
        entry.activeClaudeCalls.set(event.id, { id: event.id, startedAt: Date.now() });
      }
      if (!entry.subagentWatchers.has(event.id) && event.patch['rawInput'] !== undefined && isScoutRun(typeof event.patch['title'] === 'string' ? event.patch['title'] : (entry.callTitles?.get(event.id) ?? ''), event.patch['rawInput'])) {
        // Some agents send the command only after the call has started.
        const late = new AntigravitySubagentWatcher(
          { sessionId, parentToolCallId: event.id, role: 'Gemini Scout', startedAt: Date.now(), headMarker: SCOUT_MARKER, idleTimeoutMs: SCOUT_IDLE_MS },
          (childEvent) => this.#onEvent(sessionId, entry, childEvent),
          { signal: this.#shutdown.signal },
        );
        entry.subagentWatchers.set(event.id, late);
        late.start();
      }
      const status = event.patch['status'];
      if (status === 'completed' || status === 'failed') {
        entry.activeClaudeCalls.delete(event.id);
      }
      if ((status === 'completed' || status === 'failed') && !entry.pendingSubagents.has(event.id)) {
        // The command ended: read what is left of the scout's conversation, then stop following it.
        const scout = entry.subagentWatchers.get(event.id);
        if (scout) {
          entry.subagentWatchers.delete(event.id);
          void scout.settle();
        }
      }
      const pending = entry.pendingSubagents.get(event.id);
      const watcher = entry.subagentWatchers.get(event.id);
      if (pending && watcher && event.patch.rawOutput) {
        const outStr = typeof event.patch.rawOutput === 'string' ? event.patch.rawOutput : JSON.stringify(event.patch.rawOutput);
        const m = outStr.match(/"conversationId"\s*:\s*"([0-9a-f-]{36})"/i) || outStr.match(/conversation:\/\/([0-9a-f-]{36})/i);
        if (m?.[1]) {
          watcher.setConversationId(m[1]);
        }
      }
    } else if (event.type === 'agent_message') {
      const m = event.text.match(/conversation:\/\/([0-9a-f-]{36})/i);
      if (m?.[1]) {
        for (const watcher of entry.subagentWatchers.values()) {
          watcher.setConversationId(m[1]);
        }
      }
    } else if (event.type === 'status' && event.status === 'disconnected') {
      for (const watcher of entry.subagentWatchers.values()) {
        watcher.stop();
      }
      entry.subagentWatchers.clear();
      entry.pendingSubagents.clear();
      entry.activeClaudeCalls.clear();
    }
  }

  emitClaudeChildCall(
    sessionId: string,
    child: {
      id: string;
      title: string;
      kind: 'read' | 'edit' | 'execute' | 'search' | 'think' | 'other';
      rawInput?: unknown;
      status: 'in_progress' | 'completed' | 'failed';
      content?: Array<{ type: 'text'; text: string }>;
      parentToolCallId?: string;
    },
  ): void {
    if (!this.#store.getSession(sessionId)) return;
    const entry = this.#entry(sessionId);
    let parentId = child.parentToolCallId;
    if (!parentId) {
      const active = [...entry.activeClaudeCalls.values()].pop();
      if (active) parentId = active.id;
    }
    if (!parentId) return;

    if (child.status === 'in_progress') {
      this.#onEvent(sessionId, entry, {
        type: 'tool_call',
        id: child.id,
        title: child.title,
        kind: child.kind,
        status: 'in_progress',
        content: [],
        rawInput: child.rawInput,
        parent: { id: parentId, title: 'Claude Subagent' },
      });
    } else {
      this.#onEvent(sessionId, entry, {
        type: 'tool_call_update',
        id: child.id,
        patch: {
          status: child.status,
          content: child.content ?? [],
        },
      });
    }
  }
}
