import { useEffect, useState } from 'react';
import { ultron } from '../../services/bridge';
import { isDeload, phaseOf, PROGRAM } from '../../../electron/departments/health/program';
import { useHealth } from './context';
import { Sec } from './ui';

/*
 * Heracles' program card on Train (12 Oct 2026): the Fight Club build - where he is in the 52 weeks, this
 * week's five sessions, the next one with a Start button, and the honest picture. Week 1 starts with the
 * first session he does from here.
 */

export function ProgramCard({ onStart }: { onStart: (id: string, week: number) => void }) {
  const h = useHealth();
  const p = h.v.program;
  const [sure, setSure] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(t);
  }, [sure]);

  const act = async (action: 'on' | 'off' | 'restart', done: string) => {
    const r = await ultron.health.program(action);
    if (!r.ok) h.toast(r.error, true);
    else h.toast(done);
  };

  if (!p) {
    return (
      <section className="hl-prog hl-prog--off">
        <Sec right={<span className="hl-by">Heracles</span>}>{PROGRAM.name}</Sec>
        <div className="hl-dim">Paused. Health is back to general fitness until you turn it on again.</div>
        <div className="hl-row"><button className="hud-btn" onClick={() => void act('on', 'Program back on.')}>Turn it back on</button></div>
      </section>
    );
  }

  const week = Math.min(p.week, PROGRAM.weeks);
  return (
    <section className="hl-prog" aria-label={PROGRAM.name}>
      <Sec right={<span className="hl-by">Heracles</span>}>{p.name}</Sec>
      <div className="hl-prog__top">
        <div className="hl-prog__wk">
          <b>{p.started ? week : 1}</b>
          <span>{p.started ? `of ${PROGRAM.weeks} weeks` : 'starts with your first session'}</span>
        </div>
        <div className="hl-prog__ph">
          <div className="hl-prog__phn">{p.phase.name} <i>{p.phase.months}</i>{p.deload ? <em>lighter week</em> : null}</div>
          <div className="hl-prog__phw">{p.phase.what}</div>
        </div>
      </div>

      <div className="hl-prog__road" role="img" aria-label={`Week ${week} of ${PROGRAM.weeks}`}>
        {Array.from({ length: PROGRAM.weeks }, (_, i) => {
          const n = i + 1;
          const cls = [`ph-${phaseOf(n).id}`, p.started && n < week ? 'past' : '', n === week ? 'now' : '', isDeload(n) ? 'light' : ''].filter(Boolean).join(' ');
          return <i key={n} className={cls} title={`Week ${n} - ${phaseOf(n).name}${isDeload(n) ? ' (lighter)' : ''}`} />;
        })}
      </div>
      <div className="hl-prog__legend">{p.phases.map((ph) => <span key={ph.id} className={`ph-${ph.id}${ph.id === p.phase.id ? ' is-now' : ''}`}>{ph.name}</span>)}</div>

      <div className="hl-prog__week">
        {p.sessions.map((s, i) => (
          <button
            key={s.id}
            className={`hl-prog__s${s.done ? ' is-done' : ''}${p.next?.id === s.id ? ' is-next' : ''}`}
            onClick={() => onStart(s.id, p.week)}
            title={`${s.name} - ${s.minutes} min, ${s.sets} sets this week. ${s.focus}`}
          >
            <span className="hl-prog__d">Day {i + 1}{s.done ? ' - done' : ''}</span>
            <span className="hl-prog__n">{s.name.split(' - ')[1]}</span>
          </button>
        ))}
      </div>

      <div className="hl-prog__next">
        {p.note ? <div className="hl-dim">{p.note}</div> : null}
        {p.next ? (
          <div className="hl-row">
            <button className="hud-btn hud-btn--active" onClick={() => onStart(p.next!.id, p.week)}>Start {p.next.name.split(' - ')[0]}</button>
            <span className="hl-prog__meta">{p.next.minutes} min | {p.next.sets} sets | {p.doneThisWeek} of 5 done this week</span>
          </div>
        ) : null}
      </div>

      <button className="link-btn" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Less' : 'The plan, the food, and the honest picture'}</button>
      {more && (
        <div className="hl-prog__more">
          <div className="hl-note">{p.goal}</div>
          <Sec>12 months</Sec>
          <ul className="hl-tips">{p.phases.map((ph) => <li key={ph.id}><b>{ph.months} - {ph.name}.</b> {ph.what}</li>)}</ul>
          <Sec right={<span className="hl-by">Demeter</span>}>Eat to grow</Sec>
          <ul className="hl-tips">{p.growFood.map((t) => <li key={t}>{t}</li>)}</ul>
          <Sec right={<span className="hl-by">Hypnos</span>}>Sleep</Sec>
          <div className="hl-dim">{PROGRAM.sleepHours} hours on gym days - the muscle is built while you sleep, not while you lift.</div>
          <Sec>Honestly</Sec>
          <ul className="hl-tips">{p.honest.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="hl-row">
            <button className="hl-mini" onClick={() => void act('off', 'Program paused.')}>Pause the program</button>
            <button className="hl-mini" onClick={() => (sure ? void act('restart', 'Back to week 1 - your next session starts it.').then(() => setSure(false)) : setSure(true))}>
              {sure ? 'Sure? Back to week 1' : 'Restart from week 1'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
