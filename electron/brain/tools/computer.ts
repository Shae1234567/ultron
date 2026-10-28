import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { S, N, obj, str, num, type AgentTool } from './types';

const exec = promisify(execFile);

async function callCua(action: string, args: Record<string, any> = {}) {
  const argList = [action];
  for (const [k, v] of Object.entries(args)) {
    argList.push(`--${k}=${v}`);
  }
  
  try {
    const { stdout } = await exec('cua-driver', argList);
    return JSON.parse(stdout);
  } catch (e: any) {
    return { error: e.message || 'Cua driver error' };
  }
}

export const computerTools: AgentTool[] = [
  {
    name: 'capture_screen',
    owner: 'hephaestus',
    description: 'Take a screenshot of the current screen and return a numbered index of all interactable elements (SOM).',
    parameters: obj({ mode: S('Capture mode: som (default), vision, or ax', { enum: ['som', 'vision', 'ax'] }), app: S('Optional app name to focus capture on') }),
    label: () => 'capture screen',
    run: async (args) => {
      return await callCua('capture', { mode: str(args, 'mode', 'som'), app: str(args, 'app') });
    },
  },
  {
    name: 'click_element',
    owner: 'hephaestus',
    description: 'Click an element on the screen using its index from a previous capture.',
    parameters: obj({ element: N('The 1-based index of the element to click'), button: S('Mouse button: left, right, middle', { enum: ['left', 'right', 'middle'] }) }, ['element']),
    label: (a) => `click #${num(a, 'element', 0)}`,
    run: async (args, ctx) => {
      const ok = await ctx.approve('computer-click', `Click element #${num(args, 'element', 0)}?`, 'This will simulate a mouse click on your desktop.');
      if (!ok) return { error: 'The operator declined.' };
      return await callCua('click', { element: num(args, 'element', 0), button: str(args, 'button', 'left') });
    },
  },
  {
    name: 'type_text',
    owner: 'hephaestus',
    description: 'Type text into the currently focused element.',
    parameters: obj({ text: S('The text to type') }, ['text']),
    label: (a) => `type "${str(a, 'text').slice(0, 20)}..."`,
    run: async (args, ctx) => {
      const ok = await ctx.approve('computer-type', `Type text?`, `Text: ${str(args, 'text')}`);
      if (!ok) return { error: 'The operator declined.' };
      return await callCua('type', { text: str(args, 'text') });
    },
  },
  {
    name: 'press_key',
    owner: 'hephaestus',
    description: 'Press a specific key or keyboard shortcut (e.g., "ctrl+s", "return", "esc").',
    parameters: obj({ keys: S('The key or shortcut to press') }, ['keys']),
    label: (a) => `press ${str(a, 'keys')}`,
    run: async (args, ctx) => {
      const ok = await ctx.approve('computer-key', `Press key ${str(args, 'keys')}?`, 'This will simulate a keyboard press.');
      if (!ok) return { error: 'The operator declined.' };
      return await callCua('key', { keys: str(args, 'keys') });
    },
  },
  {
    name: 'scroll_viewport',
    owner: 'hephaestus',
    description: 'Scroll the screen in a specified direction.',
    parameters: obj({ direction: S('Scroll direction: up, down, left, right', { enum: ['up', 'down', 'left', 'right'] }), amount: N('Amount to scroll (default 3)') }, ['direction']),
    label: (a) => `scroll ${str(a, 'direction')}`,
    run: async (args, ctx) => {
      const ok = await ctx.approve('computer-scroll', `Scroll ${str(args, 'direction')}?`, 'This will scroll the current window.');
      if (!ok) return { error: 'The operator declined.' };
      return await callCua('scroll', { direction: str(args, 'direction'), amount: num(args, 'amount', 3) });
    },
  },
];
