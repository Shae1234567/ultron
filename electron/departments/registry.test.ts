import { describe, expect, it } from 'vitest';
import { AGENTS, SPECIALISTS } from '../brain/agents';
import { AGENT_IDS, CORE_AGENT_IDS } from '../brain/types';
import { DEPARTMENTS, HELIOS, builtDepartments, departmentOfAgent, isLiveAgent, rosterFor } from './registry';

const members = DEPARTMENTS.flatMap((d) => [d.head, ...d.specialists]);

describe('the council roster', () => {
  it('has 21 new names, each used once, none clashing with the team Ultron already has', () => {
    const names = [...members, HELIOS].map((m) => m.id);
    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(21);
    for (const n of names) expect(CORE_AGENT_IDS as readonly string[]).not.toContain(n);
  });

  it('seats the five departments once each, in the chamber order', () => {
    expect(DEPARTMENTS.map((d) => d.seat).sort()).toEqual([1, 2, 3, 4, 5]);
    // Build order from the plan: Health, then School, then Media, History, Projects.
    expect([...DEPARTMENTS].sort((a, b) => a.step - b.step).map((d) => d.id)).toEqual(['health', 'school', 'media', 'history', 'projects']);
  });

  it('only borrows from the shared team', () => {
    for (const d of DEPARTMENTS) for (const b of d.borrows) expect(SPECIALISTS).toContain(b);
  });

  it('finds the department an agent works in', () => {
    expect(departmentOfAgent('hypnos')?.id).toBe('health');
    expect(departmentOfAgent('prometheus')?.id).toBe('school');
    expect(departmentOfAgent('athena')).toBeUndefined();
    expect(departmentOfAgent('helios')).toBeUndefined();
  });
});

describe('agents that exist', () => {
  it('every agent id has its definition, and every definition is a known id', () => {
    expect(Object.keys(AGENTS).sort()).toEqual([...AGENT_IDS].sort());
    for (const [id, a] of Object.entries(AGENTS)) expect(a.id).toBe(id);
  });

  it('a built department is whole: its head and every expert exist and say which department they are in', () => {
    for (const d of builtDepartments()) {
      for (const m of [d.head, ...d.specialists]) {
        expect(isLiveAgent(m.id), `${m.name} is missing`).toBe(true);
        expect(AGENTS[m.id as keyof typeof AGENTS].department).toBe(d.id);
      }
    }
  });

  it('a department not built yet has no agents running', () => {
    for (const d of DEPARTMENTS.filter((x) => !x.built)) {
      for (const m of [d.head, ...d.specialists]) expect(isLiveAgent(m.id), `${m.name} runs before ${d.name} is built`).toBe(false);
    }
  });

  it('match between the main process and the window', async () => {
    // Same fix as the key names: a department agent that exists here but not in the window
    // would show up in the team panel as a stranger with no colour or name.
    const renderer = await import('../../src/types/index');
    expect([...renderer.AGENT_IDS].sort()).toEqual([...AGENT_IDS].sort());
  });
});

describe('who a run may assign', () => {
  it("Ultron's own runs: the shared team, as before", () => {
    expect(rosterFor()).toEqual(SPECIALISTS);
  });

  it('a department not built yet adds nobody who does not exist', () => {
    const health = DEPARTMENTS.find((d) => d.id === 'health')!;
    expect(rosterFor(health).every((id) => isLiveAgent(id))).toBe(true);
  });
});

describe('every council member is as capable as Ultron (10 Oct 2026)', () => {
  const council = Object.values(AGENTS).filter((a) => a.department);
  const ultron = AGENTS.ultron;

  it("has all of Ultron's own tools", () => {
    for (const a of council) expect(ultron.tools.filter((t) => !a.tools.includes(t)), a.name).toEqual([]);
  });

  it('has a full browser of its own (type and click, not just read) and the connected apps', () => {
    for (const a of council) {
      for (const t of ['browser_open', 'browser_click', 'browser_type', 'browser_look', 'apps_connected', 'apps_find_actions', 'apps_run_action', 'deepseek_harness']) {
        expect(a.tools, `${a.name} ${t}`).toContain(t);
      }
      expect(a.directives.join(' '), a.name).toMatch(/call_specialist/);
    }
  });

  it("leaves the shared team's own toolkits as they were", () => {
    expect(AGENTS.athena.tools).not.toContain('apps_run_action');
    expect(AGENTS.mnemosyne.tools).not.toContain('browser_type');
  });
});
