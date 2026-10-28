import { createContext, useContext } from 'react';
import type { FoodEntry, HealthEntryKind, HealthLogKind, HealthResult, HealthView, PainEntry, SleepEntry, TrainingEntry } from '../../types';

export type Tab = 'today' | 'sleep' | 'train' | 'food' | 'body' | 'week' | 'log';
export const TABS: Tab[] = ['today', 'sleep', 'train', 'food', 'body', 'week', 'log'];
export const isTab = (t: unknown): t is Tab => TABS.includes(t as Tab);

/** An entry opened for editing from the history (or a tile): the page shows its form filled in. */
export type Editing =
  | { kind: 'sleep'; entry: SleepEntry }
  | { kind: 'training'; entry: TrainingEntry }
  | { kind: 'food'; entry: FoodEntry }
  | { kind: 'pain'; entry: PainEntry };

export interface HealthCtx {
  v: HealthView;
  /** The day being looked at and logged to. */
  date: string;
  today: string;
  setDate: (d: string) => void;
  /** Re-reads the day (after a settings change, which doesn't touch the log). */
  refresh: () => void;
  log: (kind: HealthLogKind, p: object, okText?: string) => Promise<HealthResult>;
  edit: (kind: HealthEntryKind, id: string, p: object, okText?: string) => Promise<HealthResult>;
  remove: (kind: HealthEntryKind, entry: { id: string }, what: string) => Promise<void>;
  go: (tab: Tab, editing?: Editing | null) => void;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  toast: (text: string, bad?: boolean) => void;
  /** Closes the app and puts a question in Ultron's box, addressed to a Health agent. */
  ask: (text: string) => void;
}

export const Ctx = createContext<HealthCtx | null>(null);

export function useHealth(): HealthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useHealth outside the Health app');
  return c;
}
