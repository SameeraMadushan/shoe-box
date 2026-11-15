// rclone invocation: no rclone.conf on disk; remotes are defined entirely through
// environment variables passed to the child process (ADR section 8).
import { createCipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { OAuthClient } from './oauth';

// rclone's fixed key for "obscured" config values (rclone fs/config/obscure). It is
// not secret; obscuring only keeps passwords from being read at a glance.
const OBSCURE_KEY = Buffer.from('9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638', 'hex');

/** Same output format as `rclone obscure`: base64url(iv + AES-256-CTR(plain)), no padding. */
export function obscure(plain: string, iv: Buffer = randomBytes(16)): string {
  const cipher = createCipheriv('aes-256-ctr', OBSCURE_KEY, iv);
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]).toString('base64url');
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf: Buffer): string {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

/** Two random 32-byte values as one grouped base32 string (104 characters in groups of 4). */
export function generateRecoveryKey(): string {
  return (base32(randomBytes(32)) + base32(randomBytes(32))).match(/.{4}/g)!.join('-');
}

/** First half is the rclone crypt password, second half the salt (password2). */
export function splitRecoveryKey(key: string): { password: string; password2: string } {
  const raw = key.replaceAll('-', '');
  if (!/^[A-Z2-7]{104}$/.test(raw)) throw new Error('Invalid recovery key');
  return { password: raw.slice(0, 52), password2: raw.slice(52) };
}

export const DRIVE_FOLDER = 'Shoebox';

export function rcloneEnv(p: { client: OAuthClient; refreshToken: string; recoveryKey: string }): Record<string, string> {
  const { password, password2 } = splitRecoveryKey(p.recoveryKey);
  return {
    RCLONE_CONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null',
    RCLONE_CONFIG_GDRIVE_TYPE: 'drive',
    RCLONE_CONFIG_GDRIVE_SCOPE: 'drive.file',
    RCLONE_CONFIG_GDRIVE_CLIENT_ID: p.client.clientId,
    RCLONE_CONFIG_GDRIVE_CLIENT_SECRET: p.client.clientSecret,
    // An already expired access token makes rclone refresh before its first request.
    RCLONE_CONFIG_GDRIVE_TOKEN: JSON.stringify({
      access_token: '',
      token_type: 'Bearer',
      refresh_token: p.refreshToken,
      expiry: '2000-01-01T00:00:00Z',
    }),
    RCLONE_CONFIG_VAULT_TYPE: 'crypt',
    RCLONE_CONFIG_VAULT_REMOTE: `gdrive:${DRIVE_FOLDER}`,
    RCLONE_CONFIG_VAULT_FILENAME_ENCRYPTION: 'standard',
    RCLONE_CONFIG_VAULT_DIRECTORY_NAME_ENCRYPTION: 'true',
    RCLONE_CONFIG_VAULT_PASSWORD: obscure(password),
    RCLONE_CONFIG_VAULT_PASSWORD2: obscure(password2),
  };
}

export class RcloneError extends Error {
  constructor(
    readonly exitCode: number,
    /** True when Google rejected the token: the user must connect again. */
    readonly authFailed: boolean,
  ) {
    super(`rclone exited with ${exitCode}`);
  }
}

/** Reads transfer progress (0 to 100) from one chunk of rclone's JSON log, if it holds any. */
export function parseRcloneProgress(chunk: string): number | null {
  let percent: number | null = null;
  for (const line of chunk.split('\n')) {
    try {
      const stats = (JSON.parse(line) as { stats?: { bytes?: number; totalBytes?: number } }).stats;
      if (stats?.totalBytes) percent = Math.min(100, Math.round(((stats.bytes ?? 0) / stats.totalBytes) * 100));
    } catch {
      // not a JSON log line
    }
  }
  return percent;
}

/**
 * Runs `rclone copy <src> <dest>`. The child gets only the given environment.
 * rclone has no automatic update or version check; nothing needs disabling.
 */
export function rcloneCopy(
  bin: string,
  src: string,
  dest: string,
  env: Record<string, string>,
  onProgress: (percent: number) => void = () => {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['copy', src, dest, '--use-json-log', '--stats', '1s', '--stats-log-level', 'NOTICE', '--log-level', 'NOTICE'];
    const child = spawn(bin, args, {
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      windowsHide: true,
    });
    let tail = '';
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      tail = (tail + text).slice(-4000);
      const percent = parseRcloneProgress(text);
      if (percent !== null) onProgress(percent);
    });
    child.on('error', () => reject(new RcloneError(-1, false)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new RcloneError(code ?? 1, /invalid_grant|unauthorized|401|token.*(expired|revoked)/i.test(tail)));
    });
  });
}
