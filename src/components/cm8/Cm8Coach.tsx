import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { offlineReply, groundingFor, type CoachAnswer } from '../../cm8/coach';
import { getAIResponseOnce } from '../../services/ai';
import { useStore } from '../../state/store';
import { food, plans, profile, todayKey } from '../../cm8/memory';
import * as N from '../../cm8/nutrition';

interface Turn {
  who: 'shae' | 'coach';
  text?: string;
  answer?: CoachAnswer;
  chips?: string[];
  live?: boolean;
}

const OPENER: Turn = {
  who: 'coach',
  answer: {
    head: 'Coach online.',
    intro: 'Passing, pressing, fitness, tiers, food, sleep, school — or something that happened in a game. Ask away.',
  },
  chips: ['How do I get to Tier 3?', 'What should I train today?', 'I had a bad game'],
};

/**
 * The coach, with the offline knowledge base as the floor.
 *
 * When Ultron's local model is up, the question goes to it grounded in the very
 * same CM8 material, so the answer is a real answer rather than the nearest
 * matching topic - and it can follow up on anything the knowledge base never
 * covered. When the model is down, this still works exactly as CM8 does, with
 * no network at all.
 */
export function Cm8Coach() {
  const ollama = useStore((s) => s.ollama);
  const brainUp = !!(ollama?.running && ollama?.modelInstalled);

  const [turns, setTurns] = useState<Turn[]>([OPENER]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [useBrain, setUseBrain] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, thinking]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    setInput('');
    setTurns((t) => [...t, { who: 'shae', text: q }]);

    const offline = offlineReply(q);

    if (!brainUp || !useBrain) {
      setTurns((t) => [...t, { who: 'coach', answer: typeof offline.reply === 'string' ? { head: offline.reply } : offline.reply, chips: offline.chips }]);
      return;
    }

    setThinking(true);
    try {
      // Real state, so the coach answers about today rather than in general.
      const today = todayKey();
      const entries = food.day(today);
      const day = N.dayRead(entries, { mealType: 'Snack', training: 'full', weightKg: profile.weightKg() }, plans.get(today)?.wakeTarget);
      const gaps = day.gaps.slice(0, 3).map((g) => `${g.left}${g.unit} ${g.label}`).join(', ');
      const grounding = groundingFor(q);

      const system = [
        "You are Shae's football coach inside Ultron. Shae is 14, a centre mid for Calgary Rangers,",
        'currently Tier 4 and aiming for Tier 3 at tryouts on 10 September 2026.',
        'Be direct and specific. Short paragraphs. No preamble, no hedging, no bullet-point padding.',
        'Never invent numbers about his training or food — use what is given below or say you do not know.',
        grounding ? '\n' + grounding : '',
        `\nToday so far: ${entries.length} entries logged, ${Math.round(day.totals.p)}g protein of ${day.targets.p}g.`,
        gaps ? `Still short: ${gaps}.` : 'All daily targets met.',
      ].join(' ');

      const text = await getAIResponseOnce(
        [{ role: 'system', content: system }, { role: 'user', content: q }],
        { temperature: 0.6, timeoutMs: 60000 },
      );
      setTurns((t) => [...t, { who: 'coach', text, chips: offline.chips, live: true }]);
    } catch (err) {
      // The brain failed - fall back rather than leaving him with nothing.
      setTurns((t) => [...t, {
        who: 'coach',
        answer: typeof offline.reply === 'string' ? { head: offline.reply } : offline.reply,
        chips: offline.chips,
      }, {
        who: 'coach',
        text: 'That came from the offline coach — the local model did not answer ('
          + (err instanceof Error ? err.message : 'unknown error') + ').',
      }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div>
      <div className="cm8-card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className={'dot' + (brainUp ? ' dot--live' : '')} />
        <span className="label-xs">
          {brainUp && useBrain ? 'Live coach · local model, grounded in CM8' : 'Offline coach · CM8 knowledge base'}
        </span>
        {brainUp && (
          <button className={'hud-btn' + (useBrain ? ' hud-btn--active' : '')} onClick={() => setUseBrain((v) => !v)} style={{ marginLeft: 'auto' }}>
            {useBrain ? 'Using brain' : 'Offline only'}
          </button>
        )}
      </div>

      <div className="cm8-card" style={{ minHeight: 320 }}>
        {turns.map((t, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 0.8, 0.3, 1] }}
            style={{ marginBottom: 14 }}
          >
            <div className="label-xs" style={{ color: t.who === 'shae' ? 'var(--dimmer)' : 'var(--cyan)', marginBottom: 4 }}>
              {t.who === 'shae' ? 'Shae' : t.live ? 'Coach · live' : 'Coach'}
            </div>

            {t.text && <p className="cm8-ex__note" style={{ whiteSpace: 'pre-wrap' }}>{t.text}</p>}

            {t.answer && (
              <div>
                <div className="cm8-ex__name">{t.answer.head}</div>
                {t.answer.intro && <p className="cm8-ex__note" style={{ marginTop: 5 }}>{t.answer.intro}</p>}
                {t.answer.points?.map((p) => (
                  <div className="cm8-pillar__drill" key={p}>{p}</div>
                ))}
                {t.answer.tail && <p className="cm8-ex__note" style={{ marginTop: 6 }}>{t.answer.tail}</p>}
                {t.answer.cue && <p className="cm8-next__tag" style={{ marginTop: 8 }}>{t.answer.cue}</p>}
              </div>
            )}

            {t.chips && t.who === 'coach' && (
              <div className="cm8-tags" style={{ marginTop: 8 }}>
                {t.chips.map((c) => (
                  <button className="hud-btn" key={c} onClick={() => void send(c)}>{c}</button>
                ))}
              </div>
            )}
          </motion.div>
        ))}

        <AnimatePresence>
          {thinking && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="label-xs">
              <span className="dot dot--live" /> thinking…
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input
          className="hud-input"
          style={{ flex: 1, padding: 9 }}
          placeholder="Ask your coach…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(input); }}
        />
        <button className="hud-btn hud-btn--active" onClick={() => void send(input)} disabled={thinking}>Send</button>
      </div>
    </div>
  );
}
