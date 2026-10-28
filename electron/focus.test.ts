import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => path.join(os.tmpdir(), `focus-${process.pid}`) } }));
vi.mock('./brain/events', () => ({ emit: vi.fn() }));
vi.mock('./notifications', () => ({ showNotification: vi.fn() }));

import { streakFrom, type FocusSession } from './focus';

const DAY = 86_400_000;
const at = (daysAgo: number, finished = true): FocusSession => ({
  subject: 'science', startedAt: Date.now() - daysAgo * DAY, endsAt: Date.now() - daysAgo * DAY + 25 * 60_000, finished,
});

describe('focus streak', () => {
  it('counts days in a row', () => {
    expect(streakFrom([at(0), at(1), at(2)])).toBe(3);
  });

  it('keeps yesterday\'s streak alive before today is done', () => {
    // Nothing today yet - the streak should still show, not reset to zero at midnight.
    expect(streakFrom([at(1), at(2)])).toBe(2);
  });

  it('breaks when a day is missed', () => {
    expect(streakFrom([at(0), at(1), at(3), at(4)])).toBe(2);
  });

  it('ignores sessions that were abandoned', () => {
    expect(streakFrom([at(0, false), at(1, false)])).toBe(0);
    expect(streakFrom([])).toBe(0);
  });

  it('counts a day once, however many sessions it had', () => {
    expect(streakFrom([at(0), at(0), at(0), at(1)])).toBe(2);
  });
});
