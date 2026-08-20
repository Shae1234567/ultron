import { useState } from 'react';
import { motion } from 'framer-motion';
import { sleepOptions, wakeReminderIcs, downloadIcs, type SleepMode, type SleepOption } from '../../cm8/sleep';

export function Cm8Sleep() {
  const [mode, setMode] = useState<SleepMode>('towake');
  const [time, setTime] = useState('07:00');
  const [options, setOptions] = useState<SleepOption[] | null>(null);

  const calc = () => setOptions(sleepOptions(time, mode));

  return (
    <div className="cm8-food">
      <div>
        <div className="cm8-card">
          <div className="cm8-tags">
            <button
              className={'hud-btn' + (mode === 'tosleep' ? ' hud-btn--active' : '')}
              onClick={() => { setMode('tosleep'); setOptions(null); }}
            >I&rsquo;m going to sleep at…</button>
            <button
              className={'hud-btn' + (mode === 'towake' ? ' hud-btn--active' : '')}
              onClick={() => { setMode('towake'); setOptions(null); }}
            >I need to wake up at…</button>
          </div>

          <div className="label-xs" style={{ margin: '12px 0 6px' }}>
            {mode === 'tosleep' ? 'Bedtime' : 'Target wake-up time'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="hud-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ padding: 8 }} />
            <button className="hud-btn hud-btn--active" onClick={calc}>Calculate</button>
          </div>

          <p className="cm8-ex__note" style={{ marginTop: 10 }}>
            {mode === 'tosleep'
              ? 'Falling asleep usually takes about 15 minutes — that is built into the maths. Options marked in green sit inside the 8–10 hour range recommended for your age.'
              : 'This works backward from your alarm to find the bedtimes that land you between sleep cycles, still inside the 8–10 hour range for your age.'}
          </p>
        </div>
      </div>

      <div>
        <div className="cm8-card">
          <div className="label-xs" style={{ marginBottom: 8 }}>
            {mode === 'tosleep' ? 'Wake up at one of these' : 'Go to bed at one of these'}
          </div>
          {!options && <p className="empty-note">Enter a time and hit calculate.</p>}
          {options?.map((o, i) => (
            <motion.div
              className="cm8-food__row"
              key={o.time}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07, duration: 0.3, ease: [0.16, 0.8, 0.3, 1] }}
            >
              <span className="cm8-food__score" style={{ color: o.inRange ? 'var(--green)' : 'var(--dim)' }}>{o.time}</span>
              <span style={{ color: 'var(--dim)' }}>
                {o.cycles} sleep cycles · {o.hours.toFixed(1)} hrs
                {o.inRange && <span className="chip chip--good" style={{ marginLeft: 8 }}>recommended</span>}
              </span>
              <button
                className="hud-btn"
                onClick={() => downloadIcs(wakeReminderIcs(o.mins, o.cycles), 'shae-wakeup-reminder.ics')}
              >+ Reminder</button>
              <span />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
