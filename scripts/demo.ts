#!/usr/bin/env node
// UI demo server: the built web UI against a scripted fake agent ("Demo agent", id `demo`) that
// plays the `rich` scenario, with a throw-away data directory. Never opens a browser.
//
//   npm run build -w apps/web && npm run demo [-- --port <0-65535>]
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../apps/server/src/agents/registry.ts';
import { startServer, type RunningServer } from '../apps/server/src/server.ts';
import { openStore } from '../apps/server/src/store/store.ts';
import { fakeDriver } from '../apps/server/test-support/fake-driver.ts';

const USAGE = 'usage: node scripts/demo.ts [--port <0-65535>]\n';

function fail(message: string, code: number): never {
  process.stderr.write(`demo: ${message}\n`);
  process.exit(code);
}

let values: { port?: string };
try {
  ({ values } = parseArgs({ options: { port: { type: 'string' } }, allowPositionals: false }));
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

const staticDir = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
try {
  if (!statSync(join(staticDir, 'index.html')).isFile()) throw new Error('not a file');
} catch {
  fail('web UI not built; run `npm run build -w apps/web` first', 1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'somecode-demo-'));
const store = openStore(join(tempDir, 'somecode.db'));
const token = randomBytes(24).toString('base64url');
const registry = createRegistry([{ ...fakeDriver('rich', 'demo'), label: 'Demo agent' }]);

let server: RunningServer;
try {
  server = await startServer({ store, registry, token, port, staticDir });
} catch (err) {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
  fail(`could not start the server: ${err instanceof Error ? err.message : String(err)}`, 1);
}

process.stdout.write(`SomeCode demo: ${server.url}#token=${token}\n`);

let stopping = false;
function shutdown(signal: NodeJS.Signals): void {
  if (stopping) {
    process.stderr.write(`demo: ${signal} again, forcing exit\n`);
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }
  stopping = true;
  setTimeout(() => {
    process.stderr.write('demo: shutdown timed out, forcing exit\n');
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }, 10_000).unref();
  server.close().then(
    () => {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
      process.exit(0);
    },
    (err: unknown) => {
      process.stderr.write(`demo: error during shutdown: ${err instanceof Error ? err.message : String(err)}\n`);
      rmSync(tempDir, { recursive: true, force: true });
      process.exit(1);
    },
  );
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
