import { describe, expect, it, vi } from 'vitest';

vi.mock('./brain/team', () => ({ once: vi.fn() }));
vi.mock('./learn', () => ({ load: () => ({ tests: [] }), recordScore: vi.fn(), summary: () => ({}) }));
vi.mock('./brain/events', () => ({ emit: vi.fn() }));

import { matches, worthSaving } from './selftest';

describe('marking an answer', () => {
  it('accepts the right answer however it is worded', () => {
    expect(matches('95', 'The answer is 95 minutes.')).toBe(true);
    expect(matches('95', '95')).toBe(true);
    expect(matches('13.33', 'About 13.33 km/h')).toBe(true);
    expect(matches('1,250', 'That comes to 1250.')).toBe(true);
    expect(matches('Rome', 'The capital was Rome at the time.')).toBe(true);
  });

  it('does not accept a number that merely appears inside a bigger one', () => {
    // The trap: "7" must not pass just because the reply says 1700.
    expect(matches('7', 'The year was 1700.')).toBe(false);
    expect(matches('12', 'There were 120 of them.')).toBe(false);
    expect(matches('5', 'It is 5 metres.')).toBe(true);
  });

  it('marks a wrong answer wrong', () => {
    expect(matches('95', 'The answer is 90 minutes.')).toBe(false);
    expect(matches('95', '')).toBe(false);
    expect(matches('', 'anything')).toBe(false);
  });
});

describe('deciding what is worth keeping as a test', () => {
  it('keeps a definite, checkable answer', () => {
    expect(worthSaving('How many minutes between 6:45 pm and 8:20 pm?', '95')).toBe(true);
    expect(worthSaving('What is 15% of 240 plus a third of 90?', '66')).toBe(true);
  });

  it('refuses anything whose answer changes with the day', () => {
    // These would fail tomorrow for the wrong reason and make the score meaningless.
    expect(worthSaving('How many days until my test next week?', '6')).toBe(false);
    expect(worthSaving('What is the weather going to be today?', '14')).toBe(false);
    expect(worthSaving('How many tasks do I have right now?', '3')).toBe(false);
  });

  it('refuses answers too long or too short to mark automatically', () => {
    expect(worthSaving('Explain the fall of the Roman Empire', 'x'.repeat(60))).toBe(false);
    expect(worthSaving('hi', '5')).toBe(false);
  });
});
