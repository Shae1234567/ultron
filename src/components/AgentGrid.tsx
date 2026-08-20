import { specialists } from '../agents';
import { useStore } from '../state/store';

/**
 * Every specialist is a persona layered on the same local Ollama model via
 * buildSystemPrompt() - three of them also have a real extra capability
 * (Researcher: multi-source lookup, Coach: live weather, Historian: on this
 * day), and their cards say so honestly with a LIVE badge.
 */
export function AgentGrid() {
  const activeAgent = useStore((s) => s.activeAgent);
  const setActiveAgent = useStore((s) => s.setActiveAgent);
  const setOverlay = useStore((s) => s.setOverlay);

  return (
    <>
      <div className="alert-strip alert-strip--info">
        <span className="dot" />
        {activeAgent ? `Active: ${activeAgent.name}` : 'Plain Atlas - no specialist active'}
      </div>
      <div className="conn-grid">
        <div
          className="conn-card"
          onClick={() => setActiveAgent(null)}
          style={!activeAgent ? { borderColor: 'var(--cyan-55)', background: 'rgba(0,217,255,0.1)' } : undefined}
        >
          <div className="conn-card__name">Plain Atlas</div>
          <div className="conn-card__cat">Default</div>
          <div className="conn-card__status">{!activeAgent ? 'ACTIVE' : 'ACTIVATE ›'}</div>
        </div>
        {specialists.map((a) => (
          <div
            key={a.id}
            className="conn-card"
            onClick={() => setOverlay({ kind: 'agent', id: a.id })}
            style={activeAgent?.id === a.id ? { borderColor: 'var(--cyan-55)', background: 'rgba(0,217,255,0.1)' } : undefined}
          >
            {a.capability !== 'persona' && <span className="conn-card__free">LIVE</span>}
            <div className="conn-card__name">{a.name}</div>
            <div className="conn-card__cat">{a.summary}</div>
            <div className="conn-card__status">{activeAgent?.id === a.id ? 'ACTIVE' : 'DETAILS ›'}</div>
          </div>
        ))}
      </div>
      <div className="empty-note" style={{ paddingTop: 4 }}>
        Each specialist is one file in <span className="mono" style={{ color: 'var(--cyan)' }}>src/agents/</span> - a
        persona layered on the same local model. Activating one changes how every reply is
        written until you switch back to Plain Atlas.
      </div>
    </>
  );
}
