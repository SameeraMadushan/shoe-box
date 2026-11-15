import Database from 'better-sqlite3';
import type { ErrorCode } from '../../shared/errors';
import {
  PAGE_SIZE,
  type ChatSummary,
  type MessageCursor,
  type MessageKind,
  type MessageRow,
  type RunSummary,
  type SearchHit,
  type Transport,
  type Trigger,
} from '../../shared/types';
import { MIGRATIONS } from './migrations';

/** One message as read from the phone (or from the mock seed). */
export interface SourceMessage {
  sourceId: string;
  fromMe: boolean;
  senderJid: string | null;
  senderName: string | null;
  /** Unix seconds. */
  sentAt: number;
  kind: MessageKind;
  text: string | null;
  /** The phone holds only a "deleted" tombstone for this message. */
  tombstone?: boolean;
  media?: {
    /** Path of the file in the source, or null when the phone no longer has it. */
    localPath: string | null;
    mime: string | null;
    sizeBytes: number | null;
    durationS: number | null;
    fileName: string | null;
    caption: string | null;
  };
}

export interface SourceChat {
  jid: string;
  name: string;
  isGroup: boolean;
  memberCount: number | null;
  messages: Iterable<SourceMessage>;
}

export interface PendingMedia {
  mediaId: number;
  localPath: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw SQLite rows
type Row = any;

interface ExistingMessage {
  id: number;
  text: string | null;
}

/** Turns free text into a safe FTS5 prefix query, or null when there is nothing to search. */
export function ftsQuery(input: string): string | null {
  const tokens = input.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(' ');
}

export class ArchiveStore {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    // A run left "running" means the app died mid-run.
    this.db
      .prepare("UPDATE backup_runs SET status = 'failed', error_code = 'INTERRUPTED', finished_at = started_at WHERE status = 'running'")
      .run();
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  // --- runs ---

  startRun(trigger: Trigger, transport: Transport | null, now = Date.now()): number {
    const r = this.db
      .prepare("INSERT INTO backup_runs (started_at, trigger, transport, status) VALUES (?, ?, ?, 'running')")
      .run(Math.floor(now / 1000), trigger, transport);
    return Number(r.lastInsertRowid);
  }

  finishRun(
    runId: number,
    result: { status: 'succeeded' | 'failed'; errorCode?: ErrorCode | null; newMessages?: number; newMedia?: number },
    now = Date.now(),
  ): void {
    this.db
      .prepare('UPDATE backup_runs SET finished_at = ?, status = ?, error_code = ?, new_messages = ?, new_media = ? WHERE id = ?')
      .run(Math.floor(now / 1000), result.status, result.errorCode ?? null, result.newMessages ?? 0, result.newMedia ?? 0, runId);
  }

  setDriveStatus(runId: number, status: 'off' | 'synced' | 'failed'): void {
    this.db.prepare('UPDATE backup_runs SET drive_status = ? WHERE id = ?').run(status, runId);
  }

  history(limit = 30): RunSummary[] {
    const rows = this.db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT ?').all(limit) as Row[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      trigger: r.trigger,
      transport: r.transport,
      status: r.status,
      errorCode: r.error_code,
      newMessages: r.new_messages,
      newMedia: r.new_media,
      driveStatus: r.drive_status,
    }));
  }

  // --- import (ADR section 5 import rules) ---

  /** Imports one chat in one transaction. Returns counts and the media files still to copy. */
  importChat(runId: number, chat: SourceChat, now = Date.now()): { newMessages: number; pending: PendingMedia[] } {
    const nowS = Math.floor(now / 1000);
    const upsertChat = this.db.prepare(
      `INSERT INTO chats (jid, name, is_group, member_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name, is_group = excluded.is_group, member_count = excluded.member_count
       RETURNING id`,
    );
    const find = this.db.prepare('SELECT id, text FROM messages WHERE chat_id = ? AND source_id = ? AND from_me = ?');
    const insert = this.db.prepare(
      `INSERT INTO messages (chat_id, source_id, from_me, sender_jid, sender_name, sent_at, kind, text, first_seen_run, last_seen_run, deleted_on_phone_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const seen = this.db.prepare('UPDATE messages SET last_seen_run = ?, deleted_on_phone_at = NULL WHERE id = ?');
    const seenTombstone = this.db.prepare(
      'UPDATE messages SET last_seen_run = ?, deleted_on_phone_at = COALESCE(deleted_on_phone_at, ?) WHERE id = ?',
    );
    const revise = this.db.prepare('INSERT INTO message_revisions (message_id, text, replaced_at) VALUES (?, ?, ?)');
    const setText = this.db.prepare('UPDATE messages SET text = ? WHERE id = ?');
    const findMedia = this.db.prepare('SELECT id, rel_path FROM media WHERE message_id = ?');
    const insertMedia = this.db.prepare(
      'INSERT INTO media (message_id, mime, size_bytes, duration_s, file_name, caption) VALUES (?, ?, ?, ?, ?, ?)',
    );

    return this.db.transaction(() => {
      const chatId = (upsertChat.get(chat.jid, chat.name, chat.isGroup ? 1 : 0, chat.memberCount) as { id: number }).id;
      let newMessages = 0;
      const pending: PendingMedia[] = [];
      for (const m of chat.messages) {
        const fromMe = m.fromMe ? 1 : 0;
        const existing = find.get(chatId, m.sourceId, fromMe) as ExistingMessage | undefined;
        let messageId: number;
        if (!existing) {
          const r = insert.run(
            chatId, m.sourceId, fromMe, m.senderJid, m.senderName, m.sentAt, m.kind, m.text, runId, runId,
            m.tombstone ? nowS : null,
          );
          messageId = Number(r.lastInsertRowid);
          newMessages++;
        } else {
          messageId = existing.id;
          if (m.tombstone) {
            // Deleted for everyone on the phone: keep the text we already archived.
            seenTombstone.run(runId, nowS, messageId);
          } else {
            seen.run(runId, messageId);
            if ((existing.text ?? null) !== (m.text ?? null)) {
              revise.run(messageId, existing.text, nowS);
              setText.run(m.text, messageId);
            }
          }
        }
        if (m.media) {
          let media = findMedia.get(messageId) as { id: number; rel_path: string | null } | undefined;
          if (!media) {
            const r = insertMedia.run(messageId, m.media.mime, m.media.sizeBytes, m.media.durationS, m.media.fileName, m.media.caption);
            media = { id: Number(r.lastInsertRowid), rel_path: null };
          }
          if (media.rel_path === null && m.media.localPath) pending.push({ mediaId: media.id, localPath: m.media.localPath });
        }
      }
      return { newMessages, pending };
    })();
  }

  setMediaPath(mediaId: number, relPath: string, sizeBytes: number): void {
    this.db.prepare('UPDATE media SET rel_path = ?, size_bytes = ? WHERE id = ?').run(relPath, sizeBytes, mediaId);
  }

  /**
   * Call once after every chat on the phone was imported. Anything not seen in this
   * run has disappeared from the phone: it is tagged, never removed.
   */
  finishImport(runId: number, now = Date.now()): void {
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE messages SET deleted_on_phone_at = ? WHERE last_seen_run < ? AND deleted_on_phone_at IS NULL')
        .run(Math.floor(now / 1000), runId);
      this.db.exec(
        `UPDATE chats SET
           message_count = (SELECT count(*) FROM messages WHERE chat_id = chats.id),
           first_message_at = (SELECT min(sent_at) FROM messages WHERE chat_id = chats.id),
           last_message_at = (SELECT max(sent_at) FROM messages WHERE chat_id = chats.id)`,
      );
    })();
  }

  // --- queries for the UI ---

  listChats(): ChatSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, m.from_me AS p_from_me, m.kind AS p_kind, m.text AS p_text, m.id AS p_id
         FROM chats c LEFT JOIN messages m ON m.id =
           (SELECT id FROM messages WHERE chat_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1)
         WHERE c.message_count > 0
         ORDER BY c.last_message_at DESC, c.id`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isGroup: !!r.is_group,
      memberCount: r.member_count,
      lastMessageAt: r.last_message_at,
      firstMessageAt: r.first_message_at,
      messageCount: r.message_count,
      preview: r.p_id === null ? null : { fromMe: !!r.p_from_me, kind: r.p_kind, text: r.p_text },
    }));
  }

  getMessages(chatId: number, cursor: MessageCursor, limit = PAGE_SIZE): MessageRow[] {
    const select = `SELECT m.id, m.from_me, m.sender_name, m.sent_at, m.kind, m.text, m.deleted_on_phone_at,
        d.id AS media_id, d.rel_path, d.mime, d.duration_s, d.file_name
      FROM messages m LEFT JOIN media d ON d.message_id = m.id WHERE m.chat_id = ?`;
    const older = (sentAt: number, id: number, n: number, inclusive: boolean) =>
      this.db
        .prepare(`${select} AND (m.sent_at, m.id) ${inclusive ? '<=' : '<'} (?, ?) ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`)
        .all(chatId, sentAt, id, n)
        .reverse();
    const newer = (sentAt: number, id: number, n: number) =>
      this.db.prepare(`${select} AND (m.sent_at, m.id) > (?, ?) ORDER BY m.sent_at, m.id LIMIT ?`).all(chatId, sentAt, id, n);

    let rows: unknown[];
    if (cursor.at === 'newest') {
      rows = this.db.prepare(`${select} ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`).all(chatId, limit).reverse();
    } else if (cursor.at === 'before') {
      rows = older(cursor.sentAt, cursor.id, limit, false);
    } else if (cursor.at === 'after') {
      rows = newer(cursor.sentAt, cursor.id, limit);
    } else {
      const half = Math.floor(limit / 2);
      rows = [...older(cursor.sentAt, cursor.id, half, true), ...newer(cursor.sentAt, cursor.id, half)];
    }
    return (rows as Row[]).map((r) => ({
      id: r.id,
      fromMe: !!r.from_me,
      senderName: r.sender_name,
      sentAt: r.sent_at,
      kind: r.kind,
      text: r.text,
      deletedOnPhone: r.deleted_on_phone_at !== null,
      media:
        r.media_id === null
          ? null
          : { id: r.media_id, available: r.rel_path !== null, mime: r.mime, durationS: r.duration_s, fileName: r.file_name },
    }));
  }

  search(query: string, maxMessages = 5000): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    const hits = new Map<number, SearchHit>();
    const hit = (chatId: number) => {
      let h = hits.get(chatId);
      if (!h) hits.set(chatId, (h = { chatId, nameMatch: false, messages: [] }));
      return h;
    };
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    for (const r of this.db.prepare("SELECT id FROM chats WHERE name LIKE ? ESCAPE '\\'").all(like) as { id: number }[]) {
      hit(r.id).nameMatch = true;
    }
    const match = ftsQuery(q);
    if (match) {
      const rows = this.db
        .prepare(
          `SELECT m.id, m.chat_id, m.sent_at FROM messages_fts f JOIN messages m ON m.id = f.rowid
           WHERE messages_fts MATCH ? ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`,
        )
        .all(match, maxMessages) as { id: number; chat_id: number; sent_at: number }[];
      for (const r of rows) hit(r.chat_id).messages.push({ id: r.id, sentAt: r.sent_at });
    }
    return [...hits.values()];
  }

  stats(): { chats: number; messages: number; media: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      chats: one('SELECT count(*) AS n FROM chats WHERE message_count > 0'),
      messages: one('SELECT count(*) AS n FROM messages'),
      media: one('SELECT count(*) AS n FROM media WHERE rel_path IS NOT NULL'),
    };
  }

  mediaInfo(mediaId: number): { relPath: string; mime: string | null } | null {
    const r = this.db.prepare('SELECT rel_path, mime FROM media WHERE id = ?').get(mediaId) as
      | { rel_path: string | null; mime: string | null }
      | undefined;
    return r?.rel_path ? { relPath: r.rel_path, mime: r.mime } : null;
  }

  /** Consistent copy of the database for upload; never the live file (ADR section 8). */
  snapshot(destPath: string): void {
    this.db.prepare('VACUUM INTO ?').run(destPath);
  }
}
