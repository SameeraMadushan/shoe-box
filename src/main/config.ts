import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '../shared/types';

export const MOCK = process.env.CHAT_ARCHIVE_MOCK === '1';

/**
 * Mock-mode switches, comma separated in CHAT_ARCHIVE_MOCK_FLAGS:
 * encrypted (phone already has a backup password), win (Windows copy), nodrivers,
 * lowdisk, fail (next non-first backup fails once), nodrive (Drive not configured),
 * drivefail, big (adds a 200,000-message chat).
 */
const flags = new Set((process.env.CHAT_ARCHIVE_MOCK_FLAGS ?? '').split(',').filter(Boolean));
export const mockFlag = (name: string): boolean => MOCK && flags.has(name);
/** Divides mock delays; tests set it high to run fast. */
export const MOCK_SPEED = Number(process.env.CHAT_ARCHIVE_MOCK_SPEED) || 1;

export function defaultSettings(userData: string): Settings {
  return {
    onboarded: false,
    scheduleEnabled: true,
    scheduleTime: '20:00',
    notifyOnFail: true,
    startAtLogin: true,
    wifiSync: true,
    driveEnabled: false,
    driveConnected: false,
    driveEmail: null,
    // Mock data never touches the real archive folder.
    dataDir: process.env.CHAT_ARCHIVE_DATA_DIR ?? (MOCK ? join(userData, 'mock-data') : join(homedir(), 'ChatArchive')),
    udid: null,
    deviceName: null,
    lastScreen: 'chats',
    lastChatId: null,
    lastHandledDue: 0,
  };
}
