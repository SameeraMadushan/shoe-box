// Reader for the chat app's ChatStorage.sqlite. Table and column mapping follows
// WhatsApp Chat Exporter's iOS handler (MIT, KnugiHK). See THIRD_PARTY.md.
import Database from 'better-sqlite3';
import { basename, extname } from 'node:path';
import { AppError } from '../../shared/errors';
import type { MessageKind } from '../../shared/types';
import type { SourceChat, SourceMessage } from '../archive/store';

export const CHAT_DOMAIN = 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared';
export const CHAT_DB_PATH = 'ChatStorage.sqlite';
/** ZMEDIALOCALPATH is relative to this folder inside the domain. */
export const MEDIA_PREFIX = 'Message/';

/** Core Data timestamps count seconds from 2001-01-01 UTC. */
export const APPLE_EPOCH_OFFSET = 978307200;
export const appleToUnix = (value: number): number => Math.floor(value + APPLE_EPOCH_OFFSET);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.heic': 'image/heic', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.opus': 'audio/ogg', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.wav': 'audio/wav', '.pdf': 'application/pdf',
};

// ZMESSAGETYPE values. Only 6, 14 and 15 are named in the reference; the rest is
// community knowledge and is unverified against a real database.
const TYPE_SYSTEM = 6;
const TYPE_DELETED = 14;
function kindOf(type: number, localPath: string | null): MessageKind {
  switch (type) {
    case 0: case 7: return 'text';
    case 1: case 15: return 'image';
    case 2: case 11: return 'video';
    case 3: return localPath && !/\.(opus|ogg)$/i.test(localPath) ? 'audio' : 'voice';
    case 8: return 'document';
    default: return 'other';
  }
}

interface Row {
  ZSTANZAID: string | null; ZISFROMME: number; ZMESSAGEDATE: number; ZTEXT: string | null; ZMESSAGETYPE: number | null;
  ZMEMBERJID: string | null; ZPUSHNAME: string | null; HAS_MEDIA: number | null; ZMEDIALOCALPATH: string | null;
  ZMOVIEDURATION: number | null; ZFILESIZE: number | null; ZTITLE: string | null; ZVCARDSTRING: string | null;
}

export class ChatStorage {
  private readonly db: Database.Database;
  private readonly columns = new Map<string, Set<string>>();

  constructor(path: string) {
    try {
      this.db = new Database(path, { readonly: true });
      for (const t of ['ZWACHATSESSION', 'ZWAMESSAGE', 'ZWAMEDIAITEM', 'ZWAGROUPMEMBER', 'ZWAPROFILEPUSHNAME']) {
        const cols = this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
        this.columns.set(t, new Set(cols.map((c) => c.name)));
      }
    } catch {
      throw new AppError('UNSUPPORTED_DATA', 'Chat database could not be opened');
    }
    const required: [string, string[]][] = [
      ['ZWACHATSESSION', ['Z_PK', 'ZCONTACTJID']],
      ['ZWAMESSAGE', ['Z_PK', 'ZSTANZAID', 'ZISFROMME', 'ZMESSAGEDATE', 'ZCHATSESSION']],
    ];
    for (const [table, cols] of required) {
      if (!cols.every((c) => this.has(table, c))) throw new AppError('UNSUPPORTED_DATA', `Missing columns in ${table}`);
    }
  }

  close(): void {
    this.db.close();
  }

  private has(table: string, column: string): boolean {
    return this.columns.get(table)?.has(column) ?? false;
  }

  /** `alias.column`, or NULL when this app version's schema lacks it. */
  private col(table: string, alias: string, column: string): string {
    return this.has(table, column) ? `${alias}.${column}` : 'NULL';
  }

  chats(): SourceChat[] {
    const s = (c: string) => this.col('ZWACHATSESSION', 's', c);
    const pushJoin = this.has('ZWAPROFILEPUSHNAME', 'ZJID') && this.has('ZWAPROFILEPUSHNAME', 'ZPUSHNAME');
    const sessions = this.db
      .prepare(
        `SELECT s.Z_PK, s.ZCONTACTJID, ${s('ZPARTNERNAME')} AS ZPARTNERNAME, ${pushJoin ? 'p.ZPUSHNAME' : 'NULL'} AS ZPUSHNAME
         FROM ZWACHATSESSION s ${pushJoin ? 'LEFT JOIN ZWAPROFILEPUSHNAME p ON p.ZJID = s.ZCONTACTJID' : ''}
         WHERE s.ZCONTACTJID IS NOT NULL`,
      )
      .all() as { Z_PK: number; ZCONTACTJID: string; ZPARTNERNAME: string | null; ZPUSHNAME: string | null }[];

    // Same rule as the reference's get_contact_name: prefer the saved contact name
    // unless it is just a phone number and the person has a profile name.
    const displayName = (r: (typeof sessions)[number]): string => {
      const partner = r.ZPARTNERNAME ?? '';
      const isPhone = /^\d+$/.test(partner.replace(/[+\s]/g, ''));
      return (r.ZPUSHNAME && (isPhone || !partner) ? r.ZPUSHNAME : partner) || r.ZCONTACTJID.split('@')[0]!;
    };
    const names = new Map(sessions.map((r) => [r.ZCONTACTJID, displayName(r)]));
    const memberCount = this.has('ZWAGROUPMEMBER', 'ZCHATSESSION')
      ? this.db.prepare('SELECT count(*) AS n FROM ZWAGROUPMEMBER WHERE ZCHATSESSION = ?')
      : null;

    return sessions
      .filter((r) => r.ZCONTACTJID !== 'status@broadcast')
      .map((r) => {
        const isGroup = r.ZCONTACTJID.endsWith('@g.us');
        return {
          jid: r.ZCONTACTJID,
          name: displayName(r),
          isGroup,
          memberCount: isGroup && memberCount ? (memberCount.get(r.Z_PK) as { n: number }).n : null,
          messages: this.messages(r.Z_PK, isGroup, names),
        };
      });
  }

  private *messages(chatPk: number, isGroup: boolean, names: Map<string, string>): Iterable<SourceMessage> {
    const m = (c: string) => this.col('ZWAMESSAGE', 'm', c);
    const mi = (c: string) => this.col('ZWAMEDIAITEM', 'mi', c);
    const memberJoin = this.has('ZWAMESSAGE', 'ZGROUPMEMBER') && this.has('ZWAGROUPMEMBER', 'ZMEMBERJID');
    const pushJoin = memberJoin && this.has('ZWAPROFILEPUSHNAME', 'ZJID') && this.has('ZWAPROFILEPUSHNAME', 'ZPUSHNAME');
    const mediaJoin = this.has('ZWAMEDIAITEM', 'ZMESSAGE');
    const rows = this.db
      .prepare(
        `SELECT m.ZSTANZAID, m.ZISFROMME, m.ZMESSAGEDATE, ${m('ZTEXT')} AS ZTEXT, ${m('ZMESSAGETYPE')} AS ZMESSAGETYPE,
           ${memberJoin ? 'gm.ZMEMBERJID' : 'NULL'} AS ZMEMBERJID, ${pushJoin ? 'pn.ZPUSHNAME' : 'NULL'} AS ZPUSHNAME,
           ${mediaJoin ? 'mi.Z_PK' : 'NULL'} AS HAS_MEDIA, ${mi('ZMEDIALOCALPATH')} AS ZMEDIALOCALPATH,
           ${mi('ZMOVIEDURATION')} AS ZMOVIEDURATION, ${mi('ZFILESIZE')} AS ZFILESIZE, ${mi('ZTITLE')} AS ZTITLE,
           ${mi('ZVCARDSTRING')} AS ZVCARDSTRING
         FROM ZWAMESSAGE m
         ${memberJoin ? 'LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER' : ''}
         ${pushJoin ? 'LEFT JOIN ZWAPROFILEPUSHNAME pn ON pn.ZJID = gm.ZMEMBERJID' : ''}
         ${mediaJoin ? 'LEFT JOIN ZWAMEDIAITEM mi ON mi.ZMESSAGE = m.Z_PK' : ''}
         WHERE m.ZCHATSESSION = ? ORDER BY m.ZMESSAGEDATE`,
      )
      .iterate(chatPk) as IterableIterator<Row>;

    for (const r of rows) {
      const type = r.ZMESSAGETYPE ?? 0;
      if (!r.ZSTANZAID || type === TYPE_SYSTEM) continue; // system events are not messages
      const fromMe = r.ZISFROMME === 1;
      const localPath = r.ZMEDIALOCALPATH || null;
      const kind = kindOf(type, localPath);
      const hasMedia = r.HAS_MEDIA !== null && kind !== 'text' && kind !== 'other';
      const captioned = kind === 'image' || kind === 'video';
      const vcardMime = r.ZVCARDSTRING && /^[\w.+-]+\/[\w.+-]+$/.test(r.ZVCARDSTRING) ? r.ZVCARDSTRING : null;
      yield {
        sourceId: r.ZSTANZAID,
        fromMe,
        senderJid: isGroup && !fromMe ? r.ZMEMBERJID : null,
        senderName:
          isGroup && !fromMe && r.ZMEMBERJID
            ? (names.get(r.ZMEMBERJID) ?? r.ZPUSHNAME ?? r.ZMEMBERJID.split('@')[0]!)
            : null,
        sentAt: appleToUnix(r.ZMESSAGEDATE),
        kind,
        text: r.ZTEXT ?? (captioned ? r.ZTITLE : null),
        tombstone: type === TYPE_DELETED,
        media: hasMedia
          ? {
              localPath: localPath && MEDIA_PREFIX + localPath,
              mime: vcardMime ?? (localPath ? (MIME_BY_EXT[extname(localPath).toLowerCase()] ?? null) : null),
              sizeBytes: r.ZFILESIZE,
              durationS: r.ZMOVIEDURATION || null,
              fileName: kind === 'document' ? (r.ZTITLE ?? (localPath && basename(localPath))) : localPath && basename(localPath),
              caption: captioned ? r.ZTITLE : null,
            }
          : undefined,
      };
    }
  }
}
