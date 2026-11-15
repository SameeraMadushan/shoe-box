// Google OAuth 2.0 for desktop apps: authorization code flow with PKCE (S256) and a
// loopback redirect, in the system browser (ADR section 8).
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** The guarded session fetch; injected so nothing here can reach the network on its own. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const b64url = (b: Buffer) => b.toString('base64url');

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    // "email" only to show the connected address.
    scope: `${DRIVE_SCOPE} email`,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${q}`;
}

/** Validates the redirect Google sends to the loopback listener and returns the code. */
export function parseCallback(requestUrl: string, expectedState: string): string {
  const q = new URL(requestUrl, 'http://127.0.0.1').searchParams;
  if (q.get('state') !== expectedState) throw new Error('OAuth state mismatch');
  if (q.get('error')) throw new Error('Sign-in was cancelled');
  const code = q.get('code');
  if (!code) throw new Error('No authorization code');
  return code;
}

export function emailFromIdToken(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split('.')[1]!, 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  fetch: Fetch,
  client: OAuthClient,
  p: { code: string; verifier: string; redirectUri: string },
): Promise<{ refreshToken: string; email: string | null }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code: p.code,
      code_verifier: p.verifier,
      grant_type: 'authorization_code',
      redirect_uri: p.redirectUri,
    }).toString(),
  });
  const body = (await res.json()) as { refresh_token?: string; id_token?: string };
  if (!res.ok || !body.refresh_token) throw new Error(`Token exchange failed (${res.status})`);
  return { refreshToken: body.refresh_token, email: emailFromIdToken(body.id_token) };
}

export async function revokeToken(fetch: Fetch, token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

/**
 * Runs the whole sign-in: listens on 127.0.0.1 at a random port, opens the browser,
 * waits for the redirect, exchanges the code. The listener closes in every case.
 */
export async function signIn(
  fetch: Fetch,
  client: OAuthClient,
  openBrowser: (url: string) => void,
  timeoutMs = 5 * 60_000,
): Promise<{ refreshToken: string; email: string | null }> {
  const { verifier, challenge } = createPkce();
  const state = b64url(randomBytes(24));
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out')), timeoutMs);
      server.on('request', (req, res) => {
        if (!req.url?.startsWith('/?')) return void res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        try {
          const c = parseCallback(req.url, state);
          res.end('Signed in. You can close this tab and return to Shoebox.');
          clearTimeout(timer);
          resolve(c);
        } catch (e) {
          res.end('Sign-in did not complete. You can close this tab and try again in Shoebox.');
          clearTimeout(timer);
          reject(e as Error);
        }
      });
      openBrowser(buildAuthUrl({ clientId: client.clientId, redirectUri, challenge, state }));
    });
    return await exchangeCode(fetch, client, { code, verifier, redirectUri });
  } finally {
    server.close();
  }
}
