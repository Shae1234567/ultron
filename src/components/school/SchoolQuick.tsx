import { useEffect, useState } from 'react';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import type { SchoolState } from '../../types';

/** School in the Systems sidebar, under Health: the next thing due (or what's overdue) and a button per page. */
export function SchoolQuick() {
  const setSchool = useStore((s) => s.setSchool);
  const [st, setSt] = useState<SchoolState | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => void ultron.school.state().then((x) => { if (live) setSt(x); }).catch(() => undefined);
    load();
    const off = ultron.school.onChanged(load);
    const t = setInterval(load, 10 * 60_000);
    return () => { live = false; off(); clearInterval(t); };
  }, []);

  const c = st?.doc.cache;
  const next = c?.due.filter((d) => !d.completed && d.due && Date.parse(d.due) >= Date.now()).sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!))[0];
  const line = !c ? 'not read from D2L yet'
    : !c.signedIn ? 'D2L not signed in'
      : c.overdue.length ? `${c.overdue.length} overdue`
        : next ? `next: ${next.name.slice(0, 26)} (${new Date(next.due!).toLocaleDateString('en-CA', { weekday: 'short' })})`
          : 'nothing due this week';
  return (
    <div className="health-quick">
      <div className="hq-head">
        <button className="label-xs hq-open" onClick={() => setSchool({ open: true, tab: 'week' })}>School</button>
        <span className="hq-read"><b className={c?.overdue.length || c?.signedIn === false ? 'rest' : 'easy'}>{line}</b></span>
      </div>
      <div className="hq-btns">
        <button className="hl-mini" onClick={() => setSchool({ open: true, tab: 'week' })}>Due</button>
        <button className="hl-mini" onClick={() => setSchool({ open: true, tab: 'grades' })}>Grades</button>
        <button className="hl-mini" onClick={() => setSchool({ open: true, tab: 'library' })}>Notes</button>
        <button className="hl-mini" onClick={() => setSchool({ open: true, tab: 'study' })}>Focus</button>
      </div>
    </div>
  );
}
