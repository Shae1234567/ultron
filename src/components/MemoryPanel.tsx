import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { useStore } from '../state/store';
import { ultron } from '../services/bridge';

const roughTokens = (s: string) => Math.round(s.length / 4);

/**
 * Ultron never writes here on its own - the operator edits this file
 * directly, and it is injected into every system prompt via buildSystemPrompt().
 */
export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const memory = useStore((s) => s.memory);
  const setMemory = useStore((s) => s.setMemory);
  const [draft, setDraft] = useState(memory);
  const [path, setPath] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(memory); }, [memory]);
  useEffect(() => { void ultron.memory.path().then(setPath); }, []);

  const dirty = draft !== memory;
  const tokens = roughTokens(draft);
  const heavy = tokens > 1200;

  const save = async () => {
    setSaving(true);
    try {
      const res = await ultron.memory.save(draft);
      if (res.ok) {
        setMemory(draft);
        setSaved('Saved. Ultron will use this starting with the next message.');
      } else {
        setSaved(res.error ?? 'Could not save memory.');
      }
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(null), 4000);
    }
  };

  return (
    <Overlay
      title="Memory"
      meta={`${tokens} TOKENS (EST)`}
      onClose={onClose}
      footer={
        <>
          {saved && <span className="mono" style={{ fontSize: 11, color: 'var(--green)', marginRight: 'auto' }}>{saved}</span>}
          <button className="hud-btn" onClick={() => setDraft(memory)} disabled={!dirty || saving}>Revert</button>
          <button className="hud-btn hud-btn--active" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="alert-strip alert-strip--info" style={{ marginBottom: 14 }}>
        <span className="dot" />
        This is sent to the model with every message. Ultron never edits it on its own - only you do.
      </div>

      <textarea
        className="hud-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 420,
          resize: 'vertical',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      />

      <div className="field__hint" style={{ marginTop: 8, color: heavy ? 'var(--red)' : undefined }}>
        {heavy
          ? `~${tokens} tokens is getting heavy - every message pays this cost. Trim what is no longer load-bearing.`
          : `~${tokens} tokens, sent with every message.`}
        {' '}Stored at <span className="mono" style={{ color: 'var(--cyan)' }}>{path || 'resolving...'}</span>.
      </div>
    </Overlay>
  );
}
