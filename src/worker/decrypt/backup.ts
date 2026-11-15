// Encrypted iOS backup reader, ported from iphone_backup_decrypt (MIT, James Sharkey)
// iphone_backup.EncryptedBackup. See THIRD_PARTY.md.
import Database from 'better-sqlite3';
import { parse as parseXmlPlist, parseBinary } from 'plist';
import { createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../shared/errors';
import { Keybag } from './keybag';

const ZERO_IV = Buffer.alloc(16);
const FILE_ID = /^[0-9a-f]{40}$/;

function parsePlist(buf: Buffer): Record<string, unknown> {
  const value = buf.subarray(0, 6).toString('latin1') === 'bplist' ? parseBinary(buf) : parseXmlPlist(buf.toString('utf8'));
  return value as Record<string, unknown>;
}

/**
 * Decrypts AES-256-CBC (zero IV, PKCS#7) as a stream so large media never sits in memory.
 * The reference strips the padding rather than truncating to the manifest Size, which
 * iOS reports unreliably for live files; we do the same.
 */
export async function decryptFile(src: string, dest: string, key: Buffer): Promise<number> {
  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  try {
    await pipeline(createReadStream(src), createDecipheriv('aes-256-cbc', key, ZERO_IV), createWriteStream(partial, { mode: 0o600 }));
    await rename(partial, dest);
  } catch (e) {
    await rm(partial, { force: true });
    if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new AppError('DISK_FULL');
    throw e;
  }
  return (await stat(dest)).size;
}

interface FileRecord {
  fileId: string;
  protectionClass: number;
  /** Null for files iOS stored without a key (empty files). */
  wrappedKey: Buffer | null;
}

/** Reads the NSKeyedArchiver blob in the Files.file column. */
export function parseFileRecord(fileId: string, blob: Buffer): FileRecord {
  const root = parseBinary(blob) as unknown as { $top: { root: { UID: number } }; $objects: Record<string, unknown>[] };
  const data = root.$objects[root.$top.root.UID] as { ProtectionClass: number; EncryptionKey?: { UID: number } };
  let wrappedKey: Buffer | null = null;
  if (data.EncryptionKey) {
    const keyObject = root.$objects[data.EncryptionKey.UID] as { 'NS.data': Buffer };
    wrappedKey = Buffer.from(keyObject['NS.data']).subarray(4); // first 4 bytes repeat the class
  }
  return { fileId, protectionClass: data.ProtectionClass, wrappedKey };
}

export class EncryptedBackup {
  private constructor(
    private readonly backupDir: string,
    private readonly keybag: Keybag,
    private readonly manifest: Database.Database,
  ) {}

  /**
   * Unlocks the keybag and decrypts Manifest.db into tmpDir. The caller owns tmpDir
   * and must delete it when the run ends.
   */
  static async open(backupDir: string, password: string, tmpDir: string): Promise<EncryptedBackup> {
    let manifestPlist: Record<string, unknown>;
    try {
      manifestPlist = parsePlist(await readFile(join(backupDir, 'Manifest.plist')));
    } catch {
      throw new AppError('INTERRUPTED', 'Backup folder has no readable Manifest.plist');
    }
    if (!manifestPlist.IsEncrypted) throw new AppError('UNKNOWN', 'Backup is not encrypted');
    const keybag = new Keybag(Buffer.from(manifestPlist.BackupKeyBag as Buffer));
    await keybag.unlock(password);

    const manifestKey = Buffer.from(manifestPlist.ManifestKey as Buffer);
    // The class number is little-endian, unlike the keybag fields (reference: struct '<l').
    const key = keybag.unwrapForClass(manifestKey.readInt32LE(0), manifestKey.subarray(4));
    const manifestPath = join(tmpDir, 'Manifest.db');
    await decryptFile(join(backupDir, 'Manifest.db'), manifestPath, key);
    let db: Database.Database;
    try {
      db = new Database(manifestPath, { readonly: true });
      db.prepare('SELECT count(*) FROM Files').get();
    } catch {
      throw new AppError('UNKNOWN', 'Decrypted Manifest.db is not a valid database');
    }
    return new EncryptedBackup(backupDir, keybag, db);
  }

  close(): void {
    this.manifest.close();
  }

  private find(domain: string, relativePath: string): FileRecord | null {
    const row = this.manifest
      .prepare('SELECT fileID, file FROM Files WHERE domain = ? AND relativePath = ? AND flags = 1 LIMIT 1')
      .get(domain, relativePath) as { fileID: string; file: Buffer } | undefined;
    if (!row || !FILE_ID.test(row.fileID)) return null;
    return parseFileRecord(row.fileID, row.file);
  }

  /** Decrypts one file to dest. Resolves false when the backup does not contain it. */
  async extract(domain: string, relativePath: string, dest: string): Promise<boolean> {
    const rec = this.find(domain, relativePath);
    if (!rec) return false;
    if (!rec.wrappedKey) {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, '');
      return true;
    }
    const key = this.keybag.unwrapForClass(rec.protectionClass, rec.wrappedKey);
    const src = join(this.backupDir, rec.fileId.slice(0, 2), rec.fileId);
    try {
      await decryptFile(src, dest, key);
    } catch (e) {
      if (e instanceof AppError) throw e;
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new AppError('UNKNOWN', 'File decryption failed');
    }
    return true;
  }
}
