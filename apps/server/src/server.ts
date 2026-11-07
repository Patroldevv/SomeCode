import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import type { AgentRegistry } from './agents/registry.ts';
import { createApp } from './http/app.ts';
import { attachWebSocket } from './http/ws.ts';
import { SessionManager } from './sessions/manager.ts';
import type { Store } from './store/store.ts';

/** The server only ever listens on loopback. */
const HOST = '127.0.0.1';

export type StartServerOptions = {
  store: Store;
  registry: AgentRegistry;
  token: string;
  /** Defaults to 0: a random free port. */
  port?: number;
  staticDir?: string;
};

export type RunningServer = { port: number; url: string; close(): Promise<void> };

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  if (!opts.token) throw new Error('startServer requires a non-empty token');
  const manager = new SessionManager({ store: opts.store, registry: opts.registry });
  let port = 0;
  const origin = () => `http://${HOST}:${port}`;

  const app = createApp({
    store: opts.store,
    registry: opts.registry,
    manager,
    token: opts.token,
    origin,
    staticDir: opts.staticDir,
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

  let closing: Promise<void> | undefined;
  return {
    port,
    url: origin(),
    close() {
      closing ??= (async () => {
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
