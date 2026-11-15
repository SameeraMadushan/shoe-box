// Deny-by-default network policy (ADR section 7).
import type { Session } from 'electron';

export const GOOGLE_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'];

export interface GuardContext {
  /** Origin of the Vite dev server in development, otherwise null. */
  devOrigin: string | null;
  driveEnabled: boolean;
}

/**
 * Decides whether a request may proceed. `fromPage` is true for anything a renderer
 * asks for; only the main process may talk to Google, and only while Drive sync is on.
 */
export function allowRequest(url: string, fromPage: boolean, ctx: GuardContext): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'file:' || u.protocol === 'archive-media:') return true;
  if (ctx.devOrigin) {
    if (u.protocol === 'devtools:') return true;
    const dev = new URL(ctx.devOrigin);
    if (u.host === dev.host && ['http:', 'ws:'].includes(u.protocol)) return true;
  }
  return !fromPage && ctx.driveEnabled && u.protocol === 'https:' && GOOGLE_HOSTS.includes(u.hostname);
}

/** Counters the end-to-end tests read to prove nothing left the app. */
export const guardStats = { allowedExternal: 0, blocked: 0 };

export function installNetworkGuard(session: Session, context: () => GuardContext): void {
  (globalThis as Record<string, unknown>).__networkGuardStats = guardStats;
  session.webRequest.onBeforeRequest((details, callback) => {
    const ok = allowRequest(details.url, details.webContentsId !== undefined, context());
    if (!ok) guardStats.blocked++;
    else if (details.url.startsWith('https:')) guardStats.allowedExternal++;
    callback({ cancel: !ok });
  });
}
