import { describe, expect, it } from 'vitest';
import { guardOutbound, identityOf, scrub, trustedFor } from './privacy';

const shae = identityOf({ profile: { name: 'Shae', location: 'Calgary', interests: [], notes: '' }, privacy: { trusted: ['groq'], terms: ['Shae Example', 'shae.example@mail.test'] } });
const send = (tool: string, args: Record<string, unknown>) => guardOutbound(tool, args, shae);

describe('the privacy wall: who the operator is never leaves in a search', () => {
  it('takes his name out of a search about an injury', () => {
    const r = send('web_search', { query: 'Shae knee swollen after soccer what to do' });
    expect(r).toMatchObject({ ok: true, args: { query: 'knee swollen after soccer what to do' } });
  });

  it('takes his name out of a search with his school in it', () => {
    const r = send('google_search', { question: "Shae Example's grade 9 marks at Vincent Massey" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/shae|example/i);
  });

  it('takes a whole email address out, not just the name inside it', () => {
    expect(scrub('is shae.example@mail.test on any lists', shae).text).toBe('is on any lists');
    // ...even one he never registered, when his name is in it.
    expect(scrub('who owns shae.k99@elsewhere.test', shae).text).toBe('who owns');
  });

  it('stops a search that was only about him', () => {
    const r = send('web_search', { query: 'Shae Example' });
    expect(r.ok).toBe(false);
  });

  it('stops an address that would send his name to a site', () => {
    expect(send('read_webpage', { url: 'https://www.bing.com/search?q=Shae+Example+soccer' }).ok).toBe(false);
    expect(send('browser_open', { url: 'https://example.test/find#name=shae' }).ok).toBe(false);
  });

  it("leaves a page's own path alone - his own profile pages are fine to read", () => {
    expect(send('read_webpage', { url: 'https://github.com/Shae1234567/ultron-assistant' }).ok).toBe(true);
    expect(send('browser_open', { url: 'https://example.test/users/shae' }).ok).toBe(true);
  });

  it('checks a video given as a search, and one given as a link', () => {
    expect(send('youtube_transcript', { video: 'Shae soccer highlights' })).toMatchObject({ ok: true, args: { video: 'soccer highlights' } });
    expect(send('youtube_transcript', { video: 'https://www.youtube.com/results?search_query=shae' }).ok).toBe(false);
  });

  it('leaves normal searches and local tools untouched', () => {
    expect(send('web_search', { query: 'best warm-up before a soccer game' })).toMatchObject({ ok: true, removed: 0 });
    // Writing his name into his own file is not sending it anywhere.
    expect(send('write_file', { path: 'notes.md', content: 'Shae Example' })).toMatchObject({ ok: true, removed: 0 });
  });

  it('never strips a name that is also an everyday word from a normal search', () => {
    const max = identityOf({ profile: { name: 'Max', location: '', interests: [], notes: '' } });
    expect(guardOutbound('web_search', { query: 'max heart rate for a 14 year old' }, max)).toMatchObject({ ok: true, removed: 0 });
    // ...but written as a name, it is still his name.
    expect(guardOutbound('web_search', { query: 'what should Max eat before a game' }, max)).toMatchObject({ ok: true, args: { query: 'what should eat before a game' } });
    // As one word of a longer name it is left in; the full name still goes.
    const maxE = identityOf({ profile: { name: 'Max Example', location: '', interests: [], notes: '' } });
    expect(guardOutbound('web_search', { query: 'max heart rate for a 14 year old' }, maxE)).toMatchObject({ ok: true, removed: 0 });
    expect(guardOutbound('web_search', { query: 'max example soccer' }, maxE)).toMatchObject({ ok: true, args: { query: 'soccer' } });
  });

  it('does nothing when there is nothing to protect', () => {
    expect(guardOutbound('web_search', { query: 'anything' }, [])).toMatchObject({ ok: true, removed: 0 });
  });
});

describe('which AI services may see private data', () => {
  const s = { privacy: { trusted: ['groq'], terms: [] } };
  it('the local model always; Groq by default; the services that may keep or learn from it, no', () => {
    expect(trustedFor('ollama', s)).toBe(true);
    expect(trustedFor('cloud', s, 'groq')).toBe(true);
    expect(trustedFor('cloud', s, 'openrouter')).toBe(false);
    expect(trustedFor('cloud', s, 'nvidia')).toBe(false);
    expect(trustedFor('gemini', s)).toBe(false);
  });

  it('follows his own choice in Settings', () => {
    expect(trustedFor('gemini', { privacy: { trusted: ['gemini'] } })).toBe(true);
    expect(trustedFor('cloud', { privacy: { trusted: [] } }, 'groq')).toBe(false);
  });
});
