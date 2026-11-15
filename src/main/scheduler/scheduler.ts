// Daily backup scheduler (ADR section 6). Pure logic: time comes from Date.now and
// timers from setTimeout, so tests drive it with a fake clock.
import type { ErrorCode } from '../../shared/errors';
import type { Trigger } from '../../shared/types';

export const WAKE_DELAY_MS = 60_000;
export const RETRY_DELAY_MS = 30 * 60_000;
export const MAX_RETRIES = 4;
/** A slot noticed later than this by the minute timer was missed (asleep or busy). */
const LATE_MS = 90_000;

export interface SchedulerDeps {
  /** enabled is false while onboarding is incomplete or secrets cannot be stored. */
  config(): { enabled: boolean; time: string; lastHandledDue: number };
  /** Start time (ms) of the most recent successful run, if any. */
  lastSuccessAt(): number | null;
  isRunning(): boolean;
  /** One backup attempt. `final` tells the runner to record a "not found" failure. */
  attempt(trigger: Trigger, final: boolean): Promise<{ ok: true } | { ok: false; code: ErrorCode }>;
  markHandled(slot: number): void;
  notifyFailure(code: ErrorCode): void;
}

function slotOn(day: Date, time: string, dayOffset: number): number {
  const [h = 20, m = 0] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + dayOffset, h, m).getTime();
}

/** The most recent scheduled instant at or before `now`. */
export function dueSlot(now: number, time: string): number {
  const today = slotOn(new Date(now), time, 0);
  return today <= now ? today : slotOn(new Date(now), time, -1);
}

/** The next scheduled instant after `now`. */
export function nextSlot(now: number, time: string): number {
  const today = slotOn(new Date(now), time, 0);
  return today > now ? today : slotOn(new Date(now), time, 1);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Scheduler {
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  /** Checks at start, then every minute (rule 3). Power events call check('resume'). */
  start(): void {
    void this.check('start');
    this.timer = setInterval(() => void this.check('timer'), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(reason: 'timer' | 'start' | 'resume'): Promise<void> {
    if (this.busy || this.deps.isRunning()) return; // rule 5: one run at a time
    const cfg = this.deps.config();
    if (!cfg.enabled) return;
    const slot = dueSlot(Date.now(), cfg.time);
    if (slot <= cfg.lastHandledDue) return; // rule 7: one scheduled backup per day
    if ((this.deps.lastSuccessAt() ?? 0) >= slot) return this.deps.markHandled(slot); // rule 2

    this.busy = true;
    try {
      const late = reason !== 'timer' || Date.now() - slot > LATE_MS;
      if (late) await sleep(WAKE_DELAY_MS); // rule 4: let Wi-Fi reconnect
      await this.runSlot(slot, late ? 'wake' : 'scheduled');
    } finally {
      this.busy = false;
    }
  }

  private async runSlot(slot: number, trigger: Trigger): Promise<void> {
    for (let retry = 0; ; retry++) {
      // A manual backup may have succeeded while we were waiting.
      if ((this.deps.lastSuccessAt() ?? 0) >= slot) break;
      const final = retry === MAX_RETRIES;
      const result = await this.deps.attempt(retry === 0 ? trigger : 'retry', final);
      if (result.ok) break;
      // Rule 6: only "phone not found" is retried; other errors fail immediately.
      if (result.code !== 'DEVICE_NOT_FOUND' || final) {
        this.deps.notifyFailure(result.code);
        break;
      }
      await sleep(RETRY_DELAY_MS);
    }
    this.deps.markHandled(slot);
  }
}
