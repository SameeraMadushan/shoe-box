import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { ArchiveStore, PendingMedia, SourceChat } from '../archive/store';

/** Where chats come from: a decrypted iPhone backup, or the mock seed. */
export interface ChatSource {
  chats(): SourceChat[];
  /** Writes one media file to dest. Resolves false when the source no longer has it. */
  copyMedia(localPath: string, dest: string): Promise<boolean>;
}

export type PhaseProgress = (phase: 2 | 3, fraction: number) => void;

/** Keeps a source path inside the media folder, whatever the phone's database says. */
export function safeRelPath(localPath: string): string | null {
  const parts = localPath.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  return parts.join('/');
}

/** ADR section 5 pipeline steps 5 to 7: chats and messages, then new media, then deletions. */
export async function importSource(
  store: ArchiveStore,
  mediaDir: string,
  source: ChatSource,
  runId: number,
  onProgress: PhaseProgress = () => {},
): Promise<{ newMessages: number; newMedia: number }> {
  const chats = source.chats();
  let newMessages = 0;
  const pending: PendingMedia[] = [];
  chats.forEach((chat, i) => {
    const r = store.importChat(runId, chat);
    newMessages += r.newMessages;
    pending.push(...r.pending);
    onProgress(2, (i + 1) / chats.length);
  });

  let newMedia = 0;
  const root = resolve(mediaDir);
  for (const [i, item] of pending.entries()) {
    const rel = safeRelPath(item.localPath);
    const dest = rel && resolve(root, rel);
    if (rel && dest && dest.startsWith(root + sep)) {
      // Media files are immutable: one already in the archive is never rewritten.
      const existing = await stat(dest).catch(() => null);
      if (existing || (await source.copyMedia(item.localPath, dest))) {
        store.setMediaPath(item.mediaId, rel, existing?.size ?? (await stat(dest)).size);
        if (!existing) newMedia++;
      }
    }
    onProgress(3, (i + 1) / pending.length);
  }

  store.finishImport(runId);
  onProgress(3, 1);
  return { newMessages, newMedia };
}
