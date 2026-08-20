/**
 * Parity harness: CM8's original engine vs the TypeScript port.
 *
 * A port this size is only trustworthy if it is checked against the thing it
 * was ported from. This runs both engines over the same inputs and diffs the
 * results, so a drifted formula fails here rather than quietly giving Shae
 * different numbers in Atlas than in CM8.
 *
 *   node tools/parity-cm8.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.CM8_SRC || 'C:/Users/shaeg/Downloads/index_8.html';

/* ---- the original, straight out of the CM8 page ---- */
const html = fs.readFileSync(SRC, 'utf8');
const start = html.indexOf('window.CM8N = (function()');
const source = html.slice(start, html.indexOf('</script>', start));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { timeout: 5000 });
const ORIG = sandbox.window.CM8N;

/* ---- the port, bundled so Node can import TypeScript ---- */
const outfile = path.join(os.tmpdir(), 'cm8-port-' + Date.now() + '.mjs');
await esbuild.build({
  entryPoints: [path.join(HERE, '..', 'src', 'cm8', 'nutrition.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const PORT = await import(pathToFileURL(outfile).href);

/* ---- comparison ---- */
let pass = 0;
const fails = [];
const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

function eq(name, a, b) {
  const A = JSON.stringify(a, (_, v) => round(v));
  const B = JSON.stringify(b, (_, v) => round(v));
  if (A === B) { pass++; return; }
  fails.push({ name, orig: A, port: B });
}

const MEALS = [
  'eggs with avocado and cheese',
  'a light coffee',
  'chicken and rice with broccoli',
  '2 eggs and a bowl of rice',
  'chocolate milk',
  'pasta with beef and a salad',
  'greek yogurt and a banana',
  'large pizza and a can of coke',
  'oats with milk and berries',
  'a bowl of zorbleflax',
  'peanut butter on toast with a glass of orange juice',
  'half an avocado',
  '200g chicken',
  'two slices of pizza and chips',
  'monster energy drink',
];

/* parse + totals */
for (const text of MEALS) {
  const a = ORIG.parse(text);
  const b = PORT.parse(text);
  eq('parse names: ' + text, a.items.map((i) => i.name), b.items.map((i) => i.name));
  eq('parse servings: ' + text, a.items.map((i) => round(i.servings)), b.items.map((i) => round(i.servings)));
  eq('parse unknown: ' + text, a.unknown, b.unknown);
  eq('sum: ' + text, ORIG.sum(a.items), PORT.sum(b.items));
}

/* targets across weights and loads */
for (const kg of [40, 47.5, 55, 62, 70, 85]) {
  for (const training of ['rest', 'light', 'full', 'match']) {
    eq(`targets ${kg}kg ${training}`, ORIG.targets({ training, weightKg: kg }), PORT.targets({ training, weightKg: kg }));
  }
}

/* classification */
for (const text of MEALS) {
  for (const mealType of ['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Post-training']) {
    eq(`classify ${mealType}: ${text}`,
      ORIG.classify(ORIG.parse(text), mealType),
      PORT.classify(PORT.parse(text), mealType));
  }
}

/* meal scoring */
for (const text of MEALS) {
  const tg = ORIG.targets({ training: 'full', weightKg: 55 });
  eq('score: ' + text,
    ORIG.scoreMeal(ORIG.sum(ORIG.parse(text).items), tg),
    PORT.scoreMeal(PORT.sum(PORT.parse(text).items), PORT.targets({ training: 'full', weightKg: 55 })));
}

/* day reads, including the empty day */
const ctx = { mealType: 'Breakfast', training: 'full', weightKg: 55 };
const dayEntries = ['oats with milk and berries', 'chicken and rice with broccoli', 'a light coffee']
  .map((t) => {
    const oi = ORIG.parse(t);
    const pi = PORT.parse(t);
    return {
      o: { n: ORIG.sum(oi.items), kind: ORIG.classify(oi, 'Lunch') },
      p: { n: PORT.sum(pi.items), kind: PORT.classify(pi, 'Lunch') },
    };
  });
for (let i = 0; i <= dayEntries.length; i++) {
  const o = ORIG.dayRead(dayEntries.slice(0, i).map((e) => e.o), ctx);
  const p = PORT.dayRead(dayEntries.slice(0, i).map((e) => e.p), ctx);
  eq(`dayRead[${i}] totals`, o.totals, p.totals);
  eq(`dayRead[${i}] pct`, o.pct, p.pct);
  eq(`dayRead[${i}] gaps`, o.gaps.map((g) => [g.key, g.left, g.pct]), p.gaps.map((g) => [g.key, g.left, g.pct]));
  eq(`dayRead[${i}] mealsLogged`, o.mealsLogged, p.mealsLogged);
}

/* the scenario that caused the original bug: a meal, then a coffee */
const bfast = { o: ORIG.parse('eggs with avocado and cheese'), p: PORT.parse('eggs with avocado and cheese') };
const rb = { o: ORIG.readEntry(bfast.o, ctx, []), p: PORT.readEntry(bfast.p, ctx, []) };
eq('readEntry breakfast kind', rb.o.kind, rb.p.kind);
eq('readEntry breakfast score', rb.o.score, rb.p.score);
eq('readEntry breakfast verdict', rb.o.verdictWord, rb.p.verdictWord);
eq('readEntry breakfast body', rb.o.body, rb.p.body);

const snackCtx = { mealType: 'Snack', training: 'full', weightKg: 55 };
const prior = { o: [{ n: rb.o.totals, kind: 'meal' }], p: [{ n: rb.p.totals, kind: 'meal' }] };
const rc = {
  o: ORIG.readEntry(ORIG.parse('a light coffee'), snackCtx, prior.o),
  p: PORT.readEntry(PORT.parse('a light coffee'), snackCtx, prior.p),
};
eq('readEntry coffee kind', rc.o.kind, rc.p.kind);
eq('readEntry coffee score', rc.o.score, rc.p.score);
eq('readEntry coffee headline', rc.o.headline, rc.p.headline);
eq('readEntry coffee notes', rc.o.notes, rc.p.notes);
eq('readEntry coffee cutoff', rc.o.caffeineCutoff, rc.p.caffeineCutoff);

eq('nextMove after breakfast', ORIG.nextMove(rb.o, ctx), PORT.nextMove(rb.p, ctx));
eq('nextMove after coffee', ORIG.nextMove(rc.o, snackCtx), PORT.nextMove(rc.p, snackCtx));

fs.unlinkSync(outfile);

console.log('CM8 engine parity: ' + pass + '/' + (pass + fails.length) + ' checks identical');
if (fails.length) {
  console.log('\nMISMATCHES:');
  for (const f of fails.slice(0, 12)) {
    console.log('  ' + f.name);
    console.log('    cm8 : ' + String(f.orig).slice(0, 220));
    console.log('    port: ' + String(f.port).slice(0, 220));
  }
  process.exit(1);
}
