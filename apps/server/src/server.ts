import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import type { AgentRegistry } from './agents/registry.ts';
import { createApp } from './http/app.ts';
import { createLaunchCodes } from './http/launch.ts';
import { createScheduler } from './scheduler/scheduler.ts';
import type { UsageHistoryService } from './usage/history.ts';
import { attachWebSocket } from './http/ws.ts';
import { SessionManager } from './sessions/manager.ts';
import { readSettings } from './settings.ts';
import { TerminalService } from './workspace/index.ts';
import type { Store } from './store/store.ts';

/** The server only ever listens on loopback. */
const HOST = '127.0.0.1';

export type StartServerOptions = {
  store: Store;
  registry: AgentRegistry;
  token: string;
  /** Where `GET /api/usage/history` reads token use from (the app makes its own when left out). */
  usageHistory?: UsageHistoryService;
  /** Defaults to 0: a random free port. */
  port?: number;
  staticDir?: string;
};

export type RunningServer = {
  port: number;
  url: string;
  /** A one-time code for the address that opens the interface (instead of putting the token in it). */
  launchCode(): string;
  close(): Promise<void>;
};

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  if (!opts.token) throw new Error('startServer requires a non-empty token');
  let port = 0;
  const origin = () => `http://${HOST}:${port}`;
  const manager = new SessionManager({
    store: opts.store,
    registry: opts.registry,
    settings: () => readSettings(opts.store),
    url: origin,
    token: opts.token,
  });
  const terminals = new TerminalService();
  const launchCodes = createLaunchCodes();
  const scheduler = createScheduler({
    store: opts.store,
    enabled: () => readSettings(opts.store).scheduledTasks,
    log: (message, err) => process.stderr.write(`somecode: ${message}${err instanceof Error ? `: ${err.message}` : ''}\n`),
    // A scheduled task opens a chat of its own and sends the prompt, like the user would.
    start: async (task) => {
      const row = await manager.createSession(task.projectId, task.agentId);
      opts.store.renameSession(row.id, `⏰ ${task.title}`);
      manager.prompt(row.id, task.prompt);
      return row.id;
    },
  });

  const app = createApp({
    store: opts.store,
    registry: opts.registry,
    manager,
    token: opts.token,
    origin,
    staticDir: opts.staticDir,
    terminals,
    launchCodes,
    scheduler,
    ...(opts.usageHistory ? { usageHistory: opts.usageHistory } : {}),
  });
  const server = createAdaptorServer({ fetch: app.fetch, hostname: HOST }) as Server;
  const ws = attachWebSocket(server, { manager, token: opts.token, origin });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  scheduler.start();

  let closing: Promise<void> | undefined;
  return {
    port,
    url: origin(),
    launchCode: () => launchCodes.issue(),
    close() {
      closing ??= (async () => {
        scheduler.stop();
        await terminals.closeAll();
        ws.close();
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeAllConnections();
        await closed;
        await manager.closeAll();
      })();
      return closing;
    },
  };
}
