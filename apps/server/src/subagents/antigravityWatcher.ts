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
  #knownCalls = new Set<string>();
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
      const lines = content.split('\n');
      // The last element might be an empty line if file ends with newline
      const validLines = lines.filter((l) => l.trim() !== '');
      if (validLines.length <= this.#lastLineIndex) return;

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
        // Complete any pending in_progress calls from previous step
        const prevStep = stepIdx - 1;
        const callPrefix = `sub_${conversationId}_${prevStep}_`;
        for (const callId of this.#knownCalls) {
          if (callId.startsWith(callPrefix)) {
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
        if (text && (!this.#finalOutput || text.length > this.#finalOutput.length)) {
          this.#finalOutput = text;
        }
      }

      // 4. If send_message was called and step is DONE, or if explicit finish signal
      if (this.#finalOutput && (data.type === 'GENERIC' || data.type === 'PLANNER_RESPONSE') && data.status === 'DONE') {
        this.#finish();
      }
    } catch {
      // ignore line parse errors
    }
  }

  #finish(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }

    // Update parent tool call with completed status and final output
    this.#emit({
      type: 'tool_call_update',
      id: this.#target.parentToolCallId,
      patch: {
        status: 'completed',
        rawOutput: this.#finalOutput ?? 'Subagent completed.',
      },
    });
  }
}
