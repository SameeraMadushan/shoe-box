import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { bigChat } from '../../src/mocks/archive.seed';
import { ArchiveStore, ftsQuery, type SourceChat, type SourceMessage } from '../../src/worker/archive/store';
import { appleToUnix } from '../../src/worker/extract/chatstorage';
import { importSource, safeRelPath, type ChatSource } from '../../src/worker/extract/pipeline';

const msg = (sourceId: string, text: string | null, extra: Partial<SourceMessage> = {}): SourceMessage => ({
  sourceId, fromMe: false, senderJid: null, senderName: null, sentAt: 1_700_000_000 + Number(sourceId.replace(/\D/g, '') || 0), kind: 'text', text, ...extra,
});
const chat = (jid: string, name: string, messages: SourceMessage[]): SourceChat => ({ jid, name, isGroup: false, memberCount: null, messages });

let store: ArchiveStore;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ca-store-'));
  store = new ArchiveStore(join(dir, 'archive.sqlite'));
});

/** Imports a full "phone state" as one run, like a real backup does. */
function run(chats: SourceChat[]) {
  const runId = store.startRun('manual', 'usb');
  let newMessages = 0;
  for (const c of chats) newMessages += store.importChat(runId, c).newMessages;
  store.finishImport(runId);
  store.finishRun(runId, { status: 'succeeded', newMessages });
  return { runId, newMessages };
}
const texts = (chatId = 1) => store.getMessages(chatId, { at: 'newest' }).map((m) => m.text);

describe('import rules', () => {
  it('inserts once and ignores messages it already has', () => {
    const phone = [chat('a@x', 'Ada', [msg('m1', 'one'), msg('m2', 'two')])];
    expect(run(phone).newMessages).toBe(2);
    expect(run(phone).newMessages).toBe(0);
    expect(texts()).toEqual(['one', 'two']);
    expect(store.listChats()[0]).toMatchObject({ name: 'Ada', messageCount: 2, preview: { text: 'two' } });
  });

  it('treats the same id from me and from them as different messages', () => {
    run([chat('a@x', 'Ada', [msg('m1', 'theirs'), msg('m1', 'mine', { fromMe: true })])]);
    expect(store.stats().messages).toBe(2);
  });

  it('keeps the old text as a revision when a message is edited', () => {
    run([chat('a@x', 'Ada', [msg('m1', 'helo')])]);
    run([chat('a@x', 'Ada', [msg('m1', 'hello')])]);
    expect(texts()).toEqual(['hello']);
    expect(store.db.prepare('SELECT text FROM message_revisions').all()).toEqual([{ text: 'helo' }]);
    // Search follows the edit: the FTS triggers keep the index in step.
    expect(store.search('hello')[0]?.messages).toHaveLength(1);
    expect(store.search('helo')).toEqual([]);
  });

  it('tags messages that disappeared from the phone and never removes them', () => {
    run([chat('a@x', 'Ada', [msg('m1', 'keep'), msg('m2', 'gone later')])]);
    run([chat('a@x', 'Ada', [msg('m1', 'keep')])]);
    const rows = store.getMessages(1, { at: 'newest' });
    expect(rows.map((m) => [m.text, m.deletedOnPhone])).toEqual([['keep', false], ['gone later', true]]);
    // Still searchable.
    expect(store.search('gone')[0]?.messages).toHaveLength(1);
  });

  it('keeps a whole chat that was removed from the phone, tagged the same way', () => {
    run([chat('a@x', 'Ada', [msg('m1', 'a')]), chat('b@x', 'Bo', [msg('m2', 'b')])]);
    run([chat('a@x', 'Ada', [msg('m1', 'a')])]);
    expect(store.listChats().map((c) => c.name).sort()).toEqual(['Ada', 'Bo']);
    expect(store.getMessages(2, { at: 'newest' })[0]).toMatchObject({ text: 'b', deletedOnPhone: true });
    expect(store.getMessages(1, { at: 'newest' })[0]).toMatchObject({ deletedOnPhone: false });
  });

  it('keeps the archived text when the phone only has a "deleted" tombstone', () => {
    run([chat('a@x', 'Ada', [msg('m1', 'original words')])]);
    run([chat('a@x', 'Ada', [msg('m1', null, { tombstone: true, kind: 'other' })])]);
    expect(store.getMessages(1, { at: 'newest' })[0]).toMatchObject({ text: 'original words', deletedOnPhone: true });
    expect(store.db.prepare('SELECT count(*) AS n FROM message_revisions').get()).toEqual({ n: 0 });
  });

  it('marks a run left "running" by a crash as interrupted on next open', () => {
    store.startRun('scheduled', 'wifi');
    store.close();
    store = new ArchiveStore(join(dir, 'archive.sqlite'));
    expect(store.history()[0]).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
  });
});

describe('media', () => {
  const withPhoto = (path: string | null) => [
    chat('a@x', 'Ada', [msg('m1', null, { kind: 'image', media: { localPath: path, mime: 'image/jpeg', sizeBytes: null, durationS: null, fileName: 'p.jpg', caption: null } })]),
  ];
  const source = (chats: SourceChat[], copies: string[]): ChatSource => ({
    chats: () => chats,
    copyMedia: async (localPath, dest) => {
      copies.push(localPath);
      writeFileSync(dest, 'first copy');
      return true;
    },
  });
  const mediaDir = () => join(dir, 'media');

  it('copies a media file once and never rewrites or deletes it', async () => {
    const copies: string[] = [];
    const first = store.startRun('first', 'usb');
    expect((await importSource(store, mediaDir(), source(withPhoto('Media/a/p.jpg'), copies), first)).newMedia).toBe(1);
    // Next backup: the phone has dropped the file. The archive keeps it.
    const second = store.startRun('manual', 'usb');
    expect((await importSource(store, mediaDir(), source(withPhoto(null), copies), second)).newMedia).toBe(0);
    expect(copies).toEqual(['Media/a/p.jpg']);
    expect(readFileSync(join(mediaDir(), 'Media/a/p.jpg'), 'utf8')).toBe('first copy');
    expect(store.getMessages(1, { at: 'newest' })[0]?.media).toMatchObject({ available: true });
  });

  it('shows media the phone never had as unavailable', async () => {
    const runId = store.startRun('first', 'usb');
    await importSource(store, mediaDir(), source(withPhoto(null), []), runId);
    expect(store.getMessages(1, { at: 'newest' })[0]?.media).toMatchObject({ available: false });
    expect(store.stats().media).toBe(0);
  });

  it('refuses media paths that try to leave the media folder', () => {
    expect(safeRelPath('../../etc/passwd')).toBeNull();
    expect(safeRelPath('Media/../x')).toBeNull();
    expect(safeRelPath('/Media//a/./b.jpg')).toBe('Media/a/b.jpg');
  });
});

describe('search', () => {
  beforeEach(() => {
    run([
      chat('a@x', 'Camera Club', [msg('m1', 'Meet at noon'), msg('m2', 'Bring the tripod')]),
      chat('b@x', 'Bo', [msg('m3', 'I bought a new camera'), msg('m4', 'CAMERAS are heavy'), msg('m5', '100% "quoted" (text)')]),
    ]);
  });

  it('finds chats by name and by message text, newest match first', () => {
    const hits = store.search('camera');
    const club = hits.find((h) => h.chatId === 1)!;
    const bo = hits.find((h) => h.chatId === 2)!;
    expect(club).toMatchObject({ nameMatch: true, messages: [] });
    expect(bo.nameMatch).toBe(false);
    expect(bo.messages.map((m) => m.id)).toEqual([4, 3]); // prefix match, newest first
  });

  it('survives FTS syntax and LIKE wildcards in the query', () => {
    expect(store.search('"quoted" (text)')[0]?.messages).toHaveLength(1);
    expect(store.search('100%')).toHaveLength(1);
    expect(store.search('%')).toEqual([]);
    expect(store.search('   ')).toEqual([]);
    expect(ftsQuery('a "b')).toBe('"a"* """b"*');
  });
});

describe('paging', () => {
  it('pages by time in both directions and around a message', () => {
    const many = Array.from({ length: 450 }, (_, i) => msg(`m${i}`, `t${i}`));
    run([chat('a@x', 'Ada', many)]);
    const newest = store.getMessages(1, { at: 'newest' });
    expect(newest).toHaveLength(200);
    expect([newest[0]!.text, newest.at(-1)!.text]).toEqual(['t250', 't449']);
    const older = store.getMessages(1, { at: 'before', sentAt: newest[0]!.sentAt, id: newest[0]!.id });
    expect([older[0]!.text, older.at(-1)!.text]).toEqual(['t50', 't249']);
    const newer = store.getMessages(1, { at: 'after', sentAt: older.at(-1)!.sentAt, id: older.at(-1)!.id });
    expect(newer[0]!.text).toBe('t250');
    const around = store.getMessages(1, { at: 'around', sentAt: older[0]!.sentAt, id: older[0]!.id });
    expect([around[0]!.text, around.at(-1)!.text, around.length]).toEqual(['t0', 't150', 151]);
  });

  it('orders messages that share a timestamp stably', () => {
    run([chat('a@x', 'Ada', [msg('x', 'first', { sentAt: 5 }), msg('y', 'second', { sentAt: 5 }), msg('z', 'third', { sentAt: 5 })])]);
    const all = store.getMessages(1, { at: 'newest' });
    const after = store.getMessages(1, { at: 'after', sentAt: 5, id: all[0]!.id });
    expect(after.map((m) => m.text)).toEqual(['second', 'third']);
  });
});

it('converts Core Data timestamps from the 2001 epoch', () => {
  expect(appleToUnix(0)).toBe(Date.UTC(2001, 0, 1) / 1000);
  expect(appleToUnix(721692800.75)).toBe(1_700_000_000);
});

it('handles an archive of 200,000 messages', () => {
  const t0 = performance.now();
  const runId = store.startRun('first', 'usb');
  store.importChat(runId, bigChat(200_000));
  store.finishImport(runId);
  const imported = performance.now();

  const timed = <T>(fn: () => T): [T, number] => {
    const start = performance.now();
    const value = fn();
    return [value, performance.now() - start];
  };
  const [newest, tNewest] = timed(() => store.getMessages(1, { at: 'newest' }));
  const mid = { sentAt: newest[0]!.sentAt - 100_000 * 60, id: 100_000 };
  const [around, tAround] = timed(() => store.getMessages(1, { at: 'around', ...mid }));
  const [older, tOlder] = timed(() => store.getMessages(1, { at: 'before', sentAt: around[0]!.sentAt, id: around[0]!.id }));
  const [hits, tSearch] = timed(() => store.search('camera'));
  const [list, tList] = timed(() => store.listChats());
  console.log(
    `200k: import ${Math.round(imported - t0)} ms, newest page ${tNewest.toFixed(1)} ms, around ${tAround.toFixed(1)} ms, ` +
      `older ${tOlder.toFixed(1)} ms, search ${tSearch.toFixed(1)} ms, chat list ${tList.toFixed(1)} ms`,
  );
  expect(newest).toHaveLength(200);
  expect(older).toHaveLength(200);
  expect(hits[0]!.messages.length).toBeGreaterThan(0);
  expect(list[0]!.messageCount).toBe(200_000);
  // A page must arrive well inside one frame budget for scrolling to stay smooth.
  for (const t of [tNewest, tAround, tOlder]) expect(t).toBeLessThan(50);
  expect(tSearch).toBeLessThan(500);
});
