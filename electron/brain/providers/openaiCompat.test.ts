import { describe, expect, it } from 'vitest';
import { streamError } from './openaiCompat';

describe('an error that arrives inside a stream', () => {
  // Services sometimes answer 200 and put the failure in the stream. Read as a blanket "other",
  // it ended the whole request even when the next model or service could have answered.
  it('is read by its own code', () => {
    expect(streamError({ message: 'Service temporarily overloaded', code: 503 }).kind).toBe('network');
    expect(streamError({ message: 'rate-limited upstream', code: 429 }).kind).toBe('rate');
    expect(streamError({ message: 'No endpoints found', code: '404' }).kind).toBe('model');
    expect(streamError({ message: 'User not found.', code: 401 }).kind).toBe('auth');
  });

  it('with no code, is treated as a hiccup the next model can pick up, not a dead end', () => {
    expect(streamError({ message: 'something went wrong' }).kind).toBe('network');
  });
});
