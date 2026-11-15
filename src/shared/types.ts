import type { ErrorCode } from './errors';

export type Trigger = 'first' | 'scheduled' | 'wake' | 'manual' | 'retry';
export type Transport = 'usb' | 'wifi';
export type MessageKind = 'text' | 'image' | 'video' | 'voice' | 'audio' | 'document' | 'other';
export type Screen = 'chats' | 'backup';

export interface Settings {
  onboarded: boolean;
  scheduleEnabled: boolean;
  /** Daily backup time, local, "HH:MM". */
  scheduleTime: string;
  notifyOnFail: boolean;
  startAtLogin: boolean;
  wifiSync: boolean;
  driveEnabled: boolean;
  /** Set once the recovery key has been shown and confirmed. */
  driveConnected: boolean;
  driveEmail: string | null;
  dataDir: string;
  udid: string | null;
  deviceName: string | null;
  lastScreen: Screen;
  lastChatId: number | null;
  /** Start (ms) of the scheduled slot the scheduler has already dealt with. */
  lastHandledDue: number;
}

export interface RunSummary {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  trigger: Trigger;
  transport: Transport | null;
  status: 'running' | 'succeeded' | 'failed';
  errorCode: ErrorCode | null;
  newMessages: number;
  newMedia: number;
  driveStatus: 'off' | 'synced' | 'failed' | null;
}

export interface ActiveRun {
  trigger: Trigger;
  /** 0 backing up, 1 decrypting, 2 reading chats, 3 indexing media, 4 finished. */
  phase: number;
  percent: number;
}

export interface DeviceState {
  status: 'idle' | 'searching' | 'found' | 'pairing' | 'trusted';
  name: string | null;
  /** True when the phone already has a backup password from an earlier backup. */
  willEncrypt: boolean | null;
  error: ErrorCode | null;
}

export type DriveStatus = 'unconfigured' | 'off' | 'needsConnect' | 'connecting' | 'recoveryKey' | 'connected' | 'syncing' | 'syncFailed';

export interface AppState {
  platform: 'darwin' | 'win32' | 'linux';
  mock: boolean;
  settings: Settings;
  /** Windows only: whether Apple's device service is running. Always true elsewhere. */
  driversOk: boolean;
  /** False when the OS cannot protect secrets; scheduling is then disabled. */
  secureStorage: boolean;
  /** True when Wi-Fi syncing must be switched on by hand (no tool support). */
  wifiManualSetup: boolean;
  device: DeviceState;
  run: ActiveRun | null;
  history: RunSummary[];
  nextBackupAt: number | null;
  drive: { status: DriveStatus; recoveryKey: string | null; syncPercent: number };
  storage: { backupBytes: number; mediaBytes: number; dbBytes: number };
  stats: { chats: number; messages: number; media: number };
}

export interface ChatSummary {
  id: number;
  name: string;
  isGroup: boolean;
  memberCount: number | null;
  lastMessageAt: number | null;
  firstMessageAt: number | null;
  messageCount: number;
  preview: { fromMe: boolean; kind: MessageKind; text: string | null } | null;
}

export interface MessageRow {
  id: number;
  fromMe: boolean;
  senderName: string | null;
  sentAt: number;
  kind: MessageKind;
  text: string | null;
  deletedOnPhone: boolean;
  media: { id: number; available: boolean; mime: string | null; durationS: number | null; fileName: string | null } | null;
}

/** Page of messages: the newest page, or the page before/after/around a message. */
export type MessageCursor =
  | { at: 'newest' }
  | { at: 'before' | 'after' | 'around'; sentAt: number; id: number };

export interface SearchHit {
  chatId: number;
  nameMatch: boolean;
  /** Matching message ids with their time, newest first. */
  messages: { id: number; sentAt: number }[];
}

export interface Preflight {
  ok: boolean;
  requiredBytes: number;
  availableBytes: number;
}

/** Fixed allowlist of links that may open in the system browser. */
export const EXTERNAL_LINKS = {
  appleDevices: 'https://apps.microsoft.com/detail/9np83lwlpz9k',
  releases: 'https://github.com/chat-archive/chat-archive/releases',
  resetBackupPassword: 'https://support.apple.com/108313',
} as const;
export type ExternalLink = keyof typeof EXTERNAL_LINKS;

export const PAGE_SIZE = 200;
