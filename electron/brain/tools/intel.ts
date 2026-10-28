import { intelFor } from '../brains';
import type { DepartmentId } from '../types';
import { builtDepartments, departmentOfAgent } from '../../departments/registry';
import { readNote } from '../../memory/vault';
import { addRequest, load, removeRequest } from '../../helios/store';
import { status } from '../../helios/sweep';
import { latestReview } from '../../olympus';
import { S, obj, str, type AgentTool } from './types';

/*
 * Helios through the departments: read what he found today, and give him something to keep
 * watching (a team's fixtures, patch notes for a game, a topic). He is never asked to act -
 * he only reads public feeds and writes notes.
 */

const DEPTS = ['health', 'school', 'media', 'history', 'projects'];

export const intelTools: AgentTool[] = [
  {
    name: 'convene_council',
    owner: 'ultron',
    description: 'Convene the council ("Olympus"): every seated department head reports in one line from its real data, plus clashes coming up (a game before a quiz, practice the night before something is due) and the latest Sunday review. Use for "is this week too much?", "how am I doing overall?", or "convene the council".',
    parameters: obj({}),
    label: () => 'convene the council',
    run: async () => {
      // Loaded when used: the council reaches back into the team, which loads these tools.
      const { convene } = await import('../../council');
      const b = await convene();
      const review = latestReview();
      return { heads: b.lines.filter((l) => l.built).map((l) => `${l.head}: ${l.text}`), not_built_yet: b.lines.filter((l) => !l.built).map((l) => l.head), summary: b.summary, last_sunday_review: review ? review.text.slice(0, 2500) : undefined };
    },
  },
  {
    name: 'intel_read',
    owner: 'ultron',
    description: 'What Helios (the background researcher) found today for a department - headlines from its feeds worth attention, written up three times a day - plus his log and budget. Leave department empty for everything.',
    parameters: obj({ department: S('health, school, media, history or projects (optional)', { enum: DEPTS }), date: S('YYYY-MM-DD (optional, default today)') }),
    label: (a) => `Helios intel${str(a, 'department') ? `: ${str(a, 'department')}` : ''}`,
    run: async (a) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(a, 'date')) ? new Date(`${str(a, 'date')}T12:00:00`) : new Date();
      const dept = str(a, 'department') as DepartmentId;
      const st = status();
      const note = dept ? intelFor(dept, date) : readNote(`Intel/${date.toISOString().slice(0, 10)}.md`) ?? '';
      return {
        intel: note || 'Nothing written up yet for that day - Helios sweeps at 7:00, 15:30 and 20:00 while Ultron is idle.',
        standing_requests: st.requests.filter((r) => !dept || r.dept === dept).map((r) => `${r.what} (for ${r.dept}, asked by ${r.by}, id ${r.id})`),
        budget: `${st.budget.used} of ${st.budget.cap} AI calls used today`,
        next_sweep: new Date(st.nextSweep).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      };
    },
  },
  {
    name: 'intel_request',
    owner: 'ultron',
    description: 'Give Helios a standing request - something to keep watching in every sweep (e.g. "Calgary Cavalry fixtures", "Minecraft update", "Mongol Empire archaeology") - or list or remove them. Public topics only: never put grades, health details or the operator\'s name in one.',
    parameters: obj({
      action: S('add, list or remove', { enum: ['add', 'list', 'remove'] }),
      department: S('Which department it is for', { enum: DEPTS }),
      what: S('What to watch for, in a few words'),
      id: S('For remove: the id from list'),
    }, ['action']),
    label: (a) => `${str(a, 'action')} Helios request ${str(a, 'what')}`,
    run: async (a, ctx) => {
      const action = str(a, 'action');
      if (action === 'list') return { requests: load().requests };
      if (action === 'remove') return removeRequest(str(a, 'id')) ? { removed: str(a, 'id') } : { error: 'No request with that id - list them first.' };
      const fromAgent = departmentOfAgent(ctx.agent)?.id;
      const dept = (str(a, 'department') || fromAgent || '') as DepartmentId;
      if (!builtDepartments().some((d) => d.id === dept)) return { error: 'Say which built department it is for (health, school...).' };
      const r = addRequest(dept, str(a, 'what'), ctx.agent === 'ultron' ? 'Ultron' : ctx.agent[0].toUpperCase() + ctx.agent.slice(1));
      return 'error' in r ? r : { added: r, note: 'Helios covers it from the next sweep.' };
    },
  },
];
