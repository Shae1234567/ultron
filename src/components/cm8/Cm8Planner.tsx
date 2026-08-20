import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { buildPlan, fmt, toTimeInput, type Plan, type PlanEvent } from '../../cm8/planner';
import { planIcs, downloadIcs, scheduleReminders, clearReminders, notificationsAllowed } from '../../cm8/sleep';
import { plans, todayKey, tomorrowKey, prettyDate, subscribe, type BusyBlock } from '../../cm8/memory';
import type { TrainingLoad } from '../../cm8/nutrition';

const LOADS: TrainingLoad[] = ['full', 'light', 'match', 'rest'];
const HOMEWORK = [0, 30, 60, 90, 120, 180];

const EVENT_TONE: Record<PlanEvent['type'], string> = {
  sleep: 'var(--cyan-soft)',
  busy: 'var(--dim)',
  meal: 'var(--green)',
  train: 'var(--cyan)',
  focus: 'var(--white)',
};

const blankBusy = (): BusyBlock => ({ label: '', start: 16 * 60, end: 17 * 60 });

export function Cm8Planner() {
  const [target, setTarget] = useState<'today' | 'tomorrow'>('today');
  const [sleptAt, setSleptAt] = useState('23:00');
  const [wokeAt, setWokeAt] = useState('07:00');
  const [wakeTarget, setWakeTarget] = useState('07:00');
  const [training, setTraining] = useState<TrainingLoad>('full');
  const [homework, setHomework] = useState(60);
  const [busy, setBusy] = useState<BusyBlock[]>([{ label: 'School', start: 8 * 60 + 30, end: 15 * 60 + 30 }]);
  const [notes, setNotes] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reminderNote, setReminderNote] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const key = target === 'tomorrow' ? tomorrowKey() : todayKey();

  /* Loading a saved day is what makes "set tomorrow up tonight" work. */
  const loadInto = useCallback((dateKey: string) => {
    const p = plans.get(dateKey);
    if (!p) {
      setSleptAt('23:00'); setWokeAt('07:00'); setWakeTarget('07:00');
      setTraining('full'); setHomework(60); setNotes('');
      setBusy([{ label: 'School', start: 8 * 60 + 30, end: 15 * 60 + 30 }]);
      return;
    }
    setSleptAt(p.sleptAt || '23:00');
    setWokeAt(p.wokeAt || '07:00');
    setWakeTarget(p.wakeTarget || '07:00');
    setTraining((p.training as TrainingLoad) || 'full');
    setHomework(typeof p.homework === 'number' ? p.homework : 60);
    setNotes(p.notes || '');
    setBusy(p.busy && p.busy.length ? p.busy : [blankBusy()]);
  }, []);

  const form = useMemo(() => ({
    sleptAt, wokeAt, wakeTarget, training, homework,
    busy: busy.filter((b) => b.end > b.start).map((b) => ({ ...b, label: b.label.trim() || 'Busy' })),
    notes,
  }), [sleptAt, wokeAt, wakeTarget, training, homework, busy, notes]);

  const build = () => {
    plans.set(key, form);           // building a day is also how it is remembered
    setPlan(buildPlan(form));
    setReminderNote('');
  };
  const saveOnly = () => { plans.set(key, form); setReminderNote(`Saved for ${prettyDate(key).toLowerCase()}.`); };

  const upcoming = useMemo(() => plans.upcoming(), [tick]);

  const arm = async () => {
    if (!plan) return;
    if (!(await notificationsAllowed())) {
      setReminderNote('Notifications are blocked, so use the calendar file instead — it works with the app closed.');
      return;
    }
    const n = scheduleReminders(plan);
    setReminderNote(n
      ? `${n} reminders queued for the rest of today. They only fire while Atlas is open.`
      : 'Nothing left today to remind you about.');
  };

  return (
    <div className="cm8-food">
      {/* ── inputs ── */}
      <div>
        <div className="cm8-card">
          <div className="label-xs" style={{ marginBottom: 8 }}>Planning for</div>
          <div className="cm8-tags">
            {(['today', 'tomorrow'] as const).map((t) => (
              <button
                key={t}
                className={'hud-btn' + (t === target ? ' hud-btn--active' : '')}
                onClick={() => { setTarget(t); loadInto(t === 'tomorrow' ? tomorrowKey() : todayKey()); }}
              >{t}</button>
            ))}
          </div>

          <div className="label-xs" style={{ margin: '12px 0 6px' }}>Last night · woke · alarm</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="hud-input" type="time" value={sleptAt} onChange={(e) => setSleptAt(e.target.value)} style={{ padding: 6 }} />
            <input className="hud-input" type="time" value={wokeAt} onChange={(e) => setWokeAt(e.target.value)} style={{ padding: 6 }} />
            <input className="hud-input" type="time" value={wakeTarget} onChange={(e) => setWakeTarget(e.target.value)} style={{ padding: 6 }} />
          </div>

          <div className="label-xs" style={{ margin: '12px 0 6px' }}>Training</div>
          <div className="cm8-tags">
            {LOADS.map((l) => (
              <button key={l} className={'hud-btn' + (l === training ? ' hud-btn--active' : '')} onClick={() => setTraining(l)}>{l}</button>
            ))}
          </div>

          <div className="label-xs" style={{ margin: '12px 0 6px' }}>Homework</div>
          <div className="cm8-tags">
            {HOMEWORK.map((h) => (
              <button key={h} className={'hud-btn' + (h === homework ? ' hud-btn--active' : '')} onClick={() => setHomework(h)}>
                {h === 0 ? 'None' : h + 'm'}
              </button>
            ))}
          </div>

          <div className="label-xs" style={{ margin: '12px 0 6px' }}>When are you busy {target}?</div>
          {busy.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
              <input
                className="hud-input" placeholder="What is it?" value={b.label}
                style={{ flex: 1, padding: 6 }}
                onChange={(e) => setBusy(busy.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <input
                className="hud-input" type="time" value={toTimeInput(b.start)} style={{ padding: 6 }}
                onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); setBusy(busy.map((x, j) => (j === i ? { ...x, start: h * 60 + m } : x))); }}
              />
              <input
                className="hud-input" type="time" value={toTimeInput(b.end)} style={{ padding: 6 }}
                onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); setBusy(busy.map((x, j) => (j === i ? { ...x, end: h * 60 + m } : x))); }}
              />
              <button className="hud-btn" onClick={() => setBusy(busy.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button className="hud-btn" onClick={() => setBusy([...busy, blankBusy()])}>+ Block</button>

          <div className="label-xs" style={{ margin: '12px 0 6px' }}>Anything I should know?</div>
          <textarea
            className="hud-input"
            style={{ width: '100%', minHeight: 54, resize: 'vertical', padding: 8 }}
            placeholder="hamstrings are tight, math test Thursday"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="hud-btn hud-btn--active" onClick={build}>Build my day</button>
            <button className="hud-btn" onClick={saveOnly}>Save without building</button>
          </div>
        </div>

        <div className="cm8-card" style={{ marginTop: 12 }}>
          <div className="label-xs" style={{ marginBottom: 6 }}>Saved schedules</div>
          {upcoming.length === 0 && <p className="empty-note">Nothing saved yet.</p>}
          {upcoming.map(({ date, plan: p }) => (
            <div className="cm8-food__row" key={date}>
              <span className="cm8-food__type">{prettyDate(date)}</span>
              <span style={{ color: 'var(--dim)' }}>
                {(p.busy || []).length} blocks · {p.training} · up at {p.wakeTarget || '—'}
              </span>
              <button className="hud-btn" onClick={() => { setTarget(date === tomorrowKey() ? 'tomorrow' : 'today'); loadInto(date); }}>Load</button>
              <button className="cm8-food__del" onClick={() => plans.clear(date)} aria-label="Delete">×</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── the built day ── */}
      <div>
        {!plan && (
          <div className="cm8-card">
            <p className="empty-note">
              Answer the questions and your whole day lands here — bedtime, wake time,
              training window, every meal, and the blocks in between.
            </p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {plan && (
            <motion.div
              key={plan.events.length + '-' + plan.bedtime}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 0.8, 0.3, 1] }}
            >
              <div className="cm8-card">
                <div className="label-xs" style={{ marginBottom: 8 }}>
                  Lights out {fmt(plan.bedtime)} · alarm {fmt(plan.wakeTarget)} · {plan.cycles} cycles
                </div>

                {plan.trainWarning && (
                  <div className="cm8-verdict cm8-verdict--low" style={{ marginBottom: 10 }}>
                    <div className="cm8-verdict__body"><b>No room for training today:</b> {plan.trainWarning}</div>
                  </div>
                )}
                {plan.hwWarning && (
                  <div className="cm8-verdict" style={{ marginBottom: 10 }}>
                    <div className="cm8-verdict__body"><b>Heads up on homework:</b> {plan.hwWarning}</div>
                  </div>
                )}
                {plan.noteAdvice && (
                  <div className="cm8-verdict" style={{ marginBottom: 10 }}>
                    <div className="cm8-verdict__body"><b>On what you told me:</b> {plan.noteAdvice}</div>
                  </div>
                )}

                <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.03 } } }}>
                  {plan.events.map((e, i) => (
                    <motion.div
                      className="cm8-row" key={e.title + i}
                      variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } }}
                    >
                      <b style={{ color: EVENT_TONE[e.type] }}>{fmt(e.start)}</b>
                      <span>
                        <b style={{ color: 'var(--white)', letterSpacing: 0 }}>{e.title}</b>
                        {e.badge && <span className="chip chip--muted" style={{ marginLeft: 6 }}>{e.badge}</span>}
                        <br />{e.note}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>

                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="hud-btn" onClick={arm}>Remind me</button>
                  <button className="hud-btn" onClick={() => { downloadIcs(planIcs(plan), 'shae-cm8-day.ics'); setReminderNote('Calendar file saved — open it to add the whole day, alarms included.'); }}>
                    Calendar file
                  </button>
                  <button className="hud-btn" onClick={() => { clearReminders(); setReminderNote('Reminders cleared.'); }}>Clear</button>
                </div>
                {reminderNote && <p className="cm8-ex__note" style={{ marginTop: 8 }}>{reminderNote}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
