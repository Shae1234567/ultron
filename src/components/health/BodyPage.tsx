import { useEffect, useState } from 'react';
import type { PainArea, PainEntry } from '../../types';
import { useHealth } from './context';
import { Chips, ENERGY_WORDS, Empty, Scale, Sec, SORE_WORDS, dayLabel } from './ui';

/*
 * Asclepius' page: the daily check-in, and pain - tapped on a body map, followed up until
 * it's gone. It never diagnoses. Whatever the safety core says a pain needs (stop and tell
 * a parent, coach or physio; any head knock to an adult today) is shown the moment it's
 * logged, in the same words Ultron uses.
 */

type Side = 'left' | 'right';
type Rect = [x: number, y: number, w: number, h: number];
interface Region { where: string; side?: Side; rects: Rect[] }

const pair = (where: string, a: Rect, b: Rect, viewerLeftIs: Side): Region[] => [
  { where, side: viewerLeftIs, rects: [a] },
  { where, side: viewerLeftIs === 'right' ? 'left' : 'right', rects: [b] },
];

// 20 x 44 grid per figure. Front: his right is on the viewer's left. Back: his left is.
const FRONT: Region[] = [
  { where: 'head', rects: [[7, 0, 6, 6]] },
  { where: 'neck', rects: [[8, 6, 4, 2]] },
  ...pair('shoulder', [3, 8, 4, 3], [13, 8, 4, 3], 'right'),
  { where: 'chest', rects: [[7, 8, 6, 6]] },
  { where: 'stomach', rects: [[7, 14, 6, 5]] },
  ...pair('upper arm', [2, 11, 3, 6], [15, 11, 3, 6], 'right'),
  ...pair('forearm', [1, 17, 3, 6], [16, 17, 3, 6], 'right'),
  ...pair('wrist', [0, 23, 3, 3], [17, 23, 3, 3], 'right'),
  ...pair('hip', [6, 19, 3, 3], [11, 19, 3, 3], 'right'),
  { where: 'groin', rects: [[9, 19, 2, 3]] },
  ...pair('quad', [6, 22, 4, 8], [10, 22, 4, 8], 'right'),
  ...pair('knee', [6, 30, 4, 3], [10, 30, 4, 3], 'right'),
  ...pair('shin', [6, 33, 4, 7], [10, 33, 4, 7], 'right'),
  ...pair('ankle', [6, 40, 4, 2], [10, 40, 4, 2], 'right'),
  ...pair('foot', [5, 42, 5, 2], [10, 42, 5, 2], 'right'),
];
const BACK: Region[] = [
  { where: 'head', rects: [[7, 0, 6, 6]] },
  { where: 'neck', rects: [[8, 6, 4, 2]] },
  ...pair('shoulder', [3, 8, 4, 3], [13, 8, 4, 3], 'left'),
  { where: 'upper back', rects: [[7, 8, 6, 6]] },
  { where: 'lower back', rects: [[7, 14, 6, 5]] },
  ...pair('upper arm', [2, 11, 3, 6], [15, 11, 3, 6], 'left'),
  ...pair('forearm', [1, 17, 3, 6], [16, 17, 3, 6], 'left'),
  ...pair('wrist', [0, 23, 3, 3], [17, 23, 3, 3], 'left'),
  ...pair('glute', [6, 19, 4, 4], [10, 19, 4, 4], 'left'),
  ...pair('hamstring', [6, 23, 4, 7], [10, 23, 4, 7], 'left'),
  ...pair('knee', [6, 30, 4, 3], [10, 30, 4, 3], 'left'),
  ...pair('calf', [6, 33, 4, 7], [10, 33, 4, 7], 'left'),
  ...pair('ankle', [6, 40, 4, 2], [10, 40, 4, 2], 'left'),
  ...pair('foot', [5, 42, 5, 2], [10, 42, 5, 2], 'left'),
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Places with no left and right: a side carried over from an earlier tap doesn't apply to them. */
const UNSIDED = new Set(['head', 'neck', 'chest', 'stomach', 'groin', 'upper back', 'lower back']);
const sideFor = (where: string, side?: string) => (UNSIDED.has(norm(where)) ? undefined : side);
/** The map keys a place lights up - both sides for "both". */
function keysOf(where: string, side?: string): string[] {
  const s = sideFor(where, side);
  return s === 'both' ? [`${norm(where)}|left`, `${norm(where)}|right`] : [`${norm(where)}|${s ?? ''}`];
}
const keyOf = (where: string, side?: string) => keysOf(where, side)[0];
const U = 6;

function Figure({ regions, label, x0, heat, selected, onPick }: {
  regions: Region[]; label: string; x0: number; heat: Map<string, number>; selected: string[]; onPick: (r: Region) => void;
}) {
  return (
    <g transform={`translate(${x0} 14)`}>
      <text className="hl-map__t" x={10 * U} y={-4}>{label}</text>
      <text className="hl-map__s" x={-2} y={8 * U}>{label === 'FRONT' ? 'R' : 'L'}</text>
      <text className="hl-map__s" x={20 * U + 2} y={8 * U}>{label === 'FRONT' ? 'L' : 'R'}</text>
      {regions.map((r) => {
        const k = keyOf(r.where, r.side);
        const sev = heat.get(k);
        const name = `${r.side ? `${r.side} ` : ''}${r.where}`;
        return (
          <g key={`${label}${k}`} className={`hl-map__r${selected.includes(k) ? ' is-on' : ''}${sev ? ` is-sore sev${Math.min(3, Math.ceil(sev / 3.4))}` : ''}`}
            role="button" tabIndex={0} aria-label={`${name}${sev ? `, pain ${sev} of 10` : ''}`}
            onClick={() => onPick(r)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r); } }}>
            <title>{name}</title>
            {r.rects.map(([x, y, w, h], i) => <rect key={i} x={x * U} y={y * U} width={w * U - 1} height={h * U - 1} />)}
          </g>
        );
      })}
    </g>
  );
}

const FEEL = [{ id: 'sharp', text: 'Sharp' }, { id: 'dull', text: 'Dull' }, { id: 'ache', text: 'Aching' }, { id: 'tight', text: 'Tight' }] as const;
const WHEN = [{ id: 'training', text: 'While training' }, { id: 'after', text: 'After' }, { id: 'rest', text: 'At rest too' }, { id: 'morning', text: 'Mornings' }] as const;
const SIDES = [{ id: 'left', text: 'Left' }, { id: 'right', text: 'Right' }, { id: 'both', text: 'Both' }] as const;

function Spark({ history }: { history: { date: string; severity: number }[] }) {
  return (
    <span className="hl-spark" aria-label={`Pain over time: ${history.map((x) => x.severity).join(', ')}`}>
      {history.slice(-10).map((x, i) => <i key={i} style={{ height: `${x.severity * 10}%` }} title={`${x.date}: ${x.severity}/10`} />)}
    </span>
  );
}

export function BodyPage() {
  const h = useHealth();
  const { v } = h;
  const editing = h.editing?.kind === 'pain' ? h.editing.entry : null;
  const [where, setWhere] = useState('');
  const [side, setSide] = useState<string | undefined>();
  const [severity, setSeverity] = useState<number | undefined>();
  const [feel, setFeel] = useState<string | undefined>();
  const [swelling, setSwelling] = useState(false);
  const [when, setWhen] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [alerts, setAlerts] = useState<string[]>([]);
  const [cNote, setCNote] = useState(v.checkin?.note ?? '');

  useEffect(() => {
    if (!editing) return;
    setWhere(editing.where); setSide(editing.side); setSeverity(editing.severity); setFeel(editing.feel);
    setSwelling(Boolean(editing.swelling)); setWhen(editing.when); setNote(editing.note ?? '');
  }, [editing?.id]);

  const heat = new Map(v.pain.areas.filter((a) => a.active).flatMap((a) => keysOf(a.where, a.side).map((k) => [k, a.latest.severity] as const)));
  const reset = () => { setWhere(''); setSide(undefined); setSeverity(undefined); setFeel(undefined); setSwelling(false); setWhen(undefined); setNote(''); };

  const save = async () => {
    if (!where.trim() || !severity) { h.toast('Where, and how bad (1-10)?', true); return; }
    const p = { where, side: sideFor(where, side), severity, feel, swelling, when, note };
    const r = editing ? await h.edit('pain', editing.id, { ...p, date: editing.date }, 'Updated.') : await h.log('pain', p, 'Logged.');
    if (r.ok) { setAlerts(r.alerts ?? []); reset(); }
  };
  const followUp = async (a: PainArea, status: 'better' | 'same' | 'worse' | 'gone') => {
    const s = a.latest.severity;
    const severity = status === 'gone' ? 1 : status === 'better' ? Math.max(1, s - 2) : status === 'worse' ? Math.min(10, s + 2) : s;
    const r = await h.log('pain', { where: a.where, side: a.side, severity, status, feel: a.latest.feel }, status === 'gone' ? `${a.where} marked as gone.` : 'Noted.');
    if (r.ok) setAlerts(r.alerts ?? []);
  };

  const selected = where.trim() ? keysOf(where, side) : [];
  return (
    <div className="hl-page">
      {alerts.length > 0 && (
        <div className="hl-alert" role="alert">
          {alerts.map((a) => <p key={a}>{a}</p>)}
          <button className="hl-mini" onClick={() => setAlerts([])}>Got it</button>
        </div>
      )}

      <div className="hl-cols">
        <section className="hl-form">
          <Sec>Check-in</Sec>
          <div className="hl-label">Energy</div>
          <Scale label="Energy" value={v.checkin?.energy} low="flat" high="buzzing" words={ENERGY_WORDS} onChange={(n) => void h.log('checkin', { energy: n })} />
          <div className="hl-label">Soreness</div>
          <Scale label="Soreness" value={v.checkin?.soreness} low="fresh" high="wrecked" words={SORE_WORDS} onChange={(n) => void h.log('checkin', { soreness: n })} />
          <div className="hl-row">
            <input className="hud-input" placeholder="anything else (optional)" value={cNote} onChange={(e) => setCNote(e.target.value)} aria-label="Check-in note" />
            <button className="hud-btn" disabled={!cNote.trim() || cNote === v.checkin?.note} onClick={() => void h.log('checkin', { note: cNote }, 'Saved.')}>Save</button>
          </div>
          <div className={`hl-sum hl-sum--${v.readiness.level}`}>Readiness: {v.readiness.level === 'unknown' ? 'needs sleep or a check-in' : v.readiness.level}{v.readiness.why ? ` (${v.readiness.why})` : ''}</div>

          <Sec>{editing ? `Edit pain from ${dayLabel(editing.date, h.today).toLowerCase()}` : 'Something hurt?'}</Sec>
          <svg className="hl-map" viewBox="-14 0 288 290" role="group" aria-label="Body map - tap where it hurts">
            <Figure regions={FRONT} label="FRONT" x0={0} heat={heat} selected={selected} onPick={(r) => { setWhere(r.where); setSide(r.side); }} />
            <Figure regions={BACK} label="BACK" x0={146} heat={heat} selected={selected} onPick={(r) => { setWhere(r.where); setSide(r.side); }} />
          </svg>
          <div className="hl-two">
            <input className="hud-input" placeholder="where (tap the map or type)" value={where} onChange={(e) => { setWhere(e.target.value); if (UNSIDED.has(norm(e.target.value))) setSide(undefined); }} aria-label="Where it hurts" />
            <Chips label="Side" options={[...SIDES]} value={side as 'left' | 'right' | 'both' | undefined} onChange={(s) => setSide((cur) => (cur === s ? undefined : s))} />
          </div>
          <div className="hl-label">How bad?</div>
          <Scale label="Pain" from={1} to={10} value={severity} onChange={setSeverity} low="barely" high="worst" />
          <Chips label="How it feels" options={[...FEEL]} value={feel as typeof FEEL[number]['id'] | undefined} onChange={(f) => setFeel((cur) => (cur === f ? undefined : f))} />
          <Chips label="When" options={[...WHEN]} value={when as typeof WHEN[number]['id'] | undefined} onChange={(w) => setWhen((cur) => (cur === w ? undefined : w))} />
          <Chips multi label="Swelling" options={[{ id: 'swelling', text: 'It\'s swollen' }]} value={swelling ? ['swelling'] : []} onChange={() => setSwelling((s) => !s)} />
          <input className="hud-input" placeholder="what happened (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="What happened" />
          <div className="hl-row">
            <button className="hud-btn hud-btn--active" onClick={() => void save()}>{editing ? 'Update' : 'Log it'}</button>
            {editing && <button className="hud-btn" onClick={() => { h.setEditing(null); reset(); }}>Cancel</button>}
          </div>
        </section>

        <section className="hl-form">
          <Sec>Sore spots</Sec>
          {v.pain.areas.length ? v.pain.areas.map((a) => (
            <div key={a.key} className={`hl-area${a.active ? '' : ' is-gone'}`}>
              <div className="hl-area__h">
                <b>{a.side ? `${a.side} ` : ''}{a.where}</b>
                <span>{a.active ? `${a.latest.severity}/10` : 'gone'}{a.latest.status ? ` - ${a.latest.status}` : ''} | {dayLabel(a.latest.date, h.today)}</span>
                <Spark history={a.history} />
              </div>
              {a.active && (
                <div className="hl-row hl-row--tight">
                  <span className="hl-dim">Today it's:</span>
                  <button className="hl-mini" onClick={() => void followUp(a, 'better')}>Better</button>
                  <button className="hl-mini" onClick={() => void followUp(a, 'same')}>Same</button>
                  <button className="hl-mini" onClick={() => void followUp(a, 'worse')}>Worse</button>
                  <button className="hl-mini" onClick={() => void followUp(a, 'gone')}>Gone</button>
                </div>
              )}
            </div>
          )) : <Empty>Nothing hurting in the last four weeks.</Empty>}
          {v.pain.recent.length > 0 && (
            <>
              <div className="hl-label">Entries</div>
              <ul className="hl-entries">
                {v.pain.recent.slice(0, 8).map((p: PainEntry) => (
                  <li key={p.id} className="hl-entry">
                    <span className="hl-entry__d">{dayLabel(p.date, h.today)}</span>
                    <span className="hl-entry__t">{p.side ? `${p.side} ` : ''}{p.where}, {p.severity}/10{p.feel ? `, ${p.feel}` : ''}{p.swelling ? ', swollen' : ''}{p.status ? ` (${p.status})` : ''}{p.note ? ` - ${p.note}` : ''}</span>
                    <span />
                    <button className="hl-mini" onClick={() => h.go('body', { kind: 'pain', entry: p })}>Edit</button>
                    <button className="hl-mini" onClick={() => void h.remove('pain', p, 'that entry')}>Delete</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Sec>The rules</Sec>
          <ul className="hl-tips">
            <li><b>Any knock to the head:</b> stop playing and tell a parent or your coach today, even if you feel fine.</li>
            <li><b>Sharp pain, swelling, limping, or pain that isn't getting better:</b> stop training on it and tell a parent, your coach or a physio.</li>
            <li><b>Chest pain, fainting or trouble breathing:</b> an adult right now - 911 if it's bad.</li>
            <li>Health tracks it and helps you rest smart. It never diagnoses.</li>
          </ul>
          <button className="link-btn" onClick={() => h.ask('Asclepius, ')}>Ask Asclepius</button>
        </section>
      </div>
    </div>
  );
}
