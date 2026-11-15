import { Menu, nativeImage, Tray } from 'electron';
import markPath from '../../renderer/assets/mark.png?asset';

function trayIcon(): Electron.NativeImage {
  // 18 pt is the macOS menu bar size; Windows scales its tray icons itself.
  return nativeImage.createFromPath(markPath).resize({ width: process.platform === 'darwin' ? 18 : 32, quality: 'best' });
}

export interface TrayActions {
  open(): void;
  backupNow(): void;
  quit(): void;
}

export function createTray(actions: TrayActions): { setStatus(line: string): void } {
  const tray = new Tray(trayIcon());
  tray.setToolTip('Shoebox');
  const setStatus = (line: string) => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Shoebox', click: actions.open },
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
