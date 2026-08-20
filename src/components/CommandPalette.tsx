import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { isLiveVoiceSupported } from '../services/liveVoice';
import { startLiveVoiceSession, stopLiveVoiceSession, getLiveVoiceState } from '../services/liveVoiceSession';
import { startWakeWordListening, stopWakeWordListening, isWakeWordActive } from '../services/wakeWord';
import { cancelCurrent, preloadSpeechModel } from '../services/conversation';
import { ultron } from '../services/bridge';

/**
 * Ctrl+K command palette. The parent owns the Ctrl+K listener and mount
 * point (see proposals/command-palette.md) - this component only manages
 * its own open/close keyboard behavior (Escape, arrow nav, Enter-to-run)
 * once `open` is true.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function useCommands(): Command[] {
  return useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    const overlays: { label: string; kind: 'settings' | 'ollama' | 'memory' | 'github' | 'notion' | 'discord' | 'obsidian' | 'cm8' | 'browser' | 'google' | 'worldmap' }[] = [
      { label: 'Open Settings', kind: 'settings' },
      { label: 'Open Memory', kind: 'memory' },
      { label: 'Open GitHub', kind: 'github' },
      { label: 'Open Notion', kind: 'notion' },
      { label: 'Open Discord', kind: 'discord' },
      { label: 'Open Obsidian', kind: 'obsidian' },
      { label: 'Open CM8', kind: 'cm8' },
      { label: 'Open Browser', kind: 'browser' },
      { label: 'Open Google', kind: 'google' },
      { label: 'Open World Map', kind: 'worldmap' },
      { label: 'Open Ollama Setup', kind: 'ollama' },
    ];
    for (const o of overlays) {
      cmds.push({
        id: `overlay:${o.kind}`,
        label: o.label,
        hint: 'Overlay',
        run: () => useStore.getState().setOverlay({ kind: o.kind }),
      });
    }
    cmds.push({
      id: 'overlay:close',
      label: 'Close overlay',
      hint: 'Overlay',
      run: () => useStore.getState().setOverlay(null),
    });

    cmds.push({
      id: 'action:toggle-live-voice',
      label: 'Toggle Live Voice',
      hint: 'Voice',
      run: () => {
        if (!isLiveVoiceSupported()) return;
        const s = getLiveVoiceState();
        if (s === 'live' || s === 'connecting') {
          stopLiveVoiceSession();
        } else {
          void startLiveVoiceSession({
            onTranscript: (text) => useStore.getState().pushEntry({ who: 'ultron', text }),
          });
        }
      },
    });

    cmds.push({
      id: 'action:toggle-wake-word',
      label: 'Toggle Wake Word',
      hint: 'Voice',
      run: () => {
        if (isWakeWordActive()) {
          stopWakeWordListening();
        } else {
          void startWakeWordListening(() => { void ultron.win.show(); });
        }
      },
    });

    cmds.push({ id: 'action:abort', label: 'Abort', hint: 'Voice', run: () => cancelCurrent() });
    cmds.push({ id: 'action:load-voice-model', label: 'Load voice model', hint: 'Voice', run: () => preloadSpeechModel() });

    const tabs: { label: string; tab: 'system' | 'files' | 'connectors' | 'agents' }[] = [
      { label: 'Switch to System tab', tab: 'system' },
      { label: 'Switch to Files tab', tab: 'files' },
      { label: 'Switch to Connectors tab', tab: 'connectors' },
      { label: 'Switch to Agents tab', tab: 'agents' },
    ];
    for (const t of tabs) {
      cmds.push({
        id: `tab:${t.tab}`,
        label: t.label,
        hint: 'Tab',
        run: () => useStore.getState().setRightTab(t.tab),
      });
    }

    cmds.push({
      id: 'action:clear-transcript',
      label: 'Clear transcript',
      hint: 'Voice',
      run: () => useStore.getState().clearTranscript(),
    });

    return cmds;
  }, []);
}

/** Every char of `query` must appear in `label`, in order, case-insensitive. */
function fuzzyMatch(query: string, label: string): { hit: boolean; span: number } {
  if (!query) return { hit: true, span: 0 };
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) {
      if (first === -1) first = li;
      last = li;
      qi++;
    }
  }
  if (qi < q.length) return { hit: false, span: 0 };
  return { hit: true, span: last - first };
}

function rankCommands(query: string, commands: Command[]): Command[] {
  const q = query.trim();
  if (!q) return commands;
  const ql = q.toLowerCase();
  const scored = commands
    .map((c) => {
      const m = fuzzyMatch(q, c.label);
      if (!m.hit) return null;
      const exact = c.label.toLowerCase().includes(ql) ? 0 : 1;
      return { c, exact, span: m.span, len: c.label.length };
    })
    .filter((x): x is { c: Command; exact: number; span: number; len: number } => x !== null);
  scored.sort((a, b) => a.exact - b.exact || a.span - b.span || a.len - b.len);
  return scored.map((s) => s.c);
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const allCommands = useCommands();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => rankCommands(query, allCommands), [query, allCommands]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const runSelected = () => {
    const cmd = results[selectedIndex];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, selectedIndex, onClose]);

  if (!open) return null;

  // No CSS file may be edited (see task constraint - exactly one new file
  // is allowed), so the ".cmdk"/".cmdk-row" treatment the visual proposal
  // describes is reproduced with inline styles built from the same design
  // tokens, layered on top of the reused .overlay/.holo-panel/.holo-border-anim/
  // .folder-row/.holo-flicker--text classes rather than new class names.
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="holo-panel holo-border-anim holo-border-anim--active"
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '60vh',
          marginTop: '12vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, height: 52,
          padding: '0 14px', borderBottom: '1px solid var(--cyan-20)', flex: '0 0 auto',
        }}>
          <span style={{ color: 'var(--cyan)', textShadow: 'var(--text-glow)', fontFamily: 'var(--font-mono)' }}>
            &#10095;
          </span>
          <input
            ref={inputRef}
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--cyan)',
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', flex: '1 1 auto' }}>
          {results.length === 0 ? (
            <div className="empty-note">No matching commands.</div>
          ) : (
            results.map((c, i) => {
              const active = i === selectedIndex;
              const hovered = i === hoveredIndex;
              return (
                <div
                  key={c.id}
                  className="folder-row"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex((h) => (h === i ? null : h))}
                  onClick={() => { setSelectedIndex(i); runSelected(); }}
                  style={{
                    padding: '8px 14px',
                    gap: 10,
                    borderBottom: '1px solid rgba(0,217,255,0.07)',
                    cursor: 'pointer',
                    background: active ? 'var(--cyan-12)' : hovered ? 'rgba(0,217,255,0.06)' : 'transparent',
                    borderLeft: active ? '2px solid var(--cyan)' : '2px solid transparent',
                  }}
                >
                  <span
                    className={active ? 'holo-flicker--text' : undefined}
                    style={{ color: active ? 'var(--cyan)' : 'var(--dim)', textShadow: active ? 'var(--text-glow)' : undefined }}
                  >
                    &#10095;
                  </span>
                  <span style={{
                    flex: 1, fontFamily: 'var(--font-ui)',
                    color: active ? 'var(--cyan)' : 'var(--white)',
                    textShadow: active ? 'var(--text-glow)' : undefined,
                  }}>
                    {c.label}
                  </span>
                  {c.hint && (
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{c.hint}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
