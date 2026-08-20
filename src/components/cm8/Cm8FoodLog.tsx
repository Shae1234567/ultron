import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as N from '../../cm8/nutrition';
import { food, profile, plans, todayKey, prettyDate, subscribe } from '../../cm8/memory';
import { VISION_QUESTIONS, visionItems, visionComplete, type VisionAnswers } from '../../cm8/vision';

const MEAL_TYPES: N.MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Post-training'];
const LOADS: N.TrainingLoad[] = ['full', 'light', 'match', 'rest'];

function Meter({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const pct = target ? Math.round((100 * value) / target) : 0;
  const tone = pct >= 100 ? ' cm8-meter__fill--good' : pct < 25 ? ' cm8-meter__fill--warn' : '';
  return (
    <div className="cm8-meter">
      <div className="cm8-meter__top">
        <span>{label}</span>
        <span className="cm8-meter__val">{Math.round(value)} / {target}{unit}</span>
      </div>
      <div className="cm8-meter__track">
        <motion.div
          className={'cm8-meter__fill' + tone}
          initial={{ width: 0 }}
          animate={{ width: Math.min(100, pct) + '%' }}
          transition={{ duration: 0.55, ease: [0.16, 0.8, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

const fmtTime = (mins: number) => {
  const m = (((Math.round(mins) % 1440) + 1440) % 1440);
  const h = Math.floor(m / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${ap}`;
};

export function Cm8FoodLog() {
  const [text, setText] = useState('');
  const [mealType, setMealType] = useState<N.MealType>('Breakfast');
  const [training, setTraining] = useState<N.TrainingLoad>('full');
  const [read, setRead] = useState<N.EntryRead | null>(null);
  const [move, setMove] = useState<N.NextMove | null>(null);
  const [tick, setTick] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);
  const [vision, setVision] = useState<VisionAnswers>({});

  // Memory is a module, not React state - re-render when it changes.
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const weightKg = profile.weightKg();
  const ctx = useMemo<N.Ctx>(() => ({ mealType, training, weightKg }), [mealType, training, weightKg]);

  const today = todayKey();
  const entries = useMemo(() => food.day(today), [today, tick]);
  const wakeTarget = plans.get(today)?.wakeTarget;
  const day = useMemo(() => N.dayRead(entries, ctx, wakeTarget), [entries, ctx, wakeTarget]);
  const stats = useMemo(() => food.dayStats(today), [today, tick]);
  const recents = useMemo(() => food.recent(6), [tick]);

  const analyse = useCallback(() => {
    if (!text.trim() && !visionComplete(vision)) return;
    const parsed = N.parse(text);
    if (!parsed.items.length && visionComplete(vision)) parsed.items = visionItems(vision);
    const r = N.readEntry(parsed, ctx, food.day(today), wakeTarget);
    setRead(r);
    setMove(N.nextMove(r, ctx));
    food.add(today, {
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      type: mealType,
      text: text.trim() || 'Photo + answers',
      score: r.score,
      kind: r.kind,
      n: r.totals,
      items: r.items.map((i) => ({ name: i.name, servings: Math.round(i.servings * 100) / 100 })),
    });
    setText('');
    setPhoto(null);
    setVision({});
  }, [text, ctx, today, mealType, wakeTarget, vision]);

  return (
    <div className="cm8-food">
      {/* ── left: log something ── */}
      <div>
        <div className="cm8-card">
          <div className="label-xs" style={{ marginBottom: 8 }}>Log a meal</div>
          <div className="cm8-tags">
            {MEAL_TYPES.map((m) => (
              <button
                key={m}
                className={'hud-btn' + (m === mealType ? ' hud-btn--active' : '')}
                onClick={() => setMealType(m)}
              >{m}</button>
            ))}
          </div>
          <div className="cm8-tags">
            {LOADS.map((l) => (
              <button
                key={l}
                className={'hud-btn' + (l === training ? ' hud-btn--active' : '')}
                onClick={() => setTraining(l)}
              >{l}</button>
            ))}
          </div>
          <textarea
            className="hud-input"
            style={{ width: '100%', minHeight: 74, marginTop: 8, resize: 'vertical', padding: 8 }}
            placeholder="eggs with avocado and cheese"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) analyse(); }}
          />

          {/* Photo logging: CM8 never read the image, it asked about it. Same here. */}
          <div className="label-xs" style={{ margin: '12px 0 6px' }}>Or log from a photo</div>
          <input
            type="file" accept="image/*" className="hud-input" style={{ padding: 6, fontSize: 11 }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              const fr = new FileReader();
              fr.onload = (ev) => setPhoto(String(ev.target?.result || ''));
              fr.readAsDataURL(f);
            }}
          />
          {photo && (
            <div style={{ marginTop: 8 }}>
              <img src={photo} alt="" style={{ maxHeight: 110, border: '1px solid var(--cyan-20)' }} />
              <p className="empty-note" style={{ marginTop: 6 }}>
                The photo is a memory aid — these four answers are what produce the numbers.
              </p>
              {VISION_QUESTIONS.map((q) => (
                <div key={q.id} style={{ marginTop: 8 }}>
                  <div className="cm8-ex__note" style={{ marginBottom: 4 }}>{q.q}</div>
                  <div className="cm8-tags">
                    {q.opts.map((o) => (
                      <button
                        key={o}
                        className={'hud-btn' + (vision[q.id] === o ? ' hud-btn--active' : '')}
                        onClick={() => setVision((v) => ({ ...v, [q.id]: o }))}
                      >{o}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <button className="hud-btn hud-btn--active" onClick={analyse}>Analyse</button>
            <span className="label-xs" style={{ color: 'var(--dimmer)' }}>{weightKg}kg targets</span>
          </div>
          {recents.length > 0 && (
            <>
              <div className="label-xs" style={{ margin: '12px 0 6px' }}>Usual</div>
              <div className="cm8-tags">
                {recents.map((r) => (
                  <button key={r.text} className="hud-btn" onClick={() => { setText(r.text); setMealType(r.type as N.MealType); }}>
                    {r.text.length > 26 ? r.text.slice(0, 25) + '…' : r.text}
                    {r.count > 1 && <span style={{ opacity: 0.55 }}> {r.count}×</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <AnimatePresence mode="wait">
          {read && (
            <motion.div
              key={read.headline + entries.length}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 0.8, 0.3, 1] }}
              style={{ marginTop: 12 }}
            >
              <div className={'cm8-verdict' + (read.verdictClass === 'good' ? ' cm8-verdict--good' : read.verdictClass === 'low' ? ' cm8-verdict--low' : '')}>
                <div className="cm8-verdict__score">
                  {read.kind === 'drink' ? 'DRINK' : <>{read.score}<small>/100</small></>}
                </div>
                <div>
                  <div className="cm8-verdict__word">{read.headline}</div>
                  <div className="cm8-verdict__body">{read.body}</div>
                </div>
              </div>

              {read.items.length > 0 && (
                <div className="cm8-tags">
                  {read.items.map((i, idx) => (
                    <span className="chip" key={i.name + idx}>
                      {i.servings === 1 ? '' : `${Math.round(i.servings * 100) / 100} × `}{i.name}
                    </span>
                  ))}
                </div>
              )}
              {read.unknown.length > 0 && (
                <p className="empty-note">Not recognised: {read.unknown.join(', ')} — left out of the numbers.</p>
              )}
              {read.notes.map((n) => <p className="cm8-ex__note" key={n} style={{ marginBottom: 6 }}>{n}</p>)}
              {read.caffeineCutoff !== undefined && (
                <p className="cm8-ex__note">
                  Caffeine cutoff today: <b style={{ color: 'var(--cyan)' }}>{fmtTime(read.caffeineCutoff)}</b> — it halves
                  roughly every six hours, so later than that and it is still in you at bedtime.
                </p>
              )}

              {move && (
                <div className="cm8-next">
                  <div className="cm8-next__tag">Eat this next · {move.nextLabel}</div>
                  <div className="cm8-next__head">{move.headline}</div>
                  <div className="cm8-next__body">{move.body}</div>
                  <div className="cm8-next__ideas">
                    {move.ideas.map((i) => <span className="chip" key={i}>{i}</span>)}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── right: the day ── */}
      <div>
        <div className="cm8-card">
          <div className="label-xs" style={{ marginBottom: 10 }}>
            Today so far · {day.mealsLogged} {day.mealsLogged === 1 ? 'meal' : 'meals'}
            {stats && <span style={{ color: 'var(--dimmer)' }}> · avg {stats.avg} {stats.verdict}</span>}
          </div>
          <Meter label="Protein" value={day.totals.p} target={day.targets.p} unit="g" />
          <Meter label="Carbs" value={day.totals.c} target={day.targets.c} unit="g" />
          <Meter label="Energy" value={day.totals.kcal} target={day.targets.kcal} unit=" kcal" />
          <Meter label="Calcium" value={day.totals.ca} target={day.targets.ca} unit="mg" />
          <Meter label="Iron" value={day.totals.fe} target={day.targets.fe} unit="mg" />
          <Meter label="Fluid" value={day.totals.fluid} target={day.targets.fluid} unit="ml" />
          {day.caffeine > 0 && (
            <p className="cm8-ex__note" style={{ marginTop: 8 }}>
              Caffeine {Math.round(day.caffeine)}mg of a {day.targets.cafMax}mg ceiling · cutoff {fmtTime(day.cutoff)}
            </p>
          )}
          {day.gaps.length > 0 && (
            <p className="cm8-ex__note" style={{ marginTop: 6 }}>
              Still short: {day.gaps.slice(0, 3).map((g) => `${g.left}${g.unit} ${g.label}`).join(', ')}.
            </p>
          )}
        </div>

        <div className="cm8-card" style={{ marginTop: 12 }}>
          <div className="label-xs" style={{ marginBottom: 6 }}>{prettyDate(today)}&rsquo;s log</div>
          {entries.length === 0 && <p className="empty-note">Nothing logged yet today.</p>}
          {entries.map((m) => (
            <div className="cm8-food__row" key={m.id}>
              <span className="cm8-food__type">{m.type}</span>
              <span style={{ color: 'var(--dim)' }}><b style={{ color: 'var(--dimmer)' }}>{m.time}</b> {m.text}</span>
              <span
                className={'cm8-food__score' + (m.kind === 'drink' || typeof m.score !== 'number' ? ' cm8-food__score--none' : '')}
                title={m.kind === 'drink' ? 'Drinks are not scored as meals' : 'Meal score out of 100'}
              >
                {m.kind === 'drink' || typeof m.score !== 'number' ? '—' : m.score}
              </span>
              <button className="cm8-food__del" onClick={() => food.remove(today, m.id)} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
