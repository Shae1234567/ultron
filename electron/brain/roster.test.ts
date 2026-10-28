import { describe, expect, it } from 'vitest';
import { SPECIALISTS } from './agents';
import { ASSEMBLE_TEAM, consultDepartmentSpec, onRoster, planSchema, reviewSchema, sanitizePlan } from './roster';
import type { AgentId } from './types';
import { DEPARTMENTS } from '../departments/registry';

type Props = Record<string, { enum?: string[]; items?: { properties?: Record<string, { enum?: string[] }> } }>;
const stepEnum = (s: ReturnType<typeof planSchema>) => ((s.properties as Props).steps.items!.properties!.agent.enum);
const followupEnum = (s: ReturnType<typeof reviewSchema>) => ((s.properties as Props).followups.items!.properties!.agent.enum);

describe("the team engine's roster", () => {
  it('plans and reviews against whoever is on the roster', () => {
    const roster = ['athena', 'argus'] as AgentId[];
    expect(stepEnum(planSchema(roster))).toEqual(roster);
    expect(followupEnum(reviewSchema(roster))).toEqual(roster);
  });

  it("Ultron's own runs still plan with the shared team", () => {
    expect(stepEnum(planSchema(SPECIALISTS))).toEqual(SPECIALISTS);
    expect((ASSEMBLE_TEAM.parameters.properties as Props).specialist.enum).toEqual(SPECIALISTS);
  });

  it('drops a step for anyone not on the roster', () => {
    const raw = { steps: [{ id: 's1', agent: 'argus', task: 'look it up' }, { id: 's2', agent: 'hermes', task: 'email it' }, { id: 's3', agent: 'nobody', task: 'x' }] };
    const plan = sanitizePlan(raw, 'objective', [], ['argus'] as AgentId[]);
    expect(plan.steps.map((s) => s.agent)).toEqual(['argus']);
  });

  it("an empty plan falls back to the department's own agent when one is given, otherwise to the likeliest specialist", () => {
    expect(sanitizePlan(null, 'find the score', [], SPECIALISTS, 'chronos').steps[0].agent).toBe('chronos');
    expect(sanitizePlan(null, 'remind me tomorrow', []).steps[0].agent).toBe('chronos');
  });

  it('keeps only follow-ups for agents on the roster', () => {
    const f = onRoster([{ agent: 'argus', task: 'a' }, { agent: 'talos', task: 'b' }], ['argus'] as AgentId[]);
    expect(f.map((x) => x.agent)).toEqual(['argus']);
  });
});

describe('consult_department', () => {
  it('offers exactly the departments it is given, named by their heads', () => {
    const health = DEPARTMENTS.find((d) => d.id === 'health')!;
    const spec = consultDepartmentSpec([health]);
    const props = spec.parameters.properties as Record<string, { enum?: string[]; description?: string }>;
    expect(props.department.enum).toEqual(['health']);
    expect(props.department.description).toMatch(/Asclepius/);
    expect(spec.parameters.required).toEqual(['department', 'objective']);
    expect(props.quick).toBeDefined();
  });
});
