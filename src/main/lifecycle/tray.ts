import { Menu, nativeImage, Tray } from 'electron';
import { encodePng } from '../../shared/png';

/** Draws the app mark (a chat bubble) so no image asset is needed. */
function trayIcon(): Electron.NativeImage {
  const size = 32;
  const mac = process.platform === 'darwin';
  const png = encodePng(size, size, (x, y) => {
    const inBubble = x >= 4 && x < 28 && y >= 6 && y < 22;
    const inTail = y >= 22 && y < 27 && x >= 6 && x < 6 + (27 - y);
    const on = inBubble || inTail;
    // Template image (black + alpha) on macOS; accent-text colour elsewhere.
    return mac ? [0, 0, 0, on ? 255 : 0] : [0x8f, 0xb0, 0xff, on ? 255 : 0];
  });
  const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  image.setTemplateImage(mac);
  return image;
}

export interface TrayActions {
  open(): void;
  backupNow(): void;
  quit(): void;
}

export function createTray(actions: TrayActions): { setStatus(line: string): void } {
  const tray = new Tray(trayIcon());
  tray.setToolTip('Chat Archive');
  const setStatus = (line: string) => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Chat Archive', click: actions.open },
        { label: 'Back up now', click: actions.backupNow },
        { label: line, enabled: false },
        { type: 'separator' },
        { label: 'Quit', click: actions.quit },
      ]),
    );
  };
  setStatus('No backup yet');
  // On Windows a click on the tray icon opens the app; macOS shows the menu.
  if (process.platform !== 'darwin') tray.on('click', actions.open);
  return { setStatus };
}
