import type { ScheduledTask, Store } from '../store/store.ts';
import { nextRun } from '../store/schedule.ts';

/**
 * Starts the chats the user (or an agent for them) scheduled. Every `tickMs` it looks for tasks whose time has come,
 * moves each one to its next run first (so a slow start can never run it twice) and then hands it to `start`, which
 * opens a chat with the task's prompt. A task that was due while SomeCode was closed runs once when it opens again.
 */
export function createScheduler(opts: {
  store: Pick<Store, 'dueTasks' | 'recordTaskRun' | 'getTask' | 'updateTask'>;
  /** Opens a chat for the task and sends its prompt; resolves to the chat's id. */
  start: (task: ScheduledTask) => Promise<string>;
  now?: () => number;
  /** Whether due tasks run at all (the user can switch scheduling off). */
  enabled?: () => boolean;
  tickMs?: number;
  log?: (message: string, err?: unknown) => void;
}) {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const running = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  async function runTask(task: ScheduledTask, moveOn: boolean): Promise<string | null> {
    if (running.has(task.id)) return null;
    running.add(task.id);
    const at = now();
    // A due task moves to its next run before it starts; "run now" leaves a repeating task's next time alone.
    const next = task.spec.kind === 'once' ? null : moveOn ? nextRun(task.spec, at) : task.nextRun;
    try {
      if (moveOn) opts.store.updateTask(task.id, { nextRun: next });
      const sessionId = await opts.start(task);
      opts.store.recordTaskRun(task.id, { at, sessionId, nextRun: next });
      return sessionId;
    } catch (err) {
      log(`scheduled task "${task.title}" could not start`, err);
      return null;
    } finally {
      running.delete(task.id);
    }
  }

  return {
    /** Runs what is due now; resolves when those chats have been started. */
    async tick(): Promise<number> {
      if (opts.enabled && !opts.enabled()) return 0;
      const due = opts.store.dueTasks(now());
      await Promise.all(due.map((task) => runTask(task, true)));
      return due.length;
    },
    /** "Run now" for a task, whatever its schedule (a repeating task keeps its next time). */
    async runNow(id: string): Promise<string | null> {
      const task = opts.store.getTask(id);
      if (!task) return null;
      return runTask(task, false);
    },
    start(): void {
      if (timer) return;
      timer = setInterval(() => void this.tick(), opts.tickMs ?? 20_000);
      timer.unref();
      void this.tick();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
export type Scheduler = ReturnType<typeof createScheduler>;
