import { describe, expect, it } from 'vitest';
import { claimsLogged, isLogTool, reportsHealth } from './logCheck';

describe('Health log check', () => {
  it('spots a reply that says it logged something', () => {
    // The local model's real reply in the final test (12 Oct 2026) - no tool had run.
    expect(claimsLogged('Logged: 10:30 PM to 7 AM (9 hours). That\'s a solid sleep for recovery.')).toBe(true);
    expect(claimsLogged('Sleep logged - 8.5 hours.')).toBe(true);
    expect(claimsLogged('I\'ve recorded your practice.')).toBe(true);
    expect(claimsLogged('Got it, saved.')).toBe(true);
    expect(claimsLogged('Added that to your log.')).toBe(true);
  });

  it('does not count a reply that says nothing was logged', () => {
    expect(claimsLogged('No sleep logged yet. Tell me when you went to bed.')).toBe(false);
    expect(claimsLogged('Nothing is logged for this week.')).toBe(false);
    expect(claimsLogged('I couldn\'t save it - what time did you wake up?')).toBe(false);
    expect(claimsLogged('Eat something with iron at dinner.')).toBe(false);
  });

  it('spots a health report that should be logged', () => {
    expect(reportsHealth('I slept from 10:30 last night to 7 this morning')).toBe(true);
    expect(reportsHealth('went to bed at 11:45, woke up 6:50')).toBe(true);
    expect(reportsHealth('practice was brutal, 90 min')).toBe(true);
    expect(reportsHealth('I had a chicken wrap and an apple for lunch')).toBe(true);
    expect(reportsHealth('my knee hurts after the game')).toBe(true);
    // The lead's own wording when it hands Health the job.
    expect(reportsHealth("Log the operator's sleep from 10:30 PM to 7 AM")).toBe(true);
    expect(reportsHealth("Log today's practice: 90 minutes, effort 8")).toBe(true);
    expect(reportsHealth('logged in to D2L fine')).toBe(false);
    // Starts like a question, but reports (it wasn't logged on 12 Oct 2026).
    expect(reportsHealth('did gym for 45 min, effort 6')).toBe(true);
    expect(reportsHealth('did I sleep enough this week')).toBe(false);
    expect(reportsHealth('was my practice too hard yesterday')).toBe(false);
  });

  it('leaves questions and small talk alone', () => {
    expect(reportsHealth('how much did I sleep this week?')).toBe(false);
    expect(reportsHealth('should I go to bed at 10')).toBe(false);
    expect(reportsHealth('what should I eat before practice?')).toBe(false);
    expect(reportsHealth('I had a test today')).toBe(false);
    expect(reportsHealth('I have a game on Saturday')).toBe(false);
  });

  it('knows which tools really save to the log', () => {
    expect(isLogTool('health_log_sleep')).toBe(true);
    expect(isLogTool('health_checkin')).toBe(true);
    expect(isLogTool('health_week')).toBe(false);
    expect(isLogTool('memory_search')).toBe(false);
  });
});
