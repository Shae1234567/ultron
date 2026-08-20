import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { ultron } from '../services/bridge';
import type { GitHubUser, GitHubRepo, GitHubIssue } from '../types';

type Status = 'checking' | 'connected' | 'disconnected' | 'invalid';

/**
 * The real GitHub connector - not scaffolding. A personal access token saved
 * here is verified against the actual GitHub API, and every list below is
 * real data pulled live, not simulated.
 */
export function GitHubPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>('checking');
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const checkConnection = async () => {
    setStatus('checking');
    const has = await ultron.github.hasToken();
    if (!has) { setStatus('disconnected'); return; }
    const res = await ultron.github.verify();
    if (res.ok && res.user) {
      setUser(res.user);
      setStatus('connected');
      setError(null);
    } else {
      setStatus('invalid');
      setError(res.error ?? 'Token could not be verified.');
    }
  };

  useEffect(() => { void checkConnection(); }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    setLoadingData(true);
    Promise.all([ultron.github.repos(8), ultron.github.openWork(10)])
      .then(([r, i]) => { setRepos(r); setIssues(i); })
      .finally(() => setLoadingData(false));
  }, [status]);

  const saveToken = async () => {
    const value = tokenDraft.trim();
    if (!value) return;
    setSaving(true);
    try {
      const res = await ultron.settings.setEnvKey('GITHUB_TOKEN', value);
      if (res.ok) {
        setTokenDraft('');
        await checkConnection();
      } else {
        setError(res.error ?? 'Could not save token.');
      }
    } finally {
      setSaving(false);
    }
  };

  const timeAgo = (iso: string): string => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <Overlay
      title="GitHub"
      meta={status === 'connected' ? 'CONNECTED' : status === 'checking' ? 'CHECKING' : 'NOT CONNECTED'}
      onClose={onClose}
    >
      {status === 'checking' && <div className="empty-note">Checking connection...</div>}

      {(status === 'disconnected' || status === 'invalid') && (
        <>
          <div className={`alert-strip ${status === 'invalid' ? 'alert-strip--warn' : 'alert-strip--info'}`} style={{ marginBottom: 14 }}>
            <span className="dot" />
            {status === 'invalid' ? (error ?? 'Token invalid.') : 'Not connected yet - paste a token below to connect for real.'}
          </div>

          <div className="step">
            <span className="step__n">1</span>
            <div className="step__text">
              Create a fine-grained personal access token with read-only repository access
              (Contents: Read, Issues: Read, Pull requests: Read - nothing else needed).
              <div style={{ marginTop: 5 }}>
                <span className="link-btn" onClick={() => void ultron.app.openExternal('https://github.com/settings/personal-access-tokens/new')}>
                  github.com/settings/personal-access-tokens/new
                </span>
              </div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <span className="field__label">Paste your token</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="hud-input"
                type="password"
                placeholder="github_pat_..."
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveToken(); }}
              />
              <button className="hud-btn hud-btn--active" onClick={() => void saveToken()} disabled={!tokenDraft.trim() || saving}>
                {saving ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            <div className="field__hint">
              Saved to your local .env, same as the GNews key - never sent anywhere except
              directly to api.github.com with your requests.
            </div>
          </div>
        </>
      )}

      {status === 'connected' && user && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <img src={user.avatarUrl} alt="" width={40} height={40} style={{ border: '1px solid var(--cyan-35)' }} />
            <div>
              <div style={{ color: 'var(--white)', fontWeight: 600 }}>{user.name || user.login}</div>
              <span className="link-btn" onClick={() => void ultron.app.openExternal(user.profileUrl)}>@{user.login}</span>
            </div>
            <button className="hud-btn" style={{ marginLeft: 'auto' }} onClick={() => void checkConnection()}>Refresh</button>
          </div>

          <div className="field">
            <span className="field__label">Recently updated repos</span>
            {loadingData ? (
              <div className="empty-note">Loading...</div>
            ) : repos.length === 0 ? (
              <div className="empty-note">No repos visible to this token.</div>
            ) : (
              repos.map((r) => (
                <div key={r.fullName} className="folder-row" style={{ cursor: 'pointer' }} onClick={() => void ultron.app.openExternal(r.url)}>
                  <span className="dot" style={{ color: r.private ? 'var(--dim)' : 'var(--cyan)' }} />
                  <span className="folder-row__path" title={r.description ?? ''}>{r.fullName}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>★{r.stars}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{timeAgo(r.updatedAt)}</span>
                </div>
              ))
            )}
          </div>

          <div className="field">
            <span className="field__label">Open issues & PRs</span>
            {loadingData ? (
              <div className="empty-note">Loading...</div>
            ) : issues.length === 0 ? (
              <div className="empty-note">Nothing open right now.</div>
            ) : (
              issues.map((i) => (
                <div key={i.url} className="folder-row" style={{ cursor: 'pointer' }} onClick={() => void ultron.app.openExternal(i.url)}>
                  <span className={`chip ${i.isPullRequest ? '' : 'chip--muted'}`} style={{ flex: '0 0 auto' }}>
                    {i.isPullRequest ? 'PR' : 'ISSUE'}
                  </span>
                  <span className="folder-row__path">{i.title}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{i.repo}</span>
                </div>
              ))
            )}
          </div>

          <div className="field__hint" style={{ marginTop: 10 }}>
            The Builder specialist can pull this same data into its answers - activate it
            from the Agents tab.
          </div>
        </>
      )}
    </Overlay>
  );
}
