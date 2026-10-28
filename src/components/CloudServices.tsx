import { useEffect, useState } from 'react';
import { ultron } from '../services/bridge';
import { CHIP, IDLE, IN_USE, standingOf, type Standing } from '../services/cloudStanding';
import { clockTime, relTime } from '../services/format';
import type { BrainLine, BrainStatus, BrainUsage, CloudPreset, CloudStatus, SecretName, Settings } from '../types';

/**
 * Settings -> BRAIN -> the free AI services. Each one is a key box plus what
 * its free tier gives. Ultron uses whichever has quota left and moves to the
 * next when one runs out, so the more that are connected, the less often it
 * falls back to the small local model.
 *
 * This panel leads with the verdict on purpose. It used to show one row per
 * service and nothing else, so two services that needed nothing doing - one
 * out of free credits, one with a key its owner had revoked - made the whole
 * thing look broken while three others were answering perfectly. The question
 * it has to answer first is "do I have to do anything?", and nearly always the
 * honest answer is no.
 *
 * 10 Oct 2026: services can be added (a preset, or any OpenAI-compatible address), and the panel
 * says plainly when the brain setting means none of these is being used at all.
 */

interface Props {
  draft: Settings;
  patch: (fn: (d: Settings) => Settings) => void;
  keys: Partial<Record<SecretName, string>>;
  setKey: (name: SecretName) => (v: string) => void;
  hasKey: Record<SecretName, boolean> | null;
  brain: BrainStatus | null;
  /** Re-reads which keys are saved and re-checks the services, after one is saved. */
  onSaved: () => Promise<void>;
}

type Note = { id: string; text: string; bad?: boolean } | null;

export function CloudServices({ draft, patch, keys, setKey, brain, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [showIdle, setShowIdle] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const services = brain?.clouds ?? [];

  const standing = (s: CloudStatus): Standing => standingOf(s, s.configured);
  const ready = services.filter((s) => standing(s) === 'ready');
  // Shown in the main list: anything Ultron is actually working with, resting included.
  const inUse = services.filter((s) => IN_USE.includes(standing(s)));
  // Tucked away: nothing here is stopping Ultron, and a refused key is the owner's
  // to replace at the service's own site or to leave alone.
  const idle = services.filter((s) => IDLE.includes(standing(s)));
  const refused = services.filter((s) => standing(s) === 'refused');
  const localOnly = draft.brain === 'ollama';

  /** Saves and tests one service's key straight away, so nothing sits unsaved in a box. */
  const saveOne = async (s: CloudStatus, value: string): Promise<boolean> => {
    if (!value.trim()) return false;
    setBusy(s.id);
    setNote(null);
    const res = s.custom ? await ultron.clouds.setKey(s.id, value.trim()) : await ultron.secrets.set(s.secret as SecretName, value.trim());
    setBusy(null);
    setNote(res.ok ? { id: s.id, text: res.detail ?? `${s.label} saved.` } : { id: s.id, text: res.error ?? `${s.label} did not accept the key.`, bad: true });
    await onSaved();
    return res.ok;
  };

  /** Asks every service again - no key needs re-pasting to clear a stale verdict. */
  const recheckAll = async () => {
    setBusy('all');
    setNote(null);
    await onSaved();
    setBusy(null);
    setOpen(true);
  };

  /** The brain setting is his - this is the button for it, right where the confusion happens. */
  const useFreeFirst = async () => {
    patch((d) => ({ ...d, brain: 'cloud' }));
    await ultron.settings.save({ brain: 'cloud' });
    await onSaved();
  };

  // Open the list by itself the first time, when nothing is connected yet.
  useEffect(() => { if (ready.length) setOpen(true); }, [ready.length]);

  const using = brain?.active === 'cloud' ? ready[0]?.label : null;

  return (
    <div className="field">
      <span className="field__label">Free AI services ({ready.length} ready)</span>

      <BrainsInUse brain={brain} />

      {/* "Local only" means none of these is used at all - the services looked broken when they were simply switched off. */}
      {localOnly && ready.length > 0 && (
        <div className="alert-strip alert-strip--warn" style={{ marginTop: 4 }}>
          <span className="dot" />
          <span>
            <strong>Ultron isn't using any of these.</strong> The brain is set to <strong>Local only</strong>, so everything runs on
            the small model on this computer. The services themselves are fine.{' '}
            <span className="link-btn" onClick={() => void useFreeFirst()}>Use free services first</span>
            {' '}(health and school data still stay on this PC or Groq).
          </span>
        </div>
      )}

      {/* The verdict, before any of the detail. */}
      {!localOnly && (
        <div className={`alert-strip ${ready.length ? 'alert-strip--info' : 'alert-strip--warn'}`} style={{ marginTop: 4 }}>
          <span className="dot" />
          {ready.length ? (
            <span>
              <strong>Nothing for you to do.</strong> {ready.length === 1 ? 'One service is' : `${ready.length} services are`} ready
              {using ? <> and Ultron is on <strong>{using}</strong></> : null}
              {brain?.model ? <> ({brain.model})</> : null}. Anything below that is resting or out of free credits comes back by
              itself - Ultron re-checks every half hour and uses the others meanwhile.
            </span>
          ) : (
            <span>
              <strong>No free service can answer right now.</strong> Ultron falls back to the small model on this computer, which
              still works but is much weaker. It keeps re-checking on its own, so this usually clears without you doing anything.
            </span>
          )}
        </div>
      )}

      {refused.length > 0 && (
        <div className="field__hint" style={{ marginTop: 6, color: '#ffb3bb' }}>
          {refused.map((s) => s.label).join(' and ')} {refused.length === 1 ? 'turned its key' : 'turned their keys'} away - Ultron skips {refused.length === 1 ? 'it' : 'them'} meanwhile.{' '}
          <span className="link-btn" onClick={() => { setOpen(true); setShowIdle(true); }}>How to fix {refused.length === 1 ? 'it' : 'them'}</span>
        </div>
      )}
      <div className="field__hint" style={{ marginTop: 6 }}>
        These all give a free allowance. Ultron uses the best one that still has quota and switches when it runs out,
        so several together keep it on a big brain nearly all day. One account each - more accounts at one service breaks their rules.
        Ask a parent before signing up: most need you to be 18 or have permission.
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <button className="hud-btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide the list' : 'Add or change keys'}
        </button>
        {/* Without this, a service marked bad by one bad moment stayed bad until Ultron
            restarted, and re-pasting a perfectly good key looked like the only fix. */}
        <button className="hud-btn" disabled={busy === 'all'} onClick={() => void recheckAll()}>
          {busy === 'all' ? 'Checking...' : 'Re-check all services'}
        </button>
      </div>

      {open && (
        <>
          {inUse.map((s) => <Row key={s.id} s={s} standing={standing(s)} {...{ draft, patch, keys, setKey, busy, note, saveOne, onSaved }} />)}

          {idle.length > 0 && (
            <>
              <button className="hud-btn" style={{ marginTop: 8 }} onClick={() => setShowIdle((v) => !v)}>
                {showIdle ? 'Hide' : 'Show'} the {idle.length} Ultron is not using
              </button>
              {showIdle && (
                <>
                  <div className="field__hint" style={{ marginTop: 4 }}>
                    None of these is holding Ultron back. A refused key means that service no longer accepts it - you can paste a
                    new one, or just leave it: the others cover the work.
                  </div>
                  {idle.map((s) => <Row key={s.id} s={s} standing={standing(s)} {...{ draft, patch, keys, setKey, busy, note, saveOne, onSaved }} />)}
                </>
              )}
            </>
          )}

          <AddService onAdded={onSaved} />
        </>
      )}
    </div>
  );
}

/**
 * Always on show (10 Oct 2026): every brain Ultron is really using, in the order it asks them, with how many
 * answers each gave today. "Ready" only said a key worked - not whether Ultron ever reached that service,
 * or which one had actually been answering.
 */
function BrainsInUse({ brain }: { brain: BrainStatus | null }) {
  const [u, setU] = useState<BrainUsage | null>(null);

  // Re-read when the services are re-checked, and every 15 s so the counts move while Settings is open.
  useEffect(() => {
    let alive = true;
    const load = () => void ultron.brain.usage().then((r) => { if (alive) setU(r); }).catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [brain]);

  if (!u) return null;
  const total = u.using.reduce((n, l) => n + l.today, 0);
  const hasLocal = u.using.some((l) => l.kind === 'local');
  const lastText = (l: BrainLine) =>
    l.today ? `${l.today} answer${l.today === 1 ? '' : 's'} today · last ${clockTime(l.lastAt ?? Date.now())}`
      : l.lastAt ? `none today · last ${relTime(l.lastAt)}`
        : 'not used yet';

  return (
    <div className="brain-use" aria-live="polite">
      <div className="brain-use__head">
        <span>ULTRON IS USING ({u.using.length})</span>
        <span className="brain-use__meta">{total ? `${total} answer${total === 1 ? '' : 's'} today` : 'no answers yet today'}</span>
      </div>

      {u.using.length === 0 ? (
        <div className="brain-use__empty">
          Nothing can answer right now: no service is ready and the local model isn't running.
        </div>
      ) : (
        <ol className="brain-use__list">
          {u.using.map((l, i) => (
            <li key={l.id} className={`brain-use__row ${u.lastAnswer?.id === l.id ? 'brain-use__row--last' : ''}`}>
              <span className="brain-use__n">{i + 1}</span>
              <span className="brain-use__name">
                {l.label}
                {l.kind === 'local' && u.using.length > 1 && <em> - backup</em>}
              </span>
              <span className="brain-use__model mono" title={l.lastModel && l.lastModel !== l.model ? `Last answer came from ${l.lastModel}` : undefined}>
                {l.model ?? 'picks a model when asked'}
              </span>
              <span className="brain-use__count mono">{lastText(l)}</span>
              <span className="brain-use__tags">
                {u.lastAnswer?.id === l.id && <span className="chip">LAST ANSWER</span>}
                {l.restingUntil && <span className="chip chip--muted">RESTING TILL {clockTime(l.restingUntil)}</span>}
                {l.trusted && (
                  <span className="chip chip--good" title="Health and school questions are only sent to these (or the model on this PC).">
                    HEALTH + SCHOOL OK
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="brain-use__hint">
        {u.choice === 'ollama'
          ? 'The brain is set to Local only, so only the model on this computer answers.'
          : 'Ultron asks number 1 first and moves down the list when one is busy or out of free quota. Health and school questions only go to the ones marked HEALTH + SCHOOL OK.'}
        {u.choice === 'auto' && hasLocal && u.using.length > 1 && ' Small background jobs try the local model first, to save the free quota.'}
      </div>
      {u.notUsing.length > 0 && (
        <div className="brain-use__not">
          <span>Not using:</span> {u.notUsing.map((n) => `${n.label} (${n.why})`).join(' · ')}
        </div>
      )}
    </div>
  );
}

/** Add a service: one of the presets with a single paste, or any OpenAI-compatible address. */
function AddService({ onAdded }: { onAdded: () => Promise<void> }) {
  const [presets, setPresets] = useState<CloudPreset[]>([]);
  const [show, setShow] = useState(false);
  const [pick, setPick] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKeyText] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    if (show) void ultron.clouds.presets().then((p) => { setPresets(p); setPick((cur) => cur || p[0]?.id || 'other'); });
  }, [show]);

  const preset = presets.find((p) => p.id === pick);
  const other = pick === 'other';
  const add = async () => {
    setBusy(true);
    setNote(null);
    const res = await ultron.clouds.add(other ? { label, baseUrl, model, key } : { preset: pick, model, key, accountId: account });
    setBusy(false);
    setNote(res.ok ? { id: 'add', text: res.detail ?? 'Added.' } : { id: 'add', text: res.error ?? 'That did not work.', bad: true });
    if (res.ok || res.id) {
      setKeyText('');
      await onAdded();
      void ultron.clouds.presets().then(setPresets);
    }
  };

  if (!show) {
    return <button className="hud-btn" style={{ marginTop: 8 }} onClick={() => setShow(true)}>Add another service</button>;
  }
  return (
    <div className="cloud-row" style={{ marginTop: 8 }}>
      <div className="cloud-row__head"><span className="cloud-row__name">Add a service</span></div>
      <div className="tag-row" style={{ marginBottom: 6 }}>
        {presets.map((p) => (
          <span key={p.id} className={`chip ${pick === p.id ? '' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => setPick(p.id)}>{p.label}</span>
        ))}
        <span className={`chip ${other ? '' : 'chip--muted'}`} style={{ cursor: 'pointer' }} onClick={() => setPick('other')}>Any other</span>
      </div>
      {preset && (
        <div className="field__hint" style={{ marginBottom: 6 }}>
          {preset.free} <span className="link-btn" onClick={() => void ultron.app.openExternal(preset.signup)}>{preset.noKey ? 'Optional token' : 'Get a key'}</span>
        </div>
      )}
      {other && (
        <>
          <input className="hud-input" placeholder="name, e.g. My server" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Service name" />
          <input className="hud-input" style={{ marginTop: 6 }} placeholder="address, e.g. https://api.example.com/v1 (OpenAI-compatible)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Service address" />
        </>
      )}
      {preset?.needsAccount && (
        <input className="hud-input" style={{ marginTop: 6 }} placeholder="Cloudflare account ID (32 letters and numbers)" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account ID" />
      )}
      <input className="hud-input" style={{ marginTop: 6 }} placeholder="model (optional - Ultron picks the best one it lists)" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input className="hud-input" type="password" placeholder={preset?.noKey ? 'no key needed - leave empty (or paste a token)' : 'paste the key here'} value={key} onChange={(e) => setKeyText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (key.trim() || preset?.noKey)) void add(); }} aria-label="Key" />
        <button className="hud-btn" disabled={busy || (!key.trim() && !preset?.noKey) || (other && (!label.trim() || !baseUrl.trim()))} onClick={() => void add()}>
          {busy ? 'Testing...' : preset?.noKey && !key.trim() ? 'Add (no key)' : 'Add & test'}
        </button>
      </div>
      {note && <div className={`alert-strip ${note.bad ? 'alert-strip--warn' : 'alert-strip--info'}`} style={{ marginTop: 6 }}><span className="dot" />{note.text}</div>}
    </div>
  );
}

function Row({
  s, standing, draft, patch, keys, setKey, busy, note, saveOne, onSaved,
}: {
  s: CloudStatus;
  standing: Standing;
  draft: Settings;
  patch: (fn: (d: Settings) => Settings) => void;
  keys: Partial<Record<SecretName, string>>;
  setKey: (name: SecretName) => (v: string) => void;
  busy: string | null;
  note: Note;
  saveOne: (s: CloudStatus, value: string) => Promise<boolean>;
  onSaved: () => Promise<void>;
}) {
  const saved = s.configured;
  const off = draft.clouds[s.id]?.off === true;
  const chip = CHIP[standing];
  // A built-in service's box lives in the Settings draft (as before); an added one keeps its own.
  const [own, setOwn] = useState('');
  const value = s.custom ? own : keys[s.secret as SecretName] ?? '';
  const setValue = s.custom ? setOwn : setKey(s.secret as SecretName);
  const save = async () => { if (await saveOne(s, value)) setValue(''); };
  return (
    <div className="cloud-row">
      <div className="cloud-row__head">
        {/* Only say the key was refused when the service actually refused it. Spent credits and
            rate limits are not bad keys, and showing them as such sent the owner hunting for a
            new key that did not exist. */}
        <span className={`chip ${chip.cls}`}><span className="dot" /> {chip.text}</span>
        <span className="cloud-row__name">{s.label}</span>
        {s.model && <span className="cloud-row__model mono">{s.model}</span>}
        {saved && (
          <button
            className="mini-btn"
            onClick={() => patch((d) => ({ ...d, clouds: { ...d.clouds, [s.id]: { ...d.clouds[s.id], off: !off } } }))}
          >
            {off ? 'USE IT' : 'TURN OFF'}
          </button>
        )}
        {s.custom && (
          <button className="mini-btn" onClick={() => void ultron.clouds.remove(s.id).then(() => onSaved())}>REMOVE</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="hud-input"
          type="password"
          placeholder={saved ? 'a key is already saved - paste a new one only to replace it' : 'paste the key here'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          aria-label={`${s.label} key`}
        />
        {/* Its own Save, next to the box. Relying on the one at the very bottom of
            Settings meant a pasted key could sit there unsaved and look done. */}
        <button className="hud-btn" disabled={!value.trim() || busy === s.id} onClick={() => void save()}>
          {busy === s.id ? 'Testing...' : 'Save & test'}
        </button>
      </div>
      {note?.id === s.id && (
        <div className={`alert-strip ${note.bad ? 'alert-strip--warn' : 'alert-strip--info'}`} style={{ marginTop: 6 }}>
          <span className="dot" />{note.text}
        </div>
      )}
      {standing === 'refused' && <RefusedFix s={s} onSaved={onSaved} />}
      <div className="field__hint">
        {s.free}{' '}
        {s.signup && <span className="link-btn" onClick={() => void ultron.app.openExternal(s.signup)}>Get a key</span>}
        {/* A blip is worth showing; "out of credits" is already said by the chip. */}
        {s.error && standing !== 'noCredits' && standing !== 'refused' && <span style={{ color: 'var(--red)' }}> - {s.error}</span>}
      </div>
    </div>
  );
}

/**
 * A key the service itself turned away (10 Oct 2026: OpenRouter "User not found", NVIDIA 403 on two
 * models). That is the service's answer, not Ultron guessing - so say so plainly, say what the
 * saved key looks like (never what it is), and make replacing it three clicks: open the key page,
 * copy a new key, Paste & test. The key goes from the clipboard straight to the encrypted store.
 */
function RefusedFix({ s, onSaved }: { s: CloudStatus; onSaved: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pasteAndTest = async () => {
    setBusy(true);
    setMsg(null);
    const r = await ultron.clouds.pasteKey(s.id);
    setBusy(false);
    setMsg(r.ok ? { text: r.detail ?? `${s.label} works now.`, bad: false } : { text: r.error ?? `${s.label} did not accept that key either.`, bad: true });
    await onSaved();
  };
  const forget = async () => {
    if (!window.confirm(`Remove the saved ${s.label} key? Ultron already skips it; this just clears the red mark until you add a new one.`)) return;
    if (s.custom) await ultron.clouds.remove(s.id);
    else await ultron.secrets.set(s.secret as SecretName, '');
    await onSaved();
  };
  const where = s.signup.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  const said = (s.error ?? '').replace(/^.*?refused the key:?\s*/i, '').replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 80);
  return (
    <div className="cloud-fix">
      <div>
        <strong>{s.label} itself says no to this key{said ? ` ("${said}")` : ''}.</strong>{' '}
        This isn't Ultron guessing and nothing on this PC can fix it - {s.label} has to give you a new key. Nothing is broken meanwhile: Ultron skips it and uses the others.
      </div>
      {s.keyHint && <div className="cloud-fix__hint">{s.keyHint}</div>}
      <ol>
        <li>{s.signup ? <><span className="link-btn" onClick={() => void ultron.app.openExternal(s.signup)}>Open {where}</span> and sign in.</> : <>Open {s.label}'s website and sign in.</>}</li>
        <li>Create a new key and copy it.</li>
        <li><button className="hud-btn hud-btn--active" disabled={busy} onClick={() => void pasteAndTest()}>{busy ? 'Testing...' : 'Paste & test'}</button></li>
      </ol>
      <div className="cloud-fix__hint">Or paste it into the box above and press Save &amp; test - either way the key goes straight into the encrypted store.</div>
      {msg && <div className={`alert-strip ${msg.bad ? 'alert-strip--warn' : 'alert-strip--info'}`}><span className="dot" />{msg.text}</div>}
      <span className="link-btn" onClick={() => void forget()}>Or remove this key</span>
    </div>
  );
}
