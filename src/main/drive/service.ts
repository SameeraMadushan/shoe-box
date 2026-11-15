import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretsService } from '../secrets';
import { signIn, revokeToken, type Fetch, type OAuthClient } from './oauth';
import { generateRecoveryKey, rcloneCopy, rcloneEnv, RcloneError } from './rclone';

/** Raised when Google no longer accepts the saved token: the user must connect again. */
export class DriveAuthError extends Error {}

export interface DriveService {
  /** False when the build has no OAuth client: the UI shows "not configured". */
  readonly configured: boolean;
  /** Signs in and returns the account address (null if Google did not share it). */
  connect(): Promise<string | null>;
  /** Revokes and forgets the token. Files already on Drive are left in place. */
  disconnect(): Promise<void>;
  /** The recovery key, created on first use and reused on reconnect so old uploads stay readable. */
  recoveryKey(): string;
  /** Uploads the staged snapshot and any new media. Throws on failure; never fails the backup run. */
  sync(staged: { stagingDir: string; mediaDir: string }, onProgress: (percent: number) => void): Promise<void>;
}

export function ensureRecoveryKey(secrets: SecretsService): string {
  let key = secrets.get('driveRecoveryKey');
  if (!key) secrets.set('driveRecoveryKey', (key = generateRecoveryKey()));
  return key;
}

export class RcloneDriveService implements DriveService {
  readonly configured: boolean;

  constructor(
    private readonly client: OAuthClient,
    private readonly secrets: SecretsService,
    private readonly fetch: Fetch,
    private readonly openBrowser: (url: string) => void,
    private readonly rcloneBin: string,
  ) {
    this.configured = !!client.clientId;
  }

  async connect(): Promise<string | null> {
    const { refreshToken, email } = await signIn(this.fetch, this.client, this.openBrowser);
    this.secrets.set('googleRefreshToken', refreshToken);
    return email;
  }

  async disconnect(): Promise<void> {
    const token = this.secrets.get('googleRefreshToken');
    this.secrets.set('googleRefreshToken', null);
    if (token) await revokeToken(this.fetch, token).catch(() => {});
  }

  recoveryKey(): string {
    return ensureRecoveryKey(this.secrets);
  }

  async sync(staged: { stagingDir: string; mediaDir: string }, onProgress: (percent: number) => void): Promise<void> {
    const refreshToken = this.secrets.get('googleRefreshToken');
    if (!refreshToken) throw new DriveAuthError();
    const env = rcloneEnv({ client: this.client, refreshToken, recoveryKey: this.recoveryKey() });
    try {
      // Media first (immutable, so only new files upload), then the snapshot and manifest.
      // "copy" rather than "sync": nothing on Drive is ever deleted.
      await rcloneCopy(this.rcloneBin, staged.mediaDir, 'vault:media', env, (p) => onProgress(p * 0.9));
      await rcloneCopy(this.rcloneBin, staged.stagingDir, 'vault:', env, (p) => onProgress(90 + p * 0.1));
    } catch (e) {
      if (e instanceof RcloneError && e.authFailed) {
        this.secrets.set('googleRefreshToken', null);
        throw new DriveAuthError();
      }
      throw e;
    }
  }
}

/** Fresh, private staging folder for one upload. */
export async function makeStagingDir(dataDir: string): Promise<string> {
  const dir = join(dataDir, 'tmp', 'drive-staging');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}
