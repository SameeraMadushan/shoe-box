// Real DeviceService: runs the bundled libimobiledevice 1.4.0 tools as child processes.
// UNVERIFIED ON HARDWARE: flags and output formats were checked against the tool
// sources, not against a real iPhone. See docs/real-device-checklist.md.
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { AppError } from '../../shared/errors';
import { log, redact } from '../log';
import { mapToolError, parseBackupProgress, parseKeyValues, parsePairResult, parseUdids } from './parse';
import type { Device, DeviceInfo, DeviceService } from './service';

interface ToolResult {
  code: number;
  out: string;
}

export class ToolDeviceService implements DeviceService {
  // idevicepair 1.4.0 has no "wifi on" command and no bundled tool can set the
  // EnableWifiConnections lockdown key, so the UI shows the manual instruction.
  readonly canEnableWifi = false;

  constructor(private readonly binDir: string) {}

  private bin(tool: string): string {
    return join(this.binDir, process.platform === 'win32' ? `${tool}.exe` : tool);
  }

  private run(tool: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      execFile(this.bin(tool), args, { env: { ...process.env, ...env }, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(new AppError('UNKNOWN', 'Device tools are not installed in this build'));
        }
        resolve({ code: typeof err?.code === 'number' ? err.code : err ? 1 : 0, out: `${stdout}\n${stderr}` });
      });
    });
  }

  private target(d: Device): string[] {
    return d.transport === 'wifi' ? ['-u', d.udid, '-n'] : ['-u', d.udid];
  }

  private fail(tool: string, r: ToolResult): never {
    const code = mapToolError(r.out);
    log('tool_failed', { tool, exit: r.code, code, detail: redact(r.out) });
    throw new AppError(code);
  }

  async driversOk(): Promise<boolean> {
    if (process.platform !== 'win32') return true;
    // Both the Apple Devices Store app and classic iTunes install this service name.
    // UNVERIFIED: could not be checked on a Windows machine in this build.
    return new Promise((resolve) => {
      execFile('sc.exe', ['query', 'Apple Mobile Device Service'], { windowsHide: true }, (err, stdout) => {
        resolve(!err && /STATE\s*:\s*4\s+RUNNING/.test(stdout));
      });
    });
  }

  async list(includeNetwork: boolean): Promise<Device[]> {
    const usb = parseUdids((await this.run('idevice_id', ['-l'])).out).map((udid): Device => ({ udid, transport: 'usb' }));
    if (!includeNetwork) return usb;
    const wifi = parseUdids((await this.run('idevice_id', ['-n'])).out).map((udid): Device => ({ udid, transport: 'wifi' }));
    return [...usb, ...wifi];
  }

  async info(device: Device): Promise<DeviceInfo> {
    const r = await this.run('ideviceinfo', this.target(device));
    if (r.code !== 0) this.fail('ideviceinfo', r);
    const kv = parseKeyValues(r.out);
    return { name: kv.DeviceName ?? 'iPhone', iosVersion: kv.ProductVersion ?? '', productType: kv.ProductType ?? '' };
  }

  async pair(device: Device): Promise<boolean> {
    let r = await this.run('idevicepair', [...this.target(device), 'validate']);
    if (parsePairResult(r.out) !== 'paired') r = await this.run('idevicepair', [...this.target(device), 'pair']);
    const result = parsePairResult(r.out);
    if (result === 'paired') return true;
    if (result === 'waiting') return false;
    return this.fail('idevicepair', r);
  }

  async willEncrypt(device: Device): Promise<boolean> {
    const r = await this.run('ideviceinfo', [...this.target(device), '-q', 'com.apple.mobile.backup', '-k', 'WillEncrypt']);
    if (r.code !== 0) this.fail('ideviceinfo', r);
    return /^\s*true\s*$/m.test(r.out);
  }

  async enableEncryption(device: Device, password: string): Promise<void> {
    // The password goes through the environment, never the command line
    // (idevicebackup2.c reads BACKUP_PASSWORD for "encryption on").
    const r = await this.run('idevicebackup2', [...this.target(device), 'encryption', 'on'], { BACKUP_PASSWORD: password });
    if (r.code !== 0 || /^ERROR:|ErrorCode/m.test(r.out)) this.fail('idevicebackup2', r);
  }

  async usedBytes(device: Device): Promise<number> {
    const r = await this.run('ideviceinfo', [...this.target(device), '-q', 'com.apple.disk_usage']);
    if (r.code !== 0) this.fail('ideviceinfo', r);
    const kv = parseKeyValues(r.out);
    const used = Number(kv.TotalDataCapacity) - Number(kv.TotalDataAvailable);
    return Number.isFinite(used) && used > 0 ? used : 0;
  }

  backup(device: Device, backupRoot: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin('idevicebackup2'), [...this.target(device), 'backup', backupRoot], { windowsHide: true });
      // SIGINT is the tool's own "abort requested" path: it tells the phone and exits cleanly.
      const stop = () => child.kill('SIGINT');
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      let tail = '';
      const onData = (data: Buffer) => {
        const text = data.toString('utf8');
        tail = (tail + text).slice(-4000);
        const percent = parseBackupProgress(text);
        if (percent !== null) onProgress(percent);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) => {
        reject(new AppError('UNKNOWN', (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Device tools are not installed in this build' : undefined));
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) return reject(new AppError('INTERRUPTED'));
        if (code === 0 && /Backup Successful/.test(tail)) return resolve();
        try {
          this.fail('idevicebackup2', { code: code ?? 1, out: tail });
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}
