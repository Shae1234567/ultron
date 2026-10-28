import { describe, expect, it } from 'vitest';
import { AGENTS } from '../agents';
import { nearTools } from './index';

describe('nearTools - what a misnamed tool call most likely meant', () => {
  it('turns the local model\'s "health_log" into the real log tools, with their fields', () => {
    // 12 Oct 2026: qwen3.5:4b called health_log { sleep_start, sleep_end }, got a bare "Unknown tool" and gave up.
    const near = nearTools('health_log', AGENTS.asclepius.tools);
    expect(near).toContain('health_log_sleep (bed, wake)');
    expect(near.some((n) => n.startsWith('health_log_training'))).toBe(true);
  });

  it('only suggests tools the caller actually has', () => {
    const mine = AGENTS.asclepius.tools;
    for (const n of nearTools('log_sleep', mine)) expect(mine).toContain(n.split(' ')[0]);
  });

  it('suggests nothing for a name that is nowhere close', () => {
    expect(nearTools('zz', AGENTS.asclepius.tools)).toEqual([]);
  });
});
