import type {
  AddonsReport, AgentInfo, AppsStatus, BrainUsage, CloudPreset, VoiceStatus, MindGraph, SchoolState, CouncilBriefing, CouncilState, FoodItem, HealthEntryKind, HealthLogKind, HealthResult, HealthView, TableMatch, DashSnapshot, FocusState, LearnSummary, SpotifyNow, TestRun, ApprovalRequest, BrainEvent, BrainStatus, BrowserFrame, D2LStatus, DiscordStatus, IndexedFile, IndexedFolder,
  MemoryHit, MemoryUpdate, NewsResult, OllamaStatus, Quota, SecretName, Settings, Task, TranscriptEntry, VaultNote, WebLogins, VaultStats, WeatherResult,
} from './index';

type Ok = { ok: boolean; error?: string };

export interface UltronBridge {
  win: {
    minimize(): Promise<void>;
    maximize(): Promise<boolean>;
    close(): Promise<void>;
    show(): Promise<void>;
    onState(cb: (s: { maximized: boolean }) => void): () => void;
  };
  notify: {
    show(title: string, body: string): Promise<{ ok: boolean; skipped?: boolean }>;
  };
  brain: {
    ask(text: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<{ ok: boolean; runId?: string; error?: string }>;
    cancel(runId: string): Promise<void>;
    status(): Promise<BrainStatus>;
    usage(): Promise<BrainUsage>;
    recheck(): Promise<BrainStatus>;
    once(p: { system: string; user?: string; tier?: 'main' | 'fast'; temperature?: number }): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    greet(kind: 'boot' | 'wake' | 'checkin'): Promise<{ ok: boolean; text?: string; error?: string }>;
    agents(): Promise<AgentInfo[]>;
    liveVoice(): Promise<{ key: string; model: string | null; system?: string }>;
    onEvent(cb: (e: BrainEvent) => void): () => void;
  };
  council: {
    state(): Promise<CouncilState>;
    line(id: string): Promise<string>;
    convene(): Promise<CouncilBriefing>;
    phoneLink(): Promise<{ code: string; expires: number }>;
    helios(on: boolean): Promise<CouncilState['helios']>;
    onReview(cb: (r: { date: string; text: string }) => void): () => void;
  };
  health: {
    view(date?: string): Promise<HealthView>;
    log(kind: HealthLogKind, p: unknown): Promise<HealthResult>;
    edit(kind: HealthEntryKind, id: string, p: unknown): Promise<HealthResult>;
    remove(kind: HealthEntryKind, id: string): Promise<HealthResult>;
    restore(kind: HealthEntryKind, entry: unknown): Promise<HealthResult>;
    preview(text: string): Promise<{ items: FoodItem[]; unknown: string[] }>;
    search(q: string): Promise<TableMatch[]>;
    barcode(code: string): Promise<FoodItem | { error: string }>;
    saveUsual(name: string, p: { text?: string; exact?: FoodItem[] }): Promise<HealthResult>;
    removeUsual(name: string): Promise<HealthResult>;
    scheduleAdd(p: { kind: string; sport?: string; day: number; start: string; minutes: number; note?: string }): Promise<HealthResult>;
    scheduleRemove(id: string): Promise<HealthResult>;
    program(action: 'on' | 'off' | 'restart'): Promise<HealthResult>;
    onChanged(cb: (p: { at: number }) => void): () => void;
    onNudge(cb: (p: { text: string }) => void): () => void;
  };
  approvals: {
    respond(id: string, approved: boolean, all?: boolean): Promise<void>;
    pending(): Promise<ApprovalRequest[]>;
    onRequest(cb: (req: ApprovalRequest) => void): () => void;
    onSettled(cb: (p: { id: string; approved: boolean }) => void): () => void;
  };
  clouds: {
    presets(): Promise<CloudPreset[]>;
    add(p: { preset?: string; label?: string; baseUrl?: string; model?: string; key: string; accountId?: string }): Promise<{ ok: boolean; id?: string; detail?: string; error?: string }>;
    remove(id: string): Promise<boolean>;
    /** Saves (and tests) whatever key is on the clipboard for this service - the page never sees it. */
    pasteKey(id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
    setKey(id: string, value: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  };
  secrets: {
    status(): Promise<Record<SecretName, boolean>>;
    set(name: SecretName, value: string): Promise<{ ok: boolean; status?: Record<SecretName, boolean>; detail?: string; error?: string }>;
  };
  discord: {
    status(): Promise<DiscordStatus>;
  };
  addons: {
    status(): Promise<AddonsReport>;
    setHindsight(on: boolean): Promise<AddonsReport>;
    setAskBrowserAgent(on: boolean): Promise<boolean>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: Partial<Settings>): Promise<Settings>;
  };
  ollama: {
    status(): Promise<OllamaStatus>;
    pull(model: string): Promise<Ok>;
    onPullProgress(cb: (p: { model: string; status: string; completed?: number; total?: number; done?: boolean; error?: string }) => void): () => void;
  };
  vault: {
    stats(): Promise<VaultStats>;
    recent(limit?: number): Promise<VaultNote[]>;
    search(q: string): Promise<MemoryHit[]>;
    profile(): Promise<string>;
    saveProfile(text: string): Promise<Ok>;
    open(rel?: string): Promise<{ ok: boolean; via?: 'obsidian' | 'explorer'; hint?: string; error?: string }>;
    reveal(): Promise<Ok>;
    choose(): Promise<{ ok: boolean; settings?: Settings }>;
    reindex(): Promise<VaultStats>;
    graph(): Promise<MindGraph>;
    read(rel: string): Promise<string | null>;
    onUpdated(cb: (u: MemoryUpdate) => void): () => void;
  };
  web: {
    status(): Promise<WebLogins>;
    signIn(url?: string): Promise<{ ok: boolean; error?: string }>;
    clear(): Promise<WebLogins>;
    onChanged(cb: (s: WebLogins) => void): () => void;
  };
  transcript: {
    load(): Promise<TranscriptEntry[]>;
    save(entries: TranscriptEntry[]): Promise<boolean>;
  };
  tasks: {
    list(): Promise<Task[]>;
    add(input: { title: string; due?: string; priority?: string }): Promise<{ ok: boolean; task?: Task; error?: string }>;
    complete(id: string): Promise<Task | null>;
    reopen(id: string): Promise<Task | null>;
    remove(id: string): Promise<Task | null>;
    snooze(id: string, minutes: number): Promise<Task | null>;
    update(id: string, patch: Partial<Pick<Task, 'title' | 'notes' | 'priority'>> & { due?: string | null }): Promise<Task | null>;
    clearDone(): Promise<number>;
    onChanged(cb: (all: Task[]) => void): () => void;
    onReminder(cb: (p: { task: Task; missed: boolean }) => void): () => void;
  };
  browser: {
    onFrame(cb: (f: BrowserFrame) => void): () => void;
    onClosed(cb: (c: { id: string; runId: string }) => void): () => void;
  };
  apps: {
    status(): Promise<AppsStatus>;
    connect(slug: string): Promise<{ ok: boolean; redirectUrl?: string; error?: string; setupUrl?: string }>;
    disconnect(slug: string): Promise<Ok>;
    signIn(): Promise<{ ok: boolean; error?: string; status?: AppsStatus }>;
    signOut(): Promise<AppsStatus>;
    onChanged(cb: (s: AppsStatus) => void): () => void;
  };
  briefing: {
    now(): Promise<{ lines: string[]; at: number } | null>;
    onReady(cb: (b: { lines: string[]; at: number }) => void): () => void;
  };
  focus: {
    state(): Promise<FocusState>;
    start(subject: string, minutes?: number): Promise<FocusState>;
    stop(): Promise<FocusState>;
    onChanged(cb: (s: FocusState) => void): () => void;
    onDone(cb: (s: { subject: string; minutes: number; streak: number }) => void): () => void;
  };
  learn: {
    summary(): Promise<LearnSummary>;
    reflect(): Promise<{ lessons: number; skills: number; reviewed: number }>;
    selfTest(): Promise<TestRun>;
    onUpdated(cb: (s: LearnSummary) => void): () => void;
  };
  dashboard: {
    get(): Promise<DashSnapshot>;
    refresh(): Promise<DashSnapshot>;
    spotify(action?: 'toggle' | 'next' | 'previous'): Promise<SpotifyNow>;
    open(url: string): Promise<boolean>;
    onUpdate(cb: (s: DashSnapshot) => void): () => void;
  };
  voice: {
    status(): Promise<VoiceStatus>;
    prepare(): Promise<VoiceStatus>;
    voices(): Promise<{ id: string; label: string }[]>;
    synth(text: string, voice: string, speed: number): Promise<{ samples: Float32Array; sampleRate: number }>;
    onChanged(cb: (s: VoiceStatus) => void): () => void;
  };
  powerschool: {
    status(): Promise<{ baseUrl: string; signedIn: boolean; error?: string }>;
    signIn(): Promise<{ baseUrl: string; signedIn: boolean; error?: string }>;
    signOut(): Promise<{ baseUrl: string; signedIn: boolean; error?: string }>;
    open(): Promise<void>;
    onChanged(cb: (s: { baseUrl: string; signedIn: boolean; error?: string }) => void): () => void;
  };
  trackers: {
    collected(kind: 'pc' | 'games'): Promise<string[]>;
    forget(kind: 'pc' | 'games'): Promise<boolean>;
  };
  school: {
    state(): Promise<SchoolState>;
    refresh(): Promise<{ ok: boolean; error?: string }>;
    courses(): Promise<{ ok: true; courses: { course: string; courseId: number; topics: number; inLibrary: number }[] } | { ok: false; error: string }>;
    sync(course?: string): Promise<{ ok: true; read: string[]; skipped: number; failed: string[]; left: number } | { ok: false; error: string }>;
    search(q: string, course?: string): Promise<{ rel: string; title: string; course: string; text: string; score: number }[]>;
    plan(p: { what: string; due: string; total?: number; block?: number }): Promise<{ planned: number; blocks: string[]; short_of_time?: string } | { error: string }>;
    onChanged(cb: (p: { at: number }) => void): () => void;
  };
  d2l: {
    status(): Promise<D2LStatus>;
    signIn(): Promise<D2LStatus>;
    signOut(): Promise<D2LStatus>;
    open(): Promise<void>;
    sync(): Promise<{ ok: boolean; added?: string[]; skipped?: number; error?: string }>;
    onChanged(cb: (s: D2LStatus) => void): () => void;
  };
  news: {
    fetch(manual?: boolean): Promise<NewsResult>;
    quota(): Promise<Quota>;
    hasKey(): Promise<boolean>;
  };
  research: {
    weather(place: string): Promise<WeatherResult | null>;
  };
  system: {
    hardwareStats(): Promise<{ cpuPercent: number; ramPercent: number; ramUsedGB: number; ramTotalGB: number }>;
  };
  files: {
    addFolder(): Promise<{ ok: boolean; folders: IndexedFolder[] }>;
    removeFolder(p: string): Promise<IndexedFolder[]>;
    list(limit?: number): Promise<IndexedFile[]>;
    search(q: string): Promise<IndexedFile[]>;
    rebuild(): Promise<number>;
    stats(): Promise<{ folderCount: number; fileCount: number; capped: boolean }>;
    reveal(p: string): Promise<boolean>;
    read(p: string): Promise<{ ok: boolean; content?: string; error?: string }>;
    write(p: string, content: string): Promise<Ok>;
    rename(p: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    move(p: string, destFolder: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    delete(p: string): Promise<Ok>;
    createFile(folder: string, name: string, content?: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    createFolder(folder: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  backup: {
    export(): Promise<{ ok: boolean; path?: string; error?: string }>;
    import(): Promise<Ok>;
  };
  tray: {
    isAutoLaunchEnabled(): Promise<boolean>;
    setAutoLaunch(enabled: boolean): Promise<boolean>;
  };
  clipboard: {
    onNewText(cb: (text: string) => void): () => void;
  };
  ui: {
    onFocus(cb: (p: { tab?: string; health?: string; school?: string }) => void): () => void;
  };
  app: {
    openExternal(url: string): Promise<boolean>;
    versions(): Promise<{ app: string; packaged: boolean; electron: string; chrome: string; node: string; platform: string }>;
  };
}

declare global {
  interface Window { ultron: UltronBridge }
}
