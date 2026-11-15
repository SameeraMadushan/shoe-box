import { createDecipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAuthUrl, createPkce, DRIVE_SCOPE, emailFromIdToken, exchangeCode, parseCallback, signIn, TOKEN_ENDPOINT, type Fetch } from '../../src/main/drive/oauth';
import { generateRecoveryKey, obscure, parseRcloneProgress, rcloneEnv, splitRecoveryKey } from '../../src/main/drive/rclone';
import { allowRequest } from '../../src/main/network-guard';

const client = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };

describe('OAuth with PKCE', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(createPkce().verifier).not.toBe(verifier);
  });

  it('asks only for drive.file and email, with PKCE and state', () => {
    const url = new URL(buildAuthUrl({ clientId: 'id', redirectUri: 'http://127.0.0.1:5000', challenge: 'ch', state: 'st' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(`${DRIVE_SCOPE} email`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      code_challenge: 'ch', code_challenge_method: 'S256', state: 'st', response_type: 'code', redirect_uri: 'http://127.0.0.1:5000',
    });
  });

  it('rejects a callback with the wrong state, an error, or no code', () => {
    expect(parseCallback('/?state=abc&code=the-code', 'abc')).toBe('the-code');
    expect(() => parseCallback('/?state=evil&code=the-code', 'abc')).toThrow('state mismatch');
    expect(() => parseCallback('/?code=the-code', 'abc')).toThrow('state mismatch');
    expect(() => parseCallback('/?state=abc&error=access_denied', 'abc')).toThrow('cancelled');
    expect(() => parseCallback('/?state=abc', 'abc')).toThrow('No authorization code');
  });

  it('sends the verifier when exchanging the code and returns the refresh token', async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'someone@example.com' })).toString('base64url')}.y`;
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, body: new URLSearchParams(init.body) });
      return { ok: true, status: 200, json: async () => ({ refresh_token: 'r-token', id_token: idToken }) };
    };
    const result = await exchangeCode(fetch, client, { code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1:1' });
    expect(result).toEqual({ refreshToken: 'r-token', email: 'someone@example.com' });
    expect(calls[0]!.url).toBe(TOKEN_ENDPOINT);
    expect(Object.fromEntries(calls[0]!.body)).toMatchObject({ code: 'c', code_verifier: 'v', grant_type: 'authorization_code', client_id: 'test-client-id' });
    expect(emailFromIdToken('garbage')).toBeNull();
  });

  it('completes the loopback flow and closes the listener; a forged redirect is refused', async () => {
    const fetch: Fetch = async () => ({ ok: true, status: 200, json: async () => ({ refresh_token: 'r-token' }) });
    // Plays the browser: follows the auth URL's redirect_uri back to the loopback listener.
    const browser = (tamper: boolean) => (authUrl: string) => {
      const q = new URL(authUrl).searchParams;
      const state = tamper ? 'forged' : q.get('state');
      void globalThis.fetch(`${q.get('redirect_uri')}/?state=${state}&code=abc`);
    };
    expect(await signIn(fetch, client, browser(false))).toEqual({ refreshToken: 'r-token', email: null });
    await expect(signIn(fetch, client, browser(true))).rejects.toThrow('state mismatch');
  });
});

describe('rclone configuration', () => {
  /** Inverse of rclone's obscure, to check the format. */
  const reveal = (obscured: string) => {
    const raw = Buffer.from(obscured, 'base64url');
    const key = Buffer.from('9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638', 'hex');
    const d = createDecipheriv('aes-256-ctr', key, raw.subarray(0, 16));
    return Buffer.concat([d.update(raw.subarray(16)), d.final()]).toString('utf8');
  };

  it('generates a grouped base32 recovery key holding two 32-byte values', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^([A-Z2-7]{4}-){25}[A-Z2-7]{4}$/);
    const { password, password2 } = splitRecoveryKey(key);
    expect([password.length, password2.length]).toEqual([52, 52]);
    expect(password).not.toBe(password2);
    expect(() => splitRecoveryKey('too-short')).toThrow();
  });

  it('defines both remotes through the environment only, with encrypted names', () => {
    const recoveryKey = generateRecoveryKey();
    const env = rcloneEnv({ client, refreshToken: 'r-token', recoveryKey });
    expect(env).toMatchObject({
      RCLONE_CONFIG_GDRIVE_TYPE: 'drive',
      RCLONE_CONFIG_GDRIVE_SCOPE: 'drive.file',
      RCLONE_CONFIG_GDRIVE_CLIENT_ID: 'test-client-id',
      RCLONE_CONFIG_GDRIVE_CLIENT_SECRET: 'test-client-secret',
      RCLONE_CONFIG_VAULT_TYPE: 'crypt',
      RCLONE_CONFIG_VAULT_REMOTE: 'gdrive:Shoebox',
      RCLONE_CONFIG_VAULT_FILENAME_ENCRYPTION: 'standard',
      RCLONE_CONFIG_VAULT_DIRECTORY_NAME_ENCRYPTION: 'true',
    });
    expect(JSON.parse(env.RCLONE_CONFIG_GDRIVE_TOKEN!)).toMatchObject({ refresh_token: 'r-token' });
    // Passwords are passed obscured, never in the clear, and reveal to the key halves.
    const { password, password2 } = splitRecoveryKey(recoveryKey);
    expect(env.RCLONE_CONFIG_VAULT_PASSWORD).not.toContain(password);
    expect(reveal(env.RCLONE_CONFIG_VAULT_PASSWORD!)).toBe(password);
    expect(reveal(env.RCLONE_CONFIG_VAULT_PASSWORD2!)).toBe(password2);
    // No config file is ever read or written.
    expect(['/dev/null', 'NUL']).toContain(env.RCLONE_CONFIG);
  });

  it('obscures with a fresh IV each time', () => {
    expect(obscure('secret')).not.toBe(obscure('secret'));
    expect(reveal(obscure('secret'))).toBe('secret');
  });

  it('reads progress from the JSON log', () => {
    expect(parseRcloneProgress('{"level":"notice","stats":{"bytes":50,"totalBytes":200}}\nnot json\n')).toBe(25);
    expect(parseRcloneProgress('{"level":"error","msg":"x"}\n')).toBeNull();
  });
});

describe('network guard', () => {
  const off = { devOrigin: null, driveEnabled: false };
  const on = { devOrigin: null, driveEnabled: true };

  it('allows only local files and archive media by default', () => {
    expect(allowRequest('file:///app/index.html', true, off)).toBe(true);
    expect(allowRequest('archive-media://media/12', true, off)).toBe(true);
    for (const url of ['https://example.com/', 'http://example.com/', 'wss://example.com/', 'https://fonts.googleapis.com/css', 'not a url']) {
      expect(allowRequest(url, true, off)).toBe(false);
      expect(allowRequest(url, false, off)).toBe(false);
    }
  });

  it('makes no Google request possible while Drive sync is off', () => {
    for (const host of ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com']) {
      expect(allowRequest(`https://${host}/x`, false, off)).toBe(false);
      expect(allowRequest(`https://${host}/x`, true, off)).toBe(false);
    }
  });

  it('with Drive on, lets only the main process reach only the three Google hosts over https', () => {
    expect(allowRequest('https://oauth2.googleapis.com/token', false, on)).toBe(true);
    expect(allowRequest('https://www.googleapis.com/drive/v3/files', false, on)).toBe(true);
    expect(allowRequest('https://oauth2.googleapis.com/token', true, on)).toBe(false); // never the renderer
    expect(allowRequest('http://oauth2.googleapis.com/token', false, on)).toBe(false);
    expect(allowRequest('https://evil.googleapis.com/', false, on)).toBe(false);
    expect(allowRequest('https://www.google-analytics.com/collect', false, on)).toBe(false);
    expect(allowRequest('https://example.com/', false, on)).toBe(false);
  });

  it('allows the dev server only in development', () => {
    const dev = { devOrigin: 'http://localhost:5173', driveEnabled: false };
    expect(allowRequest('http://localhost:5173/src/main.tsx', true, dev)).toBe(true);
    expect(allowRequest('ws://localhost:5173/', true, dev)).toBe(true);
    expect(allowRequest('http://localhost:9999/', true, dev)).toBe(false);
    expect(allowRequest('http://localhost:5173/', true, off)).toBe(false);
  });
});
