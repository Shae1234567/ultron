import * as dsh from '../../dsh';
import { inPrivateScope } from '../privacy';
import { obj, S, str, type AgentTool } from './types';

/*
 * DeepSeek Harness as a tool for Ultron and every council agent (the operator's choice,
 * 9 Oct 2026). A separate coding agent: it writes and runs code in its own project folder.
 * Every run is approved by the operator first - its sandbox keeps writes in that folder but
 * not reads - and it never gets private work.
 */

export const DSH_TOOL = 'deepseek_harness';

export const dshTools: AgentTool[] = [
  {
    name: DSH_TOOL,
    owner: 'hephaestus',
    description: 'Hand a coding or building job to DeepSeek Harness, a separate coding agent on this PC: it writes, runs and fixes code inside its own project folder and reports what it made (scripts, small programs and apps, data crunching, file conversions). Give the whole job in one task. It asks the operator first. Never for anything private (health, grades) and not for web research.',
    parameters: obj({
      task: S('The complete job: what to build, how it should work, and what to report back'),
      project: S('A short project name - the same name continues work in the same folder'),
    }, ['task']),
    label: (a) => `DeepSeek Harness: ${str(a, 'task').slice(0, 60)}`,
    run: async (args, ctx) => {
      if (!dsh.installed()) return { error: 'DeepSeek Harness is not installed (it lives in ~/UltronTools/dsh).' };
      if (inPrivateScope()) {
        return { error: 'DeepSeek Harness never gets private work (health, grades, what is in the private notes): the service its model runs on may keep what it is sent. Do this part without it.' };
      }
      const task = str(args, 'task').trim();
      if (task.length < 10) return { error: 'Describe the whole job in the task.' };
      const model = dsh.pickModel();
      if (!model) return { error: 'DeepSeek Harness needs a DeepSeek key with credit (Settings -> AI services) or the OpenRouter key. Groq\'s free tier is too small for it.' };
      const project = str(args, 'project').trim();
      const folder = `${dsh.WORKSPACES}\\${dsh.projectSlug(project) || 'a new job folder'}`;
      const ok = await ctx.approve(
        'deepseek-harness',
        `Let DeepSeek Harness build: ${task.slice(0, 70)}`,
        [
          `Model: ${model.label}`,
          `Folder: ${folder}`,
          'It writes and runs code only inside that folder, but it can READ other files on this PC. Its web tools, telemetry and session-log upload are off.',
          '',
          task.slice(0, 1500),
        ].join('\n'),
      );
      if (!ok) return { declined: true, note: 'The operator said no - nothing was run.' };
      ctx.progress(`DeepSeek Harness working (${model.label})`);
      const r = await dsh.runHarness({ task, project, model, signal: ctx.signal, onTool: (t) => ctx.progress(`dsh ${t}`) });
      return r.ok
        ? { answer: r.answer, folder: r.folder, files_changed: r.changed, model: r.model, seconds: r.seconds, steps: r.tools }
        : { error: r.error, folder: r.folder, files_changed: r.changed.length ? r.changed : undefined, model: r.model };
    },
    writes: true,
  },
];
