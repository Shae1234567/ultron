import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HexPanel } from '../hud/HexPanel';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import type { FocusState, SchoolState } from '../../types';
import { Chips, Empty, Sec, Segments } from '../health/ui';
import '../health/health.css';
import './school.css';

/*
 * The School screen (Prometheus' department): this week from D2L - overdue first, then what's
 * due, quizzes, and any quiz open right now - grades and how they're moving, the course library
 * (the teachers' own notes, read in and searchable), and studying (focus sessions and study
 * blocks before a test). Everything shown is real: read from D2L/PowerSchool, never filled in.
 */

type Tab = 'week' | 'grades' | 'library' | 'study';
const TABS: { id: Tab; name: string }[] = [{ id: 'week', name: 'This week' }, { id: 'grades', name: 'Grades' }, { id: 'library', name: 'Library' }, { id: 'study', name: 'Study' }];
const isTab = (t: unknown): t is Tab => TABS.some((x) => x.id === t);

const when = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'no date');
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const ask = (text: string) => {
  useStore.getState().setSchool({ open: false });
  window.dispatchEvent(new CustomEvent('ultron:prefill', { detail: text }));
};

function Week({ st, refresh, busy }: { st: SchoolState; refresh: () => void; busy: boolean }) {
  const c = st.doc.cache;
  const now = Date.now();
  const [synced, setSynced] = useState<string>('');
  if (!c) {
    return (
      <div className="hl-page">
        <Empty>School hasn't read D2L yet. <button className="link-btn" onClick={refresh}>Read it now</button> - if it says not signed in, sign in from Apps (you sign in yourself; Ultron never sees the password).</Empty>
      </div>
    );
  }
  const open = c.quizzes.filter((q) => {
    const s = q.start ? Date.parse(q.start) : -Infinity;
    const e = q.end ? Date.parse(q.end) : q.due ? Date.parse(q.due) : Infinity;
    return s <= now && now <= e && Number.isFinite(e);
  });
  const due = c.due.filter((d) => !d.completed && d.due && Date.parse(d.due) >= now - 3600_000).sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!));
  const byDay = new Map<string, typeof due>();
  for (const d of due) {
    const k = new Date(d.due!).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
    byDay.set(k, [...(byDay.get(k) ?? []), d]);
  }
  const quizzes = c.quizzes.filter((q) => q.start && Date.parse(q.start) > now).sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!)).slice(0, 8);
  const toTasks = async () => {
    const r = await ultron.d2l.sync();
    setSynced(r.ok ? `${r.added?.length ?? 0} added to your tasks with reminders${r.skipped ? `, ${r.skipped} already there` : ''}.` : r.error ?? 'That did not work.');
  };
  return (
    <div className="hl-page">
      <div className="sc-status">
        {c.signedIn ? <>Read from D2L {ago(c.at)}{st.doc.ps ? ' (and PowerSchool)' : ''}.</> : <span className="sc-warn">D2L is not signed in - this is the last good copy. Sign in from Apps.</span>}
        <button className="hl-mini" disabled={busy} onClick={refresh}>{busy ? 'Reading...' : 'Read again'}</button>
      </div>
      {open.length > 0 && (
        <div className="hl-alert" role="alert">
          <p>Open on D2L right now: {open.map((q) => `${q.course} - ${q.name}`).join(', ')}.</p>
          <p className="sc-small">Live graded quizzes are yours alone - Ultron won't help with one until it closes. After that, it'll go through every question with you.</p>
        </div>
      )}
      {c.overdue.length > 0 && (
        <section>
          <Sec>Overdue - first</Sec>
          <ul className="hl-entries">{c.overdue.map((d) => <li key={`${d.courseId}${d.name}`} className="hl-entry sc-over"><span className="hl-entry__d">{d.course}</span><span className="hl-entry__t">{d.name}</span><span className="hl-entry__v">{when(d.due)}</span><span /><span /></li>)}</ul>
        </section>
      )}
      <section>
        <Sec right={<button className="hud-btn" onClick={() => void toTasks()}>Turn into reminders</button>}>Due next three weeks</Sec>
        {synced && <div className="hl-note">{synced}</div>}
        {byDay.size ? [...byDay.entries()].map(([d, items]) => (
          <div key={d} className="hl-day">
            <div className="hl-day__h">{d}</div>
            <ul className="hl-entries">
              {items.map((i) => (
                <li key={`${i.courseId}${i.name}${i.due}`} className="hl-entry">
                  <span className="hl-entry__k">{i.type}</span>
                  <span className="hl-entry__t"><b>{i.name}</b> {i.course}</span>
                  <span className="hl-entry__d">{new Date(i.due!).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}</span>
                  <button className="hl-mini" onClick={() => ask(`Prometheus, help me plan "${i.name}" for ${i.course}. `)}>Plan it</button>
                  <span />
                </li>
              ))}
            </ul>
          </div>
        )) : <Empty>Nothing due on D2L in the next three weeks. A good time to get ahead - or ask Sphinx to quiz you on this unit.</Empty>}
      </section>
      {quizzes.length > 0 && (
        <section>
          <Sec>Quizzes coming up</Sec>
          <ul className="hl-entries">{quizzes.map((q) => <li key={`${q.courseId}${q.name}`} className="hl-entry"><span className="hl-entry__k">quiz</span><span className="hl-entry__t"><b>{q.name}</b> {q.course}</span><span className="hl-entry__d">{when(q.start)}</span><button className="hl-mini" onClick={() => ask(`Sphinx, quiz me to get ready for "${q.name}" in ${q.course}. `)}>Practise</button><span /></li>)}</ul>
        </section>
      )}
      <button className="hud-btn" onClick={() => ask('Prometheus, what should I do first this week? ')}>Ask Prometheus what to do first</button>
    </div>
  );
}

function Spark({ pts }: { pts: (number | null)[] }) {
  const xs = pts.filter((p): p is number => p !== null);
  if (xs.length < 2) return null;
  const lo = Math.min(...xs) - 3;
  const hi = Math.max(...xs) + 3;
  const w = 120;
  const h = 28;
  const d = xs.map((p, i) => `${i ? 'L' : 'M'}${(i / (xs.length - 1)) * w},${h - ((p - lo) / (hi - lo)) * h}`).join(' ');
  return <svg className="sc-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} /></svg>;
}

function Grades({ st }: { st: SchoolState }) {
  const n = st.number;
  const history = st.doc.gradeHistory;
  return (
    <div className="hl-page">
      <section className="hl-number">
        <div><b>{n.total ? `${n.onTime}/${n.total}` : '-'}</b><span>in on time, last 8 weeks</span></div>
        <div><b>{n.late}</b><span>late</span></div>
        <div><b>{n.missing}</b><span>not handed in</span></div>
        <div><b>{n.trend.length}</b><span>courses with a grade</span></div>
      </section>
      <section>
        <Sec>Grades on D2L, and how they're moving</Sec>
        {n.trend.length ? (
          <ul className="sc-grades">
            {n.trend.map((t) => (
              <li key={t.course}>
                <span className="sc-grades__c">{t.course}</span>
                <b>{t.grade}</b>
                <span className={`sc-grades__ch${t.change ? (t.change > 0 ? ' up' : ' down') : ''}`}>{t.change ? `${t.change > 0 ? '+' : ''}${t.change} since ${t.since}` : 'no change yet'}</span>
                <Spark pts={history.filter((h) => h.course === t.course).map((h) => h.pct)} />
                {t.pct !== null && <Segments share={t.pct / 100} label={`${t.course} grade`} tone={t.pct >= 70 ? 'ok' : 'low'} />}
              </li>
            ))}
          </ul>
        ) : <Empty>No grades showing on D2L yet. They appear here as teachers post them - and Ultron keeps the history, so you can see the trend.</Empty>}
      </section>
      {st.doc.ps && st.doc.ps.courses.length > 0 && (
        <section>
          <Sec>PowerSchool - report card and attendance</Sec>
          <table className="hl-plan">
            <tbody>
              {st.doc.ps.courses.map((c) => (
                <tr key={c.course}>
                  <td><b>{c.course}</b>{c.teacher ? <span className="sc-small"> {c.teacher}</span> : null}</td>
                  <td>{Object.entries(c.grades).map(([k, v]) => `${k}: ${v}`).join('   ') || '-'}</td>
                  <td>{c.absences ?? 0} absent, {c.tardies ?? 0} late</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <button className="hud-btn" onClick={() => ask("Prometheus, read my teachers' feedback and tell me what to work on. ")}>What should I work on? (reads teacher feedback)</button>
    </div>
  );
}

function Library() {
  const [courses, setCourses] = useState<{ course: string; courseId: number; topics: number; inLibrary: number }[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ rel: string; title: string; course: string; text: string }[] | null>(null);
  const load = useCallback(() => void ultron.school.courses().then((r) => { if (r.ok) { setCourses(r.courses); setErr(''); } else setErr(r.error); }), []);
  useEffect(load, [load]);
  const sync = async (course?: string) => {
    setBusy(course ?? 'all');
    setNote('');
    const r = await ultron.school.sync(course);
    setBusy(null);
    setNote(r.ok ? `Read ${r.read.length} new or changed topic${r.read.length === 1 ? '' : 's'} in${r.left ? ` - ${r.left} more to go, press again` : ''}.${r.failed.length ? ` Couldn't read ${r.failed.length}.` : ''}` : r.error);
    load();
  };
  const search = async () => setHits(q.trim() ? await ultron.school.search(q.trim()) : null);
  return (
    <div className="hl-page">
      <div className="hl-dim">The teachers' own notes, slides, worksheets and readings from D2L, read into Ultron's vault (private) so Chiron explains from them and Sphinx quizzes from them. Only new or changed files are read again. D2L itself is never changed.</div>
      <section>
        <Sec right={<button className="hud-btn" disabled={busy !== null} onClick={() => void sync()}>{busy === 'all' ? 'Reading...' : 'Read all courses in'}</button>}>Courses</Sec>
        {note && <div className="hl-note">{note}</div>}
        {err ? <Empty>{err}</Empty> : !courses ? <div className="hl-dim">Asking D2L...</div> : courses.length ? (
          <ul className="hl-entries">
            {courses.map((c) => (
              <li key={c.courseId} className="hl-entry">
                <span className="hl-entry__k">course</span>
                <span className="hl-entry__t"><b>{c.course}</b> {c.inLibrary} of {c.topics} files read in</span>
                <span className="sc-libbar"><Segments share={c.topics ? c.inLibrary / c.topics : 0} label={`${c.course} library`} tone={c.inLibrary >= c.topics ? 'ok' : 'low'} /></span>
                <button className="hl-mini" disabled={busy !== null} onClick={() => void sync(c.course)}>{busy === c.course ? 'Reading...' : 'Read in'}</button>
                <span />
              </li>
            ))}
          </ul>
        ) : <Empty>No courses on D2L.</Empty>}
      </section>
      <section>
        <Sec>Search your notes</Sec>
        <div className="hl-row">
          <input className="hud-input" placeholder="e.g. photosynthesis, Pythagorean theorem, Treaty of Versailles" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} aria-label="Search the course library" />
          <button className="hud-btn" onClick={() => void search()}>Search</button>
        </div>
        {hits && (hits.length ? (
          <div className="sc-hits">
            {hits.map((h) => (
              <div key={h.rel} className="sc-hit">
                <div className="sc-hit__h"><b>{h.title}</b><span>{h.course}</span></div>
                <p>{h.text.slice(0, 600)}{h.text.length > 600 ? '...' : ''}</p>
                <div className="hl-row hl-row--tight">
                  <button className="hl-mini" onClick={() => ask(`Chiron, explain this from my ${h.course} notes ("${h.title}"): `)}>Explain it</button>
                  <button className="hl-mini" onClick={() => ask(`Sphinx, quiz me on "${h.title}" from ${h.course}. `)}>Quiz me</button>
                  <button className="hl-mini" onClick={() => void ultron.vault.open(h.rel)}>Open note</button>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>Nothing in the library on that yet - read the course in first.</Empty>)}
      </section>
    </div>
  );
}

function Study({ st }: { st: SchoolState }) {
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [subject, setSubject] = useState('');
  const [what, setWhat] = useState('');
  const [due, setDue] = useState('');
  const [total, setTotal] = useState(120);
  const [plan, setPlan] = useState<{ planned: number; blocks: string[]; short_of_time?: string } | { error: string } | null>(null);
  useEffect(() => {
    void ultron.focus.state().then(setFocus);
    const off = ultron.focus.onChanged((s) => setFocus(s as FocusState));
    const t = setInterval(() => void ultron.focus.state().then(setFocus), 30_000);
    return () => { off(); clearInterval(t); };
  }, []);
  const courses = useMemo(() => [...new Set([...st.number.trend.map((t) => t.course), ...(st.doc.cache?.due ?? []).map((d) => d.course)])].slice(0, 8), [st]);
  const start = async (minutes: number) => setFocus(await ultron.focus.start(subject || 'study', minutes));
  const makePlan = async () => {
    if (!what.trim() || !due) return;
    setPlan(await ultron.school.plan({ what: what.trim(), due: new Date(due).toISOString(), total }));
  };
  const missed = st.text.includes('yesterday was missed');
  return (
    <div className="hl-page">
      <div className="hl-cols">
        <section className="hl-form">
          <Sec right={<span className="hl-by">Kratos</span>}>Focus</Sec>
          {focus?.active ? (
            <div className="sc-focus">
              <div className="hl-big">{focus.left}<small>min left - {focus.active.subject}</small></div>
              <button className="hud-btn hud-btn--danger" onClick={() => void ultron.focus.stop().then(setFocus)}>Stop</button>
            </div>
          ) : (
            <>
              <div className="hl-label">On what?</div>
              <Chips label="Subject" options={courses.map((c) => ({ id: c, text: c }))} value={subject} onChange={setSubject} />
              <input className="hud-input" placeholder="or type it" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Focus subject" />
              <div className="hl-row">
                <button className="hud-btn hud-btn--active" onClick={() => void start(25)}>Start 25 min</button>
                <button className="hud-btn" onClick={() => void start(45)}>45 min</button>
              </div>
              <div className="hl-dim">Phone in another room. Ultron stays quiet until the time is up.</div>
            </>
          )}
          <div className="hl-stats">
            <div><b>{focus?.streak ?? st.focus.streak}</b><span>days in a row</span></div>
            <div><b>{focus?.todayMinutes ?? st.focus.todayMinutes}</b><span>minutes today</span></div>
          </div>
          {missed && <div className="hl-note">Yesterday was missed - that's fine once. Today's block is the one that matters: never miss twice.</div>}
        </section>
        <section className="hl-form">
          <Sec right={<span className="hl-by">Kratos</span>}>Plan study before a test or due date</Sec>
          <input className="hud-input" placeholder='what for, e.g. "Science unit 2 test"' value={what} onChange={(e) => setWhat(e.target.value)} aria-label="What the plan is for" />
          <label className="hl-field"><span className="hl-field__l">Due or test on</span><input className="hud-input hl-time sc-dt" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date and time" /></label>
          <div className="hl-label">How much study in total?</div>
          <Chips label="Total study" options={[60, 90, 120, 180, 240].map((m) => ({ id: String(m), text: `${m / 60 >= 1 && m % 60 === 0 ? `${m / 60} h` : `${m} min`}` }))} value={String(total)} onChange={(v) => setTotal(Number(v))} />
          <button className="hud-btn hud-btn--active" disabled={!what.trim() || !due} onClick={() => void makePlan()}>Plan it</button>
          {plan && ('error' in plan ? <div className="hl-note hl-note--warn">{plan.error}</div> : (
            <div className="hl-note">
              {plan.planned} blocks added to your tasks, each with a reminder 10 minutes before:
              <ul>{plan.blocks.map((b) => <li key={b}>{b}</li>)}</ul>
              {plan.short_of_time}
            </div>
          ))}
          <div className="hl-dim">Blocks go after school (4-8:30 pm) and on weekend afternoons, around practices and games on your Health schedule - two a day at most, never all the night before.</div>
        </section>
      </div>
      {focus && focus.recent.length > 0 && (
        <section>
          <Sec>Recent focus sessions</Sec>
          <ul className="hl-entries">
            {focus.recent.slice(0, 8).map((s) => (
              <li key={s.startedAt} className="hl-entry">
                <span className="hl-entry__d">{new Date(s.startedAt).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="hl-entry__t">{s.subject}{s.finished ? '' : ' (stopped early)'}</span>
                <span className="hl-entry__v">{Math.round(((s.endedAt ?? s.endsAt) - s.startedAt) / 60_000)} min</span>
                <span /><span />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function SchoolApp() {
  const school = useStore((s) => s.school);
  const setSchool = useStore((s) => s.setSchool);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(isTab(school.tab) ? school.tab : 'week');
  const [st, setSt] = useState<SchoolState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(() => void ultron.school.state().then((s) => { setSt(s); setFailed(''); }).catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => {
    load();
    const off = ultron.school.onChanged(load);
    return off;
  }, [load]);
  useEffect(() => { if (isTab(school.tab)) setTab(school.tab); }, [school.nonce]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    void el.offsetWidth;
    el.classList.add('is-open');
  }, []);
  const close = useCallback(() => {
    rootRef.current?.classList.remove('is-open');
    setTimeout(() => setSchool({ open: false }), 160);
  }, [setSchool]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { t.blur(); e.stopPropagation(); return; }
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const refresh = async () => {
    setBusy(true);
    await ultron.school.refresh();
    setBusy(false);
    load();
  };
  const c = st?.doc.cache;
  const counts: Record<Tab, string> = {
    week: c ? `${c.overdue.length ? `${c.overdue.length} overdue, ` : ''}${c.due.filter((d) => !d.completed && d.due && Date.parse(d.due) <= Date.now() + 7 * 86_400_000 && Date.parse(d.due) >= Date.now()).length} due` : 'not read yet',
    grades: st ? (st.number.total ? `${st.number.onTime}/${st.number.total} on time` : `${st.number.trend.length} grades`) : '',
    library: st ? `${Object.keys(st.doc.library).length} read in` : '',
    study: st ? `${st.focus.streak}-day streak` : '',
  };

  return (
    <div ref={rootRef} className="school-root" role="dialog" aria-modal="true" aria-label="School" onClick={(e) => { if (e.target === rootRef.current) close(); }}>
      <HexPanel
        title="School"
        scroll={false}
        meta={<span className="hl-meta">Prometheus, Chiron, Sphinx, Kratos</span>}
        actions={
          <>
            <button className="hud-btn" onClick={() => ask('Prometheus, ')}>Ask School</button>
            <button className="hud-btn" onClick={close}>Close</button>
          </>
        }
      >
        {st ? (
          <div className="hl-body">
            <nav className="hl-nav" aria-label="School pages">
              {TABS.map((t) => (
                <button key={t.id} className={`hl-nav__t${tab === t.id ? ' is-on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                  <span className="hl-nav__n">{t.name}</span>
                  <span className="hl-nav__s">{counts[t.id]}</span>
                </button>
              ))}
              <div className="hl-nav__foot">Homework first - then everything else.</div>
            </nav>
            <main className="hl-main" key={tab}>
              {tab === 'week' ? <Week st={st} refresh={() => void refresh()} busy={busy} />
                : tab === 'grades' ? <Grades st={st} />
                  : tab === 'library' ? <Library />
                    : <Study st={st} />}
            </main>
          </div>
        ) : <div className="hl-loading">{failed ? `School couldn't open: ${failed}` : 'Opening School...'}</div>}
      </HexPanel>
    </div>
  );
}
