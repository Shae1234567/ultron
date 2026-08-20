import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Overlay } from '../Overlay';
import { Cm8FoodLog } from './Cm8FoodLog';
import { Cm8Planner } from './Cm8Planner';
import { Cm8Sleep } from './Cm8Sleep';
import { Cm8Coach } from './Cm8Coach';
import { Cm8Settings } from './Cm8Settings';
import {
  WEEK, OFFSEASON, LIBRARY, PILLARS, TRYOUT_CARDS, TRYOUT_LOOKS_FOR,
  FUEL_PLATES, FUEL_TIMELINE, TIER_STOPS, CLIMB_PHASES, ZONES,
  type DayCard, type Drill,
} from '../../cm8/content';
import '../../styles/cm8.css';

/** Tryouts are the fixed point the whole programme is aimed at. */
const TRYOUT = new Date(2026, 8, 10);
const daysToTryout = () => Math.max(0, Math.ceil((TRYOUT.getTime() - Date.now()) / 86400000));

type SectionKey = 'program' | 'offseason' | 'library' | 'lab' | 'tryouts' | 'fuel' | 'food' | 'plan' | 'sleep' | 'coach' | 'pathway' | 'settings';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'program', label: 'In-Season' },
  { key: 'offseason', label: 'Off-Season' },
  { key: 'library', label: 'Home Library' },
  { key: 'lab', label: 'CM Lab' },
  { key: 'tryouts', label: 'Tryouts' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'food', label: 'Food Log' },
  { key: 'plan', label: 'Day Plan' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'coach', label: 'Coach' },
  { key: 'pathway', label: 'Pathway' },
  { key: 'settings', label: 'Settings' },
];

/* Motion is uniform on purpose: one entrance, staggered by index, so a grid of
   cards resolves in sequence instead of everything popping at once. */
const listStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
};
const itemRise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 0.8, 0.3, 1] as const } },
};

function Pips({ n }: { n: number }) {
  return (
    <span className="cm8-pips">
      {[0, 1, 2, 3].map((i) => <i key={i} className={i < n ? 'on' : undefined} />)}
    </span>
  );
}

function DrillRow({ drill }: { drill: Drill }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cm8-drill">
      <button
        className={'cm8-drill__head' + (open ? ' cm8-drill__head--open' : '')}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{drill.name}</span>
        <span className="cm8-drill__chev">&#9660;</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="cm8-drill__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 0.8, 0.3, 1] }}
          >
            <p>{drill.detail}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DayGrid({ days }: { days: DayCard[] }) {
  return (
    <motion.div className="cm8__grid" variants={listStagger} initial="hidden" animate="show">
      {days.map((d) => {
        const rest = /rest|recovery|mobility/i.test(d.focus);
        return (
          <motion.div className="cm8-card" key={d.day + d.focus} variants={itemRise}>
            <div className="cm8-card__day">{d.day}</div>
            <div className={'cm8-card__focus' + (rest ? ' cm8-card__focus--rest' : '')}>{d.focus}</div>
            {d.cue && <div className="cm8-card__cue">&ldquo;{d.cue}&rdquo;</div>}
            {d.drills.map((dr) => <DrillRow key={dr.name} drill={dr} />)}
            <div className="cm8-card__meta">
              <span>{d.duration}</span>
              <Pips n={d.intensity} />
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

function LibrarySection() {
  const [tab, setTab] = useState(LIBRARY[0]?.key ?? 'strength');
  const active = LIBRARY.find((t) => t.key === tab) ?? LIBRARY[0];
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {LIBRARY.map((t) => (
          <button
            key={t.key}
            className={'hud-btn' + (t.key === tab ? ' hud-btn--active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active?.note && <p className="cm8__lede">{active.note}</p>}
      <motion.div className="cm8__grid" variants={listStagger} initial="hidden" animate="show" key={tab}>
        {active?.items.map((ex) => (
          <motion.div className="cm8-card" key={ex.name} variants={itemRise}>
            <div className="cm8-ex__name">{ex.name}</div>
            <div className="cm8-ex__dose">{ex.dose}</div>
            <div className="cm8-ex__note">{ex.note}</div>
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}

/** The pitch map, rebuilt as an Ultron readout - same five zones, same copy. */
function LabSection() {
  const [zone, setZone] = useState(2);
  const active = ZONES[zone];
  const bands = ZONES.length;
  return (
    <>
      <p className="cm8__lede">
        Five bands of the pitch, and what the job actually is in each one. Tap a band.
      </p>
      <div className="cm8-pitch">
        <svg viewBox="0 0 200 300" style={{ width: '100%', border: '1px solid var(--cyan-20)' }}>
          <rect x="0" y="0" width="200" height="300" fill="rgba(0,217,255,0.03)" />
          {ZONES.map((z, i) => {
            const h = 300 / bands;
            return (
              <g key={z.title} onClick={() => setZone(i)}>
                <rect
                  className={'cm8-zone' + (i === zone ? ' cm8-zone--on' : '')}
                  x="6" y={6 + i * h} width="188" height={h - 4}
                  fill="rgba(0,217,255,0.04)" stroke="rgba(0,217,255,0.18)"
                />
                <text className={'cm8-zone-label' + (i === zone ? ' cm8-zone-label--on' : '')} x="14" y={22 + i * h}>
                  {z.title.toUpperCase()}
                </text>
              </g>
            );
          })}
          <motion.circle
            cx="100" r="7"
            animate={{ cy: 6 + zone * (300 / bands) + (300 / bands) / 2 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
            fill="var(--cyan)" stroke="var(--white)" strokeWidth="1.5"
          />
        </svg>
        <div>
          <div className="cm8-card">
            <div className="cm8-ex__name">{active?.title}</div>
            <p className="cm8-ex__note" style={{ marginTop: 6 }}>{active?.body}</p>
          </div>
          <motion.div variants={listStagger} initial="hidden" animate="show" style={{ marginTop: 12 }}>
            {PILLARS.map((p) => (
              <motion.div className="cm8-card" key={p.num} variants={itemRise} style={{ marginBottom: 8 }}>
                <div className="cm8-pillar__num">{p.num}</div>
                <div className="cm8-ex__name" style={{ marginTop: 3 }}>{p.title}</div>
                <div className="cm8-pillar__cue">{p.cue}</div>
                <div className="cm8-ex__note">{p.why}</div>
                {p.drills.map((d) => <div className="cm8-pillar__drill" key={d}>{d}</div>)}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </>
  );
}

export function Cm8Panel({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionKey>('program');
  const countdown = useMemo(daysToTryout, []);

  return (
    <Overlay
      title="CM8 // CENTRE MID PROGRAM"
      meta={`TIER 4 → 3 · T-${countdown} TO TRYOUT`}
      onClose={onClose}
    >
      <div className="cm8">
        <nav className="cm8__rail">
          {SECTIONS.map((s, i) => (
            <button
              key={s.key}
              className={'cm8__tab' + (s.key === section ? ' cm8__tab--on' : '')}
              onClick={() => setSection(s.key)}
            >
              <span className="cm8__tab-idx">{String(i + 1).padStart(2, '0')}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="cm8__body">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 0.8, 0.3, 1] }}
            >
              {section === 'program' && (
                <>
                  <p className="cm8__lede">
                    Built around Rangers practice and match day rather than replacing them.
                    Swap days to match the real fixture list &mdash; the structure matters more
                    than which day it falls on.
                  </p>
                  <DayGrid days={WEEK} />
                </>
              )}

              {section === 'offseason' && (
                <>
                  <p className="cm8__lede">The off-season block: where the tier jump is actually won.</p>
                  <DayGrid days={OFFSEASON} />
                </>
              )}

              {section === 'library' && <LibrarySection />}
              {section === 'lab' && <LabSection />}

              {section === 'tryouts' && (
                <>
                  <p className="cm8__lede">What the evaluators are watching for, and how to be the one they remember.</p>
                  <motion.div className="cm8__grid" variants={listStagger} initial="hidden" animate="show">
                    {TRYOUT_CARDS.map((c) => (
                      <motion.div className="cm8-card" key={c.title} variants={itemRise}>
                        <div className="cm8-ex__name">{c.title}</div>
                        <p className="cm8-ex__note" style={{ marginTop: 6 }}>{c.body}</p>
                      </motion.div>
                    ))}
                  </motion.div>
                  {TRYOUT_LOOKS_FOR.length > 0 && (
                    <div className="cm8-card" style={{ marginTop: 12 }}>
                      <div className="label-xs">What a coach scans for</div>
                      <div className="cm8-tags" style={{ marginTop: 8 }}>
                        {TRYOUT_LOOKS_FOR.map((t) => <span className="chip" key={t}>{t}</span>)}
                      </div>
                    </div>
                  )}
                </>
              )}

              {section === 'fuel' && (
                <>
                  <p className="cm8__lede">Eating to grow and train &mdash; not to restrict.</p>
                  <motion.div className="cm8__grid" variants={listStagger} initial="hidden" animate="show">
                    {FUEL_PLATES.map((p) => (
                      <motion.div className="cm8-card" key={p.title} variants={itemRise}>
                        <div className="cm8-ex__name">{p.title}</div>
                        <p className="cm8-ex__note" style={{ marginTop: 6 }}>{p.body}</p>
                      </motion.div>
                    ))}
                  </motion.div>
                  <div className="cm8-card" style={{ marginTop: 12 }}>
                    <div className="label-xs" style={{ marginBottom: 6 }}>Match day timing</div>
                    {FUEL_TIMELINE.map((r) => (
                      <div className="cm8-row" key={r.when}>
                        <b>{r.when}</b><span>{r.what}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {section === 'food' && <Cm8FoodLog />}
              {section === 'plan' && <Cm8Planner />}
              {section === 'sleep' && <Cm8Sleep />}
              {section === 'coach' && <Cm8Coach />}
              {section === 'settings' && <Cm8Settings />}

              {section === 'pathway' && (
                <>
                  <p className="cm8__lede">How tier movement actually works, and the 90-day plan against it.</p>
                  <motion.div className="cm8__grid" variants={listStagger} initial="hidden" animate="show">
                    {TIER_STOPS.map((s) => (
                      <motion.div className="cm8-card" key={s.title} variants={itemRise}>
                        <div className="cm8-pillar__num">{s.label}</div>
                        <div className="cm8-ex__name" style={{ marginTop: 3 }}>{s.title}</div>
                        <p className="cm8-ex__note" style={{ marginTop: 6 }}>{s.body}</p>
                        <div className="cm8-card__meta">
                          <span className={s.state === 'current' ? 'chip chip--good' : s.state === 'target' ? 'chip' : 'chip chip--muted'}>
                            {s.state}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                  {CLIMB_PHASES.map((p) => (
                    <div className="cm8-card" key={p.title} style={{ marginTop: 12 }}>
                      <div className="cm8-ex__name">{p.title}</div>
                      <div style={{ marginTop: 6 }}>
                        {p.items.map((i) => <div className="cm8-check" key={i}>{i}</div>)}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Overlay>
  );
}
