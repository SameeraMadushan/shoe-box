import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapToolError, parseBackupProgress, parseKeyValues, parsePairResult, parseUdids } from '../../src/main/device/parse';

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/tool-output', name), 'utf8');

describe('tool output parsing (fixtures composed from the 1.4.0 tool sources)', () => {
  it('lists device ids', () => {
    expect(parseUdids(fixture('idevice_id-list.txt'))).toEqual(['00008120-001A2B3C4D5E6F01']);
    expect(parseUdids(fixture('idevice_id-empty.txt'))).toEqual([]);
    expect(parseUdids('ERROR: Unable to retrieve device list!\n')).toEqual([]);
  });

  it('reads pairing results', () => {
    expect(parsePairResult(fixture('pair-success.txt'))).toBe('paired');
    expect(parsePairResult(fixture('pair-trust-dialog.txt'))).toBe('waiting');
    expect(parsePairResult(fixture('validate-not-paired.txt'))).toBe('waiting');
    expect(parsePairResult(fixture('pair-passcode.txt'))).toBe('DEVICE_LOCKED');
    expect(parsePairResult(fixture('pair-denied.txt'))).toBe('NOT_TRUSTED');
  });

  it('reads key/value output', () => {
    expect(parseKeyValues(fixture('ideviceinfo.txt'))).toMatchObject({ DeviceName: 'Test iPhone', ProductVersion: '18.1' });
    const disk = parseKeyValues(fixture('diskusage.txt'));
    expect(Number(disk.TotalDataCapacity) - Number(disk.TotalDataAvailable)).toBe(69958283264);
  });

  it('follows overall backup progress and ignores per-file progress', () => {
    const out = fixture('backup-success.txt');
    expect(parseBackupProgress(out)).toBe(100);
    expect(parseBackupProgress(out.slice(0, out.indexOf('68%')))).toBe(17);
    expect(parseBackupProgress('Starting backup...\n')).toBeNull();
  });

  it('maps failures to the closed error set', () => {
    expect(mapToolError(fixture('backup-no-device.txt'))).toBe('DEVICE_NOT_FOUND');
    expect(mapToolError(fixture('backup-disk-full.txt'))).toBe('DISK_FULL');
    expect(mapToolError(fixture('backup-locked.txt'))).toBe('DEVICE_LOCKED');
    expect(mapToolError(fixture('pair-trust-dialog.txt'))).toBe('NOT_TRUSTED');
    expect(mapToolError('Backup Aborted.\n')).toBe('INTERRUPTED');
    expect(mapToolError('ERROR: Could not start service com.apple.mobilebackup2: Mux error\n')).toBe('INTERRUPTED');
    expect(mapToolError('something nobody has seen before')).toBe('UNKNOWN');
  });
});
