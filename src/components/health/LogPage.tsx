import { useMemo, useState } from 'react';
import type { HealthEntryKind } from '../../types';
import { setsText } from '../../../electron/departments/health/workouts';
import { useHealth, type Editing, type Tab } from './context';
import { Chips, Empty, Sec, clock, dayLabel } from './ui';

/*
 * Everything logged in the last five weeks, newest first - from the app, from chat and from
 * the phone alike - with where it came from. Any entry can be opened to edit or deleted
 * (with Undo). "Copy for my coach" puts two weeks of training on the clipboard as plain text.
 */

type Kind = 'all' | HealthEntryKind;
interface Row { kind: HealthEntryKind; id: string; date: string; at: number; title: string; text: string; source?: string; open?: { tab: Tab; editing: Editing } ; raw: { id: string } }

const KIND_LABEL: Record<HealthEntryKind, string> = { sleep: 'Sleep', training: 'Train', food: 'Food', water: 'Water', pain: 'Pain', checkins: 'Check-in' };
const SOURCE: Record<string, string> = { chat: 'said in chat', phone: 'from your phone', app: '', pc: 'PC guess, confirmed', label: 'label photo', barcode: 'barcode', checkin: 'check-in' };

export function LogPage() {
  const h = useHealth();
  const { v } = h;
  const [kind, setKind] = useState<Kind>('all');
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    const r: Row[] = [];
    for (const s of v.recent.sleep) r.push({ kind: 'sleep', id: s.id, date: s.date, at: s.at, title: `${s.hours} h`, text: `${s.bed} - ${s.wake}${s.quality ? `, quality ${s.quality}/5` : ''}${s.tags?.length ? `, ${s.tags.join(', ')}` : ''}${s.note ? ` - ${s.note}` : ''}`, source: s.source, open: { tab: 'sleep', editing: { kind: 'sleep', entry: s } }, raw: s });
    for (const t of v.recent.training) r.push({ kind: 'training', id: t.id, date: t.date, at: t.at, title: `${t.what || t.kind}`, text: `${t.minutes} min, effort ${t.effort}, load ${t.minutes * t.effort}${t.exercises?.length ? ` | ${t.exercises.map((e) => `${e.name} ${setsText(e.sets)}`).join('; ')}` : ''}${t.note ? ` - ${t.note}` : ''}`, source: t.source, open: { tab: 'train', editing: { kind: 'training', entry: t } }, raw: t });
    for (const f of v.recent.food) r.push({ kind: 'food', id: f.id, date: f.date, at: f.at, title: f.meal ?? 'food', text: `${f.text}${f.unknown.length ? ` (not recognised: ${f.unknown.join(', ')})` : ''}`, source: f.source, open: { tab: 'food', editing: { kind: 'food', entry: f } }, raw: f });
    for (const w of v.recent.water) r.push({ kind: 'water', id: w.id, date: w.date, at: w.at, title: `${w.ml > 0 ? '+' : ''}${w.ml} ml`, text: 'water', raw: w });
    for (const p of v.recent.pain) r.push({ kind: 'pain', id: p.id, date: p.date, at: p.at, title: `${p.side ? `${p.side} ` : ''}${p.where}`, text: `${p.severity}/10${p.feel ? `, ${p.feel}` : ''}${p.swelling ? ', swollen' : ''}${p.status ? ` (${p.status})` : ''}${p.note ? ` - ${p.note}` : ''}`, open: { tab: 'body', editing: { kind: 'pain', entry: p } }, raw: p });
    for (const c of v.recent.checkins) r.push({ kind: 'checkins', id: c.id, date: c.date, at: c.at, title: 'check-in', text: `energy ${c.energy ?? '-'}/5, soreness ${c.soreness ?? '-'}/5${c.note ? ` - ${c.note}` : ''}`, raw: c });
    return r.filter((x) => kind === 'all' || x.kind === kind).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  }, [v.recent, kind]);

  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  const copyForCoach = async () => {
    const since = new Date(`${h.today}T12:00:00`);
    since.setDate(since.getDate() - 13);
    const iso = since.toISOString().slice(0, 10);
    const lines = v.recent.training.filter((t) => t.date >= iso).sort((a, b) => a.date.localeCompare(b.date)).map((t) =>
      `${t.date}  ${t.what || t.kind} - ${t.minutes} min, effort ${t.effort}/10${t.exercises?.length ? `\n            ${t.exercises.map((e) => `${e.name} ${setsText(e.sets)}`).join('; ')}` : ''}`);
    const text = [`Training, last 2 weeks (to ${h.today})`, ...lines, '', `Sessions: ${lines.length}. Effort is how hard it felt, 1-10.`].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      h.toast('Could not reach the clipboard.', true);
    }
  };

  return (
    <div className="hl-page">
      <Sec right={<button className="hud-btn" onClick={() => void copyForCoach()}>{copied ? 'Copied' : 'Copy for my coach'}</button>}>Everything logged</Sec>
      <Chips label="Show" value={kind} onChange={setKind} options={[{ id: 'all', text: 'All' }, ...(Object.keys(KIND_LABEL) as HealthEntryKind[]).map((k) => ({ id: k, text: KIND_LABEL[k] }))]} />
      {byDay.length ? byDay.map(([d, rs]) => (
        <section key={d} className="hl-day">
          <div className="hl-day__h">{dayLabel(d, h.today)}<span>{d}</span></div>
          <ul className="hl-entries">
            {rs.map((r) => (
              <li key={r.id} className={`hl-entry hl-entry--${r.kind}`}>
                <span className="hl-entry__k">{KIND_LABEL[r.kind]}</span>
                <span className="hl-entry__t"><b>{r.title}</b> {r.text}{r.source && SOURCE[r.source] ? <em> - {SOURCE[r.source]}</em> : null}</span>
                <span className="hl-entry__d">{clock(r.at)}</span>
                {r.open ? <button className="hl-mini" onClick={() => { h.setDate(r.date); h.go(r.open!.tab, r.open!.editing); }}>Edit</button> : <span />}
                <button className="hl-mini" onClick={() => void h.remove(r.kind, r.raw, `that ${KIND_LABEL[r.kind].toLowerCase()} entry`)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      )) : <Empty>Nothing logged in the last five weeks{kind !== 'all' ? ' of this kind' : ''}. Log from the other pages, tell Ultron, or DM your bot from your phone.</Empty>}
    </div>
  );
}
