import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Settings } from '../shared/types';

/**
 * App settings live in <userData>/settings.json rather than the archive's settings
 * table: the archive location is itself a setting and must be known before the
 * database can be opened.
 */
export class SettingsStore {
  private value: Settings;

  constructor(
    private readonly file: string,
    defaults: Settings,
  ) {
    let saved: Partial<Settings> = {};
    try {
      saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
    } catch {
      // first start, or an unreadable file: fall back to defaults
    }
    this.value = { ...defaults, ...saved };
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    return this.value;
  }
}
