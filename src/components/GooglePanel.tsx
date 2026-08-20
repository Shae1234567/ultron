import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { ultron } from '../services/bridge';

type Status = 'checking' | 'no-credentials' | 'disconnected' | 'connecting' | 'connected';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
];

interface GmailMessage { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }
interface CalendarEvent { id: string; title: string; start: string; end: string; location?: string }
interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string }

/**
 * Real Google Drive/Gmail/Calendar - the operator's own account, via the
 * standard OAuth2 "installed app" flow (PKCE + loopback redirect, see
 * electron/googleAuth.ts). This app cannot create the OAuth client itself -
 * Google requires the operator register one (free, ~5 minutes) before
 * "Connect" will do anything real. Once connected, tokens live only in a
 * local file this app created; nothing is proxied through a third party.
 */
export function GooglePanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<GmailMessage[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const check = async () => {
    setStatus('checking');
    const hasCreds = await ultron.google.hasCredentials();
    if (!hasCreds) { setStatus('no-credentials'); return; }
    const connected = await ultron.google.isConnected();
    setStatus(connected ? 'connected' : 'disconnected');
  };

  useEffect(() => { void check(); }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    setLoadingData(true);
    Promise.all([
      ultron.google.gmailListUnread(6),
      ultron.google.calendarListUpcoming(6),
      ultron.google.driveListRecent(8),
    ])
      .then(([m, e, f]) => {
        setMail(m.ok ? m.messages ?? [] : []);
        setEvents(e.ok ? e.events ?? [] : []);
        setFiles(f.ok ? f.files ?? [] : []);
        if (!m.ok || !e.ok || !f.ok) setError(m.error || e.error || f.error || 'Some data failed to load.');
      })
      .finally(() => setLoadingData(false));
  }, [status]);

  const connect = async () => {
    setStatus('connecting');
    setError(null);
    const res = await ultron.google.connect(SCOPES);
    if (res.ok) {
      setStatus('connected');
    } else {
      setStatus('disconnected');
      setError(res.error ?? 'Could not connect.');
    }
  };

  const disconnect = async () => {
    await ultron.google.disconnect();
    setMail([]); setEvents([]); setFiles([]);
    setStatus('disconnected');
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : iso;
  };

  return (
    <Overlay
      title="Google"
      meta={
        status === 'connected' ? 'CONNECTED' :
        status === 'connecting' ? 'CONNECTING' :
        status === 'checking' ? 'CHECKING' :
        status === 'no-credentials' ? 'NO OAUTH CLIENT' : 'NOT CONNECTED'
      }
      onClose={onClose}
    >
      {status === 'checking' && <div className="empty-note">Checking connection...</div>}

      {status === 'no-credentials' && (
        <>
          <div className="alert-strip alert-strip--warn" style={{ marginBottom: 14 }}>
            <span className="dot" />
            No Google OAuth client configured yet. This is a one-time, free setup Atlas
            cannot do on your behalf - Google requires you to register the app yourself.
          </div>
          <div className="step">
            <span className="step__n">1</span>
            <div className="step__text">
              Create a Google Cloud project (free, no billing needed).
              <div style={{ marginTop: 5 }}>
                <span className="link-btn" onClick={() => void ultron.app.openExternal('https://console.cloud.google.com/projectcreate')}>
                  console.cloud.google.com/projectcreate
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <span className="step__n">2</span>
            <div className="step__text">
              Enable the Gmail, Calendar, and Drive APIs for that project, and set up the
              OAuth consent screen (External, add yourself as a test user).
            </div>
          </div>
          <div className="step">
            <span className="step__n">3</span>
            <div className="step__text">
              Create an OAuth Client ID - Application type: <strong>Desktop app</strong>.
              <div style={{ marginTop: 5 }}>
                <span className="link-btn" onClick={() => void ultron.app.openExternal('https://console.cloud.google.com/apis/credentials')}>
                  console.cloud.google.com/apis/credentials
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <span className="step__n">4</span>
            <div className="step__text">
              Paste the client ID and secret into Settings, or add to <span className="mono">.env</span>:
              <div className="mono" style={{ marginTop: 5, color: 'var(--green)' }}>
                GOOGLE_CLIENT_ID=...<br />GOOGLE_CLIENT_SECRET=...
              </div>
            </div>
          </div>
          <button className="hud-btn" style={{ marginTop: 10 }} onClick={() => void check()}>
            I&apos;ve added them - recheck
          </button>
        </>
      )}

      {(status === 'disconnected' || status === 'connecting') && (
        <>
          <div className="alert-strip alert-strip--info" style={{ marginBottom: 14 }}>
            <span className="dot" />
            Opens Google&apos;s real sign-in page in your actual browser - you approve access
            there, nothing happens without you clicking Allow.
          </div>
          {error && (
            <div className="alert-strip alert-strip--warn" style={{ marginBottom: 14 }}>
              <span className="dot" />{error}
            </div>
          )}
          <button className="hud-btn hud-btn--active" onClick={() => void connect()} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Waiting for sign-in...' : 'Connect Google account'}
          </button>
          <div className="field__hint" style={{ marginTop: 10 }}>
            Requests read access to Gmail and Drive, and full access to Calendar (so Atlas
            can create events, not just read them). Tokens are stored only on this machine.
          </div>
        </>
      )}

      {status === 'connected' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="hud-btn" onClick={() => void check()}>Refresh</button>
            <button className="hud-btn hud-btn--danger" style={{ marginLeft: 'auto' }} onClick={() => void disconnect()}>Disconnect</button>
          </div>

          <div className="field">
            <span className="field__label">Unread mail</span>
            {loadingData ? <div className="empty-note">Loading...</div> : mail.length === 0 ? (
              <div className="empty-note">Inbox zero, or nothing new.</div>
            ) : mail.map((m) => (
              <div key={m.id} className="folder-row">
                <span className="dot" style={{ color: 'var(--cyan)' }} />
                <span className="folder-row__path" title={m.snippet}>{m.subject || '(no subject)'}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{m.from}</span>
              </div>
            ))}
          </div>

          <div className="field">
            <span className="field__label">Upcoming events</span>
            {loadingData ? <div className="empty-note">Loading...</div> : events.length === 0 ? (
              <div className="empty-note">Nothing on the calendar.</div>
            ) : events.map((e) => (
              <div key={e.id} className="folder-row">
                <span className="dot" style={{ color: 'var(--cyan)' }} />
                <span className="folder-row__path">{e.title || '(untitled)'}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{fmtDate(e.start)}</span>
              </div>
            ))}
          </div>

          <div className="field">
            <span className="field__label">Recent Drive files</span>
            {loadingData ? <div className="empty-note">Loading...</div> : files.length === 0 ? (
              <div className="empty-note">Nothing found.</div>
            ) : files.map((f) => (
              <div
                key={f.id}
                className="folder-row"
                style={{ cursor: f.webViewLink ? 'pointer' : undefined }}
                onClick={() => f.webViewLink && void ultron.app.openExternal(f.webViewLink)}
              >
                <span className="dot" style={{ color: 'var(--cyan)' }} />
                <span className="folder-row__path">{f.name}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{fmtDate(f.modifiedTime)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Overlay>
  );
}
