// Downloads the pinned third-party tools into vendor/<platform>-<arch>/ and verifies
// every download against the SHA-256 in vendor.lock.json. Runs at development setup
// and before packaging, never at app runtime (ADR section 11).
//
//   npm run vendor                 # this machine's platform
//   npm run vendor -- darwin-x64   # another platform (rclone only where tools need a manual build)
//   VENDOR_TOOLS_DIR=... npm run vendor   # platforms without pinned bottles: take the tools from a local build
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

interface Pinned {
  name?: string;
  version: string;
  url: string;
  sha256: string;
}
interface Platform {
  bottles: Pinned[] | null;
  todo?: string;
  rclone: Pinned;
}

const root = resolve(__dirname, '..');
const lock = JSON.parse(readFileSync(join(root, 'vendor.lock.json'), 'utf8')) as { tools: string[]; toolsVersion: string; platforms: Record<string, Platform> };
const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
const platform = lock.platforms[target];
if (!platform) {
  console.error(`No pinned tools for ${target}. Known: ${Object.keys(lock.platforms).join(', ')}`);
  process.exit(1);
}
const outDir = join(root, 'vendor', target);
const work = join(root, '.tmp', 'vendor-work', target);
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function download(item: Pinned, dest: string): Promise<void> {
  // Homebrew bottles live in GitHub's container registry, which wants this anonymous token.
  const headers = item.url.startsWith('https://ghcr.io/') ? { Authorization: 'Bearer QQ==' } : undefined;
  const res = await fetch(item.url, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${item.url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== item.sha256) throw new Error(`Checksum mismatch for ${item.url}\n  expected ${item.sha256}\n  actual   ${actual}`);
  writeFileSync(dest, data);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** macOS: copy tools and dylibs out of the bottles (or a Homebrew Cellar) and point their load paths at each other. */
function assembleMac(bottleDir: string): void {
  const files = walk(bottleDir);
  const libDir = join(outDir, 'lib');
  mkdirSync(libDir, { recursive: true });
  const placed: string[] = [];
  // "name version" of every formula a file was taken from, read off .../<name>/<version>/{bin,lib}/<file>.
  const packages = new Set<string>();
  const take = (src: string, dest: string) => {
    const real = realpathSync(src);
    const from = /([^/]+)\/([^/]+)\/(?:bin|lib)\/[^/]+$/.exec(real);
    if (from) packages.add(`${from[1]} ${from[2]}`);
    copyFileSync(real, dest);
    placed.push(dest);
  };
  for (const tool of lock.tools) {
    const src = files.find((f) => f.endsWith(`/bin/${tool}`));
    if (!src) throw new Error(`Tool ${tool} not found in the bottles`);
    take(src, join(outDir, tool));
  }
  // Copy only the dylibs the tools actually load, under the names they load them by.
  const available = new Map(files.filter((f) => /\/lib\/[^/]+\.dylib$/.test(f)).map((f) => [basename(f), f]));
  const brewDeps = (file: string) =>
    run('otool', ['-L', file]).split('\n').slice(1).map((l) => l.trim().split(' ')[0]!).filter((d) => d.includes('@@HOMEBREW') || d.startsWith('/usr/local/') || d.startsWith('/opt/homebrew/'));
  for (let i = 0; i < placed.length; i++) {
    const file = placed[i]!;
    const isLib = file.startsWith(libDir);
    chmodSync(file, 0o755);
    for (const dep of brewDeps(file)) {
      const name = basename(dep);
      const dest = join(libDir, name);
      if (!existsSync(dest)) {
        const src = available.get(name);
        if (!src) throw new Error(`${basename(file)} needs ${name}, which no pinned bottle provides`);
        take(src, dest);
      }
      run('install_name_tool', ['-change', dep, `${isLib ? '@loader_path' : '@loader_path/lib'}/${name}`, file]);
    }
    if (isLib) run('install_name_tool', ['-id', `@loader_path/${basename(file)}`, file]);
  }
  // Editing load commands invalidates the signature; arm64 macOS refuses unsigned code.
  for (const file of placed) run('codesign', ['--force', '--sign', '-', file]);
  writeFileSync(join(outDir, 'PACKAGES.txt'), [...packages].sort().join('\n') + '\n');
}

async function main(): Promise<void> {
  rmSync(work, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const checksums: Record<string, string> = {};

  if (platform!.bottles) {
    const bottleDir = join(work, 'bottles');
    mkdirSync(bottleDir);
    for (const bottle of platform!.bottles) {
      const archive = join(work, `${bottle.name!.replace('@', '-')}.tar.gz`);
      await download(bottle, archive);
      run('tar', ['-xzf', archive, '-C', bottleDir]);
      console.log(`verified ${bottle.name} ${bottle.version}`);
    }
    assembleMac(bottleDir);
  } else if (process.env.VENDOR_TOOLS_DIR) {
    // No pinned bottles: the release workflow builds or installs the tools and points here.
    const dir = resolve(process.env.VENDOR_TOOLS_DIR);
    if (target.startsWith('darwin')) assembleMac(dir);
    else cpSync(dir, outDir, { recursive: true });
  } else {
    // TODO(vendor): the device tools for this platform need a manual build.
    console.warn(`\nDEVICE TOOLS NOT FETCHED for ${target}: ${platform!.todo}\n`);
  }

  const ext = target.startsWith('win32') ? '.exe' : '';
  if (existsSync(join(outDir, `idevice_id${ext}`))) {
    for (const tool of lock.tools) {
      if (!existsSync(join(outDir, tool + ext))) throw new Error(`Tool ${tool} is missing for ${target}`);
      // Running each tool from its final folder proves it finds its libraries there.
      if (target !== `${process.platform}-${process.arch}`) continue;
      const version = run(join(outDir, tool + ext), ['--version']).trim();
      // The output parsers are written against this version.
      if (!version.includes(lock.toolsVersion)) throw new Error(`${tool} is "${version}", expected ${lock.toolsVersion}`);
      console.log(`${tool} runs: ${version}`);
    }
  }

  const zip = join(work, 'rclone.zip');
  await download(platform!.rclone, zip);
  run(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32' ? ['-xf', zip, '-C', work] : ['-q', zip, '-d', work]);
  const exe = `rclone${ext}`;
  const rclone = walk(work).find((f) => basename(f) === exe);
  if (!rclone) throw new Error('rclone binary not found in its archive');
  copyFileSync(rclone, join(outDir, exe));
  chmodSync(join(outDir, exe), 0o755);
  console.log(`verified rclone ${platform!.rclone.version}`);

  for (const f of walk(outDir)) checksums[f.slice(outDir.length + 1)] = createHash('sha256').update(readFileSync(f)).digest('hex');
  writeFileSync(join(outDir, 'SHA256SUMS.json'), JSON.stringify(checksums, null, 2));
  const size = walk(outDir).reduce((n, f) => n + statSync(f).size, 0);
  console.log(`vendor/${target}: ${Object.keys(checksums).length} files, ${(size / 1e6).toFixed(1)} MB`);
  rmSync(work, { recursive: true, force: true });
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
