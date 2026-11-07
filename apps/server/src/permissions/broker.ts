import { randomUUID } from 'node:crypto';

type Resolver = (optionId: string | null) => void;

export class PermissionBroker {
  private readonly pending = new Map<string, Resolver>();

  request(): { requestId: string; decision: Promise<string | null> } {
    const requestId = randomUUID();
    const decision = new Promise<string | null>((resolve) => {
      this.pending.set(requestId, resolve);
    });
    return { requestId, decision };
  }

  respond(requestId: string, optionId: string | null): boolean {
    const resolve = this.pending.get(requestId);
    if (!resolve) return false;
    this.pending.delete(requestId);
    resolve(optionId);
    return true;
  }

  cancelAll(): number {
    const resolvers = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of resolvers) resolve(null);
    return resolvers.length;
  }
}
