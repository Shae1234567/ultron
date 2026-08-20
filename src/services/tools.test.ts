import { describe, it, expect, vi } from 'vitest';

// tools.ts dispatches every executeTool() case through the `ultron` bridge
// export. Replace it with a stub so tests never touch a real Electron
// preload bridge - only the one method exercised below needs an implementation.
vi.mock('./bridge', () => ({
  ultron: {
    files: {
      write: vi.fn(),
    },
  },
}));

import { ultron } from './bridge';
import { toolsForGroups, executeTool } from './tools';

describe('toolsForGroups', () => {
  it('returns only tools belonging to the requested group', () => {
    const files = toolsForGroups(['files']);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((t) => t.group === 'files')).toBe(true);
    expect(files.some((t) => t.name === 'write_file')).toBe(true);
  });

  it('excludes tools from browser/google/system/research groups', () => {
    const files = toolsForGroups(['files']);
    expect(files.some((t) => t.group === 'browser')).toBe(false);
    expect(files.some((t) => t.group === 'google')).toBe(false);
    expect(files.some((t) => t.group === 'system')).toBe(false);
    expect(files.some((t) => t.group === 'research')).toBe(false);
  });
});

describe('executeTool', () => {
  it('resolves an unknown tool name to a failure result instead of throwing', async () => {
    const res = await executeTool('not_a_real_tool', {});
    expect(res).toEqual({ ok: false, error: 'Unknown tool: not_a_real_tool' });
  });

  it('maps write_file args to ultron.files.write(path, content) and returns its result', async () => {
    (ultron.files.write as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const res = await executeTool('write_file', { path: '/tmp/a.txt', content: 'hi' });

    expect(ultron.files.write).toHaveBeenCalledWith('/tmp/a.txt', 'hi');
    expect(res).toEqual({ ok: true, result: { ok: true } });
  });

  it('catches a thrown/rejected bridge error and returns it as { ok: false, error }', async () => {
    (ultron.files.write as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'));

    const res = await executeTool('write_file', { path: '/tmp/a.txt', content: 'hi' });

    expect(res).toEqual({ ok: false, error: 'disk full' });
  });
});
