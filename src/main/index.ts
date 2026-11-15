// Main process composition root: lifecycle, services, typed IPC and app state.
import { app, dialog, ipcMain, Menu, net, Notification, powerMonitor, session, shell, systemPreferences, type BrowserWindow } from 'electron';
import { cp, readFile, rename, rm, statfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MockDeviceService } from '../mocks/device.mock';
import { MockDriveService } from '../mocks/drive.mock';
import { ERROR_COPY, toErrorCode, type ErrorCode } from '../shared/errors';
import { CHANNELS, type ApiHandlers, type EditableSetting, type Events } from '../shared/ipc';
import { EXTERNAL_LINKS, type AppState, type DriveStatus, type Settings } from '../shared/types';
import { BackupRunner } from './backup-runner';
import { defaultSettings, MOCK, MOCK_SPEED, mockFlag } from './config';
import type { Device, DeviceService } from './device/service';
import { ToolDeviceService } from './device/tools';
import { AUTH_ENDPOINT, type Fetch } from './drive/oauth';
import { RcloneDriveService, type DriveService } from './drive/service';
import { createTray } from './lifecycle/tray';
import { createWindow } from './lifecycle/window';
import { initLog, log } from './log';
import { handleMediaProtocol, registerMediaScheme } from './media-protocol';
import { installNetworkGuard } from './network-guard';
import { nextSlot, Scheduler } from './scheduler/scheduler';
import { createSecrets } from './secrets';
import { SettingsStore } from './settings';
import { WorkerClient } from './worker-client';

app.setName('Chat Archive');
if (process.env.CHAT_ARCHIVE_USER_DATA) app.setPath('userData', process.env.CHAT_ARCHIVE_USER_DATA);
else if (MOCK) app.setPath('userData', `${app.getPath('userData')} (mock)`);
registerMediaScheme();

if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(main);

const EDITABLE: EditableSetting[] = [
  'scheduleEnabled', 'scheduleTime', 'notifyOnFail', 'startAtLogin', 'wifiSync', 'driveEnabled', 'lastScreen', 'lastChatId',
];

async function main(): Promise<void> {
  const userData = app.getPath('userData');
  initLog(join(userData, 'logs'));
  const settings = new SettingsStore(join(userData, 'settings.json'), defaultSettings(userData));
  const secrets = createSecrets(join(userData, 'secrets.bin'), MOCK);

  const devOrigin = app.isPackaged ? null : (process.env.ELECTRON_RENDERER_URL ?? null);
  installNetworkGuard(session.defaultSession, () => ({ devOrigin, driveEnabled: settings.get().driveEnabled }));

  const worker = new WorkerClient(join(__dirname, 'worker.js'));
  await worker.call('open', settings.get().dataDir);
  handleMediaProtocol((id) => worker.call('mediaFile', id));

  const binDir = app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'vendor', `${process.platform}-${process.arch}`);
  const device: DeviceService = MOCK ? new MockDeviceService(settings.get().onboarded) : new ToolDeviceService(binDir);
  // Main-process requests go through the default session, so the network guard applies to them too.
  const guardedFetch: Fetch = (url, init) => net.fetch(url, init);
  const drive: DriveService = MOCK
    ? new MockDriveService(secrets)
    : new RcloneDriveService(
        { clientId: __GOOGLE_OAUTH_CLIENT_ID__, clientSecret: __GOOGLE_OAUTH_CLIENT_SECRET__ },
        secrets,
        guardedFetch,
        (url) => {
          if (url.startsWith(`${AUTH_ENDPOINT}?`)) void shell.openExternal(url);
        },
        join(binDir, process.platform === 'win32' ? 'rclone.exe' : 'rclone'),
      );

  // --- state ---

  let win: BrowserWindow | null = null;
  let quitting = false;
  let driveConnecting = false;
  let pendingKey: string | null = null;
  let syncPercent: number | null = null;
  let currentDevice: Device | null = null;
  let searchTimer: ReturnType<typeof setInterval> | null = null;
  let pairTimer: ReturnType<typeof setInterval> | null = null;

  const state: AppState = {
    platform: mockFlag('win') ? 'win32' : (process.platform as AppState['platform']),
    mock: MOCK,
    settings: settings.get(),
    driversOk: await device.driversOk(),
    secureStorage: secrets.persistent,
    wifiManualSetup: !device.canEnableWifi,
    device: { status: 'idle', name: settings.get().deviceName, iosVersion: null, willEncrypt: null, error: null },
    run: null,
    history: [],
    nextBackupAt: null,
    drive: { status: 'off', recoveryKey: null, syncPercent: 0 },
    storage: { backupBytes: 0, mediaBytes: 0, dbBytes: 0, freeBytes: 0 },
    stats: { chats: 0, messages: 0, media: 0 },
  };

  const send = <E extends keyof Events>(event: E, payload: Events[E]) => {
    if (win && !win.isDestroyed()) win.webContents.send(event, payload);
  };

  function driveStatus(): DriveStatus {
    const s = settings.get();
    if (!drive.configured) return 'unconfigured';
    if (!s.driveEnabled) return 'off';
    if (driveConnecting) return 'connecting';
    if (pendingKey) return 'recoveryKey';
    if (!s.driveConnected) return 'needsConnect';
    if (syncPercent !== null) return 'syncing';
    const lastOk = state.history.find((r) => r.status === 'succeeded');
    return lastOk?.driveStatus === 'failed' ? 'syncFailed' : 'connected';
  }

  /** Recomputes the derived parts of the state and pushes it to the window. */
  function push(patch: Partial<AppState> = {}): void {
    Object.assign(state, patch);
    const s = (state.settings = settings.get());
    state.drive = { status: driveStatus(), recoveryKey: pendingKey, syncPercent: syncPercent ?? 0 };
    state.nextBackupAt = s.onboarded && s.scheduleEnabled && secrets.persistent ? nextSlot(Date.now(), s.scheduleTime) : null;
    send('state', state);
  }

  /** Free space on the disk that holds (or will hold) a folder. */
  async function freeBytes(dir: string): Promise<number> {
    let probe = dir;
    while (!existsSync(probe)) probe = dirname(probe);
    const fs = await statfs(probe);
    return fs.bavail * fs.bsize;
  }

  async function refreshArchive(): Promise<void> {
    const [history, stats] = await Promise.all([worker.call('history'), worker.call('stats')]);
    push({ history, stats });
    const last = history[0];
    tray.setStatus(
      !last ? 'No backup yet' : last.status === 'failed' ? 'Last backup failed' : `Last backup: ${new Date(last.startedAt * 1000).toLocaleString()}`,
    );
    // Sizing the backup folder can take a while; do not hold the UI for it.
    const dataDir = settings.get().dataDir;
    void Promise.all([worker.call('storage', join(dataDir, 'backup')), freeBytes(dataDir)])
      .then(([sizes, free]) => push({ storage: { ...sizes, freeBytes: free } }))
      .catch(() => {});
  }

  // --- backup runs and scheduling ---

  const runner = new BackupRunner({
    mock: MOCK,
    big: mockFlag('big'),
    device,
    drive,
    worker,
    secrets,
    settings,
    onRun: (run) => push({ run }),
    onDriveSync: (percent) => {
      syncPercent = percent;
      push();
    },
    onFinished: async (ok) => {
      await refreshArchive();
      if (ok) send('archiveChanged', null);
    },
  });

  function notifyFailure(code: ErrorCode): void {
    if (!settings.get().notifyOnFail || !Notification.isSupported()) return;
    const n = new Notification({ title: 'Backup did not run', body: ERROR_COPY[code].sentence });
    n.on('click', () => showWindow('backup'));
    n.show();
  }

  const scheduler = new Scheduler({
    config: () => {
      const s = settings.get();
      return { enabled: s.onboarded && s.scheduleEnabled && secrets.persistent, time: s.scheduleTime, lastHandledDue: s.lastHandledDue };
    },
    lastSuccessAt: () => {
      const last = state.history.find((r) => r.status === 'succeeded');
      return last ? last.startedAt * 1000 : null;
    },
    isRunning: () => runner.isRunning(),
    attempt: (trigger, final) => runner.attempt(trigger, final),
    markHandled: (slot) => void settings.update({ lastHandledDue: slot }),
    notifyFailure,
  });

  // --- window, tray, lifecycle ---

  function showWindow(navigate?: Events['navigate']): void {
    if (!win || win.isDestroyed()) {
      win = createWindow();
      // Closing the window drops the renderer to keep idle memory low; the app
      // stays in the tray and the window is recreated on demand (ADR section 3).
      win.on('closed', () => (win = null));
      if (navigate) win.webContents.once('did-finish-load', () => send('navigate', navigate));
    } else {
      win.show();
      win.focus();
      if (navigate) send('navigate', navigate);
    }
  }

  const tray = createTray({
    open: () => showWindow(),
    backupNow: () => {
      if (settings.get().onboarded) void runner.attempt('manual', true);
      showWindow('backup');
    },
    quit: () => {
      quitting = true;
      app.quit();
    },
  });

  function applyLoginItem(): void {
    // Never register a development or mock build to start at login.
    if (!app.isPackaged || MOCK) return;
    const s = settings.get();
    app.setLoginItemSettings({ openAtLogin: s.onboarded && s.startAtLogin, args: ['--hidden'] });
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []), { role: 'editMenu' }, { role: 'windowMenu' }]),
  );
  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {
    if (quitting) app.quit(); // otherwise keep running in the tray
  });
  app.on('will-quit', () => {
    runner.cancel(); // never leave the backup tool running without the app
    scheduler.stop();
    worker.kill();
  });
  powerMonitor.on('resume', () => void scheduler.check('resume'));
  powerMonitor.on('unlock-screen', () => void scheduler.check('resume'));

  // --- onboarding: device search and pairing ---

  function stopTimers(): void {
    if (searchTimer) clearInterval(searchTimer);
    if (pairTimer) clearInterval(pairTimer);
    searchTimer = pairTimer = null;
  }

  function deviceFailed(e: unknown): void {
    stopTimers();
    push({ device: { ...state.device, error: toErrorCode(e) } });
  }

  function startSearch(): void {
    stopTimers();
    currentDevice = null;
    push({ device: { status: 'searching', name: null, iosVersion: null, willEncrypt: null, error: null } });
    const poll = async () => {
      try {
        const found = (await device.list(false))[0];
        if (!found || currentDevice) return;
        currentDevice = found;
        stopTimers();
        const info = await device.info(found);
        settings.update({ udid: found.udid, deviceName: info.name });
        push({ device: { status: 'found', name: info.name, iosVersion: info.iosVersion || null, willEncrypt: null, error: null } });
      } catch (e) {
        deviceFailed(e);
      }
    };
    searchTimer = setInterval(() => void poll(), 2000 / (MOCK ? 4 * MOCK_SPEED : 1));
    void poll();
  }

  function startPairing(): void {
    if (!currentDevice) return;
    const target = currentDevice;
    stopTimers();
    push({ device: { ...state.device, status: 'pairing', error: null } });
    const poll = async () => {
      try {
        if (!(await device.pair(target))) return;
        stopTimers();
        const willEncrypt = await device.willEncrypt(target);
        push({ device: { ...state.device, status: 'trusted', willEncrypt } });
      } catch (e) {
        deviceFailed(e);
      }
    };
    pairTimer = setInterval(() => void poll(), 2000 / (MOCK ? 4 * MOCK_SPEED : 1));
    void poll();
  }

  // --- typed IPC ---

  const handlers: ApiHandlers = {
    getState: () => state,
    checkDrivers: async () => push({ driversOk: await device.driversOk() }),
    deviceSearch: (on) => (on ? startSearch() : stopTimers()),
    pair: () => startPairing(),
    async submitPassword(password) {
      if (typeof password !== 'string' || password.length < 1) return { ok: false, error: 'WRONG_PASSWORD' };
      try {
        // A phone without a backup password gets encryption turned on with this one.
        // One that already has a password is validated when the backup is first opened.
        if (state.device.willEncrypt === false && currentDevice) {
          await device.enableEncryption(currentDevice, password);
          push({ device: { ...state.device, willEncrypt: true } });
        }
        secrets.set('backupPassword', password);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: toErrorCode(e) };
      }
    },
    async preflight() {
      const availableBytes = await freeBytes(settings.get().dataDir);
      // The first backup needs about as much space as is used on the phone.
      const requiredBytes = currentDevice ? await device.usedBytes(currentDevice).catch(() => 0) : 0;
      if (requiredBytes > 0) settings.update({ phoneUsedBytes: requiredBytes });
      push({ storage: { ...state.storage, freeBytes: availableBytes } });
      return { ok: availableBytes > requiredBytes, requiredBytes, availableBytes };
    },
    backupNow: () => {
      // While a run is active the UI simply shows it (scheduler rule 5).
      if (!runner.isRunning()) void runner.attempt(settings.get().onboarded ? 'manual' : 'first', true);
    },
    cancelBackup: () => runner.cancel(),
    finishOnboarding: () => {
      stopTimers();
      settings.update({ onboarded: true });
      applyLoginItem();
      push();
    },
    restartOnboarding: () => {
      settings.update({ onboarded: false });
      applyLoginItem();
      push({ device: { status: 'idle', name: null, iosVersion: null, willEncrypt: null, error: null } });
    },
    updateSettings: (patch) => {
      const clean: Partial<Settings> = {};
      for (const key of EDITABLE) {
        if (key in patch) Object.assign(clean, { [key]: patch[key] });
      }
      if (clean.scheduleTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.scheduleTime)) delete clean.scheduleTime;
      settings.update(clean);
      if ('startAtLogin' in clean) applyLoginItem();
      push();
    },
    listChats: () => worker.call('listChats'),
    search: (query) => worker.call('search', String(query)),
    getMessages: (chatId, cursor) => worker.call('getMessages', chatId, cursor),
    async driveConnect() {
      if (driveConnecting || !drive.configured) return;
      driveConnecting = true;
      push();
      try {
        const driveEmail = await drive.connect();
        settings.update({ driveEmail });
        pendingKey = drive.recoveryKey();
      } catch {
        log('drive_connect_failed');
      } finally {
        driveConnecting = false;
        push();
      }
    },
    driveConfirmKey: () => {
      if (!pendingKey) return;
      pendingKey = null;
      settings.update({ driveConnected: true });
      push();
    },
    async driveDisconnect() {
      await drive.disconnect();
      pendingKey = null;
      settings.update({ driveConnected: false, driveEmail: null });
      push();
    },
    async driveRevealKey() {
      // Behind an OS authentication prompt where one is available.
      if (!MOCK && process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
        try {
          await systemPreferences.promptTouchID('show your Drive recovery key');
        } catch {
          return null;
        }
      }
      return secrets.get('driveRecoveryKey');
    },
    async changeLocation() {
      if (runner.isRunning() || !win) return;
      const picked = await dialog.showOpenDialog(win, { title: 'Choose where to keep your archive', properties: ['openDirectory', 'createDirectory'] });
      const parent = picked.filePaths[0];
      if (picked.canceled || !parent) return;
      const from = settings.get().dataDir;
      const to = join(parent, 'ChatArchive');
      if (to === from || existsSync(to)) return;
      await worker.call('close');
      try {
        // Changing the location moves the data (ADR section 5).
        await rename(from, to).catch(async () => {
          await cp(from, to, { recursive: true, errorOnExist: true });
          await rm(from, { recursive: true, force: true });
        });
        settings.update({ dataDir: to });
      } catch {
        log('move_failed');
        await rm(to, { recursive: true, force: true });
      }
      await worker.call('open', settings.get().dataDir);
      await refreshArchive();
    },
    openExternal: (link) => {
      // Only fixed, allowlisted URLs ever open in the browser.
      if (Object.hasOwn(EXTERNAL_LINKS, link)) void shell.openExternal(EXTERNAL_LINKS[link]);
    },
    getLicences: () =>
      readFile(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'THIRD_PARTY.md'), 'utf8').catch(
        () => 'Licence information is missing from this build.',
      ),
  };
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, (_event, ...args) => (handlers[channel] as (...a: unknown[]) => unknown)(...args));
  }

  await refreshArchive();
  applyLoginItem();
  scheduler.start();
  log('app_started', { mock: MOCK, onboarded: settings.get().onboarded });

  const openedHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  if (!openedHidden) showWindow();
}
