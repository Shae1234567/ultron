import { describe, it, expect, vi, beforeEach } from 'vitest';

// googleAuth.ts reads `app`/`shell` from 'electron' and reads its client
// id/secret through './env'. Outside the real Electron runtime the
// 'electron' package resolves to a path string, not { app, shell }, so both
// are stubbed here - this is infrastructure to make the module importable
// under Vitest, not a change to what's being tested.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/atlas-vitest-userdata'),
    getAppPath: vi.fn(() => '/tmp/atlas-vitest-app'),
    isPackaged: false,
  },
  shell: { openExternal: vi.fn() },
}));

const mockEnv = vi.fn((_key: string, _fallback?: string) => '');
vi.mock('./env', () => ({
  env: (...args: [string, string?]) => mockEnv(...args),
}));

import { hasCredentials, isConnected } from './googleAuth';

describe('googleAuth', () => {
  beforeEach(() => {
    mockEnv.mockReset();
    mockEnv.mockReturnValue('');
  });

  it('hasCredentials() is false when GOOGLE_CLIENT_ID/SECRET are unset', () => {
    expect(hasCredentials()).toBe(false);
  });

  it('hasCredentials() is true only once both id and secret resolve to a value', () => {
    mockEnv.mockImplementation((key: string) =>
      key === 'GOOGLE_CLIENT_ID' || key === 'GOOGLE_CLIENT_SECRET' ? 'x' : '',
    );
    expect(hasCredentials()).toBe(true);
  });

  it('isConnected() is false when no tokens file exists on disk', () => {
    // tokensPath() resolves under the mocked userData dir above, which has
    // no google-tokens.json on this machine - readTokens() falls through
    // its fs.existsSync() check and returns null.
    expect(isConnected()).toBe(false);
  });

  // PKCE verifier/challenge generation (generatePkce / base64url) is not
  // exported from googleAuth.ts, and the only exported function that
  // exercises it - connect() - opens a real loopback HTTP server, calls
  // shell.openExternal(), and performs a live fetch() to Google's token
  // endpoint. Reaching PKCE generation through it would mean mocking most
  // of Node's http/fetch stack just to assert on an internal-only value,
  // not real observable behavior. Per the proposal, this specific case is
  // skipped rather than testing something inaccessible from outside the
  // module.
});
