import WebSocket from 'ws';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
type Listener = (params: any) => void;

/** A minimal Chrome DevTools Protocol client over one WebSocket (a page, or the browser). */
export class Cdp {
  readonly #ws: WebSocket;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Map<string, Set<Listener>>();
  #next = 0;
  #closed = false;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on('message', (data) => {
      let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? 'protocol error'));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params);
      }
    });
    ws.on('close', () => this.#fail(new Error('the browser closed')));
    ws.on('error', (error) => this.#fail(error));
  }

  static connect(url: string, timeoutMs = 10_000): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 << 20 });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('the browser did not answer'));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('the browser closed'));
    const id = ++this.#next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) {
          this.#pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  on(method: string, listener: Listener): () => void {
    let set = this.#listeners.get(method);
    if (!set) this.#listeners.set(method, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Resolves with the params of the next `method` event, or rejects after the timeout. */
  once<T = any>(method: string, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`no ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve(params as T);
      });
    });
  }

  close(): void {
    this.#fail(new Error('closed'));
    this.#ws.terminate();
  }

  #fail(error: Error): void {
    this.#closed = true;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }
}
