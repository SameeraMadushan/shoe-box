import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { initLog, log, redact } from '../../src/main/log';
import { parseRange } from '../../src/main/media-protocol';

it('redacts identifying details from tool output before logging', () => {
  const out = redact(
    'ERROR: Device 00008120-001A2B3C4D5E6F01 "Sam\'s iPhone" at /Users/sam/ChatArchive/backup failed for 15550101@s.whatsapp.net tel 447700900123',
  );
  for (const leak of ['00008120', 'Sam', '/Users', 'whatsapp', '15550101', '447700900123']) expect(out).not.toContain(leak);
  expect(out).toContain('ERROR: Device [device]');
  expect(redact('C:\\Users\\sam\\ChatArchive missing')).not.toContain('sam');
});

it('writes structured log lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ca-log-'));
  initLog(dir);
  log('run_failed', { runId: 3, code: 'DEVICE_NOT_FOUND', ms: 1200 });
  const line = JSON.parse(readFileSync(join(dir, 'app.log'), 'utf8').trim()) as Record<string, unknown>;
  expect(line).toMatchObject({ event: 'run_failed', runId: 3, code: 'DEVICE_NOT_FOUND', ms: 1200 });
});

it('parses media byte ranges', () => {
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
  expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
  expect(parseRange('bytes=1000-', 1000)).toBeNull();
  expect(parseRange(null, 1000)).toBeNull();
});
