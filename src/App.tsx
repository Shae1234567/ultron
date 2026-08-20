import { useEffect, useRef } from 'react';
import { Backdrop } from './components/Backdrop';
import { TopBar } from './components/TopBar';
import { CoreOrb } from './components/CoreOrb';
import { VoiceInterface } from './components/VoiceInterface';
import { TranscriptPanel } from './components/TranscriptPanel';
import { NewsPanel } from './components/NewsPanel';
import { SystemPanel } from './components/SystemPanel';
import { OllamaSetup } from './components/OllamaSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectorSetup } from './components/ConnectorSetup';
import { MemoryPanel } from './components/MemoryPanel';
import { AgentSetup } from './components/AgentSetup';
import { GitHubPanel } from './components/GitHubPanel';
import { NotionPanel } from './components/NotionPanel';
import { DiscordPanel } from './components/DiscordPanel';
import { ObsidianPanel } from './components/ObsidianPanel';
import { Cm8Panel } from './components/cm8/Cm8Panel';
import { BootSequence } from './components/BootSequence';
import { useStore, useSttStore, type RightTab, type Overlay } from './state/store';
import type { CoreState } from './types';
import { ultron } from './services/bridge';
import { decodeToMono16k } from './services/recorder';
import { ensureModel, transcribe } from './services/stt';
import { ttsSupported } from './services/speech';

const CAPTION: Record<CoreState, { text: string; hint: string; color: string }> = {
  idle:      { text: 'STANDBY',   hint: 'HOLD [SPACE] TO SPEAK', color: 'var(--cyan)' },
  listening: { text: 'LISTENING', hint: 'RELEASE TO SEND',        color: '#7de9ff' },
  thinking:  { text: 'PROCESSING', hint: 'QUERYING LOCAL MODEL',  color: 'var(--cyan)' },
  speaking:  { text: 'RESPONDING', hint: '[ESC] TO INTERRUPT',    color: '#b9f2ff' },
  offline:   { text: 'BRAIN OFFLINE', hint: 'OPEN SETTINGS FOR SETUP', color: 'var(--red)' },
};

export function App() {
  const coreState = useStore((s) => s.coreState);
  const overlay = useStore((s) => s.overlay);
  const setOverlay = useStore((s) => s.setOverlay);
  const setOllama = useStore((s) => s.setOllama);
  const setSettings = useStore((s) => s.setSettings);
  const setFolders = useStore((s) => s.setFolders);
  const setMemory = useStore((s) => s.setMemory);
  const pushEntry = useStore((s) => s.pushEntry);
  const setBootCheck = useStore((s) => s.setBootCheck);
  const announced = useRef(false);

  // Startup probe: settings, memory, then the brain. If Ollama is down we
  // say so plainly and open the setup instructions rather than failing silently.
  // Each check also feeds the boot screen - real pass/warn states, not a
  // decorative fake progress bar.
  useEffect(() => {
    void ultron.settings.get()
      .then((s) => { setSettings(s); setFolders(s.folders); setBootCheck('settings', 'ok'); })
      .catch(() => setBootCheck('settings', 'warn'));

    void ultron.memory.get()
      .then((m) => { setMemory(m); setBootCheck('memory', 'ok'); })
      .catch(() => setBootCheck('memory', 'warn'));

    setBootCheck('voice', ttsSupported() ? 'ok' : 'warn');

    void ultron.ollama.status().then((status) => {
      setOllama(status);
      setBootCheck('brain', status.running && status.modelInstalled ? 'ok' : 'warn');
      if (announced.current) return;
      announced.current = true;
      if (status.running && status.modelInstalled) {
        pushEntry({ who: 'system', text: `Brain online - ${status.activeModel} via ${status.host}. Hold SPACE to speak.` });
      } else {
        pushEntry({
          who: 'system',
          text: status.running
            ? `Ollama is running but "${status.activeModel}" is not installed.`
            : 'Ollama is not responding. Atlas cannot think until it is running.',
          error: true,
        });
        setOverlay({ kind: 'ollama' });
      }
    });
  }, [setOllama, setSettings, setFolders, setMemory, pushEntry, setOverlay, setBootCheck]);

  // Keep the link indicator honest over time.
  useEffect(() => {
    const id = setInterval(() => { void ultron.ollama.status().then(setOllama); }, 20000);
    return () => clearInterval(id);
  }, [setOllama]);

  // Dev hooks used by the ULTRON_CAPTURE screenshot utility.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ultron = {
      setState: (s: CoreState) => useStore.getState().setCoreState(s),
      closeOverlay: () => useStore.getState().setOverlay(null),
      setTab: (t: RightTab) => useStore.getState().setRightTab(t),
      setOverlay: (o: Overlay) => useStore.getState().setOverlay(o),
      loadStt: async () => {
        try {
          await ensureModel();
          return 'stt:' + useSttStore.getState().stt;
        } catch (e) {
          return 'stt-error: ' + (e instanceof Error ? e.message : String(e));
        }
      },
      transcribeUrl: async (url: string) => {
        const res = await fetch(url);
        const audio = await decodeToMono16k(await res.arrayBuffer());
        if (!audio) return 'DECODE_FAILED';
        return await transcribe(audio);
      },
    };
  }, []);

  const caption = CAPTION[coreState];

  return (
    <>
      <Backdrop />
      <div className="shell">
        <div className="area-top hud-panel">
          <div className="hud-panel__inner"><TopBar /></div>
          <span className="hud-panel__bracket hud-panel__bracket--tr" />
          <span className="hud-panel__bracket hud-panel__bracket--bl" />
        </div>

        <div className="area-left"><NewsPanel /></div>

        <div className="area-center">
          <div className="core-stage">
            <CoreOrb state={coreState} />
            <div className="core-caption">
              <div className="core-caption__state" style={{ color: caption.color }}>{caption.text}</div>
              <div className="core-caption__hint">{caption.hint}</div>
            </div>
          </div>
          <VoiceInterface />
        </div>

        <div className="area-right"><SystemPanel /></div>

        <div className="area-bottom"><TranscriptPanel /></div>
      </div>

      {overlay?.kind === 'ollama' && <OllamaSetup onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'settings' && <SettingsPanel onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'memory' && <MemoryPanel onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'connector' && (
        <ConnectorSetup id={overlay.id} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'agent' && (
        <AgentSetup id={overlay.id} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'github' && <GitHubPanel onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'notion' && <NotionPanel onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'discord' && <DiscordPanel onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'obsidian' && <ObsidianPanel onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'cm8' && <Cm8Panel onClose={() => setOverlay(null)} />}

      <BootSequence />
    </>
  );
}
