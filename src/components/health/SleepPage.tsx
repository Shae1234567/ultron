import { useEffect, useMemo, useState } from 'react';
import { ultron } from '../../services/bridge';
import { useHealth } from './context';
import { Chips, Field, QUALITY_WORDS, Scale, Sec, dayLabel, dayName } from './ui';
import { bedtimesFor, fromMin, hm, hoursBetween, sleepInsights, toMin, wakeTimesFor } from './sleepPlan';
import type { NightPoint } from '../../types';

/*
 * Hypnos' page: log a night (the PC's guess pre-filled when there is one), plan tonight from
 * tomorrow's wake time, and see the last two weeks as the council's half-hour blocks.
 */

const TAGS = ['woke in the night', 'phone in bed', 'late game', 'nap today', 'hard to fall asleep', 'woke before alarm'] as const;

/** "Going to bed at": now, in the evening - but 22:00 during the day, when "now" would be silly. */
function bedDefault(): string {
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 18 * 60 || mins < 4 * 60 ? fromMin(Math.ceil(mins / 5) * 5) : '22:00';
}

export function NightBlocks({ nights, big }: { nights: NightPoint[]; big?: boolean }) {
  // Half-hour blocks from 5 to 11 hours; the 8-hour line is marked.
  const ROWS = 12;
  const goal = (8 - 5) * 2;
  return (
    <div className={`hl-nights${big ? ' hl-nights--big' : ''}`} role="img" aria-label={`Sleep, last ${nights.length} nights`}>
      {nights.map((n, i) => {
        const filled = n.hours === null ? 0 : Math.max(1, Math.min(ROWS, Math.round((n.hours - 5) * 2)));
        return (
          <div key={n.date} className="hl-nights__c" title={n.hours === null ? `${n.date}: not logged` : `${n.date}: ${hm(n.hours)} (${n.bed} - ${n.wake})`}>
            <div className="hl-nights__stack">
              {Array.from({ length: ROWS }, (_, j) => ROWS - j).map((r) => (
                <i key={r} className={`${r <= filled ? (n.hours !== null && n.hours >= 8 ? 'on' : 'low') : ''}${r === goal ? ' goal' : ''}`} style={{ ['--i' as string]: r + i * 2 }} />
              ))}
            </div>
            <span className="hl-nights__h">{n.hours === null ? '-' : n.hours.toFixed(1).replace(/\.0$/, '')}</span>
            <span className="hl-nights__d">{dayName(n.date).slice(0, 2)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SleepPage() {
  const h = useHealth();
  const { v } = h;
  const editing = h.editing?.kind === 'sleep' ? h.editing.entry : null;
  const existing = editing ?? v.sleep.entry ?? null;
  const g = h.date === h.today ? v.sleep.guess : null;

  const [bed, setBed] = useState(existing?.bed ?? g?.bed ?? '22:30');
  const [wake, setWake] = useState(existing?.wake ?? g?.wake ?? '07:00');
  const [quality, setQuality] = useState<number | undefined>(existing?.quality);
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const usingGuess = !existing && Boolean(g);

  useEffect(() => {
    setBed(existing?.bed ?? g?.bed ?? '22:30');
    setWake(existing?.wake ?? g?.wake ?? '07:00');
    setQuality(existing?.quality);
    setTags(existing?.tags ?? []);
    setNote(existing?.note ?? '');
  }, [existing?.id, h.date]);

  const hours = bed && wake ? hoursBetween(bed, wake) : 0;
  const save = async () => {
    setBusy(true);
    const p = { bed, wake, quality, tags, note, date: existing?.date ?? h.date, fromPc: usingGuess && bed === g?.bed && wake === g?.wake };
    if (existing) await h.edit('sleep', existing.id, p, 'Sleep updated.');
    else await h.log('sleep', p, 'Sleep logged.');
    setBusy(false);
  };

  // The planner starts from his usual wake time.
  const usualWake = useMemo(() => {
    const w = v.sleep.nights.filter((n) => n.wake).map((n) => toMin(n.wake!));
    if (!w.length) return '07:00';
    return fromMin(Math.round(w.sort((a, b) => a - b)[Math.floor(w.length / 2)] / 5) * 5);
  }, [v.sleep.nights]);
  const [planWake, setPlanWake] = useState(usualWake);
  const [planBed, setPlanBed] = useState(bedDefault());
  const insights = sleepInsights(v.sleep.nights.slice(-7), v.sleep.spread7);
  const n7 = v.sleep.nights.slice(-7).filter((n) => n.hours !== null);

  return (
    <div className="hl-page">
      <div className="hl-cols">
        <section className="hl-form">
          <Sec>{`${(existing?.date ?? h.date) === h.today ? 'Last night' : `The night before ${dayLabel(existing?.date ?? h.date, h.today)}`}${existing ? ' - logged' : ''}`}</Sec>
          {usingGuess && g && (
            <div className="hl-note">Pre-filled from the PC: last used {g.pcOff}, first used {g.pcOn}. It can't see a phone in bed - fix the times if they're off.</div>
          )}
          <div className="hl-two">
            <Field label="Went to bed"><input className="hud-input hl-time" type="time" value={bed} onChange={(e) => setBed(e.target.value)} aria-label="Bedtime" /></Field>
            <Field label="Woke up"><input className="hud-input hl-time" type="time" value={wake} onChange={(e) => setWake(e.target.value)} aria-label="Wake time" /></Field>
          </div>
          <div className={`hl-sum${hours >= 8 ? ' is-good' : hours > 0 ? ' is-low' : ''}`}>{hours ? `${hm(hours)} of sleep${hours < 8 ? ` - ${hm(8 - hours)} under 8` : hours > 10.5 ? ' - long; check the times' : ''}` : ''}</div>
          <div className="hl-label">How did you sleep?</div>
          <Scale label="Sleep quality" value={quality} onChange={setQuality} low="awful" high="great" words={QUALITY_WORDS} />
          <div className="hl-label">Anything else?</div>
          <Chips multi label="Sleep notes" options={TAGS.map((t) => ({ id: t, text: t }))} value={tags}
            onChange={(t) => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))} />
          <input className="hud-input" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Sleep note" />
          <div className="hl-row">
            <button className="hud-btn hud-btn--active" disabled={busy || !bed || !wake} onClick={() => void save()}>{existing ? 'Update' : 'Log sleep'}</button>
            {existing && <button className="hud-btn hud-btn--danger" onClick={() => void h.remove('sleep', existing, 'that night')}>Delete</button>}
            {editing && <button className="hud-btn" onClick={() => h.setEditing(null)}>Cancel</button>}
          </div>
          {!v.sleep.pcTracker && <div className="hl-dim">The PC guess is off (Settings - trackers).</div>}
        </section>

        <section className="hl-form">
          <Sec>Plan tonight</Sec>
          <Field label="I need to wake up at"><input className="hud-input hl-time" type="time" value={planWake} onChange={(e) => setPlanWake(e.target.value)} aria-label="Wake-up time to plan from" /></Field>
          <table className="hl-plan">
            <tbody>
              {bedtimesFor(planWake).map((r) => (
                <tr key={r.hours} className={r.pick ? 'is-pick' : ''}>
                  <td>In bed by <b>{r.bed}</b></td>
                  <td>{r.hours} h of sleep{r.cycles ? ` (${r.cycles} cycles)` : ''}</td>
                  <td>{r.pick ? 'best' : r.hours === 8 ? 'the minimum' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Or: going to bed at"><input className="hud-input hl-time" type="time" value={planBed} onChange={(e) => setPlanBed(e.target.value)} aria-label="Bedtime to plan from" /></Field>
          <table className="hl-plan">
            <tbody>
              {wakeTimesFor(planBed).map((r) => (
                <tr key={r.hours} className={r.pick ? 'is-pick' : ''}>
                  <td>Wake at <b>{r.wake}</b></td>
                  <td>{r.hours} h of sleep{r.cycles ? ` (${r.cycles} cycles)` : ''}</td>
                  <td>{r.pick ? 'best' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hl-dim">Teens need 8-10 hours. It takes about 15 minutes to fall asleep, so these leave room for it. Sleep runs in roughly 90-minute cycles - waking at the end of one (9 hours is 6) feels easier.</div>
          <BedtimeReminder />
          <div className="hl-by">Hypnos</div>
        </section>
      </div>

      <section>
        <Sec>Last 14 nights</Sec>
        <NightBlocks nights={v.sleep.nights} big />
        <div className="hl-stats">
          <div><b>{v.sleep.avg7 ?? '-'}</b><span>avg hours, 7 nights</span></div>
          <div><b>{n7.filter((n) => (n.hours ?? 0) >= 8).length}/{n7.length}</b><span>nights 8 h or more</span></div>
          <div><b>{v.sleep.spread7 === null ? '-' : hm(v.sleep.spread7 / 60)}</b><span>bedtime spread</span></div>
          <div><b>{v.sleep.short7 ? hm(v.sleep.short7) : '0'}</b><span>short of 8 h a night</span></div>
        </div>
        {insights.length > 0 && <ul className="hl-tips">{insights.map((t) => <li key={t}>{t}</li>)}</ul>}
      </section>
    </div>
  );
}

/** The wind-down nudge: on school nights and before morning sessions, half an hour before "in bed by". */
function BedtimeReminder() {
  const h = useHealth();
  const n = h.v.sleep.nudge;
  const t = h.v.sleep.tonight;
  const [wake, setWake] = useState(n.wake || n.usualWake);
  useEffect(() => setWake(n.wake || n.usualWake), [n.wake, n.usualWake]);
  const save = async (patch: Partial<{ bedtimeNudge: boolean; wake: string; hours: number }>) => {
    await ultron.settings.save({ health: { bedtimeNudge: n.bedtimeNudge, wake: n.wake, hours: n.hours, ...patch } });
    h.refresh();
  };
  return (
    <div className="hl-form hl-remind">
      <Sec>Bedtime reminder</Sec>
      <div className="hl-row">
        <Chips label="Bedtime reminder" options={[{ id: 'on', text: 'On' }, { id: 'off', text: 'Off' }]} value={n.bedtimeNudge ? 'on' : 'off'} onChange={(x) => void save({ bedtimeNudge: x === 'on' })} />
        <span className="hl-dim">half an hour before bed, on school nights and before morning sessions</span>
      </div>
      {n.bedtimeNudge && (
        <>
          <div className="hl-two">
            <Field label="School-day wake-up" hint={n.wake ? <button className="link-btn" onClick={() => void save({ wake: '' })}>use my usual ({n.usualWake})</button> : 'your usual, from the log'}>
              <input className="hud-input hl-time" type="time" value={wake} onChange={(e) => setWake(e.target.value)} onBlur={() => { if (wake && wake !== (n.wake || n.usualWake)) void save({ wake }); }} aria-label="School-day wake-up time" />
            </Field>
            <div>
              <div className="hl-label">Hours of sleep to aim for</div>
              <Chips label="Hours of sleep" options={[8, 8.5, 9, 9.5, 10].map((x) => ({ id: String(x), text: `${x} h` }))} value={String(n.hours)} onChange={(x) => void save({ hours: Number(x) })} />
            </div>
          </div>
          <div className="hl-note">{t ? `Tonight: a nudge at ${t.remindAt}, so you're in bed by ${t.bed} for ${n.hours} hours before ${t.wake}${t.why}.` : 'No reminder tonight - no school or morning session tomorrow.'}</div>
        </>
      )}
    </div>
  );
}
