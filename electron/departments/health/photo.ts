import { chatJson } from '../../brain/llm';
import type { JsonSchema } from '../../brain/types';
import { lookupBarcode, validBarcode } from './foods';
import type { FoodItem } from './store';

/*
 * Exact numbers from a photo: a nutrition label is read straight off the picture; a barcode's
 * digits are read and looked up on Open Food Facts (only the number is sent there). The photo
 * itself only goes to a brain trusted with private data. Canadian labels give iron and calcium
 * in mg (and % Daily Value: iron 18 mg, calcium 1300 mg).
 */

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['label', 'barcode', 'neither'] },
    barcode: { type: 'string' },
    name: { type: 'string' },
    serving: { type: 'string' },
    protein_g: { type: 'number' },
    carbs_g: { type: 'number' },
    fibre_g: { type: 'number' },
    iron_mg: { type: 'number' },
    calcium_mg: { type: 'number' },
    vitd_ug: { type: 'number' },
  },
  required: ['kind'],
};

interface Read { kind?: string; barcode?: string; name?: string; serving?: string; protein_g?: number; carbs_g?: number; fibre_g?: number; iron_mg?: number; calcium_mg?: number; vitd_ug?: number }

const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : undefined);

/** A label's numbers, made safe: impossible values are dropped rather than logged. Pure. */
export function fromLabel(r: Read): FoodItem | null {
  const nutrients = { protein_g: n(r.protein_g, 200), carbs_g: n(r.carbs_g, 300), fibre_g: n(r.fibre_g, 80), iron_mg: n(r.iron_mg, 60), calcium_mg: n(r.calcium_mg, 2500), vitd_ug: n(r.vitd_ug, 100) };
  if (Object.values(nutrients).every((v) => v === undefined)) return null;
  return { name: r.name?.trim() || 'packaged food', amount: r.serving?.trim() || '1 serving', nutrients, exact: true };
}

export async function readFoodPhoto(image: { mimeType: string; data: string }, signal?: AbortSignal): Promise<{ item: FoodItem; how: 'label' | 'barcode' } | { error: string }> {
  let r: Read | null;
  try {
    r = await chatJson<Read>({
      system: [
        'You read food packaging photos. Say whether the photo shows a nutrition facts label, a barcode, or neither.',
        'Label: give the product name if visible, the serving size, and per serving: protein g, carbohydrate g, fibre g, iron mg, calcium mg, vitamin D ug. If only % Daily Value is shown, convert with iron 18 mg = 100%, calcium 1300 mg = 100%, vitamin D 20 ug = 100%. Leave out anything not on the label. Never guess numbers.',
        'Barcode: copy the digits printed under it exactly.',
      ].join('\n'),
      messages: [{ role: 'user', content: 'Read this photo.', images: [image] }],
      schema: SCHEMA,
      temperature: 0,
      private: true,
      signal,
    });
  } catch (e) {
    return { error: `I couldn't read the photo (${e instanceof Error ? e.message : String(e)}). Type the barcode digits, or the label's numbers, instead.` };
  }
  if (r?.kind === 'barcode' && r.barcode) {
    const digits = r.barcode.replace(/\D/g, '');
    if (!validBarcode(digits)) return { error: `I read the barcode as ${digits || 'nothing'}, which isn't a valid barcode - type the digits under it instead.` };
    const item = await lookupBarcode(digits, signal);
    return 'error' in item ? item : { item, how: 'barcode' };
  }
  if (r?.kind === 'label') {
    const item = fromLabel(r);
    return item ? { item, how: 'label' } : { error: 'I could see a label but not its numbers - try a closer, sharper photo.' };
  }
  return { error: 'That photo doesn\'t show a nutrition label or a barcode.' };
}
