#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultRegistry } from '../apps/server/src/agents/registry.ts';
import { dataDir } from '../apps/server/src/config.ts';
import { pickBrowserCommand } from '../apps/server/src/launcher/browser.ts';
import { useLoginPath } from '../apps/server/src/launcher/path.ts';
import { startServer, type RunningServer } from '../apps/server/src/server.ts';
import { openStore } from '../apps/server/src/store/store.ts';

// Started from the application menu, the PATH is bare: take the login shell's and the usual agent folders.
useLoginPath();

const USAGE = 'usage: somecode [--no-open] [--browser] [--port <0-65535>]\n';

function fail(message: string, code: number): never {
  process.stderr.write(`somecode: ${message}\n`);
  process.exit(code);
}

function parseCli(): { open: boolean; port: number | undefined; browser: boolean } {
  let values: { 'no-open'?: boolean; port?: string; browser?: boolean };
  try {
    ({ values } = parseArgs({
      options: { 'no-open': { type: 'boolean' }, port: { type: 'string' }, browser: { type: 'boolean' } },
      allowPositionals: false,
    }));
  } catch (err) {
    process.stderr.write(USAGE);
    fail(err instanceof Error ? err.message : String(err), 2);
  }
  let port: number | undefined;
  if (values.port !== undefined) {
    port = /^\d+$/.test(values.port) ? Number(values.port) : NaN;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      fail(`invalid --port "${values.port}": expected an integer from 0 to 65535`, 2);
    }
  }
  return { open: values['no-open'] !== true, port, browser: values.browser === true };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function pickLauncher(url: string, pathEnv: string, preferBrowser = false): { command: string; args: string[] } {
  if (!preferBrowser) {
    const desktopEntry = fileURLToPath(new URL('../desktop/main.cjs', import.meta.url));
    if (isFile(desktopEntry)) {
      const candidates = ['electron42', 'electron'];
      const dirs = (pathEnv ?? '').split(':').filter(Boolean);
      for (const name of candidates) {
        for (const dir of dirs) {
          const full = join(dir, name);
          if (isFile(full)) return { command: full, args: [desktopEntry, url] };
        }
        if (isFile(`/usr/bin/${name}`)) return { command: `/usr/bin/${name}`, args: [desktopEntry, url] };
      }
    }
  }
  return pickBrowserCommand(url, pathEnv);
}

const { open, port, browser } = parseCli();

// Resolved from this file, not the working directory, so `somecode` works from anywhere.
const staticDir = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
const hasUi = isFile(join(staticDir, 'index.html'));
if (!hasUi) {
  process.stderr.write(
    'somecode: warning: web UI not built (apps/web/dist/index.html missing); run `npm run build -w apps/web`. Serving the API only.\n',
  );
}

const token = randomBytes(24).toString('base64url');
const data = dataDir();
mkdirSync(data, { recursive: true, mode: 0o700 });
const store = openStore(join(data, 'somecode.db'));

let server: RunningServer;
try {
  server = await startServer({ store, registry: defaultRegistry(), token, port, staticDir: hasUi ? staticDir : undefined });
} catch (err) {
  store.close();
  fail(`could not start the server: ${err instanceof Error ? err.message : String(err)}`, 1);
}

const launchUrl = `${server.url}#token=${token}`;
process.stdout.write(`SomeCode: ${launchUrl}\n`);

if (open) {
  const { command, args } = pickLauncher(launchUrl, process.env.PATH ?? '', browser);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err: NodeJS.ErrnoException) => {
      process.stderr.write(`somecode: could not open a window (${err.code ?? 'error'}); open the URL above manually.\n`);
    });
    child.unref();
  } catch (err) {
    process.stderr.write(
      `somecode: could not open a window (${(err as NodeJS.ErrnoException).code ?? 'error'}); open the URL above manually.\n`,
    );
  }
}

let stopping = false;
function shutdown(signal: NodeJS.Signals): void {
  if (stopping) {
    process.stderr.write(`somecode: ${signal} again, forcing exit\n`);
    process.exit(1);
  }
  stopping = true;
  // A hung shutdown (e.g. an agent that will not die) must not leave the process stuck forever.
  setTimeout(() => {
    process.stderr.write('somecode: shutdown timed out, forcing exit\n');
    process.exit(1);
  }, 10_000).unref();
  server.close().then(
    () => {
      store.close();
      process.exit(0);
    },
    (err: unknown) => {
      process.stderr.write(`somecode: error during shutdown: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
