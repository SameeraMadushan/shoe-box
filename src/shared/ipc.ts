// Single definition of every IPC channel (ADR section 11). The preload builds
// window.api from CHANNELS; the main process registers handlers from the same list.
import type { ErrorCode } from './errors';
import type { AppState, ChatSummary, ExternalLink, MessageCursor, MessageRow, Preflight, SearchHit, Settings } from './types';

export interface Api {
  getState(): AppState;
  checkDrivers(): void;
  /** Start or stop polling for a connected iPhone. */
  deviceSearch(on: boolean): void;
  pair(): void;
  /** Saves the backup password; for a new password also turns encryption on. */
  submitPassword(password: string): { ok: true } | { ok: false; error: ErrorCode };
  preflight(): Preflight;
  backupNow(): void;
  finishOnboarding(): void;
  restartOnboarding(): void;
  updateSettings(patch: Partial<Pick<Settings, EditableSetting>>): void;
  listChats(): ChatSummary[];
  search(query: string): SearchHit[];
  getMessages(chatId: number, cursor: MessageCursor): MessageRow[];
  driveConnect(): void;
  driveConfirmKey(): void;
  driveDisconnect(): void;
  driveRevealKey(): string | null;
  changeLocation(): void;
  openExternal(link: ExternalLink): void;
  getLicences(): string;
}

export type EditableSetting =
  | 'scheduleEnabled'
  | 'scheduleTime'
  | 'notifyOnFail'
  | 'startAtLogin'
  | 'wifiSync'
  | 'driveEnabled'
  | 'lastScreen'
  | 'lastChatId';

const channelMap: Record<keyof Api, true> = {
  getState: true,
  checkDrivers: true,
  deviceSearch: true,
  pair: true,
  submitPassword: true,
  preflight: true,
  backupNow: true,
  finishOnboarding: true,
  restartOnboarding: true,
  updateSettings: true,
  listChats: true,
  search: true,
  getMessages: true,
  driveConnect: true,
  driveConfirmKey: true,
  driveDisconnect: true,
  driveRevealKey: true,
  changeLocation: true,
  openExternal: true,
  getLicences: true,
};
export const CHANNELS = Object.keys(channelMap) as (keyof Api)[];

/** Events pushed from main to the renderer. */
export interface Events {
  state: AppState;
  /** The archive content changed; chat lists should reload. */
  archiveChanged: null;
  navigate: 'chats' | 'backup';
}
export const EVENTS: (keyof Events)[] = ['state', 'archiveChanged', 'navigate'];

export type ApiClient = {
  [K in keyof Api]: (...args: Parameters<Api[K]>) => Promise<ReturnType<Api[K]>>;
} & {
  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void;
};

export type ApiHandlers = {
  [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>>;
};
