import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { app, shell } from 'electron';
import { env } from './env';

/**
 * Google "installed app" OAuth2 flow — the standard pattern Google's own
 * docs describe for desktop apps: authorization-code + PKCE, with the
 * consent screen shown in the user's real system browser (never an embedded
 * webview) and the code returned via a one-shot loopback HTTP server on
 * 127.0.0.1. The user reviews and approves entirely on Google's own site;
 * this app never sees their Google password. The client secret (from
 * .env, read via env()) and the resulting tokens are stored only in a
 * local JSON file this app itself created (userData/google-tokens.json),
 * and are only ever transmitted to Google's own token endpoint.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKENS_FILE = 'google-tokens.json';
const CONNECT_TIMEOUT_MS = 2 * 60 * 1000;

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry: number; // ms epoch
  scope: string;
}

function clientId(): string {
  return env('GOOGLE_CLIENT_ID');
}

function clientSecret(): string {
  return env('GOOGLE_CLIENT_SECRET');
}

export function hasCredentials(): boolean {
  return Boolean(clientId()) && Boolean(clientSecret());
}

function tokensPath(): string {
  return path.join(app.getPath('userData'), TOKENS_FILE);
}

function readTokens(): GoogleTokens | null {
  try {
    const p = tokensPath();
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!parsed || typeof parsed.access_token !== 'string') return null;
    return parsed as GoogleTokens;
  } catch {
    return null;
  }
}

function writeTokens(tokens: GoogleTokens): void {
  const p = tokensPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Atomic write: temp file + rename, so a mid-write crash never leaves a
  // truncated/corrupt tokens file behind.
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function isConnected(): boolean {
  return readTokens() !== null;
}

function base64url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(64)).slice(0, 128);
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export async function connect(scopes: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!hasCredentials()) {
      return { ok: false, error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.' };
    }

    const { verifier, challenge } = generatePkce();

    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;

      const server = http.createServer((req, res) => {
        (async () => {
          try {
            const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (reqUrl.pathname !== '/callback') {
              res.writeHead(404).end();
              return;
            }
            const code = reqUrl.searchParams.get('code');
            const errParam = reqUrl.searchParams.get('error');

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><p>You can close this tab and return to Atlas.</p></body></html>');

            if (settled) return;

            if (errParam || !code) {
              settled = true;
              finish({ ok: false, error: errParam ? `Google returned: ${errParam}` : 'No authorization code received.' });
              return;
            }

            const port = (server.address() as { port: number }).port;
            const tokenRes = await fetch(TOKEN_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: clientId(),
                client_secret: clientSecret(),
                redirect_uri: `http://127.0.0.1:${port}/callback`,
                grant_type: 'authorization_code',
                code_verifier: verifier,
              }),
            });
            const data = (await tokenRes.json().catch(() => null)) as {
              access_token?: string;
              refresh_token?: string;
              expires_in?: number;
              scope?: string;
              error?: string;
              error_description?: string;
            } | null;

            if (!tokenRes.ok || !data?.access_token) {
              settled = true;
              finish({
                ok: false,
                error: data?.error_description || data?.error || `Token exchange failed (${tokenRes.status}).`,
              });
              return;
            }

            writeTokens({
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
              scope: data.scope ?? scopes.join(' '),
            });

            settled = true;
            finish({ ok: true });
          } catch (e) {
            settled = true;
            finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        })();
      });

      function finish(result: { ok: boolean; error?: string }) {
        if (timer) clearTimeout(timer);
        server.close(() => resolve(result));
      }

      server.on('error', (e) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          if (settled) return;
          settled = true;
          finish({ ok: false, error: 'Could not start local callback server.' });
          return;
        }
        const port = address.port;
        const authUrl = new URL(AUTH_ENDPOINT);
        authUrl.searchParams.set('client_id', clientId());
        authUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/callback`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scopes.join(' '));
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        shell.openExternal(authUrl.toString()).catch((e) => {
          if (settled) return;
          settled = true;
          finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
        });
      });

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        finish({ ok: false, error: 'Timed out waiting for Google sign-in.' });
      }, CONNECT_TIMEOUT_MS);
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnect(): Promise<void> {
  try {
    const p = tokensPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // Best-effort - if the file can't be removed there's nothing more we can do here.
  }
}

export async function getAccessToken(): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const tokens = readTokens();
    if (!tokens) return { ok: false, error: 'Not connected to Google.' };

    if (tokens.access_token && tokens.expiry - Date.now() > 60_000) {
      return { ok: true, token: tokens.access_token };
    }

    if (!tokens.refresh_token) {
      return { ok: false, error: 'No refresh token available - reconnect to Google.' };
    }
    if (!hasCredentials()) {
      return { ok: false, error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.' };
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    } | null;

    if (!res.ok || !data?.access_token) {
      return { ok: false, error: data?.error_description || data?.error || `Token refresh failed (${res.status}).` };
    }

    const next: GoogleTokens = {
      access_token: data.access_token,
      refresh_token: tokens.refresh_token,
      expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
      scope: data.scope ?? tokens.scope,
    };
    writeTokens(next);
    return { ok: true, token: next.access_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
