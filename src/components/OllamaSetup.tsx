import { useState } from 'react';
import { Overlay } from './Overlay';
import { useStore } from '../state/store';
import { ultron } from '../services/bridge';

/**
 * Shown when the brain is unreachable. Every instruction here is real - no
 * "connected" state is ever displayed unless the daemon actually answered.
 */
export function OllamaSetup({ onClose }: { onClose: () => void }) {
  const status = useStore((s) => s.ollama);
  const setOllama = useStore((s) => s.setOllama);
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    try {
      setOllama(await ultron.ollama.status());
    } finally {
      setChecking(false);
    }
  };

  const model = status?.activeModel ?? 'llama3.2';
  const running = Boolean(status?.running);
  const modelInstalled = Boolean(status?.modelInstalled);

  return (
    <Overlay
      title="Brain Setup - Ollama"
      meta={running ? (modelInstalled ? 'ONLINE' : 'MODEL MISSING') : 'OFFLINE'}
      onClose={onClose}
      footer={
        <>
          <button className="hud-btn" onClick={() => void ultron.app.openExternal('https://ollama.com/download')}>
            Open ollama.com
          </button>
          <button className="hud-btn hud-btn--active" onClick={recheck} disabled={checking}>
            {checking ? 'Checking...' : 'Re-check connection'}
          </button>
        </>
      }
    >
      <div className={`alert-strip ${running && modelInstalled ? 'alert-strip--info' : 'alert-strip--warn'}`}
           style={{ marginBottom: 14 }}>
        <span className="dot dot--live" />
        {running
          ? modelInstalled
            ? `Ollama is running at ${status?.host} with "${model}" installed. You are ready.`
            : `Ollama is running, but the model "${model}" is not installed yet.`
          : `No response from ${status?.host ?? 'http://localhost:11434'}${status?.error ? ` (${status.error})` : ''}`}
      </div>

      <div className="step">
        <span className="step__n">1</span>
        <div className="step__text">
          Install Ollama - it is free, runs entirely on this machine, and needs no account or API key.
          <div className="code-line">https://ollama.com/download</div>
        </div>
      </div>

      <div className="step">
        <span className="step__n">2</span>
        <div className="step__text">
          Pull a lightweight model. In PowerShell or Terminal:
          <div className="code-line">ollama pull {model}</div>
          <span className="field__hint">
            llama3.2 (~2 GB) is a good default. phi3 is smaller and faster; llama3.1 is stronger but heavier.
          </span>
        </div>
      </div>

      <div className="step">
        <span className="step__n">3</span>
        <div className="step__text">
          Make sure the daemon is up. It usually starts automatically after install; if not:
          <div className="code-line">ollama serve</div>
        </div>
      </div>

      <div className="step">
        <span className="step__n">4</span>
        <div className="step__text">
          Come back and hit <strong style={{ color: 'var(--cyan)' }}>Re-check connection</strong>.
          Atlas talks to Ollama over its local REST API at {status?.host ?? 'http://localhost:11434'} - nothing leaves this machine.
        </div>
      </div>

      {running && status && status.models.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span className="field__label">Models detected on this machine</span>
          <div className="tag-row">
            {status.models.map((m) => (
              <span key={m} className={`chip ${m.split(':')[0] === model.split(':')[0] ? 'chip--good' : ''}`}>{m}</span>
            ))}
          </div>
        </div>
      )}
    </Overlay>
  );
}
