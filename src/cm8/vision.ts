/**
 * Photo meal logging, ported.
 *
 * CM8 never actually looked at the image - it asked four questions about it and
 * built an approximate plate from the answers. That is carried over honestly
 * here rather than dressed up as image recognition: the photo is a memory aid,
 * the four answers are what produce the numbers.
 */
import { CAT } from './nutrition';
import type { ParsedItem } from './nutrition';

export interface VisionQuestion {
  id: 'portion' | 'protein' | 'veg' | 'cook';
  q: string;
  opts: string[];
}

export const VISION_QUESTIONS: VisionQuestion[] = [
  { id: 'portion', q: 'Roughly how big was the portion?', opts: ['Small / snack-sized', 'A normal plate', 'A big plate', 'Second helpings'] },
  { id: 'protein', q: 'Was there a real protein on the plate — meat, fish, eggs, beans, or dairy?', opts: ['Yes, a proper portion', 'A small amount', 'No protein'] },
  { id: 'veg', q: 'Any vegetables or fruit in there?', opts: ['Yes, a decent amount', 'Just a little', 'None'] },
  { id: 'cook', q: 'How was most of it cooked?', opts: ['Baked, grilled or boiled', 'Pan-fried', 'Deep-fried', 'Takeout or packaged'] },
];

export type VisionAnswers = Partial<Record<VisionQuestion['id'], string>>;

export const visionComplete = (v: VisionAnswers) =>
  VISION_QUESTIONS.every((q) => typeof v[q.id] === 'string' && v[q.id] !== '');

/** Turn the four answers into an approximate plate the engine can score. */
export function visionItems(v: VisionAnswers): ParsedItem[] {
  const size = v.portion === 'Small / snack-sized' ? 0.7
    : v.portion === 'A big plate' ? 1.4
      : v.portion === 'Second helpings' ? 1.8 : 1;

  const items: ParsedItem[] = [];
  const push = (cat: ParsedItem['cat'], servings: number, n: Omit<ParsedItem, 'name' | 'cat' | 'unit' | 'servings'>) =>
    items.push({ name: 'from photo', cat, unit: 'plate', servings, ...n });

  const pro = v.protein === 'Yes, a proper portion' ? 1 : v.protein === 'A small amount' ? 0.4 : 0;
  if (pro) {
    push(CAT.PRO, pro * size, {
      kcal: 165 * pro * size, p: 31 * pro * size, c: 0, f: 4 * pro * size,
      fib: 0, ca: 15, fe: 1 * pro, vc: 0, caf: 0, fluid: 0,
    });
  }

  push(CAT.CARB, size, {
    kcal: 205 * size, p: 4.3 * size, c: 45 * size, f: 0.5 * size,
    fib: 1 * size, ca: 16, fe: 1.9 * size, vc: 0, caf: 0, fluid: 0,
  });

  const veg = v.veg === 'Yes, a decent amount' ? 1 : v.veg === 'Just a little' ? 0.4 : 0;
  if (veg) {
    push(CAT.PROD, veg, {
      kcal: 55 * veg, p: 3 * veg, c: 11 * veg, f: 0.5,
      fib: 5 * veg, ca: 60 * veg, fe: 1 * veg, vc: 80 * veg, caf: 0, fluid: 0,
    });
  }

  if (v.cook === 'Deep-fried' || v.cook === 'Takeout or packaged') {
    push(CAT.TREAT, 1, {
      kcal: 250, p: 2, c: 25, f: 15, fib: 1, ca: 10, fe: 0.5, vc: 0, caf: 0, fluid: 0,
    });
  }

  return items;
}
