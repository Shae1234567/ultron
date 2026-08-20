/**
 * Fetches a random joke from icanhazdadjoke.com, a free keyless API.
 * The Accept header is required by that API - without it, it returns HTML
 * instead of JSON.
 */

export async function getRandomJoke(): Promise<{ ok: boolean; joke?: string; error?: string }> {
  try {
    const response = await fetch('https://icanhazdadjoke.com/', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { ok: false, error: `Request failed with status ${response.status}` };
    }

    const data = await response.json();
    if (!data || typeof data.joke !== 'string' || !data.joke) {
      return { ok: false, error: 'Unexpected response shape from joke API.' };
    }

    return { ok: true, joke: data.joke };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
