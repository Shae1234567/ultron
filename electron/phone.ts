import { onEvent } from './brain/events';
import { ask, newRunId } from './brain/team';
import { addFood } from './departments/health/store';
import { readFoodPhoto } from './departments/health/photo';
import type { PhoneMessage } from './discordGateway';

/*
 * What happens to a DM from his phone. Words go through Ultron like anything he types (so
 * "slept 11:30 to 7" reaches Health and is logged); a photo of a nutrition label or barcode
 * is read and logged as food with exact numbers. The reply goes back to the DM.
 */

const history: { role: 'user' | 'assistant'; content: string }[] = [];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Runs one message through the team and waits for its answer. */
export function askFromPhone(text: string, timeoutMs = 5 * 60_000): Promise<string> {
  const runId = newRunId();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reply: string) => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      if (history.length > 12) history.splice(0, history.length - 12);
      resolve(reply);
    };
    const off = onEvent((channel, payload) => {
      const p = payload as { runId?: string; type?: string; text?: string; message?: string; cancelled?: boolean };
      if (channel !== 'brain:event' || p.runId !== runId) return;
      if (p.type === 'final') finish(p.text || 'Done.');
      else if (p.type === 'error') finish(p.cancelled ? 'Cancelled.' : `That didn't work: ${p.message ?? 'unknown error'}`);
    });
    const timer = setTimeout(() => finish('Still working on that - check Ultron on the PC for the answer.'), timeoutMs);
    void ask({ runId, text: text.slice(0, 4000), history: [...history], via: 'phone' });
  });
}

export async function handlePhone(m: PhoneMessage): Promise<string> {
  const photo = m.images.find((i) => i.size <= MAX_IMAGE_BYTES);
  if (photo) {
    const res = await fetch(photo.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return 'I couldn\'t download that photo - try sending it again.';
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    const read = await readFoodPhoto({ mimeType: photo.contentType, data });
    if ('error' in read) return read.error;
    addFood({ text: m.text || read.item.name, items: [read.item], unknown: [], source: read.how });
    const nut = read.item.nutrients;
    const bits = [nut.protein_g !== undefined ? `${nut.protein_g} g protein` : '', nut.iron_mg !== undefined ? `${nut.iron_mg} mg iron` : '', nut.calcium_mg !== undefined ? `${nut.calcium_mg} mg calcium` : ''].filter(Boolean);
    return `Logged ${read.item.name} (${read.item.amount}), exact from the ${read.how}${bits.length ? `: ${bits.join(', ')}` : ''}.`;
  }
  if (!m.text) return 'Send words or a photo of a nutrition label or barcode.';
  return askFromPhone(m.text);
}
