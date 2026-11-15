import { utilityProcess, type UtilityProcess } from 'electron';
import { AppError, type ErrorCode } from '../shared/errors';
import type { WorkerMethods } from '../worker';

type Progress = { phase: 2 | 3; fraction: number };

/** Typed request/response channel to the worker utilityProcess. */
export class WorkerClient {
  private child: UtilityProcess;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  onProgress: (p: Progress) => void = () => {};

  constructor(modulePath: string) {
    this.child = utilityProcess.fork(modulePath, [], { serviceName: 'Chat Archive worker' });
    this.child.on('message', (msg: { id?: number; result?: unknown; error?: { code: ErrorCode }; event?: string; payload?: Progress }) => {
      if (msg.event === 'progress' && msg.payload) return this.onProgress(msg.payload);
      const w = msg.id === undefined ? undefined : this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id!);
      if (msg.error) w.reject(new AppError(msg.error.code));
      else w.resolve(msg.result);
    });
    this.child.on('exit', () => {
      for (const w of this.waiting.values()) w.reject(new AppError('INTERRUPTED', 'Worker exited'));
      this.waiting.clear();
    });
  }

  call<K extends keyof WorkerMethods>(method: K, ...args: Parameters<WorkerMethods[K]>): Promise<Awaited<ReturnType<WorkerMethods[K]>>> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child.postMessage({ id, method, args });
    });
  }

  kill(): void {
    this.child.kill();
  }
}
