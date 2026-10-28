import { useEffect, useState } from 'react';
import { ultron } from '../../services/bridge';
import { WORKOUTS, sessionTotals } from '../../../electron/departments/health/workouts';
import type { LoadPoint, TrainingEntry, TrainingKind } from '../../types';
import { useHealth } from './context';
import { GymSession, activeWorkout, startWorkout } from './GymSession';
import { ProgramCard } from './ProgramCard';
import { Chips, EFFORT_WORDS, Empty, Scale, Sec, Stepper, dayLabel, dayName } from './ui';

/*
 * Achilles' and Heracles' page: log a practice, game or run in three taps, run a gym workout
 * set by set, see the training load for two weeks against the month, and keep the weekly
 * schedule (practices, games) that the rest of Health plans around.
 */

const KINDS: { id: TrainingKind; text: string }[] = [
  { id: 'soccer', text: 'Soccer' }, { id: 'badminton', text: 'Badminton' }, { id: 'gym', text: 'Gym' }, { id: 'run', text: 'Run' }, { id: 'other', text: 'Other' },
];
const WHAT: Record<TrainingKind, string[]> = {
  soccer: ['Practice', 'Game', 'Skills', 'Futsal', 'Pickup'],
  badminton: ['Practice', 'Match', 'Footwork'],
  gym: ['Legs', 'Upper body', 'Full body', 'Prehab'],
  run: ['Easy run', 'Sprints', 'Intervals'],
  other: ['Mobility', 'Swim', 'Bike', 'PE class'],
};
const SCHED_KINDS = [{ id: 'practice', text: 'Practice' }, { id: 'game', text: 'Game' }, { id: 'gym', text: 'Gym' }, { id: 'other', text: 'Other' }] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function LoadBars({ days }: { days: LoadPoint[] }) {
  // One block is 100 load (about 15 minutes at effort 7); hard days carry a cap.
  const ROWS = 12;
  const max = Math.max(1200, ...days.map((d) => d.load));
  const per = max / ROWS;
  return (
    <div className="hl-load" role="img" aria-label="Training load per day">
      {days.map((d, i) => {
        const filled = d.load ? Math.max(1, Math.round(d.load / per)) : 0;
        return (
          <div key={d.date} className="hl-load__c" title={`${d.date}: load ${d.load}, ${d.minutes} min${d.kinds.length ? ` (${d.kinds.join(', ')})` : ''}`}>
            <div className="hl-load__stack">
              {Array.from({ length: ROWS }, (_, j) => ROWS - j).map((r) => <i key={r} className={r <= filled ? (d.hard ? 'hard' : 'on') : ''} style={{ ['--i' as string]: r + i * 2 }} />)}
            </div>
            <span className="hl-load__v">{d.load || ''}</span>
            <span className="hl-load__d">{dayName(d.date).slice(0, 2)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ratioText(ratio: number | null): { text: string; tone: 'ok' | 'warn' | 'low' } {
  if (ratio === null) return { text: 'Log a few weeks and this compares each week to your usual.', tone: 'ok' };
  if (ratio >= 1.5) return { text: `This week is ${ratio}x your usual load - a jump that size is when injuries happen. Keep the next days lighter.`, tone: 'warn' };
  if (ratio >= 1.2) return { text: `This week is ${ratio}x your usual - a solid build. Don't add more on top.`, tone: 'ok' };
  if (ratio <= 0.6) return { text: `This week is ${ratio}x your usual - a lighter week. Fine for recovery; ease back in rather than jumping straight up.`, tone: 'low' };
  return { text: `This week is ${ratio}x your usual - steady.`, tone: 'ok' };
}

export function TrainPage({ start }: { start?: string }) {
  const h = useHealth();
  const { v } = h;
  const editing = h.editing?.kind === 'training' ? h.editing.entry : null;
  const [gym, setGym] = useState(() => Boolean(activeWorkout()));
  const [kind, setKind] = useState<TrainingKind>('soccer');
  const [what, setWhat] = useState('Practice');
  const [minutes, setMinutes] = useState(90);
  const [effort, setEffort] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);

  // Pre-fill from a quick button ("+ Practice") or from the entry being edited.
  useEffect(() => {
    if (editing) {
      setKind(editing.kind); setWhat(editing.what ?? ''); setMinutes(editing.minutes); setEffort(editing.effort); setNote(editing.note ?? '');
      return;
    }
    if (start === 'gym') { setPicking(true); return; }
    if (start === 'program' && v.program?.next && !activeWorkout()) { startWorkout(v.program.next.id, v.program.week); setGym(true); return; }
    if (start === 'practice' || start === 'game') {
      const planned = v.schedule.today.find((s) => s.kind === start);
      setKind('soccer'); setWhat(start === 'game' ? 'Game' : 'Practice');
      setMinutes(planned?.minutes ?? (start === 'game' ? 70 : 90));
      setEffort(start === 'game' ? 8 : undefined);
    }
  }, [editing?.id, start]);

  if (gym) return <GymSession onLeave={() => setGym(false)} />;

  const save = async () => {
    if (!effort) { h.toast('How hard was it? Pick an effort from 1 to 10.', true); return; }
    const p = { kind, what, minutes, effort, note, exercises: editing?.exercises, workout: editing?.workout };
    const r = editing ? await h.edit('training', editing.id, { ...p, date: editing.date }, 'Updated.') : await h.log('training', p, `${what || kind} logged.`);
    if (r.ok && !editing) { setNote(''); setEffort(undefined); }
  };
  const ratio = ratioText(v.training.ratio);
  const week = v.recent.training.filter((t) => t.date > dateMinus(h.date, 7) && t.date <= h.date).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);

  return (
    <div className="hl-page">
      <ProgramCard onStart={(id, wk) => { startWorkout(id, wk); setGym(true); }} />

      <div className="hl-cols">
        <section className="hl-form">
          <Sec>{editing ? `Edit ${dayLabel(editing.date, h.today).toLowerCase()}'s session` : 'Log a session'}</Sec>
          <Chips label="Sport" options={KINDS} value={kind} onChange={(k) => { setKind(k); setWhat(WHAT[k][0]); }} />
          <Chips label="What" options={WHAT[kind].map((w) => ({ id: w, text: w }))} value={what} onChange={setWhat} />
          <div className="hl-label">Minutes</div>
          <Stepper label="Minutes" value={minutes} onChange={setMinutes} step={5} min={5} max={360} unit="min" presets={[30, 45, 60, 75, 90, 120]} />
          <div className="hl-label">Effort - how hard was it, all in?</div>
          <Scale label="Effort" from={1} to={10} value={effort} onChange={setEffort} low="easy" high="max" words={EFFORT_WORDS} />
          {effort ? <div className={`hl-sum${effort >= 7 ? ' is-low' : ' is-good'}`}>Load {minutes * effort} ({minutes} min x effort {effort}){effort >= 7 ? ' - a hard day' : ''}</div> : null}
          <input className="hud-input" placeholder="note (optional): coach said, what you worked on" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Session note" />
          <div className="hl-row">
            <button className="hud-btn hud-btn--active" onClick={() => void save()}>{editing ? 'Update' : 'Log it'}</button>
            {editing && <button className="hud-btn" onClick={() => h.setEditing(null)}>Cancel</button>}
          </div>
        </section>

        <section className="hl-form">
          <Sec right={<span className="hl-by">Heracles</span>}>Gym and drills</Sec>
          {!picking ? (
            <>
              <div className="hl-dim">Follow a workout set by set: last time's numbers next to each exercise, the rest timer starts when you tick a set.</div>
              <div className="hl-row">
                <button className="hud-btn hud-btn--active" onClick={() => setPicking(true)}>Start a workout</button>
                <button className="hud-btn" onClick={() => { startWorkout(); setGym(true); }}>Empty session</button>
              </div>
            </>
          ) : (
            <div className="hl-lib">
              {WORKOUTS.filter((w) => !w.program).map((w) => (
                <button key={w.id} className="hl-lib__w" onClick={() => { startWorkout(w.id); setGym(true); setPicking(false); }}>
                  <span className="hl-lib__n">{w.name}</span>
                  <span className="hl-lib__m">{w.minutes} min | {w.where} | {w.by}</span>
                  <span className="hl-lib__f">{w.focus}</span>
                  <span className="hl-lib__w2">{w.when}</span>
                </button>
              ))}
              <button className="hud-btn" onClick={() => setPicking(false)}>Back</button>
            </div>
          )}
        </section>
      </div>

      <section>
        <Sec>Load - last 14 days</Sec>
        <LoadBars days={v.training.days} />
        <div className="hl-stats">
          <div><b>{v.training.sessions7}</b><span>sessions, 7 days</span></div>
          <div><b>{v.training.minutes7}</b><span>minutes, 7 days</span></div>
          {v.training.weeks.map((w, i) => <div key={i}><b>{w}</b><span>{['3 weeks ago', '2 weeks ago', 'last week', 'this week'][i]}</span></div>)}
        </div>
        <div className={`hl-note hl-note--${ratio.tone}`}>{ratio.text}</div>
      </section>

      <section>
        <Sec>This week's sessions</Sec>
        {week.length ? <ul className="hl-entries">{week.map((t) => <SessionRow key={t.id} t={t} />)}</ul> : <Empty>No sessions logged in the last 7 days.</Empty>}
      </section>

      <Schedule />
    </div>
  );
}

function dateMinus(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function SessionRow({ t }: { t: TrainingEntry }) {
  const h = useHealth();
  const g = sessionTotals(t.exercises);
  return (
    <li className="hl-entry">
      <span className="hl-entry__d">{dayLabel(t.date, h.today)}</span>
      <span className="hl-entry__t">{t.what || t.kind} - {t.minutes} min, effort {t.effort}{g.exercises ? ` | ${g.exercises} exercises, ${g.sets} sets` : ''}{t.note ? ` | ${t.note}` : ''}</span>
      <span className="hl-entry__v">{t.minutes * t.effort}</span>
      <button className="hl-mini" onClick={() => h.go('train', { kind: 'training', entry: t })}>Edit</button>
      <button className="hl-mini" onClick={() => void h.remove('training', t, 'that session')}>Delete</button>
    </li>
  );
}

function Schedule() {
  const h = useHealth();
  const [kind, setKind] = useState<'practice' | 'game' | 'gym' | 'other'>('practice');
  const [day, setDay] = useState(2);
  const [start, setStart] = useState('18:00');
  const [mins, setMins] = useState(90);
  const [sport, setSport] = useState('soccer');
  const add = async () => {
    const r = await ultron.health.scheduleAdd({ kind, sport, day, start, minutes: mins });
    if (!r.ok) h.toast(r.error, true);
    else h.toast('Added to the weekly schedule.');
  };
  return (
    <section>
      <Sec>Weekly schedule</Sec>
      {h.v.schedule.all.length ? (
        <ul className="hl-entries">
          {h.v.schedule.all.map((s) => (
            <li key={s.id} className="hl-entry">
              <span className="hl-entry__d">{DAYS[s.day]} {s.start}</span>
              <span className="hl-entry__t">{s.kind}{s.sport ? ` (${s.sport})` : ''}, {s.minutes} min{s.note ? ` - ${s.note}` : ''}</span>
              <span />
              <button className="hl-mini" onClick={() => void ultron.health.scheduleRemove(s.id).then((r) => { if (!r.ok) h.toast(r.error, true); })}>Remove</button>
            </li>
          ))}
        </ul>
      ) : <Empty>Nothing yet. Add your practices and games once - Health plans sleep, food and gym days around them.</Empty>}
      <div className="hl-sched">
        <Chips label="Kind" options={SCHED_KINDS.map((k) => ({ id: k.id, text: k.text }))} value={kind} onChange={setKind} />
        <Chips label="Day" options={DAYS.map((d, i) => ({ id: String(i), text: d }))} value={String(day)} onChange={(d) => setDay(Number(d))} />
        <div className="hl-row">
          <input className="hud-input hl-time" type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
          <Stepper label="Minutes" value={mins} onChange={setMins} step={15} min={15} max={300} unit="min" />
          <input className="hud-input hl-short" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport" placeholder="sport" />
          <button className="hud-btn" onClick={() => void add()}>Add</button>
        </div>
      </div>
    </section>
  );
}
