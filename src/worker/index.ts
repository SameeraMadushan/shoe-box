// Worker (Electron utilityProcess): everything that touches SQLite or decrypts data
// runs here so the main process and the UI stay responsive (ADR section 4).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedSource } from '../mocks/archive.seed';
import { toErrorCode, type ErrorCode } from '../shared/errors';
import type { MessageCursor, Transport, Trigger } from '../shared/types';
import { ArchiveStore } from './archive/store';
import { MIGRATIONS } from './archive/migrations';
import { openBackupSource } from './extract/backup-source';
import type { PhaseProgress } from './extract/pipeline';
import { dataPaths, dirSize, prepareDataDir, runImport, type DataPaths } from './extract/run';

let store: ArchiveStore | null = null;
let paths: DataPaths;

const db = (): ArchiveStore => {
  if (!store) throw new Error('Archive is not open');
  return store;
};
const progress: PhaseProgress = (phase, fraction) => process.parentPort.postMessage({ event: 'progress', payload: { phase, fraction } });

const methods = {
  async open(dataDir: string) {
    store?.close();
    paths = dataPaths(dataDir);
    await prepareDataDir(paths);
    store = new ArchiveStore(paths.dbPath);
  },
  close() {
    store?.close();
    store = null;
  },
  listChats: () => db().listChats(),
  getMessages: (chatId: number, cursor: MessageCursor) => db().getMessages(chatId, cursor),
  search: (query: string) => db().search(query),
  stats: () => db().stats(),
  history: () => db().history(),
  mediaFile(mediaId: number) {
    const info = db().mediaInfo(mediaId);
    return info && { path: join(paths.mediaDir, info.relPath), mime: info.mime };
  },
  extract: (run: { trigger: Trigger; transport: Transport | null; backupDir: string; password: string }) =>
    runImport(db(), paths, run, (tmp) => openBackupSource(run.backupDir, run.password, tmp), progress),
  importSeed: (run: { trigger: Trigger; transport: Transport | null; big: boolean }) =>
    runImport(db(), paths, run, async () => seedSource({ big: run.big }), progress),
  recordFailure(run: { trigger: Trigger; transport: Transport | null; code: ErrorCode }) {
    const id = db().startRun(run.trigger, run.transport);
    db().finishRun(id, { status: 'failed', errorCode: run.code });
  },
  setDriveStatus: (runId: number, status: 'off' | 'synced' | 'failed') => db().setDriveStatus(runId, status),
  async storage(backupDir: string) {
    const [backupBytes, mediaBytes, archiveBytes] = await Promise.all([
      dirSize(backupDir),
      dirSize(paths.mediaDir),
      dirSize(paths.archiveDir),
    ]);
    return { backupBytes, mediaBytes, dbBytes: archiveBytes - mediaBytes };
  },
  /** Writes the upload staging folder: a database snapshot and a content-free manifest. */
  async stage(stagingDir: string, runId: number) {
    db().snapshot(join(stagingDir, 'archive.sqlite'));
    const manifest = { schemaVersion: MIGRATIONS.length, runId, ...db().stats() };
    await writeFile(join(stagingDir, 'manifest.json'), JSON.stringify(manifest));
    return paths.mediaDir;
  },
};

export type WorkerMethods = typeof methods;

process.parentPort.on('message', async ({ data }: { data: { id: number; method: keyof WorkerMethods; args: unknown[] } }) => {
  try {
    const result = await (methods[data.method] as (...a: unknown[]) => unknown)(...data.args);
    process.parentPort.postMessage({ id: data.id, result });
  } catch (e) {
    // Only the code crosses the boundary: messages could carry paths or names.
    process.parentPort.postMessage({ id: data.id, error: { code: toErrorCode(e) } });
  }
});
