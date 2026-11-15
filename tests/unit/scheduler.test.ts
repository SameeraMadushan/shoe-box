import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorCode } from '../../src/shared/errors';
import type { Trigger } from '../../src/shared/types';
import { dueSlot, MAX_RETRIES, nextSlot, RETRY_DELAY_MS, Scheduler, WAKE_DELAY_MS } from '../../src/main/scheduler/scheduler';

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const MINUTE = 60_000;

/** A fake app around the scheduler: what the phone does, and what got recorded. */
function harness(outcomes: (ErrorCode | 'ok')[] = []) {
  const state = { enabled: true, time: '20:00', lastHandledDue: 0, lastSuccess: null as number | null, running: false };
  const attempts: { trigger: Trigger; final: boolean; at: number }[] = [];
  const notified: ErrorCode[] = [];
  const scheduler = new Scheduler({
    config: () => ({ enabled: state.enabled, time: state.time, lastHandledDue: state.lastHandledDue }),
    lastSuccessAt: () => state.lastSuccess,
    isRunning: () => state.running,
    attempt: async (trigger, final) => {
      attempts.push({ trigger, final, at: Date.now() });
      const outcome = outcomes.shift() ?? 'ok';
      if (outcome === 'ok') {
        state.lastSuccess = Date.now();
        return { ok: true };
      }
      return { ok: false, code: outcome };
    },
    markHandled: (slot) => (state.lastHandledDue = slot),
    notifyFailure: (code) => notified.push(code),
  });
  return { state, attempts, notified, scheduler };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('slots', () => {
  it('finds the most recent and the next scheduled time', () => {
    expect(dueSlot(at(15, 19, 59), '20:00')).toBe(at(14, 20));
    expect(dueSlot(at(15, 20, 0), '20:00')).toBe(at(15, 20));
    expect(nextSlot(at(15, 19, 59), '20:00')).toBe(at(15, 20));
    expect(nextSlot(at(15, 20, 0), '20:00')).toBe(at(16, 20));
  });
});

describe('scheduler', () => {
  it('runs at the scheduled time and only once that day', async () => {
    vi.setSystemTime(at(15, 19, 58));
    const h = harness();
    h.state.lastSuccess = at(14, 20, 1); // yesterday's backup worked
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(MINUTE); // 19:59
    expect(h.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(MINUTE); // 20:00
    expect(h.attempts).toEqual([{ trigger: 'scheduled', final: false, at: at(15, 20) }]);
    await vi.advanceTimersByTimeAsync(6 * 60 * MINUTE); // rest of the evening
    expect(h.attempts).toHaveLength(1);
    expect(h.state.lastHandledDue).toBe(at(15, 20));
    h.scheduler.stop();
  });

  it('runs a missed backup after wake, 60 seconds later, as trigger "wake"', async () => {
    vi.setSystemTime(at(15, 23, 10)); // asleep at 20:00, woke at 23:10
    const h = harness();
    h.state.lastSuccess = at(14, 20, 1);
    void h.scheduler.check('resume');
    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS - 1);
    expect(h.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.attempts).toEqual([{ trigger: 'wake', final: false, at: at(15, 23, 11) }]);
  });

  it('runs a missed backup at app start too', async () => {
    vi.setSystemTime(at(16, 9, 0)); // computer was off overnight
    const h = harness();
    h.state.lastSuccess = at(14, 20, 1);
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS);
    expect(h.attempts.map((a) => a.trigger)).toEqual(['wake']);
    // One late run covers the missed day; nothing else runs until tonight's slot.
    await vi.advanceTimersByTimeAsync(10 * 60 * MINUTE);
    expect(h.attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60 * MINUTE + MINUTE);
    expect(h.attempts.map((a) => a.trigger)).toEqual(['wake', 'scheduled']);
    h.scheduler.stop();
  });

  it('does not run when a backup already succeeded since the scheduled time', async () => {
    vi.setSystemTime(at(15, 20, 30));
    const h = harness();
    h.state.lastSuccess = at(15, 20, 5); // manual backup at 20:05
    await h.scheduler.check('resume');
    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS * 2);
    expect(h.attempts).toHaveLength(0);
    expect(h.state.lastHandledDue).toBe(at(15, 20));
  });

  it('retries every 30 minutes when the phone is not found, then fails and notifies', async () => {
    vi.setSystemTime(at(15, 20, 0));
    const h = harness(Array(MAX_RETRIES + 1).fill('DEVICE_NOT_FOUND'));
    h.state.lastSuccess = at(14, 20, 1);
    void h.scheduler.check('timer');
    await vi.advanceTimersByTimeAsync(MAX_RETRIES * RETRY_DELAY_MS + MINUTE);
    expect(h.attempts.map((a) => [a.trigger, a.final, (a.at - at(15, 20)) / MINUTE])).toEqual([
      ['scheduled', false, 0],
      ['retry', false, 30],
      ['retry', false, 60],
      ['retry', false, 90],
      ['retry', true, 120], // only the last attempt records the failure
    ]);
    expect(h.notified).toEqual(['DEVICE_NOT_FOUND']);
    // The day is settled: no further attempts until tomorrow's slot.
    await vi.advanceTimersByTimeAsync(5 * 60 * MINUTE);
    void h.scheduler.check('timer');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(h.attempts).toHaveLength(MAX_RETRIES + 1);
  });

  it('stops retrying as soon as the phone is found', async () => {
    vi.setSystemTime(at(15, 20, 0));
    const h = harness(['DEVICE_NOT_FOUND', 'ok']);
    h.state.lastSuccess = at(14, 20, 1);
    void h.scheduler.check('timer');
    await vi.advanceTimersByTimeAsync(3 * RETRY_DELAY_MS);
    expect(h.attempts.map((a) => a.trigger)).toEqual(['scheduled', 'retry']);
    expect(h.notified).toEqual([]);
  });

  it('fails immediately, without retries, on any other error', async () => {
    vi.setSystemTime(at(15, 20, 0));
    const h = harness(['WRONG_PASSWORD']);
    h.state.lastSuccess = at(14, 20, 1);
    void h.scheduler.check('timer');
    await vi.advanceTimersByTimeAsync(3 * RETRY_DELAY_MS);
    expect(h.attempts).toHaveLength(1);
    expect(h.notified).toEqual(['WRONG_PASSWORD']);
  });

  it('does nothing while disabled or while another run is active', async () => {
    vi.setSystemTime(at(15, 20, 0));
    const h = harness();
    h.state.lastSuccess = at(14, 20, 1);
    h.state.enabled = false;
    await h.scheduler.check('timer');
    h.state.enabled = true;
    h.state.running = true;
    await h.scheduler.check('timer');
    expect(h.attempts).toHaveLength(0);
  });

  it('never starts two runs for overlapping checks', async () => {
    vi.setSystemTime(at(15, 23, 0));
    const h = harness();
    h.state.lastSuccess = at(14, 20, 1);
    void h.scheduler.check('resume');
    void h.scheduler.check('resume'); // unlock-screen fires right after resume
    void h.scheduler.check('timer');
    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS * 3);
    expect(h.attempts).toHaveLength(1);
  });
});
