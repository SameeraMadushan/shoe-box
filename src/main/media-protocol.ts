// archive-media://media/<id> serves archived media to the renderer, with Range
// support so audio and video can seek.
import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const MEDIA_SCHEME = 'archive-media';

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true } }]);
}

/** Parses "bytes=a-b" against a file size. Returns null when the range cannot be satisfied. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start <= end && start < size ? { start, end } : null;
}

export function handleMediaProtocol(lookup: (mediaId: number) => Promise<{ path: string; mime: string | null } | null>): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const id = Number(new URL(request.url).pathname.slice(1));
    const file = Number.isInteger(id) ? await lookup(id) : null;
    const info = file && (await stat(file.path).catch(() => null));
    if (!file || !info) return new Response(null, { status: 404 });

    const headers: Record<string, string> = {
      'Content-Type': file.mime ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    const rangeHeader = request.headers.get('range');
    const range = parseRange(rangeHeader, info.size);
    if (rangeHeader && !range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    const { start, end } = range ?? { start: 0, end: info.size - 1 };
    headers['Content-Length'] = String(info.size === 0 ? 0 : end - start + 1);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    const body = info.size === 0 ? null : (Readable.toWeb(createReadStream(file.path, { start, end })) as ReadableStream);
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}
