import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import { ArchiveStore } from '../../src/worker/archive/store';
import { openBackupSource } from '../../src/worker/extract/backup-source';
import { ChatStorage } from '../../src/worker/extract/chatstorage';
import { dataPaths, prepareDataDir, runImport, type DataPaths } from '../../src/worker/extract/run';
import { buildChatStorage, DEFAULT_MESSAGES, FIXTURE_PASSWORD, makeBackup, PHOTO_BYTES } from '../fixtures/make-backup';

let root: string;
let backupDir: string;
let paths: DataPaths;
let store: ArchiveStore;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ca-decrypt-'));
});
beforeEach(async () => {
  const dir = mkdtempSync(join(root, 'case-'));
  backupDir = join(dir, 'backup', 'udid');
  makeBackup(backupDir);
  paths = dataPaths(join(dir, 'data'));
  await prepareDataDir(paths);
  store = new ArchiveStore(paths.dbPath);
});

const extract = (password = FIXTURE_PASSWORD, trigger: 'first' | 'manual' = 'first') =>
  runImport(store, paths, { trigger, transport: 'usb' }, (tmp) => openBackupSource(backupDir, password, tmp));
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: AppError) => e.code);
const noTemp = () => !existsSync(paths.tmpDir) || readdirSync(paths.tmpDir).length === 0;

describe('encrypted backup round trip', () => {
  it('decrypts the synthetic backup and imports chats, messages and media', async () => {
    const result = await extract();
    expect(result).toMatchObject({ newMessages: 6, newMedia: 1 });

    const chats = store.listChats();
    expect(chats.map((c) => c.name).sort()).toEqual(['Allotment Crew', 'Ottoline Vex']);
    const direct = chats.find((c) => c.name === 'Ottoline Vex')!;
    const messages = store.getMessages(direct.id, { at: 'newest' });
    expect(messages.map((m) => [m.kind, m.text, m.fromMe])).toEqual([
      ['text', 'Is the kettle descaled yet?', false],
      ['text', 'Doing it tonight', true],
      ['image', 'The kettle', false], // caption becomes the text
      ['video', null, false],
    ]);
    expect(messages[0]!.sentAt).toBe(1_700_000_000);
    expect(messages[2]!.media).toMatchObject({ available: true, mime: 'image/jpeg', fileName: 'photo.jpg' });
    expect(messages[3]!.media).toMatchObject({ available: false, durationS: 12 });

    // The streamed, decrypted media file is byte-identical to the original.
    const info = store.mediaInfo(messages[2]!.media!.id)!;
    expect(readFileSync(join(paths.mediaDir, info.relPath)).equals(PHOTO_BYTES)).toBe(true);

    const group = chats.find((c) => c.name === 'Allotment Crew')!;
    expect(group).toMatchObject({ isGroup: true, memberCount: 2 });
    const groupMessages = store.getMessages(group.id, { at: 'newest' });
    // The system event (type 6) is skipped; the sender comes from the profile name.
    expect(groupMessages.map((m) => [m.text, m.senderName])).toEqual([
      ['Allotment rota is up', 'Barnaby Quill'],
      ['Thanks, I will take Tuesday', null],
    ]);
    expect(store.history()[0]).toMatchObject({ status: 'succeeded', trigger: 'first', newMessages: 6, newMedia: 1 });
  });

  it('returns WRONG_PASSWORD for a wrong password and records the failed run', async () => {
    expect(await code(extract('not the password'))).toBe('WRONG_PASSWORD');
    expect(store.history()[0]).toMatchObject({ status: 'failed', errorCode: 'WRONG_PASSWORD' });
    expect(store.stats().messages).toBe(0);
  });

  it('a second backup adds only what is new and tags what was deleted', async () => {
    await extract();
    const next = DEFAULT_MESSAGES.filter((m) => m.id !== 'M2').concat({ id: 'M5', chat: 1, text: 'Kettle is sparkling', at: 1_700_000_500 });
    makeBackup(backupDir, next);
    expect(await extract(FIXTURE_PASSWORD, 'manual')).toMatchObject({ newMessages: 1, newMedia: 0 });
    const direct = store.listChats().find((c) => c.name === 'Ottoline Vex')!;
    const messages = store.getMessages(direct.id, { at: 'newest' });
    expect(messages.find((m) => m.text === 'Doing it tonight')).toMatchObject({ deletedOnPhone: true });
    expect(messages.at(-1)).toMatchObject({ text: 'Kettle is sparkling', deletedOnPhone: false });
  });

  it('reports UNSUPPORTED_DATA when the backup has no chat database, leaving the archive untouched', async () => {
    await extract();
    makeBackup(backupDir, DEFAULT_MESSAGES, { withChatDb: false });
    expect(await code(extract())).toBe('UNSUPPORTED_DATA');
    expect(store.stats().messages).toBe(6);
    expect(store.getMessages(1, { at: 'newest' }).every((m) => !m.deletedOnPhone)).toBe(true);
  });
});

describe('temporary files', () => {
  it('leaves no decrypted temp files after success or failure', async () => {
    await extract();
    expect(noTemp()).toBe(true);
    await code(extract('wrong'));
    expect(noTemp()).toBe(true);
    makeBackup(backupDir, DEFAULT_MESSAGES, { withChatDb: false });
    await code(extract());
    expect(noTemp()).toBe(true);
  });

  it('removes leftovers from a crashed run at the next start', async () => {
    mkdirSync(paths.tmpDir, { recursive: true });
    writeFileSync(join(paths.tmpDir, 'ChatStorage.sqlite'), 'decrypted leftovers');
    await prepareDataDir(paths); // what the worker does when it opens the archive
    expect(noTemp()).toBe(true);
  });
});

describe('chat database schema tolerance', () => {
  const file = () => join(mkdtempSync(join(root, 'schema-')), 'ChatStorage.sqlite');

  it('reads a database that lacks optional columns and tables', () => {
    for (const options of [{ dropColumn: 'ZWAMEDIAITEM.ZMOVIEDURATION' }, { dropColumn: 'ZWACHATSESSION.ZPARTNERNAME' }, { dropTable: 'ZWAPROFILEPUSHNAME' }, { dropTable: 'ZWAMEDIAITEM' }]) {
      const path = file();
      buildChatStorage(path, DEFAULT_MESSAGES, options);
      const storage = new ChatStorage(path);
      const chats = storage.chats();
      expect(chats).toHaveLength(2);
      expect(chats.flatMap((c) => [...c.messages])).toHaveLength(6);
      storage.close();
    }
  });

  it('rejects a database without the required tables or columns', () => {
    for (const options of [{ dropTable: 'ZWAMESSAGE' }, { dropColumn: 'ZWAMESSAGE.ZSTANZAID' }]) {
      const path = file();
      buildChatStorage(path, DEFAULT_MESSAGES, options);
      expect(() => new ChatStorage(path)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_DATA' }));
    }
  });
});
