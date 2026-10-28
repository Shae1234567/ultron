import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HexPanel } from '../hud/HexPanel';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import type { HealthEntryKind, HealthLogKind, HealthResult, HealthView } from '../../types';
import { Ctx, isTab, TABS, type Editing, type HealthCtx, type Tab } from './context';
import { dayLabel, shiftDay } from './ui';
import { TodayPage } from './TodayPage';
import { SleepPage } from './SleepPage';
import { TrainPage } from './TrainPage';
import { FoodPage } from './FoodPage';
import { BodyPage } from './BodyPage';
import { WeekPage } from './WeekPage';
import { LogPage } from './LogPage';
import { activeWorkout } from './GymSession';
import './health.css';

/*
 * The Health app: where he logs sleep, gym sets, training, food, water, pain and check-ins
 * with buttons instead of sentences, and sees how the week is really going. It sits over
 * Ultron like the council does, reads and writes the same log the Health department uses -
 * so what he tells Ultron, DMs from his phone or taps in here all lands in one place and
 * shows up here straight away.
 */

const NAMES: Record<Tab, string> = { today: 'Today', sleep: 'Sleep', train: 'Train', food: 'Food', body: 'Body', week: 'Week', log: 'Log' };
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function navLine(t: Tab, v: HealthView): string {
  switch (t) {
    case 'today': return v.readiness.level === 'unknown' ? 'no read yet' : `ready: ${v.readiness.level}`;
    case 'sleep': return v.sleep.entry ? `${v.sleep.entry.hours} h` : v.sleep.guess ? 'guess ready' : 'not logged';
    case 'train': return activeWorkout() ? 'workout running' : v.training.day.length ? `load ${v.training.day.reduce((n, t) => n + t.minutes * t.effort, 0)}` : 'nothing yet';
    case 'food': return v.food.day.length ? `${v.food.day.length} logged` : 'nothing yet';
    case 'body': { const n = v.pain.areas.filter((a) => a.active).length; return n ? `${n} sore spot${n === 1 ? '' : 's'}` : v.checkin ? 'checked in' : 'check in'; }
    case 'week': return `${v.number.nightsOver8}/${v.number.nightsLogged || 0} nights 8h+`;
    case 'log': { const n = Object.values(v.recent).reduce((s, xs) => s + xs.length, 0); return `${n} entries`; }
  }
}

export function HealthApp() {
  const health = useStore((s) => s.health);
  const setHealth = useStore((s) => s.setHealth);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>(isTab(health.tab) ? health.tab : 'today');
  const [view, setView] = useState<HealthView | null>(null);
  const [date, setDate] = useState<string>('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean; undo?: { kind: HealthEntryKind; entry: unknown } } | null>(null);
  const [failed, setFailed] = useState('');
  // What a quick button asked to start ("practice", "gym") - used once, then cleared on the next move.
  const [start, setStart] = useState<string | undefined>(health.start);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (d?: string) => {
    try {
      const v = await ultron.health.view(d || undefined);
      setView(v);
      setDate((cur) => cur || v.date);
      setFailed('');
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Load, and redraw whenever the log changes - from here, from chat or from the phone.
  useEffect(() => { void load(date); }, [date, load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = ultron.health.onChanged(() => { clearTimeout(t); t = setTimeout(() => void load(date), 120); });
    return () => { off(); clearTimeout(t); };
  }, [date, load]);

  // Opened again (from a button, the palette or a chat request) while already open: follow it.
  useEffect(() => {
    if (isTab(health.tab)) setTab(health.tab);
    setStart(health.start);
  }, [health.nonce]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    void el.offsetWidth;
    el.classList.add('is-open');
    const t = setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 40);
    return () => clearTimeout(t);
  }, []);

  const close = useCallback(() => {
    if (REDUCED) { setHealth({ open: false }); return; }
    rootRef.current?.classList.remove('is-open');
    setTimeout(() => setHealth({ open: false }), 170);
  }, [setHealth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); setTab(TABS[Number(e.key) - 1]); setEditing(null); setStart(undefined); return; }
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      // Esc in a box clears focus first; a second Esc closes.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { t.blur(); e.stopPropagation(); return; }
      e.stopPropagation();
      if (editing) setEditing(null);
      else close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, editing]);

  const showToast = useCallback((text: string, bad = false, undo?: { kind: HealthEntryKind; entry: unknown }) => {
    clearTimeout(toastTimer.current);
    setToast({ text, bad, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 8000 : 4500);
  }, []);

  const ctx: HealthCtx | null = useMemo(() => {
    if (!view) return null;
    const after = (r: HealthResult, okText?: string) => {
      if (!r.ok) showToast(r.error, true);
      else if (okText || r.detail) showToast([okText, r.detail].filter(Boolean).join(' '));
      return r;
    };
    return {
      v: view,
      date: date || view.date,
      today: view.today,
      setDate: (d: string) => { setEditing(null); setDate(d > view.today ? view.today : d); },
      refresh: () => void load(date),
      log: async (kind: HealthLogKind, p: object, okText?: string) => after(await ultron.health.log(kind, { date: date || view.date, ...p }), okText),
      edit: async (kind: HealthEntryKind, id: string, p: object, okText?: string) => {
        const r = after(await ultron.health.edit(kind, id, p), okText);
        if (r.ok) setEditing(null);
        return r;
      },
      remove: async (kind: HealthEntryKind, entry: { id: string }, what: string) => {
        const r = await ultron.health.remove(kind, entry.id);
        if (r.ok) showToast(`Deleted ${what}.`, false, { kind, entry: r.entry ?? entry });
        else showToast(r.error, true);
      },
      go: (t: Tab, e?: Editing | null) => { setTab(t); setEditing(e ?? null); setStart(undefined); },
      editing,
      setEditing,
      toast: (text: string, bad?: boolean) => showToast(text, bad),
      ask: (text: string) => {
        close();
        window.dispatchEvent(new CustomEvent('ultron:prefill', { detail: text }));
      },
    };
  }, [view, date, editing, close, showToast, load]);

  const undo = async () => {
    if (!toast?.undo) return;
    const r = await ultron.health.restore(toast.undo.kind, toast.undo.entry);
    showToast(r.ok ? 'Put back.' : r.error, !r.ok);
  };

  const d = ctx?.date ?? '';
  const page = !ctx ? null
    : tab === 'today' ? <TodayPage />
      : tab === 'sleep' ? <SleepPage />
        : tab === 'train' ? <TrainPage start={start} />
          : tab === 'food' ? <FoodPage />
            : tab === 'body' ? <BodyPage />
              : tab === 'week' ? <WeekPage />
                : <LogPage />;

  return (
    <div ref={rootRef} className="health-root" role="dialog" aria-modal="true" aria-label="Health"
      onClick={(e) => { if (e.target === rootRef.current) close(); }}>
      <HexPanel
        title="Health"
        scroll={false}
        meta={view ? <span className="hl-meta">Asclepius, Achilles, Heracles, Demeter, Hypnos</span> : undefined}
        actions={
          <>
            {ctx && (
              <div className="hl-datebar" role="group" aria-label="Day">
                <button className="hl-mini" aria-label="Previous day" onClick={() => ctx.setDate(shiftDay(d, -1))}>&lt;</button>
                <span className={`hl-datebar__d${d !== ctx.today ? ' is-past' : ''}`}>{dayLabel(d, ctx.today)}</span>
                <button className="hl-mini" aria-label="Next day" disabled={d >= ctx.today} onClick={() => ctx.setDate(shiftDay(d, 1))}>&gt;</button>
                {d !== ctx.today && <button className="hl-mini" onClick={() => ctx.setDate(ctx.today)}>Today</button>}
              </div>
            )}
            <button className="hud-btn" onClick={() => ctx?.ask('Asclepius, ')}>Ask Health</button>
            <button ref={closeRef} className="hud-btn" onClick={close}>Close</button>
          </>
        }
      >
        {ctx ? (
          <Ctx.Provider value={ctx}>
            <div className="hl-body">
              <nav className="hl-nav" aria-label="Health pages">
                {TABS.map((t, i) => (
                  <button key={t} className={`hl-nav__t${tab === t ? ' is-on' : ''}`} aria-current={tab === t ? 'page' : undefined}
                    onClick={() => ctx.go(t)} title={`Alt+${i + 1}`}>
                    <span className="hl-nav__n">{NAMES[t]}</span>
                    <span className="hl-nav__s">{navLine(t, ctx.v)}</span>
                  </button>
                ))}
                <div className="hl-nav__foot">
                  {ctx.v.streak.now > 0
                    ? <><b>{ctx.v.streak.now}</b> day{ctx.v.streak.now === 1 ? '' : 's'} logged in a row{ctx.v.streak.loggedToday ? '' : ' - log today to keep it'}</>
                    : <>Log anything today to start a streak.</>}
                </div>
              </nav>
              <main className="hl-main" key={`${tab}:${d}`}>
                {d !== ctx.today && <div className="hl-past">Logging to {dayLabel(d, ctx.today)}. <button className="link-btn" onClick={() => ctx.setDate(ctx.today)}>Back to today</button></div>}
                {page}
              </main>
            </div>
          </Ctx.Provider>
        ) : (
          <div className="hl-loading">{failed ? `Health couldn't open: ${failed}` : 'Opening Health...'}</div>
        )}
        {toast && (
          <div className={`hl-toast${toast.bad ? ' hl-toast--bad' : ''}`} role="status">
            <span>{toast.text}</span>
            {toast.undo && <button className="hl-mini" onClick={() => void undo()}>Undo</button>}
            <button className="hl-mini" aria-label="Dismiss" onClick={() => setToast(null)}>x</button>
          </div>
        )}
      </HexPanel>
    </div>
  );
}
