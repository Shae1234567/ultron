import { useEffect, useRef, useState } from 'react';
import { HexPanel } from './hud/HexPanel';
import { useStore } from '../state/store';
import { submitMessage, cancelCurrent } from '../services/conversation';
import { ultron } from '../services/bridge';

const WHO_LABEL: Record<string, string> = { you: 'OPERATOR', ultron: 'ULTRON', system: 'SYSTEM' };

export function TranscriptPanel() {
  const transcript = useStore((s) => s.transcript);
  const clearTranscript = useStore((s) => s.clearTranscript);
  const coreState = useStore((s) => s.coreState);
  const activeAgent = useStore((s) => s.activeAgent);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Streaming appends dozens of times per reply - force-scrolling every
    // token would yank the operator back down if they scrolled up to reread
    // something mid-stream. Only follow the bottom if they were already there.
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void submitMessage(text);
  };

  return (
    <HexPanel
      title={activeAgent ? `Transcript — ${activeAgent.name}` : 'Transcript'}
      meta={`${transcript.length} ENTR${transcript.length === 1 ? 'Y' : 'IES'}`}
      scroll={false}
      actions={
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {coreState !== 'idle' && (
            <button className="hud-btn hud-btn--danger" onClick={cancelCurrent}>Stop</button>
          )}
          <button className="hud-btn" onClick={clearTranscript} disabled={!transcript.length}>Clear</button>
        </div>
      }
    >
      <div className="panel-body" ref={bodyRef} style={{ flex: '1 1 auto' }}>
        {transcript.length === 0 ? (
          <div className="empty-note">
            No exchanges yet. Hold <strong style={{ color: 'var(--cyan)' }}>SPACE</strong> to speak, or type below.
          </div>
        ) : (
          <div className="transcript">
            {transcript.map((m) => (
              <div key={m.id} className={`msg msg--${m.who} ${m.error ? 'msg--error' : ''}`}>
                <div className="msg__who">{WHO_LABEL[m.who] ?? m.who}</div>
                <div className="msg__text">
                  {m.text}
                  {m.streaming && <span className="caret" />}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="msg__sources">
                    <span className="msg__sources-label">SOURCES CONSULTED</span>
                    <div className="tag-row">
                      {m.sources.map((s) => (
                        <span
                          key={s.url}
                          className="chip"
                          title={s.title}
                          onClick={() => void ultron.app.openExternal(s.url)}
                        >
                          {s.source}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="composer">
        <span className="composer__prompt">&gt;</span>
        <input
          className="hud-input"
          value={draft}
          placeholder="Type a command for Ultron..."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button className="hud-btn" onClick={send} disabled={!draft.trim()}>Send</button>
      </div>
    </HexPanel>
  );
}
