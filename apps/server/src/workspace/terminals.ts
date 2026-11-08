import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';
import { SomeCodeError } from '@somecode/protocol';

/**
 * node-pty is a native module; on a computer where it cannot be loaded (a system library that is too old) only
 * the terminal is unavailable, not the whole app, so it is loaded on first use.
 */
function loadPty(): typeof import('node-pty') {
  try {
    return createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
  } catch {
    throw new SomeCodeError('internal', 'the terminal is not available on this computer');
  }
}

type Terminal = { pty: IPty; output: string; cursor: number; exited: boolean; exitCode: number | null; lastUsed: number; cleanup?: Promise<void> };
type TerminalOptions = { maxTerminals?: number; maxOutputChars?: number; idleTimeoutMs?: number };
export type TerminalOutput = { output: string; cursor: number; exited: boolean; exitCode: number | null; truncated: boolean };

export class TerminalService {
  private readonly terminals = new Map<string, Terminal>();
  private readonly maxTerminals: number;
  private readonly maxOutputChars: number;
  private readonly idleTimeoutMs: number;
  private readonly idleTimer: ReturnType<typeof setInterval>;
  private readonly closing = new Set<Promise<void>>();
  private closed = false;

  constructor(options: TerminalOptions = {}) {
    this.maxTerminals = options.maxTerminals ?? 8;
    this.maxOutputChars = options.maxOutputChars ?? 256 * 1024;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
    this.idleTimer = setInterval(() => this.reapExpired(), Math.min(this.idleTimeoutMs, 60_000));
    this.idleTimer.unref();
  }

  create(options: { cwd: string; command?: string; args?: string[] }): { id: string } {
    if (this.closed) throw new SomeCodeError('bad_request', 'terminal service has closed');
    this.reapExpired();
    for (const [id, terminal] of this.terminals) {
      if (this.terminals.size < this.maxTerminals) break;
      if (terminal.exited) void this.remove(id);
    }
    const active = [...this.terminals.values()].filter((terminal) => !terminal.exited).length;
    if (this.terminals.size >= this.maxTerminals || active + this.closing.size >= this.maxTerminals) throw new SomeCodeError('bad_request', 'terminal limit reached; close an existing terminal');
    const shell = process.env.SHELL;
    const command = options.command ?? (shell && isAbsolute(shell) ? shell : '/bin/sh');
    let pty: IPty;
    try {
      pty = loadPty().spawn(command, options.args ?? [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: options.cwd, env: { ...process.env, TERM: 'xterm-256color' } });
    } catch (err) {
      if (err instanceof SomeCodeError) throw err;
      throw new SomeCodeError('bad_request', 'terminal process could not be started');
    }
    const id = randomUUID();
    const terminal: Terminal = { pty, output: '', cursor: 0, exited: false, exitCode: null, lastUsed: Date.now() };
    this.terminals.set(id, terminal);
    pty.onData((chunk) => {
      terminal.cursor += chunk.length;
      terminal.output = (terminal.output + chunk).slice(-this.maxOutputChars);
    });
    pty.onExit(({ exitCode }) => {
      terminal.exited = true;
      terminal.exitCode = exitCode;
      // A shell may exit while background jobs in the same PTY session survive.
      void this.terminate(terminal);
    });
    return { id };
  }

  private get(id: string): Terminal {
    this.reapExpired();
    const terminal = this.terminals.get(id);
    if (!terminal) throw new SomeCodeError('not_found', 'terminal not found');
    terminal.lastUsed = Date.now();
    return terminal;
  }

  read(id: string, after = 0): TerminalOutput {
    if (!Number.isSafeInteger(after) || after < 0) throw new SomeCodeError('bad_request', 'after must be a nonnegative integer');
    const terminal = this.get(id);
    if (after > terminal.cursor) throw new SomeCodeError('bad_request', 'cursor exceeds terminal output');
    const start = terminal.cursor - terminal.output.length;
    return { output: terminal.output.slice(Math.max(0, after - start)), cursor: terminal.cursor, exited: terminal.exited, exitCode: terminal.exitCode, truncated: after < start };
  }

  write(id: string, data: string): void {
    if (typeof data !== 'string' || Buffer.byteLength(data) > 64 * 1024) throw new SomeCodeError('bad_request', 'terminal input must be at most 64 KiB');
    const terminal = this.get(id);
    if (terminal.exited) throw new SomeCodeError('bad_request', 'terminal has exited');
    // node-pty 1.1.0 has no public write/drain callback and otherwise queues input
    // without bounds. Inspect its Unix queue; fail closed if that contract changes.
    const queue = (terminal.pty as IPty & { _writeStream?: { _writeQueue?: Array<{ buffer: Buffer; offset: number }> } })._writeStream?._writeQueue;
    if (!Array.isArray(queue) || queue.some((item) => !Buffer.isBuffer(item.buffer) || !Number.isInteger(item.offset))) throw new SomeCodeError('bad_request', 'terminal input backpressure is unavailable');
    const pending = queue.reduce((bytes, item) => bytes + item.buffer.length - item.offset, 0);
    if (pending + Buffer.byteLength(data) > 256 * 1024) throw new SomeCodeError('bad_request', 'terminal input is full; wait before typing again');
    terminal.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 1 || rows > 200) throw new SomeCodeError('bad_request', 'terminal dimensions must be 2–500 columns and 1–200 rows');
    const terminal = this.get(id);
    if (terminal.exited) throw new SomeCodeError('bad_request', 'terminal has exited');
    terminal.pty.resize(cols, rows);
  }

  remove(id: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new SomeCodeError('not_found', 'terminal not found');
    this.terminals.delete(id);
    return this.terminate(terminal);
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    clearInterval(this.idleTimer);
    for (const id of [...this.terminals.keys()]) void this.remove(id);
    await Promise.all([...this.closing]);
  }

  private reapExpired(): void {
    for (const [id, terminal] of this.terminals) {
      if (Date.now() - terminal.lastUsed >= this.idleTimeoutMs) {
        this.terminals.delete(id);
        void this.terminate(terminal);
      }
    }
  }

  private terminate(terminal: Terminal): Promise<void> {
    if (terminal.cleanup) return terminal.cleanup;
    const sessionId = terminal.pty.pid;
    const groups = (): Set<number> => {
      const result = new Set<number>();
      // forkpty creates a new Linux session. Shell job control can create several
      // process groups, so signal every group in the session, not only the shell.
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const record = readFileSync(`/proc/${entry}/stat`, 'utf8');
          const fields = record.slice(record.lastIndexOf(')') + 2).split(' ');
          if (fields[0] !== 'Z' && Number(fields[3]) === sessionId) result.add(Number(fields[2]));
        } catch { /* Process exited while scanning. */ }
      }
      return result;
    };
    const signal = (targets: Set<number>, value: NodeJS.Signals): void => {
      for (const group of targets) {
        if (group <= 1) continue;
        try { process.kill(-group, value); } catch { /* Already exited. */ }
      }
    };
    const initial = groups();
    if (!initial.size) return terminal.cleanup = Promise.resolve();
    signal(initial, 'SIGTERM');
    const cleanup = new Promise<void>((resolve) => {
      setTimeout(() => {
        signal(groups(), 'SIGKILL');
        this.closing.delete(cleanup);
        resolve();
      }, 200);
    });
    terminal.cleanup = cleanup;
    this.closing.add(cleanup);
    return cleanup;
  }
}
