import { useEffect, useState } from 'react';
import { ultron } from '../services/bridge';
import { setFocusing } from '../services/proactive';
import { speakAsUltron } from '../services/conversation';
import { useStore } from '../state/store';
import type { FocusState } from '../types';

/**
 * The focus session in the top bar: what is being worked on and how long is
 * left, with one click to stop. It only appears while a session is running,
 * so the HUD is unchanged the rest of the time.
 */
export function FocusChip() {
  const [state, setState] = useState<FocusState | null>(null);

  useEffect(() => {
    void ultron.focus.state().then(setState).catch(() => {});
    const offChanged = ultron.focus.onChanged(setState);
    const offDone = ultron.focus.onDone(({ subject, minutes, streak }) => {
      const line = `That is ${minutes} minutes on ${subject}. How far did you get?${streak > 1 ? ` That is ${streak} days in a row.` : ''}`;
      useStore.getState().pushEntry({ who: 'ultron', text: line });
      speakAsUltron(line);
    });
    // The minutes left tick down on their own.
    const t = setInterval(() => { void ultron.focus.state().then(setState).catch(() => {}); }, 30_000);
    return () => { offChanged(); offDone(); clearInterval(t); };
  }, []);

  // Proactive chatter waits while a session runs.
  useEffect(() => { setFocusing(Boolean(state?.active)); }, [state?.active]);

  if (!state?.active) return null;
  return (
    <button
      className="focus-chip"
      onClick={() => void ultron.focus.stop().then(setState)}
      title={`Focusing on ${state.active.subject} - click to stop early`}
    >
      <span className="focus-chip__dot" />
      <span className="focus-chip__time">{state.left}m</span>
      <span className="focus-chip__what">{state.active.subject}</span>
    </button>
  );
}
