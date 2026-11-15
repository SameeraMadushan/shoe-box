// One backup attempt from start to finish: find the phone, back it up, extract the
// chats in the worker, then (optionally) sync to Drive.
import { powerSaveBlocker } from 'electron';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sleep } from '../mocks/device.mock';
import { AppError, toErrorCode, type ErrorCode } from '../shared/errors';
import type { ActiveRun, Transport, Trigger } from '../shared/types';
import type { Device, DeviceService } from './device/service';
import { DriveAuthError, makeStagingDir, type DriveService } from './drive/service';
import { log } from './log';
import type { SecretsService } from './secrets';
import type { SettingsStore } from './settings';
import type { WorkerClient } from './worker-client';

export interface RunnerDeps {
  mock: boolean;
  /** Mock only: adds the 200,000-message chat. */
  big: boolean;
  device: DeviceService;
  drive: DriveService;
  worker: WorkerClient;
  secrets: SecretsService;
  settings: SettingsStore;
  onRun(run: ActiveRun | null): void;
  onDriveSync(percent: number | null): void;
  /** Called after every attempt so the UI state can be refreshed. */
  onFinished(ok: boolean): Promise<void>;
}

export type AttemptResult = { ok: true } | { ok: false; code: ErrorCode };

export class BackupRunner {
  private active = false;
  private abort: AbortController | null = null;

  constructor(private readonly deps: RunnerDeps) {}

  isRunning(): boolean {
    return this.active;
  }

  /**
   * Stops the run while the iPhone is being copied. Once extraction has started the
   * run is left to finish: it is short, and stopping mid-import gains nothing.
   */
  cancel(): void {
    this.abort?.abort();
  }

  /** Picks the transport: network first when Wi-Fi sync is on, then USB. The first backup is always USB. */
  private async findDevice(trigger: Trigger): Promise<Device> {
    const s = this.deps.settings.get();
    const useWifi = trigger !== 'first' && s.wifiSync;
    const mine = (await this.deps.device.list(useWifi)).filter((d) => !s.udid || d.udid === s.udid);
    const device = (useWifi && mine.find((d) => d.transport === 'wifi')) || mine.find((d) => d.transport === 'usb');
    if (!device) throw new AppError('DEVICE_NOT_FOUND');
    return device;
  }

  /**
   * `recordNotFound` is false for scheduled attempts that will be retried: a phone
   * that is simply away should not fill the history until the retries run out.
   */
  async attempt(trigger: Trigger, recordNotFound: boolean): Promise<AttemptResult> {
    if (this.active) return { ok: false, code: 'INTERRUPTED' };
    this.active = true;
    const { deps } = this;
    const started = Date.now();
    const abort = (this.abort = new AbortController());
    // Keep the computer awake for the duration of the run (scheduler rule 8).
    const blocker = powerSaveBlocker.start('prevent-app-suspension');
    const progress = (phase: number, percent: number) => deps.onRun({ trigger, phase, percent: Math.round(percent) });
    let transport: Transport | null = null;
    let recordedByWorker = false;
    let ok = false;
    try {
      const password = deps.secrets.get('backupPassword');
      if (!password) throw new AppError('WRONG_PASSWORD');
      const device = await this.findDevice(trigger);
      transport = device.transport;
      const backupRoot = join(deps.settings.get().dataDir, 'backup');

      // idevicebackup2 refuses a backup directory that does not exist yet.
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      progress(0, 0);
      await deps.device.backup(device, backupRoot, (p) => progress(0, p * 0.55), abort.signal);
      this.abort = null; // past the point where stopping is possible
      progress(1, 55);

      let runId: number;
      if (deps.mock) {
        // Replay the prototype's phase timings, then import the seed.
        if (password === 'wrong') throw new AppError('WRONG_PASSWORD');
        const pace = trigger === 'first' ? 1 : 0.25;
        await sleep(1200 * pace);
        progress(2, 70);
        await sleep(1400 * pace);
        progress(3, 88);
        await sleep(1000 * pace);
        recordedByWorker = true;
        runId = (await deps.worker.call('importSeed', { trigger, transport, big: deps.big })).runId;
      } else {
        deps.worker.onProgress = ({ phase, fraction }) => progress(phase, phase === 2 ? 70 + 18 * fraction : 88 + 12 * fraction);
        recordedByWorker = true;
        runId = (await deps.worker.call('extract', { trigger, transport, backupDir: join(backupRoot, device.udid), password })).runId;
      }
      progress(4, 100);
      ok = true;
      // Optional: give the disk space back. Only after a successful extraction, so a
      // failed run can be retried without copying the phone again.
      if (deps.settings.get().deleteBackupAfterExtract) {
        await rm(join(backupRoot, device.udid), { recursive: true, force: true });
      }
      await this.syncDrive(runId);
      log('run_succeeded', { runId, trigger, transport, ms: Date.now() - started });
      return { ok: true };
    } catch (e) {
      const code = toErrorCode(e);
      if (!recordedByWorker && (code !== 'DEVICE_NOT_FOUND' || recordNotFound)) {
        await deps.worker.call('recordFailure', { trigger, transport, code }).catch(() => {});
      }
      log('run_failed', { trigger, transport, code, ms: Date.now() - started });
      return { ok: false, code };
    } finally {
      powerSaveBlocker.stop(blocker);
      this.abort = null;
      this.active = false;
      deps.onRun(null);
      await deps.onFinished(ok);
    }
  }

  /** A Drive failure never fails the backup run (ADR section 8). */
  private async syncDrive(runId: number): Promise<void> {
    const { deps } = this;
    const s = deps.settings.get();
    if (!s.driveEnabled || !s.driveConnected || !deps.drive.configured) {
      return deps.worker.call('setDriveStatus', runId, 'off');
    }
    const stagingDir = await makeStagingDir(s.dataDir);
    try {
      deps.onDriveSync(0);
      const mediaDir = await deps.worker.call('stage', stagingDir, runId);
      await deps.drive.sync({ stagingDir, mediaDir }, deps.onDriveSync);
      await deps.worker.call('setDriveStatus', runId, 'synced');
    } catch (e) {
      // A revoked or expired token sends the UI back to "Connect Google account".
      if (e instanceof DriveAuthError) deps.settings.update({ driveConnected: false });
      log('drive_sync_failed', { runId, auth: e instanceof DriveAuthError });
      await deps.worker.call('setDriveStatus', runId, 'failed');
    } finally {
      deps.onDriveSync(null);
      await rm(stagingDir, { recursive: true, force: true });
    }
  }
}
