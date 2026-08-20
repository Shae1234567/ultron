import { create } from 'zustand';
import type {
  Article, CoreState, IndexedFolder, OllamaStatus, Quota, Region, Settings, TranscriptEntry,
} from '../types';
import type { Specialist } from '../agents/types';

export type RightTab = 'system' | 'files' | 'connectors' | 'agents';
export type Overlay =
  | null
  | { kind: 'settings' }
  | { kind: 'ollama' }
  | { kind: 'connector'; id: string }
  | { kind: 'memory' }
  | { kind: 'agent'; id: string }
  | { kind: 'github' }
  | { kind: 'notion' }
  | { kind: 'discord' }
  | { kind: 'obsidian' }
  | { kind: 'cm8' }
  | { kind: 'browser' }
  | { kind: 'worldmap' }
  | { kind: 'google' };

interface UltronState {
  /* core */
  coreState: CoreState;
  setCoreState: (s: CoreState) => void;
  /** Mirrors conversation.ts's activeRequestId so UI can react to it - a plain
   *  module variable is not observable by React. */
  busy: boolean;
  setBusy: (b: boolean) => void;

  /* conversation */
  transcript: TranscriptEntry[];
  pushEntry: (e: Omit<TranscriptEntry, 'id' | 'at'> & { id?: string }) => string;
  appendToEntry: (id: string, token: string) => void;
  finishEntry: (id: string, patch?: Partial<TranscriptEntry>) => void;
  clearTranscript: () => void;

  /* backend status */
  ollama: OllamaStatus | null;
  setOllama: (s: OllamaStatus) => void;

  /* settings */
  settings: Settings | null;
  setSettings: (s: Settings) => void;

  /* memory - Atlas's persistent knowledge of the operator, editable in-app */
  memory: string;
  setMemory: (m: string) => void;

  /* active specialist - null means plain Atlas, no persona layered on */
  activeAgent: Specialist | null;
  setActiveAgent: (a: Specialist | null) => void;

  /* news */
  articles: Article[];
  quota: Quota | null;
  newsError: string | null;
  newsLoading: boolean;
  lastFetch: number | null;
  regionFilter: Region | 'ALL';
  relevance: Record<string, { status: 'pending' | 'done' | 'failed'; text: string }>;
  setNews: (p: { articles?: Article[]; quota?: Quota; error?: string | null; loading?: boolean; lastFetch?: number }) => void;
  setRegionFilter: (r: Region | 'ALL') => void;
  setRelevance: (id: string, v: { status: 'pending' | 'done' | 'failed'; text: string }) => void;

  /* right column */
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  folders: IndexedFolder[];
  setFolders: (f: IndexedFolder[]) => void;

  /* overlays */
  overlay: Overlay;
  setOverlay: (o: Overlay) => void;

  /* boot sequence - tied to the same real startup checks App.tsx already
     runs, not a decorative fake progress bar */
  booting: boolean;
  bootChecks: Record<'memory' | 'settings' | 'brain' | 'voice', 'pending' | 'ok' | 'warn'>;
  setBootCheck: (key: 'memory' | 'settings' | 'brain' | 'voice', status: 'ok' | 'warn') => void;
  finishBoot: () => void;
}

let seq = 0;
const nextId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

// A long-running HUD session accumulates transcript entries forever with no
// cap otherwise, and every streamed token does an O(n) copy of the whole
// array - on a long session that copy competes with the orb/particle rAF
// loops for the same frame budget, right when speaking/thinking makes it
// most visible.
const MAX_TRANSCRIPT = 400;

export const useStore = create<UltronState>((set) => ({
  coreState: 'idle',
  setCoreState: (coreState) => set({ coreState }),
  busy: false,
  setBusy: (busy) => set({ busy }),

  transcript: [],
  pushEntry: (e) => {
    const id = e.id ?? nextId();
    set((s) => {
      const next = [...s.transcript, { ...e, id, at: Date.now() }];
      return { transcript: next.length > MAX_TRANSCRIPT ? next.slice(-MAX_TRANSCRIPT) : next };
    });
    return id;
  },
  appendToEntry: (id, token) =>
    set((s) => ({
      transcript: s.transcript.map((t) => (t.id === id ? { ...t, text: t.text + token } : t)),
    })),
  finishEntry: (id, patch) =>
    set((s) => ({
      transcript: s.transcript.map((t) => (t.id === id ? { ...t, streaming: false, ...patch } : t)),
    })),
  clearTranscript: () => set({ transcript: [] }),

  ollama: null,
  setOllama: (ollama) => set({ ollama }),

  settings: null,
  setSettings: (settings) => set({ settings }),

  memory: '',
  setMemory: (memory) => set({ memory }),

  activeAgent: null,
  setActiveAgent: (activeAgent) => set({ activeAgent }),

  articles: [],
  quota: null,
  newsError: null,
  newsLoading: false,
  lastFetch: null,
  regionFilter: 'ALL',
  relevance: {},
  setNews: (p) =>
    set((s) => {
      const articles = p.articles ?? s.articles;
      // Every auto-refresh (as often as every 15 min) added to `relevance`
      // forever with nothing ever removed - prune to only ids still on screen.
      let relevance = s.relevance;
      if (p.articles) {
        const live = new Set(articles.map((a) => a.id));
        const pruned: typeof s.relevance = {};
        for (const [id, v] of Object.entries(s.relevance)) if (live.has(id)) pruned[id] = v;
        relevance = pruned;
      }
      return {
        articles,
        relevance,
        quota: p.quota ?? s.quota,
        newsError: p.error === undefined ? s.newsError : p.error,
        newsLoading: p.loading ?? s.newsLoading,
        lastFetch: p.lastFetch ?? s.lastFetch,
      };
    }),
  setRegionFilter: (regionFilter) => set({ regionFilter }),
  setRelevance: (id, v) => set((s) => ({ relevance: { ...s.relevance, [id]: v } })),

  rightTab: 'system',
  setRightTab: (rightTab) => set({ rightTab }),
  folders: [],
  setFolders: (folders) => set({ folders }),

  overlay: null,
  setOverlay: (overlay) => set({ overlay }),

  booting: true,
  bootChecks: { memory: 'pending', settings: 'pending', brain: 'pending', voice: 'pending' },
  setBootCheck: (key, status) => set((s) => ({ bootChecks: { ...s.bootChecks, [key]: status } })),
  finishBoot: () => set({ booting: false }),
}));

/**
 * Speech-to-text capability, learned at runtime rather than assumed.
 * Whisper runs locally in a worker; the first load downloads model weights,
 * so the UI needs to distinguish "still loading" from "actually works".
 */
export type SttStatus = 'unknown' | 'loading' | 'ok' | 'transcribing' | 'unavailable';

interface SttState {
  stt: SttStatus;
  sttReason: string;
  sttProgress: number; // 0..1 while downloading
  setStt: (s: SttStatus, reason?: string) => void;
  setSttProgress: (p: number) => void;
}

export const useSttStore = create<SttState>((set) => ({
  stt: 'unknown',
  sttReason: '',
  sttProgress: 0,
  setStt: (stt, sttReason = '') => set({ stt, sttReason }),
  setSttProgress: (sttProgress) => set({ sttProgress }),
}));
