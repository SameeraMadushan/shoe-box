import { safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

export type SecretName = 'backupPassword' | 'googleRefreshToken' | 'driveRecoveryKey';

export interface SecretsService {
  /** False when the OS cannot protect secrets; nothing is then written to disk. */
  readonly persistent: boolean;
  get(name: SecretName): string | null;
  set(name: SecretName, value: string | null): void;
}

/** Keeps secrets for this session only. Used in mock mode and when safeStorage is unavailable. */
export class MemorySecrets implements SecretsService {
  private readonly values = new Map<SecretName, string>();
  constructor(readonly persistent = false) {}
  get(name: SecretName): string | null {
    return this.values.get(name) ?? null;
  }
  set(name: SecretName, value: string | null): void {
    if (value === null) this.values.delete(name);
    else this.values.set(name, value);
  }
}

/** Encrypted blobs in <userData>/secrets.bin via Electron safeStorage (Keychain / DPAPI). */
export class SafeStorageSecrets implements SecretsService {
  readonly persistent = true;
  private blobs: Partial<Record<SecretName, string>> = {};

  constructor(private readonly file: string) {
    try {
      this.blobs = JSON.parse(readFileSync(file, 'utf8')) as typeof this.blobs;
    } catch {
      // no secrets saved yet
    }
  }

  get(name: SecretName): string | null {
    const blob = this.blobs[name];
    if (!blob) return null;
    try {
      return safeStorage.decryptString(Buffer.from(blob, 'base64'));
    } catch {
      return null;
    }
  }

  set(name: SecretName, value: string | null): void {
    if (value === null) delete this.blobs[name];
    else this.blobs[name] = safeStorage.encryptString(value).toString('base64');
    writeFileSync(this.file, JSON.stringify(this.blobs), { mode: 0o600 });
  }
}

/** Never falls back to plaintext on disk (ADR section 7). */
export function createSecrets(file: string, mock: boolean): SecretsService {
  if (mock) return new MemorySecrets(true);
  return safeStorage.isEncryptionAvailable() ? new SafeStorageSecrets(file) : new MemorySecrets(false);
}
