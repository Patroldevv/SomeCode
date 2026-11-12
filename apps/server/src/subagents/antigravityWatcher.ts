import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedEvent, ToolContent } from '@somecode/protocol';

export interface SubagentWatchTarget {
  sessionId: string;
  parentToolCallId: string;
  role: string;
  prompt?: string;
  acpSessionId?: string;
  conversationId?: string;
  startedAt: number;
  /**
   * Find the conversation by a phrase in its first message instead of by the parent session (a run that was not
   * started through the agent's own sub-agent tool, such as the scout).
   */
  headMarker?: string;
  /** Set the parent call's status and result when the sub-agent finishes (default); false when its own tool call does that. */
  completeParent?: boolean;
  /**
   * Give up when the conversation has been silent this long: the parent call is then marked failed (or completed
   * when the sub-agent had already answered). Without it a run that died would stay "running" forever.
   */
  idleTimeoutMs?: number;
}

function candidateBrainDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.gemini', 'antigravity-cli', 'brain'),
    path.join(home, '.gemini', 'antigravity', 'brain'),
  ];
}

export function findTranscriptPath(conversationId: string, brainDirs = candidateBrainDirs()): string | null {
  for (const brain of brainDirs) {
    const transcript = path.join(brain, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(transcript)) return transcript;
  }
  return null;
}

/** Conversations already followed by a watcher, so two runs started together do not both pick the same one. */
const claimedConversations = new Set<string>();

/** The oldest not yet followed conversation, started at or after `sinceMs`, whose first message holds `marker`. */
export function findConversationByMarker(marker: string, sinceMs: number, brainDirs = candidateBrainDirs()): string | null {
  let best: { id: string; at: number } | null = null;
  for (const brain of brainDirs) {
    if (!fs.existsSync(brain)) continue;
    try {
      for (const entry of fs.readdirSync(brain, { withFileTypes: true })) {
        if (!entry.isDirectory() || claimedConversations.has(entry.name)) continue;
        const transcript = path.join(brain, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
        let stat: fs.Stats;
        try {
          stat = fs.statSync(transcript);
        } catch {
          continue;
        }
        if (stat.mtimeMs < sinceMs - 2000 || (best && stat.birthtimeMs >= best.at)) continue;
        const fd = fs.openSync(transcript, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        if (buf.toString('utf8', 0, bytesRead).includes(marker)) best = { id: entry.name, at: stat.birthtimeMs };
      }
    } catch {
      // ignore
    }
  }
  return best?.id ?? null;
}

export function findConversationByParentAcp(parentAcpSessionId: string, sinceMs: number, brainDirs = candidateBrainDirs()): string | null {
  for (const brain of brainDirs) {
    if (!fs.existsSync(brain)) continue;
    try {
      const entries = fs.readdirSync(brain, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const transcript = path.join(brain, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
        if (!fs.existsSync(transcript)) continue;
        const stat = fs.statSync(transcript);
        if (stat.mtimeMs < sinceMs - 5000) continue;
        try {
          const fd = fs.openSync(transcript, 'r');
          const buf = Buffer.alloc(2048);
          const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);
          const head = buf.toString('utf8', 0, bytesRead);
          if (head.includes(`sender=${parentAcpSessionId}`)) {
            return entry.name;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function mapToolKind(name: string): 'read' | 'edit' | 'execute' | 'search' | 'think' | 'other' {
  const n = name.toLowerCase();
  if (n.includes('read') || n === 'cat') return 'read';
  if (n.includes('edit') || n.includes('write') || n.includes('patch')) return 'edit';
  if (n.includes('command') || n.includes('exec') || n.includes('bash') || n.includes('terminal')) return 'execute';
  if (n.includes('search') || n.includes('grep') || n.includes('find')) return 'search';
  if (n.includes('think')) return 'think';
  return 'other';
}

function cleanArg(val: unknown): string {
  if (typeof val !== 'string') return '';
  let s = val.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

function toolTitle(name: string, args?: Record<string, unknown>): string {
  if (!args) return name;
  const p = cleanArg(args['Path'] || args['path'] || args['file']);
  if (p) {
    const base = path.basename(p) || p;
    if (name.includes('read')) return `read_file ${base}`;
    if (name.includes('write') || name.includes('edit')) return `edit_file ${base}`;
    return `${name} ${base}`;
  }
  const summary = cleanArg(args['toolSummary']);
  if (summary) return summary;
  const cmd = cleanArg(args['CommandLine'] || args['command']);
  if (cmd) return cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd;
  return name;
}

export class AntigravitySubagentWatcher {
  #target: SubagentWatchTarget;
  #emit: (event: NormalizedEvent) => void;
  #signal?: AbortSignal;
  #transcriptPath: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  #closed = false;
  #lastLineIndex = 0;
  #lastActivity = Date.now();
  #knownCalls = new Set<string>();
  #inProgressCalls = new Set<string>();
  #finalOutput: string | null = null;
  #brainDirs: string[];
  #pollIntervalMs: number;

  constructor(
    target: SubagentWatchTarget,
    emit: (event: NormalizedEvent) => void,
    options?: { signal?: AbortSignal; brainDirs?: string[]; pollIntervalMs?: number },
  ) {
    this.#target = target;
    this.#emit = emit;
    this.#signal = options?.signal;
    this.#brainDirs = options?.brainDirs ?? candidateBrainDirs();
    this.#pollIntervalMs = options?.pollIntervalMs ?? 500;

    if (this.#signal) {
      if (this.#signal.aborted) {
        this.#closed = true;
        return;
      }
      this.#signal.addEventListener('abort', () => this.stop(), { once: true });
    }

    if (target.conversationId) {
      this.#transcriptPath = findTranscriptPath(target.conversationId, this.#brainDirs);
    }
  }

  setConversationId(conversationId: string): void {
    if (this.#target.conversationId === conversationId && this.#transcriptPath) return;
    this.#target.conversationId = conversationId;
    this.#transcriptPath = findTranscriptPath(conversationId, this.#brainDirs);
  }

  start(): void {
    if (this.#closed) return;
    this.#timer = setInterval(() => void this.#poll(), this.#pollIntervalMs);
    void this.#poll();
  }

  /** Reads what is left of the transcript once more, then stops (the sub-agent's own call has ended). */
  async settle(): Promise<void> {
    await this.#poll();
    this.stop();
  }

  stop(): void {
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #poll(): Promise<void> {
    if (this.#closed) return;
    if (!this.#transcriptPath) {
      if (this.#target.conversationId) {
        this.#transcriptPath = findTranscriptPath(this.#target.conversationId, this.#brainDirs);
      } else if (this.#target.headMarker) {
        const found = findConversationByMarker(this.#target.headMarker, this.#target.startedAt, this.#brainDirs);
        if (found) {
          claimedConversations.add(found);
          this.#target.conversationId = found;
          this.#transcriptPath = findTranscriptPath(found, this.#brainDirs);
        }
      } else if (this.#target.acpSessionId) {
        const found = findConversationByParentAcp(this.#target.acpSessionId, this.#target.startedAt, this.#brainDirs);
        if (found) {
          this.#target.conversationId = found;
          this.#transcriptPath = findTranscriptPath(found, this.#brainDirs);
        }
      }
      if (!this.#transcriptPath) return;
    }

    try {
      const content = await fs.promises.readFile(this.#transcriptPath, 'utf8');
      const endsWithNewline = content.endsWith('\n');
      const rawLines = content.split('\n');
      // If the file does not end with a newline, the trailing segment is still being written.
      const completeLines = endsWithNewline ? rawLines : rawLines.slice(0, -1);
      const validLines = completeLines.filter((l) => l.trim() !== '');
      if (validLines.length <= this.#lastLineIndex) {
        const idle = this.#target.idleTimeoutMs;
        if (idle !== undefined && Date.now() - this.#lastActivity > idle) this.#finish(this.#finalOutput !== null);
        return;
      }
      this.#lastActivity = Date.now();

      for (let i = this.#lastLineIndex; i < validLines.length; i++) {
        const line = validLines[i]!;
        this.#processLine(line, i);
      }
      this.#lastLineIndex = validLines.length;
    } catch {
      // file might be in the middle of being written
    }
  }

  #processLine(lineText: string, lineIndex: number): void {
    try {
      const data = JSON.parse(lineText) as {
        step_index?: number;
        source?: string;
        type?: string;
        status?: string;
        content?: string;
        tool_calls?: Array<{ name: string; args?: Record<string, unknown> }>;
      };

      const stepIdx = data.step_index ?? lineIndex;
      const conversationId = this.#target.conversationId ?? 'subagent';

      // 1. Check for tool calls made by the subagent
      if (Array.isArray(data.tool_calls) && data.tool_calls.length > 0) {
        data.tool_calls.forEach((tool, toolIdx) => {
          const callId = `sub_${conversationId}_${stepIdx}_${toolIdx}`;
          if (this.#knownCalls.has(callId)) return;
          this.#knownCalls.add(callId);
          this.#inProgressCalls.add(callId);

          if (tool.name === 'send_message') {
            const msg = cleanArg(tool.args?.['Message'] || tool.args?.['message']);
            if (msg) this.#finalOutput = msg;
          }

          this.#emit({
            type: 'tool_call',
            id: callId,
            title: toolTitle(tool.name, tool.args),
            kind: mapToolKind(tool.name),
            status: 'in_progress',
            content: [],
            rawInput: tool.args,
            parent: { id: this.#target.parentToolCallId, title: this.#target.role },
          });
        });
      }

      // 2. Check for tool completions or step results
      if (data.type === 'GENERIC' || (data.source === 'MODEL' && data.status === 'DONE')) {
        // Complete any pending in_progress calls from previous step or active in-progress calls
        const prevStep = stepIdx - 1;
        const callPrefix = `sub_${conversationId}_${prevStep}_`;
        for (const callId of [...this.#knownCalls]) {
          if (callId.startsWith(callPrefix) || this.#inProgressCalls.has(callId)) {
            this.#inProgressCalls.delete(callId);
            const contentItems: ToolContent[] = [];
            if (typeof data.content === 'string' && data.content.trim() !== '') {
              contentItems.push({ type: 'text', text: data.content });
            }
            this.#emit({
              type: 'tool_call_update',
              id: callId,
              patch: {
                status: data.status === 'ERROR' ? 'failed' : 'completed',
                content: contentItems,
              },
            });
          }
        }
      }

      // 3. Check for subagent final completion message
      if (data.type === 'PLANNER_RESPONSE' && typeof data.content === 'string') {
        const text = data.content.trim();
        const callsTools = Array.isArray(data.tool_calls) && data.tool_calls.length > 0;
        if (this.#target.headMarker) {
          // The answer is the step that calls no more tools; narration between tool calls is not it.
          if (text && !callsTools) this.#finalOutput = text;
        } else if (text && (!this.#finalOutput || text.length > this.#finalOutput.length)) {
          this.#finalOutput = text;
        }
      }

      // 4. If send_message was called and step is DONE, or if explicit finish signal
      // A run found by its first message (the scout) is over only at an answer that calls no more tools.
      const answered = data.type === 'PLANNER_RESPONSE' && data.status === 'DONE' && !(Array.isArray(data.tool_calls) && data.tool_calls.length > 0);
      if (this.#finalOutput && (this.#target.headMarker ? answered : (data.type === 'GENERIC' || data.type === 'PLANNER_RESPONSE') && data.status === 'DONE')) {
        this.#finish();
      }
    } catch {
      // ignore line parse errors
    }
  }

  #finish(ok = true): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }

    if (this.#target.completeParent === false) return;
    // Update parent tool call with completed status and final output
    this.#emit({
      type: 'tool_call_update',
      id: this.#target.parentToolCallId,
      patch: {
        status: ok ? 'completed' : 'failed',
        rawOutput: this.#finalOutput ?? (ok ? 'Subagent completed.' : 'The sub-agent stopped answering.'),
      },
    });
  }
}
