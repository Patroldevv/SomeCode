import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TerminalService } from './index.ts';

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('terminal did not reach expected state');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** With a 50 ms idle timeout a finished terminal may already be gone by the time we look: that counts as exited. */
function exitedOrReaped(terminals: TerminalService, id: string): boolean {
  try {
    return terminals.read(id).exited;
  } catch {
    return true;
  }
}

describe('local PTY terminals', () => {
  it('frees terminal capacity after natural exit and idle expiry', async () => {
    const terminals = new TerminalService({ maxTerminals: 1, idleTimeoutMs: 50 });
    try {
      const first = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', 'exit 0'] });
      await waitFor(() => exitedOrReaped(terminals, first.id));
      const second = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', 'sleep 30'] });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(() => terminals.read(second.id)).toThrow();
      const third = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', 'exit 0'] });
      await waitFor(() => exitedOrReaped(terminals, third.id));
    } finally { await terminals.closeAll(); }
  });
  it('force-cleans a shell and child that ignore graceful shutdown signals', async () => {
    const terminals = new TerminalService();
    const pids: number[] = [];
    try {
      const { id } = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', `trap '' HUP TERM; /bin/sh -c 'trap "" HUP TERM; printf "child:%s\\n" "$$"; while :; do sleep 1; done' & printf 'parent:%s\\n' "$$"; wait`] });
      await waitFor(() => /child:\d+/.test(terminals.read(id).output));
      pids.push(...Array.from(terminals.read(id).output.matchAll(/(?:parent|child):(\d+)/g), (match) => Number(match[1])));
      expect(pids.length).toBe(2);
      await terminals.closeAll();
      await waitFor(() => pids.every((pid) => {
        try {
          process.kill(pid, 0);
          return readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z ');
        } catch { return true; }
      }));
    } finally {
      await terminals.closeAll();
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });
  it('rejects aggregate pending input to a terminal that does not read', async () => {
    const terminals = new TerminalService();
    try {
      const { id } = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', 'stty raw -echo; printf ready; exec sleep 30'] });
      await waitFor(() => terminals.read(id).output.includes('ready'));
      let accepted = 0;
      for (let index = 0; index < 100; index++) {
        try { terminals.write(id, 'x'.repeat(65536)); accepted++; } catch { break; }
      }
      expect(accepted).toBeLessThanOrEqual(5);
      expect(accepted).toBeGreaterThan(0);
    } finally { await terminals.closeAll(); }
  });
  it('accepts input, resizes, reports output cursors and process exit', async () => {
    const terminals = new TerminalService();
    try {
      const { id } = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: [] });
      terminals.resize(id, 100, 30);
      terminals.write(id, "printf 'pty-success\\n'; exit 7\n");
      await waitFor(() => terminals.read(id).exited);
      const state = terminals.read(id);
      expect(state.output).toContain('pty-success');
      expect(state.exitCode).toBe(7);
      expect(terminals.read(id, state.cursor).output).toBe('');
      expect(() => terminals.write(id, 'x')).toThrow();
      await terminals.remove(id);
      expect(() => terminals.read(id)).toThrow();
    } finally { await terminals.closeAll(); }
  });
  it('bounds retained output, terminal count, writes and dimensions', async () => {
    const terminals = new TerminalService({ maxTerminals: 1, maxOutputChars: 1024 });
    try {
      const { id } = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', "printf '%020000d' 0"] });
      expect(() => terminals.create({ cwd: '/tmp' })).toThrow();
      expect(() => terminals.resize(id, 0, 24)).toThrow();
      expect(() => terminals.resize(id, 80, 10000)).toThrow();
      expect(() => terminals.write(id, 'x'.repeat(70000))).toThrow();
      expect(() => terminals.read(id, -1)).toThrow();
      await waitFor(() => terminals.read(id).exited);
      const result = terminals.read(id);
      expect(result.output.length).toBeLessThanOrEqual(1024);
      expect(result.truncated).toBe(true);
      expect(result.cursor).toBeGreaterThan(1024);
      await terminals.closeAll();
      expect(() => terminals.read(id)).toThrow();
    } finally { await terminals.closeAll(); }
  });
  it('kills live local shell processes on shutdown', async () => {
    const terminals = new TerminalService();
    let pid = 0;
    try {
      const { id } = terminals.create({ cwd: '/tmp', command: '/bin/sh', args: ['-c', 'printf "%s\\n" "$$"; exec sleep 30'] });
      await waitFor(() => /\d+/.test(terminals.read(id).output));
      pid = Number(terminals.read(id).output.trim());
      expect(() => process.kill(pid, 0)).not.toThrow();
      await terminals.closeAll();
      await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    } finally {
      await terminals.closeAll();
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });
});
