import { readDoc, writeDoc } from '../store';
import { emit } from '../brain/events';
import type { DepartmentId } from '../brain/types';

/*
 * Helios' own record: what he has seen (so nothing is reported twice), the items he kept,
 * his log, the standing requests departments gave him, and today's AI budget. Local only.
 */

export interface IntelItem { id: string; dept: DepartmentId; title: string; link: string; source: string; at: number; score: number; matched: string[] }
export interface HeliosLog { at: number; dept?: DepartmentId; text: string }
export interface StandingRequest { id: string; dept: DepartmentId; what: string; by: string; at: number }

export interface HeliosDoc {
  v: 1;
  seen: string[];
  items: IntelItem[];
  log: HeliosLog[];
  requests: StandingRequest[];
  budget: { date: string; used: number };
  /** Sweeps done, by "YYYY-MM-DD morning|afternoon|evening". */
  sweeps: string[];
  lastPull: number;
  /** The latest grade date already reported, so a new grade is an event only once. */
  schoolSeen: string;
}

export const DAILY_BUDGET = 40;
const DOC = 'departments/helios.json';
const empty = (): HeliosDoc => ({ v: 1, seen: [], items: [], log: [], requests: [], budget: { date: '', used: 0 }, sweeps: [], lastPull: 0, schoolSeen: '' });

export function load(): HeliosDoc {
  const d = readDoc<Partial<HeliosDoc>>(DOC, empty());
  const e = empty();
  return {
    v: 1,
    seen: Array.isArray(d.seen) ? d.seen : e.seen,
    items: Array.isArray(d.items) ? d.items : e.items,
    log: Array.isArray(d.log) ? d.log : e.log,
    requests: Array.isArray(d.requests) ? d.requests : e.requests,
    budget: d.budget && typeof d.budget === 'object' ? d.budget : e.budget,
    sweeps: Array.isArray(d.sweeps) ? d.sweeps : e.sweeps,
    lastPull: typeof d.lastPull === 'number' ? d.lastPull : 0,
    schoolSeen: typeof d.schoolSeen === 'string' ? d.schoolSeen : '',
  };
}

export function save(d: HeliosDoc, now = Date.now()): void {
  const week = now - 7 * 86_400_000;
  writeDoc(DOC, {
    ...d,
    seen: d.seen.slice(-4000),
    items: d.items.filter((i) => i.at >= week).slice(-500),
    log: d.log.slice(-300),
    sweeps: d.sweeps.slice(-60),
  });
  emit('helios:changed', { at: now });
}

export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today's AI calls so far (the count resets each day). */
export function budgetToday(d: HeliosDoc, now = new Date()): number {
  return d.budget.date === isoDay(now) ? d.budget.used : 0;
}

export function spend(d: HeliosDoc, n: number, now = new Date()): boolean {
  const used = budgetToday(d, now);
  if (used + n > DAILY_BUDGET) return false;
  d.budget = { date: isoDay(now), used: used + n };
  return true;
}

export function addRequest(dept: DepartmentId, what: string, by: string, now = Date.now()): StandingRequest | { error: string } {
  const text = what.trim().slice(0, 120);
  if (text.length < 3) return { error: 'What should Helios watch for?' };
  const d = load();
  if (d.requests.length >= 20) return { error: 'Helios already has 20 standing requests - remove one first.' };
  if (d.requests.some((r) => r.dept === dept && r.what.toLowerCase() === text.toLowerCase())) return { error: 'Helios is already watching for that.' };
  const r: StandingRequest = { id: `r${now.toString(36)}`, dept, what: text, by, at: now };
  d.requests.push(r);
  d.log.push({ at: now, dept, text: `New standing request from ${by}: "${text}"` });
  save(d, now);
  return r;
}

export function removeRequest(id: string): boolean {
  const d = load();
  const n = d.requests.length;
  d.requests = d.requests.filter((r) => r.id !== id);
  if (d.requests.length === n) return false;
  save(d);
  return true;
}
