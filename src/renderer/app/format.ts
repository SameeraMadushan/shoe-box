// Dates, times and counts follow the system locale (ADR section 10 copy rules).
import { ERROR_COPY } from '../../shared/errors';
import type { MessageKind, RunSummary } from '../../shared/types';

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export const count = (n: number): string => n.toLocaleString();
export const clock = (unixS: number): string => time.format(unixS * 1000);

const startOfDay = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);
/** Whole days between a time and today: 0 today, 1 yesterday, -1 tomorrow. */
export const daysAgo = (unixS: number, now = Date.now()): number => Math.round((startOfDay(now) - startOfDay(unixS * 1000)) / 86_400_000);

/** Chat list time: clock today, then "Yesterday", weekday, date. */
export function listWhen(unixS: number | null): string {
  if (unixS === null) return '';
  const d = daysAgo(unixS);
  if (d <= 0) return clock(unixS);
  if (d === 1) return 'Yesterday';
  return d < 7 ? weekday.format(unixS * 1000) : dayMonth.format(unixS * 1000);
}

export function dayLabel(unixS: number): string {
  return daysAgo(unixS) === 0 ? 'Today' : longDay.format(unixS * 1000);
}

/** "today at 20:02", "tomorrow at 20:00", "14 Nov at 20:01". */
export function whenAt(unixS: number): string {
  const d = daysAgo(unixS);
  const day = d === 0 ? 'today' : d === 1 ? 'yesterday' : d === -1 ? 'tomorrow' : dayMonth.format(unixS * 1000);
  return `${day} at ${clock(unixS)}`;
}

export const since = (unixS: number): string => dayMonthYear.format(unixS * 1000);
export const shortDate = (unixS: number): string => (daysAgo(unixS) === 0 ? 'today' : dayMonth.format(unixS * 1000));

export function duration(seconds: number | null): string {
  if (!seconds) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function bytes(n: number): string {
  if (n < 1e6) return `${(n / 1e3).toFixed(0)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

export const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

export function kindLabel(kind: MessageKind): string {
  return { image: 'Photo', video: 'Video', voice: 'Voice note', audio: 'Audio', document: 'Document', text: '', other: 'Message' }[kind];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, /^\d/.test(words[0] ?? '') ? 2 : 1);
  return pick.toUpperCase();
}

const TINTS = ['#C9D8FA', '#CDE9D8', '#F6DEC2', '#E4D6F5', '#F5D6DE'];
export const tint = (id: number): string => TINTS[id % TINTS.length]!;

// --- backup runs ---

export const lastSuccess = (history: RunSummary[]): RunSummary | undefined => history.find((r) => r.status === 'succeeded');

export function runResult(r: RunSummary): { label: string; className: string } {
  if (r.status === 'failed') return { label: 'Failed', className: 'bad-text' };
  if (r.status === 'running') return { label: 'Running', className: 'muted' };
  return r.trigger === 'wake' ? { label: 'Delayed', className: 'late-text' } : { label: 'Succeeded', className: 'ok-text' };
}

function newItems(r: RunSummary): string {
  if (r.newMessages === 0 && r.newMedia === 0) return 'no new messages';
  const parts = [plural(r.newMessages, 'new message', 'new messages')];
  if (r.newMedia > 0) parts.push(plural(r.newMedia, 'media file', 'media files'));
  return parts.join(', ');
}

const via = (r: RunSummary): string => (r.transport === 'wifi' ? 'over Wi-Fi' : 'by cable');

/** One detail line for the history list. */
export function runDetail(r: RunSummary, scheduleTime: string): string {
  if (r.status === 'failed') return ERROR_COPY[r.errorCode ?? 'UNKNOWN'].sentence;
  const drive = r.driveStatus === 'failed' ? ' · Drive sync failed' : '';
  if (r.trigger === 'first') return `First backup · ${via(r)}${drive}`;
  if (r.trigger === 'manual') return `Manual backup · ${newItems(r)}${drive}`;
  if (r.trigger === 'wake') return `Computer was asleep at ${scheduleTime} · ran when it woke · ${newItems(r)}${drive}`;
  return `${newItems(r)} · ${via(r)}${drive}`;
}
