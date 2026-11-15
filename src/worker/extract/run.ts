import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, toErrorCode } from '../../shared/errors';
import type { Transport, Trigger } from '../../shared/types';
import type { ArchiveStore } from '../archive/store';
import { importSource, type ChatSource, type PhaseProgress } from './pipeline';

export interface DataPaths {
  dataDir: string;
  archiveDir: string;
  dbPath: string;
  mediaDir: string;
  tmpDir: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const archiveDir = join(dataDir, 'archive');
  return { dataDir, archiveDir, dbPath: join(archiveDir, 'archive.sqlite'), mediaDir: join(archiveDir, 'media'), tmpDir: join(dataDir, 'tmp') };
}

/** Creates the data folders readable by the current user only (ADR section 7). */
export async function prepareDataDir(p: DataPaths): Promise<void> {
  for (const dir of [p.dataDir, p.archiveDir, p.mediaDir]) await mkdir(dir, { recursive: true, mode: 0o700 });
  await cleanTemp(p);
}

/** Removes decrypted temporary files. Also run at start-up, in case the last run crashed. */
export async function cleanTemp(p: DataPaths): Promise<void> {
  await rm(p.tmpDir, { recursive: true, force: true });
}

export interface RunResult {
  runId: number;
  newMessages: number;
  newMedia: number;
}

/**
 * Runs one import and records it in backup_runs. The temp folder holding decrypted
 * databases is removed whether the run succeeds or fails.
 */
export async function runImport(
  store: ArchiveStore,
  paths: DataPaths,
  run: { trigger: Trigger; transport: Transport | null },
  open: (tmpDir: string) => Promise<ChatSource & { close?(): void }>,
  onProgress: PhaseProgress = () => {},
): Promise<RunResult> {
  const runId = store.startRun(run.trigger, run.transport);
  let source: (ChatSource & { close?(): void }) | undefined;
  try {
    await mkdir(paths.tmpDir, { recursive: true, mode: 0o700 });
    source = await open(paths.tmpDir);
    const counts = await importSource(store, paths.mediaDir, source, runId, onProgress);
    store.finishRun(runId, { status: 'succeeded', ...counts });
    return { runId, ...counts };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code === 'ENOSPC' ? 'DISK_FULL' : toErrorCode(e);
    store.finishRun(runId, { status: 'failed', errorCode: code });
    throw new AppError(code, e instanceof Error ? e.message : undefined);
  } finally {
    source?.close?.();
    await cleanTemp(paths);
  }
}

/** Total size of a folder in bytes; 0 when it does not exist. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}
