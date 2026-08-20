import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { ultron } from '../services/bridge';
import type { NotionUser, NotionItem } from '../types';

type Status = 'checking' | 'connected' | 'disconnected' | 'invalid';

/**
 * The real Notion connector - not scaffolding. An internal integration token
 * saved here is verified against the actual Notion API, and the list below
 * is only whatever pages/databases the operator has explicitly shared with
 * the integration inside Notion itself.
 */
export function NotionPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>('checking');
  const [user, setUser] = useState<NotionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<NotionItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const checkConnection = async () => {
    setStatus('checking');
    const has = await ultron.notion.hasToken();
    if (!has) { setStatus('disconnected'); return; }
    const res = await ultron.notion.verify();
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
    ultron.notion.search(10).then(setItems).finally(() => setLoadingData(false));
  }, [status]);

  const saveToken = async () => {
    const value = tokenDraft.trim();
    if (!value) return;
    setSaving(true);
    try {
      const res = await ultron.settings.setEnvKey('NOTION_TOKEN', value);
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
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <Overlay
      title="Notion"
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
              Create an internal integration and copy its secret (starts with ntn_).
              <div style={{ marginTop: 5 }}>
                <span className="link-btn" onClick={() => void ultron.app.openExternal('https://www.notion.so/my-integrations')}>
                  notion.so/my-integrations
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <span className="step__n">2</span>
            <div className="step__text">
              Share the pages you want Ultron to see: open the page, click ••• , then Connections,
              and pick your integration. Nothing is visible until it's explicitly shared - that's
              Notion's own model, not a limitation here.
            </div>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <span className="field__label">Paste your integration secret</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="hud-input"
                type="password"
                placeholder="ntn_..."
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveToken(); }}
              />
              <button className="hud-btn hud-btn--active" onClick={() => void saveToken()} disabled={!tokenDraft.trim() || saving}>
                {saving ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            <div className="field__hint">
              Saved to your local .env, same as the GNews and GitHub keys - never sent anywhere
              except directly to api.notion.com with your requests.
            </div>
          </div>
        </>
      )}

      {status === 'connected' && user && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div>
              <div style={{ color: 'var(--white)', fontWeight: 600 }}>{user.botName || 'Ultron integration'}</div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>
                {user.workspaceName ? `workspace: ${user.workspaceName}` : ''}
              </span>
            </div>
            <button className="hud-btn" style={{ marginLeft: 'auto' }} onClick={() => void checkConnection()}>Refresh</button>
          </div>

          <div className="field">
            <span className="field__label">Recently edited, shared with this integration</span>
            {loadingData ? (
              <div className="empty-note">Loading...</div>
            ) : items.length === 0 ? (
              <div className="empty-note">Nothing shared with this integration yet - share a page from Notion first.</div>
            ) : (
              items.map((i) => (
                <div key={i.id} className="folder-row" style={{ cursor: 'pointer' }} onClick={() => void ultron.app.openExternal(i.url)}>
                  <span className={`chip ${i.type === 'database' ? '' : 'chip--muted'}`} style={{ flex: '0 0 auto' }}>
                    {i.type === 'database' ? 'DB' : 'PAGE'}
                  </span>
                  <span className="folder-row__path">{i.title}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{timeAgo(i.lastEditedTime)}</span>
                </div>
              ))
            )}
          </div>

          <div className="field__hint" style={{ marginTop: 10 }}>
            The Chief of Staff specialist can pull this same data into its answers - activate it
            from the Agents tab.
          </div>
        </>
      )}
    </Overlay>
  );
}
