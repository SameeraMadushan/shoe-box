// Mock chat source seeded with the prototype's sample chats (invented data only).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { encodePng } from '../shared/png';
import type { MessageKind } from '../shared/types';
import type { SourceChat, SourceMessage } from '../worker/archive/store';
import type { ChatSource } from '../worker/extract/pipeline';

interface SeedMessage {
  id: string;
  /** Days before today, and local time "HH:MM". */
  day: number;
  time: string;
  me?: boolean;
  sender?: string;
  text?: string;
  kind?: 'image' | 'video' | 'voice';
  file?: string;
  dur?: number;
  deleted?: boolean;
}

interface SeedChat {
  jid: string;
  name: string;
  members?: number;
  msgs: SeedMessage[];
}

const SEED: SeedChat[] = [
  { jid: 'nadia@mock', name: 'Nadia Perera', msgs: [
    { id: 'a1', day: 2, time: '18:12', text: 'Are you still coming on Sunday?' },
    { id: 'a2', day: 2, time: '18:15', me: true, text: 'Yes! What time should I be there?' },
    { id: 'a3', day: 2, time: '18:16', text: 'Around 11. Bring the camera' },
    { id: 'a4', day: 1, time: '09:40', kind: 'image', file: 'IMG_2041.png', text: 'Found this from the trip' },
    { id: 'a5', day: 1, time: '09:44', me: true, text: 'I forgot how good that view was' },
    { id: 'a6', day: 1, time: '09:50', kind: 'voice', file: 'PTT_0042.wav', dur: 42 },
    { id: 'a7', day: 1, time: '09:51', text: 'Ignore that last one, wrong chat', deleted: true },
    // No video file in the seed: this shows the "not available" placeholder.
    { id: 'a8', day: 0, time: '08:20', me: true, kind: 'video', dur: 68, text: 'From this morning' },
    { id: 'a9', day: 0, time: '08:31', text: 'Love it. See you at 11' },
  ] },
  { jid: 'hikers@g.mock', name: 'Weekend Hikers', members: 5, msgs: [
    { id: 'b1', day: 1, time: '16:02', sender: 'Tharindu', text: 'Trailhead at 6am. Who needs a lift?' },
    { id: 'b2', day: 1, time: '16:05', sender: 'Maya', text: 'Me please' },
    { id: 'b3', day: 1, time: '16:09', me: true, text: 'I can drive. Two seats free' },
    { id: 'b4', day: 1, time: '16:20', sender: 'Tharindu', kind: 'image', file: 'IMG_1988.png', text: 'Route map' },
    { id: 'b5', day: 1, time: '16:24', sender: 'Maya', kind: 'voice', file: 'PTT_0017.wav', dur: 17 },
    { id: 'b6', day: 1, time: '17:40', sender: 'Dilan', text: 'Bring the camera, forecast is clear' },
  ] },
  { jid: 'ravi@mock', name: 'Ravi', msgs: [
    { id: 'd1', day: 2, time: '11:30', me: true, text: 'Did the parcel arrive?' },
    { id: 'd2', day: 2, time: '11:52', text: 'Yes, this morning. Thanks for sending it' },
    { id: 'd3', day: 2, time: '11:53', kind: 'image', file: 'IMG_2030.png' },
  ] },
  { jid: 'flat4b@g.mock', name: 'Flat 4B', members: 3, msgs: [
    { id: 'e1', day: 3, time: '19:14', sender: 'Ishara', text: 'Plumber is coming Monday between 9 and 12' },
    { id: 'e2', day: 3, time: '19:20', me: true, text: 'I will be home' },
  ] },
  { jid: 'ishara@mock', name: 'Ishara', msgs: [
    { id: 'f1', day: 6, time: '00:01', text: 'Happy birthday!' },
    { id: 'f2', day: 6, time: '07:45', me: true, text: 'Thank you!' },
  ] },
];

function at(day: number, time: string, now: Date): number {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, h, m);
  return Math.floor(d.getTime() / 1000);
}

const MIME: Record<string, string> = { image: 'image/png', voice: 'audio/wav', video: 'video/mp4' };

function toSource(chat: SeedChat, now: Date): SourceChat {
  const isGroup = chat.jid.endsWith('@g.mock');
  return {
    jid: chat.jid,
    name: chat.name,
    isGroup,
    memberCount: chat.members ?? null,
    messages: chat.msgs.map((m): SourceMessage => {
      const kind: MessageKind = m.kind ?? 'text';
      return {
        sourceId: m.id,
        fromMe: !!m.me,
        senderJid: m.sender ? `${m.sender.toLowerCase()}@mock` : null,
        senderName: m.sender ?? null,
        sentAt: at(m.day, m.time, now),
        kind,
        text: m.text ?? null,
        tombstone: m.deleted,
        media: m.kind
          ? {
              localPath: m.file ? `Media/${chat.jid.split('@')[0]}/${m.file}` : null,
              mime: MIME[m.kind] ?? null,
              sizeBytes: null,
              durationS: m.dur ?? null,
              fileName: m.file ?? null,
              caption: m.kind === 'voice' ? null : (m.text ?? null),
            }
          : undefined,
      };
    }),
  };
}

/** A large invented chat for the 200,000-message performance check. */
export function bigChat(count: number, now = new Date()): SourceChat {
  const words = ['camera', 'trail', 'lunch', 'tomorrow', 'parcel', 'weekend', 'thanks', 'ok', 'see you', 'on my way'];
  const start = Math.floor(now.getTime() / 1000) - count * 60;
  return {
    jid: 'stress@mock',
    name: 'Archive stress test',
    isGroup: false,
    memberCount: null,
    messages: (function* () {
      for (let i = 0; i < count; i++) {
        yield {
          sourceId: `s${i}`, fromMe: i % 3 === 0, senderJid: null, senderName: null, sentAt: start + i * 60,
          kind: 'text', text: `${words[i % words.length]} ${words[(i * 7) % words.length]} #${i}`,
        } satisfies SourceMessage;
      }
    })(),
  };
}

function photo(seed: number): Buffer {
  // A soft two-tone gradient; enough to exercise thumbnails and the lightbox.
  return encodePng(520, 340, (x, y) => [
    90 + ((x * 110) / 520 + seed * 40) % 120,
    120 + (y * 90) / 340,
    170 + ((x + y) * 60) / 860,
    255,
  ]);
}

function tone(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const wav = Buffer.alloc(44 + n);
  wav.write('RIFF', 0, 'latin1');
  wav.writeUInt32LE(36 + n, 4);
  wav.write('WAVEfmt ', 8, 'latin1');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36, 'latin1');
  wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(18 * Math.sin((i * 2 * Math.PI * 220) / rate));
  return wav;
}

export function seedSource(options: { big?: boolean } = {}, now = new Date()): ChatSource {
  const durations = new Map(SEED.flatMap((c) => c.msgs).map((m) => [m.file, m.dur ?? 1]));
  return {
    chats: () => [...SEED.map((c) => toSource(c, now)), ...(options.big ? [bigChat(200_000, now)] : [])],
    async copyMedia(localPath, dest) {
      const file = localPath.split('/').pop()!;
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.endsWith('.wav') ? tone(durations.get(file) ?? 1) : photo(file.length + file.charCodeAt(6)));
      return true;
    },
  };
}
