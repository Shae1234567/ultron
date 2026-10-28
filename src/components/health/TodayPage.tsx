import { useStore } from '../../state/store';
import { useHealth } from './context';
import { Card, Chips, ENERGY_WORDS, Scale, Sec, Segments, SORE_WORDS, dayLabel } from './ui';
import { hm } from './sleepPlan';
import type { DayType } from '../../types';

/*
 * Today, at a glance and one tap from logging: how ready he is (from last night and how he
 * feels), the check-in, sleep with the PC's guess ready to confirm, training, food and water,
 * the flags, what's on the schedule, and how to fuel this kind of day.
 */

const READY: Record<string, { word: string; say: string }> = {
  good: { word: 'Good to go', say: 'Train as planned.' },
  easy: { word: 'Go easier', say: 'Skills, mobility or a shorter session today.' },
  rest: { word: 'Rest day', say: 'Rest or very light movement, and an early night.' },
  unknown: { word: 'No read yet', say: 'Log last night\'s sleep and how you feel to get today\'s read.' },
};

const KIND_WORD: Record<string, string> = { soccer: 'Soccer', badminton: 'Badminton', gym: 'Gym', run: 'Run', other: 'Training' };
const DAY_TYPES: { id: DayType; text: string }[] = [{ id: 'training', text: 'Training day' }, { id: 'match', text: 'Game day' }, { id: 'rest', text: 'Rest day' }];

export function TodayPage() {
  const h = useHealth();
  const { v } = h;
  const setHealth = useStore((s) => s.setHealth);
  const r = READY[v.readiness.level];
  const s = v.sleep.entry;
  const g = v.sleep.guess;
  const protein = v.food.totals.protein_g ?? 0;
  const startTraining = (start: string) => setHealth({ open: true, tab: 'train', start });
  const isToday = h.date === h.today;

  return (
    <div className="hl-page hl-today">
      <section className={`hl-ready hl-ready--${v.readiness.level}`} aria-live="polite">
        <div className="hl-ready__k">Readiness - {dayLabel(h.date, h.today)}</div>
        <div className="hl-ready__w">{r.word}</div>
        <div className="hl-ready__s">{r.say}{v.readiness.why ? <span> ({v.readiness.why})</span> : null}</div>
      </section>

      {v.program && isToday ? (
        <section className="hl-goal">
          <div className="hl-goal__k">{v.program.name} | {v.program.started ? `week ${Math.min(v.program.week, 52)} of 52` : 'week 1 starts with your first session'} | {v.program.doneThisWeek} of 5 this week</div>
          {v.program.next ? <div className="hl-goal__t">Gym next: <b>{v.program.next.name}</b></div> : null}
          {v.program.note ? <div className="hl-goal__n">{v.program.note}</div> : null}
          {v.program.next && !v.program.doneToday ? <button className="hud-btn hud-btn--active" onClick={() => startTraining('program')}>Start it</button> : null}
        </section>
      ) : null}

      <section className="hl-checkin">
        <Sec>How do you feel?</Sec>
        <div className="hl-two">
          <div>
            <div className="hl-label">Energy</div>
            <Scale label="Energy" value={v.checkin?.energy} low="flat" high="buzzing" words={ENERGY_WORDS} onChange={(n) => void h.log('checkin', { energy: n })} />
          </div>
          <div>
            <div className="hl-label">Soreness</div>
            <Scale label="Soreness" value={v.checkin?.soreness} low="fresh" high="wrecked" words={SORE_WORDS} onChange={(n) => void h.log('checkin', { soreness: n })} />
          </div>
        </div>
      </section>

      <div className="hl-tiles">
        <Card className="hl-tile" onClick={() => h.go('sleep')} label="Sleep">
          <div className="hl-tile__k">Sleep {isToday ? 'last night' : ''}</div>
          {s ? (
            <>
              <div className="hl-big">{hm(s.hours)}</div>
              <div className="hl-tile__d">{s.bed} - {s.wake}{s.quality ? ` | felt ${s.quality}/5` : ''}</div>
              <Segments share={s.hours / 9} label="Sleep against 9 hours" tone={s.hours >= 8 ? 'ok' : 'low'} />
            </>
          ) : g ? (
            <>
              <div className="hl-tile__d">The PC was last used at {g.pcOff} and first at {g.pcOn}.</div>
              <div className="hl-big hl-big--guess">{g.bed} - {g.wake}?</div>
              <div className="hl-row" onClick={(e) => e.stopPropagation()}>
                <button className="hud-btn hud-btn--active" onClick={() => void h.log('sleep', { bed: g.bed, wake: g.wake, fromPc: true }, 'Sleep logged.')}>That's right</button>
                <button className="hud-btn" onClick={() => h.go('sleep')}>Fix it</button>
              </div>
            </>
          ) : (
            <>
              <div className="hl-big hl-big--none">Not logged</div>
              <div className="hl-tile__d">When did you go to bed and wake up?</div>
            </>
          )}
        </Card>

        <Card className="hl-tile" onClick={() => h.go('train')} label="Training">
          <div className="hl-tile__k">Training</div>
          {v.training.day.length ? (
            <>
              <div className="hl-big">{v.training.day.reduce((n, t) => n + t.minutes * t.effort, 0)}<small>load</small></div>
              {v.training.day.map((t) => <div key={t.id} className="hl-tile__d">{KIND_WORD[t.kind]}{t.what ? ` - ${t.what}` : ''}: {t.minutes} min, effort {t.effort}</div>)}
            </>
          ) : (
            <div className="hl-big hl-big--none">Nothing yet</div>
          )}
          <div className="hl-row" onClick={(e) => e.stopPropagation()}>
            <button className="hl-mini" onClick={() => startTraining('practice')}>+ Practice</button>
            <button className="hl-mini" onClick={() => startTraining('game')}>+ Game</button>
            <button className="hl-mini" onClick={() => startTraining('gym')}>+ Workout</button>
          </div>
        </Card>

        <Card className="hl-tile" onClick={() => h.go('food')} label="Food">
          <div className="hl-tile__k">Food</div>
          {v.food.day.length ? (
            <>
              <div className="hl-big">{v.food.day.length}<small>{v.food.day.length === 1 ? 'meal' : 'meals'}</small></div>
              <div className="hl-tile__d">Protein {Math.round(protein)} of {v.targets.protein_g} g</div>
              <Segments share={protein / v.targets.protein_g} label="Protein against the daily target" tone={protein >= v.targets.protein_g * 0.8 ? 'ok' : 'low'} />
            </>
          ) : (
            <><div className="hl-big hl-big--none">Nothing yet</div><div className="hl-tile__d">What have you eaten?</div></>
          )}
        </Card>

        <Card className="hl-tile">
          <div className="hl-tile__k">Water</div>
          <div className="hl-big">{(v.water.ml / 1000).toFixed(v.water.ml % 1000 ? 2 : 1)}<small>of {(v.water.target / 1000).toFixed(1)} L</small></div>
          <Segments share={v.water.ml / v.water.target} label="Water against the daily target" tone={v.water.ml >= v.water.target * 0.8 ? 'ok' : 'low'} />
          <div className="hl-row">
            <button className="hl-mini" onClick={() => void h.log('water', { ml: 250 })}>+ glass</button>
            <button className="hl-mini" onClick={() => void h.log('water', { ml: 500 })}>+ bottle</button>
            {v.water.ml > 0 && <button className="hl-mini" aria-label="Take back a glass" onClick={() => void h.log('water', { ml: -250 })}>- glass</button>}
          </div>
        </Card>
      </div>

      {v.flags.length > 0 && (
        <section>
          <Sec>Worth knowing</Sec>
          <ul className="hl-flags">
            {v.flags.map((f) => <li key={f.kind} className={`hl-flag hl-flag--${f.kind}`}>{f.text}</li>)}
          </ul>
        </section>
      )}

      <div className="hl-two">
        <section>
          <Sec right={<button className="link-btn" onClick={() => h.go('train')}>Edit</button>}>On today</Sec>
          {v.schedule.today.length ? (
            <ul className="hl-list">
              {v.schedule.today.map((x) => <li key={x.id}><b>{x.start}</b> {x.kind}{x.sport ? ` (${x.sport})` : ''}, {x.minutes} min{x.note ? ` - ${x.note}` : ''}</li>)}
            </ul>
          ) : <div className="hl-dim">Nothing on the weekly schedule for today. Add practices and games once, on the Train page.</div>}
        </section>
        <section>
          <Sec>{v.dayType.inferred ? 'Kind of day (guessed)' : 'Kind of day'}</Sec>
          <Chips label="Kind of day" options={DAY_TYPES} value={v.dayType.type} onChange={(t) => void h.log('dayType', { type: t })} />
          <ul className="hl-tips">{v.fuelTips.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="hl-by">Demeter</div>
        </section>
      </div>
    </div>
  );
}
