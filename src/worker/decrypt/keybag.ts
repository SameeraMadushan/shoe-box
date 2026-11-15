// iOS backup keybag handling, ported from iphone_backup_decrypt (MIT, James Sharkey)
// utils.BackupKeyBag. See THIRD_PARTY.md.
import { createDecipheriv, pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from '../../shared/errors';

const pbkdf2Async = promisify(pbkdf2);
const WRAP_PASSPHRASE = 2;
const KW_IV = Buffer.alloc(8, 0xa6);
// Bounds from the reference: reject keybags that ask for absurd work.
const MAX_DPIC = 20_000_000;
const MAX_ITER = 1_000_000;

/** RFC 3394 AES key unwrap. Throws when the integrity check fails (wrong key). */
export function aesUnwrap(kek: Buffer, wrapped: Buffer): Buffer {
  const d = createDecipheriv('id-aes256-wrap', kek, KW_IV);
  return Buffer.concat([d.update(wrapped), d.final()]);
}

interface ClassKey {
  clas: number;
  wrap: number;
  wpky: Buffer | null;
}

export class Keybag {
  private readonly attrs = new Map<string, Buffer | number>();
  private readonly classes: ClassKey[] = [];
  private readonly keys = new Map<number, Buffer>();

  constructor(blob: Buffer) {
    let seenBagUuid = false;
    let seenBagWrap = false;
    let current: ClassKey | null = null;
    for (let i = 0; i + 8 <= blob.length; ) {
      const tag = blob.toString('latin1', i, i + 4);
      const len = blob.readUInt32BE(i + 4);
      const data = blob.subarray(i + 8, i + 8 + len);
      i += 8 + len;
      const value = len === 4 ? data.readUInt32BE(0) : data;
      if (tag === 'UUID' && !seenBagUuid) seenBagUuid = true;
      else if (tag === 'WRAP' && !seenBagWrap) seenBagWrap = true;
      else if (tag === 'UUID') this.classes.push((current = { clas: 0, wrap: 0, wpky: null }));
      else if (current && tag === 'CLAS') current.clas = value as number;
      else if (current && tag === 'WRAP') current.wrap = value as number;
      else if (current && tag === 'WPKY') current.wpky = data;
      else if (!current) this.attrs.set(tag, value);
    }
  }

  private iterations(tag: string, max: number): number {
    const v = this.attrs.get(tag);
    if (typeof v !== 'number' || v < 1 || v > max) throw new AppError('UNKNOWN', `Invalid keybag ${tag}`);
    return v;
  }

  /** Derives the passcode key and unwraps every class key. Wrong password -> WRONG_PASSWORD. */
  async unlock(password: string): Promise<void> {
    const dpsl = this.attrs.get('DPSL');
    const salt = this.attrs.get('SALT');
    if (!Buffer.isBuffer(dpsl) || !Buffer.isBuffer(salt)) throw new AppError('UNKNOWN', 'Keybag has no salts');
    const round1 = await pbkdf2Async(Buffer.from(password, 'utf8'), dpsl, this.iterations('DPIC', MAX_DPIC), 32, 'sha256');
    const passKey = await pbkdf2Async(round1, salt, this.iterations('ITER', MAX_ITER), 32, 'sha1');
    for (const c of this.classes) {
      if (!c.wpky || !(c.wrap & WRAP_PASSPHRASE)) continue;
      try {
        this.keys.set(c.clas, aesUnwrap(passKey, c.wpky));
      } catch {
        throw new AppError('WRONG_PASSWORD');
      }
    }
    if (this.keys.size === 0) throw new AppError('UNKNOWN', 'Keybag has no passphrase-wrapped keys');
  }

  unwrapForClass(protectionClass: number, wrapped: Buffer): Buffer {
    const classKey = this.keys.get(protectionClass);
    if (!classKey) throw new AppError('UNKNOWN', `No key for protection class ${protectionClass}`);
    if (wrapped.length !== 0x28) throw new AppError('UNKNOWN', 'Invalid wrapped key length');
    try {
      return aesUnwrap(classKey, wrapped);
    } catch {
      throw new AppError('UNKNOWN', 'File key unwrap failed');
    }
  }
}
