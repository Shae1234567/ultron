import { useEffect, useState, type ReactNode } from 'react';
import { Overlay } from './Overlay';
import { useStore } from '../state/store';
import { ultron } from '../services/bridge';
import type { SecretName, Settings } from '../types';
import { listVoices, primeVoices, speak, VOICE_DEFAULTS } from '../services/speech';
import { isWakeWordActive, type WakeWordStatus } from '../services/wakeWord';
import { setWakeWord } from '../services/wakeWordControl';
import { playClick } from '../services/sfx';
import { CloudServices } from './CloudServices';
import { onUltronVoice } from '../services/ultronVoice';
import type { VoiceStatus } from '../types';

const NEWS_CATEGORIES = ['world', 'nation', 'business', 'technology', 'science', 'sports', 'health'];

type KeyDrafts = Partial<Record<SecretName, string>>;

function KeyField({ name, label, has, draft, setDraft, hint }: {
  name: SecretName; label: string; has: boolean; draft: string; setDraft: (v: string) => void; hint: ReactNode;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className={`chip ${has ? 'chip--good' : 'chip--muted'}`} style={{ marginBottom: 6 }}>
        <span className="dot" /> {has ? 'KEY SAVED' : 'NO KEY'}
      </div>
      <input
        className="hud-input"
        type="password"
        placeholder={has ? 'paste a new key to replace it' : 'paste the key - it saves with the Save button'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={name}
      />
      <div className="field__hint">{hint}</div>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const brain = useStore((s) => s.brain);
  const setBrain = useStore((s) => s.setBrain);
  const setOverlay = useStore((s) => s.setOverlay);

  const [draft, setDraft] = useState<Settings | null>(settings);
  const [keys, setKeys] = useState<KeyDrafts>({});
  const [hasKey, setHasKey] = useState<Record<SecretName, boolean> | null>(null);
  const [interestInput, setInterestInput] = useState('');
  const [wakeStatus, setWakeStatus] = useState<WakeWordStatus>(isWakeWordActive() ? 'listening' : 'off');
  const [wakeError, setWakeError] = useState<string | null>(null);
  const [autoLaunch, setAutoLaunchState] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => {
    primeVoices();
    const load = () => setVoices(listVoices());
    load();
    const id = setTimeout(load, 600);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    void ultron.secrets.status().then(setHasKey);
    void ultron.tray.isAutoLaunchEnabled().then(setAutoLaunchState);
    void ultron.app.versions().then((v) => setInstalled(v.packaged));
  }, []);

  if (!draft) return null;
  const patch = (fn: (d: Settings) => Settings) => setDraft(fn(draft));
  const setKey = (name: SecretName) => (v: string) => setKeys((k) => ({ ...k, [name]: v }));

  const toggleWakeWord = async () => {
    playClick();
    const turnOn = wakeStatus !== 'listening';
    setWakeError(null);
    // setWakeWord saves the choice so it survives restarts; keep this panel's draft in step with it.
    const res = await setWakeWord(turnOn, setWakeStatus);
    if (res.ok) patch((d) => ({ ...d, voice: { ...d.voice, wakeWord: turnOn } }));
    else setWakeError(res.error ?? 'Could not start listening.');
  };

  const toggleAutoLaunch = async () => {
    const ok = await ultron.tray.setAutoLaunch(!autoLaunch);
    if (ok) setAutoLaunchState(!autoLaunch);
    else setStatus({ text: 'Start with Windows only works from the installed app.', bad: true });
  };

  // One Save for everything - the old panel had a separate button per key and
  // the big Save ignored pasted keys, which is why keys "didn't work".
  const save = async () => {
    setSaving(true);
    const problems: string[] = [];
    const notes: string[] = [];
    for (const [name, value] of Object.entries(keys) as [SecretName, string][]) {
      if (!value?.trim()) continue;
      const res = await ultron.secrets.set(name, value.trim());
      if (res.ok) notes.push(res.detail ?? `${name.replace(/_/g, ' ').toLowerCase()} saved`);
      else problems.push(res.error ?? `${name} was rejected`);
    }
    const next = await ultron.settings.save(draft);
    setSettings(next);
    setKeys({});
    setHasKey(await ultron.secrets.status());
    setBrain(await ultron.brain.recheck());
    setSaving(false);
    setStatus(problems.length
      ? { text: problems.join(' | '), bad: true }
      : { text: notes.length ? `Saved. ${notes.join('. ')}.` : 'Settings saved.' });
  };

  const addInterest = () => {
    const v = interestInput.trim().toLowerCase();
    if (!v || draft.profile.interests.includes(v)) return;
    patch((d) => ({ ...d, profile: { ...d.profile, interests: [...d.profile.interests, v] } }));
    setInterestInput('');
  };

  const dailyCost = draft.news.categories.length;
  const perDay = Math.floor((24 * 60) / Math.max(15, draft.news.autoRefreshMinutes)) * dailyCost;
  const geminiModels = brain?.gemini.models ?? [];
  const ollamaModels = (brain?.ollama.models ?? []).filter((m) => !/embed/i.test(m));

  return (
    <Overlay
      title="Settings"
      meta="LOCAL ONLY"
      onClose={onClose}
      footer={
        <>
          {status && <span className="mono" style={{ fontSize: 11, color: status.bad ? 'var(--red)' : 'var(--green)', marginRight: 'auto', maxWidth: '70%' }}>{status.text}</span>}
          <button className="hud-btn" onClick={onClose}>Close</button>
          <button className="hud-btn hud-btn--active" onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </>
      }
    >
      <div className="subhead">BRAIN</div>
      <div className="field">
        <span className="field__label">Which brain answers</span>
        <div className="tag-row">
          {([['auto', 'AUTO - BEST AVAILABLE'], ['gemini', 'GEMINI FIRST'], ['cloud', 'FREE SERVICES FIRST'], ['ollama', 'LOCAL ONLY']] as const).map(([v, label]) => (
            <span key={v} className={`chip ${draft.brain === v ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, brain: v }))}>{label}</span>
          ))}
        </div>
        <div className="field__hint">
          Now: <span className="mono" style={{ color: brain?.active ? 'var(--green)' : 'var(--red)' }}>{brain?.active ? `${brain.label} - ${brain.model}` : 'no brain available'}</span>.{' '}
          <span className="link-btn" onClick={() => setOverlay({ kind: 'brain' })}>Brain setup &amp; model downloads</span>
        </div>
      </div>
      <CloudServices draft={draft} patch={patch} keys={keys} setKey={setKey} hasKey={hasKey} brain={brain}
        onSaved={async () => { setHasKey(await ultron.secrets.status()); setBrain(await ultron.brain.recheck()); }} />
      <div className="field">
        <span className="field__label">Thinking</span>
        <div className="tag-row">
          {([['deep', 'DEEP - SMARTEST'], ['balanced', 'BALANCED'], ['fast', 'FAST']] as const).map(([v, label]) => (
            <span key={v} className={`chip ${draft.thinking === v ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, thinking: v }))}>{label}</span>
          ))}
        </div>
        <div className="field__hint">
          Deep: hard problems get Google&apos;s strongest model (Gemini Pro, when your key&apos;s free plan includes it) with full reasoning,
          and the planner and reviewer think things through - slower on hard questions, much sharper. Balanced: the same full reasoning,
          always on the faster Flash model. Fast: lighter reasoning for quicker replies. Small talk stays quick in every mode.
        </div>
      </div>
      <KeyField
        name="GEMINI_API_KEY" label="Gemini API key" has={Boolean(hasKey?.GEMINI_API_KEY)} draft={keys.GEMINI_API_KEY ?? ''} setDraft={setKey('GEMINI_API_KEY')}
        hint={<>Free at <span className="link-btn" onClick={() => void ultron.app.openExternal('https://aistudio.google.com/apikey')}>aistudio.google.com/apikey</span>. Tested when you press Save. {brain?.gemini.configured && (brain.gemini.valid ? <span style={{ color: 'var(--green)' }}>Working.</span> : <span style={{ color: 'var(--red)' }}>{brain.gemini.error ?? 'Not verified.'}</span>)}</>}
      />
      <div className="field">
        <span className="field__label">Gemini model</span>
        <select className="hud-input" value={draft.gemini.model} onChange={(e) => patch((d) => ({ ...d, gemini: { model: e.target.value } }))}>
          <option value="">Automatic - newest Flash ({brain?.gemini.model ?? 'needs a working key'})</option>
          {geminiModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="field">
        <span className="field__label">Local model</span>
        <select className="hud-input" value={draft.ollama.model} onChange={(e) => patch((d) => ({ ...d, ollama: { ...d.ollama, model: e.target.value } }))}>
          {!ollamaModels.includes(draft.ollama.model) && <option value={draft.ollama.model}>{draft.ollama.model}{brain?.ollama.running ? ' (not downloaded)' : ''}</option>}
          {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="tag-row" style={{ marginTop: 6 }}>
          <span className="label-xs" style={{ marginRight: 4 }}>CONTEXT</span>
          {[4096, 8192, 16384].map((n) => (
            <span key={n} className={`chip ${draft.ollama.numCtx === n ? '' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, ollama: { ...d.ollama, numCtx: n } }))}>{n / 1024}K</span>
          ))}
        </div>
        <div className="field__hint">8K is the sweet spot on a 6 GB GPU. 16K lets the local model hold longer tasks but runs slower.</div>
      </div>
      <div className="field">
        <span className="field__label">Reasoning model (Athena's thinking)</span>
        <select className="hud-input" value={draft.ollama.reasoningModel} onChange={(e) => patch((d) => ({ ...d, ollama: { ...d.ollama, reasoningModel: e.target.value } }))}>
          <option value="">Off - the local model does everything</option>
          {draft.ollama.reasoningModel && !ollamaModels.includes(draft.ollama.reasoningModel) && <option value={draft.ollama.reasoningModel}>{draft.ollama.reasoningModel}{brain?.ollama.running ? ' (not downloaded)' : ''}</option>}
          {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="field__hint">Used only when Ultron runs on this PC, for Athena's work in team jobs (plans, comparisons, hard problems). DeepSeek-R1 8B reasons better but takes minutes and about 4 GB of the graphics card, so it is let go a minute after each use. Chat stays on the main model.</div>
      </div>

      <div className="divider" />
      <div className="subhead">TEAM</div>
      <div className="field">
        <div className="tag-row">
          <span className={`chip ${draft.team.mode === 'auto' ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, team: { mode: 'auto' } }))}>AUTO</span>
          <span className={`chip ${draft.team.mode === 'full' ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, team: { mode: 'full' } }))}>FULL TEAM ON EVERYTHING</span>
        </div>
        <div className="field__hint">
          Auto: Ultron answers small talk itself and sends every real task to the team, where Athena assigns as many
          specialists as the job needs and they work in parallel. Full: every specialist contributes to every task - thorough,
          but a quick question takes much longer and burns more of Gemini's free quota. For big jobs, specialists build their
          own helpers (up to 8 per task), each with its own browser.
        </div>
      </div>
      <div className="field">
        <span className="field__label">Research depth (when you don&apos;t say)</span>
        <div className="tag-row">
          {(['quick', 'standard', 'deep'] as const).map((v) => (
            <span key={v} className={`chip ${draft.research.depth === v ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, research: { depth: v } }))}>{v.toUpperCase()}</span>
          ))}
        </div>
        <div className="field__hint">
          Quick reads about 4 sources. Standard reads about 7 and follows up once on conflicts and gaps. Deep reads 10 and follows up harder. Every brief
          checks that its citations really are in its sources.
        </div>
      </div>
      <div className="field">
        <span className="field__label">Limits for one request</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            ['maxCalls', 'model calls', 10, 400, 1],
            ['maxTokens', 'thousand tokens', 50, 5000, 1000],
            ['minutes', 'minutes', 2, 60, 1],
          ] as const).map(([key, label, min, max, scale]) => (
            <label key={key} className="mono" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="hud-input" type="number" min={min} max={max} style={{ width: 84 }}
                value={Math.round(draft.limits[key] / scale)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) patch((d) => ({ ...d, limits: { ...d.limits, [key]: Math.min(max, Math.max(min, n)) * scale } }));
                }} />
              {label}
            </label>
          ))}
        </div>
        <div className="field__hint">
          Past any of these, the team stops starting new work and tells you what it finished and what is left. After every team run the log shows
          what it cost (model calls, tokens, seconds). Gemini&apos;s free tier is limited per day, so these stop one runaway task from using it all.
        </div>
      </div>
      <div className="field">
        <span className="field__label">Workflow version</span>
        <div className="tag-row">
          {([['v3', 'V3 - SOLVER'], ['v2', 'V2 - VERIFIED'], ['v1', 'V1 - BEFORE 28 SEP']] as const).map(([v, label]) => (
            <span key={v} className={`chip ${draft.workflow === v ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => patch((d) => ({ ...d, workflow: v }))}>{label}</span>
          ))}
        </div>
        <div className="field__hint">
          V3 adds the solver: a hard problem (multi-step maths, a trap question, a logic puzzle) is worked out by several independent
          programs, and Ultron answers with the result they agree on. V2 checks its work: maths comes from a code sandbox and worked steps
          are re-checked, research runs from several perspectives with dated sources and a citation check, plan steps have &quot;done when&quot;
          checks, and memory records where each fact came from. V1 is the behaviour before 28 September, kept so you can switch back.
        </div>
      </div>
      <div className="field">
        <span className="field__label">Agent browsers</span>
        <div className="tag-row">
          <span className={`chip ${draft.browser.visible ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }}
            onClick={() => patch((d) => ({ ...d, browser: { visible: !d.browser.visible } }))}>
            {draft.browser.visible ? 'SHOWN - REAL BROWSER WINDOWS ON SCREEN' : 'HIDDEN - WATCH THEM LIVE IN THE TEAM TAB'}
          </span>
        </div>
        <div className="field__hint">
          Every agent and helper browses in its own tab. Hidden, they stream live into the Team tab (click one to enlarge).
          Shown, you also get the real Chromium windows. Takes effect when no one is mid-browse.
        </div>
      </div>

      <div className="divider" />
      <div className="subhead">APPS &amp; SCHOOL</div>
      <KeyField
        name="COMPOSIO_API_KEY" label="Composio API key" has={Boolean(hasKey?.COMPOSIO_API_KEY)} draft={keys.COMPOSIO_API_KEY ?? ''} setDraft={setKey('COMPOSIO_API_KEY')}
        hint={<>Connects Gmail, Calendar, Drive, Notion, Spotify, GitHub, Discord... Your Composio Connect key (ck_, from <span className="link-btn" onClick={() => void ultron.app.openExternal('https://dashboard.composio.dev')}>dashboard.composio.dev</span>) or a project key (ak_, from platform.composio.dev) both work. Then connect apps in the <span className="link-btn" onClick={() => setOverlay({ kind: 'apps' })}>Apps panel</span> (D2L sign-in is there too).</>}
      />

      <div className="divider" />
      <div className="subhead">TRACKERS</div>
      <TrackerRow kind="pc" label="PC activity - for the sleep guess" on={draft.trackers.pcActivity}
        hint="When this PC is in use (Windows' idle time, every 5 minutes) - nothing else. Health turns the night's gap into a bedtime guess you confirm or fix. Kept 4 days."
        onToggle={() => patch((d) => ({ ...d, trackers: { ...d.trackers, pcActivity: !d.trackers.pcActivity } }))} />
      <TrackerRow kind="games" label="Games you play" on={draft.trackers.games}
        hint="Which installed games are running (the program list, every 2 minutes) - just the game name and start/stop times. Media uses it for playtime on every launcher."
        onToggle={() => patch((d) => ({ ...d, trackers: { ...d.trackers, games: !d.trackers.games } }))} />
      <div className="field__hint">Both stay on this PC, are private, and stop collecting the moment you switch them off (press Save).</div>

      <div className="divider" />
      <div className="subhead">YOU</div>
      <div className="field">
        <span className="field__label">Name</span>
        <input className="hud-input" value={draft.profile.name} onChange={(e) => patch((d) => ({ ...d, profile: { ...d.profile, name: e.target.value } }))} />
      </div>
      <div className="field">
        <span className="field__label">Location</span>
        <input className="hud-input" value={draft.profile.location} onChange={(e) => patch((d) => ({ ...d, profile: { ...d.profile, location: e.target.value } }))} />
        <div className="field__hint">Used for weather and to judge which headlines actually affect you.</div>
      </div>
      <div className="field">
        <span className="field__label">Interest tags</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="hud-input" placeholder="add a tag and press enter" value={interestInput} onChange={(e) => setInterestInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInterest(); } }} />
          <button className="hud-btn" onClick={addInterest}>Add</button>
        </div>
        <div className="tag-row">
          {draft.profile.interests.map((t) => (
            <span key={t} className="chip" title="click to remove" onClick={() => patch((d) => ({ ...d, profile: { ...d.profile, interests: d.profile.interests.filter((x) => x !== t) } }))}>{t} x</span>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">About you (quick notes)</span>
        <textarea className="hud-input" rows={2} style={{ resize: 'vertical' }} value={draft.profile.notes} onChange={(e) => patch((d) => ({ ...d, profile: { ...d.profile, notes: e.target.value } }))} />
        <div className="field__hint">The full profile lives in the Memory panel (and the vault), and Ultron keeps it current on its own.</div>
      </div>

      <div className="divider" />
      <div className="subhead">VOICE</div>
      <UltronVoiceSettings draft={draft} patch={patch} voices={voices} />
      <div className="field">
        <span className="field__label">Spoken reminders</span>
        <div className="tag-row">
          <span className={`chip ${draft.voice.speakReminders ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }}
            onClick={() => patch((d) => ({ ...d, voice: { ...d.voice, speakReminders: !d.voice.speakReminders } }))}>
            {draft.voice.speakReminders ? 'ON - ULTRON SAYS REMINDERS OUT LOUD' : 'OFF - NOTIFICATION ONLY'}
          </span>
        </div>
      </div>
      <div className="field">
        <span className="field__label">Wake word</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className={`hud-btn ${wakeStatus === 'listening' ? 'hud-btn--active' : ''}`} onClick={() => void toggleWakeWord()}>
            {wakeStatus === 'listening' ? 'Listening for "Ultron" - ON' : 'Enable "Ultron" wake word'}
          </button>
          {wakeStatus === 'unavailable' && <span className="chip chip--bad">UNAVAILABLE</span>}
        </div>
        {wakeError && <div className="mono" style={{ fontSize: 10, color: 'var(--red)', marginTop: 5 }}>{wakeError}</div>}
        <div className="field__hint">
          Say &quot;Ultron&quot; and it brings the window forward and greets you. Runs local Whisper continuously, so it uses real CPU while on.
        </div>
      </div>

      <div className="divider" />
      <div className="subhead">INTELLIGENCE FEED</div>
      <KeyField
        name="GNEWS_API_KEY" label="GNews API key" has={Boolean(hasKey?.GNEWS_API_KEY)} draft={keys.GNEWS_API_KEY ?? ''} setDraft={setKey('GNEWS_API_KEY')}
        hint={<>Free tier: 100 requests/day. <span className="link-btn" onClick={() => void ultron.app.openExternal('https://gnews.io/register')}>gnews.io/register</span></>}
      />
      <div className="field">
        <span className="field__label">News categories ({dailyCost} request{dailyCost === 1 ? '' : 's'} per sync)</span>
        <div className="tag-row">
          {NEWS_CATEGORIES.map((c) => {
            const on = draft.news.categories.includes(c);
            return (
              <span key={c} className={`chip ${on ? '' : 'chip--muted'}`}
                onClick={() => patch((d) => ({ ...d, news: { ...d.news, categories: on ? d.news.categories.filter((x) => x !== c) : [...d.news.categories, c] } }))}>
                {c}
              </span>
            );
          })}
        </div>
      </div>
      <div className="field">
        <span className="field__label">Auto-refresh: every {draft.news.autoRefreshMinutes} minutes</span>
        <input type="range" min={15} max={180} step={5} value={draft.news.autoRefreshMinutes} style={{ width: '100%', accentColor: '#00d9ff' }}
          onChange={(e) => patch((d) => ({ ...d, news: { ...d.news, autoRefreshMinutes: Number(e.target.value) } }))} />
        <div className="field__hint" style={{ color: perDay > draft.news.dailyCap * 0.8 ? 'var(--red)' : undefined }}>
          Projected usage: about {perDay} of {draft.news.dailyCap} requests/day.
        </div>
      </div>

      <div className="field">
        <span className="field__label">Morning briefing</span>
        <div className="tag-row">
          <span className={`chip ${draft.briefing.on ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }}
            onClick={() => patch((d) => ({ ...d, briefing: { ...d.briefing, on: !d.briefing.on } }))}>
            {draft.briefing.on ? 'ON' : 'OFF'}
          </span>
          {draft.briefing.on && [6, 7, 8, 9, 16].map((h) => (
            <span key={h} className={`chip ${draft.briefing.hour === h ? '' : 'chip--muted'}`} style={{ cursor: 'pointer' }}
              onClick={() => patch((d) => ({ ...d, briefing: { ...d.briefing, hour: h } }))}>
              {h > 12 ? `${h - 12} PM` : `${h} AM`}
            </span>
          ))}
        </div>
        <div className="field__hint">
          Once a day after that hour, Ultron reads out the weather, what is due on D2L, unread email and your next task.
          It waits until you are at the PC and never interrupts a focus session.
        </div>
      </div>

      <div className="divider" />
      <div className="subhead">STARTUP &amp; BACKUP</div>
      <div className="field">
        <button className={`hud-btn ${autoLaunch ? 'hud-btn--active' : ''}`} onClick={() => void toggleAutoLaunch()} disabled={autoLaunch === null || !installed}>
          {autoLaunch ? 'Starts with Windows - ON' : 'Start with Windows'}
        </button>
        <div className="field__hint">
          Starts quietly in the tray so reminders fire even before you open it. Closing the window (&times;) hides Ultron to the
          tray; right-click the tray icon to quit.
        </div>
      </div>
      <div className="field">
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="hud-btn" onClick={async () => {
            const res = await ultron.backup.export();
            if (res.ok && res.path) setStatus({ text: `Backup saved to ${res.path}` });
            else if (res.error) setStatus({ text: res.error, bad: true });
          }}>Export settings + profile</button>
          <button className="hud-btn" onClick={async () => {
            const res = await ultron.backup.import();
            if (res.ok) { setSettings(await ultron.settings.get()); setStatus({ text: 'Backup restored.' }); }
            else if (res.error) setStatus({ text: res.error, bad: true });
          }}>Import backup</button>
        </div>
        <div className="field__hint">Never includes API keys. The vault is plain markdown - copy the folder to back up everything Ultron remembers.</div>
      </div>
    </Overlay>
  );
}

/** One automatic tracker: its switch, what it records, and exactly what it has collected. */
function TrackerRow({ kind, label, hint, on, onToggle }: { kind: 'pc' | 'games'; label: string; hint: string; on: boolean; onToggle: () => void }) {
  const [items, setItems] = useState<string[] | null>(null);
  const show = async () => setItems(items ? null : await ultron.trackers.collected(kind));
  const forget = async () => {
    if (!window.confirm('Delete everything this tracker has collected? This cannot be undone.')) return;
    await ultron.trackers.forget(kind);
    setItems([]);
  };
  return (
    <div className="field">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`chip ${on ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={onToggle}>{on ? 'ON' : 'OFF'}</span>
        <span className="field__label" style={{ margin: 0 }}>{label}</span>
        <span className="link-btn" onClick={() => void show()}>{items ? 'Hide what it collected' : 'Show what it collected'}</span>
      </div>
      <div className="field__hint">{hint}</div>
      {items && (
        <div className="field__hint" style={{ maxHeight: 140, overflowY: 'auto', marginTop: 4 }}>
          {items.length ? items.slice(-60).reverse().map((t) => <div key={t}>{t}</div>) : 'Nothing collected.'}
          {items.length > 0 && <div style={{ marginTop: 6 }}><span className="link-btn" onClick={() => void forget()}>Delete all of it</span></div>}
        </div>
      )}
    </div>
  );
}

/**
 * Settings -> Voice (11 Oct 2026). Ultron's own voice (Kokoro on this PC + the Ultron effect) or the
 * Windows voices. The Ultron voice downloads once (about 330 MB); until then the Windows voice speaks.
 */
function UltronVoiceSettings({ draft, patch, voices }: { draft: Settings; patch: (fn: (d: Settings) => Settings) => void; voices: SpeechSynthesisVoice[] }) {
  const [vs, setVs] = useState<VoiceStatus | null>(null);
  const [list, setList] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => onUltronVoice(setVs), []);
  useEffect(() => { void ultron.voice.voices().then(setList).catch(() => undefined); }, []);
  const v = draft.voice;
  const ours = v.engine === 'ultron';
  const set = (part: Partial<Settings['voice']>) => patch((d) => ({ ...d, voice: { ...d.voice, ...part } }));
  const useOurs = () => { set({ engine: 'ultron' }); void ultron.voice.prepare(); };
  const test = () => speak('I am Ultron. Systems online, and every module is answering. Your homework, however, is not.', {
    engine: v.engine, ultronVoice: v.ultronVoice, effect: v.effect, voiceName: v.name, rate: v.rate, pitch: v.pitch,
  });

  const state = !vs ? 'Checking...'
    : vs.state === 'downloading' ? `Downloading the voice${vs.progress !== undefined ? ` - ${Math.round(vs.progress * 100)}%` : '...'} (about 330 MB, once). Windows speaks until it's done.`
      : vs.state === 'loading' ? 'Loading the voice...'
        : vs.state === 'error' ? `Not working: ${vs.error ?? 'the voice did not load'}. Windows speaks meanwhile.`
          : vs.downloaded ? (vs.state === 'ready' ? 'Ready - running on this PC.' : 'Ready - it wakes up when Ultron speaks.')
            : 'Not downloaded yet.';

  return (
    <>
      <div className="field">
        <span className="field__label">Ultron&apos;s voice</span>
        <div className="tag-row">
          <span className={`chip ${ours ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={useOurs}>ULTRON VOICE (ON THIS PC)</span>
          <span className={`chip ${!ours ? 'chip--good' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => set({ engine: 'system' })}>WINDOWS VOICES</span>
        </div>
        {ours && (
          <div className="field__hint" style={vs?.state === 'error' ? { color: 'var(--red)' } : undefined}>
            {state}
            {(vs?.state === 'error' || (vs && !vs.downloaded && vs.state === 'off')) && (
              <> <span className="link-btn" onClick={() => void ultron.voice.prepare()}>{vs.state === 'error' ? 'Try again' : 'Download it now'}</span></>
            )}
          </div>
        )}
      </div>

      {ours ? (
        <>
          <div className="field">
            <span className="field__label">Voice</span>
            <select className="hud-input" value={v.ultronVoice} onChange={(e) => set({ ultronVoice: e.target.value })}>
              {(list.length ? list : [{ id: v.ultronVoice, label: v.ultronVoice }]).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <div className="field__hint">
              Kokoro, a free open voice model, speaking on this computer - nothing is sent anywhere. The effect below is what makes it Ultron.
            </div>
          </div>
          <div className="field">
            <span className="field__label">Ultron effect: {Math.round(v.effect * 100)}% {v.effect < 0.05 ? '(clean voice)' : v.effect > 0.85 ? '(full robot)' : ''}</span>
            <input type="range" min={0} max={1} step={0.05} value={v.effect} aria-label="Ultron effect" style={{ width: '100%', accentColor: '#00d9ff' }}
              onChange={(e) => set({ effect: Number(e.target.value) })} />
            <div className="field__hint">Lower pitch, a second voice an octave down, a faint metallic edge and a short echo - more of each as it goes up.</div>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <span className="field__label">Windows voice</span>
            <select className="hud-input" value={v.name} onChange={(e) => set({ name: e.target.value })}>
              <option value="">Auto (deepest male English voice)</option>
              {voices.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.lang})</option>)}
            </select>
            <div className="field__hint">
              Windows ships few voices. Install more via Settings &rarr; Time &amp; Language &rarr; Speech &rarr; Manage voices, then pick one here.
            </div>
          </div>
          <div className="field">
            <span className="field__label">Pitch: {v.pitch.toFixed(2)} (lower = deeper)</span>
            <input type="range" min={0.1} max={1.4} step={0.05} value={v.pitch} style={{ width: '100%', accentColor: '#00d9ff' }}
              onChange={(e) => set({ pitch: Number(e.target.value) })} />
          </div>
        </>
      )}
      <div className="field">
        <span className="field__label">Speed: {v.rate.toFixed(2)} (lower = slower)</span>
        <input type="range" min={0.5} max={1.5} step={0.05} value={v.rate} style={{ width: '100%', accentColor: '#00d9ff' }}
          onChange={(e) => set({ rate: Number(e.target.value) })} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="hud-btn hud-btn--active" onClick={test}>Test voice</button>
          <button className="hud-btn" onClick={() => set({ ...VOICE_DEFAULTS, ...(ours ? { effect: 0.6, ultronVoice: 'am_michael' } : {}) })}>Reset</button>
        </div>
      </div>
    </>
  );
}
