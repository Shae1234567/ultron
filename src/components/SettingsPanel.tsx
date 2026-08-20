import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { useStore } from '../state/store';
import { ultron } from '../services/bridge';
import type { Settings } from '../types';
import { listVoices, primeVoices, speak, VOICE_DEFAULTS } from '../services/speech';

const NEWS_CATEGORIES = ['world', 'nation', 'business', 'technology', 'science', 'sports', 'health'];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setOllama = useStore((s) => s.setOllama);

  const [draft, setDraft] = useState<Settings | null>(settings);
  const [interestInput, setInterestInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [envPath, setEnvPath] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => {
    primeVoices();
    const load = () => setVoices(listVoices());
    load();
    const id = setTimeout(load, 600);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    void ultron.news.hasKey().then(setHasKey);
    void ultron.settings.envPath().then(setEnvPath);
  }, []);

  if (!draft) return null;

  const patch = (fn: (d: Settings) => Settings) => setDraft(fn(draft));

  const save = async () => {
    const next = await ultron.settings.save(draft);
    setSettings(next);
    setOllama(await ultron.ollama.status());
    setSaved('Settings saved.');
    setTimeout(() => setSaved(null), 2500);
  };

  const saveKey = async () => {
    const value = apiKey.trim();
    if (!value) return;
    const res = await ultron.settings.setEnvKey('GNEWS_API_KEY', value);
    if (res.ok) {
      setApiKey('');
      setHasKey(true);
      setSaved(`Key written to ${res.file}`);
      setTimeout(() => setSaved(null), 4000);
    } else {
      setSaved(res.error ?? 'Could not write key.');
    }
  };

  const addInterest = () => {
    const v = interestInput.trim().toLowerCase();
    if (!v || draft.profile.interests.includes(v)) return;
    patch((d) => ({ ...d, profile: { ...d.profile, interests: [...d.profile.interests, v] } }));
    setInterestInput('');
  };

  const dailyCost = draft.news.categories.length;
  const perDay = Math.floor((24 * 60) / Math.max(15, draft.news.autoRefreshMinutes)) * dailyCost;

  return (
    <Overlay
      title="Settings"
      meta="LOCAL ONLY"
      onClose={onClose}
      footer={
        <>
          {saved && <span className="mono" style={{ fontSize: 11, color: 'var(--green)', marginRight: 'auto' }}>{saved}</span>}
          <button className="hud-btn" onClick={onClose}>Cancel</button>
          <button className="hud-btn hud-btn--active" onClick={save}>Save</button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Your location</span>
        <input
          className="hud-input"
          value={draft.profile.location}
          onChange={(e) => patch((d) => ({ ...d, profile: { ...d.profile, location: e.target.value } }))}
        />
        <div className="field__hint">Used to judge which headlines actually affect you.</div>
      </div>

      <div className="field">
        <span className="field__label">Interest tags</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="hud-input"
            placeholder="add a tag and press enter"
            value={interestInput}
            onChange={(e) => setInterestInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInterest(); } }}
          />
          <button className="hud-btn" onClick={addInterest}>Add</button>
        </div>
        <div className="tag-row">
          {draft.profile.interests.map((t) => (
            <span
              key={t}
              className="chip"
              onClick={() => patch((d) => ({ ...d, profile: { ...d.profile, interests: d.profile.interests.filter((x) => x !== t) } }))}
              title="click to remove"
            >
              {t} x
            </span>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">About you</span>
        <textarea
          className="hud-input"
          rows={3}
          style={{ resize: 'vertical' }}
          value={draft.profile.notes}
          onChange={(e) => patch((d) => ({ ...d, profile: { ...d.profile, notes: e.target.value } }))}
        />
        <div className="field__hint">Fed to the local model as context for both chat and news relevance.</div>
      </div>

      <div style={{ height: 1, background: 'var(--cyan-20)', margin: '18px 0' }} />

      <div className="field">
        <span className="field__label">GNews API key</span>
        {hasKey ? (
          <div className="chip chip--good" style={{ marginBottom: 6 }}>
            <span className="dot" /> KEY PRESENT IN .ENV
          </div>
        ) : (
          <div className="chip chip--bad" style={{ marginBottom: 6 }}>
            <span className="dot" /> NO KEY FOUND
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="hud-input"
            type="password"
            placeholder={hasKey ? 'paste a new key to replace' : 'paste your free GNews key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button className="hud-btn" onClick={saveKey} disabled={!apiKey.trim()}>Write to .env</button>
        </div>
        <div className="field__hint">
          Free tier: 100 requests/day, no card required. Get one at{' '}
          <span className="link-btn" onClick={() => void ultron.app.openExternal('https://gnews.io/register')}>gnews.io/register</span>
          <br />
          Stored in <span className="mono" style={{ color: 'var(--cyan)' }}>{envPath || '.env'}</span> - never in the source.
        </div>
      </div>

      <div className="field">
        <span className="field__label">News categories ({dailyCost} request{dailyCost === 1 ? '' : 's'} per sync)</span>
        <div className="tag-row">
          {NEWS_CATEGORIES.map((c) => {
            const on = draft.news.categories.includes(c);
            return (
              <span
                key={c}
                className={`chip ${on ? '' : 'chip--muted'}`}
                onClick={() => patch((d) => ({
                  ...d,
                  news: {
                    ...d.news,
                    categories: on ? d.news.categories.filter((x) => x !== c) : [...d.news.categories, c],
                  },
                }))}
              >
                {c}
              </span>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Auto-refresh: every {draft.news.autoRefreshMinutes} minutes</span>
        <input
          type="range"
          min={15}
          max={180}
          step={5}
          value={draft.news.autoRefreshMinutes}
          style={{ width: '100%', accentColor: '#00d9ff' }}
          onChange={(e) => patch((d) => ({ ...d, news: { ...d.news, autoRefreshMinutes: Number(e.target.value) } }))}
        />
        <div className="field__hint" style={{ color: perDay > draft.news.dailyCap * 0.8 ? 'var(--red)' : undefined }}>
          Projected usage: about {perDay} of {draft.news.dailyCap} requests/day.
          {perDay > draft.news.dailyCap * 0.8
            ? ' That is too close to the cap - auto-refresh will pause at 80% to protect manual refreshes.'
            : ' Comfortably inside the free tier.'}
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--cyan-20)', margin: '18px 0' }} />

      <div className="field">
        <span className="field__label">Ollama host</span>
        <input
          className="hud-input"
          value={draft.ollama.host}
          onChange={(e) => patch((d) => ({ ...d, ollama: { ...d.ollama, host: e.target.value } }))}
        />
      </div>

      <div className="field">
        <span className="field__label">Model</span>
        <input
          className="hud-input"
          value={draft.ollama.model}
          onChange={(e) => patch((d) => ({ ...d, ollama: { ...d.ollama, model: e.target.value } }))}
        />
        <div className="field__hint">
          Must be pulled first: <span className="mono" style={{ color: 'var(--green)' }}>ollama pull {draft.ollama.model}</span>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--cyan-20)', margin: '18px 0' }} />

      <div className="field">
        <span className="field__label">Ultron&apos;s voice</span>
        <select
          className="hud-input"
          value={draft.voice.name}
          onChange={(e) => patch((d) => ({ ...d, voice: { ...d.voice, name: e.target.value } }))}
        >
          <option value="">Auto (deepest male English voice)</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
          ))}
        </select>
        <div className="field__hint">
          Windows ships few voices. For a JARVIS-style British male, install one via
          Settings &rarr; Time &amp; Language &rarr; Speech &rarr; Manage voices, then pick it here.
        </div>
      </div>

      <div className="field">
        <span className="field__label">Pitch: {draft.voice.pitch.toFixed(2)} (lower = deeper)</span>
        <input
          type="range" min={0.1} max={1.4} step={0.05}
          value={draft.voice.pitch}
          style={{ width: '100%', accentColor: '#00d9ff' }}
          onChange={(e) => patch((d) => ({ ...d, voice: { ...d.voice, pitch: Number(e.target.value) } }))}
        />
      </div>

      <div className="field">
        <span className="field__label">Rate: {draft.voice.rate.toFixed(2)} (lower = slower)</span>
        <input
          type="range" min={0.5} max={1.5} step={0.05}
          value={draft.voice.rate}
          style={{ width: '100%', accentColor: '#00d9ff' }}
          onChange={(e) => patch((d) => ({ ...d, voice: { ...d.voice, rate: Number(e.target.value) } }))}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            className="hud-btn hud-btn--active"
            onClick={() =>
              speak('I am Ultron. Systems online, and every module is answering.', {
                voiceName: draft.voice.name,
                rate: draft.voice.rate,
                pitch: draft.voice.pitch,
              })
            }
          >
            Test voice
          </button>
          <button
            className="hud-btn"
            onClick={() => patch((d) => ({ ...d, voice: { ...d.voice, ...VOICE_DEFAULTS } }))}
          >
            Reset
          </button>
        </div>
        <div className="field__hint">
          Test plays instantly with the sliders as they are - Save to keep them.
        </div>
      </div>
    </Overlay>
  );
}
