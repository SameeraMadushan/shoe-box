import type { Transport } from '../../shared/types';

export interface Device {
  udid: string;
  transport: Transport;
}

export interface DeviceInfo {
  name: string;
  iosVersion: string;
  productType: string;
}

/**
 * Everything that talks to an iPhone. The real implementation runs the bundled
 * libimobiledevice tools; the mock replays the prototype's timings.
 * Methods reject with AppError carrying one of the closed error codes.
 */
export interface DeviceService {
  /** Windows only: is Apple's device service installed and running? */
  driversOk(): Promise<boolean>;
  /** Devices currently reachable, USB first. */
  list(includeNetwork: boolean): Promise<Device[]>;
  info(device: Device): Promise<DeviceInfo>;
  /** Resolves true once paired; false while the Trust dialog is still waiting. */
  pair(device: Device): Promise<boolean>;
  /** True when the phone already has a backup password. */
  willEncrypt(device: Device): Promise<boolean>;
  enableEncryption(device: Device, password: string): Promise<void>;
  /** False when Wi-Fi syncing has to be switched on by hand. */
  readonly canEnableWifi: boolean;
  /** Bytes in use on the phone: the estimate for the first backup's size. */
  usedBytes(device: Device): Promise<number>;
  /** Backs up into `<backupRoot>/<udid>/`, reporting percent complete. Aborting rejects with INTERRUPTED. */
  backup(device: Device, backupRoot: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<void>;
}
