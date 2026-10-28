import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { emit } from '../brain/events';
import { TOOLS_ROOT } from '../addons';

/*
 * The main-process side of Ultron's voice (worker.ts does the speaking). It starts the voice
 * process, reports download progress to the screen, hands sentences over and gets audio back.
 * The model stays loaded while it's being used and is unloaded after 15 quiet minutes, so it
 * isn't holding memory while he games.
 */

export type VoiceState = 'off' | 'downloading' | 'loading' | 'ready' | 'error';
export interface VoiceStatus {
  state: VoiceState;
  /** On disk already (so starting is a ~1 s load, not a download). */
  downloaded: boolean;
  /** 0-1 while downloading. */
  progress?: number;
  error?: string;
}

/** The voices worth offering: the male ones, deepest first (median pitch measured on his PC, 11 Oct 2026). */
export const ULTRON_VOICES: { id: string; label: string }[] = [
  { id: 'am_michael', label: 'Michael - deep, smooth American (recommended)' },
  { id: 'am_onyx', label: 'Onyx - the deepest American' },
  { id: 'bm_lewis', label: 'Lewis - very deep British' },
  { id: 'am_echo', label: 'Echo - deep American' },
  { id: 'am_puck', label: 'Puck - low American, lively' },
  { id: 'am_adam', label: 'Adam - low American' },
  { id: 'bm_fable', label: 'Fable - low British' },
  { id: 'am_liam', label: 'Liam - mid American' },
  { id: 'bm_daniel', label: 'Daniel - mid British' },
  { id: 'am_fenrir', label: 'Fenrir - mid American, rough' },
  { id: 'bm_george', label: 'George - mid British' },
];

const DTYPE = 'fp32' as const;
const MODEL_FILE = path.join('onnx-community', 'Kokoro-82M-v1.0-ONNX', 'onnx', 'model.onnx');
const IDLE_UNLOAD_MS = 15 * 60_000;

let child: UtilityProcess | null = null;
let status: VoiceStatus = { state: 'off', downloaded: false };
let nextId = 1;
const pending = new Map<number, { resolve: (a: { samples: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>();
const fileProgress = new Map<string, { loaded: number; total: number }>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

// With the other add-ons in ~/UltronTools: it survives reinstalls and is only ever downloaded once.
const cacheDir = () => path.join(TOOLS_ROOT, 'voice-models');
const isDownloaded = () => {
  try { return fs.statSync(path.join(cacheDir(), MODEL_FILE)).size > 100_000_000; } catch { return false; }
};

function setStatus(next: Partial<VoiceStatus>): void {
  status = { ...status, ...next, downloaded: isDownloaded() };
  emit('voice:changed', status);
}

export function voiceStatus(): VoiceStatus {
  return { ...status, downloaded: isDownloaded() };
}

function settleReady(err?: Error): void {
  const w = readyWaiters;
  readyWaiters = [];
  for (const x of w) (err ? x.reject(err) : x.resolve());
}

function bumpIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => stopVoice(), IDLE_UNLOAD_MS);
}

/** Starts the voice process and loads (downloading first, if needed) the model. Safe to call often. */
export function prepareVoice(): void {
  bumpIdle();
  if (child) return;
  fileProgress.clear();
  const worker = utilityProcess.fork(path.join(__dirname, 'voiceWorker.js'), [], { serviceName: 'Ultron voice', stdio: 'ignore' });
  child = worker;
  setStatus({ state: isDownloaded() ? 'loading' : 'downloading', progress: undefined, error: undefined });
  worker.on('message', (m: { type: string; id?: number; file?: string; loaded?: number; total?: number; samples?: Float32Array; sampleRate?: number; message?: string }) => {
    if (m.type === 'progress' && m.file) {
      fileProgress.set(m.file, { loaded: m.loaded ?? 0, total: m.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of fileProgress.values()) { loaded += f.loaded; total += f.total; }
      if (total > 5_000_000) setStatus({ state: 'downloading', progress: Math.min(1, loaded / total) });
    } else if (m.type === 'ready') {
      setStatus({ state: 'ready', progress: undefined, error: undefined });
      settleReady();
    } else if (m.type === 'failed') {
      const err = m.message ?? 'The voice model did not load.';
      setStatus({ state: 'error', error: /fetch|network|ENOTFOUND|ECONN/i.test(err) ? 'Could not download the voice - is the internet on?' : err });
      settleReady(new Error(err));
      stopVoice(false);
    } else if (m.id !== undefined) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === 'audio' && m.samples && m.sampleRate) p.resolve({ samples: m.samples, sampleRate: m.sampleRate });
      else p.reject(new Error(m.message ?? 'The voice could not say that.'));
    }
  });
  worker.on('exit', () => {
    if (child !== worker) return;
    child = null;
    for (const p of pending.values()) p.reject(new Error('The voice process stopped.'));
    pending.clear();
    settleReady(new Error('The voice process stopped.'));
    if (status.state !== 'error') setStatus({ state: 'off', progress: undefined });
  });
  worker.postMessage({ type: 'load', cacheDir: cacheDir(), dtype: DTYPE });
}

/** Unloads the model (it stays on disk). */
export function stopVoice(resetState = true): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const c = child;
  child = null;
  if (c) c.kill();
  for (const p of pending.values()) p.reject(new Error('The voice process stopped.'));
  pending.clear();
  if (resetState && status.state !== 'error') setStatus({ state: 'off', progress: undefined });
}

function whenReady(): Promise<void> {
  if (status.state === 'ready' && child) return Promise.resolve();
  prepareVoice();
  return new Promise((resolve, reject) => readyWaiters.push({ resolve, reject }));
}

/** One sentence in, audio out (mono, 24 kHz). */
export async function synthesize(text: string, voice: string, speed: number): Promise<{ samples: Float32Array; sampleRate: number }> {
  await whenReady();
  bumpIdle();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child?.postMessage({ type: 'speak', id, text: text.slice(0, 600), voice: ULTRON_VOICES.some((v) => v.id === voice) ? voice : 'am_michael', speed: Math.min(1.6, Math.max(0.6, speed)) });
  });
}
