import { Overlay } from './Overlay';
import { getConnector } from '../connectors';
import { ultron } from '../services/bridge';

export function ConnectorSetup({ id, onClose }: { id: string; onClose: () => void }) {
  const c = getConnector(id);
  if (!c) return null;

  return (
    <Overlay
      title={`Connect ${c.name}`}
      meta="NOT CONNECTED"
      onClose={onClose}
      footer={
        <button className="hud-btn hud-btn--active" onClick={() => void ultron.app.openExternal(c.docsUrl)}>
          Open official docs
        </button>
      }
    >
      <div className="alert-strip alert-strip--info" style={{ marginBottom: 14 }}>
        <span className="dot" />
        Atlas cannot complete this connection yet - these are the real steps to wire it up.
      </div>

      <div className="field">
        <span className="field__label">What it would do</span>
        <div className="step__text">{c.summary}</div>
      </div>

      <div className="field">
        <span className="field__label">Cost</span>
        <div className="step__text" style={{ color: c.freeTier ? 'var(--green)' : 'var(--red)' }}>
          {c.freeTier ?? 'No free tier available for this service.'}
        </div>
      </div>

      {c.scopes && c.scopes.length > 0 && (
        <div className="field">
          <span className="field__label">Permissions needed</span>
          <div className="tag-row">
            {c.scopes.map((s) => <span key={s} className="chip chip--muted mono">{s}</span>)}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field__label">Setup</span>
        {c.setup.map((s, i) => (
          <div className="step" key={i}>
            <span className="step__n">{i + 1}</span>
            <div className="step__text">
              {s.title}
              {s.detail && <div className="field__hint">{s.detail}</div>}
              {s.code && <div className="code-line">{s.code}</div>}
              {s.link && (
                <div style={{ marginTop: 5 }}>
                  <span className="link-btn" onClick={() => void ultron.app.openExternal(s.link!)}>{s.link}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {c.caveat && (
        <div className="field">
          <span className="field__label">Worth knowing</span>
          <div className="step__text" style={{ color: '#ffd3d8' }}>{c.caveat}</div>
        </div>
      )}
    </Overlay>
  );
}
