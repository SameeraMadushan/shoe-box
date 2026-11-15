// Pure parsers for libimobiledevice tool output, written against the 1.4.0 sources
// (tools/idevice_id.c, idevicepair.c, ideviceinfo.c, idevicebackup2.c).
import type { ErrorCode } from '../../shared/errors';

/** `idevice_id -l` / `-n`: one UDID per line. */
export function parseUdids(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]!).filter((l) => /^[0-9A-Fa-f-]{20,}$/.test(l));
}

/**
 * idevicebackup2 prints "[====   ]  42% Finished" for overall progress and
 * "[====   ]  42% (1.2 MB/3.0 MB)" for the current file. Only the first counts.
 */
export function parseBackupProgress(chunk: string): number | null {
  const all = [...chunk.matchAll(/\]\s+(\d{1,3})% Finished/g)];
  const last = all.at(-1);
  return last ? Math.min(100, Number(last[1])) : null;
}

/** `ideviceinfo -q <domain>`: "Key: value" lines. */
export function parseKeyValues(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf(': ');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 2).trim();
  }
  return out;
}

const PATTERNS: [RegExp, ErrorCode][] = [
  [/No device found|Device \S+ not found|Unable to connect to device/i, 'DEVICE_NOT_FOUND'],
  [/passcode is set|Password protected|ErrorCode 208|Device locked/i, 'DEVICE_LOCKED'],
  [/accept the trust dialog|not paired with this host|denied the trust dialog|Pairing failed|Invalid HostID|Pairing dialog response pending|User denied pairing/i, 'NOT_TRUSTED'],
  [/ErrorCode 105|No space left|Insufficient free disk space|ENOSPC/i, 'DISK_FULL'],
  [/ErrorCode 207|Invalid password|password.*(incorrect|wrong)/i, 'WRONG_PASSWORD'],
  [/Backup Aborted|Abort|disconnect|Mux error|Receive timeout|SSL error/i, 'INTERRUPTED'],
];

/** Maps tool stdout and stderr to the closed error set. */
export function mapToolError(output: string): ErrorCode {
  for (const [pattern, code] of PATTERNS) if (pattern.test(output)) return code;
  return 'UNKNOWN';
}

/** `idevicepair pair|validate`: paired, still waiting for the Trust tap, or an error code. */
export function parsePairResult(output: string): 'paired' | 'waiting' | ErrorCode {
  if (/^SUCCESS:/m.test(output)) return 'paired';
  if (/accept the trust dialog|not paired with this host|Pairing dialog response pending/i.test(output)) return 'waiting';
  return mapToolError(output);
}
