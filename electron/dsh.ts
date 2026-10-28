import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS_ROOT } from './addons';
import { getSecret, hasSecret, type SecretName } from './secrets';
import { cloudStatus } from './clouds';

/*
 * DeepSeek Harness (github.com/deepseek-ai/deepseek-harness, `dsh`) - a separate coding agent
 * installed in ~/UltronTools/dsh (9 Oct 2026, v0.2.0-rc.2, a developer preview). Ultron and
 * every council agent can hand it a coding or building job; it works headless and reports back.
 *
 * What was checked on this PC before wiring it in:
 *  - Its Windows sandbox keeps WRITES inside the job's folder (its file tool and its PowerShell
 *    were both refused outside it; writes to the Temp folder are allowed, as in most sandboxes).
 *  - It does NOT limit reads, network or seeing other processes - its own docs say so. So every
 *    run is approved by the operator first, its web tools are switched off, and it never gets
 *    private work.
 *  - Off on every run: its session telemetry (DSH_TELEMETRY_MODE=DISABLED), the plugin that
 *    attaches the whole session log (up to 8 MB, folder paths included) to DeepSeek API
 *    requests, and the one that attaches its plugin list.
 *  - Groq's free tier can't run it (8,000 tokens a minute; one dsh request is about 7,500).
 *    It runs on DeepSeek's own API when there is a DeepSeek key, else on a free OpenRouter model.
 */

export const DSH_DIR = path.join(TOOLS_ROOT, 'dsh');
const BIN = path.join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
export const WORKSPACES = path.join(DSH_DIR, 'workspace');

export function installed(): boolean {
  return fs.existsSync(BIN);
}

export function version(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

export interface HarnessModel { provider: string; model: string; keyEnv: string; secret: SecretName; label: string }

/** DeepSeek's own API when there is a working DeepSeek key with credit; otherwise a free OpenRouter model. */
export function pickModel(): HarnessModel | null {
  const status = (id: string) => cloudStatus().find((c) => c.id === id);
  const usable = (id: string, secret: SecretName) => hasSecret(secret) && status(id)?.valid !== false && !status(id)?.outOfCredits && !status(id)?.off;
  if (usable('deepseek', 'DEEPSEEK_API_KEY')) {
    return { provider: 'deepseek-official', model: 'deepseek-flash', keyEnv: 'DEEPSEEK_API_KEY', secret: 'DEEPSEEK_API_KEY', label: 'DeepSeek V4.1 Flash' };
  }
  if (usable('openrouter', 'OPENROUTER_API_KEY')) {
    return { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free', keyEnv: 'ULTRON_DSH_KEY', secret: 'OPENROUTER_API_KEY', label: 'Nemotron 3 Super (free, on OpenRouter)' };
  }
  return null;
}

/** The overlay Ultron puts on dsh's headless profile for every run. */
export function patchYaml(m: HarnessModel): string {
  const lines = [
    '# Written by Ultron for each DeepSeek Harness run - edits here are replaced.',
    '- id: agent-default-model',
    '  config:',
    `    provider: ${m.provider}`,
    `    model: ${m.model}`,
  ];
  if (m.provider !== 'deepseek-official') {
    lines.push('- id: llm-pi-ai', '  config:', '    providers:', `      ${m.provider}:`, `        apiKeyEnv: ${m.keyEnv}`);
  }
  // No session log or plugin list riding along on DeepSeek requests, and no web tools inside dsh.
  for (const id of ['session-log-deepseek', 'plugin-package-inventory-deepseek', 'tool-web']) lines.push(`- id: ${id}`, '  disabled: true');
  return `${lines.join('\n')}\n`;
}

/** A folder name from a project name ("Snake game" -> "snake-game"). */
export function projectSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function listFiles(root: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || out.size > 3000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else {
        try { out.set(path.relative(root, full).split(path.sep).join('/'), fs.statSync(full).mtimeMs); } catch { /* gone */ }
      }
    }
  };
  walk(root, 0);
  return out;
}

export interface HarnessEvent { type?: string; tool?: string; input?: { description?: string; command?: string; file_path?: string }; text?: string; phase?: string; reason?: { kind?: string; error?: { message?: string } }; usage?: { totalTokens?: number } }

/** What a run's newline-delimited events add up to. */
export function readEvents(stdout: string): { answer: string; error?: string; tools: string[]; tokens: number } {
  let answer = '';
  let error: string | undefined;
  const tools: string[] = [];
  let tokens = 0;
  for (const line of stdout.split('\n')) {
    let e: HarnessEvent;
    try { e = JSON.parse(line) as HarnessEvent; } catch { continue; }
    if (e.type === 'tool_call' && e.tool) tools.push(e.tool);
    if (e.type === 'final' && typeof e.text === 'string') answer = e.text;
    if (e.type === 'status' && e.usage?.totalTokens) tokens = Math.max(tokens, e.usage.totalTokens);
    if (e.type === 'status' && e.phase === 'turn_end' && e.reason?.kind === 'error') error = e.reason.error?.message ?? 'DeepSeek Harness stopped with an error.';
  }
  return { answer: answer.trim(), error, tools, tokens };
}

export interface HarnessResult {
  ok: boolean;
  answer?: string;
  error?: string;
  folder: string;
  changed: string[];
  model: string;
  seconds: number;
  tools: number;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
  else try { process.kill(pid); } catch { /* gone */ }
}

/** One job, in its own project folder. Writes stay in that folder (dsh's sandbox). */
export function runHarness(opts: { task: string; project?: string; model: HarnessModel; signal?: AbortSignal; timeoutMs?: number; onTool?: (text: string) => void }): Promise<HarnessResult> {
  const slug = projectSlug(opts.project ?? '') || `job-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const folder = path.join(WORKSPACES, slug);
  fs.mkdirSync(folder, { recursive: true });
  const patch = path.join(DSH_DIR, 'ultron.patch.yml');
  fs.writeFileSync(patch, patchYaml(opts.model), 'utf8');
  const before = listFiles(folder);
  const started = Date.now();
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DSH_HOME: path.join(DSH_DIR, 'home'),
      DSH_TELEMETRY_MODE: 'DISABLED',
      DSH_PERMISSION_MODE: 'workspace-write',
      [opts.model.keyEnv]: getSecret(opts.model.secret),
    };
    const args = [BIN, '--profile', 'headless', '--patch', patch, '--json', '-'];
    // The operator's own Node first; Ultron's built-in one (Electron run as Node) if there is none.
    let child = spawn('node', args, { cwd: folder, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const attach = () => {
      child.stdout.on('data', (d: Buffer) => {
        const text = d.toString('utf8');
        if (stdout.length < 4_000_000) stdout += text;
        for (const line of text.split('\n')) {
          try {
            const e = JSON.parse(line) as HarnessEvent;
            if (e.type === 'tool_call' && e.tool) opts.onTool?.(`${e.tool}: ${(e.input?.description ?? e.input?.file_path ?? e.input?.command ?? '').slice(0, 80)}`);
          } catch { /* partial line */ }
        }
      });
      child.stderr.on('data', (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString('utf8'); });
      child.stdin.on('error', () => { /* a child that never started has no stdin */ });
      child.stdin.end(opts.task);
    };
    let fellBack = false;
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' && !fellBack) {
        fellBack = true;
        child = spawn(process.execPath, args, { cwd: folder, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
        attach();
        child.on('close', done);
      }
    });
    attach();
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, opts.timeoutMs ?? 12 * 60_000);
    const abort = () => killTree(child.pid);
    opts.signal?.addEventListener('abort', abort, { once: true });
    function done(): void {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      const after = listFiles(folder);
      const changed = [...after].filter(([f, t]) => before.get(f) !== t).map(([f]) => f).slice(0, 60);
      const r = readEvents(stdout);
      const error = timedOut ? 'DeepSeek Harness ran out of time and was stopped.'
        : opts.signal?.aborted ? 'Cancelled.'
        : r.error ?? (!r.answer ? (stderr.trim().split('\n').pop()?.slice(0, 300) || 'DeepSeek Harness gave no answer.') : undefined);
      resolve({ ok: !error, answer: r.answer || undefined, error, folder, changed, model: opts.model.label, seconds: Math.round((Date.now() - started) / 1000), tools: r.tools.length });
    }
    child.on('close', () => { if (!fellBack) done(); });
  });
}
