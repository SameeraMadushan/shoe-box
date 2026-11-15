import { mockFlag } from '../main/config';
import { ensureRecoveryKey, type DriveService } from '../main/drive/service';
import type { SecretsService } from '../main/secrets';
import { sleep } from './device.mock';

/** Mock Drive: never touches the network. */
export class MockDriveService implements DriveService {
  readonly configured = !mockFlag('nodrive');

  constructor(private readonly secrets: SecretsService) {}

  async connect(): Promise<string | null> {
    await sleep(600);
    return 'you@example.com';
  }

  async disconnect(): Promise<void> {}

  recoveryKey(): string {
    return ensureRecoveryKey(this.secrets);
  }

  async sync(_staged: unknown, onProgress: (percent: number) => void): Promise<void> {
    for (let p = 25; p <= 100; p += 25) {
      await sleep(150);
      onProgress(p);
    }
    if (mockFlag('drivefail')) throw new Error('mock Drive failure');
  }
}
