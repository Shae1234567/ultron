import { useEffect, useRef, useState } from 'react';
import { playConfirm } from '../../services/sfx';
import { GYM_RULES, nextTarget, setsText, targetText, workoutById, type LibExercise, type Workout } from '../../../electron/departments/health/workouts';
import type { GymExercise } from '../../types';
import { forWeek } from '../../../electron/departments/health/program';
import { useHealth } from './context';
import { EFFORT_WORDS, Scale, Sec, Stepper } from './ui';

/*
 * Heracles' gym logger. Pick a workout from the library (or start empty), tick sets off as
 * you go - each tick starts the rest timer for that exercise - and see last time's numbers
 * with the next small step beside every exercise. A workout in progress survives closing
 * Health or Ultron (it is kept on this PC until finished or thrown away).
 */

const KEY = 'ultron.health.workout';

interface LiveSet { reps: string; kg: string; secs: string; done: boolean }
interface LiveExercise { name: string; lib?: LibExercise; sets: LiveSet[] }
interface Live { workoutId?: string; name: string; kind: string; effort: number; startedAt: number; exercises: LiveExercise[] }

export function activeWorkout(): Live | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Live) : null;
  } catch {
    return null;
  }
}
function keep(l: Live | null): void {
  try {
    if (l) localStorage.setItem(KEY, JSON.stringify(l));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked - the session just won't survive a restart */ }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const blankSet = (): LiveSet => ({ reps: '', kg: '', secs: '', done: false });

export function newLive(w?: Workout): Live {
  return {
    workoutId: w?.id,
    name: w?.name ?? 'Gym session',
    kind: w?.kind ?? 'gym',
    effort: w?.effort ?? 6,
    startedAt: Date.now(),
    exercises: (w?.exercises ?? []).map((e) => ({ name: e.name, lib: e, sets: Array.from({ length: e.sets }, blankSet) })),
  };
}

/** A library workout, an empty session - or a program session with this program week's sets. */
export function startWorkout(id?: string, week?: number): void {
  const w = id ? workoutById(id) : undefined;
  keep(newLive(w && week ? forWeek(w, week) : w));
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function RestTimer({ rest, onDone, onAdd, onSkip }: { rest: { until: number; total: number; label: string }; onDone: () => void; onAdd: () => void; onSkip: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [rest.until]);
  const left = rest.until - now;
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      playConfirm();
      onDone();
    }
  }, [left <= 0]);
  const share = Math.max(0, Math.min(1, left / rest.total));
  return (
    <div className={`hl-rest${left <= 0 ? ' is-done' : ''}`} role="timer" aria-live="polite">
      <div className="hl-rest__k">Rest - {rest.label}</div>
      <div className="hl-rest__t">{left > 0 ? mmss(left) : 'Go'}</div>
      <div className="hl-rest__bar"><i style={{ transform: `scaleX(${share})` }} /></div>
      <button className="hl-mini" onClick={onAdd}>+30 s</button>
      <button className="hl-mini" onClick={onSkip}>{left > 0 ? 'Skip' : 'Close'}</button>
    </div>
  );
}

export function GymSession({ onLeave }: { onLeave: () => void }) {
  const h = useHealth();
  const [live, setLive] = useState<Live | null>(() => activeWorkout());
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState<{ until: number; total: number; label: string } | null>(null);
  const [addName, setAddName] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [minutes, setMinutes] = useState(45);
  const [effort, setEffort] = useState<number | undefined>(live?.effort);
  const [note, setNote] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const update = (fn: (l: Live) => Live) => setLive((cur) => { if (!cur) return cur; const next = fn(cur); keep(next); return next; });

  if (!live) return null;
  const elapsed = now - live.startedAt;

  const setField = (ei: number, si: number, field: keyof LiveSet, value: string | boolean) =>
    update((l) => ({ ...l, exercises: l.exercises.map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.map((s, j) => (j !== si ? s : { ...s, [field]: value })) })) }));

  const tick = (ei: number, si: number) => {
    const ex = live.exercises[ei];
    const set = ex.sets[si];
    const last = h.v.lastSets[norm(ex.name)]?.sets;
    const timed = Boolean(ex.lib?.secs);
    // Ticking an empty set takes the target (or last time's numbers) as what was done.
    const filled: LiveSet = {
      ...set,
      reps: set.reps || (timed ? '' : String(last?.[si]?.reps ?? ex.lib?.reps?.[1] ?? '')),
      kg: set.kg || (last?.[si]?.kg ? String(last[si].kg) : ''),
      secs: set.secs || (timed ? String(last?.[si]?.secs ?? ex.lib?.secs ?? '') : ''),
      done: !set.done,
    };
    update((l) => ({ ...l, exercises: l.exercises.map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.map((s, j) => (j !== si ? s : filled)) })) }));
    if (filled.done) {
      const secs = ex.lib?.rest ?? 60;
      setRest({ until: Date.now() + secs * 1000, total: secs * 1000, label: ex.name });
    }
  };

  const addExercise = () => {
    const name = addName.trim();
    if (!name) return;
    update((l) => ({ ...l, exercises: [...l.exercises, { name, sets: [blankSet(), blankSet(), blankSet()] }] }));
    setAddName('');
  };

  const exercisesDone = (): GymExercise[] => live.exercises.map((e) => ({
    name: e.name,
    sets: e.sets.filter((s) => s.done || s.reps || s.secs).map((s) => ({
      ...(Number(s.reps) > 0 ? { reps: Number(s.reps) } : {}),
      ...(Number(s.kg) > 0 ? { kg: Number(s.kg) } : {}),
      ...(Number(s.secs) > 0 ? { secs: Number(s.secs) } : {}),
    })).filter((s) => s.reps || s.secs),
  })).filter((e) => e.sets.length);

  const finish = async () => {
    const exercises = exercisesDone();
    const r = await h.log('training', { kind: live.kind, what: live.name, minutes, effort: effort ?? live.effort, exercises, workout: live.workoutId, note }, `${live.name} logged.`);
    if (r.ok) { keep(null); setLive(null); onLeave(); }
  };
  const discard = () => {
    if (!window.confirm('Throw this workout away? Nothing from it will be logged.')) return;
    keep(null);
    setLive(null);
    onLeave();
  };
  const doneSets = live.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const allSets = live.exercises.reduce((n, e) => n + e.sets.length, 0);

  return (
    <div className="hl-page hl-gym">
      <div className="hl-gym__head">
        <div>
          <div className="hl-gym__k">Workout in progress{live.workoutId ? ` - ${workoutById(live.workoutId)?.by ?? ''}` : ''}</div>
          <div className="hl-gym__n">{live.name}</div>
        </div>
        <div className="hl-gym__clock" aria-label="Time so far">{mmss(elapsed)}</div>
        <div className="hl-gym__count">{doneSets}/{allSets} sets</div>
        <div className="hl-row">
          <button className="hud-btn hud-btn--active" onClick={() => { setMinutes(Math.max(5, Math.round(elapsed / 60_000))); setFinishing(true); }}>Finish</button>
          <button className="hud-btn" onClick={onLeave}>Keep going later</button>
          <button className="hud-btn hud-btn--danger" onClick={discard}>Discard</button>
        </div>
      </div>

      <div className="hl-note hl-note--rules">
        {GYM_RULES[1]} <button className="link-btn" onClick={() => setRulesOpen((o) => !o)}>{rulesOpen ? 'Less' : 'All the rules'}</button>
        {rulesOpen && <ul>{GYM_RULES.map((r) => <li key={r}>{r}</li>)}</ul>}
      </div>

      {finishing && (
        <section className="hl-finish">
          <Sec>Finish {live.name}</Sec>
          <div className="hl-two">
            <div><div className="hl-label">Minutes</div><Stepper label="Minutes" value={minutes} onChange={setMinutes} step={5} min={5} max={240} unit="min" /></div>
            <div><div className="hl-label">How hard was it overall?</div><Scale label="Effort" from={1} to={10} value={effort} onChange={setEffort} words={EFFORT_WORDS} low="easy" high="max" /></div>
          </div>
          <input className="hud-input" placeholder="note (optional): how it felt, anything that hurt" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Workout note" />
          <div className="hl-row">
            <button className="hud-btn hud-btn--active" onClick={() => void finish()}>Log it</button>
            <button className="hud-btn" onClick={() => setFinishing(false)}>Back</button>
          </div>
        </section>
      )}

      {live.exercises.map((e, ei) => {
        const last = h.v.lastSets[norm(e.name)] ?? null;
        const timed = Boolean(e.lib?.secs);
        const weighted = !e.lib || e.lib.load === 'dumbbells';
        const dist = Boolean(e.lib?.dist);
        const allDone = e.sets.length > 0 && e.sets.every((s) => s.done);
        return (
          <section key={`${e.name}-${ei}`} className={`hl-ex${allDone ? ' is-done' : ''}`}>
            <div className="hl-ex__head">
              <div className="hl-ex__n">{e.name}</div>
              {e.lib && <div className="hl-ex__t">{targetText(e.lib)}{e.lib.rest ? ` | rest ${e.lib.rest} s` : ''}</div>}
            </div>
            {e.lib?.cue && <div className="hl-ex__cue">{e.lib.cue}</div>}
            {e.lib?.why && <div className="hl-ex__why">{e.lib.why}</div>}
            <div className="hl-ex__last">
              {last ? <>Last time ({last.date.slice(5)}): <b>{setsText(last.sets)}</b>. </> : null}
              {nextTarget(e.lib, last)}
            </div>
            <div className="hl-sets" role="table" aria-label={`${e.name} sets`}>
              {e.sets.map((s, si) => {
                const ls = last?.sets[si];
                return (
                  <div key={si} className={`hl-set${s.done ? ' is-done' : ''}`} role="row">
                    <span className="hl-set__n">{si + 1}</span>
                    {dist ? (
                      <span className="hl-set__dist">{e.lib?.dist}</span>
                    ) : timed ? (
                      <label className="hl-set__f"><input inputMode="numeric" value={s.secs} placeholder={String(ls?.secs ?? e.lib?.secs ?? '')} onChange={(ev) => setField(ei, si, 'secs', ev.target.value.replace(/\D/g, ''))} aria-label={`Set ${si + 1} seconds`} /><span>s</span></label>
                    ) : (
                      <label className="hl-set__f"><input inputMode="numeric" value={s.reps} placeholder={String(ls?.reps ?? e.lib?.reps?.[1] ?? '')} onChange={(ev) => setField(ei, si, 'reps', ev.target.value.replace(/\D/g, ''))} aria-label={`Set ${si + 1} reps`} /><span>reps</span></label>
                    )}
                    {weighted && !timed && !dist && (
                      <label className="hl-set__f"><input inputMode="decimal" value={s.kg} placeholder={ls?.kg ? String(ls.kg) : 'kg'} onChange={(ev) => setField(ei, si, 'kg', ev.target.value.replace(/[^\d.]/g, ''))} aria-label={`Set ${si + 1} kilograms`} /><span>kg</span></label>
                    )}
                    <button className={`hl-tick${s.done ? ' is-on' : ''}`} aria-pressed={s.done} aria-label={`Set ${si + 1} done`} onClick={() => tick(ei, si)}>{s.done ? 'Done' : 'Tick'}</button>
                  </div>
                );
              })}
            </div>
            <div className="hl-row">
              <button className="hl-mini" onClick={() => update((l) => ({ ...l, exercises: l.exercises.map((x, i) => (i !== ei ? x : { ...x, sets: [...x.sets, blankSet()] })) }))}>+ set</button>
              {e.sets.length > 1 && <button className="hl-mini" onClick={() => update((l) => ({ ...l, exercises: l.exercises.map((x, i) => (i !== ei ? x : { ...x, sets: x.sets.slice(0, -1) })) }))}>- set</button>}
              <button className="hl-mini" onClick={() => update((l) => ({ ...l, exercises: l.exercises.filter((_, i) => i !== ei) }))}>Remove</button>
            </div>
          </section>
        );
      })}

      <section className="hl-form">
        <Sec>Add an exercise</Sec>
        <div className="hl-row">
          <input className="hud-input" placeholder="e.g. calf raises" value={addName} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addExercise(); }} aria-label="Exercise name" />
          <button className="hud-btn" disabled={!addName.trim()} onClick={addExercise}>Add</button>
        </div>
      </section>

      {rest && <RestTimer rest={rest} onDone={() => undefined} onAdd={() => setRest((r) => (r ? { ...r, until: Math.max(Date.now(), r.until) + 30_000, total: r.total + 30_000 } : r))} onSkip={() => setRest(null)} />}
    </div>
  );
}
