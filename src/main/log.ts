// Privacy-safe logging (ADR section 7): run ids, error codes, counts and durations only.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const FILES = 3;
let dir: string | null = null;

export function initLog(logDir: string): void {
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  dir = logDir;
}

type Field = string | number | boolean | null | undefined;

/**
 * Strips anything that could identify a person or leak a secret from tool output:
 * quoted strings, paths, e-mail-like ids, device ids and long digit runs.
 */
export function redact(text: string): string {
  return text
    .replace(/"[^"]*"|'[^']*'/g, '[quoted]')
    .replace(/\S+@\S+/g, '[id]')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s:]+/g, '[path]')
    .replace(/\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}\b|\b[0-9a-fA-F]{24,}\b/g, '[device]')
    .replace(/\d{5,}/g, '[number]')
    .slice(0, 400);
}

/** Field values must be codes, counts or durations: never chat content, names or secrets. */
export function log(event: string, fields: Record<string, Field> = {}): void {
  if (!dir) return;
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...fields }) + '\n';
  const file = join(dir, 'app.log');
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
      rmSync(join(dir, `app.${FILES - 1}.log`), { force: true });
      for (let i = FILES - 2; i >= 1; i--) renameIfExists(join(dir, `app.${i}.log`), join(dir, `app.${i + 1}.log`));
      renameIfExists(file, join(dir, 'app.1.log'));
    }
    appendFileSync(file, line, { mode: 0o600 });
  } catch {
    // Logging must never break a backup.
  }
}

function renameIfExists(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    // nothing to rotate
  }
}
