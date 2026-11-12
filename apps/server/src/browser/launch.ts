import { type ChildProcess, spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Chromium-family browsers that run headless, in order of preference. */
const CHROMIUMS = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'brave', 'microsoft-edge-stable'];
const ELECTRONS = ['electron42', 'electron'];

export type BrowserChoice = { kind: 'chromium' | 'electron'; command: string };

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The first browser found on `pathEnv`: a Chromium-family one, else Electron (it is Chromium and ships with SomeCode's window). */
export function findBrowser(pathEnv: string = process.env.PATH ?? '', exists: (path: string) => boolean = isExecutable): BrowserChoice | null {
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  for (const [kind, names] of [['chromium', CHROMIUMS], ['electron', ELECTRONS]] as const) {
    for (const name of names) {
      for (const dir of dirs) {
        const full = join(dir, name);
        if (exists(full)) return { kind, command: full };
      }
    }
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export type LaunchedBrowser = { port: number; pageUrl: string; close(): void };

/** Starts a hidden browser with remote debugging on a free local port and waits for its first page. */
export async function launchBrowser(choice: BrowserChoice, timeoutMs = 30_000): Promise<LaunchedBrowser> {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'somecode-browser-'));
  const hostScript = fileURLToPath(new URL('../../../../desktop/browser-host.cjs', import.meta.url));
  const common = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`];
  const args =
    choice.kind === 'chromium'
      ? ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1280,800', ...common, 'about:blank']
      : [hostScript, ...common];
  const child: ChildProcess = spawn(choice.command, args, { stdio: 'ignore', detached: false });
  let spawnError: Error | null = null;
  child.once('error', (error) => (spawnError = error));
  const cleanup = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    rmSync(profile, { recursive: true, force: true });
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) {
      cleanup();
      throw spawnError;
    }
    if (child.exitCode !== null) {
      cleanup();
      throw new Error(`the browser exited (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return { port, pageUrl: page.webSocketDebuggerUrl, close: cleanup };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  cleanup();
  throw new Error('the browser did not start in time');
}
