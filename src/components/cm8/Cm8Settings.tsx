import { useEffect, useState } from 'react';
import { profile, food, plans } from '../../cm8/memory';
import * as sync from '../../cm8/sync';
import * as N from '../../cm8/nutrition';

/**
 * The two settings that change what CM8 says rather than how it looks: body
 * weight (every nutrition target is per kilo) and sync (whether this console
 * shares a memory with the phone).
 */
export function Cm8Settings() {
  const [weight, setWeight] = useState(String(profile.weightKg()));
  const [weightNote, setWeightNote] = useState('');
  const [endpoint, setEndpoint] = useState(sync.getConfig().endpoint);
  const [key, setKey] = useState(sync.getConfig().key);
  const [status, setStatus] = useState(sync.getStatus());

  useEffect(() => sync.onStatus(setStatus), []);

  const saveWeight = () => {
    const kg = parseFloat(weight);
    if (!(kg >= 25 && kg <= 150)) {
      setWeightNote('Put in a weight between 25 and 150 kg.');
      return;
    }
    profile.set({ weightKg: kg });
    const t = N.targets({ training: 'full', weightKg: kg });
    setWeightNote(`Saved. On a full training day that is ${t.p}g protein, ${t.c}g carbs and about ${t.kcal} kcal.`);
  };

  const saveSync = () => {
    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      setStatus({ state: 'error', at: Date.now(), message: 'That sync address needs to start with https://' });
      return;
    }
    sync.setConfig({ endpoint: endpoint.trim(), key: key.trim() });
  };

  const days = food.days().length;
  const meals = food.days().reduce((s, d) => s + food.day(d).length, 0);

  const tone = status.state === 'ok' ? 'var(--green)'
    : status.state === 'error' ? 'var(--red)'
      : 'var(--dim)';

  return (
    <div className="cm8-food">
      <div>
        <div className="cm8-card">
          <div className="label-xs" style={{ marginBottom: 8 }}>Body weight</div>
          <p className="cm8-ex__note" style={{ marginBottom: 8 }}>
            Protein and carbohydrate targets are worked out per kilo, so this is the one
            number that makes the food targets yours rather than generic.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="hud-input" type="number" min={25} max={150} step={0.5}
              value={weight} onChange={(e) => setWeight(e.target.value)} style={{ padding: 8, width: 120 }}
            />
            <button className="hud-btn hud-btn--active" onClick={saveWeight}>Save</button>
          </div>
          {weightNote && <p className="cm8-ex__note" style={{ marginTop: 8 }}>{weightNote}</p>}
        </div>

        <div className="cm8-card" style={{ marginTop: 12 }}>
          <div className="label-xs" style={{ marginBottom: 8 }}>Stored on this device</div>
          <div className="cm8-row"><b>Days logged</b><span>{days}</span></div>
          <div className="cm8-row"><b>Entries</b><span>{meals}</span></div>
          <div className="cm8-row"><b>Schedules</b><span>{plans.dates().length}</span></div>
        </div>
      </div>

      <div>
        <div className="cm8-card">
          <div className="label-xs" style={{ marginBottom: 8 }}>Sync across devices</div>
          <p className="cm8-ex__note" style={{ marginBottom: 10 }}>
            Point this at the same address and key as the phone and the two share one
            memory — log lunch on the phone, it is here when you open the console.
            Leave it empty and everything still works, on this device alone.
          </p>

          <div className="label-xs" style={{ marginBottom: 4 }}>Sync address</div>
          <input
            className="hud-input" style={{ width: '100%', padding: 8, marginBottom: 8 }}
            placeholder="https://your-app.vercel.app/api/sync"
            value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
          />
          <div className="label-xs" style={{ marginBottom: 4 }}>Sync key</div>
          <input
            className="hud-input" type="password" style={{ width: '100%', padding: 8, marginBottom: 10 }}
            placeholder="the passphrase set on the server"
            value={key} onChange={(e) => setKey(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            <button className="hud-btn hud-btn--active" onClick={saveSync}>Save &amp; sync</button>
            <button className="hud-btn" onClick={() => void sync.syncNow()}>Sync now</button>
          </div>

          <p className="cm8-ex__note" style={{ marginTop: 10, color: tone }}>
            {status.state === 'ok' && status.at
              ? `${status.message} Last synced ${new Date(status.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
              : status.message}
          </p>

          <p className="empty-note" style={{ marginTop: 10 }}>
            The key is a passphrase that keeps the log private. It is stored on this
            device and sent only to the address above.
          </p>
        </div>
      </div>
    </div>
  );
}
