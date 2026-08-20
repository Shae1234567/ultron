/**
 * Cross-device sync, ported.
 *
 * Same protocol as CM8: pull the remote blob, merge it locally, push the merged
 * result. Merging (rather than last-write-wins) is what lets the phone and this
 * console both write without either clobbering the other, and it is why a meal
 * deleted on one device stays deleted instead of being resurrected.
 *
 * The sync key is a passphrase, not a token with any authority of its own - it
 * is stored on this device and sent only to the address configured here.
 */
import { mergeStates, raw, type Cm8State } from './memory';

const CFG_KEY = 'cm8_sync_cfg';

export interface SyncConfig { endpoint: string; key: string }
export type SyncState = 'idle' | 'syncing' | 'ok' | 'error';
export interface SyncStatus { state: SyncState; at: number; message: string }

let cfg: SyncConfig = (() => {
  try { return { endpoint: '', key: '', ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return { endpoint: '', key: '' }; }
})();

let status: SyncStatus = { state: 'idle', at: 0, message: 'Not set up — this device only.' };
const listeners = new Set<(s: SyncStatus) => void>();

export const getConfig = (): SyncConfig => ({ ...cfg });
export const configured = () => !!(cfg.endpoint && cfg.key);
export const getStatus = (): SyncStatus => ({ ...status });

export function onStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function setStatus(state: SyncState, message: string) {
  status = { state, at: Date.now(), message };
  listeners.forEach((fn) => { try { fn(status); } catch { /* ignore */ } });
}

export function setConfig(next: Partial<SyncConfig>) {
  cfg = { ...cfg, ...next };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  if (configured()) void syncNow();
  else setStatus('idle', 'Not set up — this device only.');
}

/** Replace local state in place, then let memory's own listeners repaint. */
function adopt(merged: Cm8State) {
  const local = raw();
  local.food = merged.food;
  local.plans = merged.plans;
  local.profile = merged.profile;
  local.tombstones = merged.tombstones;
  local.updated = merged.updated;
  try { localStorage.setItem('cm8_state_v2', JSON.stringify(local)); } catch { /* ignore */ }
}

export async function syncNow(): Promise<boolean> {
  if (!configured()) {
    setStatus('idle', 'Not set up — this device only.');
    return false;
  }
  setStatus('syncing', 'Syncing…');
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'GET',
      headers: { 'x-cm8-key': cfg.key },
      cache: 'no-store',
    });
    if (res.status === 401) {
      setStatus('error', 'Sync key rejected. Check it matches the one set on the server.');
      return false;
    }
    if (!res.ok) throw new Error('Server said ' + res.status);

    const remote = (await res.json()) as Cm8State;
    let merged = raw();
    if (remote && remote.v === 2) {
      merged = mergeStates(raw(), remote);
      adopt(merged);
    }

    const put = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cm8-key': cfg.key },
      body: JSON.stringify(merged),
    });
    if (!put.ok) throw new Error('Upload failed (' + put.status + ')');

    setStatus('ok', 'Everything is in sync.');
    return true;
  } catch (err) {
    setStatus('error', err instanceof Error ? err.message : 'Could not reach the sync server.');
    return false;
  }
}

/* Sync when the console regains focus, which is when the phone is most likely
   to have written something since. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && configured()) void syncNow();
  });
}
