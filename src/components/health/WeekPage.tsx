import type { HealthView } from '../../types';
import { useHealth } from './context';
import { NightBlocks } from './SleepPage';
import { LoadBars } from './TrainPage';
import { Sec, Segments, dayName, shiftDay } from './ui';
import { hm } from './sleepPlan';

/*
 * The week on one screen: Health's "is it helping?" number, sleep and training load side by
 * side, food against the targets, water, how he felt, and which days anything was logged.
 * The summary line is worked out from the numbers - nothing on this page is generated.
 */

const SHORT: Record<string, string> = { protein_g: 'protein', iron_mg: 'iron', calcium_mg: 'calcium', vitd_ug: 'vitamin D', fibre_g: 'fibre', fruitveg: 'fruit and veg' };

export function weekSummary(v: HealthView): string[] {
  const n7 = v.sleep.nights.slice(-7).filter((n) => n.hours !== null);
  const out: string[] = [];
  out.push(n7.length
    ? `Slept ${v.sleep.avg7} h a night on average (${n7.filter((n) => (n.hours ?? 0) >= 8).length} of ${n7.length} logged nights 8 h or more).`
    : 'No sleep logged this week.');
  const r = v.training.ratio;
  out.push(v.training.sessions7
    ? `${v.training.sessions7} training session${v.training.sessions7 === 1 ? '' : 's'}, ${v.training.minutes7} minutes, load ${v.training.weeks[3]}${r === null ? '' : r >= 1.5 ? ` - ${r}x your usual, a big jump` : r <= 0.6 ? ` - a light week (${r}x usual)` : ` - steady (${r}x usual)`}.`
    : 'No training logged this week.');
  if (v.food.week) {
    const short = v.food.week.short.map((s) => SHORT[s.key]).slice(0, 3);
    out.push(`Food logged on ${v.food.week.days} day${v.food.week.days === 1 ? '' : 's'}: ${short.length ? `short on ${short.join(', ')}` : 'on track for every target'} (mostly estimates).`);
  } else out.push('No food logged this week.');
  const active = v.pain.areas.filter((a) => a.active);
  if (active.length) out.push(`Sore: ${active.map((a) => `${a.side ? `${a.side} ` : ''}${a.where} ${a.latest.severity}/10`).join(', ')}.`);
  return out;
}

export function WeekPage() {
  const h = useHealth();
  const { v } = h;
  const days28 = Array.from({ length: 28 }, (_, i) => shiftDay(h.date, i - 27));
  const has = (kind: keyof HealthView['recent'], d: string) => (v.recent[kind] as { date: string }[]).some((e) => e.date === d);
  const checks = Array.from({ length: 14 }, (_, i) => shiftDay(h.date, i - 13)).map((d) => ({ d, c: v.recent.checkins.find((c) => c.date === d) }));
  const n7 = v.sleep.nights.slice(-7).filter((n) => n.hours !== null);

  return (
    <div className="hl-page">
      <section className="hl-number">
        <div><b>{v.number.nightsOver8}/{v.number.nightsLogged}</b><span>nights with 8+ hours</span></div>
        <div><b>{v.number.sessions}</b><span>sessions logged</span></div>
        <div><b>{v.number.load}</b><span>training load</span></div>
        <div><b>{v.streak.now}</b><span>days logged in a row (best {v.streak.best})</span></div>
      </section>
      <ul className="hl-tips hl-tips--summary">{weekSummary(v).map((t) => <li key={t}>{t}</li>)}</ul>

      <div className="hl-cols">
        <section>
          <Sec>Sleep</Sec>
          <NightBlocks nights={v.sleep.nights} />
          <div className="hl-dim">{n7.length ? `Average ${hm(v.sleep.avg7 ?? 0)}.${v.sleep.spread7 === null ? ' Three nights logged shows how steady your bedtime is.' : ` Bedtimes spread over ${hm(v.sleep.spread7 / 60)}.`}` : 'Log a few nights to see the pattern.'}</div>
        </section>
        <section>
          <Sec>Training load</Sec>
          <LoadBars days={v.training.days} />
          <div className="hl-weeks">
            {v.training.weeks.map((w, i) => {
              const max = Math.max(1, ...v.training.weeks);
              return <div key={i}><i style={{ width: `${(w / max) * 100}%` }} className={i === 3 ? 'now' : ''} /><span>{['3 wk ago', '2 wk ago', 'last wk', 'this wk'][i]}: {w}</span></div>;
            })}
          </div>
        </section>
      </div>

      <div className="hl-cols">
        <section>
          <Sec>Food, average logged day</Sec>
          {v.food.week ? (
            <div className="hl-targets hl-targets--tight">
              {(Object.keys(SHORT) as (keyof typeof v.targets)[]).map((k) => {
                const share = (v.food.week!.perDay[k] ?? 0) / v.targets[k];
                return (
                  <div key={k} className="hl-target">
                    <div className="hl-target__h"><b>{SHORT[k]}</b><span>{Math.round(share * 100)}%</span></div>
                    <Segments share={share} label={`${SHORT[k]} against target`} tone={share >= 0.8 ? 'ok' : 'low'} />
                  </div>
                );
              })}
            </div>
          ) : <div className="hl-dim">No food logged this week.</div>}
          <Sec>Water</Sec>
          <div className="hl-waterweek">
            {v.water.days.map((d) => <div key={d.date} title={`${d.date}: ${d.ml} ml`}><i style={{ height: `${Math.min(100, (d.ml / v.water.target) * 100)}%` }} /><span>{dayName(d.date).slice(0, 2)}</span></div>)}
          </div>
        </section>
        <section>
          <Sec>How you felt</Sec>
          <div className="hl-felt">
            {checks.map(({ d, c }) => (
              <div key={d} title={c ? `${d}: energy ${c.energy ?? '-'}, soreness ${c.soreness ?? '-'}` : `${d}: no check-in`}>
                <i className={`e${c?.energy ?? 0}`} />
                <i className={`s${c?.soreness ?? 0}`} />
                <span>{dayName(d).slice(0, 1)}</span>
              </div>
            ))}
          </div>
          <div className="hl-legend"><i className="e5" /> energy <i className="s5" /> soreness - brighter is more</div>
          <Sec>Logged, last 4 weeks</Sec>
          <div className="hl-cal">
            {days28.map((d) => {
              const kinds = (['sleep', 'training', 'food', 'checkins'] as const).filter((k) => has(k, d));
              return <i key={d} className={`n${kinds.length}${d === h.date ? ' is-today' : ''}`} title={`${d}: ${kinds.length ? kinds.join(', ') : 'nothing'}`} />;
            })}
          </div>
          <div className="hl-legend">Each square is a day: brighter means more of sleep, training, food and check-in logged. Never miss twice.</div>
        </section>
      </div>
      <button className="hud-btn" onClick={() => h.ask(`Asclepius, review my week: ${weekSummary(v).join(' ')} `)}>Ask Asclepius for a weekly review</button>
    </div>
  );
}
