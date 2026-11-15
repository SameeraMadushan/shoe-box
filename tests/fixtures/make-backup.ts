// Builds a small synthetic encrypted iPhone backup with the same primitives Apple's
// format uses. All content is invented. A synthetic fixture proves the code is
// self-consistent; it cannot catch a misreading of the real format.
import Database from 'better-sqlite3';
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBinary } from 'plist';
import { APPLE_EPOCH_OFFSET, CHAT_DOMAIN } from '../../src/worker/extract/chatstorage';

const KW_IV = Buffer.alloc(8, 0xa6);
const wrap = (kek: Buffer, key: Buffer) => {
  const c = createCipheriv('id-aes256-wrap', kek, KW_IV);
  return Buffer.concat([c.update(key), c.final()]);
};
const encrypt = (key: Buffer, data: Buffer) => {
  const c = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
  return Buffer.concat([c.update(data), c.final()]);
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const tlv = (tag: string, data: Buffer) => Buffer.concat([Buffer.from(tag, 'latin1'), u32(data.length), data]);

export interface FixtureMessage {
  id: string;
  chat: number;
  fromMe?: boolean;
  text?: string | null;
  /** Unix seconds. */
  at: number;
  type?: number;
  member?: number;
  media?: { path: string | null; title?: string; duration?: number };
}

export const DEFAULT_MESSAGES: FixtureMessage[] = [
  { id: 'M1', chat: 1, text: 'Is the kettle descaled yet?', at: 1_700_000_000 },
  { id: 'M2', chat: 1, fromMe: true, text: 'Doing it tonight', at: 1_700_000_060 },
  { id: 'M3', chat: 1, type: 1, at: 1_700_000_120, media: { path: 'Media/15550101@s.whatsapp.net/a/b/photo.jpg', title: 'The kettle' } },
  { id: 'M4', chat: 1, type: 2, at: 1_700_000_180, media: { path: null, duration: 12 } },
  { id: 'G1', chat: 2, text: 'Allotment rota is up', at: 1_700_000_240, member: 1 },
  { id: 'G2', chat: 2, type: 6, text: '3', at: 1_700_000_300 },
  { id: 'G3', chat: 2, fromMe: true, text: 'Thanks, I will take Tuesday', at: 1_700_000_360 },
];

export function buildChatStorage(path: string, messages: FixtureMessage[], options: { dropColumn?: string; dropTable?: string } = {}): void {
  rmSync(path, { force: true });
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT, ZLASTMESSAGEDATE REAL);
    CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZTEXT TEXT, ZISFROMME INTEGER, ZMESSAGEDATE REAL,
      ZMESSAGETYPE INTEGER, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZMEDIAITEM INTEGER);
    CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMESSAGE INTEGER, ZMEDIALOCALPATH TEXT, ZMOVIEDURATION REAL,
      ZFILESIZE INTEGER, ZTITLE TEXT, ZVCARDSTRING TEXT);
    CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZMEMBERJID TEXT);
    CREATE TABLE ZWAPROFILEPUSHNAME (Z_PK INTEGER PRIMARY KEY, ZJID TEXT, ZPUSHNAME TEXT);
    INSERT INTO ZWACHATSESSION VALUES (1, '15550101@s.whatsapp.net', 'Ottoline Vex', 0), (2, '15550100-1600000000@g.us', 'Allotment Crew', 0);
    INSERT INTO ZWAGROUPMEMBER VALUES (1, 2, '15550102@s.whatsapp.net'), (2, 2, '15550101@s.whatsapp.net');
    INSERT INTO ZWAPROFILEPUSHNAME VALUES (1, '15550102@s.whatsapp.net', 'Barnaby Quill');
  `);
  const msg = db.prepare('INSERT INTO ZWAMESSAGE VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)');
  const media = db.prepare('INSERT INTO ZWAMEDIAITEM (ZMESSAGE, ZMEDIALOCALPATH, ZMOVIEDURATION, ZFILESIZE, ZTITLE) VALUES (?, ?, ?, ?, ?)');
  messages.forEach((m, i) => {
    msg.run(i + 1, m.id, m.text ?? null, m.fromMe ? 1 : 0, m.at - APPLE_EPOCH_OFFSET + 0.25, m.type ?? 0, m.chat, m.member ?? null);
    if (m.media) media.run(i + 1, m.media.path, m.media.duration ?? null, 1234, m.media.title ?? null);
  });
  if (options.dropColumn) db.exec(`ALTER TABLE ${options.dropColumn.split('.')[0]} DROP COLUMN ${options.dropColumn.split('.')[1]}`);
  if (options.dropTable) db.exec(`DROP TABLE ${options.dropTable}`);
  db.close();
}

export const FIXTURE_PASSWORD = 'synthetic-fixture-password';
export const PHOTO_BYTES = randomBytes(70_001); // not a block multiple, larger than one stream chunk

/** Writes an encrypted backup into `dir` and returns nothing secret: the password is FIXTURE_PASSWORD. */
export function makeBackup(dir: string, messages: FixtureMessage[] = DEFAULT_MESSAGES, options: { withChatDb?: boolean } = {}): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Keybag: low iteration counts keep the test fast.
  const dpsl = randomBytes(20);
  const salt = randomBytes(20);
  const round1 = pbkdf2Sync(FIXTURE_PASSWORD, dpsl, 100, 32, 'sha256');
  const passKey = pbkdf2Sync(round1, salt, 50, 32, 'sha1');
  const classKeys = new Map([3, 4].map((c) => [c, randomBytes(32)]));
  const keybag = Buffer.concat([
    tlv('VERS', u32(5)), tlv('TYPE', u32(1)), tlv('UUID', randomBytes(16)), tlv('HMCK', randomBytes(40)), tlv('WRAP', u32(0)),
    tlv('SALT', salt), tlv('ITER', u32(50)), tlv('DPWT', u32(2)), tlv('DPIC', u32(100)), tlv('DPSL', dpsl),
    ...[...classKeys].flatMap(([clas, key]) => [
      tlv('UUID', randomBytes(16)), tlv('CLAS', u32(clas)), tlv('WRAP', u32(2)), tlv('KTYP', u32(0)), tlv('WPKY', wrap(passKey, key)),
    ]),
  ]);

  const manifestPath = join(dir, 'Manifest.plain.db');
  const manifest = new Database(manifestPath);
  manifest.exec('CREATE TABLE Files (fileID TEXT PRIMARY KEY, domain TEXT, relativePath TEXT, flags INTEGER, file BLOB)');
  const addFile = (relativePath: string, content: Buffer, protectionClass = 3) => {
    const fileId = createHash('sha1').update(`${CHAT_DOMAIN}-${relativePath}`).digest('hex');
    const fileKey = randomBytes(32);
    const classPrefix = Buffer.alloc(4);
    classPrefix.writeUInt32LE(protectionClass);
    const record = buildBinary({
      $version: 100000,
      $archiver: 'NSKeyedArchiver',
      $top: { root: { UID: 1 } },
      $objects: [
        '$null',
        { ProtectionClass: protectionClass, Size: content.length, EncryptionKey: { UID: 2 }, RelativePath: relativePath },
        { 'NS.data': Buffer.concat([classPrefix, wrap(classKeys.get(protectionClass)!, fileKey)]) },
      ],
    });
    mkdirSync(join(dir, fileId.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, fileId.slice(0, 2), fileId), encrypt(fileKey, content));
    manifest.prepare('INSERT INTO Files VALUES (?, ?, ?, 1, ?)').run(fileId, CHAT_DOMAIN, relativePath, Buffer.from(record));
  };

  if (options.withChatDb !== false) {
    const chatDb = join(dir, 'ChatStorage.plain.sqlite');
    buildChatStorage(chatDb, messages);
    addFile('ChatStorage.sqlite', readFileSync(chatDb));
    rmSync(chatDb);
  }
  addFile('Message/Media/15550101@s.whatsapp.net/a/b/photo.jpg', PHOTO_BYTES, 4);
  manifest.close();

  const manifestKey = randomBytes(32);
  const manifestClass = Buffer.alloc(4);
  manifestClass.writeInt32LE(3);
  writeFileSync(join(dir, 'Manifest.db'), encrypt(manifestKey, readFileSync(manifestPath)));
  rmSync(manifestPath);
  writeFileSync(
    join(dir, 'Manifest.plist'),
    buildBinary({ IsEncrypted: true, BackupKeyBag: keybag, ManifestKey: Buffer.concat([manifestClass, wrap(classKeys.get(3)!, manifestKey)]) }),
  );
}
