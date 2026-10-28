import { useEffect, useState, type CSSProperties } from 'react';
import { ultron } from '../services/bridge';
import type { LearnSummary } from '../types';

/**
 * "How Ultron is getting better", inside the Memory panel. The vault above it
 * is what Ultron knows about the operator; this is what it has learned about
 * doing its own job - and it is the proof that the learning is real rather
 * than a claim.
 */
export function LearnedPanel() {
  const [s, setS] = useState<LearnSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void ultron.learn.summary().then(setS).catch(() => {});
    return ultron.learn.onUpdated(setS);
  }, []);

  const scoreNow = async () => {
    setTesting(true);
    setNote(null);
    try {
      const r = await ultron.learn.selfTest();
      setNote(r.skipped ?? `Scored ${r.passed} of ${r.total} on questions it had already got right.`);
      setS(await ultron.learn.summary());
    } catch {
      setNote('The test could not run - the brain may be busy or out of quota.');
    }
    setTesting(false);
  };

  const reviewNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await ultron.learn.reflect();
      setNote(r.reviewed < 2
        ? 'Nothing to review yet - it looks back over requests that failed, stalled or you corrected.'
        : `Reviewed ${r.reviewed} rough runs: ${r.lessons} lesson${r.lessons === 1 ? '' : 's'}, ${r.skills} method${r.skills === 1 ? '' : 's'}.`);
      setS(await ultron.learn.summary());
    } catch {
      setNote('The review could not run - the brain may be busy or out of quota.');
    }
    setBusy(false);
  };

  if (!s) return null;
  const nothingYet = !s.lessons && !s.style.length && !s.topSources.length && !s.skills;

  return (
    <div className="field">
      <span className="field__label">How Ultron is getting better</span>

      <div className="learn-grid">
        {([['LESSONS', s.lessons], ['STYLE RULES', s.style.length], ['METHODS', s.skills], ['SOURCES RATED', s.topSources.length + s.avoid.length]] as const).map(([k, n]) => (
          <div key={k} className="learn-stat">
            <div className="learn-stat__n">{n}</div>
            <div className="learn-stat__k">{k}</div>
          </div>
        ))}
      </div>

      {nothingYet && (
        <div className="field__hint" style={{ marginTop: 0 }}>
          Nothing learned yet. It picks things up as you use it: corrections you make, requests that go wrong,
          and which websites actually answer your questions.
        </div>
      )}

      {s.style.length > 0 && (
        <>
          <div className="label-xs" style={{ marginTop: 6 }}>HOW YOU LIKE ANSWERS</div>
          <div className="learn-list">
            {s.style.map((t, i) => (
              <div key={t} className="learn-item" style={{ '--i': i } as CSSProperties}>
                <span className="learn-item__kind">STYLE</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {s.recent.length > 0 && (
        <>
          <div className="label-xs">LATEST LESSONS</div>
          <div className="learn-list">
            {s.recent.slice(0, 6).map((l, i) => (
              <div key={l.id} className="learn-item" style={{ '--i': i } as CSSProperties} title={`learned ${new Date(l.at).toLocaleDateString()} · used ${l.used}x`}>
                <span className="learn-item__kind">{l.kind.toUpperCase()}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(s.topSources.length > 0 || s.avoid.length > 0) && (
        <>
          <div className="label-xs">WEBSITES IT HAS JUDGED</div>
          <div style={{ marginTop: 4 }}>
            {s.topSources.map((x) => <span key={x.domain} className="learn-src learn-src--good" title={`${x.visits} visits`}>✓ {x.domain}</span>)}
            {s.avoid.map((x) => <span key={x.domain} className="learn-src learn-src--bad" title={`${x.visits} visits`}>✕ {x.domain}</span>)}
          </div>
        </>
      )}

      <div className="label-xs">SCOREBOARD</div>
      <div className="field__hint" style={{ marginTop: 2 }}>
        {s.tests
          ? <>{s.tests} saved question{s.tests === 1 ? '' : 's'} Ultron once worked out with code. Re-asking them shows whether a change -
            a different model or service - made it better or worse. It scores the brain on its own, without tools or the team.</>
          : <>No saved questions yet. Whenever Ultron works an answer out with code, that question is kept so it can be re-tested later.</>}
      </div>
      {s.lastScore && (
        <div className="learn-score">
          <span className="learn-score__n">{s.lastScore.score}/{s.lastScore.of}</span>
          <span className="learn-score__k">LAST SCORE · {new Date(s.lastScore.at).toLocaleDateString()}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="hud-btn" onClick={() => void reviewNow()} disabled={busy || testing}>{busy ? 'Reviewing...' : 'Review my mistakes now'}</button>
        <button className="hud-btn" onClick={() => void scoreNow()} disabled={busy || testing || s.tests < 3}>{testing ? 'Testing...' : 'Check my score'}</button>
        {note && <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{note}</span>}
      </div>
      <div className="field__hint">
        Ultron reviews its rough runs by itself every few hours and writes these notes. They guide how it works -
        they can never switch off an approval or a safety rule.
      </div>
    </div>
  );
}
