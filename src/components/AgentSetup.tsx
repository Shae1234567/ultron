import { Overlay } from './Overlay';
import { getSpecialist } from '../agents';
import { useStore } from '../state/store';

const CAPABILITY_LABEL: Record<string, string> = {
  persona: 'PERSONA',
  research: 'LIVE - MULTI-SOURCE RESEARCH',
  weather: 'LIVE - WEATHER',
  'on-this-day': 'LIVE - ON THIS DAY',
  github: 'LIVE - GITHUB',
  notion: 'LIVE - NOTION',
  agentic: 'LIVE - AGENTIC (REAL TOOLS)',
};

const CAPABILITY_DESCRIPTION: Record<string, string> = {
  research: 'Genuinely queries Wikipedia, Wikidata, and DuckDuckGo before answering - not simulated.',
  weather: 'Genuinely fetches live current weather for your saved location before answering - not simulated.',
  'on-this-day': "Genuinely fetches real historical events for today's date before answering - not simulated.",
  github: 'Genuinely pulls your real repos and open issues/PRs before answering, once GitHub is connected in the Connectors tab.',
  notion: 'Genuinely pulls your real Notion pages and databases before answering, once Notion is connected in the Connectors tab.',
  agentic: 'Genuinely calls real tools mid-conversation (web browsing, file operations, research) in a multi-step loop, not a single pre-fetch - requires Ollama running.',
};

export function AgentSetup({ id, onClose }: { id: string; onClose: () => void }) {
  const agent = getSpecialist(id);
  const setActiveAgent = useStore((s) => s.setActiveAgent);
  if (!agent) return null;

  const activate = () => {
    setActiveAgent(agent);
    onClose();
  };

  return (
    <Overlay
      title={agent.name}
      meta={CAPABILITY_LABEL[agent.capability] ?? 'PERSONA'}
      onClose={onClose}
      footer={
        <button className="hud-btn hud-btn--active" onClick={activate}>Activate</button>
      }
    >
      <div className="field">
        <span className="field__label">Role</span>
        <div className="step__text">{agent.role}</div>
      </div>

      <div className="field">
        <span className="field__label">What it does</span>
        <div className="step__text">{agent.summary}</div>
      </div>

      {agent.capability !== 'persona' && (
        <div className="alert-strip alert-strip--info" style={{ marginBottom: 14 }}>
          <span className="dot" />
          {CAPABILITY_DESCRIPTION[agent.capability]}
        </div>
      )}

      <div className="field">
        <span className="field__label">How it behaves differently</span>
        {agent.directives.map((d, i) => (
          <div key={i} className="step__text" style={{ padding: '3px 0', color: '#c3dced' }}>
            {d.replace(/^-\s*/, '')}
          </div>
        ))}
      </div>

      <div className="field__hint" style={{ marginTop: 10 }}>
        Runs on the same local Ollama model as everything else - only the system prompt
        changes. Switch back to Plain Atlas any time from the Agents tab.
      </div>
    </Overlay>
  );
}
