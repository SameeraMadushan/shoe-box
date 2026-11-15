// Lists the licence of every production npm dependency and fails on anything that
// is unknown or not on the allowlist (ADR section 9). Writes licenses/npm-licenses.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ALLOWED = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|OFL-1\.1|Python-2\.0)$/;
const root = resolve(__dirname, '..');

// Everything that ships: runtime dependencies plus the packages bundled into the renderer.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
const bundled = ['react', 'react-dom', 'zustand', '@tanstack/react-virtual', '@fontsource/inter', '@fontsource/space-grotesk', 'electron'];
const dirs = new Set<string>();
/** Adds a package and, recursively, everything it depends on at runtime. */
function visit(name: string, fromDir: string): void {
  let dir = fromDir;
  // Node's lookup: nearest node_modules walking up from the dependent package.
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) {
      if (dirs.has(candidate)) return;
      dirs.add(candidate);
      const p = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(p.dependencies ?? {})) visit(dep, candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Cannot find ${name} from ${fromDir}`);
    dir = parent;
  }
}
// Electron's own npm dependencies only download the binary; the runtime ships with its
// own licence files (LICENSE and LICENSES.chromium.html inside the app).
dirs.add(join(root, 'node_modules', 'electron'));
for (const name of [...Object.keys(pkg.dependencies), ...bundled.filter((n) => n !== 'electron')]) visit(name, root);

const report: { name: string; version: string; license: string }[] = [];
for (const dir of dirs) {
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string | { type: string } };
  const license = typeof p.license === 'object' ? p.license.type : (p.license ?? 'UNKNOWN');
  report.push({ name: p.name, version: p.version, license });
}
report.sort((a, b) => a.name.localeCompare(b.name));

// "(MIT OR Apache-2.0)" passes when any alternative is allowed; "A AND B" needs both.
const ok = (expr: string): boolean =>
  expr.replace(/[()]/g, '').split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((l) => ALLOWED.test(l.trim())));
const bad = report.filter((r) => !ok(r.license));
writeFileSync(join(root, 'licenses', 'npm-licenses.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.length} shipped npm packages checked; licences: ${[...new Set(report.map((r) => r.license))].sort().join(', ')}`);
if (bad.length) {
  console.error('Disallowed or unknown licences:\n' + bad.map((r) => `  ${r.name}@${r.version}: ${r.license}`).join('\n'));
  process.exit(1);
}
