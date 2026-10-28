import { beforeEach, describe, expect, it, vi } from 'vitest';

const keys = new Set<string>();
const services: { id: string; valid?: boolean | null; outOfCredits?: number; off?: boolean }[] = [];
vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false } }));
vi.mock('./secrets', () => ({ getSecret: (n: string) => (keys.has(n) ? `key-${n}` : ''), hasSecret: (n: string) => keys.has(n) }));
vi.mock('./clouds', () => ({ cloudStatus: () => services }));

const dsh = await import('./dsh');
const { markPrivate, withPrivacyScope } = await import('./brain/privacy');
const { dshTools } = await import('./brain/tools/dsh');
const tool = dshTools[0];

beforeEach(() => { keys.clear(); services.length = 0; });

describe('which model DeepSeek Harness runs on', () => {
  it("DeepSeek's own API when there is a DeepSeek key", () => {
    keys.add('DEEPSEEK_API_KEY').add('OPENROUTER_API_KEY');
    expect(dsh.pickModel()).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash', keyEnv: 'DEEPSEEK_API_KEY' });
  });

  it('a free OpenRouter model otherwise - and never Groq, whose free tier is too small for it', () => {
    keys.add('OPENROUTER_API_KEY').add('GROQ_API_KEY');
    expect(dsh.pickModel()).toMatchObject({ provider: 'openrouter', model: expect.stringMatching(/:free$/) });
    keys.delete('OPENROUTER_API_KEY');
    expect(dsh.pickModel()).toBeNull();
  });

  it('skips a DeepSeek key that was refused or has no credit left', () => {
    keys.add('DEEPSEEK_API_KEY').add('OPENROUTER_API_KEY');
    services.push({ id: 'deepseek', outOfCredits: Date.now() + 1000 });
    expect(dsh.pickModel()?.provider).toBe('openrouter');
  });
});

describe('what Ultron switches off on every run', () => {
  it('no session log or plugin list on DeepSeek requests, and no web tools inside it', () => {
    const y = dsh.patchYaml({ provider: 'deepseek-official', model: 'deepseek-flash', keyEnv: 'DEEPSEEK_API_KEY', secret: 'DEEPSEEK_API_KEY', label: '' });
    for (const id of ['session-log-deepseek', 'plugin-package-inventory-deepseek', 'tool-web']) expect(y).toContain(`- id: ${id}\n  disabled: true`);
    expect(y).toContain('provider: deepseek-official');
    expect(y).not.toContain('llm-pi-ai');
  });

  it('another service gets its key from an environment variable, never written in the file', () => {
    const y = dsh.patchYaml({ provider: 'openrouter', model: 'x:free', keyEnv: 'ULTRON_DSH_KEY', secret: 'OPENROUTER_API_KEY', label: '' });
    expect(y).toContain('apiKeyEnv: ULTRON_DSH_KEY');
    expect(y).not.toMatch(/key-/);
  });
});

describe("reading a run's events", () => {
  it('takes the final answer, the tools used and the tokens', () => {
    const out = [
      '{"type":"session"}',
      '{"type":"tool_call","tool":"write","input":{"file_path":"a.py"}}',
      '{"type":"tool_call","tool":"pwsh","input":{"command":"python a.py"}}',
      '{"type":"status","phase":"step_end","usage":{"totalTokens":9860}}',
      '{"type":"final","text":"Built a.py and ran it: prints 42."}',
    ].join('\n');
    expect(dsh.readEvents(out)).toEqual({ answer: 'Built a.py and ran it: prints 42.', error: undefined, tools: ['write', 'pwsh'], tokens: 9860 });
  });

  it('says when the model refused or ran out', () => {
    const out = '{"type":"status","phase":"turn_end","reason":{"kind":"error","error":{"message":"429: rate limited"}}}\n{"type":"final","text":""}';
    expect(dsh.readEvents(out).error).toBe('429: rate limited');
  });
});

describe('the deepseek_harness tool', () => {
  const ctx = (approve: boolean) => ({ runId: 'r', agent: 'athena', tab: { id: 't', runId: 'r', agent: 'athena', label: '' }, signal: new AbortController().signal, approve: vi.fn(async () => approve), progress: vi.fn(), post: vi.fn() }) as never;

  it('never takes private work', async () => {
    keys.add('OPENROUTER_API_KEY');
    const c = ctx(true);
    const r = await withPrivacyScope(async () => { markPrivate(); return tool.run({ task: 'write a script that sums my sleep hours' }, c); });
    expect(r).toMatchObject({ error: expect.stringMatching(/never gets private work/) });
  });

  it('asks the operator first, and does nothing when they say no', async () => {
    keys.add('OPENROUTER_API_KEY');
    const c = ctx(false) as { approve: ReturnType<typeof vi.fn> };
    const r = await tool.run({ task: 'build a tiny snake game in one html file', project: 'Snake game' }, c as never);
    if (!dsh.installed()) return; // on a machine without it, the tool says so instead
    expect(c.approve).toHaveBeenCalledOnce();
    expect(String(c.approve.mock.calls[0][2])).toMatch(/can READ other files/);
    expect(r).toMatchObject({ declined: true });
  });

  it('is in every agent\'s hands - Ultron and the whole council', async () => {
    const { AGENTS } = await import('./brain/agents');
    for (const a of Object.values(AGENTS)) expect(a.tools, a.name).toContain('deepseek_harness');
  });
});
