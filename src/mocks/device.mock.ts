// Mock DeviceService replaying the prototype's timings: device found after about
// 2 s, trust after about 2 s, backup progress over about 8 s in total.
import { mockFlag, MOCK_SPEED } from '../main/config';
import type { Device, DeviceInfo, DeviceService } from '../main/device/service';
import { AppError } from '../shared/errors';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms / MOCK_SPEED));

export class MockDeviceService implements DeviceService {
  readonly canEnableWifi = true;
  private searchStartedAt: number | null = null;
  private pairStartedAt: number | null = null;
  private driverChecks = 0;
  private backups = 0;
  private failNext = mockFlag('fail');

  /** `onboarded`: the app already has a first backup, so every run is a quick incremental one. */
  constructor(private readonly onboarded: boolean) {}

  async driversOk(): Promise<boolean> {
    // With "nodrivers" the first check fails and "Check again" then succeeds.
    return !mockFlag('nodrivers') || this.driverChecks++ > 0;
  }

  async list(): Promise<Device[]> {
    this.searchStartedAt ??= Date.now();
    if (Date.now() - this.searchStartedAt < 1800 / MOCK_SPEED) return [];
    return [{ udid: '00008120-MOCK000000000001', transport: 'usb' }];
  }

  async info(): Promise<DeviceInfo> {
    return { name: 'iPhone 15', iosVersion: '26.1', productType: 'iPhone15,4' };
  }

  async pair(): Promise<boolean> {
    this.pairStartedAt ??= Date.now();
    return Date.now() - this.pairStartedAt >= 2200 / MOCK_SPEED;
  }

  async willEncrypt(): Promise<boolean> {
    return mockFlag('encrypted');
  }

  async enableEncryption(): Promise<void> {
    await sleep(300);
  }

  async usedBytes(): Promise<number> {
    return mockFlag('lowdisk') ? 1e18 : 38.2e9;
  }

  async backup(_device: Device, _root: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<void> {
    const first = !this.onboarded && this.backups === 0;
    this.backups++;
    if (!first && this.failNext) {
      this.failNext = false;
      throw new AppError('DEVICE_NOT_FOUND');
    }
    const steps = first ? 40 : 10;
    for (let i = 1; i <= steps; i++) {
      await sleep(110);
      if (signal.aborted) throw new AppError('INTERRUPTED');
      onProgress((i / steps) * 100);
    }
  }
}
